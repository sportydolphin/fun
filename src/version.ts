// Single source of truth for the site version + changelog. The version badge in
// the toolbar reads APP_VERSION; clicking it opens a dialog that renders CHANGELOG.
//
// When shipping a notable change, bump APP_VERSION and add a new entry at the TOP
// of CHANGELOG (newest first). Each change has a `short` one-line summary (only
// the first 4 per version show in the main dialog) and a `full` sentence (shown
// for every change when the reader clicks "View all changes"). Write plainly,
// no em dashes and no marketing voice, just say what changed.

export const APP_VERSION = '1.2.0'

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
