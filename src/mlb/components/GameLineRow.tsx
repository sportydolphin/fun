import { Box } from '@mui/material'
import { PORTRAIT_PX } from '../../ui/leaders'
import { GameLineFrame, formatGameLineLabel } from '../../ui/gameLine'
import { PlayerHeadshot } from './leaderboards'
import { LogoBubble } from './boxScore'
import { gameLink, playerLink } from '../lib/links'
import { TEAM_ABBR } from '../constants'
import type { MlbLineGame, MlbLinePlayer } from '../seasonLines'

// One box-score line drawn as a row, for MLB's Bests and Find: the shared frame (src/ui/gameLine.tsx,
// where the reasoning behind its two link modes is written) in MLB's own parts, the headshot in its
// club ring, the club's logo, and the section's player and game links.

/** "Jun 12 vs SEA", or "6/12 vs SEA" when compact. Home or away is read off the LINE's club. */
export function mlbGameLineLabel(game: MlbLineGame | null, teamId: string | null, compactDate = false): string | null {
  if (!game) return null
  const home = teamId != null && game.home_team_id === teamId
  return formatGameLineLabel(game.game_date, home, TEAM_ABBR[home ? game.awayId : game.homeId], compactDate)
}

export default function GameLineRow({
  rank, name, player, teamId, game, detail, value, unit, divider, onOpenPlayer, onOpenGame,
  nameOpens = 'player', compactDate = false, emphasizeRank = true,
}: {
  rank?: number
  name: string
  player: MlbLinePlayer | null
  /** The club played for THAT DAY, off the line. */
  teamId: string | null
  game: MlbLineGame | null
  detail: string
  value: string
  unit: string
  divider: boolean
  onOpenPlayer?: (playerId: number) => void
  onOpenGame?: (gamePk: number) => void
  /** Bests is a records board, so the name opens the player; Find lists GAMES, so the whole row
   *  opens the night. */
  nameOpens?: 'player' | 'game'
  compactDate?: boolean
  /** The accent on the top three, where `rank` is a real standing rather than a list position. */
  emphasizeRank?: boolean
}) {
  const club = teamId ? Number(teamId) : 0
  const openGame = game && onOpenGame ? () => onOpenGame(game.gamePk) : undefined
  const link = game ? gameLink(game.gamePk, openGame) : undefined
  return (
    <GameLineFrame
      rank={rank} emphasizeRank={emphasizeRank} name={name} detail={detail} value={value} unit={unit} divider={divider}
      label={mlbGameLineLabel(game, teamId, compactDate)}
      portrait={player
        ? <PlayerHeadshot variant="ring" playerId={player.playerId} name={name} teamId={club || undefined} size={PORTRAIT_PX} />
        : <Box sx={{ width: PORTRAIT_PX, flexShrink: 0 }} />}
      club={club > 0 ? <LogoBubble teamId={club} abbr={TEAM_ABBR[club] ?? ''} size={16} ring={1} /> : undefined}
      rowLink={nameOpens === 'game' ? link : undefined}
      nameLink={player ? playerLink(player.playerId, name, onOpenPlayer) : undefined}
      gameLink={link}
    />
  )
}
