import { describe, it, expect } from 'vitest'
// The .mjs cron script imported rather than reimplemented, for the reason trackingWatch.test
// gives: a copy of the comparison living here would keep passing while the script it mirrors
// drifted, which is the exact failure this checker exists to catch.
import { diffGame } from '../../scripts/check-wpbl-drift.mjs'

// A play as the feed sends it. Only the fields the digest reads are filled in.
type Play = Record<string, unknown>
const play = (seq: number, over: Play = {}): Play => ({
  sequence: seq, inning: 1, half: 'top', batter_name: 'Ayuri Shimano', pitcher_name: 'Olivia Bricker',
  outs: 0, first_base: '', second_base: '', third_base: '', bases_loaded: false,
  narrative: 'Ayuri Shimano singled to left field (1-1 BF).', event_type: 'single',
  is_hit: true, is_scoring_play: false, runs_scored: 0, pitch_sequence: 'BF',
  balls: 1, strikes: 1, fouls: 0, ...over,
})

// The digest as the SQL builds it: the sequence, then the same fields in the same order, joined
// by \u0001. Written out by hand rather than imported, so the field ORDER is pinned by something
// other than the code under test.
const digest = (p: Play): string => [
  p.sequence, p.inning, p.half, p.batter_name, p.pitcher_name, p.outs,
  p.first_base, p.second_base, p.third_base, p.bases_loaded ? 1 : 0,
  p.narrative, p.event_type, p.is_hit ? 1 : 0, p.is_scoring_play ? 1 : 0,
  p.runs_scored, p.pitch_sequence, p.balls, p.strikes, p.fouls,
].join('\u0001')

// This checker's whole value is that it can answer "yes, we are in sync" and be believed. A
// comparison that silently matches everything answers that too, and looks identical from the
// outside on a day when nothing has drifted, which is most days. So the cases below are all
// about it noticing.

const box = (over: Record<string, unknown> = {}) => ({
  status: { complete: true },
  source_updated_at: '2026-08-24T02:33:01Z',
  plays: [play(1), play(2, { narrative: 'Ayuri Shimano scored.', event_type: 'unknown', is_hit: false })],
  teams: [
    {
      side: 'away',
      totals: { runs: 9, hits: 12, errors: 1 },
      players: [
        { spot: 1, hitting: { ab: 4, r: 2, h: 2, rbi: 1, bb: 1, so: 0, hr: 0, double: 1, triple: 0, sb: 0 } },
        { spot: 2, hitting: { ab: 4, r: 1, h: 1, rbi: 3, bb: 0, so: 1, hr: 1, double: 0, triple: 0, sb: 0 } },
        { pitching: { ip: '5.2', h: 6, r: 4, er: 3, bb: 2, so: 7, hr: 1 } },
      ],
    },
    {
      side: 'home',
      totals: { runs: 4, hits: 7, errors: 0 },
      players: [
        { spot: 1, hitting: { ab: 3, r: 0, h: 1, rbi: 0, bb: 1, so: 1, hr: 0, double: 0, triple: 0, sb: 1 } },
        { pitching: { ip: '7.0', h: 12, r: 9, er: 8, bb: 3, so: 4, hr: 1 } },
      ],
    },
  ],
  ...over,
})

// What the SQL in the script hands back for the same game: aggregates as arrays of the same
// dash-joined lines, in whatever order Postgres felt like.
const row = (over: Record<string, unknown> = {}) => ({
  status: 'final',
  away_score: 9, home_score: 4,
  away_hits: 12, home_hits: 7,
  away_errors: 1, home_errors: 0,
  play_digests: [
    digest(play(1)),
    digest(play(2, { narrative: 'Ayuri Shimano scored.', event_type: 'unknown', is_hit: false })),
  ],
  batting: ['4-1-1-3-0-1-1-0-0-0', '3-0-1-0-1-1-0-0-0-1', '4-2-2-1-1-0-0-1-0-0'],
  pitching: ['21-12-9-8-3-4-1', '17-6-4-3-2-7-1'],
  source_updated_at: '2026-08-24 02:33:01+00',
  ...over,
})

