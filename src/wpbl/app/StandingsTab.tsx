import { useCallback, useMemo, useState } from 'react'
import { Box, Typography } from '@mui/material'
import { wpblFullName } from '../constants'
import { TeamBadge, CARD_BORDER, tappableIf } from '../ui'
import type { WpblTeam, WpblGame } from '../types'
import { fmtSigned } from '../stats'
import SeasonShapeCard from '../SeasonShapeCard'
import { seasonShape, standingsAt, type SeasonPreview } from '../derive/seasonShape'
import { useRowFlip, useRowDividers } from '../rowFlip'
import { useWpblSeason } from '../SeasonContext'
import { regularSeasonOver } from '../season'
import { localIsoDate } from '../derive/homePlayers'
import { SeasonMenu } from '../SeasonMenu'
import { TabTitle } from '../PageHeading'
import { typePx } from '../../ui/scale'
import { EmptyState } from './Placeholders'
import { TYPE_SCALE } from '../../ui/card'

export function StandingsView({ teams, games: allGames, onOpenTeam }: {
  teams: WpblTeam[]; games: WpblGame[]; onOpenTeam?: (t: WpblTeam) => void
}) {
  // One year's table. The whole schedule is every season the league has played, and standings
  // summed across two of them are a record no club ever had.
  const { season, current, seasonGames: games } = useWpblSeason(allGames)
  const pastSeason = season != null && season !== current
  // The table stops being "current" the day the regular season is played out, not on a date.
  const final = pastSeason || regularSeasonOver(games, localIsoDate())
  // ONE READ OF THE SEASON FOR BOTH SURFACES. The chart under the table is drawn from this, and
  // so is the table: `standingsAt(shape, last)` is `computeStandings(teams, games)` by
  // construction (see derive/seasonShape.ts), so there is no version of this page where the two
  // disagree, and pointing at the chart is just asking this object for a different column.
  const shape = useMemo(() => seasonShape(teams, games), [teams, games])
  const last = shape.columns.length - 1
  // What the reader is pointing at on the chart, in two speeds: see SeasonPreview. Held here
  // rather than in the card because it is the TABLE that changes.
  const [preview, setPreview] = useState<SeasonPreview>({ live: null, settled: null })
  const onPreview = useCallback((view: SeasonPreview) => setPreview(view), [])
  // How long until the next date arrives, when something other than the reader is driving. The
  // rows are animated to fit inside it: a move that outlasts the gap between two reorders can
  // never land, and a table that never lands trails the chart cursor by a growing margin.
  const cadence = preview.cadenceMs

  // THE SORT AND THE FIGURES COME FROM DIFFERENT COLUMNS, which is the whole of this. `order`
  // is the settled day and decides which club is on which line; `figures` is the day under the
  // cursor and fills those lines in. A club's row is therefore its rank on one day and its
  // record on another for as long as the settle lasts, which is the trade SeasonPreview argues
  // for: digits ticking in place are free to read, and re-sorting four rows is not.
  const order = standingsAt(shape, preview.settled ?? last)
  const figures = standingsAt(shape, preview.live ?? last)
  const rows = useMemo(() => {
    if (order === figures) return order
    const byTeam = new Map(figures.map(r => [r.team.id, r]))
    return order.map(r => byTeam.get(r.team.id) ?? r)
  }, [order, figures])
  // Four clubs changing places is the whole reading of a scrub, so the rows travel rather than
  // jump. The DOM still reorders, which is what keeps a screen reader's order true; see
  // rowFlip.ts for why that rules out the cheaper way of doing this.
  // Keyed off the ORDER rather than off `rows`, so the flip is not asked to re-measure on every
  // pointermove: `order` is one of the shape's own frames, so its identity only changes when the
  // settled day does, which is exactly when a row can have moved.
  const rowRef = useRowFlip(useMemo(() => order.map(r => r.team.id), [order]), cadence)
  // The lines between the clubs, lifted off the rows and drawn over them. A border on a row
  // travels with the club standing in it and is painted under the backing a moving row needs,
  // so a reorder took every divider in the table with it. See `useRowDividers`.
  const dividers = useRowDividers(order.length)
  // Labels the FIGURES, because that is what a reader is reading. The sort may still be a
  // fraction of a second behind it.
  // THREE STATES, NOT TWO. The opening column is a real place on the chart and its date is
  // null, so "is there a date" read it as "the reader is not pointing at anything" and labeled
  // four clubs at 0-0 as the current standings. Null here means the present; anything else is
  // the words for the day being shown.
  const asOf = (() => {
    if (preview.live == null || preview.live === last) return null
    const date = shape.columns[preview.live].date
    return date
      ? `As of ${new Date(`${date}T00:00:00`).toLocaleDateString([], { month: 'long', day: 'numeric' })}`
      : 'Before opening day'
  })()
  if (teams.length === 0) {
    return <EmptyState title="No teams" />
  }
  const played = games.some(g => g.status === 'final')
  const clickable = !!onOpenTeam
  // .667 (drop the leading zero); em dash before a team has played.
  const fmtPct = (pct: number, gp: number) => gp === 0 ? '—' : pct.toFixed(3).replace(/^0\./, '.')
  const th = { py: 0.85, px: 0.4, fontSize: TYPE_SCALE.caption, fontWeight: 800, textTransform: 'uppercase' as const, letterSpacing: typePx(0.4), color: 'text.secondary', textAlign: 'right' as const, whiteSpace: 'nowrap' as const }
  const td = { py: 1, px: 0.4, fontSize: TYPE_SCALE.body, textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const, whiteSpace: 'nowrap' as const }
  // The numeric columns, in rem rather than px because `tableLayout: 'fixed'` means these widths
  // are the whole story: a cell wider than its column does not push it out, it spills. In px, PCT
  // and STRK overflow at a 1.5 text scale, which on a tabular-nums figure reads as a rendering
  // fault rather than as text being large. 2.125rem and 2.875rem are 34px and 46px at the default
  // root size.
  const NUM = 2.125, WIDE = 2.875
  const col = (rem: number) => `${rem}rem`
  // Below this the eight columns do not fit, and `tableLayout: 'fixed'` spends the shortfall
  // entirely on the one column without a width: at 320px the club name is left under 5px, so the
  // table renders as a badge and a single letter and three of the four clubs read alike.
  // GB and DIFF go rather than a few pixels off each of the others, because they are the two
  // a reader can rebuild from what is beside them (GB from the W-L columns, the run
  // differential from the team page), and because shaving all seven only moves the clipping
  // to the next text scale.
  //
  // A px threshold, and deliberately above the widest phone rather than at the 371px where
  // it starts to fit: a media query cannot read `--sd-text-scale`, so the one number here has
  // to clear the Large-text case too (every rem in the row is 12.5% wider, which puts the
  // same row back over the edge at 408px). The alternative, a breakpoint that holds only at
  // the default text size, fails silently and only for the readers who most need the setting.
  const FITS_ALL = '@media (min-width:420px)'
  // Applied to both the header cell and the body cell of a dropped column: they are separate
  // elements, and a column hidden in one and not the other shifts every cell after it by one.
  const dropNarrow = { display: 'none', [FITS_ALL]: { display: 'table-cell' } }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
    {/* The page's one <h1>. This is /wpbl/standings, a distinct route with its own title, so
        it gets a heading that names the term someone would search ("WPBL standings"). */}
    <TabTitle>WPBL Standings</TabTitle>
    {/* WHICH DAY THIS TABLE IS. Always drawn, never toggled, and that is the whole design: a
        note that appears when you point at the chart would move the table down 20px under the
        finger doing the pointing, on every scrub, which is worse than the note is good. So the
        line is always there, says "Current standings" at rest, and changes its words and its
        color when the chart is showing an earlier day. A reader who never touches the chart
        reads it once as a statement of fact and never again.

        It also has to be honest by construction rather than by care: `asOf` is null whenever
        the table is showing the last column, so the two cannot disagree about whether this is
        today's table. */}
    {/* Pulled DOWN to the table, not up to the heading: this line is the table's caption, so
        the column `gap` belongs above it (under the h1) and not below it. `mb` eats half the
        gap to the table; on a phone the h1 is hidden, so this is the first thing drawn and the
        column gap above it is simply gone. */}
    <SeasonMenu label="season" sx={{ mb: -0.5 }} />
    <Typography aria-live="polite" sx={{
      mb: -1.25, fontSize: TYPE_SCALE.meta, fontWeight: asOf ? 800 : 600, textAlign: 'left',
      // Weight, not the site blue, marks a past date: blue on this site means a link.
      color: asOf ? 'text.primary' : 'text.disabled',
      fontVariantNumeric: 'tabular-nums',
    }}>
      {asOf ?? (pastSeason ? `Final ${season} standings` : final ? 'Final standings' : 'Current standings')}
    </Typography>
    {/* `position: relative` is load-bearing twice over: it is what the divider overlay is
        placed against, and it is what makes the rows' `offsetTop` resolve to this box rather
        than to the page. See `useRowDividers`. */}
    <Box ref={dividers.ref} sx={{ position: 'relative', border: '1px solid', borderColor: CARD_BORDER, borderRadius: 2, overflow: 'hidden' }}>
      <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        <Box component="thead">
          <Box component="tr" sx={{ bgcolor: 'action.hover' }}>
            <Box component="th" sx={{ ...th, textAlign: 'left', pl: 1.25 }}>Team</Box>
            <Box component="th" sx={{ ...th, width: col(NUM) }}>W</Box>
            <Box component="th" sx={{ ...th, width: col(NUM) }}>L</Box>
            <Box component="th" sx={{ ...th, width: col(WIDE) }}>PCT</Box>
            <Box component="th" sx={{ ...th, width: col(NUM), ...dropNarrow }}>GB</Box>
            <Box component="th" sx={{ ...th, width: col(WIDE), ...dropNarrow }}>DIFF</Box>
            <Box component="th" sx={{ ...th, width: col(WIDE), display: { xs: 'none', sm: 'table-cell' } }}>L10</Box>
            <Box component="th" sx={{ ...th, width: col(NUM + 0.5), pr: 1.25 }}>STRK</Box>
          </Box>
        </Box>
        <Box component="tbody">
          {rows.map(r => {
            const gp = r.wins + r.losses
            const l10 = r.lastTen
            const l10Color = l10.wins > l10.losses ? 'var(--wpbl-pos)' : l10.wins < l10.losses ? 'var(--wpbl-neg)' : 'text.secondary'
            return (
              <Box component="tr" key={r.team.id} ref={rowRef(r.team.id)}
                onClick={clickable ? () => onOpenTeam!(r.team) : undefined}
                sx={{
                  // THE BORDER IS HERE FOR ITS HEIGHT, AND IS DRAWN BY THE OVERLAY BELOW.
                  // Painted transparent rather than removed, so the row keeps the pixel the
                  // slots have always been spaced by and nothing above this reflows.
                  borderTop: '1px solid', borderColor: 'transparent',
                  cursor: clickable ? 'pointer' : 'default', ...tappableIf(clickable),
                  // ONLY WHILE IT IS MOVING. A row has no background of its own, so two clubs
                  // swapping print through each other at the crossing; this gives the pair an
                  // opaque page-colored backing and a stacking order for exactly as long as
                  // the move lasts. `background.default` and not a hardcoded color because it
                  // has to be the page's own, in both themes. See rowFlip.ts.
                  '&[data-moving]': { position: 'relative', bgcolor: 'background.default' },
                  '&[data-moving="up"]': { zIndex: 2 },
                  '&[data-moving="down"]': { zIndex: 1 },
                }}>
                <Box component="td" sx={{ ...td, textAlign: 'left', pl: 1.25 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                    <TeamBadge team={r.team} size={24} />
                    {/* Full name would truncate on mobile once the numeric columns claim their
                        fixed widths, so fall back to the nickname there (the badge carries the city). */}
                    <Typography sx={{ fontSize: TYPE_SCALE.body, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: { xs: 'none', sm: 'block' } }}>{wpblFullName(r.team)}</Typography>
                    <Typography sx={{ fontSize: TYPE_SCALE.body, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: { xs: 'block', sm: 'none' } }}>{r.team.name}</Typography>
                  </Box>
                </Box>
                <Box component="td" sx={{ ...td, fontWeight: 700 }}>{r.wins}</Box>
                <Box component="td" sx={{ ...td, fontWeight: 700 }}>{r.losses}</Box>
                <Box component="td" sx={td}>{fmtPct(r.pct, gp)}</Box>
                <Box component="td" sx={{ ...td, color: 'text.secondary', ...dropNarrow }}>{r.gamesBack === 0 ? '—' : r.gamesBack.toFixed(1)}</Box>
                {(() => {
                  const diff = r.runsFor - r.runsAgainst
                  const diffColor = gp === 0 ? 'text.disabled' : diff > 0 ? 'var(--wpbl-pos)' : diff < 0 ? 'var(--wpbl-neg)' : 'text.secondary'
                  return <Box component="td" sx={{ ...td, color: diffColor, fontWeight: 600, ...dropNarrow }}>{gp === 0 ? '—' : fmtSigned(diff)}</Box>
                })()}
                <Box component="td" sx={{ ...td, display: { xs: 'none', sm: 'table-cell' }, color: gp === 0 ? 'text.disabled' : l10Color, fontWeight: 600 }}>
                  {gp === 0 ? '—' : `${l10.wins}–${l10.losses}`}
                </Box>
                <Box component="td" sx={{ ...td, pr: 1.25, fontWeight: 700, color: r.streak ? (r.streak.type === 'W' ? 'var(--wpbl-pos)' : 'var(--wpbl-neg)') : 'text.disabled' }}>
                  {r.streak ? `${r.streak.type}${r.streak.count}` : '—'}
                </Box>
              </Box>
            )
          })}
        </Box>
      </Box>
      {!played && (
        <Box sx={{ px: 1.5, py: 1, borderTop: '1px solid', borderColor: 'divider' }}>
          <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.disabled' }}>No games</Typography>
        </Box>
      )}
      {/* THE DIVIDERS, over the rows rather than on them. One line at the top of each slot, so
          the top one doubles as the rule under the header, where a row's own border would be.
          `zIndex` has to clear the 2 a row moving UP takes, or the lines go back under the
          thing they exist to survive. */}
      {dividers.tops.map((top, i) => (
        <Box key={i} aria-hidden sx={{
          position: 'absolute', left: 0, right: 0, top: `${top}px`,
          // Ornament: a hairline, carrying no type and reserving room for none, so raw px is
          // the unit and it stays one line on every device. See CLAUDE.md.
          height: '1px', bgcolor: 'divider', pointerEvents: 'none', zIndex: 3,
        }} />
      ))}
    </Box>
      {/* The season the table above is the last frame of. Under it rather than over it: the
          table is what somebody came to /wpbl/standings for, and a chart above it would make
          them scroll to reach the thing they asked for. It renders nothing until a game has
          been played, so it cannot be an empty box on opening day. */}
      <SeasonShapeCard shape={shape} final={final} onPreview={onPreview} page="standings" />

      {/* NO SEEDING CARD once the regular season is over. It existed to say what the
          remaining games were FOR, since all four clubs qualify and the order was the whole
          stake; with the order settled it answers a question nobody has, and the bracket on
          Home carries the postseason with the pairings drawn. `seedingRace` itself stays and
          is load-bearing: derive/bracket.ts builds the whole bracket out of it. */}
    </Box>
  )
}
