// Single source of truth for the site version + changelog. The version badge in
// the toolbar reads APP_VERSION; clicking it opens a dialog that renders CHANGELOG.
//
// When shipping a notable change, bump APP_VERSION and add a new entry at the TOP
// of CHANGELOG (newest first). Keep bullet points short and user-facing.

export const APP_VERSION = '1.1.0'

export interface ChangelogEntry {
  version: string
  date:    string        // ISO date (YYYY-MM-DD)
  title?:  string
  changes: string[]
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.1.0',
    date:    '2026-07-10',
    title:   'All-time leaders, standings & card polish',
    changes: [
      'New All-Time leaderboards: the Stats tab now has a career view with the true all-time leaders in every headline stat — and tapping a stat on a player\'s Career card jumps straight to their all-time rank.',
      'Standings now highlight your followed team in both the division and wild card views.',
      'Redesigned wild card race: a filled games-back column shows how far each team sits ahead of or behind the cutoff line, with a clearer playoff divider.',
      'Pitchers\' recent games now show pitch counts, and the Recent Games table is easier to read.',
      'Retired players show the seasons they played (e.g. "2001–2019") in search instead of just "Retired".',
      'Player card polish: a cleaner season picker with a dedicated Career toggle, prev/next-season arrows beside the year, a steadier portrait, and a centered name & team header.',
      'My Team schedule adds quick "Recap →" and "Preview →" buttons and a tidier scoreboard-style score row.',
      'Trend chart tooltips now sit above the point with touch-friendly spacing.',
    ],
  },
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
