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

// The standalone pages (season recap, gallery, Scorigami, ...): what readers reach and use
// there. See admin_wpbl_page_usage. `browsers` is the lead number for all three lists.
export interface PageSection { page: string; section: string; events: number; browsers: number }
export interface PageOpen    { page: string; section: string; kind: string; events: number; browsers: number }
export interface PageControl { page: string; control: string; events: number; browsers: number }
export interface PageUsage   { sections: PageSection[]; opens: PageOpen[]; controls: PageControl[] }
export const EMPTY_PAGE_USAGE: PageUsage = { sections: [], opens: [], controls: [] }

// ─── the event catalog, as the dashboard reads it ─────────────────────────────
//
// WHY THIS EXISTS. The Events card listed every name in `events` ranked by volume: 52 of them in
// a week, headed by six impressions that fire on their own whenever Home draws, with retired
// names and zeros in the tail. The actions worth reading sat under all of it. This says, per
// name, what it is to a reader of /admin: a plain label, the area it belongs to, and whether it
// is something a person DID ('action'), something a surface fired on its own ('impression'), or
// a name nothing fires any more ('retired'). Impressions are read as the first half of a pair
// (HOME_FUNNELS below) rather than as counts, and retired names only in the raw list.
//
// A name missing here still shows, under "Other", with its raw spelling: a new event is visible
// the day it ships and gets a label when someone gets to it, rather than vanishing.

export type EventKind = 'action' | 'impression' | 'retired'
export interface EventInfo { label: string; group: string; kind: EventKind }

const A = (label: string, group: string): EventInfo => ({ label, group, kind: 'action' })
const I = (label: string, group: string): EventInfo => ({ label, group, kind: 'impression' })
const R = (label: string, group: string): EventInfo => ({ label, group, kind: 'retired' })

/** Area order on the card. */
export const EVENT_GROUPS = [
  'Games', 'Players & teams', 'Stats', 'Pages', 'Home', 'Search & sharing',
  'Reading & photos', 'Awards & picks', 'Accounts', 'MLB', 'Other',
] as const

