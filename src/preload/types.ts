export type FilePayload = {
  path: string
  name: string
  markdown: string
  mtimeMs: number
}

export type MarkdownViewerApi = {
  openMarkdownFile: () => Promise<FilePayload | null>
  loadMarkdownPath: (path: string) => Promise<FilePayload>
  copyHtml: (html: string) => Promise<void>
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
