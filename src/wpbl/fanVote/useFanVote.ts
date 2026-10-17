import { useEffect, useState } from 'react'
import { fetchWpblAwardBallot, fetchWpblAwardResults, castWpblAwardVote, clearWpblAwardVote } from '../awardVotes'
import type { AwardBallot, AwardResults } from '../awardVotes'
import { track, EVENTS } from '../../lib/analytics'
import { useAuth } from '../../AuthContext'
import { markFanAwardsEngaged } from './engaged'

// One empty tally for every category nobody has voted in, so a memo keyed on it holds: a fresh
// `{}` per render recomputed both lists on every render.
export const NO_VOTES: Record<string, number> = {}

// ─── the ballot, and the vote ────────────────────────────────────────────────────

export interface FanVoteState {
  ballot: AwardBallot
  results: AwardResults
  loaded: boolean
  /** Whether this reader can answer at all. A signed-out reader reads the whole ballot and
   *  votes on none of it: every tile turns into the ask instead. */
  canPick: boolean
  /** Open the sign-in dialog, which is what a tile does for a reader who cannot vote yet. */
  signIn: () => void
  cast: (category: string, choice: string) => void
  clear: (category: string) => void
}

/**
 * This browser's answers and the running tally, held once for all five categories.
 *
 * ONE PIECE OF STATE HOLDING BOTH HALVES, for the reason the pick'em's copy of this spells out:
 * a vote moves the ballot and the tally together, and doing the second inside the first's updater
 * is a side effect in a function React may call twice, which under StrictMode counts your own
 * vote twice on your own screen and nowhere else.
 */
export function useFanVote(enabled: boolean): FanVoteState {
  // THE ACCOUNT IS THE BALLOT ID, the same key the pick'em writes under and for the reasons in
  // awardVotes.ts: the tally is published back to the reader, so it has to cost more than a
  // private window to move, and it has to survive a cleared cache and follow them to a phone.
  const { user, openAuthDialog } = useAuth()
  const voterKey = user?.id ?? null
  const [state, setState] = useState<{ ballot: AwardBallot; results: AwardResults; loaded: boolean }>(
    { ballot: {}, results: {}, loaded: false })

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    // The tally is public and is read either way: a reader who cannot vote yet still sees what
    // everyone else thinks once they have answered nothing, which is the same rule as before.
    // Only the BALLOT needs a key, and a signed-out reader has no ballot rather than an empty one.
    Promise.all([
      voterKey ? fetchWpblAwardBallot(voterKey) : Promise.resolve({} as AwardBallot),
      fetchWpblAwardResults(),
    ]).then(([ballot, results]) => {
      if (!cancelled) setState({ ballot, results, loaded: true })
    })
    return () => { cancelled = true }
  }, [enabled, voterKey])

  const cast = (category: string, choice: string) => {
    // Refused here as well as in the UI. The controls send a signed-out reader to the dialog
    // instead of calling this, and this is what makes that a rule rather than a habit: without
    // it, one call site that forgets is a vote written under nobody, which is exactly how a
    // table at zero rows comes to look like a poll nobody answered.
    if (!voterKey) { openAuthDialog('signin'); return }
    setState(prev => {
      const was = prev.ballot[category]
      if (was === choice) return prev
      const bucket = { ...(prev.results[category] ?? {}) }
      if (was) bucket[was] = Math.max(0, (bucket[was] ?? 1) - 1)
      bucket[choice] = (bucket[choice] ?? 0) + 1
      return { ...prev, ballot: { ...prev.ballot, [category]: choice }, results: { ...prev.results, [category]: bucket } }
    })
    track(EVENTS.WPBL_AWARD_VOTE, { category, choice })
    // Answering is the strongest form of having dealt with the invitation, and it is caught
    // here rather than at the tiles so no control can vote without also taking the strip down.
    markFanAwardsEngaged()
    // Not rolled back on failure, same reasoning as the pick'em: the write is a definer function,
    // so a failure is a lost vote rather than a wrong one, and pulling a selection back out from
    // under somebody is a worse answer to a flaky network than letting them tap again.
    void castWpblAwardVote(category, choice, voterKey)
  }

  const clear = (category: string) => {
    if (!voterKey) return
    setState(prev => {
      const was = prev.ballot[category]
      if (!was) return prev
      const ballot = { ...prev.ballot }; delete ballot[category]
      const bucket = { ...(prev.results[category] ?? {}) }
      bucket[was] = Math.max(0, (bucket[was] ?? 1) - 1)
      return { ...prev, ballot, results: { ...prev.results, [category]: bucket } }
    })
    void clearWpblAwardVote(category, voterKey)
  }

  return { ...state, cast, clear, canPick: !!voterKey, signIn: () => openAuthDialog('signin') }
}
