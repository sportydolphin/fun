// The season page's final standings table. Split out of SeasonPage.tsx.
import { Box, Typography } from '@mui/material'
import { fmtRate } from '../stats'
import { useRowFlip, useRowDividers } from '../rowFlip'
import { wpblFullName } from '../constants'
import { TAPPABLE, FOCUS_RING, CARD_BORDER, TeamBadge } from '../ui'
import type { WpblTeam, WpblStandingRow } from '../types'
import { TYPE_SCALE } from '../../ui/card'
import { isModified } from '../../nav'

// ─── Final standings ───────────────────────────────────────────────────────────────
// The season's last frame, or whichever day the chart below is scrubbed to. Compact on
// purpose: the full Standings tab carries L10, streak and the form strip, and this is the
// record read rather than the live table. Rank 1 is tinted, so a reader who scrubs back watches
// the accent travel to whoever led on that date.

// rank | club | W | L | PCT | (GB) | DIFF. The numeric columns are in rem so they hold their
// width against the reader's text size, which is the box-reserving-type rule from CLAUDE.md.
// GB is dropped on a phone: at 375px the fixed columns crowd the club name down to an initial,
// and PCT plus the record already say where each club sits, so GB is the one to lose. Its cell
// is display:none on xs and the xs template has one fewer track, so the grid stays aligned.
const ST_COLS = '1.25rem minmax(0, 1fr) 1.75rem 1.75rem 2.75rem 2.25rem 2.75rem'
const ST_COLS_XS = '1.1rem minmax(0, 1fr) 1.5rem 1.5rem 2.6rem 2.7rem'

const fmtGb = (gb: number) => (gb === 0 ? '—' : Number.isInteger(gb) ? String(gb) : gb.toFixed(1))
const fmtDiff = (d: number) => (d > 0 ? `+${d}` : d < 0 ? `−${-d}` : '0')

