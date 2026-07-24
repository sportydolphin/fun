// ─── Contract & team control panel ────────────────────────────────────────────
//
// Shown under the player card. The money is the obvious half; the more useful
// half is *control* — how many seasons the club holds him for, and when he can
// leave. FanGraphs' year rows carry both, and they run past the guaranteed money
// into future arbitration and free agency, so even a minimum-salary rookie with
// no contract to speak of gets a meaningful timeline.
//
// Salary bars are scaled within the player's own deal, not across the league: the
// question this answers is "when does his money land", and a Crochet-vs-league
// scale would flatten every non-star to an invisible sliver.

import React from 'react'
import { Box, Typography, Tooltip } from '@mui/material'
import { PlayerContract, ContractYear } from '../types'
import { useIsDark, defaultBorder } from '../lib/colorUtils'

// One colour per control state. Deliberately not team-coloured: these encode
// contract *status*, and the legend has to mean the same thing on every page.
const KIND_STYLE: Record<ContractYear['kind'], { color: string; label: string }> = {
  guaranteed:   { color: '#22c55e', label: 'Guaranteed' },
  arb:          { color: '#38bdf8', label: 'Arbitration' },
  'pre-arb':    { color: '#818cf8', label: 'Pre-arb' },
  option:       { color: '#eab308', label: 'Option' },
  'free-agent': { color: '#ef4444', label: 'Free agent' },
  other:        { color: '#6b7280', label: 'Other' },
}

/** $170M / $7.7M / $810K — contract figures span five orders of magnitude. */
function money(dollars: number | null | undefined): string {
  if (!dollars || dollars <= 0) return '—'
  if (dollars >= 1_000_000) {
    const m = dollars / 1_000_000
    return `$${m >= 100 ? Math.round(m) : m.toFixed(1).replace(/\.0$/, '')}M`
  }
  return `$${Math.round(dollars / 1000)}K`
}

/** "5.028" → "5y 28d". MLB service time is years.days, not a decimal. */
function serviceTime(raw: string | null): string | null {
  if (!raw) return null
  const [years, days] = raw.split('.')
  if (!years) return null
  return `${Number(years)}y ${Number(days ?? 0)}d`
}

