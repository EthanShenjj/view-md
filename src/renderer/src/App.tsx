import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent } from 'react'
import {
  Check,
  Clipboard,
  Code2,
  Columns2,
  Download,
  FileDown,
  FileText,
  FolderOpen,
  HelpCircle,
  Home,
  Lightbulb,
  ListTree,
  MessageSquare,
  Plus,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Search,
  Settings,
  SlidersHorizontal,
  Star,
  Trash2,
  X
} from 'lucide-react'

import { markdownToHtml } from './lib/markdown'
import type { FilePayload, MarkdownViewerApi } from '../../preload/types'

type ViewMode = 'editor' | 'preview' | 'split'
type PreviewMode = 'markdown' | 'html'
type LoadState = 'idle' | 'loading' | 'ready' | 'error'
type SidebarSection = 'home' | 'favorites' | 'trash' | 'settings'
type RecentFile = {
  path: string
  name: string
  mtimeMs: number
  openedAt: number
  markdown?: string
}
type AppSettings = {
  autoRefresh: boolean
  syncScroll: boolean
  showOutline: boolean
}
type OutlineItem = {
  id: string
  level: number
  title: string
}

type AppProps = {
  api?: MarkdownViewerApi
}

const recentFilesStorageKey = 'view-md:recent-files'
const favoritePathsStorageKey = 'view-md:favorite-paths'
const trashedPathsStorageKey = 'view-md:trashed-paths'
const settingsStorageKey = 'view-md:settings'
const maxRecentFiles = 12
const maxCachedMarkdownLength = 500_000
const splitDividerWidth = 7
const minEditorPaneWidth = 300
const minPreviewPaneWidth = 360
const maxEditorPaneRatio = 0.62

export function getAdaptiveEditorWidth(totalWidth: number, preferredWidth: number): number {
  if (totalWidth <= 0) {
    return preferredWidth
  }

  const availableWidth = Math.max(0, totalWidth - splitDividerWidth)
  const maxWidthByPreview = availableWidth - minPreviewPaneWidth
  const maxWidthByRatio = Math.floor(availableWidth * maxEditorPaneRatio)
  const maxEditorWidth = Math.max(
    minEditorPaneWidth,
    Math.min(maxWidthByPreview, maxWidthByRatio)
  )

  if (preferredWidth < minEditorPaneWidth) {
    return minEditorPaneWidth
  }

  if (preferredWidth > maxEditorWidth) {
    return maxEditorWidth
  }

  return preferredWidth
}

function getSidebarLayoutWidth(totalWidth: number, isCollapsed: boolean): number {
  if (totalWidth <= 1020) {
    return 86
  }

  if (isCollapsed) {
    return 76
  }

  if (totalWidth <= 1180) {
    return 232
  }

  return 260
}

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
  exportHtml: async ({ name, html }) => {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = name.replace(/\.(md|markdown)$/i, '.html') || 'markdown-preview.html'
    anchor.click()
    URL.revokeObjectURL(url)
    return anchor.download
  },
  exportPdf: async () => {
    window.print()
    return null
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

function getRecentDescription(recentFile: RecentFile): string {
  const markdownSummary = recentFile.markdown
    ?.replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#*_`>\-[\]()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (markdownSummary) {
    return markdownSummary.length > 74 ? `${markdownSummary.slice(0, 74)}...` : markdownSummary
  }

  return `Modified ${formatModifiedTime(recentFile.mtimeMs)}`
}

function getFileIcon(fileName: string) {
  const lowerName = fileName.toLowerCase()
  if (lowerName.includes('api') || lowerName.includes('code') || lowerName.includes('develop')) {
    return <Code2 aria-hidden="true" size={16} />
  }
  if (lowerName.includes('idea') || lowerName.includes('draft') || lowerName.includes('creative')) {
    return <Lightbulb aria-hidden="true" size={16} />
  }
  if (
    lowerName.includes('meeting') ||
    lowerName.includes('note') ||
    lowerName.includes('chat') ||
    lowerName.includes('discuss')
  ) {
    return <MessageSquare aria-hidden="true" size={16} />
  }
  return <FileText aria-hidden="true" size={16} />
}

function isMarkdownFile(file: File): boolean {
  const name = file.name.toLowerCase()
  return name.endsWith('.md') || name.endsWith('.markdown')
}

