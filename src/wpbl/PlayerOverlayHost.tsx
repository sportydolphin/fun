import { useEffect, useState } from 'react'
import PlayerDetailModal from './PlayerDetail'
import { findWpblPlayerBySlug } from './routes'
import {
  fetchWpblTeams, fetchWpblSchedule, fetchWpblAllPlayers,
  getCachedWpblTeams, getCachedWpblSchedule, getCachedWpblAllPlayers,
} from './api'
import type { WpblGame, WpblTeam, WpblPlayer } from './types'

// The player modal, hovering over a STANDALONE page rather than over a WPBL tab.
//
// TWIN OF GameOverlayHost, and it exists for the same reason. `/wpbl/compare`, `/wpbl/players`,
// `/wpbl/league` and `/wpbl/season` are sibling routes to WpblApp, not tabs inside it, so a player
// link on them used to `navigate('/wpbl/players/<slug>')`: that unmounts the page the reader was on
// and mounts WpblApp, which seats Home under the player modal. The page they opened the player FROM
// vanished, replaced by Home. Inside WpblApp opening a player keeps the current tab beneath it; this
// gives the standalone pages the same behaviour, by keeping them mounted and drawing the modal on top
// from the shell. App.tsx owns the history entry (it seats the player URL without a popstate, so its
// own `path` stays the standalone page) and the dismissal; this is only the modal plus its data.
//
// SELF-FETCHES ITS DATA rather than taking it in, unlike GameOverlayHost. A player can be opened
// from four different pages and from inside the game overlay, not all of which hold the roster and
// schedule, so threading the three datasets through every one of them is more coupling than it is
// worth. All three reads are app-wide cached, so on a reader who has been anywhere in the section
// they resolve from memory and add no request; the roster in particular is already warm, because the
// page that carried the link built its href from it.
export default function WpblPlayerOverlayHost({ slug, onClose, onOpenGame }: {
  slug: string
  onClose: () => void
  /** Open a game from the player's log, as an overlay over the same page (the shell decides push
   *  vs replace). The datasets come from here because this host is the only holder that has them. */
  onOpenGame: (game: WpblGame, ctx: { teams: WpblTeam[]; games: WpblGame[] }) => void
}) {
  // All seeded from the cache so the player resolves on the first render with no flash: every page
  // that links a player has already loaded the roster to build the href, and the section loaded
  // teams and the schedule before it, so all three are populated before the overlay opens.
  const [teams, setTeams] = useState<WpblTeam[]>(() => getCachedWpblTeams() ?? [])
  const [games, setGames] = useState<WpblGame[]>(() => getCachedWpblSchedule() ?? [])
  const [players, setPlayers] = useState<WpblPlayer[]>(() => getCachedWpblAllPlayers() ?? [])
  useEffect(() => {
    let cancelled = false
    Promise.all([fetchWpblTeams(), fetchWpblSchedule(), fetchWpblAllPlayers()])
      .then(([t, g, p]) => { if (!cancelled) { setTeams(t); setGames(g); setPlayers(p) } })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const player = players.length > 0 ? findWpblPlayerBySlug(slug, players) : null
  // Nothing to draw until the roster lands (or if the slug names nobody, which the pages that build
  // these links never produce): the shell keeps the page beneath visible, so a blank frame here is
  // just that page, and Back still closes the entry the shell seated.
  if (!player) return null

  return (
    <PlayerDetailModal
      player={player}
      teams={teams}
      games={games}
      players={players}
      onClose={onClose}
      onOpenGame={g => onOpenGame(g, { teams, games })}
    />
  )
}