export function FinalStandings({ rows, orderIds, cadence, teamHref, onNavigate }: {
  rows: WpblStandingRow[]
  /** The SETTLED order the flip is keyed on, so a scrub that only moves the figures does not
   *  re-measure. Its identity is stable until a club actually changes places. */
  orderIds: string[]
  /** When playback is driving, how long until the next day lands; the row travel is fit inside it. */
  cadence: number | undefined
  teamHref: (t: WpblTeam) => string; onNavigate: (to: string) => void
}) {
  // Four clubs changing places IS the reading of a scrub, so the rows slide past each other rather
  // than snapping to the new order, the same as the Standings tab. The DOM still reorders (React
  // keys the rows by club), which keeps a screen reader's order honest; the flip only puts the
  // movement back. See rowFlip.ts, and StandingsView for the surface this mirrors.
  const rowRef = useRowFlip(orderIds, cadence)
  // The lines between the clubs, lifted off the rows and drawn as their own layer over them: a
  // border on a row travels with the club standing in it and is painted under the opaque backing a
  // moving row needs, so a reorder would take every divider with it. The rows keep a transparent
  // border for its GEOMETRY and the lines are drawn at the fixed slots. See `useRowDividers`.
  const dividers = useRowDividers(rows.length, '[data-standings-row]')
  return (
    // `position: relative` is load-bearing twice: the divider overlay is placed against it, and it
    // is what each row's `offsetTop` resolves to. See `useRowDividers`.
    <Box sx={{ position: 'relative', borderRadius: 2, border: '1px solid', borderColor: CARD_BORDER, overflow: 'hidden' }} ref={dividers.ref}>
      {/* Column labels. Same grid as the rows, so the numbers sit under their headings. */}
      <Box sx={{
        display: 'grid', gridTemplateColumns: { xs: ST_COLS_XS, sm: ST_COLS }, alignItems: 'center', gap: 1,
        px: 1.25, py: 0.75, borderBottom: '1px solid', borderColor: 'divider',
        fontSize: TYPE_SCALE.micro, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em',
        color: 'text.secondary',
      }}>
        <Box />
        <Box>Club</Box>
        <Box sx={{ textAlign: 'right' }}>W</Box>
        <Box sx={{ textAlign: 'right' }}>L</Box>
        <Box sx={{ textAlign: 'right' }}>PCT</Box>
        <Box sx={{ textAlign: 'right', display: { xs: 'none', sm: 'block' } }}>GB</Box>
        <Box sx={{ textAlign: 'right' }}>DIFF</Box>
      </Box>
      {rows.map((r, i) => {
        const leader = i === 0
        const diff = r.runsFor - r.runsAgainst
        return (
          <Box
            key={r.team.id}
            component="a"
            data-standings-row=""
            ref={rowRef(r.team.id)}
            href={teamHref(r.team)}
            onClick={e => { if (!isModified(e)) { e.preventDefault(); onNavigate(teamHref(r.team)) } }}
            sx={{
              ...FOCUS_RING,
              display: 'grid', gridTemplateColumns: { xs: ST_COLS_XS, sm: ST_COLS }, alignItems: 'center', gap: 1,
              px: 1.25, py: 0.85, textDecoration: 'none', color: 'inherit',
              // Border here for its HEIGHT, drawn by the overlay below. Transparent rather than
              // removed, so the slot keeps the pixel it has always been spaced by and nothing
              // reflows when a club moves. The first row's line is the header's borderBottom.
              borderTop: i === 0 ? 'none' : '1px solid', borderColor: 'transparent',
              bgcolor: leader ? 'var(--wpbl-compare-lead)' : 'transparent',
              fontVariantNumeric: 'tabular-nums',
              // ONLY WHILE MOVING. A row has no background of its own, so two clubs crossing print
              // through each other; this gives the moving pair an opaque page-colored backing and
              // a stacking order for exactly as long as the move lasts. `background.default`, the
              // PAGE's color, because the card has no fill of its own: `background.paper` here
              // would flash a lighter band across the table on every move. The leader keeps its
              // tint, composited over the opaque backing. See rowFlip.ts.
              '&[data-moving]': {
                position: 'relative', bgcolor: 'background.default',
                ...(leader ? { backgroundImage: 'linear-gradient(var(--wpbl-compare-lead), var(--wpbl-compare-lead))' } : {}),
              },
              '&[data-moving="up"]': { zIndex: 2 },
              '&[data-moving="down"]': { zIndex: 1 },
              ...TAPPABLE,
            }}
          >
            <Typography sx={{ fontSize: TYPE_SCALE.body, fontWeight: 800, color: leader ? 'var(--wpbl-accent-fg)' : 'text.disabled' }}>
              {i + 1}
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.9, minWidth: 0 }}>
              {/* The club logo, matching the Standings tab. */}
              <TeamBadge team={r.team} size={22} />
              {/* Full name where it fits, the nickname on a phone: once the fixed numeric columns
                  claim their widths the full name truncates, and the badge already carries the city. */}
              <Typography sx={{ fontSize: TYPE_SCALE.title, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: { xs: 'none', sm: 'block' } }}>
                {wpblFullName(r.team)}
              </Typography>
              <Typography sx={{ fontSize: TYPE_SCALE.title, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: { xs: 'block', sm: 'none' } }}>
                {r.team.name}
              </Typography>
            </Box>
            <Typography sx={{ textAlign: 'right', fontSize: TYPE_SCALE.title, fontWeight: 700 }}>{r.wins}</Typography>
            <Typography sx={{ textAlign: 'right', fontSize: TYPE_SCALE.title, fontWeight: 700 }}>{r.losses}</Typography>
            <Typography sx={{ textAlign: 'right', fontSize: TYPE_SCALE.title, fontWeight: 800 }}>{fmtRate(r.pct)}</Typography>
            <Typography sx={{ textAlign: 'right', fontSize: TYPE_SCALE.title, color: 'text.secondary', display: { xs: 'none', sm: 'block' } }}>{fmtGb(r.gamesBack)}</Typography>
            <Typography sx={{
              textAlign: 'right', fontSize: TYPE_SCALE.title, fontWeight: 700,
              color: diff > 0 ? 'var(--wpbl-pos)' : diff < 0 ? 'var(--wpbl-neg)' : 'text.secondary',
            }}>{fmtDiff(diff)}</Typography>
          </Box>
        )
      })}
      {/* THE DIVIDERS, over the rows rather than on them, so a crossing club passes UNDER the line
          instead of dragging it along. Skip the first slot: the line above row 0 is the header's
          own borderBottom, and drawing one here too would double it. `zIndex` clears the 2 a row
          moving up takes. See `useRowDividers`. */}
      {dividers.tops.map((top, i) => (i === 0 ? null : (
        <Box key={i} aria-hidden sx={{
          position: 'absolute', left: 0, right: 0, top: `${top}px`,
          // Ornament: a hairline reserving room for nothing, so raw px is the unit and it stays one
          // line on every device. See CLAUDE.md.
          height: '1px', bgcolor: 'divider', pointerEvents: 'none', zIndex: 3,
        }} />
      )))}
    </Box>
  )
}
