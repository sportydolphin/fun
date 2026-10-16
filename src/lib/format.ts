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
