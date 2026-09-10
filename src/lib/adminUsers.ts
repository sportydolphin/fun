import { supabase } from './supabase'
import { localTz } from './analyticsAdmin'

// Owner-only user roster for the Admin panel.
//
// THIS USED TO BE THREE BROWSER TABLE READS and it could only ever describe an MLB
// predictor: a name, a join date and a pick record. Everything that describes a WPBL reader
// lives in a table RLS'd to OWN ROWS ONLY (user_preferences, push_subscriptions,
// wpbl_game_reminders) or to the owner (events), so reading them from here returned the
// owner's own row and reported a site with one user. It all comes from one security-definer
// RPC now, `admin_user_roster`, which re-checks is_site_owner() itself: the same model as
// the nine analytics RPCs and the same reason (docs/ADMIN_ANALYTICS.md §2).
//
// The RPC is also what makes email and last-sign-in available at all: they are in auth.users
// and no browser read can reach them. That is the point of the function, and the reason it
// must never become a view.

/** The roles the panel can grant. Mirrored by the CHECK constraint on `user_roles.role`. */
export const SITE_ROLES = ['collaborator', 'moderator'] as const
export type SiteRole = typeof SITE_ROLES[number]

export interface RoleGrant { role: SiteRole; note: string | null }

export interface AdminUser {
  user_id:    string
  username:   string
  created_at: string
  is_deleted: boolean
  deleted_at: string | null

  // auth.users. Owner-only, and the only way to tell two accounts apart when the question
  // is "which of these is the person who emailed me".
  email:        string | null
  /** 'google' | 'email' | …: the difference between a password reset being useful and impossible. */
  provider:     string
  confirmed:    boolean
  last_sign_in: string | null

  // Activity, scoped to the panel's window.
  events:      number
  active_days: number
  wpbl_events: number
  mlb_events:  number
  /** Lifetime, NOT windowed: "quiet lately" and "never came back" are different answers. */
  last_seen:   string | null

  // What they have set up. Lifetime.
  favorite_team:     string | null
  notify_wpbl_all:   boolean
  notify_game_start: boolean
  notify_picks:      boolean
  push_devices:      number
  game_reminders:    number
  series_picks:      number
  feedback:          number

  roles: RoleGrant[]

  // MLB predictions. Demoted from the headline it used to be, but still the only record some
  // of these accounts have.
  predictions: number | null
  correct:     number | null
  accuracy:    number | null
}

/** Which section this account actually reads, from the windowed event split. */
export type UserLeague = 'wpbl' | 'mlb' | 'both' | 'none'

/**
 * WPBL / MLB / both / none, from the windowed split.
 *
 * The minority section has to clear a fifth of the rows to count as "both", because almost
 * every account has a handful of events on the other side: `/wpbl` is the default route, so
 * an MLB reader lands there first every single visit and an entirely one-sided account would
 * otherwise read as split.
 */
export function userLeague(u: Pick<AdminUser, 'wpbl_events' | 'mlb_events'>): UserLeague {
  const { wpbl_events: w, mlb_events: m } = u
  if (!w && !m) return 'none'
  if (!m) return 'wpbl'
  if (!w) return 'mlb'
  return Math.min(w, m) / (w + m) >= 0.2 ? 'both' : (w > m ? 'wpbl' : 'mlb')
}

/** Does this account have anything switched on that we can send to. */
export const userIsReachable = (u: AdminUser): boolean =>
  u.push_devices > 0 && (u.notify_wpbl_all || u.notify_game_start || u.notify_picks || u.game_reminders > 0)

/**
 * Everything the panel shows, newest account first.
 *
 * Degrades to an empty list and a console warning rather than throwing, the same as every
 * analytics fetch: a machine that has not run the migration renders an empty panel instead
 * of a blank route.
 */
export async function fetchAdminUsers(daysBack = 30): Promise<AdminUser[]> {
  const { data, error } = await supabase.rpc('admin_user_roster', {
    days_back: daysBack, tz: localTz(),
  })
  if (error) {
    console.warn('[admin] fetchAdminUsers error:', error.message)
    return []
  }
  return ((data ?? []) as AdminUser[]).map(u => ({
    ...u,
    roles: (u.roles ?? []).filter(r => (SITE_ROLES as readonly string[]).includes(r.role)),
  }))
}

