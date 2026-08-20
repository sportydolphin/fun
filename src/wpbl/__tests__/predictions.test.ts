import { describe, it, expect } from 'vitest'
import {
  boardWinner, buildBoard, buildRunsRound, gradeRunsRound, halfInningStarted, nextHalfInning, ordinal, runsKey,
  type PredictGame, type PredictPlay,
} from '../derive/predictions'
import { buildRoundCard, buildStandingsMessage, buildWinnerMessage, type CardRound } from '../discordPredictions'

// The predictions game is settled by a cron pass nobody watches, in a channel nobody on this
// side of the code can see. Two things are worth pinning hard: that a round can never be
// opened on a half-inning already under way (which is the entire fairness argument), and that
// grading agrees with the scorebook, including the feed's runs_scored trap where a solo home
// run reads 0.

const play = (inning: number, half: 'top' | 'bottom', o: Partial<PredictPlay> = {}): PredictPlay => ({
  inning, half, sequence: inning * 10 + (half === 'bottom' ? 5 : 0), event_type: null, runs_scored: 0, ...o,
})

const game = (o: Partial<PredictGame> = {}): PredictGame => ({ status: 'live', ...o })

describe('which half-inning a round may ask about', () => {
  it('offers the top of the 1st before first pitch', () => {
    expect(nextHalfInning(game({ status: 'scheduled' }), [])).toEqual({ inning: 1, half: 'top' })
  })

  it('offers the bottom while the top is being played', () => {
    const plays = [play(1, 'top'), play(2, 'top'), play(2, 'top')]
    expect(nextHalfInning(game({ live_inning: 2, live_half: 'top' }), plays)).toEqual({ inning: 2, half: 'bottom' })
  })

  it('rolls over to the next inning after the bottom half', () => {
    expect(nextHalfInning(game({ live_inning: 3, live_half: 'bottom' }), [play(3, 'bottom')]))
      .toEqual({ inning: 4, half: 'top' })
  })

  it('trusts whichever source is further along', () => {
    // Between innings the feed can report a half the play log has already moved past, and the
    // reverse happens while the feed is catching up. Taking the max is what stops a round being
    // opened on an inning that has already started.
    const behindFeed = game({ live_inning: 4, live_half: 'top' })
    expect(nextHalfInning(behindFeed, [play(4, 'bottom')])).toEqual({ inning: 5, half: 'top' })

    const behindPlays = game({ live_inning: 6, live_half: 'bottom' })
    expect(nextHalfInning(behindPlays, [play(5, 'top')])).toEqual({ inning: 7, half: 'top' })
  })

  it('ignores the feed situation on a game that is not live', () => {
    // live_inning defaults to 1 in our own schema, so a scheduled game always "reports" the
    // top of the 1st. Reading that would push the first round of the night to the bottom.
    expect(nextHalfInning(game({ status: 'scheduled', live_inning: 1, live_half: 'top' }), []))
      .toEqual({ inning: 1, half: 'top' })
  })

  it('has nothing to offer on a final game', () => {
    expect(nextHalfInning(game({ status: 'final' }), [play(7, 'bottom')])).toBeNull()
  })

  it('knows when the target half-inning has started, which is when picks must close', () => {
    const target = { inning: 5, half: 'bottom' as const }
    expect(halfInningStarted(target, game({ live_inning: 5, live_half: 'top' }), [play(5, 'top')])).toBe(false)
    expect(halfInningStarted(target, game({ live_inning: 5, live_half: 'bottom' }), [play(5, 'top')])).toBe(true)
    expect(halfInningStarted(target, game({ live_inning: 5, live_half: 'top' }), [play(5, 'bottom')])).toBe(true)
  })
})

describe('opening a round', () => {
  const opened = buildRunsRound({
    target: { inning: 4, half: 'bottom' },
    battingTeam: 'San Francisco Firebells',
    awayName: 'Boston Hunters',
    homeName: 'San Francisco Firebells',
    awayScore: 3,
    homeScore: 1,
    anchorSequence: 42,
    seconds: 120,
    now: new Date('2026-08-20T01:00:00Z'),
  })

  it('asks about the coming half-inning by name', () => {
    expect(opened.question).toBe('How many runs will San Francisco Firebells score in the bottom of the 4th?')
    expect(opened.situation).toContain('Boston Hunters 3, San Francisco Firebells 1')
    expect(opened.target_inning).toBe(4)
    expect(opened.target_half).toBe('bottom')
  })

  it('offers four buckets, the last of them open-ended', () => {
    expect(opened.options.map(o => o.label)).toEqual(['0', '1', '2', '3+'])
  })

  it('closes picks after the window, and never sooner than a person can click', () => {
    expect(opened.locks_at).toBe('2026-08-20T01:02:00.000Z')
    // A two-second window is a round nobody can answer, so the floor is not the caller's to set.
    const rushed = buildRunsRound({
      target: { inning: 1, half: 'top' }, battingTeam: 'Boston Hunters',
      awayName: 'Boston Hunters', homeName: 'San Francisco Firebells', awayScore: 0, homeScore: 0,
      anchorSequence: 0, seconds: 2, now: new Date('2026-08-20T01:00:00Z'),
    })
    expect(rushed.locks_at).toBe('2026-08-20T01:00:15.000Z')
  })
})

