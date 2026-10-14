// A name typed with a slip in it: "Whitmor", "Ohatni", "Freddy Freman".
//
// THE SEARCH'S SECOND TRY, NEVER ITS FIRST. Both sections match names by plain substring, which is
// exact and cheap and must stay what answers a correct spelling: a fuzzy pass run alongside it
// would put "Ohl" next to "Oh" for a reader who typed exactly what they meant. So the sections call
// this only when the substring pass found nothing, which is also the one case that used to end in
// an empty box (and, on WPBL, in admin's list of queries that matched nothing).
//
// Every word typed has to land on a word of the name, either as the start of it (a name still being
// typed) or within a small edit distance of it or of its start. The allowance grows with the word,
// because one slip in a four-letter word is a quarter of it and in a nine-letter word is not.
// IMPORTS NOTHING, so both sections and the shell can use it without pulling in either section.

/** Lowercase, accents folded, punctuation gone: "José Ramírez" and "jose ramirez" are one name. */
export function foldName(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim()
}

/** Edits allowed for a typed word of this length. Under four letters a slip is not told apart from
 *  a different word, so short words must be exact. */
function allowance(len: number): number {
  return len < 4 ? 0 : len < 7 ? 1 : 2
}

/** Optimal string alignment distance: insertions, deletions, substitutions and one swap of
 *  neighbours, which is the commonest slip ("Ohatni"). Gives up past `max`. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
      rowMin = Math.min(rowMin, d[i][j])
    }
    if (rowMin > max) return max + 1
  }
  return d[a.length][b.length]
}

/** How well one typed word fits one word of a name: 3 for its start, 2 for a slip of the whole word,
 *  1 for a slip of its start (a name still being typed, with a slip in it), 0 for no fit. */
function wordFit(typed: string, word: string): number {
  if (word.startsWith(typed)) return 3
  const max = allowance(typed.length)
  if (!max) return 0
  if (editDistance(typed, word, max) <= max) return 2
  if (word.length > typed.length && editDistance(typed, word.slice(0, typed.length), max) <= max) return 1
  return 0
}

/** How well `query` fits `name`, 0 for not at all. Every typed word must fit a different word of
 *  the name. */
export function fuzzyNameScore(name: string, query: string): number {
  const typed = foldName(query).split(' ').filter(Boolean)
  const words = foldName(name).split(' ').filter(Boolean)
  if (!typed.length || !words.length || typed.length > words.length) return 0
  const used = new Set<number>()
  let score = 0
  for (const t of typed) {
    let best = 0, at = -1
    words.forEach((w, i) => {
      if (used.has(i)) return
      const f = wordFit(t, w)
      if (f > best) { best = f; at = i }
    })
    if (!best) return 0
    used.add(at)
    score += best
  }
  return score
}

/** `items` that fit `query`, best first. `namesOf` is every name an item answers to (a club's city,
 *  nickname and abbreviation), and the best of them counts. */
export function fuzzyMatches<T>(items: readonly T[], query: string, namesOf: (t: T) => string[]): T[] {
  return items
    .map(item => ({ item, score: Math.max(0, ...namesOf(item).map(n => fuzzyNameScore(n, query))) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(x => x.item)
}
