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
import sitemap from '../../../public/sitemap.xml?raw'
import seoSource from '../../seo.ts?raw'
import {
  WPBL_NAV, WPBL_VIEW_PATHS, wpblPathFor, wpblViewFromPath, wpblAppOwnsPath, normalizeWpblView,
  wpblPlayerSlug, wpblPlayerPath, wpblPlayerSlugFromPath, findWpblPlayerBySlug,
  wpblGameSlug, wpblGamePath, wpblGameSlugFromPath, findWpblGameBySlug, isWpblLeaguePage,
  isWpblGlossaryPage,
  wpblTeamPath, wpblTeamSlugFromPath, findWpblTeamBySlug, teamSlug,
} from '../routes'
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
  // failure can have. `/*  /404.html  404` did exactly this on Aug 21, 2026.
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
      // `from to [status]` — the status is optional and defaults to 302.
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

// /delete-account is the URL given to Google Play's Data safety form as the data deletion
// request link, which makes it the one route on this site whose 404 would be a compliance
// problem rather than a broken page. It is also invisible in `npm run dev`, which serves the
// SPA shell for any path: the omission only shows in production, on a URL an app store is
// checking. Pinned in all three places a static route has to be spelled.
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
  // canonical written into it is claimed by every URL on the site. One did: it pointed at
  // /wpbl, and Search Console duly reported "Alternate page with proper canonical tag" on
  // Aug 23, 2026, which is Google dropping /mlb, /privacy, every WPBL tab and all 118 player
  // pages in favour of the section root. seo.ts sets the right one per route after mount, and
  // a page with no canonical at all canonicalises to itself, which is what every URL here
  // wants. This is the guard against someone helpfully putting it back.
  it('has no static rel=canonical', () => {
    // Comments stripped first: the note in index.html explaining why there is no canonical
    // has to quote the tag to be worth reading, and a commented tag is not a tag.
    const markup = indexHtml.replace(/<!--[\s\S]*?-->/g, '')
    expect(markup).not.toMatch(/<link[^>]+rel=["']canonical["']/i)
  })

  // The counterpart: the per-route tag has to come from somewhere, and it is seo.ts.
  it('sets one per route at runtime instead', () => {
    expect(seoSource).toContain("upsertLink('canonical', url)")
  })
})

// The predicate WpblApp's popstate handler gates on. It is here rather than in a component
// test because the failure it guards against is a Back button that moves the address bar and
// nothing else, which nothing in the section renders differently and no local run reveals.
describe('wpblAppOwnsPath', () => {
  it('claims every tab', () => {
    for (const path of WPBL_VIEW_PATHS) expect(wpblAppOwnsPath(path)).toBe(true)
  })

  // The one this exists for. A player page is a modal over a tab, so a pop that LANDS on her
  // URL is the section's to apply; testing the tabs alone dropped it and left whatever modal
  // was open sitting over her address. Reachable by Forward onto any player, and by Back out
  // of a game opened from a player's game log.
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
