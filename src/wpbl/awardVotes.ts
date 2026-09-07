import { supabase } from '../lib/supabase'
import { sessionId } from '../lib/analytics'

/**
 * Reading and writing the fan awards ballot.
 *
 * THE VOTER KEY IS THE BROWSER, not the account. A visitor should not have to make an account
 * to vote in a fan poll, and the anon key ships in the client bundle, so nothing the browser
 * says about who it is could be trusted anyway. Keying on the analytics id (localStorage)
 * means one browser is one ballot whether the voter signs in halfway through or never, and
 * signing in cannot double anybody's vote.
 *
 * WHAT THAT DOES AND DOES NOT PREVENT. Clearing site data buys another ballot, so this is
 * proof against a casual second vote and not against somebody determined to stuff it. That is
 * the right trade for an award with no prize attached: the alternative is a sign-in wall,
 * which would cost more real votes than it saved fake ones.
 *
 * READS GO THROUGH TWO RPCs because `wpbl_award_votes` has no select policy on purpose (see
 * the migration): raw rows would hand out every voter key, and the update policy is guarded by
 * nothing except those keys being unguessable.
 */

/** category id -> choice key -> votes. */
export type AwardResults = Record<string, Record<string, number>>

/** category id -> the choice this browser picked. */
export type AwardBallot = Record<string, string>

/**
 * This browser's ballot id.
 *
 * Returns the analytics id, including its 'no-storage' fallback: a browser with storage
 * switched off votes under a key it shares with every other such browser, so those ballots
 * overwrite one another rather than accumulating. That is a worse experience for a handful of
 * private-window visitors and the honest count for everyone else, which is the right way
 * round. It is also why nothing here treats a vote as having failed when it comes back
 * unchanged.
 */
export const awardVoterKey = (): string => sessionId()

/** The running tally, for everyone. Empty on any failure, which renders as "no votes yet"
 *  rather than as an error: a tally is not worth a broken page. */
export async function fetchWpblAwardResults(): Promise<AwardResults> {
  const { data, error } = await supabase.rpc('wpbl_award_results')
  if (error) {
    console.warn('[wpbl] fetchWpblAwardResults failed:', error.message)
    return {}
  }
  const out: AwardResults = {}
  for (const row of (data ?? []) as { category: string; choice: string; votes: number }[]) {
    const bucket = out[row.category] ?? (out[row.category] = {})
    bucket[row.choice] = Number(row.votes) || 0
  }
  return out
}

/** What this browser has already picked, so a returning voter sees their ballot filled in. */
export async function fetchWpblAwardBallot(voterKey = awardVoterKey()): Promise<AwardBallot> {
  const { data, error } = await supabase.rpc('wpbl_award_ballot', { p_voter_key: voterKey })
  if (error) {
    console.warn('[wpbl] fetchWpblAwardBallot failed:', error.message)
    return {}
  }
  const out: AwardBallot = {}
  for (const row of (data ?? []) as { category: string; choice: string }[]) out[row.category] = row.choice
  return out
}

/**
 * Cast or change one vote. Returns false on failure so the caller can leave the previous
 * selection showing instead of claiming a vote it did not record.
 *
 * An upsert rather than an insert: changing your mind rewrites the same row, which is what
 * makes the primary key `(category, voter_key)` a one-vote rule rather than a rejection. No
 * `.select()` is chained, because there is no select policy and asking for the row back would
 * turn a successful write into an error.
 */
export async function castWpblAwardVote(
  category: string,
  choice: string,
  voterKey = awardVoterKey(),
): Promise<boolean> {
  if (!category || !choice || !voterKey) return false
  const { error } = await supabase
    .from('wpbl_award_votes')
    .upsert(
      { category, choice, voter_key: voterKey, updated_at: new Date().toISOString() },
      { onConflict: 'category,voter_key' },
    )
  if (error) {
    console.warn('[wpbl] castWpblAwardVote failed:', error.message)
    return false
  }
  return true
}

/** Total ballots cast in one category, for the "1,204 fans have voted" line. */
export function awardVoteCount(results: AwardResults, category: string): number {
  const bucket = results[category]
  if (!bucket) return 0
  let n = 0
  for (const v of Object.values(bucket)) n += v
  return n
}

/** The tally for one category, best first, as [choice, votes] pairs. Ties keep a stable order
 *  by choice key so the list does not reshuffle itself between renders. */
export function awardStandings(results: AwardResults, category: string): [string, number][] {
  const bucket = results[category]
  if (!bucket) return []
  return Object.entries(bucket).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}