describe('grading a round', () => {
  const target = { inning: 3, half: 'top' as const }

  it('waits while the half-inning is still being played', () => {
    expect(gradeRunsRound(target, game(), [play(3, 'top', { runs_scored: 1 })]).state).toBe('pending')
  })

  it('settles once a later half-inning appears in the log', () => {
    const verdict = gradeRunsRound(target, game(), [
      play(3, 'top', { runs_scored: 1 }),
      play(3, 'top'),
      play(3, 'bottom'),
    ])
    expect(verdict).toMatchObject({ state: 'graded', correctKey: '1', runs: 1 })
  })

  it('counts the batter on a home run, which the feed does not', () => {
    // runs_scored counts the runners who crossed and never the batter, so a solo shot reads 0
    // in the column. Grading that as a scoreless inning is the trap this asserts against.
    const solo = gradeRunsRound(target, game(), [
      play(3, 'top', { event_type: 'home_run', runs_scored: 0 }),
      play(3, 'bottom'),
    ])
    expect(solo).toMatchObject({ state: 'graded', correctKey: '1', runs: 1 })
  })

  it('settles at three runs without waiting for the side to be retired', () => {
    const verdict = gradeRunsRound(target, game(), [
      play(3, 'top', { event_type: 'home_run', runs_scored: 2 }),
      play(3, 'top', { runs_scored: 1 }),
    ])
    expect(verdict).toMatchObject({ state: 'graded', correctKey: '3', runs: 4 })
  })

  it('grades a scoreless frame as 0', () => {
    expect(gradeRunsRound(target, game({ status: 'final' }), [play(3, 'top'), play(3, 'top')]))
      .toMatchObject({ state: 'graded', correctKey: '0', runs: 0 })
  })

  it('voids a half-inning that was never played rather than calling it scoreless', () => {
    // The home side does not bat in the bottom of the last inning when it is already ahead.
    const bottom9 = { inning: 9, half: 'bottom' as const }
    const verdict = gradeRunsRound(bottom9, game({ status: 'final' }), [play(9, 'top', { runs_scored: 1 })])
    expect(verdict.state).toBe('void')
  })

  it('ignores plays from other half-innings entirely', () => {
    const verdict = gradeRunsRound(target, game(), [
      play(2, 'top', { runs_scored: 3 }),
      play(3, 'top', { runs_scored: 1 }),
      play(3, 'bottom', { runs_scored: 2 }),
    ])
    expect(verdict).toMatchObject({ state: 'graded', runs: 1 })
  })

  it('buckets anything past three into the top option', () => {
    expect([0, 1, 2, 3, 7].map(runsKey)).toEqual(['0', '1', '2', '3', '3'])
  })
})

describe('the board', () => {
  const rounds = [
    { id: 'r1', status: 'graded', correct_key: '1' },
    { id: 'r2', status: 'graded', correct_key: '0' },
    { id: 'r3', status: 'void', correct_key: null },
    { id: 'r4', status: 'open', correct_key: null },
  ]
  const pick = (round: string, user: string, key: string, ms: number, name = user) =>
    ({ round_id: round, discord_user_id: user, display_name: name, option_key: key, response_ms: ms })

  it('scores only the rounds that graded', () => {
    const board = buildBoard(rounds, [
      pick('r1', 'ana', '1', 4000),
      pick('r3', 'ana', '2', 1000),   // void: counts for nobody, in either direction
      pick('r4', 'ana', '0', 1000),   // still open
    ])
    expect(board[0]).toMatchObject({ userId: 'ana', correct: 1, answered: 1 })
  })

  it('breaks a tie on average answer time, not total', () => {
    // Sitting out most of the game must not be a tiebreak advantage: a total would hand this
    // to whoever answered fewer rounds.
    const board = buildBoard(rounds, [
      pick('r1', 'ana', '1', 3000),
      pick('r2', 'ana', '0', 3000),
      pick('r1', 'bo', '1', 5000),
    ])
    expect(board.map(r => r.userId)).toEqual(['ana', 'bo'])
    expect(board[0]).toMatchObject({ correct: 2, meanMs: 3000 })
  })

  it('announces the freshest display name', () => {
    const board = buildBoard(rounds, [pick('r1', 'ana', '1', 1000, 'Ana'), pick('r2', 'ana', '0', 1000, 'Ana B')])
    expect(board[0].name).toBe('Ana B')
  })

  it('crowns nobody when nobody called one right', () => {
    const board = buildBoard(rounds, [pick('r1', 'ana', '0', 1000), pick('r2', 'bo', '2', 1000)])
    expect(board).toHaveLength(2)
    expect(boardWinner(board)).toBeNull()
    expect(boardWinner([])).toBeNull()
  })
})

