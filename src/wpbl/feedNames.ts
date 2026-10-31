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
// name, and the link to the player's page comes from the player that lookup returned. So the
// seven lose their picture, their statline and their page all at once and fall back to
// initials on a colored circle, which reads as a player the site has never heard of rather
// than as a spelling we failed to match: in the Sep 10 postseason game the pitcher of record
// was "Emi Saki" on the card and Emi Saiki in the box score beneath it.
//
// WHY THIS IS NOT A TABLE OF THE SEVEN. A hardcoded map is right until the feed produces the
// eighth, and nothing here could notice: the failure is a missing picture, which is exactly
// what a player with no portrait bundled looks like. The rule below generalizes instead, and
// it is the same rule the Hall of Firsts needs, for the same reason and against four of the
// same names.
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
 * Exact wins outright: when a normalized name matches, the forgiving pass never runs, so a
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

/**
 * `canonicalFeedName` against one roster, remembered per spelling. The play log holds a few
 * hundred distinct names across thousands of rows, and each uncached call normalizes the whole
 * roster, so a season read through the uncached version paid for that thousands of times.
 */
export function rosterSpeller<T extends { name: string }>(players: Iterable<T>): (raw: string) => string {
  const roster = [...players]
  const seen = new Map<string, string>()
  return raw => {
    let out = seen.get(raw)
    if (out === undefined) seen.set(raw, out = canonicalFeedName(raw, roster))
    return out
  }
}

const NAME_RUN = /\p{Lu}[\p{L}'’.-]*(?:\s+\p{Lu}[\p{L}'’.-]*)+/gu

/**
 * Prose with every name in it in the roster's spelling. Runs of capitalized words are the
 * candidates, and each goes through `canonicalFeedName`, so a run that is not a player ("Center
 * Field" never is, the feed writes positions in lowercase) comes back exactly as it went in.
 */
export function rosterSpellingsIn<T extends { name: string }>(text: string, players: Iterable<T>): string {
  return spellRuns(text, rosterSpeller(players))
}
// A run takes the full stop that ends the sentence with it ("replaces Andreanne Leblanc."), which
// would match nobody, so it is set aside and put back.
const spellRuns = (text: string, spell: (raw: string) => string) => text.replace(NAME_RUN, run => {
  const stop = run.endsWith('.') ? '.' : ''
  return spell(stop ? run.slice(0, -1) : run) + stop
})

/** The fields of a play that hold a name: the two players in the duel and the runners, which the
 *  feed writes as names rather than flags. */
const PLAY_NAME_FIELDS = ['batter_name', 'pitcher_name', 'first_base', 'second_base', 'third_base'] as const
type PlayNames = Partial<Record<(typeof PLAY_NAME_FIELDS)[number] | 'narrative', string | null>>

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Plays with every name in the roster's spelling, which is how the play log leaves the api.
 *
 * WHY HERE AND NOT ON SCREEN. Until Oct 21, 2026 each surface that printed a play corrected the
 * names itself, and five forgot (two sweeps in one day found them): the recap's Biggest Plays,
 * Batter vs Pitcher, Game Center's First hit and Run value's worked play each said "Isabella
 * Villareal" one line from Isabella Villarreal. Corrected once at the read, a new surface cannot
 * forget, and `rosterSpelling.test.ts` fails a surface that goes around the read.
 *
 * THE FIELDS AND THE PROSE MUST AGREE, because code matches one against the other: the
 * play-by-play finds `batter_name` inside `narrative` to split the sentence, the pitching-change
 * detector compares `pitcher_name` across rows, and `runnerIds` looks a base runner's name up
 * among the batters. So each field's own feed spelling is replaced in the prose by exactly what
 * the field became, before the general pass over capitalized runs, which alone would miss a name
 * the feed opens with a capitalized word ("Pinch-hitter Maggie Fox").
 *
 * A row nothing changes is returned as it came, so a log with nothing to fix is the same array.
 */
export function inRosterSpelling<R extends PlayNames, T extends { name: string }>(
  rows: R[],
  players: Iterable<T>,
): R[] {
  const spell = rosterSpeller(players)
  let changed = false
  const out = rows.map(row => {
    const fixed: [string, string][] = []
    const next: PlayNames = {}
    for (const f of PLAY_NAME_FIELDS) {
      const raw = row[f]
      if (!raw) continue
      const name = spell(raw.trim())
      if (name !== raw.trim()) { next[f] = name; fixed.push([raw.trim(), name]) }
    }
    let narrative = row.narrative
    if (narrative) {
      if (fixed.length) {
        const map = new Map(fixed)
        // Longest first, and never inside a longer word, so "Maggie Fox" does not match the
        // front of a "Maggie Foxx" already in the sentence.
        const re = new RegExp(`(?:${[...map.keys()].sort((a, b) => b.length - a.length).map(escapeRe).join('|')})(?![\\p{L}])`, 'gu')
        narrative = narrative.replace(re, m => map.get(m) ?? m)
      }
      narrative = spellRuns(narrative, spell)
      if (narrative !== row.narrative) next.narrative = narrative
    }
    if (Object.keys(next).length === 0) return row
    changed = true
    return { ...row, ...next } as R
  })
  return changed ? out : rows
}
