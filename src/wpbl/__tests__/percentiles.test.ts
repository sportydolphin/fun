import { describe, it, expect } from 'vitest'
import {
  computeWpblPlayerRanks, ordinal, bestCountingRanks,
  COUNT_RANK_BAR, COUNT_RANK_ROWS, COUNT_RANK_MIN_FIELD, WPBL_PIT_COUNT_RANK_DEFS,
  type WpblStatRank,
} from '../percentiles'
import type { WpblTeam, WpblPlayer, WpblGame, WpblBattingLine, WpblPitchingLine } from '../types'

// A percentile is a claim about a population, and every trap here is a way of getting the
// population wrong: letting a 1-for-1 pinch-hitter lead the league, letting a postseason game
// into a regular-season rate, or getting the direction backwards so the best ERA draws the
// shortest bar. The season is short and the field is small, so a bad population is not a
// rounding error: it is the difference between "best in the league" and "worst".

const TEAMS: WpblTeam[] = ['BOS', 'LA', 'NY', 'SF'].map(id => ({
  id, city: id, name: id, abbr: id, created_at: '',
} as unknown as WpblTeam))

const player = (id: string): WpblPlayer => ({
  id, team_id: 'SF', name: id, position: 'OF', bats: 'R', throws: 'R',
  jersey_number: null, age: 22, hometown: null, status: 'Signed',
  draft_round: null, draft_pick: null, bio: null,
  birth_date: null, birth_date_source: null,
} as unknown as WpblPlayer)

// Enough regular-season finals that the qualifying bar switches on. Every club plays each
// game so the bar (which scales off the LEAST-played club) rises evenly.
const season = (n: number, over: Partial<WpblGame> = {}): WpblGame[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `g${i}`, game_date: `2026-08-${String(i + 1).padStart(2, '0')}`, start_time: '6:30 PM',
    home_team_id: i % 2 ? 'BOS' : 'SF', away_team_id: i % 2 ? 'LA' : 'NY',
    venue: null, status: 'final', home_score: 5, away_score: 2, innings: 7, notes: null,
    created_at: '', updated_at: '', game_type: 'regular', counts_in_standings: true,
    ...over,
  } as unknown as WpblGame))

const bat = (playerId: string, over: Partial<WpblBattingLine> = {}): WpblBattingLine => ({
  id: Math.random().toString(36).slice(2), game_id: 'g0', player_id: playerId, team_id: 'SF',
  batting_order: 1, position: 'OF',
  ab: 0, r: 0, h: 0, doubles: 0, triples: 0, hr: 0, rbi: 0, bb: 0, so: 0, hbp: 0,
  sb: 0, cs: 0, sf: 0, sh: 0, ibb: 0, gdp: 0, tb: 0, lob: 0,
  ...over,
} as WpblBattingLine)

const pit = (playerId: string, over: Partial<WpblPitchingLine> = {}): WpblPitchingLine => ({
  id: Math.random().toString(36).slice(2), game_id: 'g0', player_id: playerId, team_id: 'SF',
  outs: 0, bf: null, h: 0, r: 0, er: 0, bb: 0, so: 0, hr: 0, pitches: null, decision: null,
  gs: 0, hbp: 0, ibb: 0, wp: 0, bk: 0, strikes: 0, doubles: 0, triples: 0,
  ...over,
} as WpblPitchingLine)

const GAMES = season(10) // 10 games per club → the bar is live and roughly 20 AB / 24 outs

