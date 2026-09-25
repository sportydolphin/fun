// Runs by inning: a heatmap of when each club scores, and when it gives them up.
//
// One row per club and one for the league, one column per inning, and each square is runs per
// half-inning batted. See derive/runsByInning.ts for why that denominator and not games.
//
// IT IS A REAL <table>, not a grid of coloured boxes. The numbers are printed in every square and the
// clubs and innings are row and column headers, so a screen reader walks it as the table it is and
// nobody needs the colour to read a value. The colour is for seeing the SHAPE: which clubs come out
// swinging, which ones fade.
//
// DIVERGING AROUND THE LEAGUE AVERAGE, NOT A RAMP FROM ZERO. This league averages over a run a
// half-inning and almost no square sits near zero, so a zero-based ramp spends most of its range
// where no square is and every square comes out a similar shade. Centring on the league's own
// half-inning (`mean`) and stretching each arm to the furthest club square (`spread`) spends the
// whole scale on the differences. Red is more runs than the league average, blue fewer, grey about
// average, and the meaning is the same on Scored and Allowed: it is always a statement about runs,
// never about whether that was good. Blue and red with a grey midpoint because that pair stays
// apart for colour-blind readers and the grey reads as "nothing", which a hue in the middle would not.
import { useMemo, useState } from 'react'
import { track, EVENTS } from '../lib/analytics'
import { Box, Typography, useTheme } from '@mui/material'
import {
  runsByInning, perHalf, leagueExtremes, EXTRAS_COLUMN,
  type InningCell, type RunsByInningRow, type RunsScope,
} from './derive/runsByInning'
import { TeamBadge, FOCUS_RING, pressable } from './ui'
import type { WpblGame, WpblTeam } from './types'

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

const ordinal = (n: number) => (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`)
const fmt = (v: number) => (v === 0 ? '0' : v.toFixed(1))

function Pill({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <Box {...pressable(onClick)} aria-pressed={on} sx={{
      ...FOCUS_RING,
      px: 1.5, py: 0.5, borderRadius: 999, cursor: 'pointer', userSelect: 'none',
      border: '1px solid', borderColor: on ? 'transparent' : 'divider',
      bgcolor: on ? 'text.primary' : 'transparent',
    }}>
      <Typography sx={{ fontSize: '0.8rem', fontWeight: 800, color: on ? 'background.paper' : 'text.secondary' }}>
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
    const bg = mix(NEUTRAL[mode], t >= 0 ? MORE[mode] : FEWER[mode], Math.abs(t))
    // Whichever ink reads better on this exact square, so the numbers clear on both themes and at
    // both poles without a hand-tuned threshold.
    return { fill: css(bg), ink: css(contrast(bg, INK_LIGHT) >= contrast(bg, INK_DARK) ? INK_LIGHT : INK_DARK) }
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
              <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, lineHeight: 1.15 }}>
                {team ? team.abbr : 'WPBL'}
              </Typography>
              <Typography sx={{ fontSize: '0.6rem', color: 'text.disabled', lineHeight: 1.15, fontVariantNumeric: 'tabular-nums' }}>
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
                fontSize: '0.72rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums',
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

  const legendLabel = { fontSize: '0.72rem', color: 'text.secondary', whiteSpace: 'nowrap' as const }

  return (
    <Box>
      <Typography sx={{ color: 'text.secondary', fontSize: '0.85rem', mt: -0.75, mb: 1.5 }}>
        Runs per half-inning, club by club.
        {ext && ` League-wide the ${ordinal(ext.high.inning)} is the big inning at ${fmt(perHalf(ext.high)!)} runs, and the ${ordinal(ext.low.inning)} the quietest at ${fmt(perHalf(ext.low)!)}.`}
        {scope === 'postseason' && ` Postseason samples are small: ${minG === maxG ? minG : `${minG} to ${maxG}`} games a club.`}
      </Typography>

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
            <Box component="th" sx={{ p: 0 }}><Box component="span" sx={{ fontSize: '0.6rem', color: 'text.disabled', fontWeight: 700 }}>Inn</Box></Box>
            {grid.columns.map(c => (
              <Box component="th" scope="col" key={c} sx={{
                p: 0, pb: 0.25, fontSize: '0.68rem', fontWeight: 700, color: 'text.secondary',
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

      {/* The scale legend: both poles and the midpoint, labelled in words, with the midpoint's value. */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 1.25 }}>
        <Typography sx={legendLabel}>Fewer runs</Typography>
        <Box aria-hidden sx={{
          width: '6rem', height: 8, borderRadius: 999, flexShrink: 0,
          background: `linear-gradient(to right, ${css(FEWER[mode])}, ${css(NEUTRAL[mode])}, ${css(MORE[mode])})`,
        }} />
        <Typography sx={legendLabel}>More runs</Typography>
      </Box>

      <Typography sx={{ color: 'text.disabled', fontSize: '0.78rem', mt: 1 }}>
        Grey is the league&rsquo;s average half-inning this {scopeWord}, {fmt(grid.mean)} runs; red is more,
        blue fewer. Each square is a club&rsquo;s runs in that inning divided by the times it batted in it.
        A bottom half the home side never needed to bat is left out rather than counted as a scoreless
        inning{grid.columns.includes(EXTRAS_COLUMN) ? ', and every extra inning shares the last column' : ''}.
      </Typography>
    </Box>
  )
}
