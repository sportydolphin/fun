// The crosswalk: which WBSC tournament player is which WPBL player. See docs/WBSC_INGEST.md.
//
// A PERSON DECIDES EVERY LINK; THIS ONLY PROPOSES. A wrong link puts someone else's World Cup on a
// player's page, and nothing downstream could tell. So names are matched here, once, to build a
// review list, and never at read time: what the site will read is the confirmed list alone, and a
// candidate becomes a link only when someone has looked at it and said yes. A "no" is kept too, so
// the same pair is never proposed again.
//
// WHY NAMES AT ALL. WBSC numbers a player afresh every tournament (Kelsie Whitmore is three ids
// across 2018, 2023 and 2026) and the WPBL feed knows nothing of either, so a name is the only
// thing the two sides share. The matcher allows for the way WBSC writes them: every given name
// ("Kelsie Ann-Gamboa"), both surnames ("Del Castillo Alarcon"), in capitals.

import { APOSTROPHE } from './game'

export interface CrosswalkWbscPlayer {
  /** The namespaced tournament id, `wbsc:p:<tournament>:<player>`. */
  id: string
  event_key: string
  name: string
  first_name: string
  last_name: string
  /** The national team, as its IOC code. */
  team_id: string | null
}

export interface CrosswalkWpblPlayer {
  id: string
  name: string
  hometown?: string | null
}

/**
 * How strong a proposal is. `name`: every WPBL name appears in WBSC's, given name first. `initial`:
 * the surname matches and the given names share only a first letter ("Rosi" for "Rosa Maria"),
 * which is a nickname as often as it is someone else, so it is listed for a person to judge.
 */
export type MatchKind = 'name' | 'initial'

export interface Candidate {
  wbsc_id: string
  event_key: string
  wbsc_name: string
  wbsc_team: string | null
  wpbl_id: string
  wpbl_name: string
  /** What the WPBL roster says about where the player is from, beside the national team, so the
   *  reviewer has a second fact to check against. */
  wpbl_hometown: string | null
  match: MatchKind
  /** Set when the same player on either side has another candidate in the same event. Two of
   *  these can never both be right. */
  ambiguous: boolean
  /** The reviewer's answer: 'yes', 'no', or '' while undecided. */
  decision: '' | 'yes' | 'no'
}

/** A confirmed link. One per WBSC tournament player, so a player in three events is three. */
export interface Link {
  wbsc_id: string
  event_key: string
  wbsc_name: string
  wpbl_id: string
  wpbl_name: string
  checked_by: string
  /** 'YYYY-MM-DD'. */
  checked_at: string
}

/** A pair a person has ruled out. Kept so it is never proposed again. */
export interface Rejection {
  wbsc_id: string
  wpbl_id: string
  checked_by: string
  checked_at: string
}

export interface Crosswalk {
  links: Link[]
  rejected: Rejection[]
}

export interface Review {
  /** Who is deciding. Required before `--confirm` will move anything. */
  checked_by: string
  candidates: Candidate[]
}

export const EMPTY_CROSSWALK: Crosswalk = { links: [], rejected: [] }

// ── Names ───────────────────────────────────────────────────────────────────────

/**
 * A name as comparable words: accents and case folded, an apostrophe dropped and a hyphen made a
 * space, so "O'SULLIVAN" meets "O'Sullivan" and "DAY-BÉDARD" meets "Day-Bédard".
 */
export function nameWords(name: string): string[] {
  return name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(APOSTROPHE, '').replace(/[^a-z]+/g, ' ').trim().split(' ').filter(Boolean)
}

/** Code-point order, so the files sort the same on every machine whatever its locale. */
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** Whether `needle` appears in `hay` as a run of consecutive words. */
const containsRun = (hay: string[], needle: string[]): boolean =>
  needle.length > 0 && hay.some((_, i) => needle.every((w, j) => hay[i + j] === w))

/**
 * Whether a WBSC player could be a WPBL player, and how strongly.
 *
 * The WPBL roster does not mark where a given name ends and a surname begins, so a WPBL name fits
 * when its first word is WBSC's first given name and either the rest is a run inside WBSC's
 * surname ("Kelsie | Whitmore", "Rosi | del Castillo"), or the whole name is a run inside WBSC's
 * given names and surname together and ends on a surname word ("Flor Elena Valerio Montoya",
 * whose second given name the roster writes too).
 */
export function matchKind(wbsc: Pick<CrosswalkWbscPlayer, 'first_name' | 'last_name'>, wpblName: string): MatchKind | null {
  const given = nameWords(wbsc.first_name)
  const surname = nameWords(wbsc.last_name)
  const wpbl = nameWords(wpblName)
  if (!given.length || !surname.length || wpbl.length < 2) return null

  const wpblSurname = wpbl.slice(1)
  // The WPBL surname has to be WBSC's surname or a run inside it: "del castillo" in "del castillo
  // alarcon", "whitmore" in "whitmore". A WPBL "surname" that is WBSC's middle name plus surname
  // ("elena valerio montoya") is the whole-name case below.
  const surnameFits = containsRun(surname, wpblSurname)
  const lastFits = surname.includes(wpbl[wpbl.length - 1])

  if (wpbl[0] === given[0] && (surnameFits || (lastFits && containsRun([...given, ...surname], wpbl)))) return 'name'
  if (surnameFits && wpbl[0][0] === given[0][0]) return 'initial'
  return null
}

