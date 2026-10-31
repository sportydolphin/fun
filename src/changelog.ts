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
    version: '1.204.0',
    date:    '2026-10-31',
    changes: [
      {
        short: 'MLB Scores on a phone',
        full:  'On a phone each MLB game on Scores is one row: status, clubs, runs, and the decisions or probable starters. A full day takes about a third of the scrolling. Line scores are in the game.',
      },
      {
        short: 'MLB schedule by month',
        full:  'Full schedule on the MLB team card is a calendar, one month at a time, with the record for the month.',
      },
    ],
  },
  {
    version: '1.203.0',
    date:    '2026-10-31',
    changes: [
      {
        short: 'MLB Home for the offseason',
        full:  'With no games left, MLB Home leads with the champion, your club and the Hot Stove. The bracket moves to the recap, and Predictions and Streak Survivor share one card with your record, the leaderboards and the date of Opening Day.',
      },
      {
        short: 'Full schedule, all season',
        full:  'Schedule on the MLB team card opens the whole season. It did nothing for a club with no game in the last two weeks.',
      },
    ],
  },
  {
    version: '1.202.2',
    date:    '2026-10-31',
    changes: [
      {
        short: 'Opening after an update',
        full:  "If the app's files fail to load after an update, it reloads once by itself and then shows a Reload button, instead of staying on the loading screen.",
      },
    ],
  },
  {
    version: '1.202.1',
    date:    '2026-10-30',
    changes: [
      {
        short: 'Pages open at the top',
        full:  "A page opened from a link, such as Watch or the season recap, starts at its top instead of at the depth of the page before it.",
      },
    ],
  },
  {
    version: '1.202.0',
    date:    '2026-10-30',
    changes: [
      {
        short: 'WPBL Watch: Hide scores',
        full:  "Hide scores on the Games shelf keeps results off the game cards and video pages, and is remembered on this browser.",
      },
      {
        short: 'WPBL: Watch this game and All clips',
        full:  "Game Center has Watch this game: the game's videos, then its clips in the order of the plays. Player pages link to All clips, and a video playing over a page links to its Video page.",
      },
      {
        short: 'WPBL: video links show the poster',
        full:  "A shared link to a WPBL video shows its title and poster.",
      },
    ],
  },
  {
    version: '1.201.0',
    date:    '2026-10-30',
    changes: [
      {
        short: 'WPBL Watch: Best games',
        full:  "Best games ranks every game by its swings in win probability and opens the condensed game. Lead changes, ties and extra innings are listed. Scores stay off the row.",
      },
      {
        short: 'WPBL Watch: Biggest plays and Home runs',
        full:  "Biggest plays ranks clips by how far the play moved win probability. Home runs has its own row, and Plays filters by kind of play and by player.",
      },
      {
        short: 'WPBL Watch: Players',
        full:  "A Players shelf lists everyone in a clip. Each player has their own view of their clips, with an address to share.",
      },
    ],
  },
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
