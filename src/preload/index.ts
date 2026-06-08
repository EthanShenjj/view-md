import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { FilePayload, MarkdownViewerApi } from './types.js'

const api: MarkdownViewerApi = {
  openMarkdownFile: () => ipcRenderer.invoke('markdown:open-file'),
  loadMarkdownPath: (path: string) => ipcRenderer.invoke('markdown:load-path', path),
  copyHtml: (html: string) => ipcRenderer.invoke('markdown:copy-html', html),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  onFileChanged: (callback: (payload: FilePayload) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: FilePayload) => callback(payload)
    ipcRenderer.on('markdown:file-changed', listener)

    return () => {
      ipcRenderer.removeListener('markdown:file-changed', listener)
    }
  },
  onOpenFile: (callback: (payload: FilePayload) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: FilePayload) => callback(payload)
    ipcRenderer.on('markdown:file-opened', listener)

    return () => {
      ipcRenderer.removeListener('markdown:file-opened', listener)
    }
  },
  onViewCommand: (callback: (command: 'toggle-view' | 'copy-html') => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      command: 'toggle-view' | 'copy-html'
    ) => callback(command)
    ipcRenderer.on('markdown:view-command', listener)

    return () => {
      ipcRenderer.removeListener('markdown:view-command', listener)
    }
  }
}

contextBridge.exposeInMainWorld('markdownViewer', api)
