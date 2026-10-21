// Small formatting helpers both sections share. Each one used to be copied file by file, and the
// copies drifted: three WPBL ones only knew 1st to 3rd and would have printed "21th".
//
// No imports, on purpose: the Deno ingest loads this through derive/predictions.ts, which cannot
// reach anything that pulls in a Vite asset. Keep it that way.

/** 1st, 2nd, 3rd, 4th ... 11th, 12th, 13th ... 21st, 22nd, 101st. */
export function ordinal(n: number): string {
  const rest = n % 100
  if (rest >= 11 && rest <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Aug 5" from a 'YYYY-MM-DD' (anything after the date is ignored), or '' when there is no date.
 *  Read from the digits rather than through a Date: `new Date('2026-08-05')` is UTC midnight and
 *  names Aug 4 anywhere west of Greenwich, and a locale format reads "5 Aug" in some browsers
 *  beside an English page. */
export function shortDate(iso: string | null | undefined): string {
  const m = /^\d{4}-(\d{2})-(\d{2})/.exec(iso ?? '')
  const month = m ? MONTHS[Number(m[1]) - 1] : undefined
  return m && month ? `${month} ${Number(m[2])}` : ''
}

// Words a title leaves lowercase unless they open or close it (Chicago's short list, plus "vs").
const TITLE_SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'nor', 'of', 'on', 'or', 'per', 'the', 'to', 'vs', 'via'])

/**
 * "Hitting streaks" → "Hitting Streaks", "Batter vs pitcher" → "Batter vs Pitcher". Card and section
 * titles are Title Case across both sections (owner's call, Oct 21, 2026); MLB's were and WPBL's
 * were sentence case, so the same kind of card read two ways a tab apart. Applied inside the shared
 * heading components rather than in each string, so a new title cannot come out the other way.
 *
 * Only a word that is ALL lowercase letters changes. Anything with a capital or a digit is a stat
 * or a name and is left exactly as written: wOBA, wRC+, xBA, K/7, OBP, 2026, McKinstry.
 */
export function titleCase(s: string): string {
  if (!s) return s
  const words = s.split(' ')
  return words.map((w, i) => {
    const edge = i === 0 || i === words.length - 1
    return w.split('-').map((part, j) => {
      const m = /^([^a-z]*)([a-z]+)([^a-z]*)$/.exec(part)
      if (!m || /[A-Z0-9]/.test(part)) return part
      if (j === 0 && !edge && TITLE_SMALL.has(m[2])) return part
      return m[1] + m[2][0].toUpperCase() + m[2].slice(1) + m[3]
    }).join('-')
  }).join(' ')
}

/** titleCase over a heading's children: a string is cased, anything else (a name link, a
 *  fragment) is passed through as built. */
export function titleCaseNode<T>(node: T): T | string {
  return typeof node === 'string' ? titleCase(node) : node
}
