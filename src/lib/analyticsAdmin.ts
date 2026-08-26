import { supabase } from './supabase'

// Owner-only read side of the `events` table, for the /admin dashboard.
//
// Every number here comes from a `security definer` RPC (scripts/migrations/
// 20260816195705_add_admin_analytics_rpcs.sql), never from a table read. Two reasons, and
// both are load-bearing:
//
//   * `events` is RLS'd to the site owner, and several of the growth counts read tables
//     that are RLS'd to *own rows only* (push_subscriptions, user_preferences). Counting
//     those from the browser would return the owner's own devices and report a site with
//     one user.
//   * The RPC re-checks public.is_site_owner() itself, so the privacy boundary is one
//     server-side check rather than a client that promises not to ask.
//
// Every fetch degrades to an empty shape and a console warning rather than throwing, so a
// machine that hasn't run the migration renders an empty panel instead of a blank route.

export type LeagueFilter = 'all' | 'wpbl' | 'mlb'

export interface DayPoint  { date: string; events: number; browsers: number; users: number }
export interface WindowTotals {
  events: number; browsers: number; users: number; signed_in_browsers: number
}
export interface Overview {
  tz: string
  days_back: number
  league: LeagueFilter
  /** First event ever recorded — lets the UI admit a range reaches back before the data. */
  first_event: string | null
  series: DayPoint[]
  totals: WindowTotals
  prev: WindowTotals
  /** Fixed today / 7-day / 30-day browser counts, unaffected by the range chip. */
  active: { today: number; week: number; month: number }
}

export interface EventCount {
  event: string
  events: number; browsers: number; users: number
  prev_events: number; prev_browsers: number
}

export interface TabStat    { view: string; via: string; events: number; browsers: number }
// The Stats tab's own axes. `board` is "<source> <side>" ('season hitting', 'tracked
// pitching') or the bare 'draft', which sits on neither axis.
export interface StatsBoard  { board: string; mode: string; events: number; browsers: number }
export interface StatsVia    { via: string; events: number; browsers: number }
export interface StatsSort   { key: string; side: string; asc: boolean; events: number; browsers: number }
export interface StatsFilter { filter: string; on: boolean; events: number; browsers: number }
export interface StatsBoards { boards: StatsBoard[]; via: StatsVia[]; sorts: StatsSort[]; filters: StatsFilter[] }
// How readers reach the section's three destinations. `dest` is 'player' | 'team' | 'game';
// `from` is the surface it was opened from, or '—' for rows written before the prop existed.
export interface EntrySource { dest: string; from: string; events: number; browsers: number }
export interface GameTabStat { tab: string; via: string; status: string; events: number; browsers: number }
export interface EntryPoints { sources: EntrySource[]; game_tabs: GameTabStat[] }

// The header search. `empty` is the searches that matched nothing, and `missed` is what those
// readers actually typed — the only place any typed text is stored (see analytics.ts).
export interface SearchTotals { searched: number; searched_browsers: number; empty: number; picked: number; picked_browsers: number }
export interface SearchPick   { type: string; source: string; events: number; browsers: number }
export interface SearchMiss   { q: string; events: number; browsers: number }
export interface SearchStats  { totals: SearchTotals; picks: SearchPick[]; missed: SearchMiss[] }

export interface TopPlayer  { player_id: string; name: string; team_id: string | null; opens: number; browsers: number }
export interface DiscordFunnel { impressions: number; shown: number; joined: number; dismissed: number }
export interface Growth {
  signups: Array<{ date: string; signups: number }>
  signups_window: number
  total_users: number; deleted_users: number
  push_users: number; push_devices: number
  notify_game_start: number; notify_picks: number; notify_wpbl_all: number
  game_reminder_users: number; game_reminder_rows: number
}

// ─── pure helpers (unit-tested; keep them free of supabase and React) ─────────

/**
 * Percent change from `prev` to `curr`, or null when there is nothing to compare against.
 *
 * Null rather than 0 or Infinity when `prev` is 0: "up ∞%" from a standing start is noise,
 * and "0%" would claim flat where the truth is unknown. The caller renders "new" instead.
 */
