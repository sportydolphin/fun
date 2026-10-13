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