describe('computeWpblPlayerRanks: the population', () => {
  it('ranks a qualified hitter against the other qualified hitters only', () => {
    const players = [player('a'), player('b'), player('c')]
    const lines = [
      bat('a', { ab: 40, h: 16, tb: 24 }), // .400
      bat('b', { ab: 40, h: 12, tb: 16 }), // .300
      bat('c', { ab: 40, h: 8,  tb: 10 }), // .200
    ]
    const r = computeWpblPlayerRanks('b', players, TEAMS, GAMES, lines, [])
    const avg = r.batting.find(x => x.key === 'avg')!
    expect(avg.rank).toBe(2)
    expect(avg.of).toBe(3)
    expect(avg.display).toBe('.300')
    expect(r.batReason).toBe('ok')
  })

  // The whole reason the qualifying bar is reused rather than reinvented. Ranked against
  // everyone with a line, this player is the best hitter in the WPBL on one swing.
  it('keeps a 1-for-1 cameo out of the field entirely', () => {
    const players = [player('a'), player('b'), player('cameo')]
    const lines = [
      bat('a', { ab: 40, h: 16, tb: 24 }),
      bat('b', { ab: 40, h: 12, tb: 16 }),
      bat('cameo', { ab: 1, h: 1, tb: 1 }), // 1.000
    ]
    const r = computeWpblPlayerRanks('a', players, TEAMS, GAMES, lines, [])
    expect(r.batting.find(x => x.key === 'avg')!.rank).toBe(1)
    expect(r.batOf).toBe(2)
  })

  it('tells the cameo she is below the bar rather than ranking her last', () => {
    const players = [player('a'), player('cameo')]
    const lines = [bat('a', { ab: 40, h: 16, tb: 24 }), bat('cameo', { ab: 1, h: 1, tb: 1 })]
    const r = computeWpblPlayerRanks('cameo', players, TEAMS, GAMES, lines, [])
    expect(r.batting).toEqual([])
    expect(r.batReason).toBe('below-bar')
  })

  it('says the season is too young rather than ranking two games of baseball', () => {
    const players = [player('a')]
    const r = computeWpblPlayerRanks('a', players, TEAMS, season(1), [bat('a', { ab: 4, h: 2 })], [])
    expect(r.batReason).toBe('season-young')
    expect(r.batting).toEqual([])
  })

  // Postseason lines must never reach a season rate. aggregateBatting filters them, and this
  // pins that the filtering is actually reaching this path.
  it('leaves postseason games out of the ranked totals', () => {
    const players = [player('a'), player('b')]
    const post = { id: 'post1', game_type: 'championship', counts_in_standings: false }
    const games = [...GAMES, ...season(1, post).map(g => ({ ...g, ...post }))]
    const lines = [
      bat('a', { ab: 40, h: 12, tb: 16 }),
      bat('a', { game_id: 'post1', ab: 10, h: 10, tb: 10 }), // a perfect playoff series
      bat('b', { ab: 40, h: 14, tb: 20 }),
    ]
    const r = computeWpblPlayerRanks('a', players, TEAMS, games as WpblGame[], lines, [])
    // .300 on the regular season, not .440 with October folded in, so she is behind b.
    expect(r.batting.find(x => x.key === 'avg')!.display).toBe('.300')
    expect(r.batting.find(x => x.key === 'avg')!.rank).toBe(2)
  })
})

describe('computeWpblPlayerRanks: direction', () => {
  const players = [player('ace'), player('mid'), player('bad')]
  const lines = [
    pit('ace', { outs: 60, er: 2, h: 10, bb: 2, so: 40 }),  // 0.70 ERA
    pit('mid', { outs: 60, er: 8, h: 20, bb: 6, so: 20 }),
    pit('bad', { outs: 60, er: 20, h: 40, bb: 12, so: 10 }),
  ]

  // The bug this exists to prevent: a percentile strip where the best ERA draws the shortest
  // bar, which looks like a rendering glitch and is actually a sign error.
  it('gives the lowest ERA the top rank and the full bar', () => {
    const r = computeWpblPlayerRanks('ace', players, TEAMS, GAMES, [], lines)
    const era = r.pitching.find(x => x.key === 'era')!
    expect(era.rank).toBe(1)
    expect(era.pct).toBe(1)
  })

  it('gives the worst ERA the bottom rank and an empty bar', () => {
    const r = computeWpblPlayerRanks('bad', players, TEAMS, GAMES, [], lines)
    const era = r.pitching.find(x => x.key === 'era')!
    expect(era.rank).toBe(3)
    expect(era.pct).toBe(0)
  })

  it('keeps high-is-good stats pointing the other way in the same strip', () => {
    const r = computeWpblPlayerRanks('ace', players, TEAMS, GAMES, [], lines)
    expect(r.pitching.find(x => x.key === 'k9')!.rank).toBe(1)
    expect(r.pitching.find(x => x.key === 'k9')!.pct).toBe(1)
  })

  it('inverts strikeouts for a hitter, where fewer is better', () => {
    const ps = [player('contact'), player('whiffs')]
    const bl = [
      bat('contact', { ab: 40, h: 12, tb: 16, so: 3 }),
      bat('whiffs', { ab: 40, h: 12, tb: 16, so: 25 }),
    ]
    const r = computeWpblPlayerRanks('contact', ps, TEAMS, GAMES, bl, [])
    expect(r.batting.find(x => x.key === 'k%')!.rank).toBe(1)
  })

  // Ranked on the raw count with 'low' better, the bar rewards not playing: this hitter
  // strikes out MORE often and would still outrank the regular on 5-in-40, purely for having
  // half the at-bats. The rate is the only honest comparison.
  it('does not let a part-timer out-rank a regular on strikeouts by playing less', () => {
    const ps = [player('regular'), player('parttime')]
    const bl = [
      bat('regular', { ab: 40, h: 12, tb: 16, so: 5 }),   // 12.5%
      bat('parttime', { ab: 20, h: 6, tb: 8, so: 4 }),    // 20.0%, but a smaller raw count
    ]
    const r = computeWpblPlayerRanks('regular', ps, TEAMS, GAMES, bl, [])
    const k = r.batting.find(x => x.key === 'k%')!
    expect(k.rank).toBe(1)
    expect(k.display).toBe('12.5%')
  })
})

