// The season page's biggest plays, most improbable win and wildest games, off the win-probability model.
// Split out of SeasonPage.tsx.
import { winProbModel, gameWinProb, swingOfGame, wildestGames, type WildGame } from '../derive/winProbability'
import type { WpblGame, WpblRunValuePlay } from '../types'

// ─── Biggest plays / most improbable win ─────────────────────────────────────────

interface BigPlay {
  game: WpblGame
  narrative: string
  /** Win probability for the eventual winner, before and after the play. */
  winnerBefore: number
  winnerAfter: number
  teamId: string | null
}

interface Comeback {
  game: WpblGame
  /** The lowest win probability the eventual winner held at any point. */
  low: number
  winnerId: string
}

/** The eventual winner's win probability at a point, from the home-side number the model stores. */
export const winnerProb = (homeSide: number, homeWon: boolean) => (homeWon ? homeSide : 1 - homeSide)

/** Six, as the turning plays: enough to reach past the obvious two or three, few enough to read. */
const WILD_N = 6

/** Biggest plays and the most improbable win, both a walk of the same per-game win-probability
 *  model. Empty until the plays are in. */
export function seasonMoments(plays: WpblRunValuePlay[], games: WpblGame[], regFinals: WpblGame[]): {
  bigPlays: BigPlay[]; comeback: Comeback | null; wildest: WildGame<WpblGame>[]
} {
  if (plays.length === 0 || regFinals.length === 0) return { bigPlays: [] as BigPlay[], comeback: null as Comeback | null, wildest: [] as WildGame<WpblGame>[] }
  const model = winProbModel(plays, games)
  // The postseason is in this one, unlike every total on the page: it ranks games, not a season,
  // and the final is exactly where a reader would look for the wildest of them.
  const wildest = wildestGames(model, plays, games.filter(g => g.status === 'final')).slice(0, WILD_N)
  const byGame = new Map<string, WpblRunValuePlay[]>()
  for (const p of plays) {
    const arr = byGame.get(p.game_id) ?? []
    arr.push(p); byGame.set(p.game_id, arr)
  }
  const big: BigPlay[] = []
  let best: Comeback | null = null
  for (const g of regFinals) {
    const gp = byGame.get(g.id)
    if (!gp || gp.length === 0) continue
    if (g.home_score == null || g.away_score == null || g.home_score === g.away_score) continue
    const homeWon = g.home_score > g.away_score
    const wp = gameWinProb(model, gp, g)

    // One play per game, the one it turned on. swingOfGame prefers the decisive play (largest
    // swing toward the winner) over the merely most volatile one, which is the same choice
    // Game Center's badge makes; ranking one per game keeps a single blowout from filling the
    // whole list with its own at-bats.
    const swing = swingOfGame(wp, g.status)
    if (swing) {
      big.push({
        game: g,
        narrative: swing.point.play.narrative ?? 'Big play',
        winnerBefore: winnerProb(swing.point.before, homeWon),
        winnerAfter: winnerProb(swing.point.after, homeWon),
        teamId: swing.point.play.team_id ?? null,
      })
    }

    // The lowest the eventual winner ever sat. A wire-to-wire winner never drops far below
    // 0.5; a comeback does, and the deepest one across the season is the most improbable win.
    let low = 1
    for (const pt of wp.points) low = Math.min(low, winnerProb(pt.before, homeWon))
    if (low < 0.5 && (!best || low < best.low)) {
      best = { game: g, low, winnerId: homeWon ? g.home_team_id : g.away_team_id }
    }
  }
  // Sort the plays by how far they moved the winner, and keep a handful.
  big.sort((a, b) => (b.winnerAfter - b.winnerBefore) - (a.winnerAfter - a.winnerBefore))
  return { bigPlays: big.slice(0, 6), comeback: best, wildest }
}
