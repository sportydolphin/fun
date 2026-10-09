// @vitest-environment jsdom
// The MLB section's URLs, and the files that have to agree about them.
//
// A page under /mlb is a line in public/_redirects (or it 404s in production while working in
// `npm run dev`, where Vite serves the shell for every path), an entry in src/seo.ts (or it takes
// the section's generic title, the problem these paths exist to fix), and an entry in the sitemap.
// None of the three fails locally, so they are pinned here, as WPBL's are in wpbl/__tests__.
import { describe, it, expect, afterEach, vi } from 'vitest'
import redirects from '../../../public/_redirects?raw'
import sitemap from '../../../public/sitemap.xml?raw'
import routesJson from '../../../public/_routes.json'
import seoSource from '../../seo.ts?raw'
import { TEAM_ABBR } from '../constants'
import {
  MLB_VIEW_PATHS, MLB_CLUBS, MLB_STATIC_PATHS, mlbTeamPath, mlbPlayerPath, mlbPlayerIdFromPath,
  mlbTargetFromPath, mlbTargetFromUrl, mlbLegacyTarget, mlbUrlFor, isMlbPath,
  mlbGamePath, mlbGamePkFromPath, mlbLegacyGamePk, mlbSeriesPath, mlbSeriesFromPath, isMlbSheetPath, MLB_SERIES_SLUGS,
} from '../routes'
import { SERIES_ORDER } from '../postseason'
import { pushEntry } from '../state/sheetHistory'
import { onRequestGet, WPBL_PRELOAD_SELECTOR } from '../../../functions/mlb/index'
import wpblPreloadPlugin from '../../../scripts/vite-plugin-wpbl-preload.mjs?raw'
import { onRequestGet as onShortGet } from '../../../functions/m/[[code]]'
import { mlbShortPath, mlbShortTargetFromPath } from '../routes'

describe('reading an address', () => {
  it('round-trips every tab', () => {
    for (const [view, path] of Object.entries(MLB_VIEW_PATHS)) {
      expect(mlbTargetFromPath(path)).toEqual({ view })
      expect(mlbTargetFromPath(`${path}/`)).toEqual({ view })
    }
  })

  it('round-trips every club, by id', () => {
    for (const c of MLB_CLUBS) expect(mlbTargetFromPath(mlbTeamPath(c.id))).toEqual({ view: 'search', teamId: c.id })
  })

  it('reads a player on the id alone, so a renamed player keeps working', () => {
    expect(mlbPlayerPath({ id: 660271, fullName: 'Shohei Ohtani' })).toBe('/mlb/players/shohei-ohtani-660271')
    expect(mlbPlayerIdFromPath('/mlb/players/shohei-ohtani-660271')).toBe(660271)
    expect(mlbPlayerIdFromPath('/mlb/players/someone-else-660271')).toBe(660271)
    expect(mlbPlayerIdFromPath('/mlb/players/660271')).toBe(660271)
    expect(mlbPlayerPath({ id: 660271 })).toBe('/mlb/players/660271')
    // Accents fold the way the WPBL slugs do.
    expect(mlbPlayerPath({ id: 1, fullName: 'José Ramírez' })).toBe('/mlb/players/jose-ramirez-1')
  })

  // A game is a sheet over Scores, which is what a cold landing on its address puts beneath it.
  it('reads a game as Scores with the game over it', () => {
    expect(mlbGamePath(849844)).toBe('/mlb/games/849844')
    expect(mlbTargetFromPath('/mlb/games/849844')).toEqual({ view: 'scores', gamePk: 849844 })
    expect(mlbTargetFromPath('/mlb/games/849844/')).toEqual({ view: 'scores', gamePk: 849844 })
    // One URL per game: no leading zero, no slug, nothing below it.
    for (const p of ['/mlb/games', '/mlb/games/0', '/mlb/games/0849844', '/mlb/games/phi-atl-849844', '/mlb/games/1/2', '/mlb/games/-1']) {
      expect(mlbGamePkFromPath(p), p).toBeNull()
    }
    expect(mlbLegacyGamePk('?view=home&open=game&gamePk=849844')).toBe(849844)
    expect(mlbLegacyGamePk('?open=predictor&gamePk=849844')).toBeNull()
  })

  // A series is a sheet over Standings, named by season and bracket slot, never by its clubs.
  it('reads a series as Standings with the series over it', () => {
    expect(mlbSeriesPath(2026, 'D_1')).toBe('/mlb/postseason/2026/alds-1')
    expect(mlbTargetFromPath('/mlb/postseason/2026/alds-1/')).toEqual({ view: 'standings', series: { season: 2026, id: 'D_1' } })
    expect(isMlbSheetPath('/mlb/postseason/2026/world-series')).toBe(true)
    expect(isMlbSheetPath('/mlb/standings')).toBe(false)
    // Every series the bracket draws has a slot, and every slot round-trips.
    expect(Object.keys(MLB_SERIES_SLUGS).sort()).toEqual([...SERIES_ORDER].sort())
    for (const id of SERIES_ORDER) expect(mlbSeriesFromPath(mlbSeriesPath(2025, id))).toEqual({ season: 2025, id })
    for (const p of ['/mlb/postseason', '/mlb/postseason/2026', '/mlb/postseason/2026/D_1', '/mlb/postseason/2021/alds-1', '/mlb/postseason/26/alds-1', '/mlb/postseason/2026/alds-1/x']) {
      expect(mlbSeriesFromPath(p), p).toBeNull()
    }
  })

  it('is null for anything that is not an MLB page, so the shell 404s it', () => {
    for (const p of ['/mlb/nope', '/mlb/teams/expos', '/mlb/players', '/mlb/players/shohei', '/mlb/players/a/1', '/mlb/games', '/mlb/games/x', '/wpbl', '/mlbx']) {
      expect(isMlbPath(p), p).toBe(false)
    }
  })

  it('still reads the old query spelling on the section root, and only there', () => {
    expect(mlbLegacyTarget('?view=standings')).toEqual({ view: 'standings' })
    expect(mlbLegacyTarget('?pid=660271&view=search')).toEqual({ view: 'search', playerId: 660271 })
    expect(mlbLegacyTarget('?tid=119')).toEqual({ view: 'search', teamId: 119 })
    // `view` won over a stray id, as it always did: Home loaded a player in the background.
    expect(mlbLegacyTarget('?view=home&pid=1')).toEqual({ view: 'home' })
    expect(mlbLegacyTarget('?open=predictor')).toBeNull()
    expect(mlbTargetFromUrl('/mlb', '?view=leaderboard&lb=pitching')).toEqual({ view: 'leaderboard' })
    expect(mlbTargetFromUrl('/mlb/standings', '?view=home')).toEqual({ view: 'standings' })
    expect(mlbTargetFromUrl('/mlb', '?open=predictor')).toEqual({ view: 'home' })
  })
})