describe('computeWpblPlayerRanks: edges', () => {
  it('shares the better rank on a tie, as the leaderboards do', () => {
    const players = [player('a'), player('b'), player('c')]
    const lines = [
      bat('a', { ab: 40, h: 16, tb: 20 }),
      bat('b', { ab: 40, h: 16, tb: 20 }),
      bat('c', { ab: 40, h: 8, tb: 10 }),
    ]
    const r = computeWpblPlayerRanks('b', players, TEAMS, GAMES, lines, [])
    expect(r.batting.find(x => x.key === 'avg')!.rank).toBe(1)
  })

  // A ratio with a zero denominator is the BEST possible control, so ranking it last (or
  // drawing an empty bar) would say the opposite of the truth. It drops out instead.
  it('drops K/BB for a pitcher who has walked nobody rather than ranking her worst', () => {
    const players = [player('perfect'), player('other')]
    const lines = [
      pit('perfect', { outs: 60, er: 2, h: 10, bb: 0, so: 30 }),
      pit('other', { outs: 60, er: 5, h: 15, bb: 5, so: 20 }),
    ]
    const r = computeWpblPlayerRanks('perfect', players, TEAMS, GAMES, [], lines)
    expect(r.pitching.some(x => x.key === 'kbb')).toBe(false)
    expect(r.pitching.some(x => x.key === 'era')).toBe(true)
  })

  // Nobody is worse than her, but she is not last either: there is no field. Zero would
  // render as "worst in the league" for the only qualified player at the position.
  it('gives a field of one the full bar, not an empty one', () => {
    const players = [player('only')]
    const r = computeWpblPlayerRanks('only', players, TEAMS, GAMES, [bat('only', { ab: 40, h: 12, tb: 16 })], [])
    const avg = r.batting.find(x => x.key === 'avg')!
    expect(avg.of).toBe(1)
    expect(avg.pct).toBe(1)
    expect(avg.rank).toBe(1)
  })

  it('reports no data for a player who has not batted at all', () => {
    const players = [player('a'), player('bench')]
    const r = computeWpblPlayerRanks('bench', players, TEAMS, GAMES, [bat('a', { ab: 40, h: 12 })], [])
    expect(r.batReason).toBe('no-data')
  })

  // The bar and the number have to agree about the same player. With `worse / (n - 1)` a big
  // tie at the bottom drew an empty bar beside a mid-pack rank: 0 HR in a league where most
  // of the field also has 0 read as "last" on the bar and "13th of 33" in the text.
  it('sits a tied block at its midpoint so the bar agrees with the rank', () => {
    const players = ['a', 'b', 'c', 'd', 'e'].map(player)
    const lines = [
      bat('a', { ab: 40, h: 12, tb: 30, hr: 6 }),
      bat('b', { ab: 40, h: 12, tb: 24, hr: 3 }),
      // Three players tied on zero, which is the shape a 40-game season actually produces.
      bat('c', { ab: 40, h: 12, tb: 16, hr: 0 }),
      bat('d', { ab: 40, h: 12, tb: 16, hr: 0 }),
      bat('e', { ab: 40, h: 12, tb: 16, hr: 0 }),
    ]
    const r = computeWpblPlayerRanks('c', players, TEAMS, GAMES, lines, [])
    const hr = r.batting.find(x => x.key === 'hr')!
    expect(hr.rank).toBe(3)          // ties share the better rank
    expect(hr.pct).toBeGreaterThan(0) // and the bar is not empty
    expect(hr.pct).toBeCloseTo(0.25, 5) // (0 worse + half of 2 tied) / 4
  })

  it('puts the middle of a three-player field at exactly half', () => {
    const players = [player('a'), player('b'), player('c')]
    const lines = [
      bat('a', { ab: 40, h: 16, tb: 24 }),
      bat('b', { ab: 40, h: 12, tb: 16 }),
      bat('c', { ab: 40, h: 8, tb: 10 }),
    ]
    const r = computeWpblPlayerRanks('b', players, TEAMS, GAMES, lines, [])
    expect(r.batting.find(x => x.key === 'avg')!.pct).toBeCloseTo(0.5, 5)
  })
})

