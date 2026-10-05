// ─── One postseason series, in depth ──────────────────────────────────────────
//
// The bracket read (postseason.ts) carries scores and nothing else, which is right for a card but
// left the series sheet as five rows of "Game N, score, Final" in a dialog with room for far more.
// This is what the sheet reads on open, all of it keyed to one series and none of it needed by
// the card: who won and lost each game, who starts the next ones and where they are on TV, the
// series' best performers from the box scores, and how the two clubs met in the regular season.
//
// Every read is best effort and independent, so a slow or failed one costs its own section and
// never the sheet. The pure parts (leaders, the next-round pairing) are exported for the tests.

import { fetchStandings } from './api'
import { parseIP } from './lib/utils'
import type { Bracket, PsSeries, PsTeam, SeriesId } from './postseason'
import { seriesName } from './postseason'

const API = 'https://statsapi.mlb.com/api/v1'

// ─── Per-game detail: decisions, starters, venue, TV ─────────────────────────

export interface PersonRef { id: number; name: string }

export interface SeriesGameDetail {
  winner: PersonRef | null
  loser:  PersonRef | null
  save:   PersonRef | null
  probable: { away: PersonRef | null; home: PersonRef | null }
  venue: string
  /** National TV only. The local radio list runs to a dozen stations and helps nobody. */
  tv: string[]
}

const person = (p: any): PersonRef | null => p?.id ? { id: Number(p.id), name: String(p.fullName ?? '') } : null

/** Pure, for the tests: one schedule game into what the sheet shows. */
export function parseSeriesGame(g: any): SeriesGameDetail {
  const d = g?.decisions ?? {}
  const tv = (g?.broadcasts ?? [])
    .filter((b: any) => b?.type === 'TV' && b?.isNational && b?.name)
    .map((b: any) => String(b.name).trim())
  return {
    winner: person(d.winner), loser: person(d.loser), save: person(d.save),
    probable: { away: person(g?.teams?.away?.probablePitcher), home: person(g?.teams?.home?.probablePitcher) },
    venue: g?.venue?.name ?? '',
    tv: [...new Set<string>(tv)],
  }
}

const gameCache = new Map<string, { at: number; p: Promise<Map<number, SeriesGameDetail>> }>()

/** Every game of a series in one request. Fresh for a minute, since starters are named late. */
export function fetchSeriesGames(gamePks: number[]): Promise<Map<number, SeriesGameDetail>> {
  const key = gamePks.join(',')
  const hit = gameCache.get(key)
  if (hit && Date.now() - hit.at < 60_000) return hit.p
  const p = fetch(`${API}/schedule?gamePks=${key}&hydrate=decisions,probablePitcher,venue,broadcasts(all)`)
    .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json() })
    .then(d => {
      const out = new Map<number, SeriesGameDetail>()
      for (const dt of d.dates ?? []) for (const g of dt.games ?? []) out.set(Number(g.gamePk), parseSeriesGame(g))
      return out
    })
    .catch(() => new Map<number, SeriesGameDetail>())
  gameCache.set(key, { at: Date.now(), p })
  return p
}

// ─── Starters' season lines ───────────────────────────────────────────────────

export interface PitcherLine { era: string | null; wins: number; losses: number; hand: string | null }

/** Regular-season lines for the named starters: an ERA beside a name is what makes it a matchup. */
export async function fetchPitcherLines(ids: number[], season: number): Promise<Map<number, PitcherLine>> {
  const out = new Map<number, PitcherLine>()
  if (!ids.length) return out
  try {
    const d = await fetch(`${API}/people?personIds=${ids.join(',')}&hydrate=stats(group=pitching,type=season,season=${season})`).then(r => r.json())
    for (const p of d.people ?? []) {
      const s = (p.stats ?? []).find((x: any) => x.group?.displayName === 'pitching')?.splits?.[0]?.stat ?? {}
      out.set(Number(p.id), { era: s.era ?? null, wins: Number(s.wins ?? 0), losses: Number(s.losses ?? 0), hand: p.pitchHand?.code ?? null })
    }
  } catch { /* the names still draw */ }
  return out
}

// ─── Series leaders, from the box scores ─────────────────────────────────────

export interface HitterTotals {
  id: number; name: string; teamId: number
  games: number; ab: number; h: number; doubles: number; triples: number; hr: number; rbi: number; bb: number; r: number; sb: number
}
export interface PitcherTotals {
  id: number; name: string; teamId: number
  games: number; outs: number; h: number; er: number; bb: number; k: number; w: number; l: number; sv: number
}
export interface SeriesLeaders { hitters: HitterTotals[]; pitchers: PitcherTotals[]; games: number }

