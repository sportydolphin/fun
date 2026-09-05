import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { gameIsOver, overReason, settleGame, settleGames, type SettleableGame } from '../gameOver'
import { feedHealth } from '../derive/feedHealth'
import { REGULATION_INNINGS } from '../innings'
import type { WpblGame, WpblLiveState } from '../types'

// The rule that calls a game over when the league forgets to. Everything here is a rule of
// baseball rather than a threshold, so every case below should read as an argument about the
// game and not about the data.

const state = (o: Partial<WpblLiveState>): WpblLiveState => ({
  complete: false, inning: 7, half: 'top', batting_team_id: 'x', outs: 0, balls: 0, strikes: 0,
  batter_name: '', pitcher_name: '', first_base: '', second_base: '', third_base: '',
  bases_occupied: [], bases_loaded: false, away_runs: 0, home_runs: 0, ...o,
})

const game = (o: Partial<SettleableGame> = {}): SettleableGame => ({
  status: 'live', home_score: null, away_score: null, live_state: null, ...o,
})

describe('gameIsOver', () => {
  // The row that made this exist. Sep 4, 2026, SF at NY: the feed sat at "In Progress - Top of
  // 7th" with the last out of the game already in the play log, and kept writing the row every
  // two minutes without ever setting the status. The section showed it live for hours.
  const sep4 = game({
    status: 'live', away_score: 2, home_score: 14,
    live_state: state({ inning: 7, half: 'top', outs: 3, away_runs: 2, home_runs: 14 }),
  })

  it('calls the game the league left in progress', () => {
    expect(overReason(sep4)).toBe('home-need-not-bat')
  })

  it('leaves the same state alone before the last inning', () => {
    // Three outs in the top of the 3rd is the ordinary between-innings state, published forty
    // times a game. If this ever passes, every game in the league ends in the first inning
    // somebody leads after.
    for (let inning = 1; inning < REGULATION_INNINGS; inning++) {
      expect(gameIsOver({ ...sep4, live_state: state({ ...sep4.live_state!, inning }) })).toBe(false)
    }
  })

  it('ends an extra inning on the same three rules', () => {
    // The gate is "at or past regulation", not "exactly regulation": every extra inning is
    // potentially the last one.
    expect(overReason({ ...sep4, live_state: state({ inning: 9, half: 'top', outs: 3, away_runs: 2, home_runs: 14 }) }))
      .toBe('home-need-not-bat')
  })

  it('never ends a tie', () => {
    for (const half of ['top', 'bottom'] as const) {
      expect(gameIsOver(game({
        live_state: state({ inning: 8, half, outs: 3, away_runs: 5, home_runs: 5 }),
      }))).toBe(false)
    }
  })

  it('ends the moment the home side goes ahead in its own last at-bat', () => {
    // A walk-off does not wait for a third out, and a side with the lead does not come to bat,
    // so a home team batting in the last inning while ahead has just taken the lead.
    expect(overReason(game({
      live_state: state({ inning: 7, half: 'bottom', outs: 1, away_runs: 3, home_runs: 4 }),
    }))).toBe('walk-off')
  })

  it('ends on the third out of the bottom half when somebody is ahead', () => {
    expect(overReason(game({
      live_state: state({ inning: 7, half: 'bottom', outs: 3, away_runs: 6, home_runs: 4 }),
    }))).toBe('side-retired')
  })

  it('does not end the top of the last inning when the home side is behind', () => {
    // They still have their half to bat.
    expect(gameIsOver(game({
      live_state: state({ inning: 7, half: 'top', outs: 3, away_runs: 6, home_runs: 4 }),
    }))).toBe(false)
  })

  it('takes the feed at its word when it sets complete', () => {
    expect(overReason(game({ live_state: state({ complete: true, inning: 2 }) }))).toBe('feed-complete')
  })

  it('says nothing without a situation, or between plays', () => {
    expect(gameIsOver(game({ live_state: null }))).toBe(false)
    // The feed writes '' for `half` when nothing is in play.
    expect(gameIsOver(game({
      live_state: state({ inning: 7, half: '', outs: 3, away_runs: 2, home_runs: 9 }),
    }))).toBe(false)
  })

  it('moves a row one direction only', () => {
    // A game the league calls final is final whatever the state says, and a game it has not
    // started cannot be over. Without this the rule could contradict a stored result.
    const proven = state({ inning: 7, half: 'top', outs: 3, away_runs: 2, home_runs: 14 })
    for (const status of ['scheduled', 'final', 'postponed', null]) {
      expect(gameIsOver(game({ status, live_state: proven }))).toBe(false)
    }
  })
})

