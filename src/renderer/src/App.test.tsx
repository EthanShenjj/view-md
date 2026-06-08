import { render, screen } from '@testing-library/react'
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

  it('opens a Markdown file and switches to HTML preview', async () => {
    const user = userEvent.setup()
    const api = createApi()

    render(<App api={api} />)

    await user.click(screen.getByRole('button', { name: /open markdown/i }))
    expect(await screen.findByRole('heading', { name: 'Hello' })).toBeInTheDocument()
    expect(screen.getByLabelText(/original markdown source/i)).toHaveValue('# Hello\n\nWorld')

    await user.click(screen.getByRole('button', { name: /html preview/i }))
    expect(screen.getByTitle(/generated html preview/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/generated html source/i)).not.toBeInTheDocument()
  })

  it('stores recent files and reopens them from the sidebar', async () => {
    const user = userEvent.setup()
    const api = createApi()

    render(<App api={api} />)

    await user.click(screen.getByRole('button', { name: /open markdown/i }))
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
