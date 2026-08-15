// Finding a WPBL player from whatever someone typed.
//
// This is a different problem from the roster reconciliation in
// supabase/functions/wpbl-ingest/names.ts, which is why it doesn't share that code. That
// module matches one authoritative feed record against one seeded row and has to be strict,
// because a wrong match silently forks a player's season across two rows. This one takes a
// human guess in a Discord box and has to be generous, because the cost of a loose match is
// only that the reader sees "did you mean" and types again.
//
// So it accepts, in roughly descending confidence: the full name, either name alone, the
// two names in either order, initials-plus-surname, a prefix of anything ("whit", "kels"),
// and finally ordinary misspellings by edit distance. Accents are folded, so "Andreanne"
// finds "Andréanne" and "Maika" finds "Maïka" without the reader hunting for the key.

/** Fold to a comparable form: no accents, no punctuation, single-spaced, lowercase. */
export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')   // combining diacritical marks
    .toLowerCase()
    .replace(/[.'’`]/g, '')            // O'Brien / O’Brien / initials typed as "k."
    .replace(/[^a-z0-9]+/g, ' ')       // hyphens, commas, anything else becomes a gap
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Levenshtein distance, abandoned once it passes `max` (returns max + 1). Bounded because
 * the only question ever asked of it here is "is this within a typo or two", and the early exit
 * keeps a scan over the whole roster cheap.
 */
export function editDistance(a: string, b: string, max = 2): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
      cur.push(v)
      if (v < rowMin) rowMin = v
    }
    if (rowMin > max) return max + 1   // every path already too expensive
    prev = cur
  }
  return prev[b.length] > max ? max + 1 : prev[b.length]
}

export interface SearchHit<T> {
  player: T
  score: number
  /** True when the match is good enough to answer with instead of asking. */
  confident: boolean
}

// Score bands. The gaps are deliberate: anything at 70 or better is a match the reader
// plainly meant, and below that we would rather offer a choice than guess.
const CONFIDENT_AT = 70

/**
 * Rank a roster against a typed query, best first. Returns every plausible hit rather than
 * one answer, so the caller can tell "one obvious player" from "three people called Kim"
 * and respond differently.
 */
export function searchPlayers<T extends { name: string }>(query: string, players: T[]): SearchHit<T>[] {
  const q = normalizeName(query)
  if (!q) return []
  const qTokens = q.split(' ')

  const hits: SearchHit<T>[] = []
  for (const player of players) {
    const full = normalizeName(player.name)
    if (!full) continue
    const tokens = full.split(' ')
    const score = scoreOne(q, qTokens, full, tokens)
    if (score > 0) hits.push({ player, score, confident: score >= CONFIDENT_AT })
  }

  // Ties break on the shorter name: when "kim" matches both "Kim" and "Kimberley", the
  // exact one is what was meant.
  hits.sort((a, b) => b.score - a.score || a.player.name.length - b.player.name.length)
  return hits
}

function scoreOne(q: string, qTokens: string[], full: string, tokens: string[]): number {
  if (q === full) return 100

  const first = tokens[0]
  const last = tokens[tokens.length - 1]

  // "whitmore kelsie" for "kelsie whitmore" — people type surname-first out of habit.
  if (tokens.length > 1 && q === [...tokens].reverse().join(' ')) return 95

  if (q === last) return 88
  if (q === first) return 82

  // "k whitmore" / "kelsie w": every typed token opens a distinct name token.
  if (qTokens.length > 1 && qTokens.length <= tokens.length && tokensArePrefixes(qTokens, tokens)) return 78

  if (full.startsWith(q)) return 74
  if (last.startsWith(q) && q.length >= 3) return 72
  if (first.startsWith(q) && q.length >= 3) return 70

  // Below the confidence line: real but worth confirming.
  if (full.includes(q) && q.length >= 3) return 60

  // Misspellings. Compare against the whole name and each part, and let the closest win,
  // so "witmore" (one deletion from the surname) still lands.
  const dFull = editDistance(q, full)
  if (dFull <= 2) return 56 - dFull * 6
  let best = Infinity
  for (const t of tokens) {
    if (t.length < 4) continue     // short tokens are one typo from everything
    const d = editDistance(q, t)
    if (d < best) best = d
  }
  if (best <= 2) return 50 - best * 6

  return 0
}

/** Each query token is a prefix of a later-or-equal name token, in order. */
function tokensArePrefixes(qTokens: string[], tokens: string[]): boolean {
  let i = 0
  for (const qt of qTokens) {
    let found = false
    while (i < tokens.length) {
      if (tokens[i].startsWith(qt)) { found = true; i++; break }
      i++
    }
    if (!found) return false
  }
  return true
}
