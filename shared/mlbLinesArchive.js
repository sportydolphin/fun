// Where closed MLB seasons' box-score lines live once they leave Postgres, shared by the browser
// (src/mlb/seasonLines.ts), the nightly mirror (scripts/sync-mlb-lines.mjs) and the freezer
// (scripts/freeze-mlb-lines.mjs). See docs/MLB_LINES_ARCHIVE.md.
//
// WHY. The line tables were 250 MB of a 407 MB database on Nov 8, 2026, about 9 MB a season, and a
// closed season never changes again. The files load from Cloudflare rather than Supabase, backups
// shrink, and the MLB plays mirror never has to share the disk with old lines. Each one is now a static file on R2 in the exact shape the
// `mlb_season_lines` view returns, so the browser reads the same packed row from Cloudflare instead
// of Postgres, and the database holds only the season being played.
//
// RAISING FROZEN_THROUGH IS THE LAST STEP, NOT THE FIRST. Upload and verify the season's file
// (`npm run freeze-mlb-lines -- --season <year>`), ship the raised number, and only then delete the
// season's rows (`--delete`). Raise it first and the boards read a file that is not there yet.

/** Every season up to and including this one is read from the archive, never from Postgres. */
export const MLB_LINES_FROZEN_THROUGH = 2026

/** The public base the files are served from: the photo bucket's custom domain. Versioned, so a
 *  change to the file's shape is a new folder rather than an overwrite behind a day of cache. */
export const MLB_LINES_ARCHIVE_BASE = 'https://photos.sportydolphin.fun/mlb/lines/v1'

/** The file key for one season, relative to the bucket. */
export const mlbLinesArchiveKey = season => `mlb/lines/v1/${season}.json`

/** The public address of one season's file. */
export const mlbLinesArchiveUrl = season => `${MLB_LINES_ARCHIVE_BASE}/${season}.json`
