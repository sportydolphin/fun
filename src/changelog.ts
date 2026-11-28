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
    version: '1.265.0',
    date:    '2026-11-27',
    changes: [
      {
        short: 'About the league: Played filter',
        full:  'Where the players are from has an All / Played switch. Played keeps the 69 players who appeared in a game, and each country\'s count follows it.',
      },
    ],
  },
  {
    version: '1.264.2',
    date:    '2026-11-24',
    changes: [
      {
        short: 'Stats: positions by name',
        full:  'The position filter on both Stats boards lists each position by name: Catcher, First base, Shortstop, Outfield and the rest. Search suggests "Best first base players".',
      },
    ],
  },
  {
    version: '1.264.1',
    date:    '2026-11-24',
    changes: [
      {
        short: 'WPBL Stats: a cleaner 2027 menu',
        full:  'The 2027 roster menu lists plain names under its Club and Status headings. The chip still says "2027: Boston" once a choice is made.',
      },
    ],
  },
  {
    version: '1.264.0',
    date:    '2026-11-24',
    changes: [
      {
        short: 'WPBL Stats: filter by 2027 roster',
        full:  "The 2026 Players board has a 2027 filter: one club's 2027 roster, any club, or a status such as Re-signed, Traded or Draft eligible. New statuses and clubs appear as the draft and free agency add them. Search answers it too: try \"draft eligible hr\" or \"Boston 2027 roster\".",
      },
    ],
  },
  {
    version: '1.263.1',
    date:    '2026-11-24',
    changes: [
      {
        short: 'Player pages: the right columns stay',
        full:  'A stat table too wide for the screen now gives up rare columns like HBP, SH and CS first, so H stays. A player with no league ranks no longer has an empty line under each season row.',
      },
    ],
  },
  {
    version: '1.263.0',
    date:    '2026-11-24',
    changes: [
      {
        short: 'Player pages: stat tables fit the screen',
        full:  'On a phone and in the desktop side panel, a stat table wider than the screen now drops its least used counts (3B, AB, 2B, R and so on) so AVG, OBP, SLG and OPS stay in view without scrolling sideways. Show more columns brings the rest back. Career, splits, World Cup and game log tables, in both leagues.',
      },
    ],
  },
  {
    version: '1.262.0',
    date:    '2026-11-23',
    changes: [
      {
        short: 'WPBL player pages: splits',
        full:  'A Splits table under each player’s matchups: against lefties and righties, bases empty, men on, RISP and two outs, by the count, by the inning and by lineup spot. Pitchers get the same, against left- and right-handed batters. It follows the season and the Regular / Playoffs choice.',
      },
    ],
  },
  {
    version: '1.261.0',
    date:    '2026-11-23',
    changes: [
      {
        short: 'Find: every column shows in Firefox',
        full:  'Firefox drew the Find results table with only the rank and the name; the game, result and stat columns sat far off to the right. They are back.',
      },
      {
        short: 'Find: a score column for club innings',
        full:  'A club\'s inning on Hitting shows the score before and after it, "2–6 → 9–6", and each club row leads with its mark. The Game column is wider, so "Aug 28 vs BOS" no longer runs into its result.',
      },
    ],
  },
  {
    version: '1.260.5',
    date:    '2026-11-23',
    changes: [
      {
        short: 'WPBL stats: each season under the club it was played for',
        full:  "A player traded since the season now reads under the club they played it for on the Stats boards, Charts, Home, the tracking leaders, team leaders and the fan awards. Alyssa Zettlemoyer's 2026 season is back under New York.",
      },
    ],
  },
  {
    version: '1.260.4',
    date:    '2026-11-23',
    changes: [
      {
        short: 'WPBL rosters: re-signings final',
        full:  'Every club has finished announcing re-signings. Boston kept 7, so its other 2026 players read Draft eligible in place of Not announced.',
      },
    ],
  },
  {
    version: '1.260.3',
    date:    '2026-11-23',
    changes: [
      {
        short: 'WPBL: pitcher BABIP leaves out sacrifice bunts',
        full:  "Pitcher BABIP no longer counts a sacrifice bunt as a ball in play, matching hitter BABIP. The 2026 league figure now reads the same from both sides.",
      },
      {
        short: 'Find: no rate without a denominator',
        full:  "A season with no at-bats, or no outs and nothing allowed, shows a dash for its rates in Find, as on the Players board, instead of .000 or 0.00. It no longer matches a question about that rate.",
      },
    ],
  },
  {
    version: '1.260.2',
    date:    '2026-11-23',
    changes: [
      {
        short: 'WPBL player cards: ranks match the boards',
        full:  "A rank on a player card now matches the Leaders cards and the Players board it opens. Counting stats are ranked against everyone who played, not only qualified players, and players tied on the printed figure share a place. Four 2026 cards read 5th in steals where the board has all four tied for 6th.",
      },
    ],
  },
  {
    version: '1.260.1',
    date:    '2026-11-22',
    changes: [
      {
        short: 'WPBL portraits: two recropped',
        full:  "Chloe Atkinson's and Luciana Moreno's portraits are framed like the rest of the roster. Atkinson's was small and low in the frame, and Moreno's was cut off at the chin.",
      },
    ],
  },
  {
    version: '1.260.0',
    date:    '2026-11-22',
    changes: [
      {
        short: 'WPBL portraits: 18 new team photos',
        full:  "Eighteen players have the league's newer photos in their club's cap and uniform, including Ayuri Shimano, whose photo was cut off at the chin. Their link preview cards have the new photos too.",
      },
    ],
  },
  {
    version: '1.259.0',
    date:    '2026-11-22',
    changes: [
      {
        short: 'Side panel: scrollbar at the screen edge',
        full:  'On a desktop, the scrollbar at the right edge of the screen scrolls the open player or game panel, where it scrolled the page behind it. The page still scrolls with the wheel.',
      },
    ],
  },
  {
    version: '1.258.0',
    date:    '2026-11-22',
    changes: [
      {
        short: 'WPBL rosters: shorter club cards',
        full:  'Draft eligible and Not announced start collapsed with a player count, and open on a tap. On a wide screen the cards stack in two columns with no gaps between them. A traded player is listed only by the club that got them, marked with the club they came from.',
      },
    ],
  },
  {
    version: '1.257.0',
    date:    '2026-11-22',
    changes: [
      {
        short: 'WPBL Home: 2026 leaders and award winners off',
        full:  'The offseason Home no longer shows the 2026 leaders and fan award winners while the 2027 rosters are built. Both are on the Stats and Awards pages.',
      },
    ],
  },
  {
    version: '1.256.0',
    date:    '2026-11-22',
    changes: [
      {
        short: 'WPBL rosters: Not announced',
        full:  'A 2026 player whose club has not finished announcing re-signings reads Not announced, on the rosters page and the player page. Draft eligible waits until the club has its 10 or announcements end. A club’s count of 10 reads kept, since it includes players traded for: Boston has 7, six re-signed and one by trade.',
      },
      {
        short: 'WPBL rosters: draft picks, signings and releases',
        full:  'The 2027 rosters and player pages show players drafted and not yet signed, signed or released, as the league announces them.',
      },
    ],
  },
  {
    version: '1.255.0',
    date:    '2026-11-21',
    changes: [
      {
        short: 'WPBL: traded picks and trade alerts',
        full:  'The 2027 draft card on the rosters page lists every pick that changed hands. Transactions on Home marks a trade with ⇄ and shows the club each traded pick came from. Trades can now include picks on their own and players new to the league. The Roster moves setting (formerly Re-signings) also sends a push for each trade.',
      },
      {
        short: 'WPBL: rosters page',
        full:  'The re-signing window line is gone from the rosters page, and the page keeps its shape while it loads on a return visit.',
      },
    ],
  },
  {
    version: '1.254.0',
    date:    '2026-11-21',
    changes: [
      {
        short: 'WPBL player page: clips under the game log',
        full:  'Clips now sit right under the game log on a phone and a desktop, where they were at the bottom of a phone card and above the log on a desktop. The line under a player\'s name no longer ends a row on a dot, a pitcher with a few at-bats shows "0-for-1" instead of a slash line, and a best game needs at least two of a stat (one home run or triple still counts).',
      },
    ],
  },
  {
    version: '1.253.0',
    date:    '2026-11-21',
    changes: [
      {
        short: 'WPBL: Transactions on Home',
        full:  'Home lists every 2027 roster move, newest first, in place of the season card. A trade shows each player and pick under the club that got it: Boston gets Alyssa Zettlemoyer, New York gets a 2027 6th-round pick. The rosters page and player page show the trade too.',
      },
    ],
  },
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
