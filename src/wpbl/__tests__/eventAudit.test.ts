import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { applyPlayCorrections, type WpblPlayCorrection } from '../playCorrections'
import { againstBaseline, auditEventCounts, eventFingerprint, type AcceptedGap } from '../derive/eventAudit'
import { isPlateAppearance } from '../league'
import type { LeagueGame, RunValuePlay } from '../../league/types'

// Every event our readers take off the play log, counted against the box score over every archived
// season (archive/, in git, so no .env). A reader change that stops counting something, a phrasing the
// log starts using, or a baseline entry left behind after a fix all fail here, on the pull request,
// rather than as a wrong number a reader spots. The nightly run (scripts/check-wpbl-event-counts.ts)
// does the same against the live database for games newer than the archive.

const ROOT = join(__dirname, '..', '..', '..')
const read = <T,>(dir: string, f: string): T[] => {
  const p = join(ROOT, 'archive', dir, f)
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : []
}
const dirs = readdirSync(join(ROOT, 'archive')).filter(d => /^wpbl-\d{4}$/.test(d))
const all = <T,>(f: string) => dirs.flatMap(d => read<T>(d, f))
const baseline = JSON.parse(readFileSync(join(ROOT, 'scripts', 'wpbl-event-baseline.json'), 'utf8')) as { accepted: AcceptedGap[] }

describe('the play log against the box score, every archived season', () => {
  const games = all<LeagueGame>('wpbl_games.json').filter(g => g.status === 'final')
  const plays = applyPlayCorrections(all<RunValuePlay>('wpbl_game_plays.json'), all<WpblPlayCorrection>('wpbl_play_corrections.json'))
  const findings = auditEventCounts({
    plays, games,
    batting: all('wpbl_batting_lines.json'), pitching: all('wpbl_pitching_lines.json'), fielding: all('wpbl_fielding_lines.json'),
  })
  const { fresh, stale } = againstBaseline(findings, baseline.accepted)

  it('has no gap nobody has accepted', () => {
    expect(fresh.map(eventFingerprint), 'a reader missed something: fix it, or accept the gap with why').toEqual([])
  })

  it('accepts nothing that is gone', () => {
    expect(stale.map(a => a.fingerprint), 'fixed: drop these from scripts/wpbl-event-baseline.json').toEqual([])
  })

  it('says why for every accepted gap', () => {
    expect(baseline.accepted.filter(a => !a.why.trim()).map(a => a.fingerprint)).toEqual([])
  })
})

const play = (over: Partial<RunValuePlay>): RunValuePlay => ({
  game_id: 'g', sequence: 0, inning: 1, half: 'top', team_id: 'away', batter_id: 'b', batter_name: 'Ann Lee',
  pitcher_id: 'p', pitcher_name: 'Ace', outs: 0, first_base: '', second_base: '', third_base: '',
  event_type: null, runs_scored: 0, narrative: null, pitch_sequence: null, ...over,
})

describe('isPlateAppearance', () => {
  it('counts a 0-0 trip the feed left without a pitch sequence', () => {
    // Both of 2026's intentional walks, and first-pitch hits and hit batters, arrived like this.
    expect(isPlateAppearance(play({ event_type: 'walk', narrative: 'Ann Lee was intentionally walked (0-0).' }))).toBe(true)
    expect(isPlateAppearance(play({ event_type: 'hit_by_pitch', narrative: 'Ann Lee hit by pitch (0-0).' }))).toBe(true)
    expect(isPlateAppearance(play({ event_type: 'single', pitch_sequence: 'X', narrative: 'Ann Lee singled (0-0 X).' }))).toBe(true)
  })

  it('leaves out a runner, the placed runner and a dropped foul ball', () => {
    expect(isPlateAppearance(play({ event_type: 'stolen_base', narrative: 'Ann Lee stole second.' }))).toBe(false)
    expect(isPlateAppearance(play({ event_type: 'unknown', narrative: 'Bo Diaz Ann Lee placed on second (0-0).' }))).toBe(false)
    expect(isPlateAppearance(play({ event_type: 'unknown', narrative: 'Ann Lee Dropped foul ball, E2 (0-0).' }))).toBe(false)
  })
})

describe('auditEventCounts', () => {
  const games: LeagueGame[] = [{ id: 'g', game_date: '2026-08-01', status: 'final', game_type: 'R', counts_in_standings: true,
    home_team_id: 'home', away_team_id: 'away', home_score: 0, away_score: 0 }]
  const box = (over: object) => ({ game_id: 'g', player_id: 'b', team_id: 'away', h: 0, doubles: 0, triples: 0, hr: 0, bb: 0,
    so: 0, hbp: 0, sb: 0, cs: 0, sf: 0, sh: 0, ...over })
  const pit = (over: object) => ({ game_id: 'g', player_id: 'p', team_id: 'home', h: 0, hr: 0, bb: 0, so: 0, hbp: 0, wp: 0, bk: 0, ...over })

  it('reports an event the box counts and the log does not', () => {
    const plays = [play({ event_type: 'groundout', pitch_sequence: 'X', narrative: 'Ann Lee grounded out to ss (0-0 X).' })]
    const f = auditEventCounts({ plays, games, batting: [box({ hbp: 1 })], pitching: [pit({ hbp: 1 })], fielding: [] })
    expect(f.map(x => `${x.who}:${x.event}:${x.log}:${x.box}`)).toEqual(['batter:hbp:0:1', 'pitcher:hbp:0:1'])
  })

  it('counts a balk the way the box does, once per runner it moved', () => {
    const plays = [
      play({ event_type: 'single', pitch_sequence: 'X', narrative: 'Ann Lee singled (0-0 X).' }),
      play({ sequence: 1, narrative: 'Ann Lee advanced to second on a balk; Bo Diaz scored on a balk.' }),
    ]
    const f = auditEventCounts({ plays, games, batting: [box({ h: 1 })], pitching: [pit({ h: 1, bk: 2 })], fielding: [] })
    expect(f).toEqual([])
  })
})