export const EVENT_INFO: Record<string, EventInfo> = {
  game_center_opened:     A('Opened a game', 'Games'),
  wpbl_game_tab:          A('Game Center tab shown', 'Games'),
  wpbl_revisions_open:    A("Read a game's scoring changes", 'Games'),
  wpbl_game_calendar:     A('Added a game to a calendar', 'Games'),
  wpbl_game_reminder_on:  A('Turned a game reminder on', 'Games'),
  wpbl_game_reminder_off: A('Turned a game reminder off', 'Games'),

  wpbl_player_opened:     A('Opened a player', 'Players & teams'),
  wpbl_team_opened:       A('Opened a team', 'Players & teams'),
  wpbl_player_role:       A('Switched hitting / pitching on a player', 'Players & teams'),
  wpbl_compare_opened:    A('Opened Compare', 'Players & teams'),
  wpbl_compare_viewed:    A('Viewed a comparison', 'Players & teams'),

  wpbl_tab_viewed:        A('Switched tab', 'Stats'),
  wpbl_stats_board:       A('Stats board on screen', 'Stats'),
  wpbl_stats_sorted:      A('Sorted a stats column', 'Stats'),
  wpbl_stats_filtered:    A('Filtered stats', 'Stats'),

  wpbl_page_section_seen: A('Reached a section of a page', 'Pages'),
  wpbl_page_open:         A('Left a page for a game, player or team', 'Pages'),
  wpbl_page_control:      A('Used a control on a page', 'Pages'),

  wpbl_league_card_shown: I('League card shown', 'Home'),
  wpbl_league_card_open:  A('Opened the league card', 'Home'),
  wpbl_season_card_shown: I('Season card shown', 'Home'),
  wpbl_season_card_open:  A('Opened the season recap from Home', 'Home'),
  wpbl_bracket_shown:     I('Bracket shown', 'Home'),
  wpbl_bracket_series:    A('Opened a series from the bracket', 'Home'),
  wpbl_bracket_team:      A('Opened a club from the bracket', 'Home'),
  wpbl_compare_shown:     I('Compare card shown', 'Home'),
  discord_shown:          I('Discord invite shown', 'Home'),
  discord_joined:         A('Joined the Discord', 'Home'),
  discord_dismissed:      A('Dismissed the Discord invite', 'Home'),
  new_badge_shown:        I('"New" dot shown', 'Home'),
  new_badge_clicked:      A('Opened something with a "new" dot', 'Home'),

  wpbl_searched:          A('Searched', 'Search & sharing'),
  wpbl_search_picked:     A('Picked a search result', 'Search & sharing'),
  wpbl_share_copied:      A('Copied a share link', 'Search & sharing'),
  wpbl_share_opened:      A('Arrived from a share link', 'Search & sharing'),

  wpbl_reading_shown:     I('Reading shown', 'Reading & photos'),
  wpbl_reading_archive:   A('Opened all posts', 'Reading & photos'),
  wpbl_article_opened:    A('Opened a post', 'Reading & photos'),
  wpbl_recap_opened:      A('Opened an outside game recap', 'Reading & photos'),
  wpbl_author_opened:     A("Opened the writer's site", 'Reading & photos'),
  wpbl_fan_photo_opened:  A('Opened a fan photo', 'Reading & photos'),
  wpbl_photo_opened:      A('Opened an archive photo', 'Reading & photos'),
  wpbl_photo_source:      A("Opened a photo's source", 'Reading & photos'),
  wpbl_highlight_played:  A('Played a highlight', 'Reading & photos'),
  wpbl_highlight_youtube: A('Opened a highlight on YouTube', 'Reading & photos'),

  wpbl_award_shown:       I('Fan awards shown', 'Awards & picks'),
  wpbl_award_open:        A('Opened fan awards', 'Awards & picks'),
  wpbl_award_vote:        A('Voted in fan awards', 'Awards & picks'),
  wpbl_pickem_shown:      I("Pick'em shown", 'Awards & picks'),
  wpbl_pickem_open:       A("Opened the pick'em", 'Awards & picks'),
  wpbl_pickem_cast:       A('Made a series pick', 'Awards & picks'),
  wpbl_pickem_clear:      A('Withdrew series picks', 'Awards & picks'),

  login:                  A('Signed in', 'Accounts'),
  signup:                 A('Created an account', 'Accounts'),

  prediction_made:        A('Made a prediction', 'MLB'),
  board_viewed:           A('Opened the predictions board', 'MLB'),

  wpbl_reading_collapsed: R('Reading collapsed', 'Reading & photos'),
  wpbl_photos_shown:      R('Archive shown on Home', 'Reading & photos'),
  wpbl_photos_gallery:    R('Opened the archive gallery', 'Reading & photos'),
  wpbl_shelf_segment:     R('Switched Home shelf segment', 'Home'),
  wpbl_shelf_collapsed:   R('Collapsed Home shelf', 'Home'),
  wpbl_highlights_shown:  R('Highlights shown on Home', 'Home'),
  wpbl_seeding_shown:     R('Seeding race shown', 'Home'),
  wpbl_seeding_team:      R('Opened a club from the seeding race', 'Home'),
  wpbl_mvp_shown:         R('MVP race shown', 'Home'),
  wpbl_mvp_player:        R('Opened a player from the MVP race', 'Home'),
}

export function eventInfo(name: string): EventInfo {
  return EVENT_INFO[name] ?? { label: prettyEvent(name), group: 'Other', kind: 'action' }
}

export interface ActionRow { event: string; label: string; events: number; browsers: number; prev_browsers: number }
export interface ActionGroup { group: string; rows: ActionRow[]; browsers: number }

/**
 * The "What people do" card: every ACTION with any activity in the window, grouped by area and
 * ranked by browsers. Impressions and retired names are left out (they are in the raw list), and
 * so are zero rows, which the RPC returns for events that only fired in the previous window.
 */
export function groupActions(events: EventCount[]): ActionGroup[] {
  const by = new Map<string, ActionRow[]>()
  for (const e of events) {
    const info = eventInfo(e.event)
    if (info.kind !== 'action' || e.events === 0) continue
    const rows = by.get(info.group) ?? []
    rows.push({ event: e.event, label: info.label, events: e.events, browsers: e.browsers, prev_browsers: e.prev_browsers })
    by.set(info.group, rows)
  }
  return EVENT_GROUPS
    .filter(g => by.has(g))
    .map(g => {
      const rows = by.get(g)!.sort((a, b) => b.browsers - a.browsers || b.events - a.events)
      return { group: g, rows, browsers: Math.max(...rows.map(r => r.browsers)) }
    })
}