// Soft-delete (deactivate) or restore a user. Owner-only via RLS on `usernames`
// (scripts/add_user_admin.sql), which is where the enforcement lives, not here.
export async function setUserDeleted(userId: string, deleted: boolean): Promise<boolean> {
  const { error } = await supabase.from('usernames')
    .update({ is_deleted: deleted, deleted_at: deleted ? new Date().toISOString() : null })
    .eq('user_id', userId)

  if (error) {
    console.warn('[admin] setUserDeleted error:', error.message)
    return false
  }
  return true
}

/**
 * Grant or revoke a role. Owner-only, enforced inside the RPC.
 *
 * `note` is why this person has it, and it is worth filling in: a grant is a fact about a
 * relationship, and in a year nothing else will remember which collaboration it came from.
 */
export async function setUserRole(
  userId: string, role: SiteRole, granted: boolean, note?: string,
): Promise<boolean> {
  const { error } = await supabase.rpc('admin_set_user_role', {
    target: userId, want: role, granted, why: note ?? null,
  })
  if (error) {
    console.warn('[admin] setUserRole error:', error.message)
    return false
  }
  return true
}

// ─── One person, instead of one row ───────────────────────────────────────────
//
// The roster answers "who are these 150 people" in totals, which is the right shape for a
// table and the wrong shape for the question that always follows it: what does THIS person
// actually do here. `admin_user_detail` is that, and it is a second RPC rather than more
// columns because a roster cannot carry it without becoming 150 copies of it.

export interface DetailDay    { date: string; events: number }
export interface DetailAction { event: string; n: number; last: string }
export interface DetailView   { view: string; n: number }
export interface DetailPath   { path: string; n: number }
export interface DetailPlayer { player_id: string; name: string; team_id: string | null; n: number }
export interface DetailTeam   { team_id: string; name: string; n: number }
export interface DetailMiss   { q: string; n: number }
export interface DetailNote   { created_at: string; message: string; path: string | null; handled: boolean }
export interface DetailPick   { category: string; choice: string; at: string }
export interface DetailRemind { game_id: string; game_date: string; home: string | null; away: string | null }

export interface AdminUserDetail {
  days_back: number
  /** Gap-filled, so a quiet fortnight reads as quiet rather than compressing away. */
  series: DetailDay[]
  events_window: number
  active_days:   number
  /** Browsers, never devices: session_id is a per-browser localStorage id. */
  browsers:      number
  // Lifetime. Deliberately outside the window, because "when did they arrive" is not a
  // question about the last 30 days.
  first_seen:      string | null
  last_seen:       string | null
  lifetime_events: number
  /** Cross-section: this is the list that says an account lives on /mlb. */
  actions:   DetailAction[]
  views:     DetailView[]
  paths:     DetailPath[]
  /** WPBL only. The caller draws these as this league's portraits and badges. */
  players:   DetailPlayer[]
  teams:     DetailTeam[]
  /** Only queries that matched NOTHING. analytics.ts stores the text in no other case. */
  misses:    DetailMiss[]
  feedback:  DetailNote[]
  picks:     DetailPick[]
  reminders: DetailRemind[]
}

const EMPTY_DETAIL: AdminUserDetail = {
  days_back: 30, series: [], events_window: 0, active_days: 0, browsers: 0,
  first_seen: null, last_seen: null, lifetime_events: 0,
  actions: [], views: [], paths: [], players: [], teams: [], misses: [],
  feedback: [], picks: [], reminders: [],
}

/** Everything one account has done. Degrades to an empty shape, like every fetch here. */
export async function fetchAdminUserDetail(userId: string, daysBack = 30): Promise<AdminUserDetail> {
  const { data, error } = await supabase.rpc('admin_user_detail', {
    target: userId, days_back: daysBack, tz: localTz(), lim: 12,
  })
  if (error) {
    console.warn('[admin] fetchAdminUserDetail error:', error.message)
    return EMPTY_DETAIL
  }
  return { ...EMPTY_DETAIL, ...(data as AdminUserDetail) }
}