// ─── the counting strip ──────────────────────────────────────────────────────────────────────
//
// A different question from everything above, and the whole file's opening argument does not
// apply to it. A rate off nine at-bats is not a fact, which is why the qualifying bar exists.
// A COUNT off nine at-bats is a fact: a short sample can only deflate it, never inflate it.
// The bugs here are therefore the opposite ones: ranking a count inside the qualified field,
// which silently deletes the players this is for, and printing a stat twice on one card.

describe('computeWpblPlayerRanks: counting ranks', () => {
  // The point of the feature in one test. She is below the bar, so `batting` is empty and the
  // card falls back to `RankProgress`; her steals are still 1st in the WPBL and the card had
  // no way to say so before.
  it('ranks a below-bar player, who gets no rate strip at all', () => {
    const players = [player('a'), player('b'), player('c')]
    const lines = [
      bat('a', { ab: 6, h: 2, tb: 2, sb: 9 }),   // nowhere near qualifying
      bat('b', { ab: 40, h: 12, tb: 16, sb: 4 }),
      bat('c', { ab: 40, h: 10, tb: 14, sb: 1 }),
    ]
    const r = computeWpblPlayerRanks('a', players, TEAMS, GAMES, lines, [])
    expect(r.batReason).toBe('below-bar')
    expect(r.batting).toHaveLength(0)
    const sb = r.battingCounts.find(x => x.label === 'SB')
    expect(sb).toMatchObject({ rank: 1, of: 3, display: '9' })
  })

  // THE POPULATION FOLLOWS THE PLAYER, and this pair is the reason there is one comparison
  // block on the card rather than two. Counts were briefly always ranked against everyone who
  // had played, which is defensible on its own and produced a card carrying "Against the
  // league" over 31 qualified batters and, three rows below, a second identically-drawn strip
  // headed "Where she ranks" over 68. Two headings meaning the same sentence, differing by a
  // population a reader has no reason to be tracking.
  it('ranks a qualified player against the field she is already being shown against', () => {
    const players = [player('a'), player('b'), player('c')]
    const lines = [
      bat('a', { ab: 40, h: 12, tb: 16, hr: 3 }),
      bat('b', { ab: 40, h: 10, tb: 14, hr: 1 }),
      bat('c', { ab: 5, h: 4, tb: 16, hr: 4 }), // below the bar, and out-homers both of them
    ]
    const r = computeWpblPlayerRanks('a', players, TEAMS, GAMES, lines, [])
    expect(r.batReason).toBe('ok')
    // One population, so the merged strip can print one line under it.
    expect(r.batCountOf).toBe(r.batOf)
    expect(r.batCountOf).toBe(2)
    expect(r.battingCounts.find(x => x.label === 'HR')).toMatchObject({ rank: 1, of: 2 })
  })

  // And the other half of the same rule. The qualified field is the one field a below-bar
  // player is definitionally not in, so hers is everyone who has played.
  it('ranks a below-bar player against everyone who has played', () => {
    const players = [player('a'), player('b'), player('c')]
    const lines = [
      bat('a', { ab: 5, h: 4, tb: 16, hr: 4 }),
      bat('b', { ab: 40, h: 12, tb: 16, hr: 3 }),
      bat('c', { ab: 40, h: 10, tb: 14, hr: 1 }),
    ]
    const r = computeWpblPlayerRanks('a', players, TEAMS, GAMES, lines, [])
    expect(r.batReason).toBe('below-bar')
    expect(r.batOf).toBe(2)
    expect(r.batCountOf).toBe(3)
    expect(r.battingCounts.find(x => x.label === 'HR')).toMatchObject({ rank: 1, of: 3 })
  })

  // Innings are ranked on OUTS and displayed as innings, because thirds of an inning do not
  // compare as decimals: 6.2 IP is 20 outs, and 6.2 is not two thirds of the way to seven.
  it('ranks innings on outs and prints them as innings', () => {
    const players = [player('a'), player('b')]
    const lines = [pit('a', { outs: 20, so: 8 }), pit('b', { outs: 19, so: 9 })]
    const r = computeWpblPlayerRanks('a', players, TEAMS, GAMES, [], lines)
    expect(r.pitchingCounts.find(x => x.label === 'IP')).toMatchObject({ rank: 1, display: '6.2' })
  })

  // `G` was in this list for a day and put "G 6 · 4th of 38" at the top of a reliever's card,
  // which is a fact about how often a manager called the bullpen. The test a stat has to pass
  // is not "does it reward playing time" (they all do) but "did she do it".
  it('does not rank appearances', () => {
    expect(WPBL_PIT_COUNT_RANK_DEFS.map(d => d.label)).not.toContain('G')
  })
})