describe('writing an address', () => {
  it('puts the board filters on the query and nothing else', () => {
    expect(mlbUrlFor({ view: 'leaderboard', lb: 'pitching', season: 2026 }, 2026)).toBe('/mlb/leaders?lb=pitching')
    expect(mlbUrlFor({ view: 'stats', allTime: true }, 2026)).toBe('/mlb/stats?season=all')
    expect(mlbUrlFor({ view: 'viz', season: 2024 }, 2026)).toBe('/mlb/charts?season=2024')
    expect(mlbUrlFor({ view: 'standings', lb: 'pitching' }, 2026)).toBe('/mlb/standings')
    expect(mlbUrlFor({ view: 'search', playerId: 5, playerName: 'A B', lb: 'pitching' }, 2026)).toBe('/mlb/players/a-b-5')
    expect(mlbUrlFor({ view: 'search', teamId: 111 })).toBe('/mlb/teams/red-sox')
  })

  // lib/staleBuild.ts turns the next pushState after a deploy into a full load of ITS url. An entry
  // pushed at the current address reloads the page being left, and the tap goes nowhere.
  it('pushes the destination, not the page being left', () => {
    window.history.replaceState({}, '', '/mlb')
    pushEntry({ view: 'search', teamId: 119 }, mlbUrlFor({ view: 'search', teamId: 119 }))
    expect(window.location.pathname).toBe('/mlb/teams/dodgers')
  })
})

describe('the club table', () => {
  it('names exactly the thirty clubs the rest of the section knows', () => {
    expect(MLB_CLUBS.map(c => c.id).sort()).toEqual(Object.keys(TEAM_ABBR).map(Number).sort())
    expect(new Set(MLB_CLUBS.map(c => c.slug)).size).toBe(30)
  })
})