async function readFileText(file: File): Promise<string> {
  if (typeof file.text === 'function') {
    return file.text()
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.addEventListener('load', () => {
      resolve(typeof reader.result === 'string' ? reader.result : '')
    })
    reader.addEventListener('error', () => {
      reject(reader.error ?? new Error('Unable to read that file.'))
    })
    reader.readAsText(file)
  })
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

function readStringSet(storageKey: string): Set<string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) ?? '[]') as unknown
    if (!Array.isArray(parsed)) {
      return new Set()
    }
    return new Set(parsed.filter((item): item is string => typeof item === 'string'))
  } catch {
    return new Set()
  }
}

function writeStringSet(storageKey: string, values: Set<string>): void {
  localStorage.setItem(storageKey, JSON.stringify([...values]))
}

function readAppSettings(): AppSettings {
  try {
    const parsed = JSON.parse(localStorage.getItem(settingsStorageKey) ?? '{}') as Partial<AppSettings>
    return {
      autoRefresh: parsed.autoRefresh ?? false,
      syncScroll: parsed.syncScroll ?? true,
      showOutline: parsed.showOutline ?? true
    }
  } catch {
    return {
      autoRefresh: false,
      syncScroll: true,
      showOutline: true
    }
  }
}

function writeAppSettings(settings: AppSettings): void {
  localStorage.setItem(settingsStorageKey, JSON.stringify(settings))
}

function slugifyHeading(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'heading'
}

function parseMarkdownOutline(markdown: string): OutlineItem[] {
  const usedIds = new Map<string, number>()

  return markdown
    .split('\n')
    .map((line) => line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => {
      const baseId = slugifyHeading(match[2].replace(/[*_`[\]()]/g, '').trim())
      const count = usedIds.get(baseId) ?? 0
      usedIds.set(baseId, count + 1)

      return {
        id: count === 0 ? baseId : `${baseId}-${count}`,
        level: match[1].length,
        title: match[2].replace(/[*_`]/g, '').trim()
      }
    })
}

async function readBrowserMarkdownFile(file: File): Promise<FilePayload> {
  if (!isMarkdownFile(file)) {
    throw new Error('Choose a .md or .markdown file.')
  }

  return {
    path: file.name,
    name: file.name,
    markdown: await readFileText(file),
    mtimeMs: file.lastModified || Date.now()
  }
}

