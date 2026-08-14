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