describe('the cards in the channel', () => {
  const round = (o: Partial<CardRound> = {}): CardRound => ({
    id: 'abc',
    question: 'How many runs will the Firebells score in the top of the 4th?',
    situation: 'Boston Hunters 3, San Francisco Firebells 1 · Firebells batting next',
    options: [{ key: '0', label: '0' }, { key: '1', label: '1' }, { key: '2', label: '2' }, { key: '3', label: '3+' }],
    target_inning: 4,
    target_half: 'top',
    locks_at: '2026-08-20T01:02:00.000Z',
    status: 'open',
    correct_key: null,
    outcome: null,
    detail: null,
    ...o,
  })

  it('counts down with a live button per answer', () => {
    const card = buildRoundCard(round(), { picks: 3 })
    const buttons = card.components?.[0].components ?? []
    expect(buttons).toHaveLength(4)
    expect(buttons.every(b => !b.disabled)).toBe(true)
    expect(buttons[3].custom_id).toBe('predict:abc:3')
    // Discord renders this as a live countdown with nobody editing the message, which is the
    // only way to have one: there is no process here able to tick it.
    expect(card.embeds?.[0].description).toContain('<t:1787187720:R>')
    expect(card.embeds?.[0].description).toContain('3 picks in')
  })

  it('shows a total and never the split by option', () => {
    const card = buildRoundCard(round(), { picks: 1 })
    expect(card.embeds?.[0].description).toContain('1 pick in')
    // No per-option breakdown anywhere on the card: only the four labels, on the buttons.
    expect(card.embeds?.[0].description).not.toMatch(/[0-3]\+? [-–:] ?\d/)
  })

  it('kills the buttons once picks close', () => {
    const card = buildRoundCard(round({ status: 'locked' }), { picks: 5 })
    expect(card.components?.[0].components.every(b => b.disabled)).toBe(true)
    expect(card.embeds?.[0].description).toContain('waiting on the top of the 4th')
  })

  it('turns the right answer green on the reveal', () => {
    const card = buildRoundCard(
      round({ status: 'graded', correct_key: '2', outcome: '2 runs', detail: 'Top 4th: 2 runs.' }),
      { picks: 5 },
    )
    const buttons = card.components?.[0].components ?? []
    expect(buttons.filter(b => b.style === 3).map(b => b.label)).toEqual(['2'])
    expect(card.embeds?.[0].description).toContain('2 runs')
  })

  it('says a void round counts for nothing', () => {
    const card = buildRoundCard(
      round({ status: 'void', detail: 'Bottom 9th was never played, so this round counts for nothing.' }),
      { picks: 5 },
    )
    expect(card.embeds?.[0].description).toContain('counts for nothing')
  })

  it('announces nobody winning as a real result', () => {
    const nobody = buildWinnerMessage([], null, 'Boston Hunters at San Francisco Firebells')
    expect(nobody.embeds?.[0].description).toContain('nobody to crown')

    const missed = buildWinnerMessage(
      [{ userId: 'ana', name: 'Ana', correct: 0, answered: 4, meanMs: 2000 }],
      null,
      'Boston Hunters at San Francisco Firebells',
    )
    expect(missed.embeds?.[0].description).toContain('Nobody called a single round right')
  })

  it('crowns a winner with their record', () => {
    const card = buildWinnerMessage(
      [{ userId: 'ana', name: 'Ana', correct: 5, answered: 7, meanMs: 3400 }],
      { userId: 'ana', name: 'Ana', correct: 5, answered: 7, meanMs: 3400 },
      'Boston Hunters at San Francisco Firebells',
    )
    expect(card.embeds?.[0].description).toContain('**Ana** wins it')
    expect(card.embeds?.[0].description).toContain('5 of 7')
  })

  it('says so when the board is empty', () => {
    const card = buildStandingsMessage([], [{ status: 'graded' }, { status: 'open' }])
    expect(card.embeds?.[0].description).toContain('Nobody has called one right yet')
    expect(card.embeds?.[0].footer?.text).toContain('1 round settled')
    expect(card.embeds?.[0].footer?.text).toContain('1 still live')
  })
})

describe('ordinals', () => {
  it('reads the way a scorebook does', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st'])
  })
})
