import { readSeed } from '../seed'
import type { WpblGame, WpblGamePlay } from '../types'

// Reads for the WPBL section. Everything degrades gracefully: if the tables don't
// exist yet (pre-migration) or a request fails, we log and return an empty result so
// the section renders an empty shell instead of throwing. Same tolerance the rest of
// the app uses for not-yet-migrated features.

// Upper bound on any single read. If the database stalls, the read resolves to its fallback
// instead of hanging forever (an infinite spinner); the section then shows its empty state and
// the next poll refills it once the DB recovers. Generous enough that a healthy request never
// trips it.
const READ_TIMEOUT_MS = 8000

export async function safe<T>(label: string, run: () => PromiseLike<{ data: T | null; error: unknown }>, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const timeout = new Promise<'timeout'>(resolve => { timer = setTimeout(() => resolve('timeout'), READ_TIMEOUT_MS) })
    const result = await Promise.race([run(), timeout])
    if (result === 'timeout') {
      console.warn(`[wpbl] ${label} timed out after ${READ_TIMEOUT_MS}ms`)
      return fallback
    }
    const { data, error } = result
    if (error) {
      console.warn(`[wpbl] ${label} failed:`, error)
      return fallback
    }
    return data ?? fallback
  } catch (e) {
    console.warn(`[wpbl] ${label} threw:`, e)
    return fallback
  } finally {
    clearTimeout(timer)
  }
}

// Collapse concurrent duplicate reads. On a cold load several views mount at once and ask
// for the same bulk dataset (WpblApp's search pool and Home both pull the full roster; the
// schedule poll can overlap a focus-refresh), and without this each fires its own DB query.
// Keyed by dataset, the in-flight promise is shared until it settles, then cleared: this
// only dedupes genuine overlap. Reads that land near each other but don't actually overlap
// are handled a layer up, by the BULK_FRESH_MS window on the cached bulk fetchers below.
export const inflight = new Map<string, Promise<unknown>>()
export function once<T>(key: string, run: () => Promise<T>): Promise<T> {
  const pending = inflight.get(key) as Promise<T> | undefined
  if (pending) return pending
  const p = run().finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}

/**
 * A dev-only interception point for the three reads that describe a game in progress.
 *
 * INSTALLED, not imported, and that is the whole design. The simulator behind it
 * (`dev/devLiveGame.ts`) is reachable only from `DevSettings`, which is proven absent from the
 * production bundle, so an import from here would be the one edge dragging it back in: a
 * production import of a module with top-level state is a side effect tree-shaking will not
 * remove. A slot costs three null checks and cannot leak.
 *
 * Every method is a pure transform of what the real read returned, so an uninstalled slot and
 * an installed-but-idle one are the same code path. See devLiveGame.ts for what it replays and
 * what it cannot.
 */
export interface WpblReadOverlay {
  schedule(games: WpblGame[]): WpblGame[]
  live(gameId: string, delta: Partial<WpblGame> | null): Partial<WpblGame> | null
  plays(gameId: string, plays: WpblGamePlay[]): WpblGamePlay[]
  /** Rows keyed to a game (lines, plays, pitches), for an overlay that adds games of its own:
   *  dev/devSecondSeason.ts clones last season into a fake next one. */
  keyed?<T extends { game_id: string }>(rows: T[]): T[]
  /** The real game behind an id the overlay made up, so a per-game read can ask the database. */
  sourceGameId?(gameId: string): string
  /** The real season behind one the overlay made up, so a season read can ask the database. */
  sourceSeason?(season: number): number
}

/** `keyed` from the installed overlay, or the rows untouched. */
export const overlayKeyed = <T extends { game_id: string }>(rows: T[]): T[] => readOverlay?.keyed?.(rows) ?? rows
/** A per-game read: ask for the real game, then hand the rows back under the id that was asked. */
export const overlayGameId = (gameId: string): string => readOverlay?.sourceGameId?.(gameId) ?? gameId
export const asGame = <T extends { game_id: string }>(rows: T[], gameId: string, asked: string): T[] =>
  gameId === asked ? rows : rows.map(r => ({ ...r, game_id: asked }))

