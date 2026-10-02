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
  mlbGamePath, mlbGamePkFromPath, mlbLegacyGamePk,
} from '../routes'
import { pushEntry } from '../state/sheetHistory'
import { onRequestGet } from '../../../functions/mlb/index'

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
