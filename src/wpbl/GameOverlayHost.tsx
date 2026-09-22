import { useEffect, useState } from 'react'
import GameDetailModal from './GameDetail'
import { WpblLinkProvider } from './LinkContext'
import { wpblPlayerPath, wpblTeamPath, findWpblGameBySlug } from './routes'
import {
  fetchWpblTeams, fetchWpblSchedule, fetchWpblAllPlayers,
  getCachedWpblTeams, getCachedWpblSchedule, getCachedWpblAllPlayers,
} from './api'
import { navigate } from '../nav'
import type { WpblGame, WpblTeam, WpblPlayer } from './types'

// The game modal, hovering over a STANDALONE page rather than over a WPBL tab.
//
// WHY THIS EXISTS. `/wpbl/season`, `/wpbl/scorigami` and the other standalone pages are sibling
// routes to WpblApp, not tabs inside it, so their game links used to `navigate('/wpbl/games/<slug>')`:
// that unmounts the page the reader was on and mounts WpblApp, which seats Home under the game modal.
// The page they opened the game FROM vanished, replaced by Home. Inside WpblApp opening a game keeps
// the current tab beneath it; this gives the standalone pages the same behaviour, by keeping them
// mounted and drawing the modal on top from the shell. App.tsx owns the history entry (it seats the
// game URL, storing the page beneath it, so Back and Forward rebuild the overlay) and the dismissal;
// this is only the modal plus the context the section's crawlable links need.
//
// DRIVEN BY THE SLUG, and self-fetching, so that App can rebuild it from the URL alone on a Back or
// Forward that lands on a stacked game. Twin of PlayerOverlayHost: every read is app-wide cached and
// seeded synchronously below, so on a reader who reached this from a standalone page (which loaded
// them to draw its own links) the game resolves on the first render with no request and no flash.
export default function WpblGameOverlayHost({ slug, onClose, onOpenPlayerNav }: {
  slug: string
  onClose: () => void
  /** Open a player from Game Center. The shell turns a player URL into a player overlay STACKED on
   *  this game over the same page, so Back returns here rather than routing to WpblApp's Home. */
  onOpenPlayerNav: (to: string) => void
}) {
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

  const game = teams.length > 0 && games.length > 0 ? findWpblGameBySlug(slug, games, teams) : null
  // Nothing to draw until the schedule lands (or if the slug names no game, which the pages that
  // build these links never produce): the shell keeps the page beneath visible, so a blank frame
  // here is just that page, and Back still closes the entry the shell seated.
  if (!game) return null

  // Opening a PLAYER stays an overlay stacked over this game (the shell pushes a player entry on
  // top); opening a TEAM still LEAVES for the Teams tab, a real navigation that fires the popstate
  // App is listening for, so the overlay clears and the shell routes there.
  return (
    <WpblLinkProvider roster={players} schedule={games} teams={teams}>
      <GameDetailModal
        game={game}
        initialTab={null}
        teams={teams}
        games={games}
        onClose={onClose}
        onOpenPlayer={p => onOpenPlayerNav(wpblPlayerPath(p, players))}
        onOpenTeam={t => navigate(wpblTeamPath(t, teams))}
      />
    </WpblLinkProvider>
  )
}