/**
 * Home's cards as "saw it, then used it", in browsers. Each impression is only half a number:
 * 820 browsers seeing the bracket means nothing until you know how many opened a series from it.
 * Browsers rather than events on both sides, because impressions fired once per MOUNT until
 * Sep 25, 2026, so their event counts are inflated for any window reaching back past it, while a
 * browser is a browser either way.
 *
 * `used` is the action that says the card worked. Where a card has two (the bracket opens a
 * series or a club), the larger browser count stands in, since browsers cannot be summed.
 */
export const HOME_FUNNELS: Array<{ label: string; seen: string; used: string[]; verb: string }> = [
  { label: 'Fan awards',   seen: 'wpbl_award_shown',       used: ['wpbl_award_open'],                             verb: 'opened it' },
  { label: 'Bracket',      seen: 'wpbl_bracket_shown',     used: ['wpbl_bracket_series', 'wpbl_bracket_team'],    verb: 'opened a series or club' },
  { label: 'Season card',  seen: 'wpbl_season_card_shown', used: ['wpbl_season_card_open'],                       verb: 'opened the recap' },
  { label: 'League card',  seen: 'wpbl_league_card_shown', used: ['wpbl_league_card_open'],                       verb: 'opened it' },
  { label: 'Compare card', seen: 'wpbl_compare_shown',     used: ['wpbl_compare_opened'],                         verb: 'opened Compare' },
  { label: 'Latest post',  seen: 'wpbl_reading_shown',     used: ['wpbl_article_opened', 'wpbl_reading_archive'], verb: 'opened a post' },
  { label: 'Discord',      seen: 'discord_shown',          used: ['discord_joined'],                              verb: 'joined' },
]

export interface FunnelRow { label: string; verb: string; seen: number; used: number }

export function buildFunnels(events: EventCount[]): FunnelRow[] {
  const br = new Map(events.map(e => [e.event, e.browsers]))
  return HOME_FUNNELS
    .map(f => ({ label: f.label, verb: f.verb, seen: br.get(f.seen) ?? 0, used: Math.max(0, ...f.used.map(u => br.get(u) ?? 0)) }))
    .filter(r => r.seen > 0)
}

/** Readable names for the page ids and the snake_case section / control ids the pages send. */
export const PAGE_LABELS: Record<string, string> = {
  season: 'Season recap', photos: 'Photos', scorigami: 'Scorigami', league: 'About the league',
  reading: 'Reading', players: 'All players', standings: 'Standings tab',
}
export function prettyId(id: string): string {
  const s = id.replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
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

/**
 * "+12%" / "−4%" / "×153" / "—". Rounds to whole percent; anything under 0.5% reads as flat.
 *
 * Past 10x growth the percent stops being readable: a surface instrumented mid-window has a
 * near-zero baseline, so `deltaPct` divides by it and the chip reads "+15207%", which is not
 * "up a lot" but "brand new" (the bracket card the day the fan-awards ballot got shared). A
 * multiple is honest and bounded where a five-digit percent is just noise the reader has been
 * told to ignore. Only positive deltas reach here: a loss floors at −100%.
 */
export function formatDelta(pct: number | null): string {
  if (pct == null) return '—'
  const r = Math.round(pct)
  if (r === 0) return '0%'
  if (r >= 1000) return `×${Math.round(1 + pct / 100)}`
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

export function fetchPageUsage(days: number, tz: string): Promise<PageUsage> {
  return callRpc('admin_wpbl_page_usage', { days_back: days, tz }, EMPTY_PAGE_USAGE)
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
  pages: PageUsage
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
    fetchPageUsage(days, tz),
  ]).then(([overview, events, tabs, statsBoards, entryPoints, search, players, growth, pages]) => ({
    overview, events, tabs, statsBoards, entryPoints, search, players, growth, pages,
  }))
}
