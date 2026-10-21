import { PlayerPortrait, TeamBadge } from './ui'
import { GameLineFrame, formatGameLineLabel } from '../ui/gameLine'
import { useWpblGameLink, useWpblPlayerLink } from './LinkContext'
import type { WpblGame, WpblPlayer } from './types'

// One box-score line drawn as a row, for WPBL's Bests and Find: the shared frame (src/ui/gameLine.tsx,
// where the reasoning behind its two link modes is written) in WPBL's own parts.
//
// BOTH CALLBACKS ARE LOAD-BEARING, and the failure without them is invisible. `build` in
// LinkContext returns a real `<a href>` whose onClick preventDefaults and then calls the opener,
// so a link built with no opener renders, highlights, shows its URL in the status bar, and does
// nothing at all when clicked. Only a modified click still works, which is the one path nobody
// tests.

/** How the game a line came from is labeled: "Aug 12 vs LA". */
export function gameLineLabel(game: WpblGame | null, teamId: string | null): string | null {
  if (!game) return null
  const home = teamId != null && game.home_team_id === teamId
  return formatGameLineLabel(game.game_date, home, home ? game.away_team_id : game.home_team_id)
}

export default function GameLineRow({
  rank, name, player, teamId, game, detail, value, unit, accent, divider, onOpenPlayer, onOpenGame,
  nameOpens = 'player', emphasizeRank = true,
}: {
  /** The row's place in the list. Omitted draws no number at all. */
  rank?: number
  name: string
  player: WpblPlayer | null
  /** The club played for THAT DAY, off the line. Never the roster's, which means "now". */
  teamId: string | null
  game: WpblGame | null
  /** The rest of the line, so the number has a shape: "5.0 IP, 4 H, 0 R". */
  detail: string
  /** The number this row is here for, already drawn. */
  value: string
  unit: string
  accent: string
  /** A hairline above. Off on the first row of a card. */
  divider: boolean
  onOpenPlayer?: (p: WpblPlayer) => void
  onOpenGame?: (g: WpblGame) => void
  /** What the player's NAME opens. Bests is a records board, so its name opens the player;
   *  Find lists matching GAMES, so there the name (and the row's whole point) opens the night. */
  nameOpens?: 'player' | 'game'
  /** Color the top three ranks in the accent. Off where `rank` is just a list position (Find)
   *  rather than a real standing (Bests), where the accent would assert a ranking that is not one. */
  emphasizeRank?: boolean
}) {
  const playerLink = useWpblPlayerLink()
  const gameLink = useWpblGameLink()
  const link = game ? gameLink(game, onOpenGame) : undefined
  return (
    <GameLineFrame
      rank={rank} emphasizeRank={emphasizeRank} name={name} detail={detail} value={value} unit={unit} divider={divider}
      accent={accent}
      label={gameLineLabel(game, teamId)}
      portrait={<PlayerPortrait name={name} teamId={teamId} size={32} />}
      club={teamId ? <TeamBadge team={{ id: teamId, abbr: teamId }} size={16} /> : undefined}
      rowLink={nameOpens === 'game' ? link : undefined}
      nameLink={player ? playerLink(player, onOpenPlayer) : undefined}
      gameLink={link}
    />
  )
}
