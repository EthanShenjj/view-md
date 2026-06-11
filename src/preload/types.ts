export type FilePayload = {
  path: string
  name: string
  markdown: string
  mtimeMs: number
}

export type ExportPayload = {
  name: string
  html: string
}

export type MarkdownViewerApi = {
  openMarkdownFile: () => Promise<FilePayload | null>
  loadMarkdownPath: (path: string) => Promise<FilePayload>
  copyHtml: (html: string) => Promise<void>
  exportHtml: (payload: ExportPayload) => Promise<string | null>
  exportPdf: (payload: ExportPayload) => Promise<string | null>
  getPathForFile: (file: File) => string
  onFileChanged: (callback: (payload: FilePayload) => void) => () => void
  onOpenFile: (callback: (payload: FilePayload) => void) => () => void
  onViewCommand: (callback: (command: 'toggle-view' | 'copy-html') => void) => () => void
}

declare global {
  interface Window {
    markdownViewer: MarkdownViewerApi
  }
}