export function deltaPct(curr: number, prev: number): number | null {
  if (!prev) return null
  return ((curr - prev) / prev) * 100
}

/** "+12%" / "−4%" / "—". Rounds to whole percent; anything under 0.5% reads as flat. */
export function formatDelta(pct: number | null): string {
  if (pct == null) return '—'
  const r = Math.round(pct)
  if (r === 0) return '0%'
  return `${r > 0 ? '+' : '−'}${Math.abs(r)}%`
}

/** Compact counts for tiles: 1234 → "1.2k". Below 1000 stays exact. */
export function formatCount(n: number): string {
  if (n < 1000) return String(n)
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return `${Math.round(n / 1000)}k`
}

/**
 * A share as a percent string, with the denominator guarded.
 *
 * One decimal below 10% because the interesting rates here (Discord joins ~8%, signed-in
 * share ~4%) all live down there, and rounding them to whole percent throws away the
 * movement you're watching for.
 */
export function formatShare(part: number, whole: number): string {
  if (!whole) return '—'
  const pct = (part / whole) * 100
  return pct < 10 ? `${pct.toFixed(1)}%` : `${Math.round(pct)}%`
}

/**
 * Trim leading all-zero days off a series.
 *
 * The events table starts 2026-08-05, so a 90-day range would otherwise render two and a
 * half months of flat line before the data begins — a chart that says "we were quiet"
 * where the truth is "we weren't measuring". Only *leading* zeros go: a zero day inside
 * the data is real and must stay (that's the whole reason the SQL gap-fills).
 */
export function trimLeadingEmpty<T extends { events: number }>(series: T[]): T[] {
  const first = series.findIndex(d => d.events > 0)
  return first <= 0 ? series : series.slice(first)
}

/** "Aug 5" — a compact axis/row label from a YYYY-MM-DD date, parsed without a TZ shift. */
export function shortDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
    .toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** `wpbl_player_opened` → "Wpbl player opened", so the events table reads as prose. */
