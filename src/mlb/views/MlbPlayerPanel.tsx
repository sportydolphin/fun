// A player as the desktop side panel: MLB's card (MlbPlayerDetail) beside the page instead of
// replacing it, so a reader working down a leaderboard, a roster or a box score keeps the list.
//
// The panel's address is the player's own page, which is what a copied link, a reload or Expand
// opens: the panel is how a player is LOOKED AT from a list, the page is the player.
//
// It owns two things the card does not: the history entry (useSheetHistory, which also reads a
// remount for another player as a swap) and the title while it is up, restoring the page's own
// when it goes, as Game Center's does (state/gameSeo.ts).
import { useEffect, useState } from 'react'
import MlbPlayerDetail from './MlbPlayerDetail'
import { useSheetHistory, PANEL_SEASON_KEY } from '../state/sheetHistory'
import { mlbPlayerPath } from '../routes'
import { getDynamicSeo, setDynamicSeo } from '../../seo'
import type { Player } from '../types'
import type { PlayerSeason } from '../state/useMlbState'
import type { Role } from '../playerProfile'

export interface MlbPlayerPanelProps {
  playerId: number
  player: Player | null
  /** Opened from inside Game Center, which is still beneath it: the header gets "‹ Game". */
  stacked: boolean
  /** The address to start on, when reopened on an entry that already has one (playerPanel.ts). */
  path?: string
  /** The season to open on: the one it was showing, when Back reopens it. */
  initialSeason?: PlayerSeason | null
  onClose: () => void
  onExpand: (season: PlayerSeason | null) => void
  onOpenBoard: (statKey: string, group: Role, season: PlayerSeason | null) => void
  onOpenGame: (gamePk: number) => void
  followed: boolean
  onToggleFollow: () => void
}

export function MlbPlayerPanel({ playerId, player, stacked, path, initialSeason = null, onClose, onExpand, onOpenBoard, onOpenGame, followed, onToggleFollow }: MlbPlayerPanelProps) {
  // The address carries the name once it is known; the id alone resolves the same page.
  const [name, setName] = useState<string | null>(player?.fullName ?? null)
  const close = useSheetHistory(onClose, name || !path ? mlbPlayerPath({ id: playerId, fullName: name }) : path, { panel: true })
  // The panel's own season: the page's lives in useMlbState. Written onto the panel's history entry as
  // it changes, so a panel Back reopens (playerPanel.ts) comes back on the season it was showing.
  const [season, setSeasonState] = useState<PlayerSeason | null>(initialSeason)
  const setSeason = (s: PlayerSeason) => {
    setSeasonState(s)
    const st = window.history.state as Record<string, unknown> | null
    if (st?.mlbSheet != null && st.mlbSheetUrl === window.location.pathname) {
      window.history.replaceState({ ...st, [PANEL_SEASON_KEY]: s }, '', window.location.href)
    }
  }

  useEffect(() => {
    if (!name) return
    const seoPath = mlbPlayerPath({ id: playerId, fullName: name })
    const under = getDynamicSeo()
    setDynamicSeo({ path: seoPath, seo: {
      title: `${name} stats, game log and career | sportydolphin.fun`,
      description: `${name}: season and career stats, where they rank in the majors, the game log, career trends and contract.`,
    } })
    return () => { if (getDynamicSeo()?.path === seoPath) setDynamicSeo(under?.path === seoPath ? null : under) }
  }, [playerId, name])

  return (
    <MlbPlayerDetail
      panel
      playerId={playerId}
      player={player}
      season={season}
      onSeasonChange={setSeason}
      onClose={close}
      onBack={stacked ? close : undefined}
      backLabel="Game"
      onExpand={() => onExpand(season)}
      onOpenBoard={(k, g) => onOpenBoard(k, g, season)}
      onOpenGame={onOpenGame}
      onName={setName}
      followed={followed}
      onToggleFollow={onToggleFollow}
    />
  )
}
