// The same player across World Cups: which WBSC tournament players are one person. See
// docs/WBSC_INGEST.md and ROADMAP-WOMENS-BASEBALL.md, stage 2.
//
// WHY THIS EXISTS. WBSC numbers every player afresh each tournament, and people.json joins nothing
// by name, so a player with three World Cups and no WPBL row is three people until something says
// otherwise. The crosswalk (crosswalk.ts) joins the ones the WPBL knows; this joins the rest.
//
// DECIDED BY RULE WHERE THE CROSSWALK REVIEW ALREADY ANSWERED THE QUESTION, by a person otherwise.
// The owner reviewed 134 WBSC-to-WPBL pairs on Nov 2, 2026 and asked that this review ask only what
// those answers do not settle. Both sides here are WBSC's own official names, which is what makes a
// rule safe where the crosswalk needed a person (a roster nickname against an official name):
//
// - `same-name-same-team`, yes. The full name, or one written with and without a middle name
//   ("Kelsie Whitmore", "Kelsie Ann-Gamboa Whitmore") or with a space for a hyphen ("Bit na",
//   "Bitna"), for the same country, with no rival in either event. Every such pair in the
//   crosswalk review was a yes.
// - `nickname-same-team`, yes. A common short form ("Kate", "Katherine"), on the same terms. All
//   six in the crosswalk review were yeses.
// - `middle-name-same-team`, yes. A player who goes by a second given name ("Vivien" for Wai Yee
//   Vivien), on the same terms; both in the crosswalk review were yeses. Never a half of a
//   hyphenated name: "Ching Huang" is not "Li-Ching Huang".
// - `spelling-same-team`, yes. A long full name one letter off ("Mirialis", "Miralis De La
//   Caridad Garcia Garcia"), on the same terms; the one in the crosswalk review was a yes.
// - `different-given-name`, no. A surname shared and given names that are simply two names:
//   "Jia Lee" and "Ji Eun Lee", "Hyeli Kim" and "Heejin Kim". Every Korean pair the crosswalk
//   review saw like this was a no. Not when the names are close enough to be one: initials ("Aj",
//   Allison Jane), a name cut short ("Chi", Chia-Yu), one letter off ("Sthephany", "Stephany") or
//   the same first four letters ("Marijke", "Maria", a Dutch short form). Those go to the reviewer.
// - `crosswalk-rejected`, no. One side is a WPBL player, and the other was already ruled out as
//   that player.
// - `played-together`, no. The two people, as the rules have already grouped them, played the
//   same World Cup (Chi Lin and Chia-Yu Lin were both on Taiwan's 2023 roster), or are two WPBL
//   players. No answer could make them one.
//
// Everything else goes to the reviewer, and so does any rule's yes that would make one person hold
// two WPBL players or play two events in one year. A decision records which rule or person made it.

import { editDistance, isNickname, matchKind, nameWords, type Crosswalk } from './crosswalk'

export interface SamePersonPlayer {
  /** The namespaced tournament id, `wbsc:p:<tournament>:<player>`. */
  id: string
  event_key: string
  name: string
  first_name: string
  last_name: string
  team_id: string | null
}

export type SamePersonRule =
  | 'same-name-same-team' | 'nickname-same-team' | 'middle-name-same-team' | 'spelling-same-team'
  | 'different-given-name' | 'crosswalk-rejected' | 'played-together'

/** Why a pair needs a person. */
export type SamePersonReason = 'other-team' | 'rival' | 'middle-name' | 'spelling' | 'initials' | 'short-name' | 'similar-name' | 'joins-two-wpbl' | 'same-year'

/** One pair, the earlier tournament first. */
export interface SamePersonPair {
  a: string
  b: string
  a_name: string
  b_name: string
  a_event: string
  b_event: string
  a_team: string | null
  b_team: string | null
}

export interface SamePersonDecision extends SamePersonPair {
  same: boolean
  /** `rule:<SamePersonRule>`, or the reviewer's name. */
  decided_by: string
  /** 'YYYY-MM-DD'. */
  decided_at: string
}

