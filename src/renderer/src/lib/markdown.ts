import DOMPurify from 'dompurify'
import hljs from 'highlight.js'
import { marked } from 'marked'
import { markedHighlight } from 'marked-highlight'

let parserReady = false

function configureParser(): void {
  if (parserReady) {
    return
  }

  marked.use(
    markedHighlight({
      emptyLangClass: 'hljs',
      langPrefix: 'hljs language-',
      highlight(code, lang) {
        const language = lang && hljs.getLanguage(lang) ? lang : 'plaintext'
        return hljs.highlight(code, { language }).value
      }
    })
  )

  marked.setOptions({
    async: false,
    breaks: false,
    gfm: true
  })

  parserReady = true
}

type MarkdownToHtmlOptions = {
  basePath?: string
}

function isRelativeAsset(src: string): boolean {
  return (
    src.length > 0 &&
    !src.startsWith('/') &&
    !src.startsWith('#') &&
    !src.startsWith('data:') &&
    !/^[a-z][a-z\d+.-]*:/i.test(src)
  )
}

function toFileUrl(filePath: string): string {
  const normalized = filePath.replaceAll('\\', '/')
  const prefixed = normalized.startsWith('/') ? normalized : `/${normalized}`
  return `file://${prefixed.split('/').map(encodeURIComponent).join('/')}`
}

function dirname(filePath: string): string {
  const normalized = filePath.replaceAll('\\', '/')
  const lastSlash = normalized.lastIndexOf('/')
  return lastSlash > 0 ? normalized.slice(0, lastSlash) : normalized
}

function resolveRelativeImages(html: string, basePath?: string): string {
  if (!basePath || typeof document === 'undefined') {
    return html
  }

  const template = document.createElement('template')
  template.innerHTML = html
  const baseUrl = `${toFileUrl(dirname(basePath))}/`

  template.content.querySelectorAll('img[src]').forEach((image) => {
    const src = image.getAttribute('src')

    if (src && isRelativeAsset(src)) {
      image.setAttribute('src', new URL(src, baseUrl).href)
    }
  })

  return template.innerHTML
}

export function markdownToHtml(markdown: string, options: MarkdownToHtmlOptions = {}): string {
  configureParser()

  const rawHtml = marked.parse(markdown) as string

  const safeHtml = DOMPurify.sanitize(rawHtml, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target', 'rel']
  })

  return resolveRelativeImages(safeHtml, options.basePath)
}
