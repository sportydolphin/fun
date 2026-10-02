// A game's title and description, registered while its sheet is up.
//
// The sheet's address is the game's (/mlb/games/<pk>), so it is a page as far as a search engine
// is concerned, and seo.ts can only give it a generic title from the path: the clubs and the score
// arrive with a fetch. Called by both game sheets, Game Center and the preview, so every way of
// opening a game titles it, not only the address.
import { useEffect } from 'react'
import { getDynamicSeo, setDynamicSeo } from '../../seo'
import { mlbClubById, mlbGamePath } from '../routes'

interface SeoSide { teamId: number; abbr: string; runs?: number }

export function useGameSeo(game: {
  gamePk: number
  state?: string
  startMs?: number
  away: SeoSide
  home: SeoSide
  series?: { label: string }
}): string {
  const { gamePk, state, startMs } = game
  const away = mlbClubById(game.away.teamId)?.name ?? game.away.abbr
  const home = mlbClubById(game.home.teamId)?.name ?? game.home.abbr
  const awayRuns = game.away.runs
  const homeRuns = game.home.runs
  const label = game.series?.label

  // A start time StatsAPI has not set sorts as MAX_SAFE_INTEGER (FinalGames.tsx), not a date.
  const date = startMs != null && startMs < 8.64e15
    ? new Date(startMs).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null
  const when = [label, date].filter(Boolean).join(', ')
  const matchup = `${away} at ${home}`
  const final = state === 'final' && awayRuns != null && homeRuns != null
  // Winner first, the way a final score is said out loud.
  const score = final
    ? (awayRuns! > homeRuns! ? `${away} ${awayRuns}, ${home} ${homeRuns}` : `${home} ${homeRuns}, ${away} ${awayRuns}`)
    : null
  const title = score
    ? `${score}${when ? ` (${when})` : ''}: box score | sportydolphin.fun`
    : `${matchup}${when ? `, ${when}` : ''}: ${state === 'live' ? 'live' : 'preview'} | sportydolphin.fun`
  const description = state === 'preview' || state === 'postponed'
    ? `${matchup}${when ? `, ${when}` : ''}: the probable starters, how the two clubs compare, and Game Center once it starts.`
    : `${matchup}${when ? `, ${when}` : ''}: the box score, every play, the line score and the win probability, pitch by pitch.`

  // The sheet's <h1> says what the <title> says, without the site's name (PageHeading.tsx).
  const heading = title.replace(/ \| sportydolphin\.fun$/, '')

  useEffect(() => {
    const path = mlbGamePath(gamePk)
    // Put back whatever the page under the sheet had registered (a player's title), rather than
    // clearing it: the page is still up, and its own effect will not run again to restore it.
    const under = getDynamicSeo()
    setDynamicSeo({ path, seo: { title, description } })
    return () => { if (getDynamicSeo()?.path === path) setDynamicSeo(under?.path === path ? null : under) }
  }, [gamePk, title, description])

  return heading
}
