// The WPBL tab URLs, and the three files that have to agree about them.
//
// Adding a tab means touching wpbl/routes.ts, public/_redirects, public/sitemap.xml and
// src/seo.ts. Miss the _redirects line and the new tab works perfectly in `npm run dev`
// (Vite serves the shell for every path) and 404s in production, where the file is an
// allow-list. Miss the seo.ts entry and the page silently inherits the section's generic
// title, which is the exact problem these paths were created to fix. Neither failure is
// visible locally, so they are pinned here instead.
//
// The three files are pulled in as `?raw` (Vite's own text import, declared by
// vite/client) rather than read with node:fs, so this stays a browser-target module and
// tsconfig does not have to admit @types/node into src, which would let genuinely
// browser-side code reference `process` and `__dirname` without a squeak from tsc.
import { describe, it, expect } from 'vitest'
import redirects from '../../../public/_redirects?raw'
import sitemap from '../../../public/sitemap.xml?raw'
import seoSource from '../../seo.ts?raw'
import {
  WPBL_NAV, WPBL_VIEW_PATHS, wpblPathFor, wpblViewFromPath, normalizeWpblView,
} from '../routes'

describe('wpblViewFromPath', () => {
  it('maps the section root to Home', () => {
    expect(wpblViewFromPath('/wpbl')).toBe('home')
  })

  it('maps each tab to its own view', () => {
    for (const { key } of WPBL_NAV) {
      expect(wpblViewFromPath(wpblPathFor(key))).toBe(key)
    }
  })

  it('tolerates a trailing slash, which the edge 301s but a client push can still produce', () => {
    expect(wpblViewFromPath('/wpbl/')).toBe('home')
    expect(wpblViewFromPath('/wpbl/standings/')).toBe('standings')
  })

  // Null, not 'home'. App.tsx uses this to decide whether the path belongs to the section
  // at all, so collapsing an unknown path to Home would render the WPBL tabs over the API
  // docs and turn every mistyped URL into a soft 404.
  it('returns null for a sibling route and for junk', () => {
    expect(wpblViewFromPath('/wpbl/api')).toBeNull()
    expect(wpblViewFromPath('/wpbl/nope')).toBeNull()
    expect(wpblViewFromPath('/wpbl),and')).toBeNull()
    expect(wpblViewFromPath('/mlb')).toBeNull()
    expect(wpblViewFromPath('/')).toBeNull()
  })
})

describe('legacy views', () => {
  // Tracking stopped being a tab; a link still naming it must reach Stats *on* that group
  // rather than falling back to Home.
  it('folds tracking into Stats and says so', () => {
    expect(normalizeWpblView('tracking')).toEqual({ view: 'stats', wasTracking: true })
  })

  it('falls back to Home for anything unrecognised', () => {
    expect(normalizeWpblView('nonsense')).toEqual({ view: 'home', wasTracking: false })
    expect(normalizeWpblView(undefined)).toEqual({ view: 'home', wasTracking: false })
  })
})

describe('every tab path is actually routable in production', () => {
  it('has a 200 rewrite in public/_redirects', () => {
    for (const p of WPBL_VIEW_PATHS) {
      // `/wpbl  /  200`: the shell, served under the tab's own URL.
      expect(redirects).toMatch(new RegExp(`^${p}\\s+/\\s+200\\s*$`, 'm'))
    }
  })

  it('folds its trailing-slash spelling with a 301, so there is one URL per tab', () => {
    // Home's slash rule is `/wpbl/ -> /wpbl`, which the loop below would read as the root.
    for (const p of WPBL_VIEW_PATHS) {
      expect(redirects).toMatch(new RegExp(`^${p}/\\s+${p}\\s+301\\s*$`, 'm'))
    }
  })

  // A wildcard here would re-open the soft-404 hole the file exists to close: /wpbl/anything
  // would answer 200 with the app shell, which is how `/wpbl),and` got indexed in the first
  // place. The tabs are listed one by one for that reason.
  it('does not route the section with a wildcard', () => {
    expect(redirects).not.toMatch(/^\/wpbl\/\*/m)
  })
})

describe('every tab page is discoverable and distinct', () => {
  it('is listed in the sitemap', () => {
    for (const p of WPBL_VIEW_PATHS) {
      expect(sitemap).toContain(`<loc>https://sportydolphin.fun${p}</loc>`)
    }
  })

  // The whole point of the paths. A tab with no seo.ts entry renders under the section's
  // generic title and canonical, which is indistinguishable to a search engine from not
  // having its own URL at all.
  it('has its own title and description in seo.ts', () => {
    for (const p of WPBL_VIEW_PATHS) {
      expect(seoSource).toContain(`'${p}': {`)
    }
  })

  it('gives every tab a different title', () => {
    const titles = WPBL_VIEW_PATHS.map(p => {
      const block = seoSource.slice(seoSource.indexOf(`'${p}': {`))
      return block.slice(0, block.indexOf('\n  }')).match(/title:\s*(['"`])(.*?)\1/s)?.[2]
    })
    expect(titles.every(Boolean)).toBe(true)
    expect(new Set(titles).size).toBe(titles.length)
  })
})
