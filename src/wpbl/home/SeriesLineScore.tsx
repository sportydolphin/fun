import { Box, Typography } from '@mui/material'
import { SectionCard, AGATE_SX, TYPE_SCALE } from '../../ui/card'
import { hoverOnly, FOCUS_RING } from '../../ui/interaction'
import { TeamMark, DISPLAY_FONT, chromePx } from '../ui'
import { relativeDayShort } from '../constants'
import { useWpblGameLink } from '../LinkContext'
import { VISUALLY_HIDDEN } from '../PageHeading'
import { UNSTYLED_LINK } from '../../nav'
import type { WpblTeam, WpblGame } from '../types'

// THE TITLE SERIES AS ONE LINE SCORE (Nov 6, 2026, the redesign's thirteenth pass), under the
// champion's lead the way a paper runs the box under the game story. It replaced five framed score
// tiles over the lead, which were the last app cards in the first screen, put each game's winner on
// top so the champion jumped between rows, and pushed the headline about 330px down a phone. As a
// grid the two clubs hold their rows, so either club's series reads across, and it fits a 375px
// phone without scrolling.
//
// COLUMNS ARE THE LINKS. Each game is one column (its number, then both scores), and the column is
// the link to that game, so the grid is built as a row of columns rather than a table of rows. Every
// cell is the same height, which is what keeps the three rows level across the columns.

/** One cell's height, shared by every column so the rows line up. rem, since it holds type. */
const CELL_H = '2.25rem'
const HEAD_H = '1.6rem'

/** The columns a loading copy draws: a final goes five at most. */
const PLACEHOLDER_GAMES = 5

const NBSP = ' '

const COLUMN_RULE = { borderLeft: '1px solid', borderLeftColor: 'divider' } as const

