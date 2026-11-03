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
    version: '1.207.0',
    date:    '2026-11-02',
    changes: [
      {
        short: 'Search ranking',
        full:  'WPBL search lists the closest names first, finds a name typed surname first or with an initial ("k whitmore"), and ignores accents, so "andreanne" finds Andréanne Leblanc.',
      },
      {
        short: 'Faster search',
        full:  'Search keeps the roster between visits, so it answers the first letter typed. MLB search finds this season's players without waiting on MLB's server.',
      },
      {
        short: 'WAR leaders',
        full:  'An empty WPBL search box shows the season's WAR leaders until there are recent searches to show.',
      },
    ],
  },
  {
    version: '1.206.2',
    date:    '2026-11-02',
    changes: [
      {
        short: 'WPBL games played',
        full:  'WPBL player pages count games as a defensive sub or pinch runner, and the runs scored in them, so G and R match Home and the Stats table.',
      },
      {
        short: 'Player pages',
        full:  'All stats no longer repeats the summary table above the full tables. Batting, Pitching and Fielding headings are larger, and a two-way WPBL player shows Total WAR.',
      },
      {
        short: 'WPBL hit locations',
        full:  'The hit locations chart on a player page is smaller, with Pull, Center and Oppo beside it.',
      },
    ],
  },
  {
    version: '1.206.1',
    date:    '2026-11-01',
    changes: [
      {
        short: 'WPBL baserunning runs',
        full:  'WPBL baserunning runs now charge a runner for holding where most runners take the base. BsR and WAR move with them: the league’s BsR sums to zero, and Ashton Lansdell leads it.',
      },
      {
        short: 'WPBL catchers',
        full:  'WPBL catcher arm runs leave out throws that started at the pitcher. The awards card counts everyone who ran, so Denae Benites threw out 5 of 17. CS and CS% join the Fielding board, and SBA there counts catchers only.',
      },
      {
        short: 'WPBL team fielding',
        full:  'Team double plays and steals allowed on the WPBL Fielding board were counted more than once. Each double play and steal now counts once.',
      },
      {
        short: 'WPBL glossary',
        full:  'The WPBL glossary adds OPS+, ERA+, LOB, STR%, CS%, TC and the WAR parts, and its benchmarks use this league’s averages.',
      },
      {
        short: 'ERA rounding',
        full:  'A WPBL ERA that lands on a half now rounds up, matching the league.',
      },
      {
        short: 'MLB ERA+',
        full:  'A 0.00 ERA reads ∞ on the MLB ERA+ column and leads the board.',
      },
    ],
  },
  {
    version: '1.206.0',
    date:    '2026-11-01',
    changes: [
      {
        short: 'WPBL Home leaders',
        full:  'WPBL Home: 2026 Leaders now has WAR, names both players on a tie, and puts a player who leads two stats on one row. Each figure opens its stat on the Players board.',
      },
      {
        short: 'WPBL Home fan award winners',
        full:  'WPBL Home: 2026 Fan Award Winners now has Manager of the Year and the vote share of each winner, which opens the results for that award.',
      },
    ],
  },
  {
    version: '1.205.1',
    date:    '2026-11-01',
    changes: [
      {
        short: 'WPBL batter vs pitcher lines',
        full:  'WPBL batter vs pitcher lines now count infield flies as at-bats and no longer charge a batter for a runner picked off during the plate appearance.',
      },
    ],
  },
  {
    version: '1.205.0',
    date:    '2026-10-31',
    changes: [
      {
        short: 'MLB team card',
        full:  'The MLB team card is redrawn. The club name opens the club, and in the offseason the card counts its moves and opens them.',
      },
      {
        short: 'MLB division winners',
        full:  'MLB Home lists the division winners through the offseason.',
      },
      {
        short: 'Offseason report boards',
        full:  'Most Improved, Biggest Drops, Cheapest Wins and Priciest Wins join the MLB report boards once the regular season is over.',
      },
      {
        short: 'Hot Stove order',
        full:  "The Hot Stove card leads with the week's signings and trades, and Milestone Watch leads with the next marks.",
      },
    ],
  },
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
