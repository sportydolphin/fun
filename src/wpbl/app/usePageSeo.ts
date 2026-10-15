import { useEffect, useMemo } from 'react'
import { wpblFullName } from '../constants'
import type { WpblTeam, WpblPlayer, WpblGame } from '../types'
import {
  wpblPlayerPath,
  wpblGamePath,
  type WpblView,
} from '../routes'
import { wpblGameCard } from '../ogCard'
import { setDynamicSeo, wpblSeasonSeo, WPBL_ROUTES_SEASON } from '../../seo'
import { currentSeason, seasonsOnRecord } from '../season'
import { SEASON_VIEWS } from './snapshot'

/** The page's title and description whenever the path alone cannot say them: a player, a game, or a
 *  tab showing a year other than the one seo.ts is written for. */
export function usePageSeo({ active, detailPlayer, detailGame, players, games, teams, view, awardsOpen,
  pickedSeason, selectedTeam }: {
  active: boolean
  detailPlayer: WpblPlayer | null
  detailGame: WpblGame | null
  players: WpblPlayer[]
  games: WpblGame[]
  teams: WpblTeam[]
  view: WpblView
  awardsOpen: boolean
  pickedSeason: number | null
  selectedTeam: WpblTeam | null
}) {
  // The current season and the reader's pick, resolved the way useWpblSeason resolves them, for the
  // tags below: this component owns the provider, so it cannot read the hook's answer.
  const seasonNow = useMemo(() => currentSeason(games), [games])
  const seasonOptions = useMemo(() => seasonsOnRecord(games), [games])
  const seasonPicked = pickedSeason != null && pickedSeason !== seasonNow && seasonOptions.includes(pickedSeason)
    ? pickedSeason : null

  // A player page is titled with the player's name and a game page with its final score,
  // neither of which ROUTES in seo.ts can know from the path. Register whichever one owns
  // the page, and clear it the moment that modal closes so the tag cannot outlive the page
  // it describes.
  //
  // ONE effect for both, in the same precedence urlFor uses. Two effects each calling
  // setDynamicSeo(null) on the state they do not own would race on every commit: closing a
  // player over a game would leave whichever ran last in charge, and the tags would end up
  // describing the game or nothing depending on render order.
  useEffect(() => {
    if (!active) return
    if (detailPlayer && players.length > 0) {
      const team = teams.find(t => t.id === detailPlayer.team_id)
      const club = team ? wpblFullName(team) : 'the WPBL'
      const yearWord = seasonNow != null ? `${seasonNow} ` : ''
      setDynamicSeo({
        path: wpblPlayerPath(detailPlayer, players),
        seo: {
          title: `${detailPlayer.name} Stats ${yearWord}| WPBL | sportydolphin.fun`,
          description:
            `${detailPlayer.name} of the ${club}: ${yearWord}Women's Pro Baseball League batting and pitching stats, game log, and season splits.`,
        },
      })
      return () => setDynamicSeo(null)
    }
    if (!detailPlayer && detailGame && games.length > 0 && teams.length > 0) {
      // The same wording the edge function serves an unfurler, from the same module, so a
      // crawler that renders the JS and one that only reads the HTML are told the same
      // thing about the same URL.
      const card = wpblGameCard(detailGame, teams)
      setDynamicSeo({
        path: wpblGamePath(detailGame, teams, games),
        seo: { title: card.title, description: card.description },
      })
      return () => setDynamicSeo(null)
    }
    // A tab or a club page that sums a season, titled for the year on screen. Only when that is
    // not the year seo.ts's entries are written for, so a reader on the current season in the
    // year those were written gets exactly the static tags.
    const shown = seasonPicked ?? seasonNow
    if (shown != null && SEASON_VIEWS.has(view) && !awardsOpen && (shown !== WPBL_ROUTES_SEASON || seasonPicked != null)) {
      const path = window.location.pathname.replace(/[/]+$/, '')
      const seo = wpblSeasonSeo(path, shown, shown === seasonNow)
      if (seo) {
        setDynamicSeo({ path, seo })
        return () => setDynamicSeo(null)
      }
    }
    setDynamicSeo(null)
  }, [detailPlayer, detailGame, players, games, teams, active, view, awardsOpen, seasonNow, seasonPicked, selectedTeam])
}
