// The feed's spelling of a name, and the roster player it means.
//
// The league's play log and its live situation are PROSE: they carry names and no ids (see the
// resolver note in CLAUDE.md), and they do not agree with the roster on how those names are
// spelled. Seven of them differ as of Sep 10, 2026, and every one is a real player:
//
//   Val Perez → Valerie Perez · Isabella Villareal → Villarreal · Maggie Fox → Maggie Foxx
//   Emi Saki → Emi Saiki · Alexi Jorge → Alexia Jorge · Gabriella Haas → Gabrielle Haas
//   Suzu Naraski → Suzu Narasaki
//
// Left alone that is not merely a typo on screen. Everything hanging off a live name is keyed
// on it: `wpblPortraitSet` looks a headshot up BY NAME, `lineFor` finds the batting line by
// name, and the link to her page comes from the player that lookup returned. So the seven lose
// their picture, their statline and their page all at once and fall back to initials on a
// coloured circle, which reads as a player the site has never heard of rather than as a
// spelling we failed to match. Reported by a reader watching the Sep 10 postseason game, where
// the pitcher of record was "Emi Saki" on the card and Emi Saiki in the box score beneath it.
//
// WHY THIS IS NOT A TABLE OF THE SEVEN. A hardcoded map is right until the feed produces the
// eighth, and nothing here could notice: the failure is a missing picture, which is exactly
// what a player with no portrait bundled looks like. The rule below generalises instead, and
// it is not new: `computeFirsts` has carried its own copy since the Hall of Firsts shipped,
// for the same reason and against four of the same names. This is that rule, lifted out.
//
// IT REFUSES TO GUESS, which is the whole safety argument. Two players in one game can share a
// name, and a wrong match here does not mislabel a row, it puts somebody else's face and
// somebody else's season under this batter's name. So a forgiving match is accepted only when
// exactly one player on the roster fits; two candidates resolve to NOBODY and the feed's own
// spelling is printed, which is what was going to be printed anyway.

import { editDistance, normalizeName } from './playerSearch.ts'

/** Equal, a prefix either way ("Val" / "Valerie", "Fox" / "Foxx"), or one edit apart
 *  ("Saki" / "Saiki"). Applied to the given name and the surname separately, so a match has to
 *  be close on both halves rather than close on average. */
const near = (a: string, b: string): boolean =>
  a === b || a.startsWith(b) || b.startsWith(a) || editDistance(a, b, 1) <= 1

/**
 * Every roster player the feed's spelling could mean.
 *
 * Exact wins outright: when a normalised name matches, the forgiving pass never runs, so a
 * player whose real name is one edit from somebody else's is never dragged into a choice.
 * `normalizeName` is what folds the accents, and it already handles four more of these on its
 * own ("Andreanne Leblanc" for "Andréanne", "Samaria Benitez" for "Benítez").
 *
 * Returns the candidates rather than an answer, so a caller with more to go on than the name
 * can narrow further: `lineFor` knows which club is batting this half-inning, which is what
 * makes a traded player's two roster rows resolvable.
 */
export function matchFeedName<T extends { name: string }>(
  raw: string | null | undefined,
  players: Iterable<T>,
): T[] {
  const want = normalizeName(raw ?? '')
  if (!want) return []
  const all = [...players]

  const exact = all.filter(p => normalizeName(p.name) === want)
  if (exact.length) return exact

  const [wantFirst, ...rest] = want.split(' ')
  const wantLast = rest.join(' ')
  // A single token is a surname, an initial or a fragment, and any of those is one prefix rule
  // away from matching half the league. Nothing in the feed sends one; if it ever does, the
  // honest answer is no match.
  if (!wantFirst || !wantLast) return []

  return all.filter(p => {
    const [first, ...prest] = normalizeName(p.name).split(' ')
    const last = prest.join(' ')
    return !!first && !!last && near(last, wantLast) && near(first, wantFirst)
  })
}

/**
 * The roster's own spelling of a feed name, for anything that PRINTS one.
 *
 * Unchanged when the name resolves to nobody, or to more than one person. The caller therefore
 * never has to decide what to do about a miss: it prints what it gets, which is what the feed
 * sent.
 */
export function canonicalFeedName<T extends { name: string }>(
  raw: string,
  players: Iterable<T>,
): string {
  const hits = matchFeedName(raw, players)
  return hits.length === 1 ? hits[0].name : raw
}
