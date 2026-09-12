// Single source of truth for the site version + changelog. The version badge in
// the toolbar reads APP_VERSION; clicking it opens a dialog that renders CHANGELOG.
//
// The two live in SEPARATE modules on purpose. APP_VERSION is a string rendered in the
// toolbar and the footer on every page; CHANGELOG is ~59 KB of prose behind a dialog that
// most readers never open. Rollup splits by module, not by export, so while they shared a
// file every visitor downloaded the entire changelog in the entry chunk to render "v1.43.0".
// The prose now lives in ./changelog.ts, which is loaded on demand by ChangelogDialogs.
//
// When shipping a notable change, bump APP_VERSION here and add a new entry at the TOP
// of CHANGELOG in ./changelog.ts (newest first). Each change has a `short` one-line summary
// and a `full` sentence. Write plainly, no em dashes and no marketing voice, just say what
// changed.
//
// NOTHING HERE CHANGES WITH HOW THE DIALOG DRAWS IT, and it is worth knowing what that is.
// ChangelogDialogs groups these entries BY DATE and leads each day with its biggest release,
// showing three of the day's `short` lines and putting the rest, plus every `full` sentence,
// behind one link. So a day's shape is decided by which entry has the most changes, not by
// which shipped last: a one-line patch on top of a feature does not take the day's heading.
// Keep writing one entry per version regardless. The grouping is derived on render and the
// file stays the record.

export const APP_VERSION = '1.82.0'

export interface ChangelogChange {
  short: string
  full:  string
}

export interface ChangelogEntry {
  version: string
  date:    string        // ISO date (YYYY-MM-DD)
  title?:  string
  changes: ChangelogChange[]
}
