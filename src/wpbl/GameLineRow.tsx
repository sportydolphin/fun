import { Box, Typography } from '@mui/material'
import { PlayerPortrait, TeamBadge, TYPE_SCALE, useWpblName, tappableIf, TAPPABLE } from './ui'
import { useWpblGameLink, useWpblPlayerLink, linkColor } from './LinkContext'
import type { WpblGame, WpblPlayer } from './types'

// One line of a box score, drawn as a row: who, in which game, and the number it is here for.
//
// SHARED BY THE TWO BOARDS THAT RANK SINGLE GAMES, Bests and Find. They ask different questions
// and return the same kind of answer, so drawing that answer twice would mean two rows that look
// alike until one of them gets a fix. The first thing that would drift is the identity rules
// below, which are the section's two standing traps and are easy to get right once.

/** How the game a line came from is labelled: "Aug 12 vs LA", or "8/12 vs LA" when compact. */
export function gameLineLabel(game: WpblGame | null, teamId: string | null, compactDate = false): string | null {
  if (!game) return null
  const date = new Date(`${game.game_date}T00:00:00`).toLocaleDateString([],
    compactDate ? { month: 'numeric', day: 'numeric' } : { month: 'short', day: 'numeric' })
  // Home or away is read off the LINE's own club, which is the club played for that day.
  // Reading it off the roster would put a traded player on the wrong side of "vs".
  const home = teamId != null && game.home_team_id === teamId
  const opp = home ? game.away_team_id : game.home_team_id
  if (!opp) return date
  return `${date} ${home ? 'vs' : 'at'} ${opp}`
}

/**
 * ONE LINK OR TWO, DECIDED BY `nameOpens`.
 *
 * Every other leaderboard in the section uses `LeaderRow`, where the whole row opens the player.
 * In PLAYER mode (Bests) a row about one GAME has two destinations that are both the point of it:
 * the player, and the night. They cannot nest, since an `<a>` inside an `<a>` is silently unpicked
 * by the browser, so the row is a plain container holding two real anchors side by side. Both are
 * therefore crawlable, which an onClick-only control would not be: see the note atop LinkContext.
 *
 * In GAME mode (Find) there is only one destination, the night, so the WHOLE row becomes that one
 * anchor and the name and date are plain text inside it: the tap target is the row rather than two
 * words in it, which is the point of the list. The single anchor stays crawlable for the same
 * reason.
 *
 * BOTH CALLBACKS ARE LOAD-BEARING, and the failure without them is invisible. `build` in
 * LinkContext returns a real `<a href>` whose onClick preventDefaults and then calls the opener,
 * so a link built with no opener renders, highlights, shows its URL in the status bar, and does
 * nothing at all when clicked. Only a modified click still works, which is the one path nobody
 * tests.
 *
 * THE GAME LINK COMES FIRST ON THE SECOND LINE, ahead of the rest of the box-score line, and
 * that ordering is doing a job. The line truncates with an ellipsis on a narrow phone, and
 * whatever sits at the end of it is what disappears: with the detail first, the LINK is what a
 * 375px screen at the Large text setting eats. Put the destination where it survives and let the
 * supporting detail be the part that goes.
 */
export default function GameLineRow({
  rank, name, player, teamId, game, detail, value, unit, accent, divider, onOpenPlayer, onOpenGame,
  nameOpens = 'player', compactDate = false, emphasizeRank = true,
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
  /** Draw the game date numerically ("8/12") rather than "Aug 12", where the row is tight. */
  compactDate?: boolean
  /** Colour the top three ranks in the accent. Off where `rank` is just a list position (Find)
   *  rather than a real standing (Bests), where the accent would assert a ranking that is not one. */
  emphasizeRank?: boolean
}) {
  const shortName = useWpblName(18)
  const playerLink = useWpblPlayerLink()
  const gameLink = useWpblGameLink()
  const label = gameLineLabel(game, teamId, compactDate)
  // In game mode the WHOLE row is the one anchor, so the row carries the link and the inner name
  // and date are plain text: an <a> nested in an <a> is silently unpicked by the browser, and here
  // both destinations are the same game, so there is nothing to keep as a second anchor. In player
  // mode the row is NOT a link (two destinations, the player and the game) and the two stay
  // separate anchors, as the header note explains.
  const rowIsLink = nameOpens === 'game'
  const rowProps = rowIsLink && game ? gameLink(game, onOpenGame) : {}
  const nameProps = rowIsLink ? {} : playerLink(player, onOpenPlayer)
  const gameProps = game ? linkColor(gameLink(game, onOpenGame), accent) : {}
  return (
    <Box {...rowProps} sx={{
      display: 'flex', alignItems: 'center', gap: 1.25, px: 0.5, py: 0.85,
      borderTop: divider ? '1px solid' : 'none', borderColor: 'divider',
      ...(rowIsLink ? { cursor: 'pointer', borderRadius: 1, ...TAPPABLE } : {}),
    }}>
      {rank != null && (
        <Box sx={{
          width: '1.5rem', textAlign: 'center', fontSize: TYPE_SCALE.body, fontWeight: 800,
          color: emphasizeRank && rank <= 3 ? accent : 'text.disabled', flexShrink: 0, fontVariantNumeric: 'tabular-nums',
        }}>{rank}</Box>
      )}
      <PlayerPortrait name={name} teamId={teamId} size={32} />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
          <Typography {...nameProps} sx={{
            fontSize: TYPE_SCALE.body, fontWeight: 600, whiteSpace: 'nowrap',
            overflow: 'hidden', textOverflow: 'ellipsis',
            // Hover only where there is a pointer: a touch browser fires hover on tap and then
            // leaves it there, so a scrolled list keeps whichever row the finger started on lit.
            ...(rowIsLink ? {} : { '@media (hover: hover)': { ...tappableIf(!!player) } }),
          }}>{shortName(name)}</Typography>
          {teamId && <TeamBadge team={{ id: teamId, abbr: teamId }} size={16} />}
        </Box>
        <Typography component="div" sx={{
          fontSize: TYPE_SCALE.meta, color: 'text.secondary',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {label && (
            <Box component="span" {...(rowIsLink ? {} : gameProps)} sx={{
              fontWeight: 700,
              ...(rowIsLink
                ? { color: accent }
                : { '@media (hover: hover)': { '&:hover': { textDecoration: 'underline' } } }),
            }}>{label}</Box>
          )}
          {label && detail ? ' · ' : ''}
          {detail}
        </Typography>
      </Box>
      <Box sx={{ textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
        <Box component="span" sx={{ fontSize: TYPE_SCALE.heading, fontWeight: 800, color: accent }}>
          {value}
        </Box>
        <Box component="span" sx={{ fontSize: TYPE_SCALE.caption, fontWeight: 700, color: 'text.disabled', ml: 0.4 }}>
          {unit}
        </Box>
      </Box>
    </Box>
  )
}
