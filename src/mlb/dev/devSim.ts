// ─── Dev-only prediction slate simulator ──────────────────────────────────────
// Lets you fabricate a random slate of "today's games" and then decide their
// winners, so the Predictor widget (picks + correct/wrong feedback + stats) can
// be exercised without waiting for real games to be scheduled and finish.
//
// This is a plain module singleton (like homeOverlay) with a tiny subscribe API,
// deliberately NOT React state, so DevSettings (which toggles it) and the
// PredictorWidget (which reads it) can share it without threading props through
// useMlbState. Everything here is inert in production: the DevSettings menu that
// mutates it and the PredictorWidget branch that reads it are both gated behind
// import.meta.env.DEV, so the bundler drops those call sites entirely.

import { useSyncExternalStore } from 'react'
import type { TodayGame } from '../views/Predictor'
import { TEAM_ABBR, TEAM_NICKNAME } from '../constants'

const STORAGE_KEY = 'mlb_dev_sim_slate'

// gamePk → teamId → fake crowd-vote count, mirroring the shape PredictorWidget
// gets from Supabase, so simulated games can show a vote split too.
export type DevSimVotes = Record<number, Record<number, number>>

export interface DevSimState {
  enabled: boolean       // when true, PredictorWidget uses `games` instead of the real schedule
  games:   TodayGame[]   // the fabricated slate (stable gamePks so picks persist across renders)
  votes:   DevSimVotes   // fabricated crowd-vote splits, keyed by gamePk
}

const TEAM_IDS = Object.keys(TEAM_ABBR).map(Number)

// Fake gamePks live in a high range so they can never collide with real MLB
// gamePks — keeps simulated picks in localStorage from polluting a real day.
const FAKE_PK_BASE = 9_000_000

function load(): DevSimState {
  try {
    const s = localStorage.getItem(STORAGE_KEY)
    if (s) {
      const parsed = JSON.parse(s)
      if (parsed && Array.isArray(parsed.games)) return { votes: {}, ...parsed }
    }
  } catch { /* fall through to default */ }
  return { enabled: false, games: [], votes: {} }
}

let state: DevSimState = load()
const listeners = new Set<() => void>()

function commit(next: DevSimState) {
  state = next
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)) } catch { /* ignore */ }
  listeners.forEach(l => l())
}

// ─── Slate generation ──────────────────────────────────────────────────────────

// Build one preview matchup between two teams.
function makeGame(gamePk: number, awayId: number, homeId: number): TodayGame {
  const side = (id: number) => ({
    teamId:  id,
    abbr:    TEAM_ABBR[id] ?? '???',
    name:    TEAM_NICKNAME[id] ?? TEAM_ABBR[id] ?? '???',
    pitcher: null,
  })
  return {
    gamePk,
    gameTime: `${1 + Math.floor(Math.random() * 9)}:${Math.random() < 0.5 ? '05' : '35'} PM`,
    state:    'preview',
    home:     side(homeId),
    away:     side(awayId),
    winnerId: null,
  }
}

// Shuffle the 30 teams and pair them off into a fresh, all-preview slate, plus a
// random crowd-vote split for each game so the widget's percentages have data.
function randomSlate(): { games: TodayGame[]; votes: DevSimVotes } {
  const ids = [...TEAM_IDS].sort(() => Math.random() - 0.5)
  const pairs = Math.floor(ids.length / 2)          // 15 possible games
  const count = Math.min(pairs, 8 + Math.floor(Math.random() * 6))  // ~8–13 games
  const games: TodayGame[] = []
  const votes: DevSimVotes = {}
  for (let i = 0; i < count; i++) {
    const awayId = ids[i * 2], homeId = ids[i * 2 + 1]
    const g = makeGame(FAKE_PK_BASE + i, awayId, homeId)
    games.push(g)
    const total = 8 + Math.floor(Math.random() * 55)  // ~8–62 total picks
    const awayShare = Math.round(total * (0.2 + Math.random() * 0.6))  // 20–80% to away
    votes[g.gamePk] = { [awayId]: awayShare, [homeId]: total - awayShare }
  }
  return { games, votes }
}

// ─── Mutations (dev settings menu calls these) ─────────────────────────────────

// Turn the simulator on/off. Turning it on with no slate yet generates one.
export function setDevSimEnabled(on: boolean) {
  if (on && state.games.length === 0) {
    commit({ enabled: true, ...randomSlate() })
  } else {
    commit({ ...state, enabled: on })
  }
}

// Reshuffle into a brand-new all-preview slate (also clears any decided winners).
export function regenerateDevSim() {
  commit({ enabled: true, ...randomSlate() })
}

// Decide every game: flip each to Final with a coin-flip winner. This is what
// reveals the ✓/✗ feedback against whatever picks you made.
export function decideDevSimWinners() {
  commit({
    ...state,
    games: state.games.map(g => ({
      ...g,
      state:    'final',
      winnerId: Math.random() < 0.5 ? g.home.teamId : g.away.teamId,
    })),
  })
}

// Re-open all games for picking (clears the decided winners).
export function reopenDevSim() {
  commit({
    ...state,
    games: state.games.map(g => ({ ...g, state: 'preview', winnerId: null })),
  })
}

// ─── React binding ─────────────────────────────────────────────────────────────

const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }
const getSnapshot = () => state

export function useDevSim(): DevSimState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
