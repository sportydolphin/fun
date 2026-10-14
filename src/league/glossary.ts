// The shape of a league's glossary: its abbreviations, the groups a page lists them in, and the
// rules a reader asks about. Each section keeps its own data (wpbl/glossary.ts, mlb/statGlossary.ts)
// because the leagues differ exactly where a glossary has to be right, ERA per seven against per
// nine, a four-inning win against a five-inning one. What they share is the shape, so one page
// (src/ui/Glossary.tsx) and one set of lookups read both.
//
// Until Oct 2026 MLB held its terms as `[full, plain]` tuples beside WPBL's objects, with its own
// accessor trio, so a fix to how a term was looked up had to be made twice and once was not.
//
// NO IMPORTS: seo.ts and the tests read the data, and none of them should pull in React.

export interface GlossaryEntry {
  /** The expansion. Always present; this is what a tooltip shows first. */
  full: string
  /** One or two sentences of plain English, for a reader who does not follow baseball.
   *  Optional because plenty of these expand to their own explanation: "Runs", "Hits". */
  plain?: string | null
}

export type GlossaryTerms = Readonly<Record<string, GlossaryEntry>>

export interface GlossaryGroup { key: string; label: string; keys: string[] }

export interface GlossaryRule {
  /** Slug, and stable: it is the anchor a link to this rule points at. */
  id: string
  /** Phrased as a reader would ask it, not as a rulebook would head it. */
  question: string
  answer: string
  /** Where the rule came from; the page's `badge` turns it into the label beside the question. */
  source: string
  /** The working, shown under the answer. */
  note?: string
}

/** The whole entry, or null for a label the glossary does not know. */
export const termEntry = (terms: GlossaryTerms, k: string): GlossaryEntry | null => terms[k] ?? null

/** The expansion alone, for a header cell with room for one line. */
export const termFull = (terms: GlossaryTerms, k: string): string | null => terms[k]?.full ?? null

/** The plain-English half, or null where the expansion already says it all. */
export const termPlain = (terms: GlossaryTerms, k: string): string | null => terms[k]?.plain ?? null

/** The scroll request's name for a term (lib/sectionScroll.ts), and so its row's anchor: `term-wRC-plus`.
 *  Symbols spelled out and case kept, since they are what tell terms apart: wRC+ from wRC, ERA-
 *  from ERA, and MLB's POS (a game's position) from Pos (a season's). */
export const glossaryTermKey = (k: string): string =>
  `term-${k.replace(/\+/g, '-plus').replace(/-$/, '-minus').replace(/%/g, '-pct').replace(/\//g, '-per-').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')}`

// "what is OPS+", "what does FIP stand for", "wRC+ meaning": a question about what a stat IS.
const ASKED_BEFORE = /^(?:what(?:'s| is| are| does)?|whats|define|definition of|meaning of|explain)\s+(?:an?\s+|the\s+)?/
const ASKED_AFTER = /\s+(?:mean|means|meaning|stand for|stands for|definition|defined|abbreviation)$/
const spoken = (t: string) => t.toLowerCase().replace(/[‐-―-]/g, ' ').replace(/\s+/g, ' ').trim()

/**
 * The glossary terms `text` asks about, and whether it asked in words. Matches a term by its
 * letters ("ops", "wrc+", "wrc plus", "k per 9") or by its expansion ("on base percentage").
 * Unasked, only a term that cannot be the start of a name or of a ranking does: "fip" and "wrc+"
 * are definitions, "hr" typed bare is the home run board or somebody's initials first.
 */
export function askedTerms(text: string, terms: GlossaryTerms): { keys: string[]; asked: boolean } {
  let t = spoken(text).replace(/[?.!]+$/, '').trim()
  const before = t.replace(ASKED_BEFORE, ''), asked = before !== t || ASKED_AFTER.test(before)
  t = before.replace(ASKED_AFTER, '').trim()
  if (!t) return { keys: [], asked }
  const letters = t.replace(/\s+plus$/, '+').replace(/\s+minus$/, '-').replace(/\s+percent(?:age)?$/, '%').replace(/\s+per\s+/g, '/').replace(/\s+/g, '')
  const keys = Object.keys(terms).filter(k => {
    // An inner dash is said as a space ("k bb%"); a trailing one is a different stat (ERA-).
    const byLetters = k.toLowerCase().replace(/\s|(?<=.)-(?=.)/g, '') === letters
    const byName = spoken(terms[k].full) === t
    if (!byLetters && !byName) return false
    return asked || byName || k.length >= 3 || /[^a-z]/i.test(k)
  })
  return { keys, asked }
}
