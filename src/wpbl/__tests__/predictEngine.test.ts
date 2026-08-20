import { describe, it, expect, vi, beforeEach } from 'vitest'
import { settleGame, settleOpenRounds, gameBoard } from '../predictEngine'
import type {
  PredictGameRow, PredictPick, PredictRound, PredictStore, PredictTeam, PredictWinner,
} from '../predictStore'
import type { PredictPlay } from '../derive/predictions'

// The settle pass runs on a cron nobody watches, against a Discord channel no test can see.
// What is worth pinning is the state machine it drives: open -> locked -> graded, picks marked
// against the answer, and exactly one winner row per game no matter how many callers race for
// it. The store is faked in memory; the only real I/O it would do is to Discord, and every
// call there is best-effort by design.

const GAME_ID = 'game-1'

const play = (inning: number, half: 'top' | 'bottom', o: Partial<PredictPlay> = {}): PredictPlay => ({
  inning, half, sequence: 0, event_type: null, runs_scored: 0, ...o,
})

interface Fake extends PredictStore {
  rounds: PredictRound[]
  picks: PredictPick[]
  winners: PredictWinner[]
  game_: PredictGameRow
  plays_: PredictPlay[]
}

function fakeStore(over: Partial<PredictRound> = {}): Fake {
  const round: PredictRound = {
    id: 'r1', game_id: GAME_ID, kind: 'runs', guild_id: 'g', channel_id: 'c',
    message_id: 'm', interaction_token: null, application_id: null, opened_by: 'mod',
    question: 'How many runs?', situation: 'tied', options: [
      { key: '0', label: '0' }, { key: '1', label: '1' }, { key: '2', label: '2' }, { key: '3', label: '3+' },
    ],
    target_inning: 3, target_half: 'top', anchor_sequence: 0,
    locks_at: '2026-08-20T01:00:00.000Z', status: 'open',
    correct_key: null, outcome: null, detail: null,
    opened_at: '2026-08-20T00:58:00.000Z', closed_at: null, graded_at: null,
    ...over,
  }
  const store: Fake = {
    rounds: [round],
    picks: [],
    winners: [],
    game_: {
      id: GAME_ID, game_date: '2026-08-20', status: 'live',
      home_team_id: 'SF', away_team_id: 'BOS', home_score: 1, away_score: 2,
      // The feed sits one half-inning behind the round's target, which is the only way a round
      // gets opened in the first place: nextHalfInning refuses a half already under way.
      live_inning: 2, live_half: 'bottom',
    },
    plays_: [],

    openRounds: async () => store.rounds.filter(r => r.status === 'open' || r.status === 'locked'),
    roundsForGame: async () => store.rounds,
    round: async id => store.rounds.find(r => r.id === id) ?? null,
    latestRoundInChannel: async () => store.rounds[store.rounds.length - 1] ?? null,
    picksForRounds: async ids => store.picks.filter(p => ids.includes(p.round_id)),
    pickCount: async id => store.picks.filter(p => p.round_id === id).length,
    insertRound: async row => { const r = { ...round, ...row } as PredictRound; store.rounds.push(r); return r },
    updateRound: async (id, patch) => {
      const r = store.rounds.find(x => x.id === id)
      if (r) Object.assign(r, patch)
    },
    savePick: async pick => {
      store.picks = store.picks.filter(p => !(p.round_id === pick.round_id && p.discord_user_id === pick.discord_user_id))
      store.picks.push({ ...pick, correct: null })
    },
    gradePicks: async (roundId, key) => {
      for (const p of store.picks) {
        if (p.round_id !== roundId) continue
        p.correct = key == null ? null : p.option_key === key
      }
    },
    game: async () => store.game_,
    gamesByStatus: async status => (store.game_.status === status ? [store.game_] : []),
    teams: async (): Promise<PredictTeam[]> => ([
      { id: 'SF', name: 'San Francisco Firebells', abbr: 'SF', color: '#e8412c' },
      { id: 'BOS', name: 'Boston Hunters', abbr: 'BOS', color: '#2e5f3a' },
    ]),
    plays: async (_id, min = 0) => store.plays_.filter(p => p.sequence >= min),
    winner: async gameId => store.winners.find(w => w.game_id === gameId) ?? null,
    claimWinner: async row => {
      // The real one is an INSERT against a primary key: the conflict IS the lock.
      if (store.winners.some(w => w.game_id === row.game_id)) return false
      store.winners.push(row)
      return true
    },
    updateWinner: async (gameId, patch) => {
      const w = store.winners.find(x => x.game_id === gameId)
      if (w) Object.assign(w, patch)
    },
  }
  return store
}

beforeEach(() => {
  // Every Discord call in this path is best effort. Failing them all is the harsher test: the
  // round must still grade and score with the channel unreachable.
  vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })))
})

