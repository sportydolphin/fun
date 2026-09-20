// /wpbl/scorigami: every final score the league has produced, as a grid.
//
// One square per (winning score, losing score). A lit square is a final that has happened; the
// winning score reads down the left axis, the losing score across the top, so the square's position
// IS the score and the grid needs no number printed in it. Tap a lit square to open the first game
// that ended on it. See derive/scorigami.ts for the arithmetic and for why the postseason counts
// here when it counts nowhere else on the section.
//
// A SIBLING PAGE, not a tab: a real path linked from the footer and absent from WPBL_NAV, on the
// same footing as /wpbl/season and /wpbl/league. See WPBL_SCORIGAMI_PAGE in routes.ts. It is a
// durable, backward-looking artifact and a share image, which is exactly what earns its own URL
// rather than a card that scrolls away.
//
// FROM THE SCHEDULE ALONE, both cached app-wide, so on a reader who has been anywhere else on the
// section this resolves from memory and adds no request.
import { useEffect, useMemo, useState } from 'react'
import { Box, Typography, CircularProgress } from '@mui/material'
import { fetchWpblSchedule, fetchWpblTeams } from './api'
import { wpblScorigami, scorigamiKey, type ScorigamiCell } from './derive/scorigami'
import { wpblGamePath } from './routes'
import { TAPPABLE, FOCUS_RING, hoverOnly } from './ui'
import { navBack } from '../nav'
import type { WpblGame, WpblTeam } from './types'

const isModified = (e: React.MouseEvent) =>
  e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0

