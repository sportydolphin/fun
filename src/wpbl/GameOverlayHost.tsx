import { useEffect, useState } from 'react'
import GameDetailModal from './GameDetail'
import { WpblLinkProvider } from './LinkContext'
import { wpblPlayerPath, wpblTeamPath } from './routes'
import { fetchWpblAllPlayers } from './api'
import { navigate } from '../nav'
import type { WpblGame, WpblTeam, WpblPlayer } from './types'

// The game modal, hovering over a STANDALONE page rather than over a WPBL tab.
//
// WHY THIS EXISTS. `/wpbl/season` and `/wpbl/scorigami` are sibling routes to WpblApp, not tabs
// inside it, so their game links used to `navigate('/wpbl/games/<slug>')`: that unmounts the
// page the reader was on and mounts WpblApp, which seats Home under the game modal. The page
// they opened the game FROM vanished, replaced by Home. Inside WpblApp opening a game keeps the
// current tab beneath it; this is what gives the standalone pages the same behaviour, by keeping
// them mounted and drawing the modal on top from the shell. App.tsx owns the history entry (it
// pushes the game URL without a popstate, so its own `path` stays the standalone page) and the
// dismissal (any history move clears the overlay); this component is only the modal plus the
// context the section's crawlable links need.
export default function WpblGameOverlayHost({ game, teams, games, onClose, onOpenPlayerNav }: {
  game: WpblGame
  teams: WpblTeam[]
  games: WpblGame[]
  onClose: () => void
  /** Open a player from Game Center. The shell turns a player URL into a player overlay OVER the
   *  same standalone page (replacing this game overlay), rather than routing to WpblApp's Home,
   *  which is what a plain `navigate` to the player path used to do here. */
  onOpenPlayerNav: (to: string) => void
}) {
  // The full roster, only so a player name inside Game Center can build a real /wpbl/players/<slug>
  // link. Cached app-wide by the api layer, so on a reader who has been anywhere else in the
  // section this resolves from memory and adds no request. Empty until it lands: a player tapped
  // in that window falls through to the roster the modal itself holds via the link fallback.
  const [players, setPlayers] = useState<WpblPlayer[]>([])
  useEffect(() => { fetchWpblAllPlayers().then(setPlayers).catch(() => {}) }, [])

  // Opening a PLAYER stays an overlay over the same page (the shell swaps this game overlay for a
  // player one); opening a TEAM still LEAVES for the Teams tab, a real navigation that fires the
  // popstate App is listening for, so the overlay clears and the shell routes there. `navigate`
  // keeps the address bar and Back honest the same way every other in-app link does.
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
