import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import App, { getAdaptiveEditorWidth } from './App'
import type { FilePayload, MarkdownViewerApi } from '../../preload/types'

function createApi(): MarkdownViewerApi {
  return {
    openMarkdownFile: vi.fn(async () => ({
      path: '/tmp/readme.md',
      name: 'readme.md',
      markdown: '# Hello\n\nWorld',
      mtimeMs: 1710000000000
    })),
    loadMarkdownPath: vi.fn(async () => ({
      path: '/tmp/readme.md',
      name: 'readme.md',
      markdown: '# Reopened\n\nFrom recent',
      mtimeMs: 1710000001000
    })),
    copyHtml: vi.fn(),
    exportHtml: vi.fn(async () => '/tmp/readme.html'),
    exportPdf: vi.fn(async () => '/tmp/readme.pdf'),
    getPathForFile: vi.fn(() => '/tmp/readme.md'),
    onFileChanged: vi.fn(() => () => undefined),
    onOpenFile: vi.fn(() => () => undefined),
    onViewCommand: vi.fn(() => () => undefined)
  }
}

describe('App', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('opens a Markdown file and switches to preview-only mode', async () => {
    const user = userEvent.setup()
    const api = createApi()

    render(<App api={api} />)

    await user.click(screen.getByRole('button', { name: /new document/i }))
    expect(await screen.findByRole('heading', { name: 'Hello' })).toBeInTheDocument()
    expect(screen.getByLabelText(/original markdown source/i)).toHaveValue('# Hello\n\nWorld')

    await user.click(
      within(screen.getByLabelText(/document view/i)).getByRole('button', { name: /^preview$/i })
    )
    expect(screen.getByRole('heading', { name: 'Hello' })).toBeInTheDocument()
    expect(screen.queryByLabelText(/original markdown source/i)).not.toBeInTheDocument()
  })

  it('switches between Markdown and HTML preview inside preview mode', async () => {
    const user = userEvent.setup()
    const api = createApi()

    render(<App api={api} />)

    await user.click(screen.getByRole('button', { name: /new document/i }))
    await screen.findByRole('heading', { name: 'Hello' })

    const documentView = screen.getByLabelText(/document view/i)
    expect(within(documentView).queryByRole('button', { name: /^html$/i })).not.toBeInTheDocument()

    await user.click(within(documentView).getByRole('button', { name: /^preview$/i }))

    const preview = screen.getByRole('region', { name: /^preview$/i })
    expect(within(preview).getByRole('button', { name: /markdown preview/i })).toHaveAttribute(
      'aria-pressed',
      'true'
    )

    await user.click(within(preview).getByRole('button', { name: /html preview/i }))

    expect(within(preview).getByRole('button', { name: /html preview/i })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(screen.getByTitle('HTML Preview')).toBeInTheDocument()
    expect(within(preview).queryByRole('heading', { name: 'Hello' })).not.toBeInTheDocument()
  })

  it('stores recent files and reopens them from the sidebar', async () => {
    const user = userEvent.setup()
    const api = createApi()

    render(<App api={api} />)

    await user.click(screen.getByRole('button', { name: /new document/i }))
    await screen.findByRole('heading', { name: 'Hello' })

    await user.click(screen.getByRole('button', { name: /^readme.md/i }))

    expect(api.loadMarkdownPath).toHaveBeenCalledWith('/tmp/readme.md')
    expect(await screen.findByRole('heading', { name: 'Reopened' })).toBeInTheDocument()
  })

  it('filters recent files from the search box', async () => {
    localStorage.setItem('view-md:recent-files', JSON.stringify([
      { path: '/tmp/readme.md', name: 'readme.md', mtimeMs: 1710000000000, openedAt: 2 },
      { path: '/tmp/notes.md', name: 'notes.md', mtimeMs: 1710000000001, openedAt: 1 }
    ]))
    const user = userEvent.setup()

    render(<App api={createApi()} />)

    await user.type(screen.getByPlaceholderText(/search files/i), 'notes')

    expect(screen.getByRole('button', { name: /^notes.md/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^readme.md/i })).not.toBeInTheDocument()
  })

  it('favorites, trashes, and restores recent files', async () => {
    const user = userEvent.setup()

    render(<App api={createApi()} />)

    await user.click(screen.getByRole('button', { name: /new document/i }))
    await screen.findByRole('heading', { name: 'Hello' })

    await user.click(screen.getByRole('button', { name: /add favorite readme.md/i }))
    await user.click(screen.getByRole('button', { name: /^favorites$/i }))
    expect(screen.getByRole('button', { name: /^readme.md/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /move readme.md to trash/i }))
    await user.click(screen.getByRole('button', { name: /^trash$/i }))
    expect(screen.getByRole('button', { name: /restore readme.md/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /restore readme.md/i }))
    expect(screen.queryByRole('button', { name: /^readme.md/i })).not.toBeInTheDocument()
  })

  it('prompts before applying file changes and exports HTML/PDF', async () => {
    const user = userEvent.setup()
    const api = createApi()
    let fileChanged: ((payload: FilePayload) => void) | null = null
    api.onFileChanged = vi.fn((callback) => {
      fileChanged = callback
      return () => undefined
    })

    render(<App api={api} />)

    await user.click(screen.getByRole('button', { name: /new document/i }))
    await screen.findByRole('heading', { name: 'Hello' })

    const exportActions = screen.getByLabelText(/export document/i)
    await user.click(within(exportActions).getByRole('button', { name: /^html$/i }))
    expect(api.exportHtml).toHaveBeenCalled()
    await user.click(within(exportActions).getByRole('button', { name: /^pdf$/i }))
    expect(api.exportPdf).toHaveBeenCalled()

    act(() => {
      fileChanged?.({
        path: '/tmp/readme.md',
        name: 'readme.md',
        markdown: '# Changed',
        mtimeMs: 1710000002000
      })
    })

    expect(screen.getByText(/changed on disk/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^refresh$/i }))
    expect(await screen.findByRole('heading', { name: 'Changed' })).toBeInTheDocument()
  })

  it('collapses and expands the workspace sidebar from the sidebar button', async () => {
    const user = userEvent.setup()
    const api = createApi()

    const { container } = render(<App api={api} />)

    const appShell = container.querySelector('.app-shell')
    expect(appShell).not.toHaveClass('sidebar-collapsed')

    await user.click(screen.getByRole('button', { name: /collapse sidebar/i }))
    expect(appShell).toHaveClass('sidebar-collapsed')

    await user.click(screen.getByRole('button', { name: /expand sidebar/i }))
    expect(appShell).not.toHaveClass('sidebar-collapsed')
  })

  it('falls back to browser file reading when the desktop bridge is missing', async () => {
    const user = userEvent.setup()
    const file = new File(['# Browser file'], 'browser.md', { type: 'text/markdown' })

    render(<App />)

    await user.upload(document.querySelector('input[type="file"]')!, file)

    expect(await screen.findByRole('heading', { name: 'Browser file' })).toBeInTheDocument()
    expect(screen.getByLabelText(/original markdown source/i)).toHaveValue('# Browser file')
  })
})

describe('getAdaptiveEditorWidth', () => {
  it('keeps the preview pane readable when the preferred editor width is too wide', () => {
    expect(getAdaptiveEditorWidth(1176, 960)).toBe(724)
  })

  it('keeps the editor pane usable when the preferred editor width is too narrow', () => {
    expect(getAdaptiveEditorWidth(1176, 120)).toBe(300)
  })
})
