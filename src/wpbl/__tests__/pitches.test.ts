import { describe, it, expect } from 'vitest'
import { readSequence, aggregatePitchCodes, pitchQualifiers, rankBy, PITCH_CODES } from '../derive/pitches'
import type { WpblPitchPlay, WpblPlayer } from '../types'
import type { PitchProfile } from '../derive/pitches'
import { trackingWorthShowing } from '../tracking'
import type { WpblSeasonGame as SeasonGame } from '../season'

// The pitch-code boards are a rate layer over one string per plate appearance, so almost
// everything that can go wrong here is arithmetic that still renders: a foul counted as a
// third strike, the postseason folded into a season rate, one player split across two rows.
// None of those throw.

let seq = 0
function play(over: Partial<WpblPitchPlay> = {}): WpblPitchPlay {
  return {
    game_id: 'g1',
    sequence: seq++,
    team_id: 'BOS',
    batter_id: null,
    batter_name: 'A Batter',
    pitcher_id: null,
    pitcher_name: 'A Pitcher',
    event_type: 'groundout',
    pitch_sequence: 'BP',
    ...over,
  }
}

const player = (id: string, name: string, teamId: string): WpblPlayer => ({
  id, team_id: teamId, name, position: null, bats: null, throws: null, jersey_number: null,
  age: null, hometown: null, status: 'Signed', draft_round: null, draft_pick: null, bio: null,
  birth_date: null, birth_date_source: null, zodiac_sign: null, active: true, api_id: null,
  created_at: '',
})

const regular: SeasonGame[] = [{ id: 'g1', game_type: 'regular', counts_in_standings: true }]

describe('readSequence', () => {
  it('decodes the six codes the feed uses', () => {
    const r = readSequence('BKSFPH')
    expect(r.counts).toEqual({ ball: 1, called: 1, swinging: 1, foul: 1, inplay: 1, hbp: 1, unknown: 0 })
    expect(r.pitches).toBe(6)
  })

  // The feed's own labels call K "unknown" and P "pitchout"; the letters are what we trust.
  it('treats K as a called strike and P as a ball in play', () => {
    expect(PITCH_CODES.K).toBe('called')
    expect(PITCH_CODES.P).toBe('inplay')
  })

  it('counts an unrecognised code separately rather than guessing', () => {
    const r = readSequence('BXB')
    expect(r.counts.unknown).toBe(1)
    expect(r.counts.ball).toBe(2)
    expect(r.pitches).toBe(3)
  })

  it('does not let fouls past two strikes reach a third strike', () => {
    // 0-1 called, 0-2 foul, then four more fouls: still one trip to two strikes.
    const r = readSequence('KFFFFF')
    expect(r.reachedTwoStrikes).toBe(true)
    const never = readSequence('BFBB')  // one foul, one strike, walked
    expect(never.reachedTwoStrikes).toBe(false)
  })

  it('reads the first pitch, including a ball in play as a strike', () => {
    expect(readSequence('P').firstPitchStrike).toBe(true)
    expect(readSequence('FBB').firstPitchStrike).toBe(true)
    expect(readSequence('BKK').firstPitchStrike).toBe(false)
    expect(readSequence('HB').firstPitchStrike).toBe(false)
  })
})

describe('aggregatePitchCodes', () => {
  it('splits one plate appearance onto both sides of it', () => {
    const board = aggregatePitchCodes([play({ pitch_sequence: 'BSFP' })], [], regular)
    expect(board.pitches).toBe(4)
    expect(board.pa).toBe(1)
    expect(board.pitchers[0].pitches).toBe(4)
    expect(board.batters[0].pitches).toBe(4)
    // 3 of 4 are strikes (S, F, P); one swing missed of three swings.
    expect(board.league.strikePct).toBeCloseTo(0.75)
    expect(board.league.whiffPct).toBeCloseTo(1 / 3)
    expect(board.league.swStrPct).toBeCloseTo(0.25)
  })

  it('finishes putaway rate over two-strike plate appearances only', () => {
    const plays = [
      play({ pitch_sequence: 'KKS', event_type: 'strikeout' }),   // reached 2, struck out
      play({ pitch_sequence: 'KFFP', event_type: 'single' }),     // reached 2, survived
      play({ pitch_sequence: 'BBBB', event_type: 'walk' }),       // never got there
    ]
    const board = aggregatePitchCodes(plays, [], regular)
    expect(board.league.twoStrikePa).toBe(2)
    expect(board.league.putawayPct).toBeCloseTo(0.5)
  })

  it('is null, not zero, for a rate with nothing in its denominator', () => {
    const board = aggregatePitchCodes([play({ pitch_sequence: 'BBBB', event_type: 'walk' })], [], regular)
    expect(board.league.whiffPct).toBeNull()     // no swings
    expect(board.league.putawayPct).toBeNull()   // never reached two strikes
    expect(board.league.strikePct).toBe(0)       // measured, and genuinely zero
  })

  // The trap the whole season module exists for: a postseason line reaching a season rate.
  it('leaves postseason plate appearances out', () => {
    const games: SeasonGame[] = [
      { id: 'g1', game_type: 'regular', counts_in_standings: true },
      { id: 'g2', game_type: 'postseason', counts_in_standings: false },
    ]
    const plays = [
      play({ game_id: 'g1', pitch_sequence: 'BB' }),
      play({ game_id: 'g2', pitch_sequence: 'KKK', event_type: 'strikeout' }),
    ]
    const board = aggregatePitchCodes(plays, [], games)
    expect(board.pa).toBe(1)
    expect(board.pitches).toBe(2)
    expect(board.gameCount).toBe(1)
    expect(board.league.strikePct).toBe(0)
  })

  // Fails open, like countsInStandings: a game we have never heard of still counts.
  it('counts a play whose game is missing from the schedule', () => {
    const board = aggregatePitchCodes([play({ game_id: 'nobody-knows' })], [], regular)
    expect(board.pa).toBe(1)
  })

  it('keys on the resolved player so one name spelling cannot split a line', () => {
    const p = player('p1', 'Alli Schroder', 'LA')
    const plays = [
      play({ pitcher_id: 'p1', pitcher_name: 'Alli Schroder', pitch_sequence: 'BB' }),
      play({ pitcher_id: 'p1', pitcher_name: 'Allison Schroder', pitch_sequence: 'KK' }),
    ]
    const board = aggregatePitchCodes(plays, [p], regular)
    expect(board.pitchers).toHaveLength(1)
    expect(board.pitchers[0].pitches).toBe(4)
    expect(board.pitchers[0].name).toBe('Alli Schroder')
    expect(board.pitchers[0].teamId).toBe('LA')
  })

  it('keeps an unresolved pitcher, with no team and no player to open', () => {
    const board = aggregatePitchCodes([play({ pitcher_name: 'Nobody Onroster' })], [], regular)
    expect(board.pitchers[0].player).toBeNull()
    expect(board.pitchers[0].teamId).toBeNull()
    // A play's team_id is the batting side, so it is the batter's club and not the pitcher's.
    expect(board.batters[0].teamId).toBe('BOS')
  })
})

