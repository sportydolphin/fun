import { describe, it, expect } from 'vitest'
import { computeStandings } from '../api'
import { seedingRace, semifinalLabel, bracketIsSet, magicOver } from '../derive/seeding'
import type { WpblGame, WpblStandingRow, WpblTeam } from '../types'

// The seeding race is the only frame the last regular-season games have. All four clubs
// qualify, so nothing here is about making the playoffs and everything is about which pairing
// you land in. These pin the two claims a fan will repeat out loud: "they need N more" and
// "they can't finish below third". Both are stated OUTRIGHT, with no head-to-head tiebreak
// leaned on, so a magic number that reaches 0 can never be undone by a tiebreak going the
// other way.

const team = (id: string): WpblTeam => ({
  id, city: id, name: id, abbr: id,
  color: null, color_secondary: null, logo_url: null,
  sort_order: 0, api_id: null, created_at: '',
})
const TEAMS = ['SF', 'NY', 'LA', 'BOS'].map(team)

let seq = 0
const game = (home: string, away: string, hs: number | null, as: number | null): WpblGame => ({
  id: `g${seq++}`,
  game_date: `2026-08-${String((seq % 28) + 1).padStart(2, '0')}`, start_time: '6:30 PM',
  home_team_id: home, away_team_id: away,
  venue: null,
  status: hs == null ? 'scheduled' : 'final',
  home_score: hs, away_score: as, innings: 7, notes: null,
  created_at: '', updated_at: '',
  game_type: 'regular', counts_in_standings: true,
})

// Records straight into standings rows rather than reverse-engineering a fixture list that
// produces them. `seedingRace` takes the rows as given (they arrive pre-sorted and pre-broken
// from `computeStandings`), so a scenario is exactly a table of records plus games left.
type Spec = { id: string; w: number; l: number; left: number }

const rowFor = (s: Spec): WpblStandingRow => ({
  team: team(s.id), wins: s.w, losses: s.l, runsFor: 0, runsAgainst: 0,
  pct: s.w + s.l ? s.w / (s.w + s.l) : 0,
  gamesBack: 0, streak: null, lastTen: { wins: 0, losses: 0 }, recent: [],
})

// The unplayed games each club has left. The opponent is a club outside the four, which the
// remaining-count ignores, so a spec can give each club its own number without having to
// balance a real schedule.
const race = (spec: Spec[]) => {
  const games: WpblGame[] = []
  for (const s of spec) for (let i = 0; i < s.left; i++) games.push(game(s.id, 'XX', null, null))
  return seedingRace(spec.map(rowFor), games)
}

// The standard mid-race shape: SF clear, NY second, LA and BOS trailing, three games each left.
const MID: Spec[] = [
  { id: 'SF', w: 10, l: 2, left: 3 },
  { id: 'NY', w: 8, l: 4, left: 3 },
  { id: 'LA', w: 5, l: 7, left: 3 },
  { id: 'BOS', w: 3, l: 9, left: 3 },
]

describe('magicOver', () => {
  it('counts down on either a win or a rival loss', () => {
    expect(magicOver({ wins: 8 }, { maxWins: 12 })).toBe(5)
    expect(magicOver({ wins: 9 }, { maxWins: 12 })).toBe(4)  // won one
    expect(magicOver({ wins: 8 }, { maxWins: 11 })).toBe(4)  // rival lost one
  })

  it('reaches 0 only once the rival cannot match the win total, tiebreak or not', () => {
    expect(magicOver({ wins: 10 }, { maxWins: 10 })).toBe(1) // a tie is still possible
    expect(magicOver({ wins: 11 }, { maxWins: 10 })).toBe(0)
  })

  it('never goes negative once the race is long over', () => {
    expect(magicOver({ wins: 15 }, { maxWins: 4 })).toBe(0)
  })
})