export function App({ api }: AppProps) {
  const runtimeApi = api ?? window.markdownViewer ?? browserFallbackApi
  const bridgeAvailable = Boolean(api ?? window.markdownViewer)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<FilePayload | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('split')
  const [previewMode, setPreviewMode] = useState<PreviewMode>('markdown')
  const [loadState, setLoadState] = useState<LoadState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>(() => readRecentFiles())
  const [recentQuery, setRecentQuery] = useState('')
  const [activeSection, setActiveSection] = useState<SidebarSection>('home')
  const [favoritePaths, setFavoritePaths] = useState<Set<string>>(() => readStringSet(favoritePathsStorageKey))
  const [trashedPaths, setTrashedPaths] = useState<Set<string>>(() => readStringSet(trashedPathsStorageKey))
  const [settings, setSettings] = useState<AppSettings>(() => readAppSettings())
  const [pendingFileChange, setPendingFileChange] = useState<FilePayload | null>(null)
  const [exportMessage, setExportMessage] = useState<string | null>(null)
  const htmlRef = useRef('')
  const sourceTextareaRef = useRef<HTMLTextAreaElement>(null)
  const previewContentRef = useRef<HTMLDivElement>(null)
  const isSyncingScroll = useRef(false)

  const appShellRef = useRef<HTMLDivElement>(null)
  const splitViewRef = useRef<HTMLDivElement>(null)
  const [editorWidth, setEditorWidth] = useState(480)
  const [isDraggingDivider, setIsDraggingDivider] = useState(false)
  const dragStartInfo = useRef({ startX: 0, startWidth: 0 })

  const startDragging = useCallback((event: React.MouseEvent) => {
    event.preventDefault()
    setIsDraggingDivider(true)
    dragStartInfo.current = {
      startX: event.clientX,
      startWidth: editorWidth
    }
  }, [editorWidth])

  useEffect(() => {
    if (!isDraggingDivider) {
      return
    }

    const handleMouseMove = (event: MouseEvent) => {
      if (!splitViewRef.current) {
        return
      }

      const rect = splitViewRef.current.getBoundingClientRect()
      const totalWidth = rect.width

      const deltaX = event.clientX - dragStartInfo.current.startX
      let nextWidth = dragStartInfo.current.startWidth + deltaX

      setEditorWidth(getAdaptiveEditorWidth(totalWidth, nextWidth))
    }

    const handleMouseUp = () => {
      setIsDraggingDivider(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDraggingDivider])

  useEffect(() => {
    if (viewMode !== 'split' || !splitViewRef.current) {
      return
    }
    if (typeof ResizeObserver === 'undefined') {
      return
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const totalWidth = entry.contentRect.width
      setEditorWidth((currentWidth) => {
        return getAdaptiveEditorWidth(totalWidth, currentWidth)
      })
    })

    observer.observe(splitViewRef.current)
    return () => observer.disconnect()
  }, [viewMode])

  const [recentWidth, setRecentWidth] = useState(300)
  const [isRecentCollapsed, setIsRecentCollapsed] = useState(() => readRecentFiles().length === 0)
  const [isDraggingRecent, setIsDraggingRecent] = useState(false)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const recentDragStartInfo = useRef({ startX: 0, startWidth: 0 })

  const startDraggingRecent = useCallback((event: React.MouseEvent) => {
    event.preventDefault()
    setIsDraggingRecent(true)
    recentDragStartInfo.current = {
      startX: event.clientX,
      startWidth: recentWidth
    }
  }, [recentWidth])

  const toggleRecentCollapse = useCallback(() => {
    setIsRecentCollapsed((collapsed) => !collapsed)
  }, [])

  useEffect(() => {
    if (!isDraggingRecent) {
      return
    }

    const handleMouseMove = (event: MouseEvent) => {
      if (!appShellRef.current) {
        return
      }

      const totalWidth = appShellRef.current.getBoundingClientRect().width
      const sidebarWidth = getSidebarLayoutWidth(totalWidth, isSidebarCollapsed)

      const deltaX = event.clientX - recentDragStartInfo.current.startX
      let nextWidth = recentDragStartInfo.current.startWidth + deltaX

      const minWidth = 180
      const minWorkspaceWidth = 400
      const maxWidth = Math.min(550, totalWidth - sidebarWidth - minWorkspaceWidth - 9)

      if (nextWidth < 150) {
        setIsRecentCollapsed(true)
        setRecentWidth(minWidth)
      } else {
        setIsRecentCollapsed(false)
        if (nextWidth > maxWidth) {
          nextWidth = Math.max(minWidth, maxWidth)
        }
        setRecentWidth(nextWidth)
      }
    }

    const handleMouseUp = () => {
      setIsDraggingRecent(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDraggingRecent, isSidebarCollapsed])

  useEffect(() => {
    if (!appShellRef.current) {
      return
    }
    if (typeof ResizeObserver === 'undefined') {
      return
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return

      const totalWidth = entry.contentRect.width

      const sidebarWidth = getSidebarLayoutWidth(totalWidth, isSidebarCollapsed)
      const isMobile = totalWidth <= 1020

      const minWorkspaceWidth = 400
      const minRecentWidth = 180

      if (!isRecentCollapsed && !isMobile) {
        setRecentWidth((currentRecentWidth) => {
          const availableForRecent = totalWidth - sidebarWidth - minWorkspaceWidth - 9
          if (availableForRecent < minRecentWidth) {
            setIsRecentCollapsed(true)
            return minRecentWidth
          }
          if (currentRecentWidth > availableForRecent) {
            return Math.max(minRecentWidth, availableForRecent)
          }
          return currentRecentWidth
        })
      }
    })

    observer.observe(appShellRef.current)
    return () => observer.disconnect()
  }, [isRecentCollapsed, isSidebarCollapsed])

  const html = useMemo(() => {
    if (!file) {
      return ''
    }

    return markdownToHtml(file.markdown, { basePath: file.path })
  }, [file])

  const outline = useMemo(() => {
    return file ? parseMarkdownOutline(file.markdown) : []
  }, [file])

  const filteredRecentFiles = useMemo(() => {
    const normalizedQuery = recentQuery.trim().toLowerCase()
    const sectionFiles = recentFiles.filter((recentFile) => {
      const isTrashed = trashedPaths.has(recentFile.path)

      if (activeSection === 'trash') {
        return isTrashed
      }

      if (isTrashed) {
        return false
      }

      if (activeSection === 'favorites') {
        return favoritePaths.has(recentFile.path)
      }

      return true
    })

    if (!normalizedQuery) {
      return sectionFiles
    }

    return sectionFiles.filter((recentFile) => {
      return (
        recentFile.name.toLowerCase().includes(normalizedQuery) ||
        recentFile.path.toLowerCase().includes(normalizedQuery) ||
        getRecentDescription(recentFile).toLowerCase().includes(normalizedQuery)
      )
    })
  }, [activeSection, favoritePaths, recentFiles, recentQuery, trashedPaths])

  const recentSectionTitle = activeSection === 'favorites'
    ? 'Favorite documents'
    : activeSection === 'trash'
      ? 'Trash'
      : 'Recent documents'

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
        setIsRecentCollapsed(false)
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
      setPendingFileChange(null)
      setTrashedPaths((currentPaths) => {
        if (!currentPaths.has(payload.path)) {
          return currentPaths
        }
        const nextPaths = new Set(currentPaths)
        nextPaths.delete(payload.path)
        writeStringSet(trashedPathsStorageKey, nextPaths)
        return nextPaths
      })
      rememberFile(payload)
    },
    [rememberFile]
  )

  const clearRecentFiles = useCallback(() => {
    setRecentFiles([])
    writeRecentFiles([])
    setIsRecentCollapsed(true)
  }, [])

  const toggleFavorite = useCallback((path: string) => {
    setFavoritePaths((currentPaths) => {
      const nextPaths = new Set(currentPaths)
      if (nextPaths.has(path)) {
        nextPaths.delete(path)
      } else {
        nextPaths.add(path)
      }
      writeStringSet(favoritePathsStorageKey, nextPaths)
      return nextPaths
    })
  }, [])

  const moveToTrash = useCallback((path: string) => {
    setTrashedPaths((currentPaths) => {
      const nextPaths = new Set(currentPaths)
      nextPaths.add(path)
      writeStringSet(trashedPathsStorageKey, nextPaths)
      return nextPaths
    })
    if (file?.path === path) {
      setFile(null)
      setLoadState('idle')
    }
  }, [file])

  const restoreFromTrash = useCallback((path: string) => {
    setTrashedPaths((currentPaths) => {
      const nextPaths = new Set(currentPaths)
      nextPaths.delete(path)
      writeStringSet(trashedPathsStorageKey, nextPaths)
      return nextPaths
    })
  }, [])

  const permanentlyRemoveRecent = useCallback((path: string) => {
    setRecentFiles((currentRecentFiles) => {
      const nextRecentFiles = currentRecentFiles.filter((recentFile) => recentFile.path !== path)
      writeRecentFiles(nextRecentFiles)
      return nextRecentFiles
    })
    setFavoritePaths((currentPaths) => {
      const nextPaths = new Set(currentPaths)
      nextPaths.delete(path)
      writeStringSet(favoritePathsStorageKey, nextPaths)
      return nextPaths
    })
    setTrashedPaths((currentPaths) => {
      const nextPaths = new Set(currentPaths)
      nextPaths.delete(path)
      writeStringSet(trashedPathsStorageKey, nextPaths)
      return nextPaths
    })
  }, [])

  const updateSetting = useCallback((key: keyof AppSettings, value: boolean) => {
    setSettings((currentSettings) => {
      const nextSettings = { ...currentSettings, [key]: value }
      writeAppSettings(nextSettings)
      return nextSettings
    })
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

  const exportHtml = useCallback(async () => {
    if (!file || !htmlRef.current) {
      return
    }

    const savedPath = await runtimeApi.exportHtml({ name: file.name, html: htmlRef.current })
    setExportMessage(savedPath ? `Exported HTML to ${savedPath}` : 'HTML export canceled')
    window.setTimeout(() => setExportMessage(null), 2200)
  }, [file, runtimeApi])

  const exportPdf = useCallback(async () => {
    if (!file || !htmlRef.current) {
      return
    }

    const savedPath = await runtimeApi.exportPdf({ name: file.name, html: htmlRef.current })
    setExportMessage(savedPath ? `Exported PDF to ${savedPath}` : 'PDF export canceled')
    window.setTimeout(() => setExportMessage(null), 2200)
  }, [file, runtimeApi])

  const applyPendingFileChange = useCallback(() => {
    if (!pendingFileChange) {
      return
    }

    acceptPayload(pendingFileChange)
    setPendingFileChange(null)
  }, [acceptPayload, pendingFileChange])

  useEffect(() => {
    const unsubscribeChanged = runtimeApi.onFileChanged((payload) => {
      if (settings.autoRefresh) {
        acceptPayload(payload)
        setPendingFileChange(null)
        return
      }

      setPendingFileChange(payload)
    })
    const unsubscribeOpened = runtimeApi.onOpenFile((payload) => {
      acceptPayload(payload)
    })
    const unsubscribeCommand = runtimeApi.onViewCommand((command) => {
      if (command === 'toggle-view') {
        setViewMode((current) => (current === 'split' ? 'preview' : 'split'))
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
  }, [acceptPayload, runtimeApi, copyHtml, settings.autoRefresh])

  const syncPreviewScroll = useCallback((sourceElement: HTMLTextAreaElement) => {
    if (!settings.syncScroll || isSyncingScroll.current || !previewContentRef.current) {
      return
    }

    const maxSourceScroll = sourceElement.scrollHeight - sourceElement.clientHeight
    const maxPreviewScroll = previewContentRef.current.scrollHeight - previewContentRef.current.clientHeight

    if (maxSourceScroll <= 0 || maxPreviewScroll <= 0) {
      return
    }

    isSyncingScroll.current = true
    previewContentRef.current.scrollTop = (sourceElement.scrollTop / maxSourceScroll) * maxPreviewScroll
    window.requestAnimationFrame(() => {
      isSyncingScroll.current = false
    })
  }, [settings.syncScroll])

  const syncSourceScroll = useCallback((previewElement: HTMLDivElement) => {
    if (!settings.syncScroll || isSyncingScroll.current || !sourceTextareaRef.current) {
      return
    }

    const maxPreviewScroll = previewElement.scrollHeight - previewElement.clientHeight
    const maxSourceScroll = sourceTextareaRef.current.scrollHeight - sourceTextareaRef.current.clientHeight

    if (maxPreviewScroll <= 0 || maxSourceScroll <= 0) {
      return
    }

    isSyncingScroll.current = true
    sourceTextareaRef.current.scrollTop = (previewElement.scrollTop / maxPreviewScroll) * maxSourceScroll
    window.requestAnimationFrame(() => {
      isSyncingScroll.current = false
    })
  }, [settings.syncScroll])

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
      ref={appShellRef}
      className={`app-shell ${isDragging ? 'is-dragging' : ''} ${isDraggingRecent ? 'is-dragging-recent' : ''} ${isRecentCollapsed ? 'recent-collapsed' : ''} ${isSidebarCollapsed ? 'sidebar-collapsed' : ''}`}
      style={{
        '--recent-width': `${recentWidth}px`
      } as React.CSSProperties}
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
            <div className="app-name">Markdown Reader</div>
            <div className="app-subtitle">Personal workspace</div>
          </div>
          <button
            className="sidebar-collapse-button"
            type="button"
            title={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-pressed={isSidebarCollapsed}
            onClick={() => setIsSidebarCollapsed((collapsed) => !collapsed)}
          >
            {isSidebarCollapsed ? (
              <PanelLeftOpen aria-hidden="true" size={17} />
            ) : (
              <PanelLeftClose aria-hidden="true" size={17} />
            )}
          </button>
        </div>

        <button className="sidebar-primary" type="button" onClick={openFile}>
          {loadState === 'loading' ? (
            <Loader2 className="spin" aria-hidden="true" size={17} />
          ) : (
            <Plus aria-hidden="true" size={19} />
          )}
          <span>New Document</span>
        </button>

        <nav className="sidebar-nav" aria-label="Workspace">
          <button
            className={`sidebar-nav-item ${activeSection === 'home' ? 'active' : ''}`}
            type="button"
            onClick={() => {
              setActiveSection('home')
              setIsRecentCollapsed(false)
            }}
          >
            <Home aria-hidden="true" size={19} />
            <span>Home</span>
          </button>
          <button
            className="sidebar-nav-item"
            type="button"
            onClick={() => {
              setIsRecentCollapsed(false)
              openFile()
            }}
          >
            <FolderOpen aria-hidden="true" size={19} />
            <span>All files</span>
          </button>
          <button
            className={`sidebar-nav-item ${activeSection === 'favorites' ? 'active' : ''}`}
            type="button"
            onClick={() => {
              setActiveSection('favorites')
              setIsRecentCollapsed(false)
            }}
          >
            <Star aria-hidden="true" size={19} />
            <span>Favorites</span>
          </button>
          <button
            className={`sidebar-nav-item ${activeSection === 'trash' ? 'active' : ''}`}
            type="button"
            onClick={() => {
              setActiveSection('trash')
              setIsRecentCollapsed(false)
            }}
          >
            <Trash2 aria-hidden="true" size={18} />
            <span>Trash</span>
          </button>
          <button
            className={`sidebar-nav-item ${activeSection === 'settings' ? 'active' : ''}`}
            type="button"
            onClick={() => {
              setActiveSection('settings')
              setIsRecentCollapsed(true)
            }}
          >
            <Settings aria-hidden="true" size={19} />
            <span>Settings</span>
          </button>
        </nav>

        <div className="sidebar-footer">
          <button className="sidebar-nav-item" type="button">
            <HelpCircle aria-hidden="true" size={19} />
            <span>Help</span>
          </button>
          <button className="sidebar-nav-item" type="button">
            <MessageSquare aria-hidden="true" size={19} />
            <span>Feedback</span>
          </button>
        </div>
      </aside>

      <section
        className="documents-pane"
        aria-label="Recent files"
        aria-hidden={isRecentCollapsed}
      >
        <div className="recent-block">
          <div className="recent-header">
            <span>{recentSectionTitle}</span>
            <span className="recent-count">{filteredRecentFiles.length}</span>
            {activeSection === 'home' && recentFiles.length > 0 ? (
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
                filteredRecentFiles.map((recentFile) => {
                  return (
                    <div className="recent-list-row" key={recentFile.path}>
                      <button
                        className={`recent-file-main ${file?.path === recentFile.path ? 'active' : ''}`}
                        type="button"
                        onClick={() => openRecentFile(recentFile)}
                        title={recentFile.path}
                      >
                        {getFileIcon(recentFile.name)}
                        <span className="recent-file-text">
                          <span className="recent-file-name">{recentFile.name}</span>
                          <span className="recent-file-meta">{getRecentDescription(recentFile)}</span>
                        </span>
                      </button>
                      <div className="recent-file-actions">
                        {activeSection === 'trash' ? (
                          <>
                            <button
                              className="small-icon-button"
                              type="button"
                              title="Restore"
                              aria-label={`Restore ${recentFile.name}`}
                              onClick={() => restoreFromTrash(recentFile.path)}
                            >
                              <RefreshCw aria-hidden="true" size={13} />
                            </button>
                            <button
                              className="small-icon-button"
                              type="button"
                              title="Remove from recent"
                              aria-label={`Remove ${recentFile.name}`}
                              onClick={() => permanentlyRemoveRecent(recentFile.path)}
                            >
                              <X aria-hidden="true" size={14} />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              className={`small-icon-button ${favoritePaths.has(recentFile.path) ? 'is-active' : ''}`}
                              type="button"
                              title={favoritePaths.has(recentFile.path) ? 'Remove favorite' : 'Add favorite'}
                              aria-label={`${favoritePaths.has(recentFile.path) ? 'Remove favorite' : 'Add favorite'} ${recentFile.name}`}
                              onClick={() => toggleFavorite(recentFile.path)}
                            >
                              <Star aria-hidden="true" size={14} />
                            </button>
                            <button
                              className="small-icon-button"
                              type="button"
                              title="Move to trash"
                              aria-label={`Move ${recentFile.name} to trash`}
                              onClick={() => moveToTrash(recentFile.path)}
                            >
                              <Trash2 aria-hidden="true" size={14} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  )
                })
              ) : (
                <div className="recent-empty">
                  {recentQuery ? 'No matching files' : `No ${recentSectionTitle.toLowerCase()} yet`}
                </div>
              )}
            </div>
          ) : (
            <div className="recent-empty">No recent files yet</div>
          )}
        </div>
      </section>

      <div
        className={`app-shell-divider ${isDraggingRecent ? 'is-dragging' : ''} ${isRecentCollapsed ? 'is-hidden' : ''}`}
        onMouseDown={isRecentCollapsed ? undefined : startDraggingRecent}
        onDoubleClick={isRecentCollapsed ? undefined : toggleRecentCollapse}
        title={isRecentCollapsed ? undefined : 'Drag to resize, double click to collapse'}
      />

      <section className="workspace-shell">
        <header className="workspace-header">
          <div className="workspace-view-bar">
            <button
              className="icon-button"
              type="button"
              onClick={toggleRecentCollapse}
              title={isRecentCollapsed ? "Show recent documents" : "Hide recent documents"}
              aria-label="Toggle recent documents"
              style={{ width: '32px', height: '32px', borderRadius: '6px' }}
            >
              <Columns2 aria-hidden="true" size={17} />
            </button>
            <div className="workspace-tabs" aria-label="Document view">
              <button
                className={viewMode === 'editor' ? 'active' : ''}
                type="button"
                onClick={() => setViewMode('editor')}
              >
                Editor
              </button>
              <button
                className={viewMode === 'preview' ? 'active' : ''}
                type="button"
                onClick={() => setViewMode('preview')}
              >
                Preview
              </button>
              <button
                className={viewMode === 'split' ? 'active' : ''}
                type="button"
                onClick={() => setViewMode('split')}
              >
                Split View
              </button>
            </div>
          </div>

          <div className="toolbar-actions">
            <label className="workspace-search" aria-label="Search recent files">
              <input
                type="search"
                placeholder="Search files..."
                value={recentQuery}
                onChange={(event) => setRecentQuery(event.target.value)}
              />
              <Search aria-hidden="true" size={18} />
            </label>
            <button className="icon-button" type="button" onClick={openFile} title="Refresh files" aria-label="Refresh files">
              <RefreshCw aria-hidden="true" size={18} />
            </button>
            <button
              className="copy-button share-button"
              type="button"
              onClick={copyHtml}
              disabled={!file}
              title="Copy HTML"
              aria-label="Copy HTML"
            >
              {copied ? <Check aria-hidden="true" size={17} /> : <Clipboard aria-hidden="true" size={17} />}
              <span>{copied ? 'Copied' : 'Share'}</span>
            </button>
            <div className="export-actions" aria-label="Export document">
              <button className="secondary-button" type="button" onClick={exportHtml} disabled={!file}>
                <Download aria-hidden="true" size={16} />
                <span>HTML</span>
              </button>
              <button className="secondary-button" type="button" onClick={exportPdf} disabled={!file}>
                <FileDown aria-hidden="true" size={16} />
                <span>PDF</span>
              </button>
            </div>
            <div className="user-avatar" aria-label="Current user" title="Personal workspace">
              <span>MD</span>
            </div>
          </div>
        </header>

        <div className="document-strip">
          {file ? (
            <>
            <span className="document-title">{file.name}</span>
            <span>{formatModifiedTime(file.mtimeMs)}</span>
            <span className="file-path" title={file.path}>
              {file.path}
            </span>
            </>
          ) : (
            <>
              <span className="document-title">Markdown workspace</span>
              <span>{bridgeAvailable ? 'Desktop mode' : 'Browser mode'}</span>
            </>
          )}
        </div>

        <div className="content-area">
          {activeSection === 'settings' ? (
            <section className="settings-panel" aria-label="Settings">
              <div>
                <h1>Settings</h1>
                <p>Workspace behavior for preview, refresh, and navigation.</p>
              </div>
              <label className="settings-row">
                <span>
                  <strong>Auto refresh changed files</strong>
                  <small>Reload the current document when the file changes on disk.</small>
                </span>
                <input
                  type="checkbox"
                  checked={settings.autoRefresh}
                  onChange={(event) => updateSetting('autoRefresh', event.target.checked)}
                />
              </label>
              <label className="settings-row">
                <span>
                  <strong>Sync source and preview scroll</strong>
                  <small>Keep split panes aligned by scroll progress.</small>
                </span>
                <input
                  type="checkbox"
                  checked={settings.syncScroll}
                  onChange={(event) => updateSetting('syncScroll', event.target.checked)}
                />
              </label>
              <label className="settings-row">
                <span>
                  <strong>Show Markdown outline</strong>
                  <small>Display headings beside the preview when a document is open.</small>
                </span>
                <input
                  type="checkbox"
                  checked={settings.showOutline}
                  onChange={(event) => updateSetting('showOutline', event.target.checked)}
                />
              </label>
            </section>
          ) : null}

          {activeSection !== 'settings' && pendingFileChange ? (
            <div className="file-change-banner" role="status">
              <span>This file changed on disk.</span>
              <button className="secondary-button" type="button" onClick={applyPendingFileChange}>
                <RefreshCw aria-hidden="true" size={15} />
                <span>Refresh</span>
              </button>
              <button
                className="small-icon-button"
                type="button"
                aria-label="Dismiss file change"
                onClick={() => setPendingFileChange(null)}
              >
                <X aria-hidden="true" size={14} />
              </button>
            </div>
          ) : null}

          {activeSection !== 'settings' && exportMessage ? (
            <div className="file-change-banner compact" role="status">
              <span>{exportMessage}</span>
            </div>
          ) : null}

          {activeSection !== 'settings' && loadState === 'idle' && !file ? (
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

          {activeSection !== 'settings' && loadState === 'error' ? (
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

          {activeSection !== 'settings' && file && loadState !== 'error' ? (
            <div className={`reader-workspace ${settings.showOutline && outline.length > 0 ? 'has-outline' : ''}`}>
              {settings.showOutline && outline.length > 0 ? (
                <aside className="outline-panel" aria-label="Markdown outline">
                  <div className="outline-title">
                    <ListTree aria-hidden="true" size={15} />
                    <span>Outline</span>
                  </div>
                  <div className="outline-list">
                    {outline.map((item) => (
                      <button
                        key={item.id}
                        className="outline-item"
                        type="button"
                        style={{ '--outline-level': item.level } as React.CSSProperties}
                        onClick={() => {
                          previewContentRef.current
                            ?.querySelector(`#${CSS.escape(item.id)}`)
                            ?.scrollIntoView({ block: 'start' })
                        }}
                      >
                        {item.title}
                      </button>
                    ))}
                  </div>
                </aside>
              ) : null}

              <div
                ref={splitViewRef}
                className={`split-view mode-${viewMode} ${isDraggingDivider ? 'is-dragging-divider' : ''}`}
                style={
                  viewMode === 'split'
                    ? { gridTemplateColumns: `${editorWidth}px auto 1fr` }
                    : undefined
                }
              >
              {viewMode !== 'preview' ? (
                <section className="source-pane" aria-label="Original Markdown">
                  <div className="pane-header">
                    <span>Markdown</span>
                    <SlidersHorizontal aria-hidden="true" size={18} />
                  </div>
                  <textarea
                    ref={sourceTextareaRef}
                    className="markdown-source"
                    value={file.markdown}
                    readOnly
                    spellCheck={false}
                    wrap="soft"
                    aria-label="Original Markdown source"
                    onScroll={(event) => syncPreviewScroll(event.currentTarget)}
                  />
                </section>
              ) : null}

              {viewMode === 'split' ? (
                <div
                  className={`split-view-divider ${isDraggingDivider ? 'is-dragging' : ''}`}
                  onMouseDown={startDragging}
                />
              ) : null}

              {viewMode !== 'editor' ? (
                <section className="preview-pane" aria-label="Preview">
                  <div className="pane-header">
                    <span>Preview</span>
                    <div className="preview-mode-toggle" aria-label="Preview render mode">
                      <button
                        type="button"
                        aria-label="Markdown preview"
                        aria-pressed={previewMode === 'markdown'}
                        onClick={() => setPreviewMode('markdown')}
                      >
                        Markdown
                      </button>
                      <button
                        type="button"
                        aria-label="HTML preview"
                        aria-pressed={previewMode === 'html'}
                        onClick={() => setPreviewMode('html')}
                      >
                        HTML
                      </button>
                    </div>
                  </div>
                  {previewMode === 'markdown' ? (
                    <div
                      ref={previewContentRef}
                      className="preview-content"
                      onScroll={(event) => syncSourceScroll(event.currentTarget)}
                    >
                      <article className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
                    </div>
                  ) : (
                    <iframe
                      className="html-preview-frame"
                      srcDoc={html}
                      title="HTML Preview"
                      sandbox="allow-same-origin"
                    />
                  )}
                </section>
              ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {isDragging ? <div className="drop-overlay">Drop Markdown to preview</div> : null}
    </main>
  )
}

export default App
