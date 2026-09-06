// ─── Dev-only live-game simulator ─────────────────────────────────────────────
//
// Replays a game that has already been played as though it were happening now, so the Live
// tab, the LIVE hero on Home, the scoreboard chip and the win-probability chart can all be
// worked on without waiting for the league to schedule a game and then be playing it.
//
// WHY THIS EXISTS. The live surfaces are the only ones in the section that cannot be opened
// on demand: there is one live game every few days, it lasts two hours, and the two states
// that are hardest to get right (the break between half-innings, and a count the feed sends
// impossible) each last about thirty seconds. Everything else in `/wpbl` can be looked at any
// time; this could be looked at almost never, which is why the pane it draws shipped with
// three of its states never having been seen on a screen.
//
// WHAT IS REAL AND WHAT IS NOT. Everything the simulator publishes is derived from the plays
// the league actually logged for that game, so the situation, the runners, the count, the
// score, the line score and the win-probability line are all the real thing, arriving in the
// real order. What is NOT replayed is the BOX SCORE: `wpbl_batting_lines` holds one cumulative
// row per player for the whole game, so there is nothing in it to rewind to, and a batter's
// statline in the Live pane therefore shows what she finished with. That is a lie the panel
// tells and it is the reason this is a dev tool rather than a feature.
//
// HOW IT REACHES THE APP. Through a slot in api.ts that this module fills in, NOT through an
// import from api.ts into the dev module and NOT through a dev import in the read path. The
// difference is production: `DevSettings` is the only thing that imports this file and it is
// proven absent from the production bundle, so everything here goes with it. An import the
// other way round would have to survive on tree-shaking, and the MLB predictor simulator next
// door shows how that goes: `devSim.ts` is in the shipped bundle today because one production
// call site imports it and its top-level `load()` counts as a side effect.
//
// Which is also why there is nothing at the top level of this module that runs. State loads on
// first touch.

import { fetchWpblGamePlays } from '../api'
import { runsOnPlay } from '../derive/playByPlay'
import { settleGame } from '../gameOver'
import type { WpblGame, WpblGamePlay, WpblLineScoreEntry, WpblLiveState } from '../types'

const STORAGE_KEY = 'wpbl_dev_live_sim'

/** How fast the replay runs, in real milliseconds per logged play. */
export const DEV_LIVE_SPEEDS = [1000, 5000, 20000] as const

export interface DevLiveState {
  enabled: boolean
  /** The finished game being replayed. */
  gameId: string | null
  /**
   * Plays completed at the moment the clock was last started or paused, and the wall clock it
   * started on. The live cursor is `cursor + elapsed/msPerPlay`, computed on READ rather than
   * ticked, so nothing has to fire on a timer for the answer to be current: whenever the app's
   * fifteen-second live poll happens to ask, it gets the right moment of the game.
   */
  cursor: number
  startedAt: number | null
  msPerPlay: number
}

/** Where a replay opens. Two plays is the Live tab's own gate, so starting under it would show
 *  a tab that is not there yet; a few more puts a runner on and a score on the board. */
const START_CURSOR = 3

function load(): DevLiveState {
  const fresh: DevLiveState = {
    enabled: false, gameId: null, cursor: START_CURSOR, startedAt: null, msPerPlay: 5000,
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return fresh
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? { ...fresh, ...parsed } : fresh
  } catch { return fresh }
}

let state: DevLiveState | null = null
const listeners = new Set<() => void>()

function get(): DevLiveState {
  if (!state) state = load()
  return state
}

function commit(next: DevLiveState) {
  state = next
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch { /* ignore */ }
  listeners.forEach(l => l())
  kick()
}

/**
 * Make every poll in the app pull NOW.
 *
 * Nothing in the section subscribes to this module: the overlay is a transform on a read, so
 * the app only learns the cursor moved the next time it happens to read. That is 60 seconds on
 * Home's schedule poll before a live game exists, which is a long time to wait after pressing
 * Start.
 *
 * `useForegroundInterval` already pulls immediately on `focus`, for a real reason (a page
 * coming back must not show a stale countdown), so a synthetic focus event is a kick that
 * every one of those hooks already knows how to take. No production hook, no dev branch in the
 * poll, and its own 1s guard stops a burst of these turning into a burst of reads.
 */
function kick() {
  try { window.dispatchEvent(new Event('focus')) } catch { /* not a browser */ }
}

