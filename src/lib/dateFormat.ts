// Cached date formatters, the same output as `toLocaleDateString` / `toLocaleTimeString`.
//
// Each of those builds a fresh Intl.DateTimeFormat for one call, and building one is the slow
// part: resolving the locale and the pattern costs far more than formatting a date. A schedule
// row, a date tile or a box-score header formats a date per render, so a list of them built
// dozens of formatters per render; `relativeDayShort` and the Schedule's `dateLabel` showed up
// in the profile of a search keystroke (Nov 6, 2026). One formatter per locale and option set.
//
// Only for options that name a date part (for `localeDate`) or a time part (for `localeTime`):
// with none, the `toLocale*` methods fill in defaults that DateTimeFormat does not.

type Locales = string | string[] | undefined

const cache = new Map<string, Intl.DateTimeFormat>()

function formatter(locales: Locales, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${Array.isArray(locales) ? locales.join(',') : locales ?? ''}|${JSON.stringify(opts)}`
  let f = cache.get(key)
  if (!f) {
    // `[]` and undefined both mean the reader's own locale.
    f = new Intl.DateTimeFormat(Array.isArray(locales) && locales.length === 0 ? undefined : locales, opts)
    cache.set(key, f)
  }
  return f
}

/** `date.toLocaleDateString(locales, opts)`, from a cached formatter. */
export function localeDate(date: Date, locales: Locales, opts: Intl.DateTimeFormatOptions): string {
  return formatter(locales, opts).format(date)
}

/** `date.toLocaleTimeString(locales, opts)`, from a cached formatter. */
export function localeTime(date: Date, locales: Locales, opts: Intl.DateTimeFormatOptions): string {
  return formatter(locales, opts).format(date)
}
