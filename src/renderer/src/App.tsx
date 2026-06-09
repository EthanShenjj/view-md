import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent } from 'react'
import {
  Check,
  Clipboard,
  Code2,
  Columns2,
  FileText,
  FolderOpen,
  HelpCircle,
  Home,
  Lightbulb,
  MessageSquare,
  Plus,
  Loader2,
  RefreshCw,
  Search,
  Settings,
  SlidersHorizontal,
  Star,
  Trash2
} from 'lucide-react'

import { markdownToHtml } from './lib/markdown'
import type { FilePayload, MarkdownViewerApi } from '../../preload/types'

type ViewMode = 'editor' | 'preview' | 'split'
type PreviewMode = 'markdown' | 'html'
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
  const htmlRef = useRef('')

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

      const minEditorWidth = 320
      const minPreviewWidth = 360
      const maxEditorWidth = totalWidth - minPreviewWidth - 8

      if (nextWidth < minEditorWidth) {
        nextWidth = minEditorWidth
      } else if (nextWidth > maxEditorWidth) {
        nextWidth = maxEditorWidth
      }

      setEditorWidth(nextWidth)
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
      const minPreviewWidth = 360
      const minEditorWidth = 320
      const maxEditorWidth = totalWidth - minPreviewWidth - 8

      setEditorWidth((currentWidth) => {
        if (currentWidth > maxEditorWidth) {
          return Math.max(minEditorWidth, maxEditorWidth)
        }
        return currentWidth
      })
    })

    observer.observe(splitViewRef.current)
    return () => observer.disconnect()
  }, [viewMode])

  const [recentWidth, setRecentWidth] = useState(375)
  const [isRecentCollapsed, setIsRecentCollapsed] = useState(false)
  const [isDraggingRecent, setIsDraggingRecent] = useState(false)
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
      let sidebarWidth = 325
      if (totalWidth <= 820) {
        sidebarWidth = 86
      } else if (totalWidth <= 1180) {
        sidebarWidth = 280
      }

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
  }, [isDraggingRecent])

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

      let sidebarWidth = 325
      let isMobile = false
      if (totalWidth <= 820) {
        sidebarWidth = 86
        isMobile = true
      } else if (totalWidth <= 1180) {
        sidebarWidth = 280
      }

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
  }, [isRecentCollapsed])

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
      ref={appShellRef}
      className={`app-shell ${isDragging ? 'is-dragging' : ''} ${isDraggingRecent ? 'is-dragging-recent' : ''} ${isRecentCollapsed ? 'recent-collapsed' : ''}`}
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
            className="sidebar-nav-item active"
            type="button"
            onClick={() => setIsRecentCollapsed(false)}
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
          <button className="sidebar-nav-item" type="button">
            <Star aria-hidden="true" size={19} />
            <span>Favorites</span>
          </button>
          <button className="sidebar-nav-item" type="button">
            <Trash2 aria-hidden="true" size={18} />
            <span>Trash</span>
          </button>
          <button className="sidebar-nav-item" type="button">
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
            <span>Recent documents</span>
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
                filteredRecentFiles.map((recentFile) => {
                  return (
                    <div className="recent-list-row" key={recentFile.path}>
                      <button
                        className={`recent-file ${file?.path === recentFile.path ? 'active' : ''}`}
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
            <button className="secondary-button" type="button" onClick={copyHtml} disabled={!file}>
              <Code2 aria-hidden="true" size={17} />
              <span>Export</span>
            </button>
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
                    className="markdown-source"
                    value={file.markdown}
                    readOnly
                    spellCheck={false}
                    wrap="soft"
                    aria-label="Original Markdown source"
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
                    <div className="preview-content">
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
          ) : null}
        </div>
      </section>

      {isDragging ? <div className="drop-overlay">Drop Markdown to preview</div> : null}
    </main>
  )
}

export default App