describe('every page is routable in production', () => {
  it('has a 200 rewrite and a trailing-slash 301 in public/_redirects', () => {
    for (const p of MLB_STATIC_PATHS) {
      expect(redirects, p).toMatch(new RegExp(`^${p}\\s+/\\s+200\\s*$`, 'm'))
      expect(redirects, p).toMatch(new RegExp(`^${p}/\\s+${p}\\s+301\\s*$`, 'm'))
    }
  })

  // The one wildcard, and it is only safe because the function below answers the 404s.
  it('routes players and games by wildcard and nothing else under /mlb that way', () => {
    expect(redirects).toMatch(/^\/mlb\/players\/\*\s+\/\s+200\s*$/m)
    expect(redirects).toMatch(/^\/mlb\/games\/\*\s+\/\s+200\s*$/m)
    expect(redirects).toMatch(/^\/mlb\/postseason\/\*\s+\/\s+200\s*$/m)
    expect(redirects).toMatch(/^\/mlb\/compare\/\*\s+\/\s+200\s*$/m)
    expect(redirects).not.toMatch(/^\/mlb\/\*/m)
    expect(redirects).not.toMatch(/^\/mlb\/teams\/\*/m)
  })

  // An allow-list: a function not named here compiles, deploys, and is never called.
  it('sends /mlb and its subtree through the Functions worker', () => {
    expect(routesJson.include).toContain('/mlb')
    expect(routesJson.include).toContain('/mlb/*')
  })
})

describe('every page is discoverable and distinct', () => {
  it('is in the sitemap', () => {
    for (const p of MLB_STATIC_PATHS) expect(sitemap).toContain(`<loc>https://sportydolphin.fun${p}</loc>`)
  })

  // Thousands of thin pages built from a public feed would bury the site's own. See build-sitemap.ts.
  it('keeps player and game pages out of the sitemap', () => {
    expect(sitemap).not.toContain('/mlb/players/')
    expect(sitemap).not.toContain('/mlb/games/')
  })

  // Series are in, as played; each listed one must be an address the edge serves.
  it('lists only real series addresses', () => {
    const series = [...sitemap.matchAll(/<loc>https:\/\/sportydolphin\.fun(\/mlb\/postseason\/[^<]*)<\/loc>/g)].map(m => m[1])
    expect(series.length).toBeGreaterThan(0)
    for (const p of series) expect(mlbSeriesFromPath(p), p).not.toBeNull()
  })

  it('has tags of its own in seo.ts', () => {
    for (const view of Object.keys(MLB_VIEW_PATHS)) {
      if (view === 'home') continue
      expect(seoSource).toContain(`[MLB_VIEW_PATHS.${view}]`)
    }
    expect(seoSource).toContain('MLB_CLUBS.map(c => [`${MLB_TEAMS_BASE}/${c.slug}`')
  })
})