/** Read the game's plays if we do not hold them. The overlay caches whatever comes back BEFORE
 *  it truncates, so this call feeding through the overlay cannot poison its own cache. */
function ensurePlays(gameId: string | null) {
  if (!gameId || playCache?.gameId === gameId || playsInFlight === gameId) return
  playsInFlight = gameId
  void fetchWpblGamePlays(gameId).finally(() => { playsInFlight = null }).then(() => {
    listeners.forEach(l => l())
    // A SPREAD OF KICKS, not one, and both reasons were found the hard way.
    //
    // An immediate kick is swallowed: pressing Start commits (which kicks, pulling a schedule
    // the simulator cannot yet replay because these plays are still in flight) and this lands a
    // fraction of a second later, inside `useForegroundInterval`'s one-second guard. And on a
    // COLD load with the simulator already switched on, a single delayed kick fires before
    // WpblApp has finished mounting, so there is no listener yet to take it.
    //
    // Anything cleverer means a subscription from the section into a dev module, which is the
    // one thing this design is avoiding. Three timers on a path that runs once per game chosen
    // is the cheaper mistake. Missing all three costs the ordinary sixty-second poll.
    for (const ms of [1100, 4000, 9000]) window.setTimeout(kick, ms)
  }).catch(() => {})
}

// The plays of the game being replayed, and the games the picker offers.
//
// Both are filled by reads passing through the overlay below rather than by parsing anything
// here, so the cache is always the raw list the database returned. `candidates` costs nothing:
// the section fetches the schedule anyway. The plays are usually free too (opening a game reads
// them), and `ensurePlays` asks for them directly only so that pressing Start does not require
// opening the game first.
let playCache: { gameId: string; plays: WpblGamePlay[] } | null = null
let candidates: WpblGame[] = []
// Which game's plays are being read right now. The schedule read arms the simulator on a cold
// load (see `schedule` below) and that read repeats on a poll, so without this a slow response
// would be asked for again on every tick until it landed.
let playsInFlight: string | null = null

// ─── The clock ─────────────────────────────────────────────────────────────────

/** How many plays of the game have been completed, right now. */
export function devLiveCursor(s: DevLiveState = get()): number {
  const elapsed = s.startedAt == null ? 0 : Date.now() - s.startedAt
  return Math.max(0, s.cursor + Math.floor(elapsed / Math.max(s.msPerPlay, 1)))
}

/** How many plays the chosen game has, or null while they have not been read yet. */
export function devLivePlayCount(): number | null {
  const s = get()
  return playCache && playCache.gameId === s.gameId ? playCache.plays.length : null
}

/** Is this replay live, or has it run past the last play of the game it is replaying? */
export function devLiveFinished(): boolean {
  const total = devLivePlayCount()
  return total != null && devLiveCursor() >= total
}

// ─── Mutations, all called from DevSettings ────────────────────────────────────

export function setDevLiveEnabled(on: boolean) {
  const s = get()
  // Enabling with nothing chosen picks the most recently played game, which is almost always
  // the one somebody wants: it is the one with the freshest data behind it.
  const gameId = s.gameId ?? devLiveCandidates()[0]?.id ?? null
  if (on) ensurePlays(gameId)
  commit({ ...s, enabled: on, gameId, startedAt: on ? Date.now() : null, cursor: on ? s.cursor : devLiveCursor(s) })
}

export function setDevLiveGame(gameId: string) {
  const s = get()
  playCache = null
  ensurePlays(gameId)
  commit({ ...s, gameId, cursor: START_CURSOR, startedAt: s.startedAt == null ? null : Date.now() })
}

export function setDevLivePlaying(playing: boolean) {
  const s = get()
  // Freeze the cursor where it actually is on the way to paused, and restart the clock from
  // there on the way back, so pausing never loses or gains plays.
  commit({ ...s, cursor: devLiveCursor(s), startedAt: playing ? Date.now() : null })
}

export function stepDevLive(by: number) {
  const s = get()
  const total = devLivePlayCount()
  const next = Math.max(0, Math.min(devLiveCursor(s) + by, total ?? Number.MAX_SAFE_INTEGER))
  commit({ ...s, cursor: next, startedAt: s.startedAt == null ? null : Date.now() })
}