describe('the settle pass', () => {
  it('leaves a round open while its window is still running', async () => {
    const store = fakeStore({ locks_at: '2026-08-20T01:05:00.000Z' })
    const result = await settleGame(store, GAME_ID, { now: new Date('2026-08-20T01:00:00Z') })
    expect(result).toMatchObject({ locked: 0, graded: 0 })
    expect(store.rounds[0].status).toBe('open')
  })

  it('closes picks when the timer runs out', async () => {
    const store = fakeStore({ locks_at: '2026-08-20T01:00:00.000Z' })
    const result = await settleGame(store, GAME_ID, { now: new Date('2026-08-20T01:00:01Z') })
    expect(result.locked).toBe(1)
    expect(store.rounds[0].status).toBe('locked')
    expect(store.rounds[0].closed_at).toBeTruthy()
  })

  it('closes picks the moment the half-inning starts, timer or no timer', async () => {
    const store = fakeStore({ locks_at: '2026-08-20T09:00:00.000Z' })
    store.plays_ = [play(3, 'top')]
    await settleGame(store, GAME_ID, { now: new Date('2026-08-20T01:00:00Z') })
    expect(store.rounds[0].status).toBe('locked')
  })

  it('grades the round and marks every pick once the frame is over', async () => {
    const store = fakeStore({ status: 'locked' })
    store.picks = [
      { round_id: 'r1', discord_user_id: 'ana', display_name: 'Ana', option_key: '2', response_ms: 1000, correct: null },
      { round_id: 'r1', discord_user_id: 'bo', display_name: 'Bo', option_key: '0', response_ms: 2000, correct: null },
    ]
    store.plays_ = [play(3, 'top', { runs_scored: 2 }), play(3, 'bottom')]

    const result = await settleGame(store, GAME_ID, { now: new Date('2026-08-20T01:10:00Z') })
    expect(result.graded).toBe(1)
    expect(store.rounds[0]).toMatchObject({ status: 'graded', correct_key: '2', outcome: '2 runs' })
    expect(store.picks.map(p => p.correct)).toEqual([true, false])
  })

  it('voids a half-inning the game never got to, and scores it for nobody', async () => {
    const store = fakeStore({ status: 'locked', target_inning: 7, target_half: 'bottom' })
    store.game_.status = 'final'
    store.picks = [
      { round_id: 'r1', discord_user_id: 'ana', display_name: 'Ana', option_key: '2', response_ms: 1000, correct: null },
    ]
    store.plays_ = [play(7, 'top', { runs_scored: 1 })]

    const result = await settleGame(store, GAME_ID, { now: new Date('2026-08-20T02:00:00Z') })
    expect(result.voided).toBe(1)
    expect(store.rounds[0].status).toBe('void')
    expect(store.picks[0].correct).toBeNull()
    // A void round counts for nobody, so the game has no winner to crown from it.
    expect(store.winners[0]).toMatchObject({ discord_user_id: null, correct: 0, rounds: 1 })
  })

  it('crowns exactly one winner when the game is final, however many callers race', async () => {
    const store = fakeStore({ status: 'graded', correct_key: '1' })
    store.game_.status = 'final'
    store.picks = [
      { round_id: 'r1', discord_user_id: 'ana', display_name: 'Ana', option_key: '1', response_ms: 3000, correct: true },
      { round_id: 'r1', discord_user_id: 'bo', display_name: 'Bo', option_key: '0', response_ms: 1000, correct: false },
    ]

    const first = await settleGame(store, GAME_ID, {})
    const second = await settleGame(store, GAME_ID, {})
    expect(first.crowned).toBe(true)
    expect(second.crowned).toBe(false)
    expect(store.winners).toHaveLength(1)
    expect(store.winners[0]).toMatchObject({ discord_user_id: 'ana', display_name: 'Ana', correct: 1, answered: 1 })
  })

  it('does not crown a game that is still being played', async () => {
    const store = fakeStore({ status: 'graded', correct_key: '1' })
    await settleGame(store, GAME_ID, {})
    expect(store.winners).toHaveLength(0)
  })

  it('waits for every round before crowning', async () => {
    const store = fakeStore({ status: 'graded', correct_key: '1' })
    store.rounds.push({ ...store.rounds[0], id: 'r2', status: 'locked', target_inning: 9, target_half: 'top' })
    store.game_.status = 'final'
    // r2 grades on this same pass (a final game settles everything), so the crown lands with it
    // rather than being left for a pass that would never come.
    store.plays_ = [play(9, 'top', { runs_scored: 1 })]
    const result = await settleGame(store, GAME_ID, {})
    expect(store.rounds[1].status).toBe('graded')
    expect(result.crowned).toBe(true)
  })

  it('holds the crown back when the caller asks to announce it itself', async () => {
    const store = fakeStore({ status: 'graded', correct_key: '1' })
    store.game_.status = 'final'
    const result = await settleGame(store, GAME_ID, { crown: false })
    expect(result.crowned).toBe(false)
    expect(store.winners).toHaveLength(0)
  })

  it('sweeps every game with a live round', async () => {
    const store = fakeStore({ locks_at: '2026-08-20T01:00:00.000Z' })
    const result = await settleOpenRounds(store, { now: new Date('2026-08-20T01:00:01Z') })
    expect(result.locked).toBe(1)
  })

  it('never throws at the ingest, whatever the database does', async () => {
    const store = fakeStore()
    store.roundsForGame = async () => { throw new Error('postgrest 503') }
    await expect(settleGame(store, GAME_ID, {})).resolves.toMatchObject({ graded: 0, crowned: false })
    store.openRounds = async () => { throw new Error('postgrest 503') }
    await expect(settleOpenRounds(store, {})).resolves.toMatchObject({ locked: 0 })
  })

  it('reads the board back from what it wrote', async () => {
    const store = fakeStore({ status: 'graded', correct_key: '1' })
    store.picks = [
      { round_id: 'r1', discord_user_id: 'ana', display_name: 'Ana', option_key: '1', response_ms: 3000, correct: true },
    ]
    const { board, winner } = await gameBoard(store, GAME_ID)
    expect(board).toHaveLength(1)
    expect(winner?.name).toBe('Ana')
  })
})
