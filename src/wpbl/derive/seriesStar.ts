// The star of a postseason series: the champion's player with the biggest series, on the same scale
// Game Center ranks its Stars of the game on (`batStarScore` / `pitchStarScore`), summed game by
// game. Reusing that scale rather than inventing a series one means the player named here is the
// one whose games already led the stars on the box scores a reader opens from the same card.
//
// The CHAMPION'S player only. The league names no finals MVP, so this is ours, and a "Star of the
// final" from the club that lost it reads as a mistake on a card headed by the champion.
//
// Pure: lines in, one result out. No supabase, no React.

import type { WpblBattingLine, WpblPitchingLine } from '../types'
import { batStarScore, pitchStarScore, battingStatline, pitchingStatline } from './recap'

export interface SeriesStar {
  playerId: string
  kind: 'bat' | 'pitch'
  /** The series line, in Game Center's words: "8-17, 2 HR, 6 RBI" or "13 IP, 15 K, 1 ER". */
  statline: string
  /** Games the player has a line in, for "in 5 games". */
  games: number
}

const BAT_SUMS = ['ab', 'r', 'h', 'doubles', 'triples', 'hr', 'rbi', 'bb', 'so', 'hbp', 'sb', 'cs', 'sf', 'sh', 'ibb', 'gdp', 'tb', 'lob'] as const
const PITCH_SUMS = ['outs', 'bf', 'h', 'r', 'er', 'bb', 'so', 'hr', 'pitches', 'hbp', 'ibb', 'wp', 'bk', 'strikes', 'doubles', 'triples'] as const

/** Adds up one player's lines field by field. The first line supplies the rest of the shape, which
 *  the statline functions do not read. */
function sumLines<T extends object>(lines: T[], fields: readonly (keyof T)[]): T {
  const out = { ...lines[0] }
  for (const f of fields) {
    (out as Record<keyof T, unknown>)[f] = lines.reduce((s, l) => s + (Number(l[f]) || 0), 0)
  }
  return out
}

export function seriesStar(
  championId: string,
  batting: WpblBattingLine[],
  pitching: WpblPitchingLine[],
): SeriesStar | null {
  const byPlayer = <T extends { player_id: string; team_id: string | null }>(rows: T[]) => {
    const m = new Map<string, T[]>()
    for (const r of rows) {
      if (r.team_id !== championId) continue
      const list = m.get(r.player_id)
      if (list) list.push(r)
      else m.set(r.player_id, [r])
    }
    return m
  }

  let best: (SeriesStar & { score: number; tie: number }) | null = null
  const consider = (c: SeriesStar & { score: number; tie: number }) => {
    if (c.score <= 0) return
    if (!best || c.score > best.score || (c.score === best.score && c.tie > best.tie)) best = c
  }

  for (const [playerId, lines] of byPlayer(batting)) {
    const sum = sumLines(lines, BAT_SUMS)
    consider({
      playerId, kind: 'bat', statline: battingStatline(sum), games: lines.length,
      score: lines.reduce((s, l) => s + batStarScore(l), 0), tie: sum.hr * 100 + sum.h,
    })
  }
  for (const [playerId, lines] of byPlayer(pitching)) {
    const sum = sumLines(lines, PITCH_SUMS)
    consider({
      playerId, kind: 'pitch', statline: pitchingStatline(sum), games: lines.length,
      score: lines.reduce((s, l) => s + pitchStarScore(l), 0), tie: sum.so,
    })
  }

  if (!best) return null
  const { playerId, kind, statline, games } = best as SeriesStar
  return { playerId, kind, statline, games }
}
