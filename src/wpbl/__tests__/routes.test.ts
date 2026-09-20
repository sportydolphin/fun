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
import indexHtml from '../../../index.html?raw'
import redirects from '../../../public/_redirects?raw'
import footerSource from '../../SiteFooter.tsx?raw'
// The section shell, read as source: the "More" menu is the reader-facing discovery path for the
// pages that have no nav pill, and dropping one from it fails invisibly (the page still works and
// the footer still links it).
import wpblAppSource from '../WpblApp.tsx?raw'
// The Terms page's pointer at /wpbl/sources, read as source: the provenance page is only
// reachable from the pages that promise it exists.
import legalSource from '../../LegalPages.tsx?raw'
import sitemap from '../../../public/sitemap.xml?raw'
import playersIndexSource from '../PlayersIndex.tsx?raw'
import seoSource from '../../seo.ts?raw'
import fanVoteSource from '../FanVote.tsx?raw'
import homeSource from '../Home.tsx?raw'
import robots from '../../../public/robots.txt?raw'
import {
  WPBL_NAV, WPBL_VIEW_PATHS, wpblPathFor, wpblViewFromPath, wpblAppOwnsPath, normalizeWpblView,
  wpblPlayerSlug, wpblPlayerPath, wpblPlayerSlugFromPath, findWpblPlayerBySlug,
  wpblGameSlug, wpblGamePath, wpblGameSlugFromPath, findWpblGameBySlug, isWpblLeaguePage,
  isWpblGlossaryPage,
  isWpblSourcesPage,
  isWpblSeasonPage,
  isWpblScorigamiPage,
  wpblTeamPath, wpblTeamSlugFromPath, findWpblTeamBySlug, teamSlug,
  WPBL_AWARDS_PATH, isWpblAwardsPage,
  WPBL_COMPARE_BASE, wpblComparePath, wpblCompareCanonicalPath, isCanonicalComparePath,
  wpblCompareStartPath, wpblCompareSlugFromPath,
  findWpblComparePair, isWpblComparePage, isWpblComparePicker,
  wpblShortCode, wpblPlayerShortPath, wpblGameShortPath,
  wpblShortPlayerCodeFromPath, wpblShortGameCodeFromPath, findByShortCode,
  WPBL_SHORT_PLAYER_BASE, WPBL_SHORT_GAME_BASE,
} from '../routes'
// The Functions allow-list, imported as data: a short-link function that is not routed here
// compiles, deploys, and is never called (the documented _routes.json trap).
import routesJson from '../../../public/_routes.json'
// The real club list, so the four files below are pinned against what the app actually ships
// rather than against four strings copied into this test. A fifth club fails every assertion
// in the block until its line, its tags and its sitemap entry exist.
import { WPBL_TEAMS } from '../constants'

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

  // Cloudflare validates the whole file at UPLOAD time and rejects it outright for a status
  // it does not allow: "Valid status codes are 200, 301, 302, 303, 307, or 308". That fails
  // the build, and a failed build leaves the previous deploy serving, so the site does not
  // break in any visible way. It just quietly stops updating, which is the worst shape a
  // failure can have. A `/*  /404.html  404` rule does exactly this.
  //
  // Note that `npx wrangler pages dev dist` accepts a file the real deploy refuses, so
  // local testing does not catch it and this is the only thing standing in the way.
  it('uses only status codes Cloudflare will accept', () => {
    const allowed = new Set(['200', '301', '302', '303', '307', '308'])
    const rules = redirects
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'))
    expect(rules.length).toBeGreaterThan(0)
    for (const rule of rules) {
      const parts = rule.split(/\s+/)
      // `from to [status]`: the status is optional and defaults to 302.
      if (parts.length < 3) continue
      expect(allowed, `"${rule}" has an undeployable status`).toContain(parts[2])
    }
  })
})

describe('player slugs', () => {
  const roster = [
    { id: 'aaaaaaaa-1111-4111-8111-111111111111', name: 'Denae Benites' },
    { id: 'bbbbbbbb-2222-4222-8222-222222222222', name: "Claire O'Sullivan" },
    { id: 'cccccccc-3333-4333-8333-333333333333', name: 'Samaria Benítez' },
  ]

  it('is the name, lowercased and punctuation-free', () => {
    expect(wpblPlayerSlug(roster[0], roster)).toBe('denae-benites')
    expect(wpblPlayerSlug(roster[1], roster)).toBe('claire-o-sullivan')
  })

  // The roster has five accented names. If these did not fold, their pages would sit at
  // percent-encoded URLs that nobody would ever link to or type.
  it('folds accents rather than escaping them', () => {
    expect(wpblPlayerSlug(roster[2], roster)).toBe('samaria-benitez')
  })

  it('round-trips through the path', () => {
    const path = wpblPlayerPath(roster[0], roster)
    expect(path).toBe('/wpbl/players/denae-benites')
    expect(findWpblPlayerBySlug(wpblPlayerSlugFromPath(path)!, roster)).toEqual(roster[0])
  })

  it('is not fooled by neighbouring routes', () => {
    expect(wpblPlayerSlugFromPath('/wpbl/players')).toBeNull()   // the index, not a player
    expect(wpblPlayerSlugFromPath('/wpbl/stats')).toBeNull()
    expect(wpblPlayerSlugFromPath('/wpbl/players/a/b')).toBeNull()
  })

  it('resolves nobody for a slug that names nobody', () => {
    expect(findWpblPlayerBySlug('not-a-player', roster)).toBeNull()
  })

  // No two players share a name today, so this is the case with no live example and
  // therefore the one most likely to be got wrong. Both players must end up reachable, at
  // DIFFERENT URLs, and the bare name must resolve to neither rather than picking one.
  describe('when two players share a name', () => {
    const twins = [
      { id: 'dddddddd-4444-4444-8444-444444444444', name: 'Maria Garcia' },
      { id: 'eeeeeeee-5555-4555-8555-555555555555', name: 'Maria Garcia' },
      ...roster,
    ]

    it('gives each a distinct, stable URL', () => {
      const a = wpblPlayerSlug(twins[0], twins)
      const b = wpblPlayerSlug(twins[1], twins)
      expect(a).not.toBe(b)
      expect(a).toBe('maria-garcia-dddddddd')
      expect(b).toBe('maria-garcia-eeeeeeee')
    })

    it('keeps both reachable', () => {
      expect(findWpblPlayerBySlug(wpblPlayerSlug(twins[0], twins), twins)).toEqual(twins[0])
      expect(findWpblPlayerBySlug(wpblPlayerSlug(twins[1], twins), twins)).toEqual(twins[1])
    })

    it('refuses the ambiguous bare name instead of guessing', () => {
      expect(findWpblPlayerBySlug('maria-garcia', twins)).toBeNull()
    })

    it('leaves everyone else alone', () => {
      expect(wpblPlayerSlug(roster[0], twins)).toBe('denae-benites')
    })
  })
})

