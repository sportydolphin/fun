import React, { useEffect, useRef } from 'react'
import { Box, Typography } from '@mui/material'
import { ACCENT, TEAM_BG } from '../constants'
import { CareerStatSplit } from '../types'
import { fmtR } from '../lib/utils'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtAvg(v: any): string {
  const n = Number(v)
  if (!isFinite(n) || isNaN(n) || n === 0) return '—'
  return fmtR(n, 3)
}

function fmtDec(v: any, d = 2): string {
  const n = Number(v)
  if (!isFinite(n) || isNaN(n)) return '—'
  return n.toFixed(d)
}

function Dim() {
  return <Box component="span" sx={{ color: 'text.disabled' }}>—</Box>
}

// ─── Shared table styles ──────────────────────────────────────────────────────

const thSx = {
  py: '7px', px: { xs: '4px', sm: '10px' },
  fontSize: { xs: '0.56rem', sm: '0.6rem' }, fontWeight: 700,
  letterSpacing: '0.4px', textTransform: 'uppercase' as const,
  whiteSpace: 'nowrap' as const, userSelect: 'none' as const,
  color: 'text.disabled',
  borderBottom: '1px solid', borderColor: 'divider',
}

const tdSx = {
  py: '7px', px: { xs: '4px', sm: '10px' },
  fontSize: { xs: '0.75rem', sm: '0.82rem' },
  whiteSpace: 'nowrap' as const,
}

// ─── Generic section ─────────────────────────────────────────────────────────

interface ColDef<T> {
  h: string
  cell: (r: T) => React.ReactNode
}

interface BaseRow {
  season: number
  teamAbbr: string | null
  teamId: number | null
}