export function setDevLiveSpeed(msPerPlay: number) {
  const s = get()
  commit({ ...s, cursor: devLiveCursor(s), msPerPlay, startedAt: s.startedAt == null ? null : Date.now() })
}

export function restartDevLive() {
  const s = get()
  commit({ ...s, cursor: START_CURSOR, startedAt: s.startedAt == null ? null : Date.now() })
}

/** The games the picker offers: played ones, most recent first. Read off the schedule the app
 *  fetched anyway, so choosing a game costs no request. */
export function devLiveCandidates(): WpblGame[] {
  return candidates
}

// ─── Building one moment of a finished game ────────────────────────────────────

/**
 * The game as it stood with `done` plays completed.
 *
 * THE SCORE IS RECONSTRUCTED, never read off the row, and it goes through `runsOnPlay` for the
 * reason CLAUDE.md gives: the feed's `runs_scored` does not count the batter, so summing it
 * scores a solo home run as nothing. This is the same walk `gameWinProb` does, which is what
 * makes the chart under the simulated game agree with the scoreboard above it.
 */
export function momentOf(game: WpblGame, plays: WpblGamePlay[], done: number): WpblGame {
  // Past the last play the replay is simply over, and the real final row is the honest answer:
  // watching a game go final under an open Game Center is one of the things worth testing.
  if (done >= plays.length) return game

  let home = 0, away = 0, homeHits = 0, awayHits = 0, homeErr = 0, awayErr = 0
  const homeRuns = new Map<number, number>()
  const awayRuns = new Map<number, number>()
  for (let i = 0; i < done; i++) {
    const p = plays[i]
    const runs = runsOnPlay(p)
    const isHome = p.team_id === game.home_team_id
    if (isHome) { home += runs; homeRuns.set(p.inning, (homeRuns.get(p.inning) ?? 0) + runs) }
    else { away += runs; awayRuns.set(p.inning, (awayRuns.get(p.inning) ?? 0) + runs) }
    if (p.is_hit) { if (isHome) homeHits++; else awayHits++ }
    // Charged to the side in the FIELD, which is the other one. Matched on the feed's own
    // phrase rather than on a flag, because a play row has no error column: approximate by
    // construction, and approximate is the right standard for a scoreboard in a dev tool that
    // would otherwise show the final game's error count beside a third-inning score.
    if (/ error by /i.test(p.narrative ?? '')) { if (isHome) awayErr++; else homeErr++ }
  }

  // The play about to be decided. Every field the situation needs is the state BEFORE it: the
  // outs, the runners (by name), the batter, the pitcher, and the count entering the pitch
  // that ended the at-bat. That last one is why the pips in the Live pane clamp: on a
  // strikeout the stored count is 3 strikes, which is exactly the shape of the impossible
  // count the real feed publishes between at-bats.
  const now = plays[done]
  const live: WpblLiveState = {
    complete: false,
    inning: now.inning,
    half: now.half === 'bottom' ? 'bottom' : 'top',
    batting_team_id: now.team_id ?? '',
    outs: now.outs ?? 0,
    balls: now.balls ?? 0,
    strikes: now.strikes ?? 0,
    batter_name: now.batter_name ?? '',
    pitcher_name: now.pitcher_name ?? '',
    first_base: now.first_base ?? '',
    second_base: now.second_base ?? '',
    third_base: now.third_base ?? '',
    bases_occupied: [now.first_base, now.second_base, now.third_base].filter(Boolean) as string[],
    bases_loaded: !!(now.first_base && now.second_base && now.third_base),
    away_runs: away,
    home_runs: home,
  }

  // Innings the two sides have actually batted in. The visitors have batted in every inning up
  // to and including this one; the home side only once the bottom half has begun.
  const lineFor = (runs: Map<number, number>, through: number): WpblLineScoreEntry[] => {
    const out: WpblLineScoreEntry[] = []
    for (let i = 1; i <= through; i++) out.push({ inning: i, runs: runs.get(i) ?? 0 })
    return out
  }

  // Through the real settle rule, so a replay that reaches a walk-off or a home side that need
  // not bat goes final here exactly as the live section would call it. Nothing about the
  // simulator gets to skip a rule the real thing applies.
  // Both clocks, or the page says the feed has gone quiet. `feedHealth` reads `updated_at` (when
  // we last wrote the row) and `source_updated_at` (when the league last stamped it), and on a
  // game played yesterday both are hours old: the Live tab opened under a "Waiting on the
  // league, no update since 7:00 PM" banner, which is exactly the state a real live game is not
  // in. A replay is pretending the game is happening now, so it has to pretend about the clocks
  // too, and the note it silences is one of the things worth being able to look at.
  const stamp = new Date().toISOString()

  return settleGame({
    ...game,
    status: 'live',
    updated_at: stamp,
    source_updated_at: stamp,
    live_state: live,
    home_score: home,
    away_score: away,
    home_hits: homeHits, away_hits: awayHits,
    home_errors: homeErr, away_errors: awayErr,
    home_line: lineFor(homeRuns, live.half === 'bottom' ? now.inning : now.inning - 1),
    away_line: lineFor(awayRuns, now.inning),
  })
}