function Cell({ children, strong, dim, head, align = 'center' }: {
  children: React.ReactNode; strong?: boolean; dim?: boolean; head?: boolean; align?: 'center' | 'left'
}) {
  return (
    <Box sx={{
      height: head ? HEAD_H : CELL_H, display: 'flex', alignItems: 'center',
      justifyContent: align === 'left' ? 'flex-start' : 'center', minWidth: 0,
      ...(head ? { borderBottom: '1px solid', borderBottomColor: 'divider' } : null),
    }}>
      {head
        ? <Typography noWrap sx={{ ...AGATE_SX, fontSize: TYPE_SCALE.micro, fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{children}</Typography>
        : <Typography sx={{
            fontFamily: DISPLAY_FONT, fontSize: TYPE_SCALE.heading, fontWeight: strong ? 800 : 600, lineHeight: 1,
            fontVariantNumeric: 'tabular-nums', color: dim ? 'text.secondary' : 'text.primary',
          }}>{children}</Typography>}
    </Box>
  )
}

function GameColumn({ game, index, top, bottom, onOpen }: {
  game: WpblGame | null; index: number; top: WpblTeam | null; bottom: WpblTeam | null
  onOpen: (g: WpblGame) => void
}) {
  const gameLink = useWpblGameLink()
  const scoreOf = (t: WpblTeam | null) => !game || !t ? null
    : t.id === game.home_team_id ? game.home_score : t.id === game.away_team_id ? game.away_score : null
  const a = scoreOf(top)
  const b = scoreOf(bottom)
  const decided = a != null && b != null && a !== b
  const label = game && top && bottom && a != null && b != null
    ? `Game ${index + 1}, ${relativeDayShort(game.game_date)}: ${top.abbr} ${a}, ${bottom.abbr} ${b}`
    : undefined
  const body = (
    <>
      <Cell head>G{index + 1}</Cell>
      <Cell strong={decided && a! > b!} dim={decided && a! < b!}>{a ?? NBSP}</Cell>
      <Cell strong={decided && b! > a!} dim={decided && b! < a!}>{b ?? NBSP}</Cell>
    </>
  )
  const sx = { flex: '1 1 0', minWidth: '2.4rem', maxWidth: '9rem', ...COLUMN_RULE } as const
  return game
    ? <Box {...gameLink(game, () => onOpen(game))} aria-label={label} title={relativeDayShort(game.game_date)}
        sx={{ ...UNSTYLED_LINK, ...sx, color: 'text.primary', display: 'block', ...hoverOnly({ bgcolor: 'action.hover' }), ...FOCUS_RING }}>{body}</Box>
    : <Box aria-hidden sx={sx}>{body}</Box>
}

/**
 * The final's games as a line score: the champion on top, the runner-up under it, a column per game
 * and the series total last. `games` empty draws the loading copy at the loaded grid's height.
 */
export function SeriesLineScore({ games, teams, championId, onOpenGame }: {
  /** The title series' games that were played, in order. */
  games: WpblGame[]
  teams: Map<string, WpblTeam>
  /** Top row. Falls back to the first game's away club. */
  championId: string | null
  onOpenGame: (g: WpblGame) => void
}) {
  const first = games[0]
  const ids = first ? [first.away_team_id, first.home_team_id] : []
  const topId = championId && ids.includes(championId) ? championId : ids[0]
  const bottomId = ids.find(id => id !== topId)
  const top = (topId && teams.get(topId)) || null
  const bottom = (bottomId && teams.get(bottomId)) || null

  const winsOf = (t: WpblTeam | null) => !t ? null : games.filter(g => {
    const mine = g.home_team_id === t.id ? g.home_score : g.away_score
    const theirs = g.home_team_id === t.id ? g.away_score : g.home_score
    return mine != null && theirs != null && mine > theirs
  }).length
  const topWins = winsOf(top)
  const bottomWins = winsOf(bottom)

  const columns: (WpblGame | null)[] = games.length > 0 ? games : Array.from({ length: PLACEHOLDER_GAMES }, () => null)

  const clubCell = (t: WpblTeam | null) => (
    <Box sx={{ height: CELL_H, display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
      {t ? <TeamMark team={t} size={22} /> : <Box sx={{ width: chromePx(22), height: chromePx(22), flexShrink: 0 }} />}
      <Typography noWrap sx={{ fontSize: TYPE_SCALE.body, fontWeight: 700 }}>
        {t
          ? <><Box component="span" sx={{ display: { xs: 'inline', sm: 'none' } }}>{t.abbr}</Box>
              <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>{t.city} {t.name}</Box></>
          : NBSP}
      </Typography>
    </Box>
  )

  return (
    <SectionCard title="Championship">
      {top && bottom && topWins != null && bottomWins != null && (
        <Box component="p" sx={VISUALLY_HIDDEN}>
          {top.city} {top.name} {topWins}, {bottom.city} {bottom.name} {bottomWins}.
        </Box>
      )}
      <Box sx={{ display: 'flex', alignItems: 'stretch', borderBottom: '1px solid', borderBottomColor: 'divider' }}>
        {/* The clubs. Read through the summary above and each column's own name. */}
        <Box aria-hidden sx={{ flex: { xs: '0 0 4.25rem', sm: '1 1 13rem' }, minWidth: 0, pr: 1 }}>
          <Box sx={{ height: HEAD_H, borderBottom: '1px solid', borderBottomColor: 'divider' }} />
          {clubCell(top)}
          {clubCell(bottom)}
        </Box>
        {columns.map((g, i) => (
          <GameColumn key={g?.id ?? i} game={g} index={i} top={top} bottom={bottom} onOpen={onOpenGame} />
        ))}
        {/* The series, as a line score's runs column: set off by a heavier rule. */}
        <Box aria-hidden sx={{ flex: '0 0 auto', minWidth: '3.4rem', px: 0.5, borderLeft: '2px solid', borderLeftColor: 'text.primary' }}>
          <Cell head>Series</Cell>
          <Cell strong={topWins != null && bottomWins != null && topWins > bottomWins}>{games.length ? topWins : NBSP}</Cell>
          <Cell strong={topWins != null && bottomWins != null && bottomWins > topWins} dim={topWins != null && bottomWins != null && bottomWins < topWins}>{games.length ? bottomWins : NBSP}</Cell>
        </Box>
      </Box>
    </SectionCard>
  )
}
