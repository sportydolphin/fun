// One World Cup game's page file: the line score, the box score and the play by play in our own
// words (playText.ts). Written by `npm run wbsc -- --site` beside the edition files (editions.ts),
// under the same promise: what is here is what publication commits, so it is built field by field
// and carries no scorer sentence.

import type { LineScoreEntry, PitchingGameLine, RunValuePlay } from '../../league/types'
import type { PersonLookup } from './editionLeaders'
import type { WbscBattingLine, WbscGame } from './game'
import { gamePlayTexts } from './playText'

export interface BoxBatter {
  name: string
  /** The player's page, WPBL's or the World Cup's (`PersonLookup.path`). */
  path: string | null
  /** As WBSC wrote it ("CF", "PH/LF"), upper-cased. */
  pos: string
  /** The lineup spot; a substitute shares the starter's. */
  spot: number
  sub: boolean
  ab: number
  r: number
  h: number
  rbi: number
  bb: number
  so: number
  /** WPBL's box score carries these three too (src/wpbl/gameDetail/shared.tsx), so the two read alike.
   *  Optional only so a file built before them still reads. */
  hr?: number
  doubles?: number
  sb?: number
}

export interface BoxPitcher {
  name: string
  path: string | null
  outs: number
  h: number
  r: number
  er: number
  bb: number
  so: number
  hr?: number
  /** W, L or S. */
  decision: string | null
}

export interface HalfInning {
  inning: number
  half: 'top' | 'bottom'
  /** The batting side. */
  team: string
  plays: { text: string; runs: number }[]
}

export interface WorldCupGameFile {
  id: string
  wbsc_game_id: number
  edition: string
  round: string | null
  date: string
  venue: string | null
  city: string | null
  attendance: number | null
  duration_minutes: number | null
  away: string
  home: string
  away_score: number
  home_score: number
  innings: number
  away_line: LineScoreEntry[]
  home_line: LineScoreEntry[]
  away_hits: number
  home_hits: number
  away_errors: number
  home_errors: number
  batting: { away: BoxBatter[]; home: BoxBatter[] }
  pitching: { away: BoxPitcher[]; home: BoxPitcher[] }
  /** Empty for a game WBSC kept no play log for. */
  halves: HalfInning[]
  /** The box score on wbsc.org. */
  url: string
}

export function buildGameFile(
  game: WbscGame,
  lines: { batting: readonly WbscBattingLine[]; pitching: readonly PitchingGameLine[]; plays: readonly RunValuePlay[] },
  edition: string,
  source: string,
  people: PersonLookup,
): WorldCupGameFile {
  const named = (id: string) => {
    const wpbl = people.wpbl(id)
    return { name: wpbl?.name ?? people.name(id), path: people.path(id) }
  }
  const batting = lines.batting.filter(l => l.game_id === game.id)
  const pitching = lines.pitching.filter(l => l.game_id === game.id)

  // Every player goes by one name across the site (the roster's for a WPBL player, the registry's
  // for anyone else), in the play text too. The play log names people, not ids, on the bases, so the
  // rename goes by the name this event's rows write, within this game alone, where two players
  // never share one.
  const rename = new Map<string, string>()
  for (const l of [...batting, ...pitching]) rename.set(people.eventName(l.player_id), named(l.player_id).name)
  const as = (n: string | null) => (n ? rename.get(n) ?? n : n)
  const plays = lines.plays.filter(p => p.game_id === game.id).sort((a, b) => a.sequence - b.sequence)
    .map(p => ({
      ...p, batter_name: as(p.batter_name), pitcher_name: as(p.pitcher_name),
      first_base: as(p.first_base), second_base: as(p.second_base), third_base: as(p.third_base),
    }))
  const texts = gamePlayTexts(plays)
  const firstPitch = new Map<string, number>()
  for (const p of plays) if (p.pitcher_id && !firstPitch.has(p.pitcher_id)) firstPitch.set(p.pitcher_id, p.sequence)

  const halves: HalfInning[] = []
  plays.forEach((p, i) => {
    let h = halves[halves.length - 1]
    if (!h || h.inning !== p.inning || h.half !== p.half) {
      h = { inning: p.inning, half: p.half, team: p.half === 'top' ? game.away_team_id : game.home_team_id, plays: [] }
      halves.push(h)
    }
    h.plays.push({ text: texts[i], runs: p.runs_scored ?? 0 })
  })

  const side = (team: string) => {
    const seen = new Set<number>()
    const bat = batting.filter(l => l.team_id === team)
      .map((l, i) => ({ l, i }))
      .sort((a, b) => a.l.spot - b.l.spot || a.i - b.i)
      .map(({ l }): BoxBatter => {
        const sub = seen.has(l.spot)
        seen.add(l.spot)
        return {
          ...named(l.player_id), pos: String(l.position ?? '').toUpperCase(), spot: l.spot, sub,
          ab: l.ab, r: l.r, h: l.h, rbi: l.rbi, bb: l.bb, so: l.so, hr: l.hr, doubles: l.doubles, sb: l.sb,
        }
      })
    // In the order they pitched: WBSC's rows are not, so the closer can come first. The play log's
    // first pitch decides, and the starter (`gs`) leads a game without one.
    const pit = pitching.filter(l => l.team_id === team)
      .map((l, i) => ({ l, i, first: firstPitch.get(l.player_id) ?? Number.MAX_SAFE_INTEGER }))
      .sort((a, b) => (b.l.gs ?? 0) - (a.l.gs ?? 0) || a.first - b.first || a.i - b.i)
      .map(({ l }): BoxPitcher => ({
      ...named(l.player_id), outs: l.outs, h: l.h, r: l.r, er: l.er, bb: l.bb, so: l.so, hr: l.hr,
      decision: l.decision === 'W' || l.decision === 'L' || l.decision === 'S' ? l.decision : null,
    }))
    return { bat, pit }
  }
  const [away, home] = [side(game.away_team_id), side(game.home_team_id)]

  return {
    id: game.id, wbsc_game_id: game.wbsc_game_id, edition, round: game.round, date: game.game_date,
    venue: game.venue, city: game.city, attendance: game.attendance, duration_minutes: game.duration_minutes,
    away: game.away_team_id, home: game.home_team_id, away_score: game.away_score ?? 0, home_score: game.home_score ?? 0,
    innings: game.innings,
    away_line: game.away_line ?? [], home_line: game.home_line ?? [],
    away_hits: game.away_hits, home_hits: game.home_hits, away_errors: game.away_errors, home_errors: game.home_errors,
    batting: { away: away.bat, home: home.bat },
    pitching: { away: away.pit, home: home.pit },
    halves,
    url: `${source}/box-score/${game.wbsc_game_id}`,
  }
}
