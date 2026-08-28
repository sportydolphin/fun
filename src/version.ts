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
// (only the first 4 per version show in the main dialog) and a `full` sentence (shown for
// every change when the reader clicks "View all changes"). Write plainly, no em dashes and
// no marketing voice, just say what changed.

export const APP_VERSION = '1.52.2'

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