/**
 * One question for the reviewer. Asked once per pair of PEOPLE, not per pair of entries: when the
 * rules already made "Chi Lin" in 2018 and 2023 one person and "Chia-Yu Lin" in 2024 and 2026
 * another, whether they are the same person is one answer, and `covers` is every entry pair it
 * decides.
 */
export interface SamePersonCandidate extends SamePersonPair {
  reason: SamePersonReason
  covers: { a: string; b: string }[]
  decision: '' | 'yes' | 'no'
}

/** archive/wbsc/same-person.json: every decision, by rule or by person, so none is asked twice. */
export interface SamePersonFile { decisions: SamePersonDecision[] }

export const EMPTY_SAME_PERSON: SamePersonFile = { decisions: [] }

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
const tournament = (id: string): number => Number(id.split(':')[2] ?? 0)
const year = (eventKey: string): string => eventKey.slice(0, 4)
export const pairKey = (a: string, b: string): string => (cmp(a, b) <= 0 ? `${a}|${b}` : `${b}|${a}`)

type Kind = 'name' | 'initial' | 'middle' | 'nickname' | 'spelling'
const STRENGTH: Record<Kind, number> = { name: 0, middle: 1, spelling: 2, nickname: 3, initial: 4 }

/** Given names run together: "Bit na" and "Bitna", "Li-Ching" and "Liching" are one spelling. */
const joined = (p: SamePersonPlayer): string => nameWords(p.first_name).join('')

/**
 * What a shared surname and a different-looking given name still leave open, for a person:
 * initials ("Aj" for Allison Jane) and a given name cut short ("Chi" for Chia-Yu). Null when the
 * given names are simply two names, which is the rule's no.
 */
function closeCall(x: SamePersonPlayer, y: SamePersonPlayer): SamePersonReason | null {
  const [gx, gy] = [nameWords(x.first_name), nameWords(y.first_name)]
  const initials = (g: string[]) => g.map(w => w[0]).join('')
  if ((gx.length === 1 && gx[0].length <= 3 && gx[0] === initials(gy)) || (gy.length === 1 && gy[0].length <= 3 && gy[0] === initials(gx))) return 'initials'
  const [jx, jy] = [joined(x), joined(y)]
  if (jx.startsWith(jy) || jy.startsWith(jx)) return 'short-name'
  if (Math.min(gx[0].length, gy[0].length) > 4 && editDistance(gx[0], gy[0]) === 1) return 'spelling'
  if (gx[0].slice(0, 4) === gy[0].slice(0, 4) && gx[0].length >= 4 && gy[0].length >= 4) return 'similar-name'
  return null
}

/** How two official names relate, the stronger of the two directions. */
function pairKind(x: SamePersonPlayer, y: SamePersonPlayer): Kind | null {
  const sameSurname = nameWords(x.last_name).join('') === nameWords(y.last_name).join('')
  if (sameSurname && joined(x) === joined(y)) return 'name'
  const [gx, gy] = [nameWords(x.first_name), nameWords(y.first_name)]
  // Before matchKind, which would call "Kate" and "Katherine" an initial.
  if (sameSurname && gx.length && gy.length && (isNickname(gx[0], gy) || isNickname(gy[0], gx))) return 'nickname'
  // One letter off in a long given name, same surname: "Marianne Lisbet", "Marianne Lisbeth".
  if (sameSurname && Math.min(joined(x).length, joined(y).length) > 4 && editDistance(joined(x), joined(y)) === 1) return 'spelling'
  const one = matchKind(x, y.name)
  const two = matchKind(y, x.name)
  if (!one) return two
  if (!two) return one
  return STRENGTH[one] <= STRENGTH[two] ? one : two
}

/** Whether one goes by the other's later given name, a whole word in it ("Vivien" in "Wai Yee
 *  Vivien"), not a half of a hyphenated one ("Ching" in "Li-Ching"). */
function byMiddleName(x: SamePersonPlayer, y: SamePersonPlayer): boolean {
  const words = (p: SamePersonPlayer) => p.first_name.trim().split(/\s+/).map(w => nameWords(w).join(''))
  const [wx, wy] = [words(x), words(y)]
  return wy.slice(1).includes(wx[0]) || wx.slice(1).includes(wy[0])
}