describe('game slugs', () => {
  const teams = [
    { id: 'BOS', name: 'Hunters' },
    { id: 'LA', name: 'Queens' },
    { id: 'NY', name: 'Heights' },
    { id: 'SF', name: 'Firebells' },
  ]
  const schedule = [
    { id: 'aaaaaaaa-1111-4111-8111-111111111111', game_date: '2026-08-23', home_team_id: 'BOS', away_team_id: 'LA' },
    { id: 'bbbbbbbb-2222-4222-8222-222222222222', game_date: '2026-08-22', home_team_id: 'LA', away_team_id: 'NY' },
    { id: 'cccccccc-3333-4333-8333-333333333333', game_date: '2026-08-22', home_team_id: 'BOS', away_team_id: 'SF' },
  ]

  it('is the date and the matchup, away side first', () => {
    expect(wpblGameSlug(schedule[0], teams, schedule)).toBe('2026-08-23-queens-at-hunters')
  })

  // Two games on one day is ordinary here: the league plays four clubs, so a game day is
  // usually two games. They must not collide, and the pairing is what separates them.
  it('separates two games played on the same day', () => {
    expect(wpblGameSlug(schedule[1], teams, schedule)).toBe('2026-08-22-heights-at-queens')
    expect(wpblGameSlug(schedule[2], teams, schedule)).toBe('2026-08-22-firebells-at-hunters')
  })

  it('round-trips through the path', () => {
    const path = wpblGamePath(schedule[0], teams, schedule)
    expect(path).toBe('/wpbl/games/2026-08-23-queens-at-hunters')
    expect(findWpblGameBySlug(wpblGameSlugFromPath(path)!, schedule, teams)).toEqual(schedule[0])
  })

  it('is not fooled by neighbouring routes', () => {
    expect(wpblGameSlugFromPath('/wpbl/games')).toBeNull()   // no index lives there
    expect(wpblGameSlugFromPath('/wpbl/schedule')).toBeNull()
    expect(wpblGameSlugFromPath('/wpbl/players/denae-benites')).toBeNull()
    expect(wpblGameSlugFromPath('/wpbl/games/a/b')).toBeNull()
  })

  it('resolves nothing for a slug that names no game', () => {
    expect(findWpblGameBySlug('2026-08-23-queens-at-queens', schedule, teams)).toBeNull()
  })

  // A club missing from `teams` must still produce a whole, stable slug rather than a hole
  // in the middle of one. The id IS the abbreviation, so it is a reasonable stand-in.
  it('falls back to the club id when a team is missing', () => {
    expect(wpblGameSlug(schedule[0], [], schedule)).toBe('2026-08-23-la-at-bos')
  })

  // The league has never played a doubleheader, which makes this the case with no live
  // example and so the one most likely to be got wrong. Same rule as a shared player name.
  describe('when two games share a date and a matchup', () => {
    const twinBill = [
      { id: 'dddddddd-4444-4444-8444-444444444444', game_date: '2026-09-01', home_team_id: 'BOS', away_team_id: 'LA' },
      { id: 'eeeeeeee-5555-4555-8555-555555555555', game_date: '2026-09-01', home_team_id: 'BOS', away_team_id: 'LA' },
      ...schedule,
    ]

    it('gives each a distinct, stable URL', () => {
      expect(wpblGameSlug(twinBill[0], teams, twinBill)).toBe('2026-09-01-queens-at-hunters-dddddddd')
      expect(wpblGameSlug(twinBill[1], teams, twinBill)).toBe('2026-09-01-queens-at-hunters-eeeeeeee')
    })

    it('keeps both reachable', () => {
      expect(findWpblGameBySlug(wpblGameSlug(twinBill[0], teams, twinBill), twinBill, teams)).toEqual(twinBill[0])
      expect(findWpblGameBySlug(wpblGameSlug(twinBill[1], teams, twinBill), twinBill, teams)).toEqual(twinBill[1])
    })

    it('refuses the ambiguous bare slug instead of serving the wrong final score', () => {
      expect(findWpblGameBySlug('2026-09-01-queens-at-hunters', twinBill, teams)).toBeNull()
    })

    it('leaves every other game alone', () => {
      expect(wpblGameSlug(schedule[0], teams, twinBill)).toBe('2026-08-23-queens-at-hunters')
    })
  })

  // The subtree needs a wildcard because the valid slugs are the schedule, which lives in
  // the database. What keeps that from being a soft-404 hole is functions/wpbl, which
  // resolves the slug and 404s anything naming no game before the rewrite is reached.
  it('is routed in production, and only as a wildcard', () => {
    expect(redirects).toMatch(/^\/wpbl\/games\/\*\s+\/\s+200\s*$/m)
    // No bare /wpbl/games rule: there is no index there, so it must fall through to a 404.
    expect(redirects).not.toMatch(/^\/wpbl\/games\s+\//m)
  })

  it('is a route the section claims for itself', () => {
    expect(wpblAppOwnsPath('/wpbl/games/2026-08-23-queens-at-hunters')).toBe(true)
    expect(wpblAppOwnsPath('/wpbl/games')).toBe(false)
    expect(wpblAppOwnsPath('/wpbl/games/a/b')).toBe(false)
  })
})

// ─── Comparison pages ─────────────────────────────────────────────────────────

describe('comparison pages', () => {
  const roster = [
    { id: 'p1', name: 'Denae Benites' },
    { id: 'p2', name: 'Molly Paddison' },
    { id: 'p3', name: 'Ayami Sato' },
    // Two players sharing a name, so the id-suffixed slug has to survive being half of a pair.
    { id: 'aaaaaaaa-1', name: 'Sam Rivers' },
    { id: 'bbbbbbbb-2', name: 'Sam Rivers' },
  ]

  it('puts the pair in the path in the order it was built, left then right', () => {
    const forwards = wpblComparePath(roster[0], roster[1], roster)
    const backwards = wpblComparePath(roster[1], roster[0], roster)
    expect(forwards).toBe('/wpbl/compare/denae-benites-vs-molly-paddison')
    // ORDER IS THE READER'S. The player they started from stays on the left, so the two
    // spellings are deliberately different URLs, and the near-duplicate that makes is handled
    // by the canonical below, not by refusing to serve one of them.
    expect(backwards).toBe('/wpbl/compare/molly-paddison-vs-denae-benites')
    expect(backwards).not.toBe(forwards)
  })

  it('consolidates both orders onto one alphabetical canonical', () => {
    const canonical = wpblCompareCanonicalPath(roster[0], roster[1], roster)
    expect(canonical).toBe('/wpbl/compare/denae-benites-vs-molly-paddison')
    // Alphabetical whichever way round it is asked for: this is the rel=canonical both spellings
    // declare, so a search engine treats them as the same page.
    expect(wpblCompareCanonicalPath(roster[1], roster[0], roster)).toBe(canonical)
    expect(isCanonicalComparePath('/wpbl/compare/denae-benites-vs-molly-paddison', roster)).toBe(true)
    expect(isCanonicalComparePath('/wpbl/compare/molly-paddison-vs-denae-benites', roster)).toBe(false)
  })

  it('round-trips through the path', () => {
    const path = wpblComparePath(roster[0], roster[2], roster)
    const slug = wpblCompareSlugFromPath(path)
    expect(slug).not.toBeNull()
    const pair = findWpblComparePair(slug!, roster)
    expect(pair?.map(p => p.id).sort()).toEqual(['p1', 'p3'])
  })

  it('carries the id suffix through when a name is shared', () => {
    const path = wpblComparePath(roster[3], roster[0], roster)
    expect(path).toContain('sam-rivers-aaaaaaaa')
    const pair = findWpblComparePair(wpblCompareSlugFromPath(path)!, roster)
    expect(pair?.map(p => p.id).sort()).toEqual(['aaaaaaaa-1', 'p1'])
  })

  it('resolves nobody for a pair naming nobody', () => {
    expect(findWpblComparePair('nobody-vs-nobody-else', roster)).toBeNull()
    expect(findWpblComparePair('denae-benites-vs-nobody', roster)).toBeNull()
  })

  // A page of two identical columns, at a second URL for every player on the roster.
  it('refuses a player compared with herself', () => {
    expect(findWpblComparePair('denae-benites-vs-denae-benites', roster)).toBeNull()
  })

  // The bare name is ambiguous by the slug rules, so neither half resolves and the pair
  // cannot either. Serving one of the two Sam Rivers here is the guess routes.ts refuses.
  it('refuses an ambiguous half', () => {
    expect(findWpblComparePair('sam-rivers-vs-denae-benites', roster)).toBeNull()
  })

  it('is not fooled by neighbouring routes', () => {
    expect(wpblCompareSlugFromPath('/wpbl/compare')).toBeNull()
    expect(wpblCompareSlugFromPath('/wpbl/players/denae-benites')).toBeNull()
    // One segment only. Cloudflare's `*` matches across slashes, so this is what stops
    // /wpbl/compare/a/b becoming an indexable page.
    expect(wpblCompareSlugFromPath('/wpbl/compare/a/b')).toBeNull()
  })

  it('renders the picker for one slug, so "compare her with somebody" is a real URL', () => {
    const path = wpblCompareStartPath(roster[0], roster)
    expect(path).toBe('/wpbl/compare/denae-benites')
    expect(isWpblComparePage(path)).toBe(true)
    expect(findWpblComparePair(wpblCompareSlugFromPath(path)!, roster)).toBeNull()
  })

  it('claims its own paths and nothing else', () => {
    expect(isWpblComparePicker(WPBL_COMPARE_BASE)).toBe(true)
    expect(isWpblComparePicker('/wpbl/compare/')).toBe(true)
    expect(isWpblComparePage('/wpbl/compare/a-vs-b')).toBe(true)
    expect(isWpblComparePage('/wpbl/compare/a/b')).toBe(false)
    expect(isWpblComparePage('/wpbl/stats')).toBe(false)
    // Not the section's, so WpblApp must not try to render it over a tab.
    expect(wpblAppOwnsPath('/wpbl/compare/a-vs-b')).toBe(false)
  })

  it('is routed in production: the picker by name, the pairs by wildcard', () => {
    expect(redirects).toMatch(/^\/wpbl\/compare\s+\/\s+200\s*$/m)
    expect(redirects).toMatch(/^\/wpbl\/compare\/\*\s+\/\s+200\s*$/m)
    expect(redirects).toMatch(/^\/wpbl\/compare\/\s+\/wpbl\/compare\s+301\s*$/m)
  })

  it('has its own title and description in seo.ts', () => {
    expect(seoSource).toContain(`'${WPBL_COMPARE_BASE}': {`)
  })

  // THE PICKER, AND NOTHING UNDER IT. 118 players is 6,903 pairs; submitting those would bury
  // every URL on this site that somebody actually wrote. If this ever fails because a pair
  // reached the sitemap, the fix is to take it out, not to update the test.
  it('puts the picker in the sitemap and no pair anywhere near it', () => {
    expect(sitemap).toContain(`<loc>https://sportydolphin.fun${WPBL_COMPARE_BASE}</loc>`)
    expect(sitemap).not.toMatch(new RegExp(`${WPBL_COMPARE_BASE}/`))
  })

  // Out of the sitemap means linked or invisible. Two internal links point here, and both are
  // real anchors for the reason CLAUDE.md gives: a crawler does not fire click handlers.
  it('is linked from a page a crawler already reaches', () => {
    expect(playersIndexSource).toContain('WPBL_COMPARE_BASE')
    expect(playersIndexSource).toMatch(/component="a"[\s\S]{0,200}WPBL_COMPARE_BASE/)
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

// A real page that is deliberately NOT a tab, which is the shape most likely to be spelled in
// three of the four places and forgotten in the fourth. It is absent from WPBL_NAV on purpose,
// so every loop above that keeps the tabs honest skips it entirely.
describe('team pages, one per club', () => {
  const clubs = Object.values(WPBL_TEAMS)

  it('slugs a club the same way a game URL already does', () => {
    // /wpbl/games/2026-08-30-heights-at-firebells and /wpbl/teams/firebells have to name the
    // club identically, or the two URL shapes disagree about who the Firebells are.
    for (const t of clubs) {
      expect(wpblTeamPath(t, clubs)).toBe(`/wpbl/teams/${teamSlug(t.id, clubs)}`)
    }
    expect(wpblTeamPath(WPBL_TEAMS.SF, clubs)).toBe('/wpbl/teams/firebells')
    expect(wpblTeamPath(WPBL_TEAMS.BOS, clubs)).toBe('/wpbl/teams/hunters')
  })

  it('gives every club a 200 rewrite and a trailing-slash 301', () => {
    for (const t of clubs) {
      const slug = teamSlug(t.id, clubs)
      expect(redirects).toMatch(new RegExp(`^/wpbl/teams/${slug}\\s+/\\s+200\\s*$`, 'm'))
      expect(redirects).toMatch(new RegExp(`^/wpbl/teams/${slug}/\\s+/wpbl/teams/${slug}\\s+301\\s*$`, 'm'))
    }
  })

  // Enumerated rather than matched by a wildcard, which is the whole reason no edge-function
  // check stands behind these. If someone ever "tidies" the four lines into /wpbl/teams/*,
  // every typo under that directory becomes an indexable soft 404 with nothing to catch it.
  it('does not rely on a wildcard for teams', () => {
    expect(redirects).not.toMatch(/^\/wpbl\/teams\/\*/m)
  })

  it('gives every club its own title and description', () => {
    for (const t of clubs) {
      const path = `/wpbl/teams/${teamSlug(t.id, clubs)}`
      expect(seoSource).toContain(`'${path}': {`)
      expect(seoSource).toMatch(new RegExp(`'${path}':\\s*\\{[^}]*title:`))
    }
  })

  it('puts every club in the sitemap', () => {
    for (const t of clubs) {
      expect(sitemap).toContain(`<loc>https://sportydolphin.fun/wpbl/teams/${teamSlug(t.id, clubs)}</loc>`)
    }
  })

  it('reads a club back out of its path, and refuses what is not one', () => {
    expect(wpblTeamSlugFromPath('/wpbl/teams/firebells')).toBe('firebells')
    expect(wpblTeamSlugFromPath('/wpbl/teams/firebells/')).toBe('firebells')
    // The tab itself is not a club, the same way the players index is not a player.
    expect(wpblTeamSlugFromPath('/wpbl/teams')).toBeNull()
    expect(wpblTeamSlugFromPath('/wpbl/players/x')).toBeNull()
    // Cloudflare's `*` matches across slashes; this must not.
    expect(wpblTeamSlugFromPath('/wpbl/teams/a/b')).toBeNull()
  })

  it('resolves a slug to a club and nothing else to anything', () => {
    expect(findWpblTeamBySlug('queens', clubs)?.id).toBe('LA')
    expect(findWpblTeamBySlug('QUEENS', clubs)?.id).toBe('LA')
    expect(findWpblTeamBySlug('yankees', clubs)).toBeNull()
    expect(findWpblTeamBySlug('', clubs)).toBeNull()
  })

  // The section has to claim the path or a Back onto a club page is dropped: the address bar
  // moves and the page does not, which is the bug player pages had before wpblAppOwnsPath
  // learned about them.
  it('is a path the section owns, and is not mistaken for a tab', () => {
    expect(wpblAppOwnsPath('/wpbl/teams/hunters')).toBe(true)
    expect(wpblViewFromPath('/wpbl/teams/hunters')).toBeNull()
    expect(wpblViewFromPath('/wpbl/teams')).toBe('teams')
  })
})

describe('/wpbl/league, a page without a tab', () => {
  it('has a 200 rewrite and a trailing-slash 301 in public/_redirects', () => {
    expect(redirects).toMatch(/^\/wpbl\/league\s+\/\s+200\s*$/m)
    expect(redirects).toMatch(/^\/wpbl\/league\/\s+\/wpbl\/league\s+301\s*$/m)
  })

  it('has its own title and description in seo.ts', () => {
    expect(seoSource).toContain("'/wpbl/league': {")
    expect(seoSource).toMatch(/'\/wpbl\/league':\s*\{[^}]*title:/)
  })

  it('is in the sitemap', () => {
    expect(sitemap).toContain('<loc>https://sportydolphin.fun/wpbl/league</loc>')
  })

  // The predicate the shell renders on, and the one the tab router must NOT claim: reading it
  // as a view would send /wpbl/league to the pager, which would land on Home and leave the
  // address bar saying otherwise.
  it('is recognised as itself and not as a tab', () => {
    expect(isWpblLeaguePage('/wpbl/league')).toBe(true)
    expect(isWpblLeaguePage('/wpbl/league/')).toBe(true)
    expect(isWpblLeaguePage('/wpbl/leagues')).toBe(false)
    expect(isWpblLeaguePage('/wpbl/league/extra')).toBe(false)
    expect(wpblViewFromPath('/wpbl/league')).toBeNull()
    expect(wpblAppOwnsPath('/wpbl/league')).toBe(false)
  })

  // It has no nav pill by design, so the footer is the only way in for a reader and the only
  // link a crawler can follow. Losing it turns the page into an orphan without breaking it,
  // which is a failure nothing else here would notice.
  it('is linked from the site footer', () => {
    expect(footerSource).toContain('WPBL_LEAGUE_PAGE')
  })
})

describe('/wpbl/awards, the fan ballot', () => {
  // The ballot is a sheet over Home. Giving it an address is the only reason any of this exists,
  // and three of the four files below fail invisibly in `npm run dev`.
  it('has a 200 rewrite and a trailing-slash 301 in public/_redirects', () => {
    expect(redirects).toMatch(/^\/wpbl\/awards\s+\/\s+200\s*$/m)
    expect(redirects).toMatch(/^\/wpbl\/awards\/\s+\/wpbl\/awards\s+301\s*$/m)
  })

  it('has its own title and description in seo.ts', () => {
    expect(seoSource).toContain("'/wpbl/awards': {")
    expect(seoSource).toMatch(/'\/wpbl\/awards':\s*\{[^}]*title:/)
    expect(seoSource).toMatch(/'\/wpbl\/awards':\s*\{[^}]*description:/)
  })

  // ── Launched ──────────────────────────────────────────────────────────────────
  //
  // These four move together, because the failure they guard against is a HALF-launch, where
  // the page opens to fans but stays out of the index, or is indexed while still rendering for
  // nobody. Whichever way the ballot goes next, these move together or not at all.
  it('is in the sitemap', () => {
    expect(sitemap).toContain('<loc>https://sportydolphin.fun/wpbl/awards</loc>')
  })

  it('is not disallowed in robots.txt', () => {
    expect(robots).not.toMatch(/^Disallow:\s*\/wpbl\/awards\s*$/m)
  })

  it('is indexable in seo.ts', () => {
    const entry = /'\/wpbl\/awards':\s*\{([^}]*)\}/.exec(seoSource)?.[1] ?? ''
    expect(entry).not.toMatch(/noindex/)
  })

  // The title is a pitch now, not a tab caption: the page is something a reader can use.
  it('advertises itself in the title', () => {
    const entry = /'\/wpbl\/awards':\s*\{([^}]*)\}/.exec(seoSource)?.[1] ?? ''
    expect(entry).toMatch(/vote/i)
  })

  // It is NOT a tab: reading it as a view would hand it to the pager, which lands on Home and
  // leaves the address bar saying something else. But WpblApp does own it, because the sheet it
  // opens is rendered inside the section, and a popstate onto it that the section disowned would
  // move the URL and leave the modals exactly as they were.
  it('is owned by the section without being a tab', () => {
    expect(isWpblAwardsPage(WPBL_AWARDS_PATH)).toBe(true)
    expect(isWpblAwardsPage('/wpbl/awards/')).toBe(true)
    expect(isWpblAwardsPage('/wpbl/award')).toBe(false)
    expect(isWpblAwardsPage('/wpbl/awards/extra')).toBe(false)
    expect(wpblViewFromPath(WPBL_AWARDS_PATH)).toBeNull()
    expect(wpblAppOwnsPath(WPBL_AWARDS_PATH)).toBe(true)
  })

  // An anchor rather than a click handler, which is the rule in CLAUDE.md and is what /mlb sat
  // undiscovered for months for. Crawling is only part of the reason here: the address also has
  // to survive a middle click, a copy-link and a reload, which is the entire reason the ballot
  // was given one.
  it('is reachable by a real href from the card that opens it', () => {
    expect(fanVoteSource).toContain('linkPress(WPBL_AWARDS_PATH')
  })

  // `drawable` answers ONE question, whether there is a ballot worth drawing; whether this reader
  // may see it was never the card's business. Pinned because the whole launch is one word: a
  // `&&` added here hides the ballot from every fan while the sitemap keeps sending them to it.
  it('draws for anyone the ballot has questions for, and asks nothing else', () => {
    expect(fanVoteSource).toMatch(/const drawable = fanVoteIsWorthDrawing\(entries\)\s*$/m)
    expect(homeSource).toMatch(/<FanVoteCard key="mvp"/)
  })

  // NO GATE, AND NOTHING MAY QUIETLY ADD ONE. A `useIsAdmin` or a role check in either file
  // would hide the ballot from everyone but one account, and it would do it silently: the page
  // still answers 200, the sitemap still lists it, and Google would keep sending readers to a
  // Home page with no ballot on it.
  it('is gated by nothing', () => {
    expect(homeSource).not.toContain('useIsAdmin')
    expect(fanVoteSource).not.toContain('useIsAdmin')
    expect(fanVoteSource).not.toContain('useHasRole')
  })
})

describe('/wpbl/glossary, the rules page', () => {
  it('has a 200 rewrite and a trailing-slash 301 in public/_redirects', () => {
    expect(redirects).toMatch(/^\/wpbl\/glossary\s+\/\s+200\s*$/m)
    expect(redirects).toMatch(/^\/wpbl\/glossary\/\s+\/wpbl\/glossary\s+301\s*$/m)
  })

  it('has its own title and description in seo.ts', () => {
    expect(seoSource).toContain("'/wpbl/glossary': {")
    expect(seoSource).toMatch(/'\/wpbl\/glossary':\s*\{[^}]*title:/)
  })

  it('is in the sitemap', () => {
    expect(sitemap).toContain('<loc>https://sportydolphin.fun/wpbl/glossary</loc>')
  })

  it('is recognised as itself and not as a tab', () => {
    expect(isWpblGlossaryPage('/wpbl/glossary')).toBe(true)
    expect(isWpblGlossaryPage('/wpbl/glossary/')).toBe(true)
    expect(isWpblGlossaryPage('/wpbl/glossaries')).toBe(false)
    expect(isWpblGlossaryPage('/wpbl/glossary/extra')).toBe(false)
    expect(wpblViewFromPath('/wpbl/glossary')).toBeNull()
    expect(wpblAppOwnsPath('/wpbl/glossary')).toBe(false)
  })

  // No nav pill by design, so the footer is the only way in for a reader and the only link a
  // crawler can follow. This page is the one here written to be found cold from a search
  // result, which makes an orphaned copy of it worth less than nothing.
  it('is linked from the site footer', () => {
    expect(footerSource).toContain('WPBL_GLOSSARY_PAGE')
  })

  // The rich-result claim. FAQPage markup that does not match the page under it is the kind
  // of thing Google penalises rather than ignores, so the schema is built from WPBL_RULES
  // rather than written out, and this pins that it stays that way.
  it('declares FAQPage structured data built from the rules themselves', () => {
    expect(seoSource).toContain("'@type': 'FAQPage'")
    expect(seoSource).toContain('WPBL_RULES.map')
  })
})

describe('/wpbl/sources, the provenance page', () => {
  it('has a 200 rewrite and a trailing-slash 301 in public/_redirects', () => {
    expect(redirects).toMatch(/^\/wpbl\/sources\s+\/\s+200\s*$/m)
    expect(redirects).toMatch(/^\/wpbl\/sources\/\s+\/wpbl\/sources\s+301\s*$/m)
  })

  it('has its own title and description in seo.ts', () => {
    expect(seoSource).toContain("'/wpbl/sources': {")
    expect(seoSource).toMatch(/'\/wpbl\/sources':\s*\{[^}]*title:/)
  })

  it('is in the sitemap', () => {
    expect(sitemap).toContain('<loc>https://sportydolphin.fun/wpbl/sources</loc>')
  })

  it('is recognised as itself and not as a tab', () => {
    expect(isWpblSourcesPage('/wpbl/sources')).toBe(true)
    expect(isWpblSourcesPage('/wpbl/sources/')).toBe(true)
    expect(isWpblSourcesPage('/wpbl/source')).toBe(false)
    expect(isWpblSourcesPage('/wpbl/sources/extra')).toBe(false)
    expect(wpblViewFromPath('/wpbl/sources')).toBeNull()
    expect(wpblAppOwnsPath('/wpbl/sources')).toBe(false)
  })

  // No nav pill by design, so the footer is the only way in and the only link a crawler can
  // follow. It matters more here than on the other two: this page's whole job is to be a URL
  // somebody else can cite, and an orphaned one is worth nothing.
  it('is linked from the site footer', () => {
    expect(footerSource).toContain('WPBL_SOURCES_PAGE')
  })

  // The Terms page carries the accuracy statement it has to, and points here for the detail;
  // if that pointer goes, the provenance is orphaned from the page that promises it.
  it('is what the Terms page points at for provenance', () => {
    expect(legalSource).toContain('/wpbl/sources')
  })
})

describe('/wpbl/season, the season recap', () => {
  it('has a 200 rewrite and a trailing-slash 301 in public/_redirects', () => {
    expect(redirects).toMatch(/^\/wpbl\/season\s+\/\s+200\s*$/m)
    expect(redirects).toMatch(/^\/wpbl\/season\/\s+\/wpbl\/season\s+301\s*$/m)
  })

  it('has its own title and description in seo.ts', () => {
    expect(seoSource).toContain("'/wpbl/season': {")
    expect(seoSource).toMatch(/'\/wpbl\/season':\s*\{[^}]*title:/)
  })

  it('is in the sitemap', () => {
    expect(sitemap).toContain('<loc>https://sportydolphin.fun/wpbl/season</loc>')
  })

  it('is recognised as itself and not as a tab', () => {
    expect(isWpblSeasonPage('/wpbl/season')).toBe(true)
    expect(isWpblSeasonPage('/wpbl/season/')).toBe(true)
    expect(isWpblSeasonPage('/wpbl/seasons')).toBe(false)
    expect(isWpblSeasonPage('/wpbl/season/extra')).toBe(false)
    expect(wpblViewFromPath('/wpbl/season')).toBeNull()
    expect(wpblAppOwnsPath('/wpbl/season')).toBe(false)
  })

  // No nav pill by design, so the footer is the only way in for a reader and the only link a
  // crawler can follow. This is the page written to be found cold after the feed stops, which
  // makes an orphaned copy of it worth nothing.
  it('is linked from the site footer', () => {
    expect(footerSource).toContain('WPBL_SEASON_PAGE')
  })
})

describe('/wpbl/scorigami, the final-scores grid', () => {
  it('has a 200 rewrite and a trailing-slash 301 in public/_redirects', () => {
    expect(redirects).toMatch(/^\/wpbl\/scorigami\s+\/\s+200\s*$/m)
    expect(redirects).toMatch(/^\/wpbl\/scorigami\/\s+\/wpbl\/scorigami\s+301\s*$/m)
  })

  it('has its own title and description in seo.ts', () => {
    expect(seoSource).toContain("'/wpbl/scorigami': {")
    expect(seoSource).toMatch(/'\/wpbl\/scorigami':\s*\{[^}]*title:/)
  })

  it('is in the sitemap', () => {
    expect(sitemap).toContain('<loc>https://sportydolphin.fun/wpbl/scorigami</loc>')
  })

  it('is recognised as itself and not as a tab', () => {
    expect(isWpblScorigamiPage('/wpbl/scorigami')).toBe(true)
    expect(isWpblScorigamiPage('/wpbl/scorigami/')).toBe(true)
    expect(isWpblScorigamiPage('/wpbl/scorigamis')).toBe(false)
    expect(isWpblScorigamiPage('/wpbl/scorigami/extra')).toBe(false)
    expect(wpblViewFromPath('/wpbl/scorigami')).toBeNull()
    expect(wpblAppOwnsPath('/wpbl/scorigami')).toBe(false)
  })

  // No nav pill by design, so the footer is the only way in for a reader and the only link a
  // crawler can follow. An orphaned copy of a page written to be found is worth nothing.
  it('is linked from the site footer', () => {
    expect(footerSource).toContain('WPBL_SCORIGAMI_PAGE')
  })
})

describe('the More menu surfaces every non-tab WPBL page', () => {
  // These pages have no nav pill (league, season, scorigami, players index, glossary, sources) and
  // the Compare tool has no pill either, so the "More" menu in the section nav is a reader's way in
  // besides the footer. The menu is built from MORE_GROUPS in WpblApp; pin its contents, because a
  // page silently dropped from it still works and is still footer-linked (or, for Compare, still
  // reachable from a player), which is exactly the failure nothing else here would catch.
  // The array body between `= [` and its closing `]` at column 0. The nested per-group `items: [...]`
  // arrays close indented, so keying the terminator on a newline-then-bracket skips past them to the
  // one real closer; keying the start on `=` skips past the type annotation's own `[]`.
  const block = /MORE_GROUPS[^=]*=\s*\[([\s\S]*?)\n\]/.exec(wpblAppSource)?.[1] ?? ''

  it('has a MORE_GROUPS array', () => {
    expect(block).not.toBe('')
  })

  const expected = [
    'WPBL_LEAGUE_PAGE', 'WPBL_SEASON_PAGE', 'WPBL_SCORIGAMI_PAGE',
    'WPBL_PLAYERS_INDEX', 'WPBL_GLOSSARY_PAGE', 'WPBL_SOURCES_PAGE',
    // Compare's permanent home: the tool had no nav entry at all until it landed here under Tools.
    'WPBL_COMPARE_BASE',
  ]
  for (const c of expected) {
    it(`lists ${c}`, () => {
      expect(block).toContain(c)
    })
  }

  // On a phone the bottom bar REPLACES the top pill nav, so NavMore (the desktop dropdown) is not
  // on screen; the same six pages are reached from the bar's More slot as a sheet instead. If that
  // wiring is dropped, the pages are footer-only on a phone again, the exact regression the More
  // menu exists to prevent, and invisible on desktop. Pin that the bar carries the slot and the
  // sheet is rendered.
  it('reaches the same pages from the bottom bar (MoreSheet + MORE_KEY)', () => {
    expect(wpblAppSource).toContain('MoreSheet')
    expect(wpblAppSource).toContain('MORE_KEY')
    expect(wpblAppSource).toContain('onMore=')
  })
})

// /delete-account is the URL given to Google Play's Data safety form as the data deletion
// request link, which makes it the one route on this site whose 404 would be a compliance
// problem rather than a broken page. It is also invisible in `npm run dev`, which serves the
// SPA shell for any path: the omission only shows in production, on a URL an app store is
// checking. Pinned in all three places a static route has to be spelled.
describe('/delete-account, the store-facing route', () => {
  it('has a 200 rewrite and a trailing-slash 301 in public/_redirects', () => {
    expect(redirects).toMatch(/^\/delete-account\s+\/\s+200\s*$/m)
    expect(redirects).toMatch(/^\/delete-account\/\s+\/delete-account\s+301\s*$/m)
  })

  it('has its own title and description in seo.ts', () => {
    expect(seoSource).toContain("'/delete-account'")
    expect(seoSource).toMatch(/'\/delete-account':\s*\{[^}]*title:/)
  })

  // Indexable, unlike /admin. A deletion page nobody can find fails the reason it exists.
  it('is not noindexed', () => {
    const entry = seoSource.slice(seoSource.indexOf("'/delete-account'"))
    expect(entry.slice(0, entry.indexOf('}'))).not.toContain('noindex')
  })
})

describe('the shell claims no canonical of its own', () => {
  // index.html is served verbatim for every route (see the _redirects rewrites), so any
  // canonical written into it is claimed by every URL on the site. One pointing at /wpbl gets
  // reported by Search Console as "Alternate page with proper canonical tag", which is Google
  // dropping /mlb, /privacy, every WPBL tab and every player page in favour of the section
  // root. seo.ts sets the right one per route after mount, and a page with no canonical at all
  // canonicalises to itself, which is what every URL here wants. This is the guard against
  // someone helpfully adding one.
  it('has no static rel=canonical', () => {
    // Comments stripped first: the note in index.html explaining why there is no canonical
    // has to quote the tag to be worth reading, and a commented tag is not a tag.
    const markup = indexHtml.replace(/<!--[\s\S]*?-->/g, '')
    expect(markup).not.toMatch(/<link[^>]+rel=["']canonical["']/i)
  })

  // The counterpart: the per-route tag has to come from somewhere, and it is seo.ts.
  it('sets one per route at runtime instead', () => {
    expect(seoSource).toContain("upsertLink('canonical', canonicalUrl)")
  })
})

// The predicate WpblApp's popstate handler gates on. It is here rather than in a component
// test because the failure it guards against is a Back button that moves the address bar and
// nothing else, which nothing in the section renders differently and no local run reveals.
describe('wpblAppOwnsPath', () => {
  it('claims every tab', () => {
    for (const path of WPBL_VIEW_PATHS) expect(wpblAppOwnsPath(path)).toBe(true)
  })

  // The one this exists for. A player page is a modal over a tab, so a pop that LANDS on the
  // player's URL is the section's to apply; testing the tabs alone drops it and leaves whatever
  // modal was open sitting over that address. Reachable by Forward onto any player, and by Back
  // out of a game opened from a player's game log.
  it('claims a player page, which is not a tab', () => {
    expect(wpblViewFromPath('/wpbl/players/denae-benites')).toBeNull()
    expect(wpblAppOwnsPath('/wpbl/players/denae-benites')).toBe(true)
  })

  it('disclaims the rest of the site, and the pages the section does not render itself', () => {
    // The players index and the API docs are their own pages, routed by the shell.
    for (const path of ['/mlb', '/privacy', '/wpbl/players', '/wpbl/api', '/wpbl/players/a/b', '/wpbl/nope']) {
      expect(wpblAppOwnsPath(path)).toBe(false)
    }
  })
})

// The short share links, /p/<code> and /g/<code>. The resolvers live at the edge (functions/p,
// functions/g), but everything they reason with is here and pure, so the round-trip and the
// soft-404 guards are pinned here rather than needing a running Worker.
describe('short share links', () => {
  const A = '1a2b3c4d-1111-2222-3333-444455556666'
  const B = '9f8e7d6c-aaaa-bbbb-cccc-ddddeeeeffff'
  const roster = [{ id: A, name: 'Kelsie Whitmore' }, { id: B, name: 'Diana Ibarra' }]

  it('codes the first 8 hex of the uuid, dash-stripped and lower-cased', () => {
    expect(wpblShortCode(A)).toBe('1a2b3c4d')
    expect(wpblShortCode('AB-CD-EF-01-23-45-67')).toBe('abcdef01')
    expect(wpblShortCode(A)).toHaveLength(8)
  })

  it('builds /p and /g paths from the id alone', () => {
    expect(wpblPlayerShortPath({ id: A })).toBe(`${WPBL_SHORT_PLAYER_BASE}/1a2b3c4d`)
    expect(wpblGameShortPath({ id: B })).toBe(`${WPBL_SHORT_GAME_BASE}/9f8e7d6c`)
  })

  it('round-trips: a player path resolves back to that player', () => {
    const code = wpblShortPlayerCodeFromPath(wpblPlayerShortPath({ id: A }))
    expect(code).toBe('1a2b3c4d')
    expect(findByShortCode(code!, roster)).toBe(roster[0])
  })

  it('parses one hex segment only, and rejects a typo path or a non-hex code', () => {
    expect(wpblShortPlayerCodeFromPath('/p/1a2b3c4d')).toBe('1a2b3c4d')
    expect(wpblShortPlayerCodeFromPath('/p/1a2b3c4d/')).toBe('1a2b3c4d') // trailing slash tolerated
    expect(wpblShortGameCodeFromPath('/g/9f8e7d6c')).toBe('9f8e7d6c')
    // Cloudflare's `*` matches across slashes, so /p/a/b reaches the handler and must NOT read as
    // a code: it is a 404, not the app shell.
    expect(wpblShortPlayerCodeFromPath('/p/a/b')).toBeNull()
    expect(wpblShortPlayerCodeFromPath('/p/')).toBeNull()
    expect(wpblShortPlayerCodeFromPath('/p/zzzz')).toBeNull() // not hex
    expect(wpblShortGameCodeFromPath('/wpbl/games/x')).toBeNull() // not a /g path
    expect(wpblShortPlayerCodeFromPath('/g/1a2b3c4d')).toBeNull() // wrong base
  })

  it('refuses an ambiguous prefix rather than guess', () => {
    const twins = [{ id: 'aaaa1111-0000-0000-0000-000000000000', name: 'One' },
                   { id: 'aaaa2222-0000-0000-0000-000000000000', name: 'Two' }]
    expect(findByShortCode('aaaa', twins)).toBeNull()       // both match
    expect(findByShortCode('aaaa1', twins)).toBe(twins[0])  // now unique
    expect(findByShortCode('bbbb', twins)).toBeNull()       // none match
  })

  it('is routed in _routes.json, or the Functions never run', () => {
    // The trap: an unrouted function compiles, deploys and is silently never called.
    expect(routesJson.include).toContain('/p/*')
    expect(routesJson.include).toContain('/g/*')
  })
})
