// Runs by inning: a heatmap of when each club scores, and when it gives them up.
//
// One row per club and one for the league, one column per inning, and each square is runs per
// half-inning batted. See derive/runsByInning.ts for why that denominator and not games.
//
// IT IS A REAL <table>, not a grid of colored boxes. The numbers are printed in every square and the
// clubs and innings are row and column headers, so a screen reader walks it as the table it is and
// nobody needs the color to read a value. The color is for seeing the SHAPE: which clubs come out
// swinging, which ones fade.
//
// DIVERGING AROUND THE LEAGUE AVERAGE, NOT A RAMP FROM ZERO. This league averages over a run a
// half-inning and almost no square sits near zero, so a zero-based ramp spends most of its range
// where no square is and every square comes out a similar shade. Centring on the league's own
// half-inning (`mean`) and stretching each arm to the furthest club square (`spread`) spends the
// whole scale on the differences. Red is more runs than the league average, blue fewer, grey about
// average, and the meaning is the same on Scored and Allowed: it is always a statement about runs,
// never about whether that was good. Blue and red with a grey midpoint because that pair stays
// apart for color-blind readers and the grey reads as "nothing", which a hue in the middle would not.
import { useMemo, useState } from 'react'
import { track, EVENTS } from '../lib/analytics'
import { Box, Typography, useTheme } from '@mui/material'
import {
  runsByInning, perHalf, leagueExtremes, EXTRAS_COLUMN,
  type InningCell, type RunsByInningRow, type RunsScope,
} from './derive/runsByInning'
import { TeamBadge, FOCUS_RING, pressable } from './ui'
import type { WpblGame, WpblTeam } from './types'
import { TYPE_SCALE } from '../ui/card'
import { InfoDot } from '../ui/InfoDot'
import { ordinal } from '../lib/format'

type Side = 'scored' | 'allowed'
type Rgb = [number, number, number]
type Mode = 'light' | 'dark'

// The scale's three stops, one set per theme. On a dark card the poles are the lighter steps of the
// same two hues, since the light-mode ones sit too close to the surface to read as an extreme.
const NEUTRAL: Record<Mode, Rgb> = { light: [240, 239, 236], dark: [56, 56, 53] }
const MORE: Record<Mode, Rgb> = { light: [198, 40, 40], dark: [248, 113, 113] }
const FEWER: Record<Mode, Rgb> = { light: [21, 101, 192], dark: [96, 165, 250] }
const INK_DARK: Rgb = [17, 20, 26]
const INK_LIGHT: Rgb = [255, 255, 255]

const luminance = (c: Rgb) => {
  const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2])
}
const contrast = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
const mix = (a: Rgb, b: Rgb, t: number): Rgb => a.map((v, i) => v + (b[i] - v) * t) as Rgb
const css = (c: Rgb) => `rgb(${c.map(Math.round).join(',')})`

const fmt = (v: number) => (v === 0 ? '0' : v.toFixed(1))

function Pill({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <Box {...pressable(onClick)} aria-pressed={on} sx={{
      ...FOCUS_RING,
      px: 1.5, py: 0.5, borderRadius: 999, cursor: 'pointer', userSelect: 'none',
      border: '1px solid', borderColor: on ? 'transparent' : 'outline',
      bgcolor: on ? 'text.primary' : 'transparent',
    }}>
      <Typography sx={{ fontSize: TYPE_SCALE.body, fontWeight: 800, color: on ? 'background.paper' : 'text.secondary' }}>
        {label}
      </Typography>
    </Box>
  )
}