describe('settleGame', () => {
  const over = game({
    status: 'live', away_score: 2, home_score: 14,
    live_state: state({ inning: 7, half: 'top', outs: 3, away_runs: 2, home_runs: 14 }),
  })

  it('reads final to every caller, and flags that the call is ours', () => {
    const s = settleGame(over)
    expect(s.status).toBe('final')
    expect(s.final_by_rule).toBe(true)
    // The score stays the league's own; only the status is ours.
    expect([s.away_score, s.home_score]).toEqual([2, 14])
  })

  it('fills a missing score from the situation rather than rendering 0-0', () => {
    const s = settleGame({ ...over, away_score: null, home_score: null })
    expect([s.away_score, s.home_score]).toEqual([2, 14])
  })

  it('takes the call back when the state stops proving it', () => {
    // This is what makes the risk small: nothing is remembered. The live poll merges the
    // league's columns over the row we hold, and `final_by_rule` is not one of them because it
    // is not a column, so a stale true has to be overwritten rather than survive.
    const settled = settleGame(over)
    const merged = { ...settled, status: 'live', live_state: state({ inning: 7, half: 'top', outs: 1, away_runs: 2, home_runs: 14 }) }
    const again = settleGame(merged)
    expect(again.status).toBe('live')
    expect(again.final_by_rule).toBe(false)
  })

  it('keeps identity when there is nothing to call', () => {
    // This runs over the whole schedule on every poll; handing React thirty new objects every
    // twenty seconds would repaint the section for nothing.
    const ordinary = [game({ status: 'final', home_score: 5, away_score: 4 }), game({ status: 'scheduled' })]
    expect(settleGames(ordinary)).toBe(ordinary)
    expect(settleGame(ordinary[0])).toBe(ordinary[0])
  })
})

describe('the notice a settled game carries', () => {
  it('says the league has not posted it, rather than reporting a healthy game', () => {
    // feedHealth tests `final_by_rule` BEFORE `status`, because a settled row carries both and
    // testing status first sends it to 'ok': the reader is then shown a result we inferred with
    // nothing saying so.
    const row = {
      game_date: '2026-09-04', start_time: null, status: 'final' as const,
      updated_at: new Date().toISOString(), source_updated_at: new Date().toISOString(),
      final_by_rule: true,
    } as WpblGame
    expect(feedHealth(row).kind).toBe('unposted-final')
    expect(feedHealth({ ...row, final_by_rule: false }).kind).toBe('ok')
  })
})

describe('where the rule is applied', () => {
  // The point of settling at the read boundary is that `status` is read in about fifty places
  // and none of them should have to know this exists. Assert it on the source, because a
  // refactor that drops the call leaves every one of those places quietly wrong and no test
  // that reads data can see it.
  it('runs on the schedule read', () => {
    const api = readFileSync('src/wpbl/api.ts', 'utf8')
    const fn = api.slice(api.indexOf('export function fetchWpblSchedule'))
    expect(fn.slice(0, fn.indexOf('\n}')).includes('settleGames(')).toBe(true)
  })

  it('runs again after the live poll merges its columns over the row', () => {
    const live = readFileSync('src/wpbl/Live.tsx', 'utf8')
    expect(live.includes('settleGame({ ...prev, ...delta })')).toBe(true)
  })

  it('runs on the share-card read, which is the one that goes outward', () => {
    const fn = readFileSync('functions/wpbl/index.ts', 'utf8')
    expect(fn.includes('settleGames(games)')).toBe(true)
    // It needs the column to reason from, and that select is the only place it comes from.
    expect(fn.includes('away_score,live_state')).toBe(true)
  })
})
