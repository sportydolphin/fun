import { describe, it, expect } from 'vitest'
// The .mjs cron script imported rather than reimplemented, for the reason wpblDrift.test gives:
// a copy of the comparison living here would keep passing while the script it mirrors drifted.
import { revisionEntry, revisionChanges } from '../../scripts/check-wpbl-drift.mjs'

// These cases are about the ONE property this whole feature rests on: the changelog is written
// at the only moment both versions of the scoring exist, so anything it fails to notice is not
// wrong today, it is unrecoverable. A diff that quietly reports nothing looks identical from the
// outside to a night when the league changed nothing, which is most nights.

type Bag = Record<string, unknown>

const hitting = (over: Bag = {}) => ({
  ab: 4, r: 1, h: 2, double: 0, triple: 0, hr: 0, rbi: 1, bb: 0, so: 1,
  hbp: 0, sb: 0, cs: 0, sf: 0, sh: 0, ibb: 0, hitdp: 0, lob: 1, ...over,
})
const pitchingFeed = (over: Bag = {}) => ({
  ip: '6.0', h: 5, r: 2, er: 2, bb: 1, so: 6, hr: 1, hbp: 0, ibb: 0, wp: 0, bk: 0,
  win: true, ...over,
})

const play = (seq: number, over: Bag = {}) => ({
  sequence: seq, inning: 6, half: 'bottom', batter_name: 'Val Perez', pitcher_name: 'Kaia Fry',
  outs: 1, first_base: '', second_base: '', third_base: '', bases_loaded: false,
  narrative: 'Val Perez singled to left field.', event_type: 'single',
  is_hit: true, is_scoring_play: false, runs_scored: 0, pitch_sequence: 'BF',
  balls: 1, strikes: 1, fouls: 0, ...over,
})

// The digest exactly as the SQL builds it: the sequence, then the fields in order, joined by \u0001.
// Written by hand so the field ORDER is pinned by something other than the code
// under test, the same bargain wpblDrift.test makes.
const digest = (p: Bag): string => [
  p.sequence, p.inning, p.half, p.batter_name, p.pitcher_name, p.outs,
  p.first_base, p.second_base, p.third_base, p.bases_loaded ? 1 : 0,
  p.narrative, p.event_type, p.is_hit ? 1 : 0, p.is_scoring_play ? 1 : 0,
  p.runs_scored, p.pitch_sequence, p.balls, p.strikes, p.fouls,
].join('\u0001')

const box = (over: Bag = {}) => ({
  status: { complete: true },
  source_updated_at: '2026-08-24T02:33:01Z',
  plays: [play(1)],
  teams: [
    {
      side: 'away', totals: { runs: 3, hits: 7, errors: 0 },
      players: [
        { id: 'feed-perez', name: 'Val Perez', spot: 3, hitting: hitting() },
        { id: 'feed-fry', name: 'Kaia Fry', pitching: pitchingFeed() },
      ],
    },
    { side: 'home', totals: { runs: 2, hits: 5, errors: 1 }, players: [] },
  ],
  ...over,
})

const row = (over: Bag = {}) => ({
  status: 'final',
  away_score: 3, home_score: 2, away_hits: 7, home_hits: 5, away_errors: 0, home_errors: 1,
  source_updated_at: '2026-08-20T02:33:01Z',
  play_digests: [digest(play(1))],
  // The anonymous pair the fingerprint uses. Present because revisionChanges reads the game
  // totals through it, and absent fields would read as a change on every case below.
  batting: ['4-1-2-1-0-1-0-0-0-0'],
  pitching: ['18-5-2-2-1-6-1'],
  batting_detail: [{
    name: 'Val Perez', player_id: 'ours-perez', api_ids: ['feed-perez'],
    stats: { ab: 4, r: 1, h: 2, doubles: 0, triples: 0, hr: 0, rbi: 1, bb: 0, so: 1, hbp: 0, sb: 0, cs: 0, sf: 0, sh: 0, ibb: 0, gdp: 0, lob: 1 },
  }],
  pitching_detail: [{
    name: 'Kaia Fry', player_id: 'ours-fry', api_ids: ['feed-fry'],
    stats: { outs: 18, h: 5, r: 2, er: 2, bb: 1, so: 6, hr: 1, hbp: 0, ibb: 0, wp: 0, bk: 0, decision: 'W' },
  }],
  ...over,
})