export default function RunsByInning({ games, teams }: { games: readonly WpblGame[]; teams: readonly WpblTeam[] }) {
  const theme = useTheme()
  const [side, setSide] = useState<Side>('scored')
  const [scopePick, setScope] = useState<RunsScope>('regular')
  const pickSide = (v: Side) => { setSide(v); track(EVENTS.WPBL_PAGE_CONTROL, { page: 'season', control: 'innings_side', value: v }) }
  const pickScope = (v: RunsScope) => { setScope(v); track(EVENTS.WPBL_PAGE_CONTROL, { page: 'season', control: 'innings_scope', value: v }) }

  const regular = useMemo(() => runsByInning(games, teams, 'regular'), [games, teams])
  const postseason = useMemo(() => runsByInning(games, teams, 'postseason'), [games, teams])
  // The scope toggle only exists once a postseason game has gone final; until then there is one scope.
  const scope: RunsScope = postseason.games > 0 ? scopePick : 'regular'
  const grid = scope === 'regular' ? regular : postseason
  const teamById = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])

  if (grid.games === 0) return null

  const mode: Mode = theme.palette.mode === 'dark' ? 'dark' : 'light'
  const tone = (v: number | null) => {
    if (v == null) return { fill: 'transparent', ink: null as string | null }
    // -1 is the club square furthest below the league average, +1 the furthest above; extras can
    // sit outside that range and are clamped to the pole.
    const t = grid.spread > 0 ? Math.max(-1, Math.min(1, (v - grid.mean) / grid.spread)) : 0
    let bg = mix(NEUTRAL[mode], t >= 0 ? MORE[mode] : FEWER[mode], Math.abs(t))
    // Whichever ink reads better on this exact square, so the numbers clear on both themes and at
    // both poles without a hand-tuned threshold.
    const ink = contrast(bg, INK_LIGHT) >= contrast(bg, INK_DARK) ? INK_LIGHT : INK_DARK
    // AND THEN THE SQUARE GIVES WAY. A ramp through a mid tone has a band where neither ink reaches
    // 4.5:1 (a 1.9-run first inning came out at 4.43), so the fill steps away from its ink, toward
    // black under white figures or white under dark ones, by the least that clears it.
    const away: Rgb = ink === INK_LIGHT ? [0, 0, 0] : [255, 255, 255]
    for (let k = 0; k < 20 && contrast(bg, ink) < 4.6; k++) bg = mix(bg, away, 0.03)
    return { fill: css(bg), ink: css(ink) }
  }

  const ext = leagueExtremes(grid)
  const clubGames = grid.clubs.map(r => r.games)
  const minG = Math.min(...clubGames), maxG = Math.max(...clubGames)
  const scopeWord = scope === 'regular' ? 'regular season' : 'postseason'
  const verb = side === 'scored' ? 'scored' : 'allowed'

  const inningName = (c: number) => (c === EXTRAS_COLUMN ? 'extra innings' : `the ${ordinal(c)} inning`)
  const cellTitle = (who: string, cell: InningCell) => {
    const v = perHalf(cell)
    if (v == null) return `${who}, ${inningName(cell.inning)}: not batted`
    return `${who}, ${inningName(cell.inning)}: ${fmt(v)} runs ${verb} a half-inning (${cell.runs} in ${cell.halves})`
  }

  const renderRow = (row: RunsByInningRow) => {
    const team = row.teamId ? teamById.get(row.teamId) : undefined
    const who = team ? team.city : 'The league'
    return (
      <tr key={row.teamId ?? 'league'}>
        <Box component="th" scope="row" sx={{ p: 0, pr: 0.5, textAlign: 'left', fontWeight: 'inherit' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
            {team && <TeamBadge team={team} size={20} />}
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 800, lineHeight: 1.15 }}>
                {team ? team.abbr : 'WPBL'}
              </Typography>
              <Typography sx={{ fontSize: TYPE_SCALE.caption, color: 'text.disabled', lineHeight: 1.15, fontVariantNumeric: 'tabular-nums' }}>
                {row.games} g
              </Typography>
            </Box>
          </Box>
        </Box>
        {grid.columns.map(c => {
          const cell = row[side][c - 1]
          const v = perHalf(cell)
          const { fill, ink } = tone(v)
          return (
            <Box
              component="td"
              key={c}
              title={cellTitle(who, cell)}
              sx={{
                p: 0, height: '2.1rem', borderRadius: '4px',
                textAlign: 'center', verticalAlign: 'middle',
                fontSize: TYPE_SCALE.meta, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                bgcolor: fill,
                color: ink ?? 'text.disabled',
                // A column this club never batted in: outlined so the grid keeps its shape, with no
                // fill, because grey would claim "about average" for something that did not happen.
                // An inset shadow, so it costs no layout.
                boxShadow: v == null ? `inset 0 0 0 1px ${theme.palette.divider}` : 'none',
              }}
            >
              {v == null ? '—' : fmt(v)}
            </Box>
          )
        })}
      </tr>
    )
  }

  const legendLabel = { fontSize: TYPE_SCALE.meta, color: 'text.secondary', whiteSpace: 'nowrap' as const }

  return (
    // NO INTRO LINE (house rule, Oct 21, 2026: labels, not narration). The heading above names the
    // grid; what each square is, the league's extremes and the postseason sample are behind the
    // info dot on the legend.
    <Box>

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, mb: 1.5 }}>
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          <Pill on={side === 'scored'} label="Scored" onClick={() => pickSide('scored')} />
          <Pill on={side === 'allowed'} label="Allowed" onClick={() => pickSide('allowed')} />
        </Box>
        {postseason.games > 0 && (
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            <Pill on={scope === 'regular'} label="Regular season" onClick={() => pickScope('regular')} />
            <Pill on={scope === 'postseason'} label="Postseason" onClick={() => pickScope('postseason')} />
          </Box>
        )}
      </Box>

      <Box
        component="table"
        aria-label={`Runs ${verb} per half-inning by club and inning, ${scopeWord}`}
        sx={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'separate', borderSpacing: '2px' }}
      >
        <colgroup>
          <col style={{ width: '3.6rem' }} />
          {grid.columns.map(c => <col key={c} />)}
        </colgroup>
        <thead>
          <tr>
            <Box component="th" sx={{ p: 0 }}><Box component="span" sx={{ fontSize: TYPE_SCALE.caption, color: 'text.disabled', fontWeight: 700 }}>Inn</Box></Box>
            {grid.columns.map(c => (
              <Box component="th" scope="col" key={c} sx={{
                p: 0, pb: 0.25, fontSize: TYPE_SCALE.micro, fontWeight: 700, color: 'text.secondary',
                fontVariantNumeric: 'tabular-nums',
              }}>
                {c === EXTRAS_COLUMN ? '8+' : c}
              </Box>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.clubs.map(renderRow)}
          <tr aria-hidden><td colSpan={grid.columns.length + 1} style={{ height: 4, padding: 0 }} /></tr>
          {renderRow(grid.league)}
        </tbody>
      </Box>

      {/* The scale legend: both poles and the midpoint, labeled in words, with the midpoint's value. */}
      <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0.75, mt: 1.25 }}>
        <Typography sx={legendLabel}>Fewer runs</Typography>
        <Box aria-hidden sx={{
          width: '6rem', height: 8, borderRadius: 999, flexShrink: 0,
          background: `linear-gradient(to right, ${css(FEWER[mode])}, ${css(NEUTRAL[mode])}, ${css(MORE[mode])})`,
        }} />
        <Typography sx={legendLabel}>More runs</Typography>
        <Typography sx={legendLabel}>· Avg {fmt(grid.mean)}</Typography>
        <InfoDot text={[
          `Each square is a club's runs ${verb} in that inning, per half-inning. Grey is the league's average half-inning this ${scopeWord}, ${fmt(grid.mean)} runs; red is more, blue fewer.`,
          `A bottom half the home side never needed to bat is left out rather than counted as a scoreless inning${grid.columns.includes(EXTRAS_COLUMN) ? ', and every extra inning shares the last column' : ''}.`,
          ...(ext ? [`High: ${ordinal(ext.high.inning)}, ${fmt(perHalf(ext.high)!)}. Low: ${ordinal(ext.low.inning)}, ${fmt(perHalf(ext.low)!)}.`] : []),
          ...(scope === 'postseason' ? [`Postseason: ${minG === maxG ? minG : `${minG} to ${maxG}`} games a club.`] : []),
        ]} />
      </Box>
    </Box>
  )
}