describe('rankBy', () => {
  // pitches / swings / twoStrikePa are the three denominators the boards divide by.
  const prof = (over: Partial<PitchProfile>): PitchProfile => ({
    player: null, name: 'x', teamId: null,
    pitches: 100, pa: 25, swings: 40, strikeouts: 0, twoStrikePa: 10,
    counts: { ball: 0, called: 0, swinging: 0, foul: 0, inplay: 0, hbp: 0, unknown: 0 },
    strikePct: null, swStrPct: null, whiffPct: null, contactPct: null, swingPct: null,
    calledPct: null, pitchesPerPa: null, firstStrikePct: null, putawayPct: null,
    ...over,
  })

  const league = prof({ pitches: 1000, swings: 400, pa: 250, twoStrikePa: 100 })

  it('drops short samples and unmeasured rates', () => {
    const out = rankBy([
      prof({ swStrPct: 0.10 }),
      prof({ swStrPct: 0.20 }),
      prof({ pitches: 10, swStrPct: 0.90 }),   // tiny sample, must not lead
      prof({ swStrPct: null }),                // nothing to rank on
    ], 'swStrPct', 40)
    expect(out.map(p => p.swStrPct)).toEqual([0.20, 0.10])
  })

  it('sorts ascending when lower is better', () => {
    const out = rankBy([prof({ swStrPct: 0.10 }), prof({ swStrPct: 0.20 })], 'swStrPct', 40, true)
    expect(out.map(p => p.swStrPct)).toEqual([0.10, 0.20])
  })

  // The bug the live board showed: a hitter cleared the pitches-seen bar with 15 swings all
  // season and led the contact board at a flat 100%. Contact is per swing, so the bar has to
  // be too.
  it('holds a rate to its own denominator, not just to pitches', () => {
    const rows = [
      prof({ swings: 15, contactPct: 1.0 }),   // 100% of very little
      prof({ swings: 45, contactPct: 0.9 }),
    ]
    expect(rankBy(rows, 'contactPct', 100).map(p => p.contactPct)).toEqual([1.0, 0.9])
    // League swings are 40% of league pitches, so a 100-pitch qualifier needs 40 swings.
    expect(rankBy(rows, 'contactPct', 100, false, league).map(p => p.contactPct)).toEqual([0.9])
  })

  it('breaks a tie toward the bigger sample', () => {
    const out = rankBy([
      prof({ twoStrikePa: 6, putawayPct: 0 }),
      prof({ twoStrikePa: 14, putawayPct: 0 }),
    ], 'putawayPct', 40, true)
    expect(out.map(p => p.twoStrikePa)).toEqual([14, 6])
  })
})

describe('pitchQualifiers', () => {
  it('scales with the season and never falls below the floor', () => {
    expect(pitchQualifiers(0)).toEqual({ minPitcher: 40, minBatter: 25 })
    expect(pitchQualifiers(8)).toEqual({ minPitcher: 96, minBatter: 64 })
  })
})

// ── When the Tracked board is worth offering ─────────────────────────────────────
// The Stats tab hides Tracked while the league has published radar for barely any games, so
// this is the rule that decides whether a shipped surface is on screen at all. Both halves of
// it matter: the floor stops a two-game batch qualifying, and the share stops April qualifying
// on a technicality.
describe('trackingWorthShowing', () => {
  it('hides the two games the league has actually published', () => {
    expect(trackingWorthShowing(2, 16)).toBe(false)
  })

  it('shows it once a real share of the season is tracked', () => {
    expect(trackingWorthShowing(9, 16)).toBe(true)
  })

  it('holds a floor, so three games never qualify however early it is', () => {
    expect(trackingWorthShowing(3, 3)).toBe(false)
    expect(trackingWorthShowing(4, 4)).toBe(true)
  })

  it('will not pass on share alone when the sample is tiny', () => {
    expect(trackingWorthShowing(2, 2)).toBe(false)
  })

  it('falls back to the floor before any game is final', () => {
    expect(trackingWorthShowing(0, 0)).toBe(false)
    expect(trackingWorthShowing(5, 0)).toBe(true)
  })

  it('drops back out if the season outruns the tracking', () => {
    expect(trackingWorthShowing(4, 30)).toBe(false)
  })
})
