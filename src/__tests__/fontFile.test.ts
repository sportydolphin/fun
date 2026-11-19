// The font is cached `immutable` for a year (public/_headers), so a changed file ships under a new
// name (scripts/subset-inter.mjs): the Nov 18, 2026 trim went out under the old one and Cloudflare
// went on serving the old file. These keep the three places that name it in step. A preload that
// names another file is wasted and the page downloads the font twice.
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'

const html = readFileSync('index.html', 'utf8')
const css = readFileSync('src/styles.css', 'utf8')
const script = readFileSync('scripts/subset-inter.mjs', 'utf8')

describe('the self-hosted font', () => {
  const preload = html.match(/<link rel="preload" href="(\/fonts\/[^"]+\.woff2)"/)?.[1]

  it('is preloaded under the name the stylesheet uses', () => {
    expect(preload).toBeTruthy()
    expect(css).toContain(`url('${preload}')`)
  })

  it('exists, and is the file the subset script writes', () => {
    expect(existsSync(`public${preload}`)).toBe(true)
    expect(script).toContain(`'public${preload}'`)
  })
})
