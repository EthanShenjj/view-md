import { describe, expect, it } from 'vitest'

import { markdownToHtml } from './markdown'

describe('markdownToHtml', () => {
  it('renders common GitHub-style Markdown', () => {
    const html = markdownToHtml(`# Title

| Name | Value |
| --- | --- |
| One | Two |

\`\`\`ts
const answer = 42
\`\`\`

[OpenAI](https://openai.com)
`)

    expect(html).toContain('<h1>Title</h1>')
    expect(html).toContain('<table>')
    expect(html).toContain('<code class="hljs language-ts">')
    expect(html).toContain('<a href="https://openai.com">OpenAI</a>')
  })

  it('removes unsafe HTML', () => {
    const html = markdownToHtml('<img src=x onerror="alert(1)"><script>alert(2)</script>')

    expect(html).toContain('<img src="x">')
    expect(html).not.toContain('onerror')
    expect(html).not.toContain('<script>')
  })
})
