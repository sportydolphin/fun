// Reading a wbsc.org page. The site is an Inertia app: the whole page's data rides in one
// `data-page` attribute on the HTML, or comes back alone as JSON when asked with the Inertia
// headers. This is a page, not a published API, so it can change shape on any WBSC deploy; the
// importer validates everything it takes from here (see game.ts) and fails rather than guess.

/** The envelope Inertia wraps every page in. `version` is the asset version the JSON request has
 *  to echo back; a stale one gets a 409. */
export interface InertiaPage<P = Record<string, unknown>> {
  component: string
  props: P
  url: string
  version: string
}

const NAMED: Readonly<Record<string, string>> = { quot: '"', amp: '&', lt: '<', gt: '>', apos: "'" }

/** Undo the HTML attribute escaping, numeric entities included (WBSC writes `&#039;`). */
export function unescapeAttribute(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ent: string) => {
    if (ent[0] === '#') {
      const code = ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole
    }
    return NAMED[ent.toLowerCase()] ?? whole
  })
}

/** The page data out of a full HTML response, or an error naming what was missing. */
export function inertiaFromHtml<P>(html: string): InertiaPage<P> {
  const m = /\sdata-page="([^"]*)"/.exec(html)
  if (!m) throw new Error('no data-page attribute: not an Inertia page, or the markup changed')
  const page = JSON.parse(unescapeAttribute(m[1])) as InertiaPage<P>
  if (!page || typeof page !== 'object' || !page.props) throw new Error('data-page holds no props')
  return page
}
