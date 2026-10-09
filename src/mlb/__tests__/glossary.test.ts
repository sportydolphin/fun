import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import seoSource from '../../seo.ts?raw'
import footerSource from '../../SiteFooter.tsx?raw'
import { MLB_RULES, MLB_GLOSSARY_GROUPS, mlbGlossaryTerm } from '../statGlossary'
import { MLB_QUALIFY_PA_PER_GAME, MLB_QUALIFY_IP_PER_GAME } from '../qualify'
import { MLB_GLOSSARY_PAGE, MLB_MORE_PAGES, isMlbGlossaryPage, isMlbPath, isMlbSection, MLB_STATIC_PATHS } from '../routes'

// /mlb/glossary, WPBL's rules page for this section. The same failures are worth pinning: prose
// that states a rule the boards do not apply, and a page nothing links to.

describe('the rules the page quotes', () => {
  it('states the qualifying bar the boards apply', () => {
    const r = MLB_RULES.find(x => x.id === 'qualifying')!
    expect(r.answer).toContain(`${MLB_QUALIFY_PA_PER_GAME} plate appearances per team game`)
    expect(r.answer).toContain(`${MLB_QUALIFY_IP_PER_GAME} inning per team game`)
    expect(r.answer).toContain('about 502 and 162')
  })

  // The bar used to be a literal in four files. One copy left behind is a board that disagrees
  // with the sentence above it.
  it('leaves no literal 3.1 qualifier anywhere in the section', () => {
    const files: string[] = []
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f)
        if (statSync(p).isDirectory()) { if (f !== '__tests__') walk(p) }
        else if (/\.tsx?$/.test(f)) files.push(p)
      }
    }
    walk(join(process.cwd(), 'src/mlb'))
    const offenders = files.filter(p => /\*\s*3\.1\b/.test(readFileSync(p, 'utf8')))
    expect(offenders).toEqual([])
  })

  it('has unique, stable ids, because a link points at one', () => {
    expect(new Set(MLB_RULES.map(r => r.id)).size).toBe(MLB_RULES.length)
    for (const r of MLB_RULES) expect(r.id).toMatch(/^[a-z0-9-]+$/)
  })

  it('writes no em dash', () => {
    for (const r of MLB_RULES) expect(`${r.question} ${r.answer}`).not.toContain('—')
  })
})

describe('the abbreviation lists', () => {
  // The page filters out a key with no definition, so a typo in a group would drop a term in
  // silence rather than draw a blank row.
  it('lists only terms that have a definition', () => {
    for (const g of MLB_GLOSSARY_GROUPS) {
      for (const k of g.keys) expect(mlbGlossaryTerm(k), `${g.key}: ${k}`).not.toBeNull()
    }
  })

  it('explains the advanced numbers in plain words, not just letters', () => {
    for (const k of ['OPS', 'WHIP', 'WAR', 'wRC+', 'FIP', 'ERA-', 'xwOBA', 'IP']) {
      expect(mlbGlossaryTerm(k)?.plain, k).toBeTruthy()
    }
  })
})

describe('/mlb/glossary as a page', () => {
  it('is recognised as an MLB page the section itself does not render', () => {
    expect(isMlbGlossaryPage(MLB_GLOSSARY_PAGE)).toBe(true)
    expect(isMlbGlossaryPage(`${MLB_GLOSSARY_PAGE}/`)).toBe(true)
    expect(isMlbGlossaryPage('/mlb/glossary/extra')).toBe(false)
    expect(isMlbPath(MLB_GLOSSARY_PAGE)).toBe(false)
    expect(isMlbSection(MLB_GLOSSARY_PAGE)).toBe(true)
  })

  // MLB_STATIC_PATHS is what routes.test.ts holds to _redirects and the sitemap.
  it('is one of the pages pinned to the redirects and the sitemap', () => {
    expect(MLB_STATIC_PATHS).toContain(MLB_GLOSSARY_PAGE)
  })

  it('has its own title and FAQ markup built from the rules themselves', () => {
    expect(seoSource).toContain('[MLB_GLOSSARY_PAGE]: {')
    expect(seoSource).toContain('MLB_RULES.map')
  })

  // The toolbar's More menu is not in the DOM until opened; the footer is the crawlable link.
  it('is linked from the footer and the More menu', () => {
    expect(MLB_MORE_PAGES.map(p => p.href)).toContain(MLB_GLOSSARY_PAGE)
    expect(footerSource).toContain('MLB_MORE_PAGES')
  })
})
