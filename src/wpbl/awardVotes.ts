import { supabase } from '../lib/supabase'

/**
 * Reading and writing the fan awards ballot.
 *
 * THE VOTER KEY IS THE ACCOUNT, for both surfaces that write here.
 *
 * IT WAS THE BROWSER FIRST, and the argument for that was real: a visitor should not have to
 * make an account to answer a fan poll, and an account requirement costs more true votes than
 * it saves false ones on a question with nothing at stake. What decided it the other way is
 * that the tally is PUBLISHED BACK, on both surfaces. A key held in localStorage is minted
 * again by a private window and again by a cleared cache, so the number a reader is shown is
 * only ever as honest as the least patient person looking at it. An account is not proof
 * against a determined ballot-stuffer either, but it is a different order of effort, and it
 * survives a cleared cache and follows a voter to a second device, which a browser id does
 * not. The pick'em reached this conclusion first, on Sep 8, 2026; the awards followed it on
 * Sep 10 with the same reasoning and the same two lines of code.
 *
 * THE KEY IS A REQUIRED ARGUMENT, WITH NO DEFAULT, and that is the load-bearing half. It used
 * to default to the browser id, which meant a call site that forgot it did not fail: it wrote
 * a vote under a key nobody would ever look up again, and it did so silently, on the one table
 * in this section whose whole failure mode is looking exactly like a poll nobody has answered.
 * Same reasoning as the schedule argument on the season aggregates in CLAUDE.md.
 *
 * READS GO THROUGH TWO RPCs because `wpbl_award_votes` has no select policy on purpose (see
 * the migration): raw rows would hand out every voter key, and the update policy is guarded by
 * nothing except those keys being unguessable.
 */

/** category id -> choice key -> votes. */
export type AwardResults = Record<string, Record<string, number>>

/** category id -> the choice this browser picked. */
export type AwardBallot = Record<string, string>

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
export async function fetchWpblAwardBallot(voterKey: string): Promise<AwardBallot> {
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
 * THROUGH AN RPC, AND NOT AN UPSERT, WHICH IS NOT A STYLE CHOICE. This used to call
 * `.upsert()` on the table, and it never once worked. PostgREST turns an upsert into
 * `insert ... on conflict do update`, Postgres applies the SELECT policies to the conflicting
 * row on that path, and this table has no select policy on purpose (raw rows would hand out
 * every voter_key). So the statement is refused even with nothing to conflict with, and the
 * error it gives is "new row violates row-level security policy", which points at two WITH
 * CHECK expressions that are both literally `true`. A plain insert of the same values is fine.
 * See the migration `20260907191350_add_wpbl_award_vote_writer.sql`, which reproduces both.
 *
 * Nothing caught it because the ballot shipped with no surface on it: a table at zero rows is
 * indistinguishable from a poll nobody has voted in. The first screen to write to it was the
 * bracket pick'em, and it showed a happily selected chip while the vote went nowhere.
 *
 * `wpbl_cast_award_vote` is security definer, on the same footing as the two read functions
 * beside it and for the same reason: this table cannot be reachable directly by a client and
 * still keep its keys private.
 */
export async function castWpblAwardVote(
  category: string,
  choice: string,
  voterKey: string,
): Promise<boolean> {
  if (!category || !choice || !voterKey) return false
  const { data, error } = await supabase.rpc('wpbl_cast_award_vote', {
    p_category: category, p_voter_key: voterKey, p_choice: choice,
  })
  if (error) {
    console.warn('[wpbl] castWpblAwardVote failed:', error.message)
    return false
  }
  // The function answers false rather than raising on a value the table's own constraints
  // would have rejected, so a `false` here is a refused vote and not a transport failure.
  return data === true
}

/**
 * Withdraw one answer entirely, rather than replacing it with another.
 *
 * A SEPARATE RPC BECAUSE THE TABLE HAS NO DELETE POLICY, deliberately: the ballot's own
 * migration takes the line that a cast vote is overwritten and never removed. Withdrawing is a
 * different act from changing, and the pick'em is what makes it worth having, since a reader who
 * wants out of a prediction should not have to leave a wrong one standing for want of a better
 * one. `wpbl_clear_award_vote` is gated on the same thing the update policy is, knowing the
 * voter key, so it grants nothing that was not already reachable.
 *
 * Answers true when the row was already absent, because the caller asked for it to be gone and
 * it is: reporting that as a failure would make a second tap look like an error.
 */
export async function clearWpblAwardVote(
  category: string,
  voterKey: string,
): Promise<boolean> {
  if (!category || !voterKey) return false
  const { data, error } = await supabase.rpc('wpbl_clear_award_vote', {
    p_category: category, p_voter_key: voterKey,
  })
  if (error) {
    console.warn('[wpbl] clearWpblAwardVote failed:', error.message)
    return false
  }
  return data === true
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
