import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { supabase } from '../lib/supabase'
import { ensureActiveUser } from '../lib/userActive'
import { useAuth } from '../AuthContext'

// The reader's WPBL team. Opt-in, and opting out is a first-class answer: with no favourite
// every view renders exactly as it does today.
//
// localStorage-first, synced to the account when there is one — the same shape as MLB's
// followed team (src/mlb/storage/prefs.ts). Local-first is the important half here: most of
// the site's traffic is signed out (roughly 1,400 browsers a month against 56 accounts), so
// an account-only preference would reach almost nobody. Signing in later carries the local
// pick up to the account rather than discarding it.
//
// Three distinct states, and the third is why `answered` exists separately from the id:
//
//   • not answered   — we have never asked, or the reader ignored the prompt. Prompt shows.
//   • answered, id   — they picked a team.
//   • answered, null — they explicitly chose no favourite. Prompt must never return.
//
// Collapsing the last two into "id is null" would re-ask on every visit, which is exactly
// the nagging this feature is supposed to avoid.
//
// The pick lives in ONE module-level store that every hook instance subscribes to, rather
// than a useState per call site. Several places read it at once — the Home prompt, the team
// page toggle, the standings marker, and the accent provider that colours the whole section
// — and with independent state, picking a team in the prompt updated only the prompt's own
// copy. The section kept its old colour until something happened to remount the provider,
// which read as "the click didn't take". One store means one notification and every reader
// re-renders in the same tick.

const TEAM_KEY     = 'wpbl_fav_team_id'
const ANSWERED_KEY = 'wpbl_fav_team_answered'

export interface FavoriteTeamState {
  teamId: string | null
  /** Whether the reader has given an answer — including "no favourite". */
  answered: boolean
}

// ─── local ────────────────────────────────────────────────────────────────────

export function getLocalFavoriteTeam(): FavoriteTeamState {
  try {
    return {
      teamId: localStorage.getItem(TEAM_KEY) || null,
      answered: localStorage.getItem(ANSWERED_KEY) === '1',
    }
  } catch {
    // Private mode / storage disabled. Unanswered with no team means the prompt shows and
    // simply won't stick — better than throwing on a read.
    return { teamId: null, answered: false }
  }
}

export function setLocalFavoriteTeam(teamId: string | null): void {
  try {
    if (teamId) localStorage.setItem(TEAM_KEY, teamId)
    else localStorage.removeItem(TEAM_KEY)
    // Any deliberate set — including clearing — counts as answering.
    localStorage.setItem(ANSWERED_KEY, '1')
  } catch { /* non-fatal; the pick just won't survive a reload */ }
  // Notify in-memory readers even if the write above failed, so the UI still responds in
  // private mode; it just won't persist.
  publish({ teamId, answered: true })
}

// ─── the shared store ─────────────────────────────────────────────────────────

// Seeded once from localStorage. `snapshot` must keep a stable identity while unchanged —
// useSyncExternalStore re-renders forever if getSnapshot returns a fresh object each call.
let snapshot: FavoriteTeamState = getLocalFavoriteTeam()
const listeners = new Set<() => void>()

function publish(next: FavoriteTeamState): void {
  if (next.teamId === snapshot.teamId && next.answered === snapshot.answered) return
  snapshot = next
  for (const l of listeners) l()
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => { listeners.delete(onChange) }
}

const getSnapshot = (): FavoriteTeamState => snapshot

// Two tabs open, a pick made in one: keep the other honest rather than letting them
// disagree until a reload. `storage` only fires in the OTHER tab, so this can't loop.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', e => {
    if (e.key === TEAM_KEY || e.key === ANSWERED_KEY) publish(getLocalFavoriteTeam())
  })
}

// ─── account sync ─────────────────────────────────────────────────────────────

/** null when the column isn't migrated yet — the caller keeps whatever localStorage said. */
export async function loadFavoriteTeamFromSupabase(userId: string): Promise<string | null | undefined> {
  const { data, error } = await supabase
    .from('user_preferences')
    .select('wpbl_favorite_team_id')
    .eq('user_id', userId)
    .maybeSingle()
  if (error || !data) return undefined
  return (data as { wpbl_favorite_team_id: string | null }).wpbl_favorite_team_id ?? null
}

export async function saveFavoriteTeamToSupabase(userId: string, teamId: string | null): Promise<void> {
  if (!(await ensureActiveUser(userId))) return
  // Upserts only this column; the other preference columns on the row are left alone.
  const { error } = await supabase
    .from('user_preferences')
    .upsert(
      { user_id: userId, wpbl_favorite_team_id: teamId, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    )
  if (error) { /* column may not exist yet — localStorage still holds the pick */ }
}

// ─── hook ─────────────────────────────────────────────────────────────────────

/**
 * The current favourite plus a setter, kept in step with the signed-in account.
 *
 * `validIds`, when given, is the set of team ids that currently exist. A favourite that
 * no longer resolves (the feed dropped or renamed a team) reads as no favourite rather
 * than as a phantom id that quietly matches nothing — but it is NOT erased from storage,
 * so a transient empty teams list during load can't silently wipe a real pick.
 */
export function useWpblFavoriteTeam(validIds?: ReadonlySet<string>) {
  const { user } = useAuth()
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  useEffect(() => {
    if (!user?.id) return
    let cancelled = false
    const local = getSnapshot()
    loadFavoriteTeamFromSupabase(user.id).then(remote => {
      if (cancelled || remote === undefined) return
      if (remote) {
        // The account wins on a fresh device — that is the point of syncing it.
        setLocalFavoriteTeam(remote)
      } else if (local.teamId) {
        // Picked while signed out, then signed in: carry it up rather than lose it.
        saveFavoriteTeamToSupabase(user.id, local.teamId)
      }
    })
    return () => { cancelled = true }
  }, [user?.id])

  const setFavorite = useCallback((teamId: string | null) => {
    // Writes storage and notifies every reader — the accent provider included — in one go.
    setLocalFavoriteTeam(teamId)
    if (user?.id) saveFavoriteTeamToSupabase(user.id, teamId)
  }, [user?.id])

  // An EMPTY set means "the roster hasn't loaded yet", not "no team is valid". Treating it
  // as the latter blanked the favourite on every cold load, so the section painted league
  // blue for a beat before snapping to the team's colour.
  const known = validIds && validIds.size > 0 ? validIds : null
  const resolved = state.teamId && (!known || known.has(state.teamId)) ? state.teamId : null

  return {
    /** The favourite team id, or null for no favourite (or one that no longer exists). */
    favoriteTeamId: resolved,
    /** True once the reader has answered either way — the prompt keys off this. */
    answered: state.answered,
    setFavorite,
  }
}