describe('diffGame', () => {
  it('is quiet when the mirror matches the feed', () => {
    expect(diffGame(box(), row())).toEqual([])
  })

  it('sees a corrected final score', () => {
    const d = diffGame(box(), row({ away_score: 8 }))
    expect(d).toEqual([{ field: 'away_score', feed: 9, ours: 8 }])
  })

  it('sees a corrected hit total even when the score is untouched', () => {
    expect(diffGame(box(), row({ home_hits: 6 })).map(x => x.field)).toEqual(['home_hits'])
  })

  it('sees a play added to or removed from the league play log', () => {
    const short = row({ play_digests: [digest(play(1))] })
    const d = diffGame(box(), short)
    expect(d.map(x => x.field)).toEqual(['play rows'])
    expect(d[0].feed).toBe('2 rows')
    expect(d[0].ours).toContain('1 rows')
    expect(d[0].ours).toContain('sequence 2')
  })

  // THE ONE THE ROW COUNT COULD NOT SEE. A league re-score rewrites a narrative and leaves the
  // number of rows alone, which is how the first version of this checker reported "no drift" on
  // a game whose play log had changed under it.
  it('sees a rewritten narrative on a play log of unchanged length', () => {
    const rescored = row({
      play_digests: [digest(play(1)), digest(play(2, { narrative: 'Ayuri Shimano scored on a fielding error.', event_type: 'unknown', is_hit: false }))],
    })
    const d = diffGame(box(), rescored)
    expect(d.map(x => x.field)).toEqual(['play rows'])
    expect(d[0].ours).toContain('1 not matching at sequence 2')
  })

  it('sees a base-out state repaired underneath an unchanged narrative', () => {
    const repaired = row({ play_digests: [digest(play(1, { outs: 2 })), digest(play(2, { narrative: 'Ayuri Shimano scored.', event_type: 'unknown', is_hit: false }))] })
    expect(diffGame(box(), repaired).map(x => x.field)).toEqual(['play rows'])
  })

  // Names, not ids: the ingest resolves the feed's players against our roster, so a merge or a
  // trade changes `batter_id` here with nothing having changed at the league. Comparing ids
  // would report our own bookkeeping as league drift, every night, until someone stopped reading.
  it('ignores the resolver-derived columns entirely', () => {
    const withIds = row()
    ;(withIds as Record<string, unknown>).batter_id = 'some-uuid'
    expect(diffGame(box(), withIds)).toEqual([])
  })

  // The reason the batting lines are compared as a multiset and not only as a team total: a
  // hit moved from one player to another leaves every team number identical, and that is a
  // correction readers see on a player page.
  it('sees a hit re-credited from one batter to another', () => {
    const moved = row({ batting: ['4-1-2-3-0-1-1-0-0-0', '3-0-1-0-1-1-0-0-0-1', '4-2-1-1-1-0-0-1-0-0'] })
    expect(diffGame(box(), moved).map(x => x.field)).toEqual(['batting'])
  })

  it('sees a rescored earned run against a pitcher', () => {
    const moved = row({ pitching: ['21-12-9-8-3-4-1', '17-6-4-4-2-7-1'] })
    expect(diffGame(box(), moved).map(x => x.field)).toEqual(['pitching'])
  })

  // The stamp is the early warning: it moves on any revision, including ones to fields this
  // does not mirror, so it is worth a re-ingest even when nothing else disagrees.
  it('sees a revision stamp that moved on its own', () => {
    const d = diffGame(box(), row({ source_updated_at: '2026-08-08 01:56:16+00' }))
    expect(d).toEqual([{
      field: 'source_updated_at',
      feed: '2026-08-24T02:33:01.000Z',
      ours: '2026-08-08T01:56:16.000Z',
    }])
  })

  // Postgres and the feed spell the same instant differently. Comparing the strings would
  // report every game as drifted, every night, which is indistinguishable from being broken.
  it('does not mistake a timestamp spelling for a revision', () => {
    expect(diffGame(box({ source_updated_at: '2026-08-24T02:33:01.000Z' }), row())).toEqual([])
  })

  it('flags a game the feed calls complete that we still hold as live', () => {
    expect(diffGame(box(), row({ status: 'live' }))).toEqual([{ field: 'status', feed: 'final', ours: 'live' }])
  })

  // Bench players carry a hitting object full of zeros and no lineup spot. The ingest does not
  // store those, so counting them here would report a missing line on every game forever.
  it('ignores players the ingest never stores a line for', () => {
    const withBench = box()
    withBench.teams[1].players.push({ spot: 0, hitting: { ab: 0, r: 0, h: 0, rbi: 0, bb: 0, so: 0, hr: 0, double: 0, triple: 0, sb: 0 } } as never)
    expect(diffGame(withBench, row())).toEqual([])
  })
})
