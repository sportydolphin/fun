import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { textTone, contrastRatio, whiteAlphaOn, cardBgForWhite } from '../lib/contrast'
import { TEAM_BG, teamPalette, TONE, FILL } from '../constants'

// MLB's colours were picked on the dark theme. On the light one a win's green, a streak's orange
// and the section's own blue measured 1.9 to 3.8:1 as text, and the team cards' secondary white
// was 2.1:1 on the red clubs. These pin the arithmetic that fixed it and the values it produced,
// so a new colour cannot quietly reintroduce the problem.

const rgb = (c: string): [number, number, number] => {
  const h = /^#([0-9a-f]{6})$/i.exec(c)
  if (h) { const n = parseInt(h[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255] }
  const m = c.match(/[\d.]+/g)!.map(Number)
  return [m[0], m[1], m[2]]
}
const over = (fg: string, bg: string): [number, number, number] => {
  const a = Number(fg.match(/[\d.]+/g)![3] ?? 1); const f = rgb(fg), b = rgb(bg)
  return f.map((v, i) => v * a + b[i] * (1 - a)) as [number, number, number]
}
const WHITE = '#ffffff', PAGE_LIGHT = '#f6f7f9', PAPER_DARK = '#181b22', PAGE_DARK = '#0f1115'

describe('textTone', () => {
  it('brings every status colour to AA on the light page, and leaves a passing one alone', () => {
    for (const hex of ['#ef4444', '#22c55e', '#f97316', '#eab308', '#38bdf8', '#a78bfa', '#60a5fa']) {
      expect(contrastRatio(rgb(textTone(hex, false)), rgb(WHITE))).toBeGreaterThanOrEqual(4.5)
    }
    expect(textTone('#1565c0', false)).toBe('#1565c0')
    expect(textTone('#22c55e', true)).toBe('#22c55e')
  })

  it('passes a CSS variable or a theme key through untouched', () => {
    expect(textTone('var(--mlb-tone-red)', false)).toBe('var(--mlb-tone-red)')
    expect(textTone('text.secondary', true)).toBe('text.secondary')
  })
})

describe('the published tones', () => {
  const css = readFileSync('src/styles.css', 'utf8')
  const block = (sel: RegExp) => css.slice(css.search(sel))
  const read = (from: string, name: string) => new RegExp(`--mlb-tone-${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(from)?.[1]

  it('reads at 4.5:1 or better in its own theme, for every key in TONE', () => {
    const light = block(/:root \{/), dark = block(/\[data-theme="dark"\] \{/)
    for (const name of Object.keys(TONE)) {
      const l = read(light, name)!, d = read(dark, name)!
      expect(l, name).toBeTruthy()
      expect(d, name).toBeTruthy()
      for (const bg of [WHITE, PAGE_LIGHT]) expect(contrastRatio(rgb(l), rgb(bg)), `${name} light`).toBeGreaterThanOrEqual(4.5)
      for (const bg of [PAPER_DARK, PAGE_DARK]) expect(contrastRatio(rgb(d), rgb(bg)), `${name} dark`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('gives white text a fill it can be read on', () => {
    for (const c of Object.values(FILL)) expect(contrastRatio(rgb(WHITE), rgb(c))).toBeGreaterThanOrEqual(4.5)
  })
})

describe('team-coloured cards', () => {
  it('keeps every club card\'s white and secondary text at AA', () => {
    for (const id of Object.keys(TEAM_BG).map(Number)) {
      const p = teamPalette(id)
      expect(contrastRatio(rgb(WHITE), rgb(p.bg)), `${id} text`).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(over(p.sub, p.bg), rgb(p.bg)), `${id} sub`).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(over(p.rank, p.bg), rgb(p.bg)), `${id} rank`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('only deepens a club colour that white cannot already read on', () => {
    expect(cardBgForWhite('#002D62')).toBe('#002D62')
    expect(cardBgForWhite('#DF4601')).not.toBe('#DF4601')
    expect(whiteAlphaOn('#002D62', 0.62)).toBe(0.62)
  })
})
