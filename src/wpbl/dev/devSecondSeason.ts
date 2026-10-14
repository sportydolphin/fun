// Dev only: a second season, cloned from the first, so every surface can be checked against two
// years before the league has played one.
//
// WHY A CLONE. The failure multiple seasons guards against is silent: a board handed two years
// sums them, and a batting line reading 50 games looks like a batting line. The only way to see
// it before Opening Day 2027 is to have a 2027 in the data, and inventing one from scratch would
// mean inventing box scores. So each 2026 regular-season game is copied a year forward (364 days,
// which keeps the weekday), the first PLAYED_SHARE of them keep their results and every line and
// play they had, and the rest are scheduled. That is a season in progress, which is the shape
// that matters: a current year with results, a finished year behind it, and fixtures ahead.
//
// The numbers in "2027" are 2026's, so a board on 2027 should match 2026's first few weeks, and
// the two years summed would be visibly too big. A clone has its own id; a per-game read asks the
// database for the real game behind it (sourceGameId) and hands the rows back under the clone's.
//
// The map is REMEMBERED (localStorage) once the schedule has been seen, because the line and play
// reads can land before the schedule does and would have nothing to clone from. The menu builds it
// from the cached schedule before it reloads, so the first load already has it.

import type { WpblGame } from '../types'
import type { WpblReadOverlay } from '../api'

const STORE_KEY = 'sd:dev-second-season'
/** The share of the cloned schedule that has been played. */
const PLAYED_SHARE = 0.4
/** 52 weeks, so a Saturday game is still a Saturday. */
const SHIFT_DAYS = 364
/** The season that is cloned, and the one the clones land in. */
const SOURCE_SEASON = 2026
const CLONE_SEASON = 2027

interface CloneMap {
  /** clone id to the real game it copies */
  source: Record<string, string>
  /** real game id to its clone, for the PLAYED clones only: only those have lines and plays */
  played: Record<string, string>
}

function read(): CloneMap | null {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    return raw ? JSON.parse(raw) as CloneMap : null
  } catch { return null }
}

let map: CloneMap | null = import.meta.env.DEV ? read() : null

export function devSecondSeasonOn(): boolean { return map != null }

/** A uuid-shaped id that cannot collide with a real one: the real id with its last block marked. */
const cloneId = (id: string) => `${id.slice(0, -12)}d0d0${id.slice(-8)}`

const isPostseason = (g: WpblGame) => !!g.game_type && /post|playoff|semi|champ/i.test(g.game_type)

function build(games: WpblGame[]): CloneMap {
  const regular = games.filter(g => !isPostseason(g) && g.game_date?.startsWith(String(SOURCE_SEASON)))
    .sort((a, b) => a.game_date.localeCompare(b.game_date))
  const cut = Math.round(regular.length * PLAYED_SHARE)
  const out: CloneMap = { source: {}, played: {} }
  regular.forEach((g, i) => {
    const id = cloneId(g.id)
    out.source[id] = g.id
    if (i < cut && g.status === 'final') out.played[g.id] = id
  })
  return out
}

/** Dev only: turn the fake second season on (from the schedule in hand) or off. Reload after. */
export function setDevSecondSeason(on: boolean, games: WpblGame[] | null): void {
  map = on && games?.length ? build(games) : null
  try {
    if (map) localStorage.setItem(STORE_KEY, JSON.stringify(map))
    else localStorage.removeItem(STORE_KEY)
  } catch { /* dev only */ }
}

function shiftDate(d: string): string {
  const t = new Date(`${d}T12:00:00Z`)
  t.setUTCDate(t.getUTCDate() + SHIFT_DAYS)
  return t.toISOString().slice(0, 10)
}

function cloneGame(g: WpblGame, id: string, played: boolean): WpblGame {
  const base = { ...g, id, game_date: shiftDate(g.game_date), api_game_id: g.api_game_id ? `${g.api_game_id}-dev2027` : null }
  if (played) return base
  return {
    ...base, status: 'scheduled', status_detail: null, home_score: null, away_score: null, innings: null,
    home_hits: null, away_hits: null, home_errors: null, away_errors: null, home_lob: null, away_lob: null,
    home_line: null, away_line: null, live_state: null,
  } as WpblGame
}

/** Wraps an overlay (the live-game simulator) with the second season. Inert while it is off. */
export function withDevSecondSeason(base: WpblReadOverlay): WpblReadOverlay {
  return {
    schedule(games) {
      const real = base.schedule(games)
      if (!map) return real
      // Rebuilt from what the schedule holds now, so a game that went final since the switch was
      // thrown does not leave the map pointing at a game the clone has no lines for.
      map = build(real)
      try { localStorage.setItem(STORE_KEY, JSON.stringify(map)) } catch { /* dev only */ }
      const byId = new Map(real.map(g => [g.id, g]))
      const clones: WpblGame[] = []
      for (const [id, src] of Object.entries(map.source)) {
        const g = byId.get(src)
        if (g) clones.push(cloneGame(g, id, map.played[src] != null))
      }
      return [...real, ...clones]
    },
    live: (id, delta) => base.live(id, delta),
    plays: (id, plays) => base.plays(id, plays),
    keyed(rows) {
      if (!map) return rows
      const played = map.played
      const out = rows.slice()
      for (const r of rows) {
        const clone = played[r.game_id]
        if (!clone) continue
        const row = { ...r, game_id: clone } as typeof r & { id?: unknown }
        if (typeof row.id === 'string') row.id = `${row.id}-dev2027`
        out.push(row)
      }
      return out
    },
    sourceGameId: id => map?.source[id] ?? id,
    // Every clone is a 2026 game moved 364 days on, so the fake year's plays are 2026's.
    sourceSeason: season => (map && season === CLONE_SEASON ? SOURCE_SEASON : season),
  }
}