describe('revisionChanges', () => {
  it('says nothing when the two agree', () => {
    expect(revisionChanges(box(), row())).toEqual([])
  })

  it('names the player whose line moved, and only the field that moved', () => {
    const changed = revisionChanges(box(), row({
      batting_detail: [{
        ...row().batting_detail[0],
        stats: { ...row().batting_detail[0].stats, h: 1, rbi: 0 },
      }],
    }))
    expect(changed).toEqual([
      { kind: 'batting', player: 'Val Perez', player_id: 'ours-perez', field: 'h', before: 1, after: 2 },
      { kind: 'batting', player: 'Val Perez', player_id: 'ours-perez', field: 'rbi', before: 0, after: 1 },
    ])
  })

  // The decision is the one pitching field a reader is likeliest to be looking for, and it is
  // the one that never moves as a number, so a diff built only from counting stats misses it.
  it('sees a pitcher losing the win', () => {
    const changed = revisionChanges(box({
      teams: [
        { ...box().teams[0], players: [
          { id: 'feed-perez', name: 'Val Perez', spot: 3, hitting: hitting() },
          { id: 'feed-fry', name: 'Kaia Fry', pitching: pitchingFeed({ win: false, hold: true }) },
        ] },
        box().teams[1],
      ],
    }), row())
    expect(changed).toEqual([
      { kind: 'pitching', player: 'Kaia Fry', player_id: 'ours-fry', field: 'decision', before: 'W', after: 'H' },
    ])
  })

  // A TRADED PLAYER IS STILL THE SAME PERSON. The league mints a new player_id per club, so the
  // id on this game's box score need not be the one she was first seen under. `api_ids` is what
  // holds the two together, and matching on the scalar api_id would report her line as removed
  // and somebody else's as added.
  it('follows a player across the ids the league has minted for her', () => {
    const traded = row({
      batting_detail: [{
        name: 'Val Perez', player_id: 'ours-perez', api_ids: ['old-id', 'feed-perez'],
        stats: { ...row().batting_detail[0].stats, h: 1 },
      }],
    })
    expect(revisionChanges(box(), traded)).toEqual([
      { kind: 'batting', player: 'Val Perez', player_id: 'ours-perez', field: 'h', before: 1, after: 2 },
    ])
  })

  // THE RULE THAT KEEPS A CORRECTION OFF THE WRONG PLAYER'S PAGE. An entry the league published
  // with no id cannot be matched to anybody, and the name is not a second-best key: reading one
  // as identity is what put Emi Saiki on a club she has never played for. It is reported as
  // unidentified, and the player it happens to share a name with is left alone.
  it('refuses to match a feed entry the league gave no id', () => {
    const anon = box({
      teams: [
        { ...box().teams[0], players: [{ id: '', name: 'Val Perez', spot: 3, hitting: hitting({ h: 4 }) }] },
        box().teams[1],
      ],
    })
    const changed = revisionChanges(anon, row())
    expect(changed).toContainEqual({ kind: 'batting', change: 'unidentified', player: 'Val Perez' })
    expect(changed).toContainEqual({ kind: 'batting', change: 'removed', player: 'Val Perez', player_id: 'ours-perez' })
    expect(changed.some(c => c.field === 'h')).toBe(false)
  })

  it('reports a rewritten play once, with the half-inning and the batter', () => {
    const rewritten = box({
      plays: [play(1, { narrative: 'Val Perez doubled to left field.', event_type: 'double' })],
    })
    expect(revisionChanges(rewritten, row())).toEqual([
      {
        kind: 'play', sequence: 1, inning: 6, half: 'bottom', batter: 'Val Perez',
        field: 'narrative',
        before: 'Val Perez singled to left field.', after: 'Val Perez doubled to left field.',
      },
      {
        kind: 'play', sequence: 1, inning: 6, half: 'bottom', batter: 'Val Perez',
        field: 'event_type', before: 'single', after: 'double',
      },
    ])
  })

  // `is_scoring_play` is exactly `runs_scored > 0` across every stored play, so reporting both
  // would print one fact twice and make a two-line correction look like a four-line one.
  it('does not report is_scoring_play beside runs_scored', () => {
    const scored = box({ plays: [play(1, { runs_scored: 2, is_scoring_play: true })] })
    expect(revisionChanges(scored, row()).map(c => c.field)).toEqual(['runs_scored'])
  })

  it('sees a play the league added and one it took away', () => {
    const extra = box({ plays: [play(1), play(2, { narrative: 'Kaia Fry balked.', event_type: 'balk' })] })
    expect(revisionChanges(extra, row())).toEqual([
      { kind: 'play', sequence: 2, inning: 6, half: 'bottom', batter: 'Val Perez', change: 'added' },
    ])
    expect(revisionChanges(box({ plays: [] }), row())).toEqual([
      { kind: 'play', sequence: 1, inning: 6, half: 'bottom', batter: 'Val Perez', change: 'removed' },
    ])
  })
})

describe('revisionEntry', () => {
  // The classification that decides whether this is publishable at all. A newer feed stamp is
  // the league re-scoring the game; an equal one with different rows is our mirror being wrong,
  // and calling that "the league changed the score" blames their scorer for our bug.
  it('calls a newer feed stamp a league revision', () => {
    expect(revisionEntry(box(), row()).kind).toBe('league')
  })

  it('calls an unmoved stamp a mirror fault', () => {
    const same = row({ source_updated_at: '2026-08-24T02:33:01Z', away_score: 4 })
    expect(revisionEntry(box(), same).kind).toBe('mirror')
  })

  it('carries both stamps, so the day shown is the one the league set', () => {
    const e = revisionEntry(box(), row())
    expect(e.source_updated_at).toBe('2026-08-24T02:33:01.000Z')
    expect(e.prior_source_updated_at).toBe('2026-08-20T02:33:01.000Z')
  })

  // A revision the log has no sentence for is still a revision. The fingerprint compares a
  // little more than the changelog describes, and "revised, nothing here changed" is a truthful
  // answer to a reader who can already see the date on the page above.
  it('stores a revision with no describable changes rather than dropping it', () => {
    const e = revisionEntry(box(), row())
    expect(e.changes).toEqual([])
    expect(e.change_count).toBe(0)
  })

  // A wholesale re-score must not be reported as a small one: the array is capped and
  // change_count is the true total, so the page can say how much it is not showing.
  it('caps what it stores and still counts what it saw', () => {
    const many = Array.from({ length: 200 }, (_, i) => play(i + 1))
    const e = revisionEntry(box({ plays: many }), row())
    expect(e.changes.length).toBe(80)
    expect(e.change_count).toBe(199)
  })
})