export function prettyEvent(name: string): string {
  const s = name.replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * Map a series onto an SVG polyline, given the drawing box.
 *
 * Returns the point list plus the peak, so the caller can label the y-axis with a real
 * number. A flat or empty series would divide by zero on the y scale — it pins to the
 * bottom of the box instead of producing NaN coordinates that silently erase the path.
 */
export function seriesPoints(
  values: number[],
  w: number, h: number, pad = 0,
): { points: string; max: number } {
  const max = Math.max(0, ...values)
  if (values.length === 0) return { points: '', max: 0 }
  const inner = h - pad * 2
  const step = values.length > 1 ? w / (values.length - 1) : 0
  const points = values
    .map((v, i) => {
      const x = values.length > 1 ? i * step : w / 2
      const y = pad + (max > 0 ? inner - (v / max) * inner : inner)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return { points, max }
}

/** The browser's IANA zone, so the day buckets line up with the owner's own calendar. */
export function localTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

// ─── RPC wrappers ─────────────────────────────────────────────────────────────

const EMPTY_TOTALS: WindowTotals = { events: 0, browsers: 0, users: 0, signed_in_browsers: 0 }

export const EMPTY_OVERVIEW: Overview = {
  tz: 'UTC', days_back: 30, league: 'all', first_event: null,
  series: [], totals: EMPTY_TOTALS, prev: EMPTY_TOTALS,
  active: { today: 0, week: 0, month: 0 },
}

export const EMPTY_STATS_BOARDS: StatsBoards = { boards: [], via: [], sorts: [], filters: [] }

export const EMPTY_ENTRY_POINTS: EntryPoints = { sources: [], game_tabs: [] }

export const EMPTY_SEARCH: SearchStats = {
  totals: { searched: 0, searched_browsers: 0, empty: 0, picked: 0, picked_browsers: 0 },
  picks: [], missed: [],
}

export const EMPTY_GROWTH: Growth = {
  signups: [], signups_window: 0, total_users: 0, deleted_users: 0,
  push_users: 0, push_devices: 0, notify_game_start: 0, notify_picks: 0,
  notify_wpbl_all: 0, game_reminder_users: 0, game_reminder_rows: 0,
}

// One call shape for all seven. The RPCs return jsonb, so supabase hands back the parsed
// object directly and there's nothing to unwrap.
async function callRpc<T>(fn: string, args: Record<string, unknown>, fallback: T): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) {
    console.warn(`[analytics-admin] ${fn} failed:`, error.message)
    return fallback
  }
  return (data as T) ?? fallback
}

export function fetchOverview(days: number, tz: string, league: LeagueFilter): Promise<Overview> {
  return callRpc('admin_analytics_overview', { days_back: days, tz, league }, EMPTY_OVERVIEW)
}

export function fetchEventCounts(days: number, tz: string, league: LeagueFilter): Promise<EventCount[]> {
  return callRpc('admin_event_counts', { days_back: days, league, tz }, [])
}

export function fetchTabStats(days: number, tz: string): Promise<TabStat[]> {
  return callRpc('admin_wpbl_tab_stats', { days_back: days, tz }, [])
}

export function fetchStatsBoards(days: number, tz: string): Promise<StatsBoards> {
  return callRpc('admin_wpbl_stats_boards', { days_back: days, tz }, EMPTY_STATS_BOARDS)
}

export function fetchEntryPoints(days: number, tz: string): Promise<EntryPoints> {
  return callRpc('admin_wpbl_entry_points', { days_back: days, tz }, EMPTY_ENTRY_POINTS)
}

export function fetchSearchStats(days: number, tz: string, lim = 25): Promise<SearchStats> {
  return callRpc('admin_wpbl_search', { days_back: days, tz, lim }, EMPTY_SEARCH)
}

export function fetchTopPlayers(days: number, tz: string, lim = 10): Promise<TopPlayer[]> {
  return callRpc('admin_top_players', { days_back: days, lim, tz }, [])
}

/**
 * NOT in `fetchAnalytics`. The Discord card was removed from /admin on Aug 25, 2026: the promo
 * it measured came off Home on Aug 19, so its impressions and dismissals are frozen while joins
 * keep accruing from the footer link, and the rates drift toward nonsense. Kept because the RPC
 * and the history behind it are still real and someone may want them once. Re-adding it to the
 * bundle puts a round trip back on every load of the page for a number that cannot move.
 */
export function fetchDiscordFunnel(days: number, tz: string): Promise<DiscordFunnel> {
  return callRpc('admin_discord_funnel', { days_back: days, tz },
    { impressions: 0, shown: 0, joined: 0, dismissed: 0 })
}

export function fetchGrowth(days: number, tz: string): Promise<Growth> {
  return callRpc('admin_growth', { days_back: days, tz }, EMPTY_GROWTH)
}

export interface AnalyticsBundle {
  overview: Overview
  events: EventCount[]
  tabs: TabStat[]
  statsBoards: StatsBoards
  entryPoints: EntryPoints
  search: SearchStats
  players: TopPlayer[]
  growth: Growth
}

/**
 * Everything the dashboard needs, in one round of parallel calls.
 *
 * `Promise.all` is safe here precisely because each wrapper swallows its own error: one
 * unavailable RPC yields an empty section, not a rejected bundle that blanks the page.
 */
export function fetchAnalytics(
  days: number, league: LeagueFilter, tz = localTz(),
): Promise<AnalyticsBundle> {
  return Promise.all([
    fetchOverview(days, tz, league),
    fetchEventCounts(days, tz, league),
    fetchTabStats(days, tz),
    fetchStatsBoards(days, tz),
    fetchEntryPoints(days, tz),
    fetchSearchStats(days, tz),
    fetchTopPlayers(days, tz),
    fetchGrowth(days, tz),
  ]).then(([overview, events, tabs, statsBoards, entryPoints, search, players, growth]) => ({
    overview, events, tabs, statsBoards, entryPoints, search, players, growth,
  }))
}
