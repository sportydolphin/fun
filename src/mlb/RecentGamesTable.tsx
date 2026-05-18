import React, { useState } from 'react'
import { Box, Typography, useMediaQuery } from '@mui/material'
import { ACCENT } from './constants'
import { RecentGameEntry } from './types'

const INIT = 5

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
function fmtDate(d: string, compact: boolean) {
  if (!d) return '—'
  const parts = d.split('-').map(Number)
  return compact ? `${parts[1]}/${parts[2]}` : `${MONTHS[parts[1] - 1]} ${parts[2]}`
}

function decision(s: any): string {
  if (!s) return ''
  if (Number(s.wins) > 0) return 'W'
  if (Number(s.losses) > 0) return 'L'
  if (Number(s.saves) > 0) return 'S'
  if (Number(s.holds) > 0) return 'H'
  return ''
}

interface ColDef {
  h: string
  get: (s: any) => any
  color?: (s: any) => string | undefined
}

const HIT_COLS: ColDef[] = [
  { h: 'H-AB', get: s => s ? `${s.hits ?? 0}-${s.atBats ?? 0}` : '—' },
  { h: 'R',    get: s => s?.runs ?? '—' },
  { h: 'HR',   get: s => s?.homeRuns ?? '—',    color: s => Number(s?.homeRuns) > 0 ? ACCENT : undefined },
  { h: 'RBI',  get: s => s?.rbi ?? '—' },
  { h: 'BB',   get: s => s?.baseOnBalls ?? '—' },
  { h: 'K',    get: s => s?.strikeOuts ?? '—' },
  { h: 'SB',   get: s => s?.stolenBases ?? '—', color: s => Number(s?.stolenBases) > 0 ? ACCENT : undefined },
]

const PIT_COLS: ColDef[] = [
  { h: 'Dec', get: decision, color: s => { const d = decision(s); return d === 'W' ? '#22c55e' : d === 'L' ? '#ef4444' : undefined } },
  { h: 'IP',  get: s => s?.inningsPitched ?? '—' },
  { h: 'H',   get: s => s?.hits ?? '—' },
  { h: 'ER',  get: s => s?.earnedRuns ?? '—' },
  { h: 'BB',  get: s => s?.baseOnBalls ?? '—' },
  { h: 'K',   get: s => s?.strikeOuts ?? '—', color: s => Number(s?.strikeOuts) >= 10 ? ACCENT : undefined },
]

