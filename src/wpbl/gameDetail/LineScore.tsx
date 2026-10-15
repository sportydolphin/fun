import { useDark } from '../../ui/useDark'
import { Box, Typography } from '@mui/material'
import { wpblAccent, wpblSurface, wpblFullName, playedInnings } from '../constants'
import { usePhoneLayout, TeamBadge, pressable, FOCUS_RING, TAPPABLE } from '../ui'
import type { WpblTeam, WpblGame } from '../types'
import { StatHead, StatCell, scoreTableSx } from './shared'
import { TYPE_SCALE } from '../../ui/card'

// One compact block instead of a tall full-name score header stacked on a separate line
// score that repeated the same teams and totals. The team name/logo lead each row; the R
// column IS the final/running score (large + winner-emphasised), so no vertical space is
// spent restating it. Team column shows the full "City Nickname" on desktop, the nickname
// alone on a phone, and the innings + R/H/E scroll horizontally if they overrun the width.
export function Scoreboard({ away, home, game, awayWon, homeWon, onOpenTeam }: {
  away: WpblTeam; home: WpblTeam; game: WpblGame; awayWon: boolean; homeWon: boolean
  onOpenTeam?: (t: WpblTeam) => void
}) {
  const isMobile = usePhoneLayout()
  const isDark = useDark()
  const decided = awayWon || homeWon
  // playedInnings drops the feed's phantom trailing inning (see innings.ts); the 7-column
  // floor is only about how wide the grid draws for a short or in-progress game.
  const lastInning = playedInnings(game.away_line, game.home_line)
  const innings = Math.max(lastInning, 7)
  const cols = Array.from({ length: innings }, (_, i) => i + 1)
  const runsByInning = (line: WpblGame['away_line'], n: number) =>
    line?.find(c => c.inning === n)?.runs
  // A home team that's already ahead never bats in the bottom of the final inning: the game
  // just ends. The feed still emits a {runs: 0} entry for that half, which would print as a
  // real "0" and imply a scoreless frame that was never played (the away staff's 6.0 IP in a
  // 7-inning game is the giveaway). Print the X a scorebook would. A walk-off takes the other
  // branch: the home team was tied or trailing going in, so it did bat, and its runs stand.
  // `lastInning` above is the inning that actually ended the game, not the 7-column floor,
  // so a shortened game still puts the X in the right column.
  const runsThrough = (line: WpblGame['away_line'], n: number) =>
    (line ?? []).reduce((t, c) => (c.inning <= n ? t + c.runs : t), 0)
  const homeDidNotBatLast = game.status === 'final' && lastInning > 0
    && runsThrough(game.home_line, lastInning - 1) > runsThrough(game.away_line, lastInning)
  const row = (team: WpblTeam, line: WpblGame['away_line'], runs: number | null, hits: number | null | undefined, errs: number | null | undefined, won: boolean, isHome = false) => {
    const accent = wpblAccent(team.id, isDark)
    // THE WINNING ROW IS TINTED IN THE CLUB'S OWN COLOUR, which is what carries the result now
    // that every number in the row is the same size. A line score is twelve numbers and the one
    // a reader came for is the R: making that bigger was one way to say so and this is the
    // quieter one, since the tint marks the whole row rather than competing with the innings
    // beside it. Same surface Home's club bands use, so a reader arriving from the scoreboard
    // meets the colour they tapped.
    return (
      <Box component="tr" sx={{
        borderTop: '1px solid', borderColor: 'divider',
        bgcolor: won ? wpblSurface(team.id, isDark) : 'transparent',
      }}>
        {/* Thin team-color stripe on the winning row; a transparent one on the loser keeps
            both rows aligned. */}
        <Box component="td" sx={{ py: 0.5, pr: 1.5, pl: 1, borderLeft: '3px solid', borderColor: won ? accent : 'transparent' }}>
          {/* The name opens the club. Only the NAME, not the whole cell and certainly not the
              row: the rest of the row is the innings, and a reader dragging that table
              sideways on a phone must not land on a team page for it. */}
          <Box
            {...(onOpenTeam ? pressable(() => onOpenTeam(team)) : {})}
            aria-label={onOpenTeam ? `${wpblFullName(team)} team page` : undefined}
            sx={{
              // `flex` + `fit-content`, NOT `inline-flex`. Both shrink-wrap, which is what
              // keeps the tap target off the rest of the cell, but an inline-level box sits on
              // the row's text baseline: it picks up the line box's descender space and the
              // badge rides high of the cell's centre. A block-level flex box has no baseline
              // to sit on and centres properly.
              display: 'flex', width: 'fit-content', alignItems: 'center', gap: 0.75, minWidth: 0,
              ...(onOpenTeam ? {
                cursor: 'pointer', borderRadius: 1, mx: -0.5, px: 0.5,
                ...TAPPABLE,
                ...FOCUS_RING,
              } : {}),
            }}
          >
            <TeamBadge team={team} size={24} />
            <Typography sx={{ fontSize: isMobile ? TYPE_SCALE.body : TYPE_SCALE.title, fontWeight: won ? 800 : 600, lineHeight: 1.15, whiteSpace: 'nowrap', color: won || !decided ? 'text.primary' : 'text.secondary' }}>
              {isMobile ? team.name : wpblFullName(team)}
            </Typography>
          </Box>
        </Box>
        {/* Empty/scoreless innings sit muted so the innings that actually scored stand out. */}
        {cols.map(n => {
          const skipped = isHome && homeDidNotBatLast && n === lastInning
          const r = skipped ? undefined : runsByInning(line, n)
          return (
            <Box component="td" key={n} sx={{
              fontSize: TYPE_SCALE.title, fontWeight: r ? 800 : 500, lineHeight: 1.2,
              color: r ? 'text.primary' : 'text.disabled',
              textAlign: 'center', px: 0.4, py: 0.45, fontVariantNumeric: 'tabular-nums',
            }}>{skipped ? 'X' : r == null ? '' : r}</Box>
          )
        })}
        <Box component="td" sx={{ width: 8 }} />
        {/* The final (R) carries the winner's team color for a pop that reinforces the result. */}
        <Box component="td" sx={{ textAlign: 'center', px: 0.4, py: 0.5 }}>
          <Typography sx={{ fontSize: TYPE_SCALE.heading, fontWeight: 800, lineHeight: 1.2, fontVariantNumeric: 'tabular-nums', color: won ? accent : !decided ? 'text.primary' : 'text.secondary' }}>{runs ?? 0}</Typography>
        </Box>
        <StatCell>{hits ?? 0}</StatCell>
        <StatCell>{errs ?? 0}</StatCell>
      </Box>
    )
  }
  return (
    <Box sx={{ overflowX: 'auto', px: 2, pt: 1 }}>
      <Box component="table" sx={scoreTableSx}>
        <Box component="thead">
          <Box component="tr">
            <Box component="th" />
            {cols.map(n => <StatHead key={n} w={18}>{n}</StatHead>)}
            <Box component="th" sx={{ width: 8 }} />
            <StatHead w={24}>R</StatHead>
            <StatHead w={22}>H</StatHead>
            <StatHead w={22}>E</StatHead>
          </Box>
        </Box>
        <Box component="tbody">
          {row(away, game.away_line, game.away_score, game.away_hits, game.away_errors, awayWon)}
          {row(home, game.home_line, game.home_score, game.home_hits, game.home_errors, homeWon, true)}
        </Box>
      </Box>
    </Box>
  )
}
