import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, shell } from 'electron'
import { createHash } from 'node:crypto'
import { stat, readFile, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { watch, type FSWatcher } from 'node:fs'

import type { ExportPayload, FilePayload } from '../preload/types.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const markdownExtensions = new Set(['.md', '.markdown'])

let mainWindow: BrowserWindow | null = null
let currentWatcher: FSWatcher | null = null
let currentWatchPath: string | null = null
let lastFileHash: string | null = null
let queuedOpenPath: string | null = null

function isMarkdownPath(filePath: string): boolean {
  return markdownExtensions.has(extname(filePath).toLowerCase())
}

async function readMarkdownFile(filePath: string): Promise<FilePayload> {
  if (!isMarkdownPath(filePath)) {
    throw new Error('Only .md and .markdown files are supported.')
  }

  const [markdown, fileStat] = await Promise.all([
    readFile(filePath, 'utf8'),
    stat(filePath)
  ])

  return {
    path: filePath,
    name: basename(filePath),
    markdown,
    mtimeMs: fileStat.mtimeMs
  }
}

function hashMarkdown(markdown: string): string {
  return createHash('sha1').update(markdown).digest('hex')
}

function watchCurrentFile(filePath: string): void {
  if (currentWatchPath === filePath) {
    return
  }

  currentWatcher?.close()
  currentWatcher = null
  currentWatchPath = filePath

  let refreshTimer: NodeJS.Timeout | null = null
  currentWatcher = watch(filePath, { persistent: false }, () => {
    if (refreshTimer) {
      clearTimeout(refreshTimer)
    }

    refreshTimer = setTimeout(async () => {
      if (!mainWindow || currentWatchPath !== filePath) {
        return
      }

      try {
        const payload = await readMarkdownFile(filePath)
        const nextHash = hashMarkdown(payload.markdown)

        if (nextHash !== lastFileHash) {
          lastFileHash = nextHash
          mainWindow.webContents.send('markdown:file-changed', payload)
        }
      } catch {
        currentWatcher?.close()
        currentWatcher = null
        currentWatchPath = null
      }
    }, 120)
  })
}

async function loadAndTrackFile(filePath: string): Promise<FilePayload> {
  const payload = await readMarkdownFile(filePath)
  lastFileHash = hashMarkdown(payload.markdown)
  watchCurrentFile(filePath)
  return payload
}

async function openMarkdownDialog(): Promise<FilePayload | null> {
  if (!mainWindow) {
    return null
  }

  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open Markdown File',
    properties: ['openFile'],
    filters: [
      {
        name: 'Markdown',
        extensions: ['md', 'markdown']
      }
    ]
  })

  if (result.canceled || !result.filePaths[0]) {
    return null
  }

  return loadAndTrackFile(result.filePaths[0])
}

function getExportBaseName(name: string): string {
  const trimmedName = name.trim() || 'markdown-preview'
  const extension = extname(trimmedName)
  return extension ? trimmedName.slice(0, -extension.length) : trimmedName
}

function buildExportHtml(payload: ExportPayload): string {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${payload.name}</title>
  <style>
    body {
      margin: 0;
      padding: 48px;
      color: #111419;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.65;
    }
    main {
      max-width: 760px;
      margin: 0 auto;
    }
    pre {
      overflow: auto;
      padding: 16px;
      border: 1px solid #d8dbe0;
      border-radius: 8px;
      background: #f6f7f8;
    }
    code {
      font-family: "SFMono-Regular", Consolas, monospace;
    }
    img {
      max-width: 100%;
    }
  </style>
</head>
<body>
  <main>${payload.html}</main>
</body>
</html>`
}

async function exportHtmlFile(payload: ExportPayload): Promise<string | null> {
  if (!mainWindow) {
    return null
  }

  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export HTML',
    defaultPath: `${getExportBaseName(payload.name)}.html`,
    filters: [{ name: 'HTML', extensions: ['html'] }]
  })

  if (result.canceled || !result.filePath) {
    return null
  }

  await writeFile(result.filePath, buildExportHtml(payload), 'utf8')
  return result.filePath
}

async function exportPdfFile(payload: ExportPayload): Promise<string | null> {
  if (!mainWindow) {
    return null
  }

  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export PDF',
    defaultPath: `${getExportBaseName(payload.name)}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  })

  if (result.canceled || !result.filePath) {
    return null
  }

  const printWindow = new BrowserWindow({
    show: false,
    width: 900,
    height: 1200,
    webPreferences: {
      sandbox: true
    }
  })

  try {
    await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildExportHtml(payload))}`)
    const pdf = await printWindow.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4'
    })
    await writeFile(result.filePath, pdf)
    return result.filePath
  } finally {
    printWindow.close()
  }
}

function sendOpenedFile(payload: FilePayload): void {
  mainWindow?.webContents.send('markdown:file-opened', payload)
}

function createAppMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin'
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const }
            ]
          }
        ]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Markdown...',
          accelerator: 'CommandOrControl+O',
          click: async () => {
            const payload = await openMarkdownDialog()
            if (payload) {
              sendOpenedFile(payload)
            }
          }
        },
        { type: 'separator' },
        process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Preview / HTML Preview',
          accelerator: 'CommandOrControl+Shift+H',
          click: () => {
            mainWindow?.webContents.send('markdown:view-command', 'toggle-view')
          }
        },
        { role: 'reload' },
        { role: 'toggleDevTools' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        {
          label: 'Copy HTML',
          accelerator: 'CommandOrControl+Shift+C',
          click: () => {
            mainWindow?.webContents.send('markdown:view-command', 'copy-html')
          }
        },
        { type: 'separator' },
        { role: 'copy' },
        { role: 'selectAll' }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 760,
    minHeight: 520,
    title: 'View MD',
    backgroundColor: '#f6f7f8',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    await mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  if (queuedOpenPath) {
    try {
      sendOpenedFile(await loadAndTrackFile(queuedOpenPath))
      queuedOpenPath = null
    } catch {
      queuedOpenPath = null
    }
  }
}

ipcMain.handle('markdown:open-file', async () => openMarkdownDialog())

ipcMain.handle('markdown:load-path', async (_event, filePath: string) => {
  return loadAndTrackFile(filePath)
})

ipcMain.handle('markdown:copy-html', async (_event, html: string) => {
  clipboard.writeText(html)
})

ipcMain.handle('markdown:export-html', async (_event, payload: ExportPayload) => {
  return exportHtmlFile(payload)
})

ipcMain.handle('markdown:export-pdf', async (_event, payload: ExportPayload) => {
  return exportPdfFile(payload)
})

app.on('window-all-closed', () => {
  currentWatcher?.close()

  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('open-file', (event, filePath) => {
  event.preventDefault()

  if (!isMarkdownPath(filePath)) {
    return
  }

  if (!mainWindow) {
    queuedOpenPath = filePath
    return
  }

  loadAndTrackFile(filePath)
    .then(sendOpenedFile)
    .catch(() => undefined)
})

app.whenReady().then(async () => {
  createAppMenu()
  await createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})
