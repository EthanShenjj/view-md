import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent } from 'react'
import {
  Check,
  Clock3,
  Clipboard,
  Code2,
  Eye,
  FileText,
  FolderOpen,
  Loader2,
  RefreshCw,
  Search,
  Settings,
  Trash2
} from 'lucide-react'

import { markdownToHtml } from './lib/markdown'
import type { FilePayload, MarkdownViewerApi } from '../../preload/types'

type ViewMode = 'preview' | 'html'
type LoadState = 'idle' | 'loading' | 'ready' | 'error'
type RecentFile = {
  path: string
  name: string
  mtimeMs: number
  openedAt: number
  markdown?: string
}

type AppProps = {
  api?: MarkdownViewerApi
}

const recentFilesStorageKey = 'view-md:recent-files'
const maxRecentFiles = 12
const maxCachedMarkdownLength = 500_000

const browserFallbackApi: MarkdownViewerApi = {
  openMarkdownFile: async () => {
    return null
  },
  loadMarkdownPath: async () => {
    throw new Error('Local file paths are only available in the desktop app.')
  },
  copyHtml: async (html: string) => {
    await navigator.clipboard.writeText(html)
  },
  getPathForFile: () => '',
  onFileChanged: () => () => undefined,
  onOpenFile: () => () => undefined,
  onViewCommand: () => () => undefined
}

function formatModifiedTime(mtimeMs: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(mtimeMs))
}

function getRecentGroupLabel(openedAt: number): string {
  const openedDate = new Date(openedAt)
  const today = new Date()
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const startOfOpenedDate = new Date(
    openedDate.getFullYear(),
    openedDate.getMonth(),
    openedDate.getDate()
  ).getTime()
  const dayDifference = Math.round((startOfToday - startOfOpenedDate) / 86_400_000)

  if (dayDifference === 0) {
    return 'Today'
  }

  if (dayDifference === 1) {
    return 'Yesterday'
  }

  return 'Earlier'
}

function escapeHtmlAttribute(value: string): string {
  return value.replace(/[<>&"]/g, (char) => {
    const escapes: Record<string, string> = {
      '<': '&lt;',
      '>': '&gt;',
      '&': '&amp;',
      '"': '&quot;'
    }

    return escapes[char] ?? char
  })
}

function isMarkdownFile(file: File): boolean {
  const name = file.name.toLowerCase()
  return name.endsWith('.md') || name.endsWith('.markdown')
}

function readRecentFiles(): RecentFile[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(recentFilesStorageKey) ?? '[]') as unknown

    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed
      .filter((item): item is RecentFile => {
        return (
          typeof item === 'object' &&
          item !== null &&
          typeof (item as RecentFile).path === 'string' &&
          typeof (item as RecentFile).name === 'string' &&
          typeof (item as RecentFile).mtimeMs === 'number' &&
          typeof (item as RecentFile).openedAt === 'number'
        )
      })
      .slice(0, maxRecentFiles)
  } catch {
    return []
  }
}

function writeRecentFiles(recentFiles: RecentFile[]): void {
  localStorage.setItem(recentFilesStorageKey, JSON.stringify(recentFiles))
}

function createHtmlPreviewDocument(html: string, title: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtmlAttribute(title)}</title>
    <style>
      :root {
        color: #1b1b1b;
        background: #ffffff;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      body {
        margin: 0;
        padding: 40px clamp(24px, 6vw, 72px);
        font-size: 16px;
        line-height: 1.75;
      }

      main {
        max-width: 920px;
        margin: 0 auto;
      }

      h1, h2, h3, h4 {
        margin: 1.6em 0 0.55em;
        color: #151515;
        line-height: 1.2;
        letter-spacing: 0;
      }

      h1 {
        margin-top: 0;
        padding-bottom: 0.35em;
        border-bottom: 1px solid #e5e5e5;
        font-size: 2rem;
      }

      h2 {
        padding-bottom: 0.25em;
        border-bottom: 1px solid #eeeeee;
        font-size: 1.55rem;
      }

      p, ul, ol, blockquote, table, pre {
        margin: 0 0 1.1em;
      }

      a {
        color: #111111;
        text-decoration-thickness: 1px;
        text-underline-offset: 3px;
      }

      blockquote {
        padding: 0.2em 1em;
        border-left: 4px solid #151515;
        color: #555555;
        background: #f5f5f5;
      }

      code {
        font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
      }

      :not(pre) > code {
        padding: 0.18em 0.38em;
        border-radius: 5px;
        color: #111111;
        background: #eeeeee;
        font-size: 0.9em;
      }

      pre {
        overflow: auto;
        padding: 16px;
        border: 1px solid #e5e5e5;
        border-radius: 8px;
        background: #f6f6f6;
      }

      table {
        display: block;
        width: 100%;
        overflow: auto;
        border-spacing: 0;
        border-collapse: collapse;
      }

      th, td {
        padding: 8px 10px;
        border: 1px solid #e5e5e5;
      }

      th {
        background: #f4f4f4;
        font-weight: 750;
      }

      img {
        max-width: 100%;
        border-radius: 8px;
      }
    </style>
  </head>
  <body>
    <main>${html}</main>
  </body>
