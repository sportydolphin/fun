// ─── Dev-only live drama simulator ────────────────────────────────────────────
// Fabricates random "Happening Now" events (no-hitters, walk-off watches, cycle
// watches, marathons) so the LiveDramaCard can be styled and exercised without
// waiting for real late-inning drama. Same module-singleton pattern as devSim:
// DevSettings mutates it, LiveDramaCard reads it, both call sites are gated
// behind import.meta.env.DEV so production tree-shakes everything away.
//
// Fakes are built with the SAME builders the real detector uses (liveDrama.ts),
// so headline/detail/severity render pixel-identical to production events.

import { useSyncExternalStore } from 'react'
import { TEAM_ABBR } from '../constants'
import {
  DramaEvent, DramaSide,
  makeNoHitEvent, makeWalkoffEvent, makeCycleEvent, makeMarathonEvent,
} from '../lib/liveDrama'

const STORAGE_KEY = 'mlb_dev_drama'

export interface DevDramaState {
  enabled: boolean         // when true, LiveDramaCard shows `events` and stops polling
  events:  DramaEvent[]
}

const TEAM_IDS = Object.keys(TEAM_ABBR).map(Number)

// Distinct fake-pk range (devSim uses 9_000_000+) so nothing ever collides.
const FAKE_PK_BASE = 9_100_000

// Obviously-fake names so a screenshot of the sim can never be mistaken for news
const FAKE_PITCHERS = ['Nolan Nohit', 'Cy Simulation', 'Randy Rehearsal', 'Blank Slate']
const FAKE_BATTERS  = ['Wally Walkoff', 'Cycle Cyrus', 'Testy Triples', 'Demo Delgado']

function load(): DevDramaState {
  try {
    const s = localStorage.getItem(STORAGE_KEY)
    if (s) {
      const parsed = JSON.parse(s)
      if (parsed && Array.isArray(parsed.events)) return parsed
    }
  } catch { /* fall through to default */ }
  return { enabled: false, events: [] }
}

let state: DevDramaState = load()
const listeners = new Set<() => void>()

function commit(next: DevDramaState) {
  state = next
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)) } catch { /* ignore */ }
  listeners.forEach(l => l())
}

// ─── Random event generation ──────────────────────────────────────────────────

const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)]
const rand = (lo: number, hi: number) => lo + Math.floor(Math.random() * (hi - lo + 1))

function randomDrama(): DramaEvent[] {
  const ids = [...TEAM_IDS].sort(() => Math.random() - 0.5)
  let pkSeq = 0
  const nextGame = () => {
    const awayId = ids.pop()!, homeId = ids.pop()!
    const side = (id: number, score: number, hits: number): DramaSide =>
      ({ id, abbr: TEAM_ABBR[id] ?? '?', score, hits })
    return { gamePk: FAKE_PK_BASE + pkSeq++, awayId, homeId, side }
  }

  const events: DramaEvent[] = []

  // No-hitter (sometimes perfect, sometimes combined)
  {
    const g = nextGame()
    const inning = rand(6, 9)
    const perfect = Math.random() < 0.35
    const hitlessAway = Math.random() < 0.5
    const pitchScore = rand(1, 5)
    events.push(makeNoHitEvent({
      gamePk: g.gamePk, inning, half: hitlessAway ? 'top' : 'bottom',
      away: g.side(g.awayId, hitlessAway ? 0 : pitchScore, hitlessAway ? 0 : rand(4, 9)),
      home: g.side(g.homeId, hitlessAway ? pitchScore : 0, hitlessAway ? rand(4, 9) : 0),
      hitlessSide: hitlessAway ? 'away' : 'home',
      through: inning - 1,
      pitcherName: Math.random() < 0.75 ? pick(FAKE_PITCHERS) : null,
      perfect,
    }))
  }

  // Walk-off watch
  {
    const g = nextGame()
    const inning = rand(9, 12)
    const tied = Math.random() < 0.5
    const homeScore = rand(2, 6)
    events.push(makeWalkoffEvent({
      gamePk: g.gamePk, inning,
      away: g.side(g.awayId, homeScore + (tied ? 0 : rand(1, 2)), rand(5, 11)),
      home: g.side(g.homeId, homeScore, rand(5, 11)),
    }))
  }

  // Cycle watch (~70% of slates)
  if (Math.random() < 0.7) {
    const g = nextGame()
    const inning = rand(5, 8)
    const complete = Math.random() < 0.25
    const batterHome = Math.random() < 0.5
    events.push(makeCycleEvent({
      gamePk: g.gamePk, inning, half: batterHome ? 'bottom' : 'top',
      away: g.side(g.awayId, rand(2, 8), rand(6, 12)),
      home: g.side(g.homeId, rand(2, 8), rand(6, 12)),
      playerName: pick(FAKE_BATTERS),
      teamId: batterHome ? g.homeId : g.awayId,
      complete,
      missing: complete ? undefined : pick(['single', 'double', 'triple', 'homer'] as const),
    }))
  }

  // Marathon (~50% of slates)
  if (Math.random() < 0.5) {
    const g = nextGame()
    const score = rand(3, 7)
    events.push(makeMarathonEvent({
      gamePk: g.gamePk, inning: rand(11, 17), half: Math.random() < 0.5 ? 'top' : 'bottom',
      away: g.side(g.awayId, score, rand(8, 14)),
      home: g.side(g.homeId, score, rand(8, 14)),
    }))
  }

  return events.sort((a, b) => b.severity - a.severity)
}

// ─── Mutations (dev settings menu calls these) ─────────────────────────────────

export function setDevDramaEnabled(on: boolean) {
  if (on && state.events.length === 0) {
    commit({ enabled: true, events: randomDrama() })
  } else {
    commit({ ...state, enabled: on })
  }
}

export function regenerateDevDrama() {
  commit({ enabled: true, events: randomDrama() })
}

// ─── React binding ─────────────────────────────────────────────────────────────

const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }
const getSnapshot = () => state

export function useDevDrama(): DevDramaState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