/** Bases plus everything else a hitter did for the scoreboard. Not a real stat: a sort key that puts
 *  the 3-for-4 with a home run above the 1-for-4 with a walk, which is all a top three needs. */
export const hitterScore = (t: HitterTotals): number =>
  (t.h - t.doubles - t.triples - t.hr) + 2 * t.doubles + 3 * t.triples + 4 * t.hr + t.bb + t.rbi + t.r + t.sb

/** Outs are the volume, runs the cost, strikeouts the tiebreak: a six-inning start of one run ranks
 *  above a scoreless inning of relief, and a seven-run blowup ranks nowhere. */
export const pitcherScore = (t: PitcherTotals): number => t.outs - 3 * t.er + 0.5 * t.k - 0.5 * (t.bb + t.h)

/** Pure, for the tests: box scores summed per player across the series. */
export function seriesLeaders(boxes: any[]): SeriesLeaders {
  const hit = new Map<number, HitterTotals>()
  const pit = new Map<number, PitcherTotals>()
  for (const box of boxes) {
    for (const side of ['away', 'home'] as const) {
      const t = box?.teams?.[side]
      const teamId = Number(t?.team?.id ?? 0)
      const players = t?.players ?? {}
      for (const id of (t?.batters ?? []) as number[]) {
        const p = players[`ID${id}`]
        const s = p?.stats?.batting
        // A pitcher listed among the batters with no plate appearance is not a hitter in this series.
        if (!s || !(Number(s.plateAppearances ?? 0) > 0)) continue
        const cur = hit.get(id) ?? { id, name: p.person?.fullName ?? '', teamId, games: 0, ab: 0, h: 0, doubles: 0, triples: 0, hr: 0, rbi: 0, bb: 0, r: 0, sb: 0 }
        cur.games++
        cur.ab += Number(s.atBats ?? 0); cur.h += Number(s.hits ?? 0)
        cur.doubles += Number(s.doubles ?? 0); cur.triples += Number(s.triples ?? 0); cur.hr += Number(s.homeRuns ?? 0)
        cur.rbi += Number(s.rbi ?? 0); cur.bb += Number(s.baseOnBalls ?? 0) + Number(s.hitByPitch ?? 0)
        cur.r += Number(s.runs ?? 0); cur.sb += Number(s.stolenBases ?? 0)
        hit.set(id, cur)
      }
      for (const id of (t?.pitchers ?? []) as number[]) {
        const p = players[`ID${id}`]
        const s = p?.stats?.pitching
        if (!s) continue
        const cur = pit.get(id) ?? { id, name: p.person?.fullName ?? '', teamId, games: 0, outs: 0, h: 0, er: 0, bb: 0, k: 0, w: 0, l: 0, sv: 0 }
        cur.games++
        // `outs` is on the line; inningsPitched is the fallback for an older feed that lacks it.
        cur.outs += s.outs != null ? Number(s.outs) : Math.round(parseIP(s.inningsPitched) * 3)
        cur.h += Number(s.hits ?? 0); cur.er += Number(s.earnedRuns ?? 0)
        cur.bb += Number(s.baseOnBalls ?? 0); cur.k += Number(s.strikeOuts ?? 0)
        cur.w += Number(s.wins ?? 0); cur.l += Number(s.losses ?? 0); cur.sv += Number(s.saves ?? 0)
        pit.set(id, cur)
      }
    }
  }
  const hitters = [...hit.values()].filter(t => hitterScore(t) > 0)
    .sort((a, b) => hitterScore(b) - hitterScore(a) || b.h - a.h || a.ab - b.ab)
  const pitchers = [...pit.values()].filter(t => t.outs >= 3 && pitcherScore(t) > 0)
    .sort((a, b) => pitcherScore(b) - pitcherScore(a) || b.outs - a.outs)
  return { hitters, pitchers, games: boxes.length }
}

// A final's box score does not change in the minutes a sheet is open, so each is read once a visit.
const boxCache = new Map<number, Promise<any | null>>()
const fetchBox = (pk: number): Promise<any | null> => {
  if (!boxCache.has(pk)) {
    const p = fetch(`${API}/game/${pk}/boxscore`).then(r => r.ok ? r.json() : null).catch(() => null)
    p.then(b => { if (!b) boxCache.delete(pk) })
    boxCache.set(pk, p)
  }
  return boxCache.get(pk)!
}