describe('the edge function', () => {
  const ctx = (url: string) => {
    const next = vi.fn(async () => new Response('shell', { status: 200 }))
    const assets = vi.fn(async () => new Response('404 page', { status: 200 }))
    return { request: new Request(url), env: { ASSETS: { fetch: assets } }, next }
  }
  const people = (body: unknown, status = 200) =>
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status }))
  afterEach(() => { vi.restoreAllMocks() })

  it('301s the old query spelling, keeping the rest of the query', async () => {
    const res = await onRequestGet(ctx('https://sportydolphin.fun/mlb?view=home&open=predictor'))
    expect(res.status).toBe(301)
    expect(res.headers.get('location')).toBe('https://sportydolphin.fun/mlb?open=predictor')
    const lb = await onRequestGet(ctx('https://sportydolphin.fun/mlb?view=leaderboard&lb=pitching'))
    expect(lb.headers.get('location')).toBe('https://sportydolphin.fun/mlb/leaders?lb=pitching')
    const team = await onRequestGet(ctx('https://sportydolphin.fun/mlb?tid=138'))
    expect(team.headers.get('location')).toBe('https://sportydolphin.fun/mlb/teams/cardinals')
  })

  it('leaves a new address alone, query and all', async () => {
    const c = ctx('https://sportydolphin.fun/mlb/leaders?view=home')
    await onRequestGet(c)
    expect(c.next).toHaveBeenCalled()
  })

  it('404s a player path that names no player', async () => {
    const c = ctx('https://sportydolphin.fun/mlb/players/nobody')
    const res = await onRequestGet(c)
    expect(res.status).toBe(404)
    people({ message: 'Object not found' }, 404)
    expect((await onRequestGet(ctx('https://sportydolphin.fun/mlb/players/nobody-12'))).status).toBe(404)
  })

  it('301s a stale or missing name onto the current one, and serves the canonical', async () => {
    people({ people: [{ id: 660271, fullName: 'Shohei Ohtani' }] })
    const res = await onRequestGet(ctx('https://sportydolphin.fun/mlb/players/660271'))
    expect(res.status).toBe(301)
    expect(res.headers.get('location')).toBe('https://sportydolphin.fun/mlb/players/shohei-ohtani-660271')
    const c = ctx('https://sportydolphin.fun/mlb/players/shohei-ohtani-660271')
    await onRequestGet(c)
    expect(c.next).toHaveBeenCalled()
  })

  it('serves the page when StatsAPI cannot be asked, rather than 404 a real player', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('down'))
    const c = ctx('https://sportydolphin.fun/mlb/players/shohei-ohtani-660271')
    await onRequestGet(c)
    expect(c.next).toHaveBeenCalled()
  })

  // Every game-start push before Oct 2026 carried this, and some are still on lock screens.
  it('301s the old game link onto the game', async () => {
    const res = await onRequestGet(ctx('https://sportydolphin.fun/mlb?view=home&open=game&gamePk=849844'))
    expect(res.status).toBe(301)
    expect(res.headers.get('location')).toBe('https://sportydolphin.fun/mlb/games/849844')
  })

  const schedule = (games: { gamePk: number; gameType: string }[]) =>
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ dates: games.length ? [{ games }] : [] })))

  it('serves a game the scoreboard shows', async () => {
    schedule([{ gamePk: 849844, gameType: 'F' }])
    const c = ctx('https://sportydolphin.fun/mlb/games/849844')
    await onRequestGet(c)
    expect(c.next).toHaveBeenCalled()
  })

  it('404s a game that does not exist, or that the scoreboard would not show', async () => {
    expect((await onRequestGet(ctx('https://sportydolphin.fun/mlb/games/nope'))).status).toBe(404)
    schedule([])
    expect((await onRequestGet(ctx('https://sportydolphin.fun/mlb/games/1'))).status).toBe(404)
    vi.restoreAllMocks()
    schedule([{ gamePk: 2, gameType: 'S' }])
    expect((await onRequestGet(ctx('https://sportydolphin.fun/mlb/games/2'))).status).toBe(404)
  })

  it('serves a series slot, and 404s one that names no series', async () => {
    const c = ctx('https://sportydolphin.fun/mlb/postseason/2026/alds-1')
    await onRequestGet(c)
    expect(c.next).toHaveBeenCalled()
    for (const p of ['2026/alds-3', '2021/alds-1', '2026', `${new Date().getUTCFullYear() + 2}/alcs`]) {
      expect((await onRequestGet(ctx(`https://sportydolphin.fun/mlb/postseason/${p}`))).status, p).toBe(404)
    }
    const res = await onRequestGet(ctx('https://sportydolphin.fun/mlb/postseason/2026/alcs/'))
    expect(res.status).toBe(301)
    expect(res.headers.get('location')).toBe('https://sportydolphin.fun/mlb/postseason/2026/alcs')
  })

  // /mlb/compare/*, every player squared, with the same three jobs as a player path.
  it('404s a compare path that names nobody, or is not a slot or a pair', async () => {
    for (const p of ['nobody', 'a/b', '12-vs-12']) {
      expect((await onRequestGet(ctx(`https://sportydolphin.fun/mlb/compare/${p}`))).status, p).toBe(404)
    }
    people({ people: [{ id: 677951, fullName: 'Bobby Witt Jr.' }] })
    expect((await onRequestGet(ctx('https://sportydolphin.fun/mlb/compare/bobby-witt-jr-677951-vs-nobody-12'))).status).toBe(404)
  })

  it("301s a compare path onto its current names, in the reader's order", async () => {
    people({ people: [{ id: 677951, fullName: 'Bobby Witt Jr.' }, { id: 677594, fullName: 'Julio Rodríguez' }] })
    const res = await onRequestGet(ctx('https://sportydolphin.fun/mlb/compare/677594-vs-bobby-witt-677951'))
    expect(res.status).toBe(301)
    expect(res.headers.get('location')).toBe('https://sportydolphin.fun/mlb/compare/julio-rodriguez-677594-vs-bobby-witt-jr-677951')
    // The season is the pair's year, not its name, and survives the fold.
    people({ people: [{ id: 677951, fullName: 'Bobby Witt Jr.' }, { id: 677594, fullName: 'Julio Rodríguez' }] })
    const old = await onRequestGet(ctx('https://sportydolphin.fun/mlb/compare/677594-vs-677951?season=2023'))
    expect(old.headers.get('location')).toBe('https://sportydolphin.fun/mlb/compare/julio-rodriguez-677594-vs-bobby-witt-jr-677951?season=2023')
    const pair = ctx('https://sportydolphin.fun/mlb/compare/julio-rodriguez-677594-vs-bobby-witt-jr-677951')
    await onRequestGet(pair)
    expect(pair.next).toHaveBeenCalled()
    const single = ctx('https://sportydolphin.fun/mlb/compare/bobby-witt-jr-677951')
    await onRequestGet(single)
    expect(single.next).toHaveBeenCalled()
  })

  it('serves a compare page when StatsAPI cannot be asked', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('down'))
    const c = ctx('https://sportydolphin.fun/mlb/compare/bobby-witt-jr-677951-vs-julio-rodriguez-677594')
    await onRequestGet(c)
    expect(c.next).toHaveBeenCalled()
  })

  it('folds the trailing slash, and serves the game when StatsAPI cannot be asked', async () => {
    const res = await onRequestGet(ctx('https://sportydolphin.fun/mlb/games/849844/'))
    expect(res.status).toBe(301)
    expect(res.headers.get('location')).toBe('https://sportydolphin.fun/mlb/games/849844')
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('down'))
    const c = ctx('https://sportydolphin.fun/mlb/games/849844')
    await onRequestGet(c)
    expect(c.next).toHaveBeenCalled()
  })
})

