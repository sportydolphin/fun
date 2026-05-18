import React, { useState, useEffect } from 'react'
import { Box, Typography } from '@mui/material'
import { ACCENT } from './constants'
import { RecentGameEntry } from './types'

const INIT = 5

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
function fmtDate(d: string) {
  if (!d) return '—'
  const [, m, day] = d.split('-').map(Number)
  return `${MONTHS[m - 1]} ${day}`
}

function decision(s: any): string {
  if (!s) return ''
  if (Number(s.wins)   > 0) return 'W'
  if (Number(s.losses) > 0) return 'L'
  if (Number(s.saves)  > 0) return 'S'
  if (Number(s.holds)  > 0) return 'H'
  return ''
}

const DEC_COLORS: Record<string, string> = {
  W: '#22c55e', L: '#ef4444', S: ACCENT, H: '#f59e0b',
}

function DecBadge({ s }: { s: any }) {
  const d = decision(s)
  if (!d) return <Box component="span" sx={{ color: 'text.disabled' }}>—</Box>
  const c = DEC_COLORS[d]
  return (
    <Box component="span" sx={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: 22, height: 22, borderRadius: '50%',
      bgcolor: `${c}1e`, color: c, fontSize: '0.65rem', fontWeight: 800,
    }}>
      {d}
    </Box>
  )
}

function Dim() {
  return <Box component="span" sx={{ color: 'text.disabled' }}>—</Box>
}

function Num({ v, accent, warn }: { v: any; accent?: boolean; warn?: boolean }) {
  if (v == null) return <Dim />
  return (
    <Box component="span" sx={{
      color: accent ? ACCENT : warn ? '#ef4444' : 'inherit',
      fontWeight: (accent || warn) ? 700 : 400,
    }}>
      {String(v)}
    </Box>
  )
}

interface ColDef {
  h: string
  cell: (s: any) => React.ReactNode
}

const HIT_COLS: ColDef[] = [
  { h: 'H‑AB', cell: s => s ? `${s.hits ?? 0}‑${s.atBats ?? 0}` : <Dim /> },
  { h: 'R',    cell: s => <Num v={s?.runs   ?? null} /> },
  { h: 'HR',   cell: s => <Num v={s?.homeRuns ?? null}  accent={Number(s?.homeRuns) > 0} /> },
  { h: 'RBI',  cell: s => <Num v={s?.rbi ?? null} /> },
  { h: 'BB',   cell: s => <Num v={s?.baseOnBalls ?? null} /> },
  { h: 'K',    cell: s => <Num v={s?.strikeOuts ?? null} /> },
  { h: 'SB',   cell: s => <Num v={s?.stolenBases ?? null} accent={Number(s?.stolenBases) > 0} /> },
]

const PIT_COLS: ColDef[] = [
  { h: 'Dec', cell: s => <DecBadge s={s} /> },
  { h: 'IP',  cell: s => <Num v={s?.inningsPitched ?? null} /> },
  { h: 'H',   cell: s => <Num v={s?.hits ?? null} /> },
  { h: 'ER',  cell: s => <Num v={s?.earnedRuns ?? null}  warn={Number(s?.earnedRuns) >= 4} /> },
  { h: 'BB',  cell: s => <Num v={s?.baseOnBalls ?? null} /> },
  { h: 'K',   cell: s => <Num v={s?.strikeOuts ?? null}  accent={Number(s?.strikeOuts) >= 10} /> },
]

const thSx = {
  py: '7px', px: { xs: '10px', sm: '14px' },
  fontSize: '0.6rem', fontWeight: 700,
  letterSpacing: '0.6px', textTransform: 'uppercase' as const,
  whiteSpace: 'nowrap' as const, userSelect: 'none' as const,
  color: 'text.disabled',
  borderBottom: '1px solid', borderColor: 'divider',
}

const tdSx = {
  py: '7px', px: { xs: '10px', sm: '14px' },
  fontSize: { xs: '0.8rem', sm: '0.82rem' },
  whiteSpace: 'nowrap' as const,
}

