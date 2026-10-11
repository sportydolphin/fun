import { Box, Typography } from '@mui/material'
import { TYPE_SCALE } from '../../ui/card'
import { TAPPABLE } from '../../ui/interaction'
import { PORTRAIT_PX } from '../../ui/leaders'
import { nameAtStage, useLineNameFit } from '../../ui/names'
import { PlayerHeadshot } from './leaderboards'
import { LogoBubble } from './boxScore'
import { gameLink, playerLink, LINK_SX } from '../lib/links'
import { TEAM_ABBR } from '../constants'
import type { MlbLineGame, MlbLinePlayer } from '../seasonLines'

// One box-score line drawn as a row, for MLB's Bests and Find: who, in which game, and the number
// it is here for. WPBL's GameLineRow in MLB's own parts (the headshot in its club ring, the club's
// logo, the section's player and game links), the way the leader cards share a frame and keep each
// section's row contents (src/ui/leaders.tsx). The reasoning behind its two link modes, and why the
// game's label leads the second line, is written on WPBL's (src/wpbl/GameLineRow.tsx).

/** "Jun 12 vs SEA", or "6/12 vs SEA" when compact. Home or away is read off the LINE's club, the
 *  club played for that day: the roster's would put a traded player on the wrong side of "vs". */
export function mlbGameLineLabel(game: MlbLineGame | null, teamId: string | null, compactDate = false): string | null {
  if (!game) return null
  const date = new Date(`${game.game_date}T00:00:00`).toLocaleDateString([],
    compactDate ? { month: 'numeric', day: 'numeric' } : { month: 'short', day: 'numeric' })
  const home = teamId != null && game.home_team_id === teamId
  const opp = home ? game.awayId : game.homeId
  return `${date} ${home ? 'vs' : 'at'} ${TEAM_ABBR[opp] ?? ''}`.trim()
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
  const label = mlbGameLineLabel(game, teamId, compactDate)
  // "F. Last" before an ellipsis, measured against the room the row actually has (CLAUDE.md).
  const fit = useLineNameFit<HTMLElement>([name])
  const club = teamId ? Number(teamId) : 0
  const openGame = game && onOpenGame ? () => onOpenGame(game.gamePk) : undefined
  const rowIsLink = nameOpens === 'game'
  const rowProps = rowIsLink && game ? gameLink(game.gamePk, openGame) : {}
  const nameProps = rowIsLink || !player ? {} : playerLink(player.playerId, name, onOpenPlayer)
  const gameProps = !rowIsLink && game ? gameLink(game.gamePk, openGame) : {}
  return (
    <Box {...rowProps} sx={{
      ...LINK_SX,
      display: 'flex', alignItems: 'center', gap: 1.25, px: 0.5, py: 0.85,
      borderTop: divider ? '1px solid' : 'none', borderColor: 'divider',
      ...(rowIsLink ? { cursor: 'pointer', borderRadius: 1, ...TAPPABLE } : {}),
    }}>
      {rank != null && (
        <Box sx={{
          width: '1.5rem', textAlign: 'center', fontSize: TYPE_SCALE.body, fontWeight: 800, flexShrink: 0,
          color: emphasizeRank && rank <= 3 ? 'var(--wpbl-accent-fg)' : 'text.disabled', fontVariantNumeric: 'tabular-nums',
        }}>{rank}</Box>
      )}
      {player
        ? <PlayerHeadshot variant="ring" playerId={player.playerId} name={name} teamId={club || undefined} size={PORTRAIT_PX} />
        : <Box sx={{ width: PORTRAIT_PX, flexShrink: 0 }} />}
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
          <Typography ref={fit.ref} {...nameProps} sx={{
            ...LINK_SX, minWidth: 0, fontSize: TYPE_SCALE.body, fontWeight: 600, whiteSpace: 'nowrap',
            overflow: 'hidden', textOverflow: 'ellipsis',
            ...(rowIsLink || !player ? {} : { '@media (hover: hover)': { '&:hover': { textDecoration: 'underline' } } }),
          }}>{nameAtStage(name, fit.stage)}</Typography>
          {club > 0 && <LogoBubble teamId={club} abbr={TEAM_ABBR[club] ?? ''} size={16} ring={1} />}
        </Box>
        <Typography component="div" sx={{
          fontSize: TYPE_SCALE.meta, color: 'text.secondary',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {label && (
            <Box component="span" {...gameProps} sx={{
              ...LINK_SX, fontWeight: 700, color: 'var(--wpbl-accent-fg)',
              ...(rowIsLink ? {} : { '@media (hover: hover)': { '&:hover': { textDecoration: 'underline' } } }),
            }}>{label}</Box>
          )}
          {label && detail ? ' · ' : ''}
          {detail}
        </Typography>
      </Box>
      <Box sx={{ textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
        <Box component="span" sx={{ fontSize: TYPE_SCALE.heading, fontWeight: 800, color: 'var(--wpbl-accent-fg)' }}>
          {value}
        </Box>
        <Box component="span" sx={{ fontSize: TYPE_SCALE.caption, fontWeight: 700, color: 'text.disabled', ml: 0.4 }}>
          {unit}
        </Box>
      </Box>
    </Box>
  )
}