function StatSection<T extends BaseRow>({
  title, rows, highlightYear, cols,
}: {
  title?: string
  rows: T[]
  highlightYear: number | null
  cols: ColDef<T>[]
}) {
  const highlightRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!highlightYear) return
    const timer = setTimeout(() => {
      if (highlightRef.current) {
        highlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }
    }, 80)
    return () => clearTimeout(timer)
  }, [highlightYear])

  if (!rows.length) return null

  return (
    <Box>
      {title && (
        <Typography sx={{ fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.4, color: 'text.disabled', mb: 0.75 }}>
          {title}
        </Typography>
      )}

      <Box sx={{ width: '100%', overflowX: 'auto', borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
        <Box component="table" sx={{ borderCollapse: 'collapse', width: '100%' }}>

          <Box component="thead" sx={{ position: 'sticky', top: 0, zIndex: 2 }}>
            <Box component="tr" sx={{ bgcolor: 'background.paper' }}>
              <Box component="th" sx={{ ...thSx, textAlign: 'left', pl: { xs: '8px', sm: '16px' } }}>Year</Box>
              <Box component="th" sx={{ ...thSx, textAlign: 'left' }}>Team</Box>
              {cols.map(c => (
                <Box component="th" key={c.h} sx={{ ...thSx, textAlign: 'right' }}>{c.h}</Box>
              ))}
            </Box>
          </Box>

          <Box component="tbody">
            {rows.map((r, i) => {
              const isHighlighted = r.season === highlightYear
              const notLast = i < rows.length - 1
              const borderProps = { borderBottom: notLast ? '1px solid' : 'none', borderColor: 'divider' }
              const traded = r.teamAbbr?.includes('/') ?? false
              return (
                <Box
                  component="tr"
                  key={r.season}
                  ref={isHighlighted ? (el: HTMLElement | null) => { highlightRef.current = el } : undefined}
                  data-career-year={r.season}
                  sx={{
                    '& > td': isHighlighted ? { bgcolor: `${ACCENT}14` } : {},
                    '&:hover > td': { bgcolor: 'action.hover' },
                    transition: 'background 0.12s',
                  }}
                >
                  {/* Year */}
                  <Box component="td" sx={{
                    ...tdSx, ...borderProps,
                    textAlign: 'left',
                    pl: isHighlighted ? { xs: '5px', sm: '13px' } : { xs: '8px', sm: '16px' },
                    fontWeight: 700,
                    color: isHighlighted ? ACCENT : 'text.primary',
                    borderLeft: isHighlighted ? `3px solid ${ACCENT}` : undefined,
                  }}>
                    {r.season}
                  </Box>

                  {/* Team */}
                  <Box component="td" sx={{ ...tdSx, ...borderProps, textAlign: 'left' }}>
                    {r.teamAbbr ? (
                      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                        {!traded && r.teamId != null && (
                          <Box sx={{
                            width: 6, height: 6, borderRadius: '50%',
                            bgcolor: TEAM_BG[r.teamId] ?? 'grey.500', flexShrink: 0,
                          }} />
                        )}
                        <Typography component="span" sx={{
                          fontSize: '0.78rem', fontWeight: 600,
                          fontStyle: traded ? 'italic' : 'normal',
                          color: 'text.secondary',
                        }}>
                          {r.teamAbbr}
                        </Typography>
                      </Box>
                    ) : <Dim />}
                  </Box>

                  {/* Stat cells */}
                  {cols.map(c => (
                    <Box component="td" key={c.h} sx={{ ...tdSx, ...borderProps, textAlign: 'right' }}>
                      {c.cell(r)}
                    </Box>
                  ))}
                </Box>
              )
            })}
          </Box>

        </Box>
      </Box>
    </Box>
  )
}

// ─── Hitting row ──────────────────────────────────────────────────────────────

interface HitRow extends BaseRow {
  g: string
  avg: string
  hr: string
  rbi: string
  ops: string
  sb: string
}

const HIT_COLS: ColDef<HitRow>[] = [
  { h: 'G',   cell: r => r.g   !== '—' ? r.g   : <Dim /> },
  { h: 'AVG', cell: r => r.avg !== '—' ? r.avg : <Dim /> },
  { h: 'HR',  cell: r => r.hr  !== '—' ? r.hr  : <Dim /> },
  { h: 'RBI', cell: r => r.rbi !== '—' ? r.rbi : <Dim /> },
  { h: 'OPS', cell: r => r.ops !== '—' ? r.ops : <Dim /> },
  { h: 'SB',  cell: r => r.sb  !== '—' ? r.sb  : <Dim /> },
]

// ─── Pitching row ─────────────────────────────────────────────────────────────

interface PitRow extends BaseRow {
  g: string
  wl: string
  era: string
  ip: string
  k: string
  whip: string
}

const PIT_COLS: ColDef<PitRow>[] = [
  { h: 'G',    cell: r => r.g    !== '—' ? r.g    : <Dim /> },
  { h: 'W-L',  cell: r => r.wl   !== '—' ? r.wl   : <Dim /> },
  { h: 'ERA',  cell: r => r.era  !== '—' ? r.era  : <Dim /> },
  { h: 'IP',   cell: r => r.ip   !== '—' ? r.ip   : <Dim /> },
  { h: 'K',    cell: r => r.k    !== '—' ? r.k    : <Dim /> },
  { h: 'WHIP', cell: r => r.whip !== '—' ? r.whip : <Dim /> },
]

// ─── Public component ─────────────────────────────────────────────────────────

export function CareerStatsTable({ splits, isPitcher, isTwoWay, highlightYear }: {
  splits: CareerStatSplit[]
  isPitcher: boolean
  isTwoWay: boolean
  highlightYear: number | null
}) {
  // Most recent season first
  const sorted = [...splits].reverse()

  const showHitting  = !isPitcher || isTwoWay
  const showPitching =  isPitcher || isTwoWay

  const hitRows: HitRow[] = sorted
    .filter(s => s.hitting != null)
    .map(s => {
      const h = s.hitting!
      const w = h.wins   != null ? Number(h.wins)   : null
      const l = h.losses != null ? Number(h.losses) : null
      return {
        season:   s.season,
        teamAbbr: s.teamAbbr,
        teamId:   s.teamId,
        g:   h.gamesPlayed  != null ? String(Number(h.gamesPlayed))  : '—',
        avg: fmtAvg(h.avg),
        hr:  h.homeRuns     != null ? String(Number(h.homeRuns))     : '—',
        rbi: h.rbi          != null ? String(Number(h.rbi))          : '—',
        ops: h.ops          != null && Number(h.ops) !== 0 ? fmtR(Number(h.ops), 3) : '—',
        sb:  h.stolenBases  != null ? String(Number(h.stolenBases))  : '—',
      }
    })

  const pitRows: PitRow[] = sorted
    .filter(s => s.pitching != null)
    .map(s => {
      const p = s.pitching!
      const w = p.wins   != null ? Number(p.wins)   : null
      const l = p.losses != null ? Number(p.losses) : null
      return {
        season:   s.season,
        teamAbbr: s.teamAbbr,
        teamId:   s.teamId,
        g:    p.gamesPlayed  != null ? String(Number(p.gamesPlayed)) : '—',
        wl:   w != null && l != null ? `${w}-${l}` : '—',
        era:  fmtDec(p.era),
        ip:   p.inningsPitched ?? '—',
        k:    p.strikeOuts   != null ? String(Number(p.strikeOuts)) : '—',
        whip: fmtDec(p.whip),
      }
    })

  if (!hitRows.length && !pitRows.length) return null

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {showHitting && hitRows.length > 0 && (
        <StatSection<HitRow>
          title={isTwoWay ? 'Hitting' : undefined}
          rows={hitRows}
          highlightYear={highlightYear}
          cols={HIT_COLS}
        />
      )}
      {showPitching && pitRows.length > 0 && (
        <StatSection<PitRow>
          title={isTwoWay ? 'Pitching' : undefined}
          rows={pitRows}
          highlightYear={highlightYear}
          cols={PIT_COLS}
        />
      )}
    </Box>
  )
}