describe('seedingRace', () => {
  it('numbers the seeds in standings order and pairs them 1v4, 2v3', () => {
    const rows = race(MID)
    expect(rows.map(r => [r.team.id, r.seed])).toEqual([['SF', 1], ['NY', 2], ['LA', 3], ['BOS', 4]])
    expect(rows.map(r => r.opponent?.id)).toEqual(['BOS', 'LA', 'NY', 'SF'])
  })

  // The seeds have to be whatever `computeStandings` says, tiebreaks included, or the card
  // could contradict the table it sits under.
  it('takes its order from computeStandings rather than re-deriving one', () => {
    const games = [
      game('BOS', 'SF', 6, 1), game('BOS', 'NY', 6, 1), game('BOS', 'LA', 6, 1),
      game('SF', 'NY', 4, 3), game('LA', 'NY', 4, 3),
      game('SF', 'LA', null, null),
    ]
    const rows = seedingRace(computeStandings(TEAMS, games), games)
    expect(rows[0].team.id).toBe('BOS')
    expect(rows[0].seed).toBe(1)
    expect(rows[0].opponent?.id).toBe(rows[3].team.id)
    expect(rows.find(r => r.team.id === 'SF')!.remaining).toBe(1)
  })

  it('counts scheduled and live games as still to be played, and finals as gone', () => {
    const games = [
      game('SF', 'NY', 5, 2),
      game('SF', 'LA', null, null),
      { ...game('SF', 'BOS', null, null), status: 'live' as const },
    ]
    const sf = seedingRace([rowFor({ id: 'SF', w: 1, l: 0, left: 0 })], games)[0]
    expect(sf.remaining).toBe(2)
    expect(sf.maxWins).toBe(3)
  })

  it('ignores postseason games, which are the thing being seeded', () => {
    const games = [
      game('SF', 'NY', 5, 2),
      { ...game('SF', 'NY', null, null), game_type: 'semifinal', counts_in_standings: false },
    ]
    const sf = seedingRace([rowFor({ id: 'SF', w: 1, l: 0, left: 0 })], games)[0]
    expect(sf.remaining).toBe(0)
  })

  it('quotes games ahead of the seed below and behind the seed above', () => {
    const rows = race(MID)
    expect(rows[0].aheadOfNext).toBe(2)
    expect(rows[0].behindPrev).toBeNull()
    expect(rows[1].behindPrev).toBe(2)
    expect(rows[3].aheadOfNext).toBeNull()
  })

  // The bottom seed has nobody to hold off, so "clinch no worse than fourth" is not a claim
  // worth printing. null keeps that out of the UI rather than rendering a permanent 0.
  it('gives the bottom seed no magic number', () => {
    expect(race(MID)[3].magic).toBeNull()
  })

  // Locking the top seed means holding off all three; locking second means holding off two,
  // so it can be clinched while the top seed is still live.
  it('prices the top seed against every rival and second against the cheapest two', () => {
    const rows = race([
      { id: 'SF', w: 11, l: 1, left: 3 },
      { id: 'NY', w: 9, l: 3, left: 3 },
      { id: 'LA', w: 4, l: 8, left: 3 },
      { id: 'BOS', w: 2, l: 10, left: 3 },
    ])
    // SF must clear NY's ceiling of 12: 12 - 11 + 1 = 2.
    expect(rows[0].magic).toBe(2)
    // NY is already clear of LA (7) and BOS (5), so second is locked even though first is not.
    expect(rows[1].magic).toBe(0)
    expect(rows[1].worstPossible).toBe(2)
  })

  it('reports the range of seeds still reachable', () => {
    const rows = race([
      { id: 'SF', w: 12, l: 0, left: 3 },
      { id: 'NY', w: 6, l: 6, left: 3 },
      { id: 'LA', w: 5, l: 7, left: 3 },
      { id: 'BOS', w: 1, l: 11, left: 3 },
    ])
    const sf = rows[0], bos = rows[3]
    expect([sf.bestPossible, sf.worstPossible]).toEqual([1, 1])   // untouchable
    expect([bos.bestPossible, bos.worstPossible]).toEqual([4, 4]) // and unreachable
    // NY and LA are a game apart with three each left, so either can take second or third.
    expect([rows[1].bestPossible, rows[1].worstPossible]).toEqual([2, 3])
    expect([rows[2].bestPossible, rows[2].worstPossible]).toEqual([2, 3])
  })

  it('settles the bracket only when no club can move', () => {
    expect(bracketIsSet(race(MID))).toBe(false)

    const done = race([
      { id: 'SF', w: 11, l: 4, left: 0 },
      { id: 'NY', w: 9, l: 6, left: 0 },
      { id: 'LA', w: 6, l: 9, left: 0 },
      { id: 'BOS', w: 4, l: 11, left: 0 },
    ])
    expect(bracketIsSet(done)).toBe(true)
    expect(done.every(r => r.magic === null || r.magic === 0)).toBe(true)
  })

  // A tie on the final day is settled by the standings tiebreak, not by this module's
  // "outright" range math, which puts both clubs on the LOWER of their two seeds. What must
  // hold is that the card still reads as finished rather than running a magic-number countdown
  // through the postseason it is meant to be introducing.
  it('settles a season that ended with two clubs level on record', () => {
    const done = race([
      { id: 'SF', w: 11, l: 4, left: 0 },
      { id: 'NY', w: 8, l: 7, left: 0 },
      { id: 'LA', w: 8, l: 7, left: 0 },
      { id: 'BOS', w: 3, l: 12, left: 0 },
    ])
    expect(bracketIsSet(done)).toBe(true)
    // Seeds come from the sort, so the tie is already broken by the time the card sees it.
    expect(done.map(r => [r.team.id, r.seed])).toEqual([['SF', 1], ['NY', 2], ['LA', 3], ['BOS', 4]])
  })

  // The two clubs that would meet are never adjacent on a list sorted by seed, so the letter
  // is the only thing pairing them on screen.
  it('marks the two clubs of a semifinal with the same letter', () => {
    expect([1, 2, 3, 4].map(semifinalLabel)).toEqual(['A', 'B', 'B', 'A'])
    expect(semifinalLabel(5)).toBeNull()
  })

  // Before a pitch is thrown every club is 0-0 and the sort is arbitrary, so the card must not
  // claim anything: every seed is reachable by everyone.
  it('says nothing is decided on opening day', () => {
    const rows = race([
      { id: 'SF', w: 0, l: 0, left: 15 },
      { id: 'NY', w: 0, l: 0, left: 15 },
      { id: 'LA', w: 0, l: 0, left: 15 },
      { id: 'BOS', w: 0, l: 0, left: 15 },
    ])
    for (const r of rows) {
      expect(r.bestPossible).toBe(1)
      expect(r.worstPossible).toBe(4)
    }
    expect(bracketIsSet(rows)).toBe(false)
  })
})
