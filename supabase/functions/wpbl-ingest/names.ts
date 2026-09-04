// Name matching for player reconciliation. Its own module so it can be unit-tested from
// the app's test runner (see src/wpbl/__tests__/ingestNames.test.ts) — index.ts imports
// the Supabase client over HTTPS and only Deno can load it, but nothing here has any
// dependencies at all. Getting these rules wrong forks a second roster row for a player
// who already exists, which is a permanent, visible data error, so they are worth pinning
// down in tests.

// Strip accents + case/space for name matching ("Maïka Dumais" ↔ "maika dumais").
//
// A run of U+FFFD collapses to one. That character is what a UTF-8 decoder emits for
// bytes it can't read, so it stands for one letter the feed lost in transit — but a
// single lost letter usually produces two of them (a two-byte sequence like the 0xC3 0xAF
// of "ï" fails twice), and how many appear says nothing about how many letters went
// missing. Collapsing makes "one damaged letter" a single wildcard, which is what
// replacementMatch below compares against.
export const REPLACEMENT = '�'

export const normName = (name: string): string =>
  name.normalize('NFD')
    .replace(/[̀-ͯ]/g, '')  // combining diacritical marks
    .toLowerCase()
    .replace(/�+/g, REPLACEMENT)
    .replace(/\s+/g, ' ')
    .trim()

/** Does this normalized name carry damage from a bad decode? */
export const isDamaged = (norm: string): boolean => norm.includes(REPLACEMENT)

// Two normalized names that agree everywhere except where one of them is damaged —
// "ma<?>ka dumais" against "maika dumais". Deliberately stricter than the fuzzy pass:
// lengths must match exactly and every surviving character must be identical, so this
// recovers a mangled name without ever bringing two genuinely different players together.
// Returns false when neither side is damaged; plain equality is the caller's fast path.
export function replacementMatch(a: string, b: string): boolean {
  if (!isDamaged(a) && !isDamaged(b)) return false
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i] || a[i] === REPLACEMENT || b[i] === REPLACEMENT) continue
    return false
  }
  return true
}

// Levenshtein edit distance, capped at `max` (returns max+1 once exceeded) — used for a
// last-ditch fuzzy roster match so feed spelling variants (Villareal↔Villarreal,
// Foxx↔Fox, Gabriella↔Gabrielle) resolve to the seeded player instead of a duplicate.
// Nickname SHORTENINGS (Val↔Valerie, Alex↔Alexandra) are too far for this, but the
// prefix matcher in PlayerResolver.nickname handles the common prefix pattern; only true
// non-prefix nicknames (Gabby↔Gabriella, Kate↔Katherine) still need a manual merge.
export function editDistance(a: string, b: string, max = 1): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
      cur.push(v); if (v < rowMin) rowMin = v
    }
    if (rowMin > max) return max + 1
    prev = cur
  }
  return prev[b.length]
}

// ─── trades ───────────────────────────────────────────────────────────────────
// The feed mints a NEW player_id when a player changes club. Diana Ibarra is
// moizfkn9dtrm4vno on New York and 27svefz41ds4k58k on Los Angeles, both flagged ACTIVE,
// career_id empty on both: nothing in the payload says they are one person. Every other
// matcher in this file is scoped to a single team, which is right for spelling variants and
// fatal here, so the two rules a trade needs live below — pure, and therefore testable from
// the app's runner, which is the whole reason this module exists.

export interface RosterEntry { id: string; norm: string; teamId: string }

/**
 * The player a feed entry names, when they are already on the roster under a DIFFERENT club.
 * Null when nobody matches, when more than one does, or when they are already on this club
 * (which the same-team matchers handle and this must not second-guess).
 *
 * This is the only rule that reaches across teams, so it is the only one that could merge two
 * genuinely different people, and it asks for more than the others: the full name, at least
 * two parts, spelled exactly after accent folding, and unique league-wide. Two players who
 * really do share a name fail the uniqueness test and neither is touched — the same "don't
 * guess" rule the same-team matchers use. A wrong merge is silent and permanent; a missed one
 * shows up as a duplicate in the next roster listing.
 */
