import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import App from './App'
import type { MarkdownViewerApi } from '../../preload/types'

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

    await user.click(screen.getByRole('button', { name: /readme.md/i }))

    expect(api.loadMarkdownPath).toHaveBeenCalledWith('/tmp/readme.md')
    expect(await screen.findByRole('heading', { name: 'Reopened' })).toBeInTheDocument()
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