describe('bestCountingRanks', () => {
  const rank = (label: string, rank: number, value: number): WpblStatRank => ({
    key: `c_${label}`, label, group: 'batting', better: 'high',
    display: String(value), value, rank, of: 60, pct: 1,
  })

  it('caps the strip, best first', () => {
    const out = bestCountingRanks([rank('RBI', 2, 30), rank('H', 1, 26), rank('R', 3, 20)])
    expect(out).toHaveLength(COUNT_RANK_ROWS)
    expect(out.map(r => r.label)).toEqual(['H', 'RBI'])
  })

  // THE ONE THAT WAS A REAL BUG, and it was masked by an unrelated sort. HR is a counting stat
  // that lives in the RATE defs as well (a home-run total is meant to reward playing time), so
  // a qualified home-run leader can be ranked twice on one card, against two different fields,
  // with two different ordinals, three rows apart.
  it('never repeats a stat the rate strip is already drawing', () => {
    const counts = [rank('HR', 1, 9), rank('RBI', 1, 30), rank('H', 1, 26)]
    const shown = [{ ...rank('HR', 1, 9), key: 'hr' }]
    expect(bestCountingRanks(counts, shown).map(r => r.label)).toEqual(['RBI', 'H'])
  })

  it('says nothing for a player who leads nothing, rather than an empty block', () => {
    expect(bestCountingRanks([rank('H', COUNT_RANK_BAR + 1, 4)])).toEqual([])
  })

  // Half the league has no triples, so they are all tied for 1st on zero. "1st in the WPBL in
  // 3B" off no triples at all is the most confident wrong thing this strip could say.
  it('will not call a five-way tie on zero a league lead', () => {
    expect(bestCountingRanks([rank('3B', 1, 0)])).toEqual([])
  })

  // An absolute bar of 5 says nothing without a field to be 5th of. In a field of six it is
  // next to last, and in a field of one it makes a hitter with four at-bats the league leader
  // in hits, which is how a one-player test fixture found this.
  it('will not rank anyone in a field too small to have a middle', () => {
    const small = { ...rank('H', 1, 4), of: COUNT_RANK_MIN_FIELD - 1 }
    expect(bestCountingRanks([small])).toEqual([])
    expect(bestCountingRanks([{ ...small, of: COUNT_RANK_MIN_FIELD }])).toHaveLength(1)
  })
})

describe('ordinal', () => {
  it('handles the ones that break naive rules', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(ordinal))
      .toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st', '111th'])
  })
})
