// The site changelog, newest first. Split out of ./version.ts so it stays out of the entry
// chunk. See the note there. Loaded on demand when the "What's New" dialog opens.
// Only the newest releases live here; older ones are archived under ./changelog/ by minor-version
// range and appended below, so a new entry is a small edit at the top of a small file. When this
// list passes 1.249.x, move 1.200 to 1.249 into its own archive file the same way.
//
// ONLY THE NEWEST ARCHIVE COMES WITH THE DIALOG. The dialog opens on five days, and this file
// alone cannot fill them, so 1.150 to 1.199 rides along; the older archives (about 230 KB and up
// of prose, most of the dialog's chunk) load when a reader asks for earlier updates. Until
// Oct 15, 2026 every archive was a static import here, and the dialog's chunk was 80 KB gzipped.
import type { ChangelogEntry } from './version'
import { ENTRIES as v1_150 } from './changelog/v1.150-1.199'

/** Every release older than CHANGELOG holds, newest first. */
export async function loadOlderChangelog(): Promise<ChangelogEntry[]> {
  const [v1_100, v1_050, v1_000] = await Promise.all([
    import('./changelog/v1.100-1.149'),
    import('./changelog/v1.050-1.099'),
    import('./changelog/v1.000-1.049'),
  ])
  return [...v1_100.ENTRIES, ...v1_050.ENTRIES, ...v1_000.ENTRIES]
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.200.0',
    date:    '2026-10-30',
    changes: [
      {
        short: 'WPBL Watch: a front page',
        full:  "Watch opens on a featured video, then rows for Continue watching, Latest, Games, Plays, Season compilations and Podcast, each with a link to the whole shelf.",
      },
      {
        short: 'WPBL Watch: new shelves',
        full:  "Watch has Featured, Games, Plays, Clips, Features and Podcast. Plays are the clips from a game. One Club menu narrows Games, Plays and Clips.",
      },
    ],
  },
  ...v1_150,
]