// ─── The overlay api.ts installs ───────────────────────────────────────────────

/**
 * The three reads the section makes about a game in progress, intercepted.
 *
 * Every one of them is a PURE transform of what the real read returned, so with the simulator
 * off (or pointed at another game) each is the identity and the app is byte-for-byte on the
 * real path. The overlay is installed unconditionally in dev and never in production, so there
 * is no branch in the read path that behaves differently between the two.
 */
export const devLiveOverlay = {
  schedule(games: WpblGame[]): WpblGame[] {
    // Cached whether or not the simulator is on, so the picker has something to offer the
    // first time the menu is opened. Played games only, most recent first.
    candidates = games
      .filter(g => g.status === 'final')
      .sort((a, b) => b.game_date.localeCompare(a.game_date))

    const s = get()
    if (!s.enabled || !s.gameId) return games
    const plays = playCache?.gameId === s.gameId ? playCache.plays : null
    // Nothing to replay until the plays are in hand, so ask for them and leave the game as the
    // final it really is until they land. THIS is what arms a reload: the switch is remembered
    // in localStorage but the plays are not, so on a cold load with the simulator already on,
    // the schedule read is the first thing that happens and has to be the thing that starts it.
    // Guarded against re-asking while the read is in flight, because this runs on every poll.
    if (!plays || plays.length === 0) { ensurePlays(s.gameId); return games }
    const done = devLiveCursor(s)
    return games.map(g => (g.id === s.gameId ? momentOf(g, plays, done) : g))
  },

  /**
   * The live poll's volatile column subset, for the game being replayed.
   *
   * MERGED OVER THE FULL ROW FIRST, and that is not tidiness. `LIVE_GAME_COLUMNS` is only the
   * columns that can move during a game, so the delta has no `home_team_id`: handed to
   * `momentOf` on its own, every `p.team_id === game.home_team_id` test is false and the whole
   * game is scored to the visitors. It looked entirely plausible, too. Home's LIVE hero read
   * 11-0 in a game that finished 10-6, and only the scoreboard chip beside it (which comes off
   * the schedule, where the row IS complete) disagreed.
   */
  live(gameId: string, delta: Partial<WpblGame> | null): Partial<WpblGame> | null {
    const s = get()
    if (!s.enabled || s.gameId !== gameId || !delta) return delta
    const plays = playCache?.gameId === gameId ? playCache.plays : null
    if (!plays || plays.length === 0) return delta
    const full = candidates.find(g => g.id === gameId)
    if (!full) return delta
    return momentOf({ ...full, ...delta }, plays, devLiveCursor(s))
  },

  /**
   * The plays, cut off where the replay has got to.
   *
   * This is also where the module LEARNS the game: the app reads a game's plays the moment
   * anybody opens it, so the simulator gets its source data off a request that was going to be
   * made anyway rather than issuing one of its own. That is the whole reason the picker lists
   * games rather than starting one: choosing a game arms it, and opening it loads it.
   */
  plays(gameId: string, plays: WpblGamePlay[]): WpblGamePlay[] {
    const s = get()
    if (s.gameId === gameId && plays.length > 0
      && (playCache?.gameId !== gameId || playCache.plays.length !== plays.length)) {
      playCache = { gameId, plays }
      listeners.forEach(l => l())
    }
    if (!s.enabled || s.gameId !== gameId) return plays
    return plays.slice(0, devLiveCursor(s))
  },
}

// ─── React binding ─────────────────────────────────────────────────────────────

export const subscribeDevLive = (fn: () => void) => {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}
export const devLiveSnapshot = (): DevLiveState => get()
