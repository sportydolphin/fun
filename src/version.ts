// Single source of truth for the site version + changelog. The version badge in
// the toolbar reads APP_VERSION; clicking it opens a dialog that renders CHANGELOG.
//
// When shipping a notable change, bump APP_VERSION and add a new entry at the TOP
// of CHANGELOG (newest first). Each change has a `short` one-line summary (only
// the first 4 per version show in the main dialog) and a `full` sentence (shown
// for every change when the reader clicks "View all changes"). Write plainly,
// no em dashes and no marketing voice, just say what changed.

export const APP_VERSION = '1.4.1'

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

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.4.1',
    date:    '2026-07-14',
    title:   'Back button returns you to the exact spot',
    changes: [
      {
        short: 'Back button reopens the window you came from',
        full:  'When you tap a player or team from inside a window on the home page, like a game recap, box score, the report card, or the full schedule, the browser back button now returns you to the home page with that same window reopened, instead of just the bare home page.',
      },
    ],
  },
  {
    version: '1.4.0',
    date:    '2026-07-14',
    title:   'Home feed redesign & scoreboard navigation',
    changes: [
      {
        short: 'Home is now a single scrolling feed',
        full:  'The home page combines your team and around-the-league content into one page instead of two tabs. Your team, players, and predictor sit up top, with standout performances and league features below.',
      },
      {
        short: 'Standout performances redesigned',
        full:  'Standout performances now match the look of the On Fire and Ice Cold cards, slide side to side as you move between players, and have a Box Score button that opens the recap from that game.',
      },
      {
        short: 'Scoreboard skips days with no games',
        full:  'The scoreboard date arrows jump straight to the next or previous day that actually has games and stay within the season. There is a Today button to jump back, and if today has no games it shows the next day that does.',
      },
      {
        short: 'Clearer game dates on your team card',
        full:  'The last game and next game on your team card now show larger, clearer dates, saying Yesterday or Tomorrow when close by and the date otherwise.',
      },
      {
        short: 'Shorter site header',
        full:  'The bar at the top of the site with the site name and search is now shorter, leaving more room for content.',
      },
    ],
  },
  {
    version: '1.3.0',
    date:    '2026-07-13',
    title:   'Team icon colors & fewer standout performances',
    changes: [
      {
        short: 'Team icons redesigned for light and dark mode',
        full:  'Every team logo across the scores, standings, schedule, and visualize now uses colors and logo art tuned for light and dark mode, so low-contrast teams like the Tigers, White Sox, and Giants are easy to spot against the background.',
      },
      {
        short: 'Fixed off-center team logos',
        full:  'Several team logos that sat off-center or too small inside their circle are now properly centered and sized.',
      },
      {
        short: 'Fewer, more recent standout performances',
        full:  'Around the League now shows up to 8 standout performances instead of 20, ordered from the most recent games to the oldest.',
      },
      {
        short: 'Standings show full team names',
        full:  'Standings list each team by name, like "Yankees", instead of the three-letter abbreviation.',
      },
    ],
  },
  {
    version: '1.2.0',
    date:    '2026-07-12',
    title:   'Team rosters, live card redesign & polish',
    changes: [
      {
        short: 'Team pages now show the full roster',
        full:  'Team pages have a new roster section listing every active player with their position, jersey number, and how they bat and throw. Tap any player to open their card.',
      },
      {
        short: 'Redesigned live games in your team card',
        full:  'The live game in your team card now shows a bigger bases diamond, the pitcher and batter with their live stat lines, and a larger score. The Game Center button doubles as the live indicator.',
      },
      {
        short: 'Scores strip scrolls with arrow buttons',
        full:  'The scores strip has arrow buttons on each side. On desktop, hover an arrow to glide through the games. On mobile, tap it to jump ahead a few games.',
      },
      {
        short: 'Standings logos redesigned for light and dark',
        full:  'Team logos in the standings now sit on a team-color ring that reads clearly in both light and dark mode, so every team is easy to pick out.',
      },
      {
        short: 'Cleaner recent searches',
        full:  'Recent searches now match the look of the rest of the search dropdown, show your five most recent, and never repeat a player already listed under Your Team or Trending.',
      },
      {
        short: 'Live scores refresh faster',
        full:  'The live game in your team card now refreshes every ten seconds so the score and situation stay current.',
      },
      {
        short: 'Tidier game info in the team card',
        full:  'The team card drops the repeated date and opponent line above the score, and shows Today, Yesterday, or the date instead.',
      },
      {
        short: 'Fixed a stray player loading on the home page',
        full:  'Fixed a bug where opening the home page could quietly load a random player in the background and add it to your recent searches.',
      },
    ],
  },
  {
    version: '1.1.0',
    date:    '2026-07-10',
    title:   'All-time leaders, standings & card polish',
    changes: [
      {
        short: 'New All-Time leaderboards for career stats',
        full:  'The Stats tab now has a career view showing true all-time leaders in every stat. Tap a stat on a player\'s Career card to jump straight to their all-time rank.',
      },
      {
        short: 'Standings highlight your followed team',
        full:  'Standings now highlight your followed team in both the division and wild card views.',
      },
      {
        short: 'Redesigned wild card race view',
        full:  'The wild card race got a redesign. A filled games-back column shows how far each team sits from the cutoff line, with a clearer divider marking the playoff line.',
      },
      {
        short: 'Pitch counts added to recent games',
        full:  'Pitchers\' recent games now show pitch counts, and the Recent Games table is easier to read.',
      },
      {
        short: 'Retired players show years played in search',
        full:  'Retired players now show the seasons they played (like 2001-2019) in search instead of just "Retired".',
      },
      {
        short: 'Player card season picker polish',
        full:  'The player card season picker got a cleanup: a dedicated Career toggle, prev/next arrows beside the year, a steadier portrait, and a centered name and team header.',
      },
      {
        short: 'Quicker recap/preview buttons on My Team schedule',
        full:  'My Team schedule now has quick Recap and Preview buttons plus a tidier scoreboard-style score row.',
      },
      {
        short: 'Improved trend chart tooltips',
        full:  'Trend chart tooltips now sit above the point with more touch-friendly spacing.',
      },
    ],
  },
  {
    version: '1.0.0',
    date:    '2026-07-09',
    title:   'Initial release',
    changes: [
      {
        short: 'Live scoreboard & Game Center',
        full:  'Live scoreboard with a Game Center for every game, including play-by-play, win probability, live situation, and full box scores.',
      },
      {
        short: 'Player pages with stat cards & trend charts',
        full:  'Player pages with season and career stat cards, trend charts, and league-average context.',
      },
      {
        short: 'Leaderboards, team rankings & standings',
        full:  'Leaderboards, team stat rankings, and standings with a wild card race view.',
      },
      {
        short: 'Follow teams/players & personalized home dashboard',
        full:  'Follow your team and players, get daily prediction bots, and see a personalized home dashboard.',
      },
    ],
  },
]
