// The site changelog, newest first. Split out of ./version.ts so it stays out of the entry
// chunk. See the note there. Loaded on demand when the "What's New" dialog opens.
// Only the newest releases live here; older ones are archived under ./changelog/ by minor-version
// range and appended below, so a new entry is a small edit at the top of a small file. When this
// list passes 1.299.x, move 1.250 to 1.299 into its own archive file the same way.
//
// ONLY THE NEWEST ARCHIVE COMES WITH THE DIALOG. The dialog opens on five days, and this file
// alone cannot fill them, so 1.200 to 1.249 rides along; the older archives (about 230 KB and up
// of prose, most of the dialog's chunk) load when a reader asks for earlier updates. Until
// Oct 15, 2026 every archive was a static import here, and the dialog's chunk was 80 KB gzipped.
import type { ChangelogEntry } from './version'
import { ENTRIES as v1_200 } from './changelog/v1.200-1.249'

/** Every release older than CHANGELOG holds, newest first. */
export async function loadOlderChangelog(): Promise<ChangelogEntry[]> {
  const [v1_150, v1_100, v1_050, v1_000] = await Promise.all([
    import('./changelog/v1.150-1.199'),
    import('./changelog/v1.100-1.149'),
    import('./changelog/v1.050-1.099'),
    import('./changelog/v1.000-1.049'),
  ])
  return [...v1_150.ENTRIES, ...v1_100.ENTRIES, ...v1_050.ENTRIES, ...v1_000.ENTRIES]
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.252.0',
    date:    '2026-11-21',
    changes: [
      {
        short: 'Find: a plate appearance opens its play',
        full:  'On PAs and Innings, a tap anywhere on a row opens that play in Play-by-Play. The name still opens the player.',
      },
      {
        short: 'Find: add to the question',
        full:  'Under a question, the box adds what you type: "for BOS" or "2+ RBI" keeps the rest of the question instead of replacing it. A plate appearance’s outcome reads as the event: "Walk", "Home run", "Not a strikeout".',
      },
    ],
  },
  {
    version: '1.251.0',
    date:    '2026-11-21',
    changes: [
      {
        short: 'Notifications: read and dismissed sync',
        full:  'Signed in, a notification read or dismissed in one browser is read or dismissed in every other one, and two open tabs no longer bring back what the other dismissed. A push banner whose notification was already read here or elsewhere closes, and opening one from the lock screen marks it read.',
      },
      {
        short: 'Notifications: fixes',
        full:  'Tapping a WPBL push with the site open goes to that tab instead of opening a new window. A dismissed "photos to review" line comes back when a new photo arrives. Turning push off in one browser no longer turns it off on your other devices. Signing out clears the bell.',
      },
    ],
  },
  {
    version: '1.250.0',
    date:    '2026-11-20',
    changes: [
      {
        short: 'Find: the best stretch of games',
        full:  '"Most home runs in 5 games", "best avg over 10 games" and "8 hits in a 5-game span" rank each player’s best run of games in a row, with the dates of that run. On the board it is Stretch, under Seasons.',
      },
      {
        short: 'Find: extra innings and doubleheaders',
        full:  'Find and the search box can keep only extra-inning games ("home runs in extra inning games", "extra inning wins") or a doubleheader’s games: either one, the opener or the nightcap ("4 hits in the nightcap"). The board offers each where the season had one.',
      },
      {
        short: 'MLB Find: months from the search box',
        full:  'MLB Find takes a month and the last games from the search box too ("hr in august"), and keeps them after a refresh.',
      },
    ],
  },
  ...v1_200,
]