function GameSection({ title, entries, cols, dataKey }: {
  title?: string
  entries: RecentGameEntry[]
  cols: ColDef[]
  dataKey: 'hitting' | 'pitching'
}) {
  const [expanded, setExpanded] = useState(false)
  const compact = !useMediaQuery('(min-width: 480px)')
  if (!entries.length) return null
  const shown = expanded ? entries : entries.slice(0, INIT)

  const TH: React.CSSProperties = compact ? {
    padding: '3px 4px 5px',
    fontWeight: 700,
    fontSize: '0.6rem',
    letterSpacing: '0.4px',
    whiteSpace: 'nowrap',
    userSelect: 'none',
  } : {
    padding: '4px 10px 6px',
    fontWeight: 700,
    fontSize: '0.67rem',
    letterSpacing: '0.5px',
    whiteSpace: 'nowrap',
    userSelect: 'none',
  }

  const TD: React.CSSProperties = compact ? {
    padding: '3px 4px',
    fontSize: '0.72rem',
    whiteSpace: 'nowrap',
  } : {
    padding: '5px 10px',
    fontSize: '0.78rem',
    whiteSpace: 'nowrap',
  }

  return (
    <Box>
      {title && (
        <Typography sx={{ fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.4, color: 'text.disabled', mb: 0.75 }}>
          {title}
        </Typography>
      )}
      <Box sx={{
        borderRadius: 1.5, border: '1px solid', borderColor: 'divider',
        ...(compact ? {} : { overflowX: 'auto' }),
      }}>
        <Box component="table" sx={{
          borderCollapse: 'collapse',
          ...(compact
            ? { tableLayout: 'fixed', width: '100%' }
            : { minWidth: 'max-content', width: '100%' }),
        }}>
          {compact && (
            <Box component="colgroup">
              <Box component="col" sx={{ width: '36px' }} />
              <Box component="col" sx={{ width: '42px' }} />
              {cols.map(c => <Box component="col" key={c.h} />)}
            </Box>
          )}
          <Box component="thead">
            <Box component="tr">
              <Box component="th" sx={{ ...TH, textAlign: 'left', pl: compact ? '8px' : '12px', color: 'text.disabled', borderBottom: '1px solid', borderColor: 'divider' }}>
                {compact ? 'Dt' : 'Date'}
              </Box>
              <Box component="th" sx={{ ...TH, textAlign: 'left', color: 'text.disabled', borderBottom: '1px solid', borderColor: 'divider' }}>
                Opp
              </Box>
              {cols.map(c => (
                <Box component="th" key={c.h} sx={{ ...TH, textAlign: 'right', color: 'text.disabled', borderBottom: '1px solid', borderColor: 'divider' }}>
                  {c.h}
                </Box>
              ))}
            </Box>
          </Box>
          <Box component="tbody">
            {shown.map((g, i) => {
              const stat = g[dataKey]
              const notLast = i < shown.length - 1
              return (
                <Box component="tr" key={i}
                  sx={{ '&:hover > td': { bgcolor: 'action.hover' }, transition: 'background 0.1s' }}>
                  <Box component="td" sx={{ ...TD, pl: compact ? '8px' : '12px', textAlign: 'left', color: 'text.secondary', borderBottom: notLast ? '1px solid' : 'none', borderColor: 'divider' }}>
                    {fmtDate(g.date, compact)}
                  </Box>
                  <Box component="td" sx={{ ...TD, textAlign: 'left', borderBottom: notLast ? '1px solid' : 'none', borderColor: 'divider' }}>
                    {compact
                      ? (g.isHome ? g.opponentAbbr : `@${g.opponentAbbr}`)
                      : (
                        <>
                          <Box component="span" sx={{ color: 'text.disabled', fontSize: '0.68rem', mr: '3px' }}>
                            {g.isHome ? 'vs' : '@'}
                          </Box>
                          {g.opponentAbbr}
                        </>
                      )
                    }
                  </Box>
                  {cols.map(c => {
                    const val = c.get(stat)
                    const clr = c.color?.(stat)
                    return (
                      <Box component="td" key={c.h}
                        sx={{ ...TD, textAlign: 'right', fontWeight: clr ? 700 : 500, color: clr ?? 'text.primary', borderBottom: notLast ? '1px solid' : 'none', borderColor: 'divider' }}>
                        {val == null ? '—' : String(val)}
                      </Box>
                    )
                  })}
                </Box>
              )
            })}
          </Box>
        </Box>
      </Box>

      {entries.length > INIT && (
        <Box
          onClick={() => setExpanded(e => !e)}
          sx={{ mt: 1, cursor: 'pointer', fontSize: '0.72rem', fontWeight: 600, color: 'text.disabled', display: 'inline-flex', alignItems: 'center', gap: 0.4, userSelect: 'none', '&:hover': { color: ACCENT }, transition: 'color 0.15s' }}
        >
          {expanded ? '↑ Show less' : `↓ Show all ${entries.length} games`}
        </Box>
      )}
    </Box>
  )
}

export function RecentGamesTable({ games, isPitcher, isTwoWay }: {
  games: RecentGameEntry[]
  isPitcher: boolean
  isTwoWay: boolean
}) {
  const hitGames = games.filter(g => g.hitting != null)
  const pitGames = games.filter(g => g.pitching != null)

  const showHitting = !isPitcher || isTwoWay
  const showPitching = isPitcher || isTwoWay

  if (!hitGames.length && !pitGames.length) return null

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {showHitting && (
        <GameSection
          title={isTwoWay ? 'Hitting' : undefined}
          entries={hitGames}
          cols={HIT_COLS}
          dataKey="hitting"
        />
      )}
      {showPitching && (
        <GameSection
          title={isTwoWay ? 'Pitching' : undefined}
          entries={pitGames}
          cols={PIT_COLS}
          dataKey="pitching"
        />
      )}
    </Box>
  )
}