export let readOverlay: WpblReadOverlay | null = null

export function installWpblReadOverlay(overlay: WpblReadOverlay | null) { readOverlay = overlay }

// ─── Session cache for the shared bulk reads ────────────────────────────────────
// The Stats and Home tabs both pull the full player roster and box-score lines, and a tab can
// remount (on desktop only the active tab is rendered), so without a cache each return would
// re-query the DB and flash the tab's loading spinner. Keep the last successful result so a
// remount repaints instantly, with a timestamp so a caller can still revalidate once it's
// stale (box scores change as games are played).

// The last visit's copy of the reads a first paint draws (seed.ts), installed at `at: 0` so every
// freshness check below sees it as stale and the first caller still reads the network. Lazy: a
// read is parsed only when something asks for it, since the lines alone are half a megabyte.
export const isList = <T,>(d: unknown): d is T[] => Array.isArray(d)

const seededNames = new Set<string>()
export function seeded<T>(name: string, held: unknown, valid: (d: unknown) => d is T, install: (d: T) => void): void {
  if (held || seededNames.has(name)) return
  seededNames.add(name)
  const data = readSeed<T>(name, valid)
  if (data) install(data)
}

// How long a bulk result is served straight from the cache without re-querying.
//
// `once()` above collapses reads that overlap in time; this collapses reads that merely
// land close together, which on a cold load is most of them. Several components ask for these
// same league-wide datasets independently (Home, GamePreview, StatsView, TeamPage,
// TrackingView), and a caller should not have to remember to check its own staleness: without
// this a single load re-pulls the full roster and every box-score line two or three times,
// hundreds of milliseconds apart.
//
// Kept comfortably below the 30s window Home's own gate uses, so nothing that revalidates
// on a schedule (the live-game poll runs at 60s) gets held back; this only absorbs the
// fan-out within one page load or one quick tab switch.
const BULK_FRESH_MS = 20_000

export const isFresh = (c: { at: number } | null): boolean => !!c && Date.now() - c.at < BULK_FRESH_MS

// THE TABLES THAT CHANGE OVER DAYS, NOT DURING A GAME, held for minutes instead. The 20s window
// above is about the fan-out within one load; for these it also meant that a reader who opened
// Reading from Home and came back a minute later re-pulled the gallery, every video, the league
// calendar, the roster and a scan of the tracking table, all of it identical, because Home
// remounts when it comes back from a page the section does not render. A fan photo is approved
// by hand, a video or an article arrives on a cron, TrackMan lands in batches days after the game:
// five minutes late is invisible for any of them. Everything a live game moves (lines, plays,
// recaps, the schedule) stays on BULK_FRESH_MS.
const SLOW_FRESH_MS = 5 * 60_000

export const isFreshSlow = (c: { at: number } | null): boolean => !!c && Date.now() - c.at < SLOW_FRESH_MS