export function ContractPanel({ contract, currentSeason }: {
  contract:      PlayerContract
  currentSeason: number
}) {
  const isDark = useIsDark()
  const years  = contract.years

  // Free-agent rows mark the date rather than a payment, so they'd otherwise set
  // a zero floor that squashes every real bar.
  const paidYears = years.filter(y => y.kind !== 'free-agent')
  const maxSalary = Math.max(...paidYears.map(y => y.salary), 1)

  const remaining = years.filter(y => y.season >= currentSeason && y.kind !== 'free-agent').length
  const st        = serviceTime(contract.serviceTime)

  // Only the kinds actually present — a legend listing states this player can't
  // be in is noise.
  const kindsShown = [...new Set(years.map(y => y.kind))]

  const summaryChip = (label: string, value: string) => (
    <Box key={label} sx={{ minWidth: 0 }}>
      <Typography sx={{
        fontSize: '0.56rem', fontWeight: 800, letterSpacing: 0.8,
        textTransform: 'uppercase', color: 'text.disabled', lineHeight: 1,
      }}>
        {label}
      </Typography>
      <Typography sx={{ fontSize: '0.92rem', fontWeight: 800, mt: 0.35, lineHeight: 1.1 }}>
        {value}
      </Typography>
    </Box>
  )

  return (
    <Box sx={{
      borderRadius: 3, border: '1px solid', borderColor: defaultBorder(isDark),
      bgcolor: 'background.paper', overflow: 'hidden',
    }}>
      {/* Deal summary — FanGraphs' own sentence, which already reads better than
          anything we'd assemble from the parts ("6 yr, $170M (2026-31); can opt
          out after 2030"). */}
      {contract.description && (
        <Box sx={{ px: 2, pt: 1.5, pb: 1.25 }}>
          <Typography sx={{ fontSize: '0.86rem', fontWeight: 700, lineHeight: 1.35 }}>
            {contract.description}
          </Typography>
          {contract.contractType && (
            <Typography sx={{ fontSize: '0.66rem', color: 'text.secondary', mt: 0.35 }}>
              {contract.contractType}
            </Typography>
          )}
        </Box>
      )}

      {/* Headline figures */}
      <Box sx={{
        px: 2, py: 1.25, display: 'flex', gap: 2.5, flexWrap: 'wrap',
        borderTop: contract.description ? '1px solid' : 'none',
        borderBottom: '1px solid', borderColor: 'divider',
      }}>
        {contract.aav ? summaryChip('AAV', money(contract.aav)) : null}
        {contract.totalValue ? summaryChip('Total', money(contract.totalValue)) : null}
        {remaining > 0 ? summaryChip('Yrs left', String(remaining)) : null}
        {st ? summaryChip('Svc time', st) : null}
        {contract.freeAgentSeason
          ? summaryChip('Free agent', String(contract.freeAgentSeason))
          // No FA row means the deal ends on an option, so the market date turns
          // on a decision nobody's made yet. Say that rather than guess a year.
          : years.some(y => y.kind === 'option')
          ? summaryChip('Free agent', 'Option')
          : null}
      </Box>

      {/* Control timeline */}
      {years.length > 0 && (
        <Box sx={{ px: 2, py: 1.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 0.6, minHeight: 76 }}>
            {years.map(y => {
              const style   = KIND_STYLE[y.kind] ?? KIND_STYLE.other
              const isNow   = y.season === currentSeason
              const isPast  = y.season < currentSeason
              // Unpaid future years (arb, FA) get a token stub so the season still
              // reads as part of the timeline instead of vanishing.
              const pct     = y.salary > 0 ? Math.max(8, (y.salary / maxSalary) * 100) : 6
              return (
                <Tooltip
                  key={y.season}
                  title={`${y.season} · ${y.label}${y.salary > 0 ? ` · ${money(y.salary)}` : ''}`}
                  placement="top"
                >
                  <Box sx={{
                    flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column',
                    alignItems: 'center', gap: 0.4, cursor: 'default',
                    opacity: isPast ? 0.42 : 1,       // seasons already paid out recede
                    transition: 'opacity 0.15s',
                  }}>
                    <Typography sx={{
                      fontSize: '0.55rem', fontWeight: 800, lineHeight: 1,
                      color: y.salary > 0 ? 'text.secondary' : 'transparent',
                      whiteSpace: 'nowrap',
                    }}>
                      {money(y.salary)}
                    </Typography>
                    <Box sx={{ width: '100%', height: 46, display: 'flex', alignItems: 'flex-end' }}>
                      <Box sx={{
                        width: '100%', height: `${pct}%`, borderRadius: 0.75,
                        bgcolor: style.color,
                        // Dashed-looking stub for years with no negotiated salary.
                        opacity: y.salary > 0 ? 1 : 0.4,
                        outline: isNow ? `2px solid ${style.color}` : 'none',
                        outlineOffset: 2,
                      }} />
                    </Box>
                    <Typography sx={{
                      fontSize: '0.58rem', lineHeight: 1, whiteSpace: 'nowrap',
                      fontWeight: isNow ? 900 : 600,
                      color: isNow ? 'text.primary' : 'text.disabled',
                    }}>
                      {String(y.season).slice(2)}
                    </Typography>
                  </Box>
                </Tooltip>
              )
            })}
          </Box>

          {/* Legend */}
          <Box sx={{ display: 'flex', gap: 1.25, flexWrap: 'wrap', mt: 1.25 }}>
            {kindsShown.map(kind => {
              const style = KIND_STYLE[kind] ?? KIND_STYLE.other
              return (
                <Box key={kind} sx={{ display: 'flex', alignItems: 'center', gap: 0.4 }}>
                  <Box sx={{ width: 8, height: 8, borderRadius: 0.5, bgcolor: style.color, flexShrink: 0 }} />
                  <Typography sx={{ fontSize: '0.6rem', color: 'text.secondary', fontWeight: 600 }}>
                    {style.label}
                  </Typography>
                </Box>
              )
            })}
          </Box>
        </Box>
      )}

      {/* Provenance. Contract data isn't in StatsAPI like everything else here,
          so it's worth being explicit about where it came from. */}
      <Box sx={{ px: 2, pb: 1.25 }}>
        <Typography sx={{ fontSize: '0.58rem', color: 'text.disabled' }}>
          Contract data via FanGraphs Roster Resource
        </Typography>
      </Box>
    </Box>
  )
}