// ── Proposing ───────────────────────────────────────────────────────────────────

/**
 * Every candidate pair not already linked or ruled out, in a stable order (event, then WBSC
 * name), with each pair that conflicts with another in the same event flagged.
 */
export function propose(wbsc: CrosswalkWbscPlayer[], wpbl: CrosswalkWpblPlayer[], crosswalk: Crosswalk): Candidate[] {
  const linked = new Set(crosswalk.links.map(l => l.wbsc_id))
  const ruledOut = new Set(crosswalk.rejected.map(r => `${r.wbsc_id}|${r.wpbl_id}`))
  const out: Candidate[] = []
  for (const w of wbsc) {
    if (linked.has(w.id)) continue
    for (const p of wpbl) {
      if (ruledOut.has(`${w.id}|${p.id}`)) continue
      const match = matchKind(w, p.name)
      if (!match) continue
      out.push({
        wbsc_id: w.id, event_key: w.event_key, wbsc_name: w.name, wbsc_team: w.team_id,
        wpbl_id: p.id, wpbl_name: p.name, wpbl_hometown: p.hometown ?? null,
        match, ambiguous: false, decision: '',
      })
    }
  }
  // Two candidates for one WBSC player, or one WPBL player proposed twice in an event, or a WPBL
  // player already linked in this event: at most one of them is right.
  const count = new Map<string, number>()
  const bump = (k: string) => count.set(k, (count.get(k) ?? 0) + 1)
  for (const c of out) { bump(`w|${c.wbsc_id}`); bump(`p|${c.event_key}|${c.wpbl_id}`) }
  for (const l of crosswalk.links) bump(`p|${l.event_key}|${l.wpbl_id}`)
  for (const c of out) c.ambiguous = (count.get(`w|${c.wbsc_id}`) ?? 0) > 1 || (count.get(`p|${c.event_key}|${c.wpbl_id}`) ?? 0) > 1
  return out.sort((a, b) => cmp(a.event_key, b.event_key) || cmp(a.wbsc_name, b.wbsc_name) || cmp(a.wbsc_id, b.wbsc_id) || cmp(a.wpbl_name, b.wpbl_name))
}

// ── Confirming ──────────────────────────────────────────────────────────────────

export interface Applied {
  crosswalk: Crosswalk
  /** The candidates still undecided, for the next review file. */
  remaining: Candidate[]
  /** Why nothing was applied, when that is the answer. Empty on success. */
  errors: string[]
}

/**
 * Move every decided candidate into the crosswalk: a yes becomes a link, a no a rejection.
 *
 * ALL OR NOTHING. Any problem (no reviewer named, a decision that is not yes or no, a link to a
 * player who is not on the roster, two links for one WBSC player, one WPBL player linked twice in
 * an event) leaves the crosswalk exactly as it was and says why. Half a review applied is a
 * crosswalk nobody can vouch for.
 */
export function applyDecisions(
  crosswalk: Crosswalk,
  review: Review,
  known: { wbsc: Set<string>; wpbl: Set<string> },
  today: string,
): Applied {
  const errors: string[] = []
  const who = review.checked_by?.trim() ?? ''
  const decided = review.candidates.filter(c => c.decision !== '')
  if (decided.length && !who) errors.push('checked_by is empty: say who reviewed these before confirming them')

  const links = [...crosswalk.links]
  const rejected = [...crosswalk.rejected]
  for (const c of decided) {
    const label = `${c.wbsc_name} → ${c.wpbl_name}`
    if (c.decision !== 'yes' && c.decision !== 'no') { errors.push(`${label}: decision "${c.decision}" is not yes, no or empty`); continue }
    if (!known.wbsc.has(c.wbsc_id)) errors.push(`${label}: ${c.wbsc_id} is in no imported event`)
    if (!known.wpbl.has(c.wpbl_id)) errors.push(`${label}: ${c.wpbl_id} is not on the WPBL roster`)
    if (c.decision === 'no') {
      rejected.push({ wbsc_id: c.wbsc_id, wpbl_id: c.wpbl_id, checked_by: who, checked_at: today })
      continue
    }
    const sameWbsc = links.find(l => l.wbsc_id === c.wbsc_id)
    if (sameWbsc) errors.push(`${label}: ${c.wbsc_name} is already linked to ${sameWbsc.wpbl_name}`)
    const sameWpbl = links.find(l => l.wpbl_id === c.wpbl_id && l.event_key === c.event_key)
    if (sameWpbl) errors.push(`${label}: ${c.wpbl_name} is already linked to ${sameWpbl.wbsc_name} in ${c.event_key}`)
    links.push({
      wbsc_id: c.wbsc_id, event_key: c.event_key, wbsc_name: c.wbsc_name,
      wpbl_id: c.wpbl_id, wpbl_name: c.wpbl_name, checked_by: who, checked_at: today,
    })
  }

  if (errors.length) return { crosswalk, remaining: review.candidates, errors }
  const byKey = <T extends { wbsc_id: string; wpbl_id: string }>(a: T, b: T) => cmp(a.wbsc_id, b.wbsc_id) || cmp(a.wpbl_id, b.wpbl_id)
  return {
    crosswalk: { links: links.sort(byKey), rejected: rejected.sort(byKey) },
    remaining: review.candidates.filter(c => c.decision === ''),
    errors: [],
  }
}