/** Union-find over WBSC ids, for the checks a join must pass. */
class Groups {
  private parent = new Map<string, string>()
  find(x: string): string {
    let p = this.parent.get(x) ?? x
    if (p !== x) { p = this.find(p); this.parent.set(x, p) }
    return p
  }
  join(a: string, b: string): void { this.parent.set(this.find(a), this.find(b)) }
}

export interface SamePersonProposal {
  /** New decisions the rules made, to add to the file. */
  decided: SamePersonDecision[]
  /** What a person has to answer. */
  review: SamePersonCandidate[]
}

export function proposeSamePerson(
  players: readonly SamePersonPlayer[],
  crosswalk: Crosswalk,
  file: SamePersonFile,
  today: string,
): SamePersonProposal {
  const wpblOf = new Map(crosswalk.links.map(l => [l.wbsc_id, l.wpbl_id]))
  const rejected = new Set(crosswalk.rejected.map(r => `${r.wbsc_id}|${r.wpbl_id}`))
  const done = new Set(file.decisions.map(d => pairKey(d.a, d.b)))

  // Pairs that share a surname word, across two different years (one person cannot be in two
  // groups of one World Cup), the earlier tournament first.
  const bySurname = new Map<string, SamePersonPlayer[]>()
  for (const p of players) for (const w of nameWords(p.last_name)) bySurname.set(w, [...(bySurname.get(w) ?? []), p])
  const seen = new Set<string>()
  const pairs: { x: SamePersonPlayer; y: SamePersonPlayer; kind: Kind }[] = []
  for (const group of bySurname.values()) {
    for (const x of group) for (const y of group) {
      if (tournament(x.id) >= tournament(y.id) || year(x.event_key) === year(y.event_key)) continue
      const key = pairKey(x.id, y.id)
      if (seen.has(key) || done.has(key)) continue
      seen.add(key)
      // Both already the same WPBL player are already one person; two different ones never are.
      if (wpblOf.has(x.id) && wpblOf.has(y.id)) continue
      const kind = pairKind(x, y)
      if (kind) pairs.push({ x, y, kind })
    }
  }

  // A rival: another strong candidate for the same player in the same event.
  const strong = (k: Kind) => k === 'name' || k === 'nickname'
  const rivals = new Map<string, number>()
  const bump = (k: string) => rivals.set(k, (rivals.get(k) ?? 0) + 1)
  for (const { x, y, kind } of pairs) if (strong(kind)) { bump(`${x.id}>${y.event_key}`); bump(`${y.id}>${x.event_key}`) }

  const pair = (x: SamePersonPlayer, y: SamePersonPlayer): SamePersonPair => ({
    a: x.id, b: y.id, a_name: x.name, b_name: y.name, a_event: x.event_key, b_event: y.event_key, a_team: x.team_id, b_team: y.team_id,
  })
  const rule = (x: SamePersonPlayer, y: SamePersonPlayer, same: boolean, r: SamePersonRule): SamePersonDecision =>
    ({ ...pair(x, y), same, decided_by: `rule:${r}`, decided_at: today })

  const decided: SamePersonDecision[] = []
  const review: SamePersonCandidate[] = []
  const yeses: { x: SamePersonPlayer; y: SamePersonPlayer; r: SamePersonRule }[] = []
  for (const { x, y, kind } of pairs) {
    const linkedTo = wpblOf.get(x.id) ?? wpblOf.get(y.id)
    const other = wpblOf.has(x.id) ? y : x
    if (linkedTo && rejected.has(`${other.id}|${linkedTo}`)) { decided.push(rule(x, y, false, 'crosswalk-rejected')); continue }
    const ask = (reason: SamePersonReason) => review.push({ ...pair(x, y), reason, covers: [{ a: x.id, b: y.id }], decision: '' })
    if (kind === 'initial') {
      const close = closeCall(x, y)
      if (close) ask(close)
      else decided.push(rule(x, y, false, 'different-given-name'))
      continue
    }
    if (kind === 'middle' && !byMiddleName(x, y)) { ask('middle-name'); continue }
    // A long full name, so one letter is a typo and not another name ("Hye in", "Hyemin" is the
    // reviewer's).
    if (kind === 'spelling' && Math.min(nameWords(x.name).join('').length, nameWords(y.name).join('').length) < 15) { ask('spelling'); continue }
    if (x.team_id !== y.team_id) { ask('other-team'); continue }
    if ((rivals.get(`${x.id}>${y.event_key}`) ?? 0) > 1 || (rivals.get(`${y.id}>${x.event_key}`) ?? 0) > 1) { ask('rival'); continue }
    const r: SamePersonRule = kind === 'nickname' ? 'nickname-same-team' : kind === 'middle' ? 'middle-name-same-team'
      : kind === 'spelling' ? 'spelling-same-team' : 'same-name-same-team'
    yeses.push({ x, y, r })
  }

  // A rule's yes must not join two WPBL players, or put one person in two events of one year, with
  // everything already decided. Any group that would is the reviewer's, every pair in it.
  const groups = new Groups()
  const byId = new Map(players.map(p => [p.id, p]))
  for (const d of file.decisions) if (d.same) groups.join(d.a, d.b)
  for (const l of crosswalk.links) groups.join(l.wbsc_id, `wpbl:${l.wpbl_id}`)
  for (const { x, y } of yeses) groups.join(x.id, y.id)
  const members = new Map<string, string[]>()
  for (const id of [...byId.keys(), ...crosswalk.links.map(l => `wpbl:${l.wpbl_id}`)]) {
    const root = groups.find(id)
    members.set(root, [...(members.get(root) ?? []), id])
  }
  const broken = new Map<string, SamePersonReason>()
  for (const [root, ids] of members) {
    const wpbl = new Set(ids.filter(i => i.startsWith('wpbl:')))
    const years = ids.filter(i => byId.has(i)).map(i => year(byId.get(i)!.event_key))
    if (wpbl.size > 1) broken.set(root, 'joins-two-wpbl')
    else if (new Set(years).size < years.length) broken.set(root, 'same-year')
  }
  for (const { x, y, r } of yeses) {
    const why = broken.get(groups.find(x.id))
    if (why) review.push({ ...pair(x, y), reason: why, covers: [{ a: x.id, b: y.id }], decision: '' })
    else decided.push(rule(x, y, true, r))
  }

  // One question per pair of people, over the groups as they stand once the rules' yeses are in.
  const people = new Groups()
  for (const d of [...file.decisions, ...decided]) if (d.same) people.join(d.a, d.b)
  for (const l of crosswalk.links) people.join(l.wbsc_id, `wpbl:${l.wpbl_id}`)
  const order = (p: SamePersonPair, q: SamePersonPair) => cmp(p.a_name, q.a_name) || cmp(p.a, q.a) || cmp(p.b, q.b)
  const careers = new Map<string, { years: Set<string>; wpbl: Set<string> }>()
  const career = (root: string) => {
    let c = careers.get(root)
    if (!c) { c = { years: new Set(), wpbl: new Set() }; careers.set(root, c) }
    return c
  }
  for (const p of players) career(people.find(p.id)).years.add(year(p.event_key))
  for (const l of crosswalk.links) career(people.find(`wpbl:${l.wpbl_id}`)).wpbl.add(l.wpbl_id)
  const questions = new Map<string, SamePersonCandidate>()
  for (const c of review.sort(order)) {
    const [ra, rb] = [people.find(c.a), people.find(c.b)]
    // Already one person through the rules' other yeses: nothing to ask.
    if (ra === rb) continue
    const [ca, cb] = [career(ra), career(rb)]
    if ([...ca.years].some(y => cb.years.has(y)) || (ca.wpbl.size > 0 && cb.wpbl.size > 0)) {
      for (const { a, b } of c.covers) {
        const [x, y] = [byId.get(a)!, byId.get(b)!]
        decided.push(rule(x, y, false, 'played-together'))
      }
      continue
    }
    const key = pairKey(ra, rb)
    const q = questions.get(key)
    if (q) q.covers.push(...c.covers)
    else questions.set(key, c)
  }
  return { decided: decided.sort(order), review: [...questions.values()] }
}