export default function WpblScorigami({ onOpenGame }: {
  // Opens a game as a modal hovering over this page, rather than navigating to it (which would
  // replace the page with WpblApp's Home). Supplied by the shell; see GameOverlayHost. The cells
  // stay real <a href>s for crawlers, with the plain click intercepted.
  onOpenGame: (g: WpblGame, ctx: { teams: WpblTeam[]; games: WpblGame[] }) => void
}) {
  const [games, setGames] = useState<WpblGame[]>([])
  const [teams, setTeams] = useState<WpblTeam[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    Promise.all([fetchWpblSchedule(), fetchWpblTeams()]).then(([g, t]) => {
      if (cancelled) return
      setGames(g); setTeams(t)
    }).catch(() => { /* the empty state below is the whole error path */ })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const grid = useMemo(() => wpblScorigami(games), [games])
  const teamById = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])

  // The winner and loser of the game a cell links to, by name, for the label and the aria text.
  // A box-score row carries the club it was played for, so this reads the two ids off the game
  // rather than any roster snapshot.
  const cellLabel = (cell: ScorigamiCell): string => {
    const g = cell.first
    const homeWon = (g.home_score ?? 0) > (g.away_score ?? 0)
    const winId = homeWon ? g.home_team_id : g.away_team_id
    const loseId = homeWon ? g.away_team_id : g.home_team_id
    const winName = teamById.get(winId)?.name ?? winId
    const loseName = teamById.get(loseId)?.name ?? loseId
    const more = cell.count > 1 ? ` (+${cell.count - 1} more)` : ''
    return `${winName} ${cell.win}–${cell.lose} ${loseName}, ${g.game_date}${more}`
  }

  const gameHref = (g: WpblGame) => wpblGamePath(g, teams, games)

  if (loading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>
  }

  const hasData = grid.maxWin > 0
  // Columns are losing scores 0..(maxWin-1): a loser cannot out-score the winner, so no column
  // beyond that can ever be lit. Rows are winning scores 1..maxWin, ascending downward, which
  // reads like an ordinary table and widens the lit triangle toward the bottom.
  const losers = Array.from({ length: Math.max(grid.maxWin, 1) }, (_, i) => i) // 0..maxWin-1
  const winners = Array.from({ length: grid.maxWin }, (_, i) => i + 1)         // 1..maxWin

  // The grid is exactly as wide as its data (a label track + one cell per losing score + the
  // gaps between them), which is narrower than the page column, so the intro and footnote were
  // wrapping at 60ch and ending short of the table's right edge. Compute that same width from the
  // grid's own geometry and cap the prose at it, so text and table share one right edge. The label
  // track is pinned (LABEL_COL) rather than `auto` for the same reason: an auto width can't be
  // named here. `min(…, 100%)` keeps it honest on a viewport too narrow for the full grid, where
  // the table scrolls and the text just fills the column.
  const LABEL_COL = '2.25rem'
  const GRID_GAP = 4 // px, matches the grid's own gap below
  const n = losers.length
  const gridWidth = {
    xs: `min(calc(${LABEL_COL} + ${n} * 1.75rem + ${n * GRID_GAP}px), 100%)`,
    sm: `min(calc(${LABEL_COL} + ${n} * 2.1rem + ${n * GRID_GAP}px), 100%)`,
  }

  return (
    <Box sx={{ maxWidth: '56.25rem', mx: 'auto', px: { xs: 2, sm: 3 }, pb: 6 }}>
      <Box
        component="a"
        href="/wpbl"
        onClick={e => { if (!isModified(e)) { e.preventDefault(); navBack('/wpbl') } }}
        sx={{
          textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 0.5, mb: 2,
          color: 'text.secondary', fontSize: '0.85rem', fontWeight: 700,
          px: 1.25, py: 0.6, borderRadius: 999, border: '1px solid', borderColor: 'divider',
          bgcolor: 'background.paper',
          ...hoverOnly({ color: 'text.primary', borderColor: 'text.secondary' }),
        }}
      >&larr; Back to WPBL</Box>

      <Typography component="h1" sx={{ fontSize: '1.5rem', fontWeight: 800, mb: 0.5 }}>
        WPBL Scorigami
      </Typography>
      <Typography sx={{ color: 'text.secondary', fontSize: '0.9rem', mb: 3, maxWidth: gridWidth }}>
        Every final score the Women&rsquo;s Pro Baseball League has produced. The winning score reads
        down the side, the losing score across the top, so each lit square is one score that has
        happened.{' '}
        {hasData
          ? `${grid.cells.size} different final scores across ${grid.totalGames} games so far, and in an inaugural season nearly every one is a first: the grid fills in as the seasons stack.`
          : ''}
      </Typography>

      {!hasData && (
        <Typography sx={{ color: 'text.secondary' }}>
          The grid fills in here once games go final.
        </Typography>
      )}

      {hasData && (
        // A grid can be wider than a phone, so it gets its own horizontal scroll rather than pushing
        // the page body sideways. `--cell` is the square size; the label track is `auto`.
        <Box sx={{ overflowX: 'auto', pb: 1, mx: { xs: -2, sm: 0 }, px: { xs: 2, sm: 0 } }}>
          <Box
            role="group"
            aria-label="Final scores by winning and losing runs. Each square is one score that has happened."
            sx={{
              '--cell': { xs: '1.75rem', sm: '2.1rem' },
              display: 'grid',
              gap: '4px',
              width: 'max-content',
            }}
            // The column count is data, so it is spelled here rather than in the stylesheet:
            // a fixed label track (LABEL_COL, so the prose above can match this width) plus one
            // track per losing score.
            style={{ gridTemplateColumns: `${LABEL_COL} repeat(${losers.length}, var(--cell))` }}
          >
            {/* Corner: the two axes named. Extra bottom padding on the whole header row lifts the
                axis numbers clear of the first cell row, which otherwise sit almost on top of it. */}
            <Box sx={{
              display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end',
              pr: 0.75, pb: 0.75,
            }}>
              <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, color: 'text.disabled', lineHeight: 1 }}>
                W&nbsp;\&nbsp;L
              </Typography>
            </Box>
            {/* Top axis: losing scores. */}
            {losers.map(l => (
              <Box key={`h${l}`} sx={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', pb: 0.75 }}>
                <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, color: 'text.secondary', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                  {l}
                </Typography>
              </Box>
            ))}

            {/* One row per winning score. */}
            {winners.map(w => (
              <Box key={`r${w}`} sx={{ display: 'contents' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', pr: 0.75 }}>
                  <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, color: 'text.secondary', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                    {w}
                  </Typography>
                </Box>
                {losers.map(l => {
                  // A loser cannot equal or beat the winner, so those squares are impossible and
                  // simply are not drawn: an empty grid slot keeps the columns aligned.
                  if (l >= w) return <Box key={`c${w}-${l}`} sx={{ width: 'var(--cell)', height: 'var(--cell)' }} />
                  const cell = grid.cells.get(scorigamiKey(w, l))
                  if (!cell) {
                    // A possible score that has not happened: a faint empty square.
                    return (
                      <Box key={`c${w}-${l}`} sx={{
                        width: 'var(--cell)', height: 'var(--cell)', borderRadius: 0.75,
                        border: '1px solid', borderColor: 'divider', bgcolor: 'transparent',
                      }} />
                    )
                  }
                  const label = cellLabel(cell)
                  const href = gameHref(cell.first)
                  return (
                    <Box
                      key={`c${w}-${l}`}
                      component="a"
                      href={href}
                      title={label}
                      aria-label={label}
                      onClick={e => { if (!isModified(e)) { e.preventDefault(); onOpenGame(cell.first, { teams, games }) } }}
                      sx={{
                        ...FOCUS_RING,
                        width: 'var(--cell)', height: 'var(--cell)', borderRadius: 0.75,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        textDecoration: 'none', color: '#fff', cursor: 'pointer',
                        bgcolor: 'var(--wpbl-accent-solid)',
                        // A repeated score reads a shade brighter and carries its count; a single
                        // occurrence is the plain fill. Most cells are single in the first season.
                        opacity: cell.count > 1 ? 1 : 0.9,
                        ...TAPPABLE,
                        '&:hover': { opacity: 1, transform: 'scale(1.08)' },
                        transition: 'transform 80ms ease, opacity 80ms ease',
                      }}
                    >
                      {cell.count > 1 && (
                        <Typography sx={{ fontSize: '0.62rem', fontWeight: 800, lineHeight: 1, color: '#fff' }}>
                          {cell.count}
                        </Typography>
                      )}
                    </Box>
                  )
                })}
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {hasData && (
        <Typography sx={{ color: 'text.disabled', fontSize: '0.78rem', mt: 2, maxWidth: gridWidth }}>
          Tap any lit square to open the first game that ended on it. A brighter square with a number
          is a score that has come up more than once. Regular season and postseason together: a score
          is a score wherever it happened.
        </Typography>
      )}
    </Box>
  )
}