</html>`
}

async function readBrowserMarkdownFile(file: File): Promise<FilePayload> {
  if (!isMarkdownFile(file)) {
    throw new Error('Choose a .md or .markdown file.')
  }

  return {
    path: file.name,
    name: file.name,
    markdown: await file.text(),
    mtimeMs: file.lastModified || Date.now()
  }
}

export function App({ api }: AppProps) {
  const runtimeApi = api ?? window.markdownViewer ?? browserFallbackApi
  const bridgeAvailable = Boolean(api ?? window.markdownViewer)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<FilePayload | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('preview')
  const [loadState, setLoadState] = useState<LoadState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>(() => readRecentFiles())
  const [recentQuery, setRecentQuery] = useState('')
  const htmlRef = useRef('')

  const html = useMemo(() => {
    if (!file) {
      return ''
    }

    return markdownToHtml(file.markdown, { basePath: file.path })
  }, [file])

  const filteredRecentFiles = useMemo(() => {
    const normalizedQuery = recentQuery.trim().toLowerCase()

    if (!normalizedQuery) {
      return recentFiles
    }

    return recentFiles.filter((recentFile) => {
      return (
        recentFile.name.toLowerCase().includes(normalizedQuery) ||
        recentFile.path.toLowerCase().includes(normalizedQuery)
      )
    })
  }, [recentFiles, recentQuery])

  const htmlPreviewDocument = useMemo(() => {
    if (!file) {
      return ''
    }

    return createHtmlPreviewDocument(html, file.name)
  }, [file, html])

  htmlRef.current = html

  const rememberFile = useCallback(
    (payload: FilePayload) => {
      setRecentFiles((currentRecentFiles) => {
        const nextRecentFile: RecentFile = {
          path: payload.path,
          name: payload.name,
          mtimeMs: payload.mtimeMs,
          openedAt: Date.now(),
          markdown:
            bridgeAvailable || payload.markdown.length > maxCachedMarkdownLength
              ? undefined
              : payload.markdown
        }
        const nextRecentFiles = [
          nextRecentFile,
          ...currentRecentFiles.filter((recentFile) => recentFile.path !== payload.path)
        ].slice(0, maxRecentFiles)

        writeRecentFiles(nextRecentFiles)
        return nextRecentFiles
      })
    },
    [bridgeAvailable]
  )

  const acceptPayload = useCallback(
    (payload: FilePayload) => {
      setFile(payload)
      setLoadState('ready')
      setError(null)
      setCopied(false)
      rememberFile(payload)
    },
    [rememberFile]
  )

  const clearRecentFiles = useCallback(() => {
    setRecentFiles([])
    writeRecentFiles([])
  }, [])

  const openRecentFile = useCallback(
    async (recentFile: RecentFile) => {
      setLoadState('loading')
      setError(null)

      try {
        if (bridgeAvailable) {
          acceptPayload(await runtimeApi.loadMarkdownPath(recentFile.path))
          return
        }

        if (!recentFile.markdown) {
          throw new Error('This recent file needs to be opened again from disk.')
        }

        acceptPayload({
          path: recentFile.path,
          name: recentFile.name,
          markdown: recentFile.markdown,
          mtimeMs: recentFile.mtimeMs
        })
      } catch (recentError) {
        setLoadState(file ? 'ready' : 'error')
        setError(recentError instanceof Error ? recentError.message : 'Unable to open recent file.')
      }
    },
    [acceptPayload, bridgeAvailable, file, runtimeApi]
  )

  const openFile = useCallback(async () => {
    if (!bridgeAvailable) {
      fileInputRef.current?.click()
      return
    }

    setLoadState('loading')
    setError(null)

    try {
      const payload = await runtimeApi.openMarkdownFile()

      if (payload) {
        acceptPayload(payload)
      } else {
        setLoadState(file ? 'ready' : 'idle')
      }
    } catch (openError) {
      setLoadState('error')
      setError(openError instanceof Error ? openError.message : 'Unable to open that file.')
    }
  }, [acceptPayload, bridgeAvailable, runtimeApi, file])

  const handleBrowserFileSelected = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const selectedFile = event.target.files?.[0]
      event.target.value = ''

      if (!selectedFile) {
        return
      }

      setLoadState('loading')
      setError(null)

      try {
        acceptPayload(await readBrowserMarkdownFile(selectedFile))
      } catch (selectError) {
        setLoadState('error')
        setError(selectError instanceof Error ? selectError.message : 'Unable to open that file.')
      }
    },
    [acceptPayload]
  )

  const copyHtml = useCallback(async () => {
    if (!htmlRef.current) {
      return
    }

    await runtimeApi.copyHtml(htmlRef.current)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }, [runtimeApi])

  useEffect(() => {
    const unsubscribeChanged = runtimeApi.onFileChanged((payload) => {
      acceptPayload(payload)
    })
    const unsubscribeOpened = runtimeApi.onOpenFile((payload) => {
      acceptPayload(payload)
    })
    const unsubscribeCommand = runtimeApi.onViewCommand((command) => {
      if (command === 'toggle-view') {
        setViewMode((current) => (current === 'preview' ? 'html' : 'preview'))
      }

      if (command === 'copy-html') {
        copyHtml()
      }
    })

    return () => {
      unsubscribeChanged()
      unsubscribeOpened()
      unsubscribeCommand()
    }
  }, [acceptPayload, runtimeApi, copyHtml])

  const handleDrop = useCallback(
    async (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      setIsDragging(false)

      const droppedFile = Array.from(event.dataTransfer.files).find(isMarkdownFile)

      if (!droppedFile) {
        setLoadState(file ? 'ready' : 'error')
        setError('Drop a .md or .markdown file to preview it.')
        return
      }

      setLoadState('loading')
      setError(null)

      try {
        if (bridgeAvailable) {
          const droppedPath = runtimeApi.getPathForFile(droppedFile)

          if (!droppedPath) {
            throw new Error('Unable to read that dropped file path.')
          }

          acceptPayload(await runtimeApi.loadMarkdownPath(droppedPath))
        } else {
          acceptPayload(await readBrowserMarkdownFile(droppedFile))
        }
      } catch (dropError) {
        setLoadState('error')
        setError(dropError instanceof Error ? dropError.message : 'Unable to load that file.')
      }
    },
    [acceptPayload, bridgeAvailable, runtimeApi, file]
  )

  return (
    <main
      className={`app-shell ${isDragging ? 'is-dragging' : ''}`}
      onDragOver={(event) => {
        event.preventDefault()
        setIsDragging(true)
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) {
          setIsDragging(false)
        }
      }}
      onDrop={handleDrop}
    >
      <input
        ref={fileInputRef}
        className="file-input"
        type="file"
        accept=".md,.markdown,text/markdown,text/plain"
        onChange={handleBrowserFileSelected}
      />
      <aside className="app-sidebar">
        <div className="app-identity">
          <div className="app-avatar">
            <FileText aria-hidden="true" size={18} />
          </div>
          <div className="app-copy">
            <div className="app-name">View MD</div>
            <div className="app-subtitle">Markdown preview</div>
          </div>
        </div>

        <button className="sidebar-primary" type="button" onClick={openFile}>
          {loadState === 'loading' ? (
            <Loader2 className="spin" aria-hidden="true" size={17} />
          ) : (
            <FolderOpen aria-hidden="true" size={17} />
          )}
          <span>Open Markdown</span>
        </button>

        <label className="sidebar-search" aria-label="Search recent files">
          <Search aria-hidden="true" size={18} />
          <input
            type="search"
            placeholder="Search files"
            value={recentQuery}
            onChange={(event) => setRecentQuery(event.target.value)}
          />
        </label>

        <div className="recent-block" aria-label="Recent files">
          <div className="recent-header">
            <span>
              Recent files <strong>{recentFiles.length}</strong>
            </span>
            {recentFiles.length > 0 ? (
              <button
                className="small-icon-button"
                type="button"
                title="Clear recent files"
                aria-label="Clear recent files"
                onClick={clearRecentFiles}
              >
                <Trash2 aria-hidden="true" size={14} />
              </button>
            ) : null}
          </div>

          {recentFiles.length > 0 ? (
            <div className="recent-list">
              {filteredRecentFiles.length > 0 ? (
                filteredRecentFiles.map((recentFile, index) => {
                  const groupLabel = getRecentGroupLabel(recentFile.openedAt)
                  const previousGroupLabel =
                    index > 0 ? getRecentGroupLabel(filteredRecentFiles[index - 1].openedAt) : null

                  return (
                    <div className="recent-list-row" key={recentFile.path}>
                      {groupLabel !== previousGroupLabel ? (
                        <div className="recent-group">{groupLabel}</div>
                      ) : null}
                      <button
                        className={`recent-file ${file?.path === recentFile.path ? 'active' : ''}`}
                        type="button"
                        onClick={() => openRecentFile(recentFile)}
                        title={recentFile.path}
                      >
                        <FileText aria-hidden="true" size={16} />
                        <span className="recent-file-text">
                          <span className="recent-file-name">{recentFile.name}</span>
                          <span className="recent-file-meta">
                            <Clock3 aria-hidden="true" size={12} />
                            {formatModifiedTime(recentFile.mtimeMs)}
                          </span>
                        </span>
                      </button>
                    </div>
                  )
                })
              ) : (
                <div className="recent-empty">No matching files</div>
              )}
            </div>
          ) : (
            <div className="recent-empty">No recent files yet</div>
          )}
        </div>

        <div className="sidebar-footer">
          <Settings aria-hidden="true" size={18} />
          <span>Settings</span>
        </div>
      </aside>

      <section className="workspace-shell">
        <header className="workspace-header">
          <div className="file-title">
            <div className="file-name">
              <span>{file?.name ?? 'Markdown workspace'}</span>
            </div>
            <div className="file-meta">
              {file ? (
                <>
                  <span className="readonly-pill">Read only</span>
                  <span>{formatModifiedTime(file.mtimeMs)}</span>
                  <span className="file-path" title={file.path}>
                    {file.path}
                  </span>
                </>
              ) : (
                <span>{bridgeAvailable ? 'Fast Markdown preview for macOS' : 'Browser fallback mode'}</span>
              )}
            </div>
          </div>

          <div className="toolbar-actions">
            <button className="secondary-button" type="button" onClick={openFile}>
              {loadState === 'loading' ? (
                <Loader2 className="spin" aria-hidden="true" size={17} />
              ) : (
                <FolderOpen aria-hidden="true" size={17} />
              )}
              <span>Open</span>
            </button>
            <div className="segmented-control" aria-label="Preview mode">
              <button
                className={viewMode === 'preview' ? 'active' : ''}
                type="button"
                onClick={() => setViewMode('preview')}
              >
                <Eye aria-hidden="true" size={16} />
                <span>Preview</span>
              </button>
              <button
                className={viewMode === 'html' ? 'active' : ''}
                type="button"
                onClick={() => setViewMode('html')}
              >
                <Code2 aria-hidden="true" size={16} />
                <span>HTML Preview</span>
              </button>
            </div>
            <button
              className="copy-button"
              type="button"
              onClick={copyHtml}
              disabled={!file}
              title="Copy HTML"
              aria-label="Copy HTML"
            >
              {copied ? <Check aria-hidden="true" size={17} /> : <Clipboard aria-hidden="true" size={17} />}
              <span>{copied ? 'Copied' : 'Copy HTML'}</span>
            </button>
          </div>
        </header>

        <div className="content-area">
          {loadState === 'idle' && !file ? (
            <div className="empty-state">
              <div className="empty-icon">
                <FileText aria-hidden="true" size={38} />
              </div>
              <h1>Drop a Markdown file here</h1>
              <p>
                Open a .md or .markdown file to see the Markdown preview and generated HTML preview.
              </p>
              <button className="primary-button" type="button" onClick={openFile}>
                <FolderOpen aria-hidden="true" size={18} />
                <span>Open Markdown</span>
              </button>
            </div>
          ) : null}

          {loadState === 'error' ? (
            <div className="empty-state">
              <div className="empty-icon danger">
                <RefreshCw aria-hidden="true" size={36} />
              </div>
              <h1>Could not open file</h1>
              <p>{error}</p>
              <button className="primary-button" type="button" onClick={openFile}>
                <FolderOpen aria-hidden="true" size={18} />
                <span>Choose another file</span>
              </button>
            </div>
          ) : null}

          {file && loadState !== 'error' ? (
            <div className="split-view">
              <section className="source-pane" aria-label="Original Markdown">
                <div className="pane-header">
                  <span>Markdown</span>
                </div>
                <textarea
                  className="markdown-source"
                  value={file.markdown}
                  readOnly
                  spellCheck={false}
                  wrap="soft"
                  aria-label="Original Markdown source"
                />
              </section>

              <section className="preview-pane" aria-label="Preview">
                <div className="pane-header">
                  <span>{viewMode === 'preview' ? 'Preview' : 'HTML Preview'}</span>
                </div>

                {viewMode === 'preview' ? (
                  <article className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
                ) : (
                  <iframe
                    className="html-preview-frame"
                    title="Generated HTML preview"
                    sandbox=""
                    srcDoc={htmlPreviewDocument}
                  />
                )}
              </section>
            </div>
          ) : null}
        </div>
      </section>

      {isDragging ? <div className="drop-overlay">Drop Markdown to preview</div> : null}
    </main>
  )
}

export default App
