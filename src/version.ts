// Single source of truth for the site version + changelog. The version badge in
// the toolbar reads APP_VERSION; clicking it opens a dialog that renders CHANGELOG.
//
// When shipping a notable change, bump APP_VERSION and add a new entry at the TOP
// of CHANGELOG (newest first). Keep bullet points short and user-facing.

export const APP_VERSION = '1.0.0'

export interface ChangelogEntry {
  version: string
  date:    string        // ISO date (YYYY-MM-DD)
  title?:  string
  changes: string[]
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.0.0',
    date:    '2026-07-09',
    title:   'Initial release',
    changes: [
      'Live scoreboard with a Game Center for every game — play-by-play, win probability, live situation, and full box scores.',
      'Player pages with season and career stat cards, trend charts, and league-average context.',
      'Leaderboards, team stat rankings, and standings with a wild card race view.',
      'Follow your team and players, daily prediction bots, and a personalized home dashboard.',
    ],
  },
]