export function tradeMatch(nm: string, teamSlug: string, roster: readonly RosterEntry[]): string | null {
  if (!teamSlug || !nm) return null
  if (nm.split(' ').length < 2) return null   // a lone surname is not evidence of anything
  let hit: RosterEntry | null = null
  for (const cand of roster) {
    if (cand.norm !== nm) continue
    if (hit) return null                      // shared name — ambiguous, leave it alone
    hit = cand
  }
  if (!hit || hit.teamId === teamSlug) return null
  return hit.id
}

/**
 * A box score, as evidence about a player: the day it was played on, and whether it has
 * actually been PLAYED. Both halves are needed and neither implies the other, which is the
 * whole point of carrying them together. See `usableEvidence`.
 */
export interface GameEvidence { date: string | null; played: boolean }

/**
 * Should a box score move this player onto `teamSlug`?
 *
 * `teamAsOf` is the date of the newest game we have already believed. The ingest re-reads old
 * box scores constantly (corrections via `force`, the late-TrackMan backfill, mode 'all'), and
 * every one of them is honest evidence of where the player was THEN. Without this guard a July
 * re-read would send a traded player back to her old club and the next pass would send her
 * forward again, so her club would depend on whichever game the loop happened to touch last.
 * With it, evidence only moves forward and re-ingesting the whole season changes nothing.
 */
export function teamMoveWins(
  player: { teamId: string; teamAsOf: string | null },
  teamSlug: string,
  game: GameEvidence,
  today: string,
): boolean {
  if (!teamSlug) return false
  if (!usableEvidence(game, today)) return false
  if (player.teamId === teamSlug) return false
  return !player.teamAsOf || game.date! >= player.teamAsOf
}

/**
 * Is a box score usable as evidence of where someone plays?
 *
 * ONLY IF THE GAME HAS BEEN PLAYED, and the date alone cannot tell you that. This used to ask
 * "is the game in the past", which is the same question for a game three weeks out and a
 * completely different one for a game tonight: the feed publishes a lineup for a game it has
 * not started, and it publishes it on the day. On Sep 3, 2026 a staged, never-played copy of
 * that night's Los Angeles game listed seventeen BOSTON players, and this function said yes,
 * because the date was today's. `tradeMatch` then read seventeen simultaneous trades off it and
 * the Hunters' roster page went down to one name while the Queens' grew to 47.
 *
 * A game nobody has played is a plan whoever typed it can still change. `played` comes from the
 * box score's own derived status, which is the only thing here that knows the difference.
 */
export function usableEvidence(game: GameEvidence, today: string): boolean {
  if (!game.date || !game.played) return false
  return game.date <= today
}

// ─── one game, two clubs ──────────────────────────────────────────────────────

/**
 * The players a single box score lists under more than one club.
 *
 * The feed mints a new id per club, so a player who has changed clubs can appear on BOTH
 * sides of the same game: Emi Saiki, Diana Ibarra and Suzu Narasaki were all on both rosters
 * of Sep 3, 2026's Los Angeles game. Both entries resolve to the same person, so the club
 * update ran twice with two different answers and whichever the loop read LAST won. Saiki
 * flipped to New York and back inside two minutes and settled on Los Angeles, while every
 * box-score line she owns says New York.
 *
 * One game saying two things is not evidence of either, so a name in this set moves nobody.
 * Identity still resolves normally, which is what stops a second Saiki being inserted; it is
 * only her club and her uniform number that this game is not allowed an opinion about. A real
 * trade is still seen off the next box score that lists her once, which is every ordinary one.
 *
 * Keyed on the NAME because that is the level the duplicate exists at: the two entries carry
 * different feed ids by construction, so nothing else pairs them up.
 */
export function contestedNames(entries: readonly { club: string; name: string }[]): Set<string> {
  const clubs = new Map<string, Set<string>>()
  for (const e of entries) {
    const nm = normName(e.name)
    if (!nm || !e.club) continue
    const seen = clubs.get(nm) ?? new Set<string>()
    seen.add(e.club)
    clubs.set(nm, seen)
  }
  const out = new Set<string>()
  for (const [nm, seen] of clubs) if (seen.size > 1) out.add(nm)
  return out
}
