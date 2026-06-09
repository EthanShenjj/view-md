import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const css = readFileSync('src/renderer/src/styles.css', 'utf8')

function mediaBlock(maxWidth: number): string {
  const marker = `@media (max-width: ${maxWidth}px) {`
  const start = css.indexOf(marker)
  if (start === -1) {
    return ''
  }

  let depth = 0
  for (let index = start; index < css.length; index += 1) {
    const char = css[index]
    if (char === '{') {
      depth += 1
    } else if (char === '}') {
      depth -= 1
      if (depth === 0) {
        return css.slice(start, index + 1)
      }
    }
  }

  return ''
}

describe('responsive CSS', () => {
  it('uses a single-column mobile layout without fixed horizontal overflow', () => {
    const mobileCss = mediaBlock(640)

    expect(mobileCss).toContain('grid-template-columns: minmax(0, 1fr);')
    expect(mobileCss).toContain('grid-template-rows: auto minmax(0, 1fr);')
    expect(mobileCss).toContain('min-width: 0;')
    expect(mobileCss).toContain('flex-wrap: wrap;')
    expect(mobileCss).not.toMatch(/min-width:\s*[4-9]\d{2}px/)
  })
})