function GameSection({ title, entries, cols, dataKey, highlightDate }: {
  title?: string
  entries: RecentGameEntry[]
  cols: ColDef[]
  dataKey: 'hitting' | 'pitching'
  highlightDate?: string
}) {
  const [expanded, setExpanded] = useState(false)

  // Auto-expand when the highlighted game is beyond the fold
  useEffect(() => {
    if (!highlightDate) return
    const idx = entries.findIndex(g => g.date === highlightDate)
    if (idx >= INIT) setExpanded(true)
  }, [highlightDate]) // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll highlighted row into view after it renders
  useEffect(() => {
    if (!highlightDate) return
    const el = document.querySelector(`[data-game-date="${highlightDate}"]`)
    if (el) (el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [highlightDate, expanded])
  if (!entries.length) return null
  const shown = expanded ? entries : entries.slice(0, INIT)
  const hidden = entries.length - INIT

  return (
    <Box>
      {title && (
        <Typography sx={{ fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.4, color: 'text.disabled', mb: 0.75 }}>
          {title}
        </Typography>
      )}

      {/* Scroll wrapper — table stays content-wide, scrolls on small screens */}
      <Box sx={{ width: 'fit-content', maxWidth: '100%', overflowX: 'auto', borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
        <Box component="table" sx={{ borderCollapse: 'collapse', width: 'max-content' }}>

          <Box component="thead" sx={{ position: 'sticky', top: 0, zIndex: 2 }}>
            <Box component="tr" sx={{ bgcolor: 'background.paper' }}>
              <Box component="th" sx={{ ...thSx, textAlign: 'left', pl: { xs: '12px', sm: '16px' } }}>
                Date
              </Box>
              <Box component="th" sx={{ ...thSx, textAlign: 'left' }}>
                Opp
              </Box>
              {cols.map(c => (
                <Box component="th" key={c.h} sx={{ ...thSx, textAlign: 'right' }}>
                  {c.h}
                </Box>
              ))}
            </Box>
          </Box>

          <Box component="tbody">
            {shown.map((g, i) => {
              const stat = g[dataKey]
              const notLast = i < shown.length - 1
              const borderProps = { borderBottom: notLast ? '1px solid' : 'none', borderColor: 'divider' }
              return (
                <Box component="tr" key={i}
                  data-game-date={g.date}
                  sx={{
                    '& > td': g.date === highlightDate ? { bgcolor: `${ACCENT}14` } : {},
                    '&:hover > td': { bgcolor: 'action.hover' },
                    transition: 'background 0.12s',
                  }}>

                  {/* Date */}
                  <Box component="td" sx={{ ...tdSx, ...borderProps, textAlign: 'left', pl: { xs: '12px', sm: '16px' }, color: 'text.secondary',
                    ...(g.date === highlightDate ? { borderLeft: `3px solid ${ACCENT}`, pl: { xs: '9px', sm: '13px' } } : {}) }}>
                    {fmtDate(g.date)}
                  </Box>

                  {/* Opponent */}
                  <Box component="td" sx={{ ...tdSx, ...borderProps, textAlign: 'left', fontWeight: 600 }}>
                    {g.isHome
                      ? g.opponentAbbr
                      : <><Box component="span" sx={{ color: 'text.disabled', fontWeight: 400, mr: '1px' }}>@</Box>{g.opponentAbbr}</>
                    }
                  </Box>

                  {/* Stat cells */}
                  {cols.map(c => (
                    <Box component="td" key={c.h} sx={{ ...tdSx, ...borderProps, textAlign: 'right' }}>
                      {c.cell(stat)}
                    </Box>
                  ))}

                </Box>
              )
            })}
          </Box>

        </Box>
      </Box>

      {entries.length > INIT && (
        <Box
          onClick={() => setExpanded(e => !e)}
          sx={{
            mt: 1.25, cursor: 'pointer', userSelect: 'none',
            fontSize: '0.72rem', fontWeight: 600,
            color: 'text.disabled', display: 'inline-flex', alignItems: 'center', gap: 0.5,
            '&:hover': { color: ACCENT }, transition: 'color 0.15s',
          }}
        >
          {expanded
            ? '↑ Show less'
            : `↓ ${hidden} more game${hidden !== 1 ? 's' : ''}`}
        </Box>
      )}
    </Box>
  )
}

export function RecentGamesTable({ games, isPitcher, isTwoWay, highlightDate }: {
  games: RecentGameEntry[]
  isPitcher: boolean
  isTwoWay: boolean
  highlightDate?: string
}) {
  const hitGames = games.filter(g => g.hitting  != null)
  const pitGames = games.filter(g => g.pitching != null)

  const showHitting  = !isPitcher || isTwoWay
  const showPitching =  isPitcher || isTwoWay

  if (!hitGames.length && !pitGames.length) return null

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {showHitting && (
        <GameSection
          title={isTwoWay ? 'Hitting' : undefined}
          entries={hitGames}
          cols={HIT_COLS}
          dataKey="hitting"
          highlightDate={highlightDate}
        />
      )}
      {showPitching && (
        <GameSection
          title={isTwoWay ? 'Pitching' : undefined}
          entries={pitGames}
          cols={PIT_COLS}
          dataKey="pitching"
          highlightDate={highlightDate}
        />
      )}
    </Box>
  )
}