export async function fetchSeriesLeaders(finalPks: number[]): Promise<SeriesLeaders | null> {
  if (!finalPks.length) return null
  const boxes = (await Promise.all(finalPks.map(fetchBox))).filter(Boolean)
  return boxes.length ? seriesLeaders(boxes) : null
}

// ─── The regular season, between and apart ───────────────────────────────────

export interface Meeting { wins: Record<number, number>; games: number }

const h2hCache = new Map<string, Promise<Meeting | null>>()

/** How the two clubs did against each other from April to September. */
export function fetchRegularSeasonMeeting(season: number, a: number, b: number): Promise<Meeting | null> {
  const key = `${season}:${Math.min(a, b)}:${Math.max(a, b)}`
  if (!h2hCache.has(key)) {
    h2hCache.set(key, fetch(`${API}/schedule?sportId=1&season=${season}&gameType=R&teamId=${a}&opponentId=${b}` +
      `&fields=dates,games,status,abstractGameState,teams,home,away,team,id,isWinner`)
      .then(r => r.json())
      .then(d => {
        const wins: Record<number, number> = { [a]: 0, [b]: 0 }
        let games = 0
        for (const dt of d.dates ?? []) for (const g of dt.games ?? []) {
          if (g.status?.abstractGameState !== 'Final') continue
          for (const s of ['away', 'home'] as const) {
            if (g.teams?.[s]?.isWinner) { wins[Number(g.teams[s].team.id)] = (wins[Number(g.teams[s].team.id)] ?? 0) + 1; games++ }
          }
        }
        return games ? { wins, games } : null
      })
      .catch(() => null))
  }
  return h2hCache.get(key)!
}

export interface ClubRecord { wins: number; losses: number; runDiff: number }

const recordCache = new Map<number, Promise<Map<number, ClubRecord>>>()

/** Final regular-season records, read once a visit: they stopped moving on the last day of September. */
export function fetchRegularSeasonRecords(season: number): Promise<Map<number, ClubRecord>> {
  if (!recordCache.has(season)) {
    recordCache.set(season, fetchStandings(season)
      .then(divs => new Map(divs.flatMap(d => d.teams.map(t => [t.teamId, { wins: t.wins, losses: t.losses, runDiff: t.runDiff }] as const))))
      .catch(() => { recordCache.delete(season); return new Map<number, ClubRecord>() }))
  }
  return recordCache.get(season)!
}

// ─── Where the winner goes ────────────────────────────────────────────────────

// Fixed by the format, and checked against the 2026 feed: the 4-5 Wild Card winner plays the 1 seed,
// the 3-6 winner the 2 seed, and each league's two Division Series feed its Championship Series.
const FEEDS: Partial<Record<SeriesId, SeriesId>> = {
  F_2: 'D_1', F_1: 'D_2', F_4: 'D_3', F_3: 'D_4',
  D_1: 'L_1', D_2: 'L_1', D_3: 'L_2', D_4: 'L_2',
  L_1: 'W_1', L_2: 'W_1',
}
const SIBLING: Partial<Record<SeriesId, SeriesId>> = {
  D_1: 'D_2', D_2: 'D_1', D_3: 'D_4', D_4: 'D_3', L_1: 'L_2', L_2: 'L_1',
}

export interface NextRound {
  /** "ALCS", "World Series". */
  name: string
  /** The club waiting there, once there is one. */
  opponent: PsTeam | null
  /** Who it will be while it is still being decided: "CLE or CWS". */
  pending: [PsTeam, PsTeam] | null
}

/** Pure, for the tests. Null for the World Series, which feeds nothing. */
export function nextRound(b: Bracket, s: PsSeries): NextRound | null {
  const to = FEEDS[s.id]
  if (!to) return null
  const target = b.series[to]
  const name = seriesName(target)
  if (s.round === 'wc') {
    // The Division Series' top seed is set before the Wild Card is played.
    return { name, opponent: target.top.real ? target.top : null, pending: null }
  }
  const sib = b.series[SIBLING[s.id]!]
  if (sib.winnerId != null) return { name, opponent: sib.winnerId === sib.top.id ? sib.top : sib.bottom, pending: null }
  return { name, opponent: null, pending: sib.top.real && sib.bottom.real ? [sib.top, sib.bottom] : null }
}

