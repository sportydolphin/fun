import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkTimeline } from '../../league/liveField'
import { buildWpblTimeline } from '../liveField'
import { applyPlayCorrections, type WpblPlayCorrection } from '../playCorrections'
import type { WpblGame, WpblGamePlay } from '../types'

// Every 2026 final, from the frozen season files in archive/ (in git, so no .env).
const DIR = join(__dirname, '..', '..', '..', 'archive')
const read = <T,>(f: string): T => JSON.parse(readFileSync(join(DIR, f), 'utf8'))
const games = read<WpblGame[]>('wpbl-2026/wpbl_games.json').filter(g => g.status === 'final')
const corrections = read<WpblPlayCorrection[]>('wpbl-2026/wpbl_play_corrections.json')
const plays = applyPlayCorrections(read<WpblGamePlay[]>('wpbl-2026/wpbl_game_plays.json'), corrections)
const batting = read<{ game_id: string; player_id: string; team_id: string | null; position: string | null; batting_order: number | null }[]>('wpbl-2026/wpbl_batting_lines.json')
const pitching = read<{ game_id: string; player_id: string; team_id: string | null; gs: number }[]>('wpbl-2026/wpbl_pitching_lines.json')
const players = read<{ id: string; name: string }[]>('wpbl/wpbl_players.json')

function build(g: WpblGame) {
  return buildWpblTimeline({
    game: g,
    plays: plays.filter(p => p.game_id === g.id),
    battingLines: batting.filter(l => l.game_id === g.id),
    pitchingLines: pitching.filter(l => l.game_id === g.id),
    players,
  })
}

/**
 * The one hole in the 2026 field, and it is the league's: on Sep 9 (e385b272) the play log says
 * "Jamie Mackay to p for Michelle Roche" in the 6th, which empties left field, and nothing ever
 * fills it; the box score has Mackay in left all game and Thaima Maximiliana going from left to
 * the mound. The two accounts cannot both be right, so the frames show left field empty from
 * there rather than pick one.
 */
const KNOWN_HOLES: Record<string, { from: number; position: string }> = {
  e385b272: { from: 6, position: 'LF' },
}

describe('live field: every WPBL final of 2026', () => {
  it('has 40', () => expect(games).toHaveLength(40))

  it.each(games.map(g => [`${g.game_date} ${g.id.slice(0, 8)}`, g] as const))('%s', (_, g) => {
    const t = build(g)
    const linescore = (g.away_line ?? []).map((a, k) => ({ inning: a.inning, away: a.runs, home: g.home_line?.[k]?.runs ?? null }))
    expect(checkTimeline(t, { linescore })).toEqual([])
    const last = t.frames[t.frames.length - 1]
    expect([last.away, last.home]).toEqual([g.away_score, g.home_score])
    expect(t.final).toBe(true)

    // Who the feed says threw each plate appearance is who the frames have on the mound.
    const rows = new Map(plays.filter(p => p.game_id === g.id).map(p => [p.sequence, p]))
    for (const f of t.frames) {
      const row = rows.get(f.atBat)!
      if (f.result && row.pitcher_id) expect(f.pitcher, `frame ${f.index}`).toBe(row.pitcher_id)
    }

    const hole = KNOWN_HOLES[g.id.slice(0, 8)]
    for (const f of t.frames) {
      const missing = (['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'] as const).filter(p => !f.defense[p])
      const allowed = hole && f.inning >= hole.from && f.half === 'top' ? [hole.position] : []
      expect(missing, `frame ${f.index}, ${f.inning} ${f.half}`).toEqual(missing.filter(m => allowed.includes(m)))
    }
  })

  it('reads the play log without guessing at most moves', () => {
    const moves = games.flatMap(g => build(g).frames.flatMap(f => f.moves))
    const inferred = moves.filter(m => m.inferred).length
    expect(moves.length).toBeGreaterThan(2500)
    // Measured Nov 8, 2026: the guesses are the empty rows of Aug 20 and the forced runners in
    // them. A jump here is the narrative parser losing a phrase.
    expect(inferred / moves.length).toBeLessThan(0.02)
  })
})

describe('live field: a WPBL game read mid-game builds the start of the final one', () => {
  // Not the game in KNOWN_HOLES: its box score has a tenth batting slot, so which line started
  // in left field depends on who had batted by then, and the starters differ by the cut.
  it.each(games.filter(g => !KNOWN_HOLES[g.id.slice(0, 8)]).map(g => [g.id.slice(0, 8), g] as const))('%s', (_, g) => {
    const final = build(g)
    const rows = plays.filter(p => p.game_id === g.id).sort((a, b) => a.sequence - b.sequence)
    for (const share of [0.25, 0.5, 0.75]) {
      const cut = rows[Math.floor(rows.length * share)].sequence
      // The box score as it stood then: a substitute who comes in later has no line yet.
      const nameOf = new Map(players.map(p => [p.id, p.name.toLowerCase()]))
      const laterSubs = rows.filter(p => p.sequence > cut).map(p => (p.narrative ?? '').toLowerCase())
        .filter(n => / for /.test(n) && !/ to p\b/.test(n))
      const battedBy = new Set(rows.filter(p => p.sequence <= cut).map(p => p.batter_id))
      const entersLater = (id: string) => !battedBy.has(id) && laterSubs.some(n => nameOf.has(id) && n.startsWith(nameOf.get(id)!))
      const live = buildWpblTimeline({
        game: { ...g, status: 'live' },
        plays: rows.filter(p => p.sequence <= cut),
        battingLines: batting.filter(l => l.game_id === g.id && !entersLater(l.player_id)),
        pitchingLines: pitching.filter(l => l.game_id === g.id),
        players,
      })
      expect(live.final).toBe(false)
      expect(checkTimeline(live)).toEqual([])
      // Everything before the newest row's plate appearance is settled: the newest row has no row
      // after it yet, so its runners come from the narrative alone until the next poll.
      const newest = live.frames[live.frames.length - 1].atBat
      for (const f of live.frames.filter(f => f.atBat !== newest)) expect(f, `frame ${f.index}`).toEqual(final.frames[f.index])
    }
  })
})