// ─── Per-entity session cache ───────────────────────────────────────────────────
//
// The same contract as the bulk caches, for PER-THING reads, which is what the two surfaces a
// reader opens over and over are made of: the four club buttons on a team page, whose whole job
// is to be tapped back and forth, and a player card opened from a leaderboard, closed, and
// opened again. Uncached, the second visit spins exactly as long as the first, on data that has
// not changed since ten seconds ago.
//
// Keyed by entity id: `isFresh` decides whether a read is skipped, `once` collapses two callers
// landing together, and a `getCached*` accessor lets a component paint from the cache
// SYNCHRONOUSLY on its first render. That last part is what removes the spinner rather than
// merely shortening it: seeding state in an effect still gives you one frame of empty, and one
// frame of empty is a flash.
//
// AN EMPTY RESULT NEVER EVICTS A GOOD ONE. `safe()` answers a failed or timed-out read with its
// fallback, which is `[]` or null here, so without this guard one dropped request would replace
// a club's roster with "no players" and keep serving that for the rest of the freshness window.
// Same reasoning as `mergeBulkLines`, one section up. `isEmpty` is per-cache because the shapes
// differ: a list is empty when it has no rows, a player's season when all three of its reads are.
//
// NOT FOR ANYTHING A POLL DEPENDS ON, AND THE PER-GAME READS ARE ALL OF THEM:
//
//   * `fetchWpblGameLive` is the live scoreboard's refresh. A cache on it is a scoreboard that
//     stops moving.
//   * `fetchWpblGameLines` looks like the obvious next one and is the trap. Game Center polls
//     it every LIVE_POLL_MS (15s) and ALSO re-reads it from a realtime subscription on
//     wpbl_batting_lines, so a 20s freshness window would swallow both: a run scores, the
//     change event fires, and the box score does not move for up to five seconds after the
//     poll that should have caught it. The window being longer than the poll is the whole
//     problem, and tuning one against the other is a worse bargain than not caching.
//   * `fetchWpblGamePlays`, `fetchWpblGameTracking` and `fetchWpblGameDetails` ride in the same
//     `reload()` as the lines, and Game Center already solves reopening with its own
//     `gameCache` at the component level, which is the right layer for it: that cache holds
//     the assembled view, not the four reads.
//
// So this is for entities whose data changes on the ingest's schedule rather than a poll's:
// a roster, a club's lineup history and usage, a player's season.
export function keyedCache<T>(name: string, read: (key: string) => Promise<T>, isEmpty: (v: T) => boolean) {
  const cache = new Map<string, { data: T; at: number }>()
  return {
    get: (key: string): T | null => cache.get(key)?.data ?? null,
    fetch: (key: string): Promise<T> => {
      const hit = cache.get(key)
      if (hit && isFresh(hit)) return Promise.resolve(hit.data)
      return once(`${name}:${key}`, async () => {
        const data = await read(key)
        if (!isEmpty(data) || !cache.has(key)) cache.set(key, { data, at: Date.now() })
        return cache.get(key)?.data ?? data
      })
    },
  }
}

export const emptyList = <T,>(v: T[]) => v.length === 0

/**
 * Read a whole table, a page at a time.
 *
 * PostgREST silently caps a bare `select` at 1000 rows (no error, just a short array), so
 * anything that means "every row" has to page explicitly or it quietly returns a prefix.
 * The `order` the caller passes matters as much as the paging does: without a deterministic
 * total order PostgREST can hand back the same row on two pages and skip another entirely
 * (the trap CLAUDE.md lists under "Read every row").
 */
export async function fetchAllPaged<T>(
  label: string,
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  /** Pages requested at once. 1 for a table that usually fits one page, where a speculative
   *  second request would be wasted; more for the play log, which runs to several pages and
   *  used to fetch them one round trip after another (four in a row on Home's first load). */
  wave = 1,
): Promise<T[]> {
  const PAGE = 1000
  const out: T[] = []
  for (let from = 0; ; from += PAGE * wave) {
    const pages = await Promise.all(Array.from({ length: wave }, (_, i) =>
      safe<T[]>(label, () => page(from + i * PAGE, from + (i + 1) * PAGE - 1), [])))
    // IN ORDER, AND STOPPING AT THE FIRST SHORT PAGE, exactly as the one-at-a-time loop did. A
    // page that failed comes back empty, and a later page that succeeded must not be stitched on
    // after the gap: a prefix is a known shape of wrong, rows with a hole in them are not.
    for (const rows of pages) {
      out.push(...rows)
      if (rows.length < PAGE) {
        // Every game-keyed table in the section is read through here, so this is the one place a
        // dev overlay's extra games join the bulk reads. Rows with no game_id pass untouched.
        return readOverlay?.keyed && out.length > 0 && typeof (out[0] as { game_id?: unknown }).game_id === 'string'
          ? overlayKeyed(out as unknown as { game_id: string }[]) as unknown as T[]
          : out
      }
    }
  }
}

export const numOrNull = (v: unknown): number | null => {
  if (v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) ? n : null
}

/** True on success. Every one of these logs and returns false rather than throwing, so a
 *  single failed edit leaves the rest of the queue usable. */
export async function ownerWrite(label: string, run: () => PromiseLike<{ error: unknown }>): Promise<boolean> {
  try {
    const { error } = await run()
    if (error) { console.error(`${label}:`, error); return false }
    return true
  } catch (e) {
    console.error(`${label}:`, e)
    return false
  }
}