// /m/<code>: the id re-encoded, so a share fits a post. Each target has exactly one code.
describe('short links', () => {
  it('round-trips a player, a game and every series slot', () => {
    expect(mlbShortPath({ kind: 'player', id: 660271 })).toBe('/m/pe5gv')
    expect(mlbShortPath({ kind: 'game', gamePk: 849824 })).toBe('/m/gi7q8')
    expect(mlbShortPath({ kind: 'series', season: 2026, id: 'D_1' })).toBe('/m/s26d1')
    expect(mlbShortTargetFromPath('/m/pe5gv')).toEqual({ kind: 'player', id: 660271 })
    expect(mlbShortTargetFromPath('/m/gi7q8/')).toEqual({ kind: 'game', gamePk: 849824 })
    for (const id of SERIES_ORDER) {
      expect(mlbShortTargetFromPath(mlbShortPath({ kind: 'series', season: 2022, id }))).toEqual({ kind: 'series', season: 2022, id })
    }
    for (const p of ['/m', '/m/', '/m/x1', '/m/p0e5gv', '/m/pE5GV', '/m/p', '/m/s21d1', '/m/s26d5', '/m/pe5gv/x', '/m/g-1']) {
      expect(mlbShortTargetFromPath(p), p).toBeNull()
    }
  })

  const ctx = (url: string) => ({
    request: new Request(url),
    env: { ASSETS: { fetch: vi.fn(async () => new Response('404 page', { status: 200 })) } },
    next: vi.fn(async () => new Response('shell', { status: 200 })),
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('302s each kind onto its canonical page, marked for the open count', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ people: [{ fullName: 'Shohei Ohtani' }] })))
    const player = await onShortGet(ctx('https://sportydolphin.fun/m/pe5gv'))
    expect(player.status).toBe(302)
    expect(player.headers.get('location')).toBe('https://sportydolphin.fun/mlb/players/shohei-ohtani-660271?ref=short')
    expect((await onShortGet(ctx('https://sportydolphin.fun/m/gi7q8'))).headers.get('location'))
      .toBe('https://sportydolphin.fun/mlb/games/849824?ref=short')
    expect((await onShortGet(ctx('https://sportydolphin.fun/m/s26w1'))).headers.get('location'))
      .toBe('https://sportydolphin.fun/mlb/postseason/2026/world-series?ref=short')
  })

  it('404s a malformed code or a player who does not exist, and lands on the bare id when StatsAPI is down', async () => {
    expect((await onShortGet(ctx('https://sportydolphin.fun/m/zzz'))).status).toBe(404)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ people: [] })))
    expect((await onShortGet(ctx('https://sportydolphin.fun/m/p1'))).status).toBe(404)
    vi.restoreAllMocks()
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('down'))
    expect((await onShortGet(ctx('https://sportydolphin.fun/m/pe5gv'))).headers.get('location'))
      .toBe('https://sportydolphin.fun/mlb/players/660271?ref=short')
  })

  it('reaches the Functions worker', () => {
    expect(routesJson.include).toContain('/m/*')
  })
})

describe('the WPBL preloads an /mlb page leaves out', () => {
  // The plugin marks the links and the function strips by that mark. Neither fails if the other
  // renames it: /mlb just goes back to downloading the WPBL section at first paint, unseen.
  it('strips by the attribute the plugin writes', () => {
    expect(WPBL_PRELOAD_SELECTOR).toBe('link[data-section="wpbl"]')
    expect(wpblPreloadPlugin).toContain(`'data-section': 'wpbl'`)
  })
})
