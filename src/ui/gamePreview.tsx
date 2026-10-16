import React, { useState } from 'react'
import { Box, Typography } from '@mui/material'
import type { SxProps, Theme } from '@mui/material'
import { TYPE_SCALE } from './card'
import { SegNav } from './SegNav'
import { pressable, FOCUS_RING, TAPPABLE } from './interaction'
import { typePx } from './scale'
import { useDark } from './useDark'
import { ordinal } from '../lib/format'

// The game preview, for both sections: the two clubs' season numbers set against each other as
// diverging bars, the frame around them, and the matchup line on top. Each section drew all of this
// for itself until Oct 2026 and the two had drifted (MLB's dot legend, its 900-weight numbers, its
// own sizes); WPBL's version is the one kept. Each section's GamePreview.tsx feeds its own numbers,
// colours, club marks and links, and anything only one league has (StatsAPI's probable starters,
// WPBL's leaders and rosters) comes in as a slot rather than being drawn here.

/** One stat row, whatever the league's own definition type. */
export interface PreviewStatDef {
  key: string
  label: string
  group: 'hitting' | 'pitching'
}

/** A club's value on one stat: the printed figure, its league rank (1 = best, whichever way the
 *  stat runs) and its place in the league's range, 0 to 1, which is the bar's length. */
export interface PreviewStatValue {
  display: string
  rank: number
  pct: number
}

/** One club as the preview draws it. `color` is the bar and the printed winner, so it must already
 *  be held to text contrast by the section; `mark` is the club's logo at the size asked for. */
export interface PreviewSide {
  abbr: string
  color: string
  mark: (size: number) => React.ReactNode
  /** Open the club. Leaves the chip inert when there is nowhere to send the tap. */
  onOpen?: () => void
  /** The chip's accessible name when it opens something, e.g. "Boston Red Sox team page". */
  openLabel?: string
}

export const PREVIEW_SHIMMER = {
  bgcolor: 'action.hover', borderRadius: 0.75,
  '@keyframes pvPulse': { '0%,100%': { opacity: 0.5 }, '50%': { opacity: 0.85 } },
  animation: 'pvPulse 1.1s ease-in-out infinite',
} as const

/** The small all-caps heading a preview block carries ("Season Comparison", "Probable Starters"). */
export function PreviewHeading({ children }: { children: React.ReactNode }) {
  return (
    <Typography sx={{
      fontSize: TYPE_SCALE.micro, fontWeight: 700, color: 'text.disabled',
      textTransform: 'uppercase', letterSpacing: typePx(0.8), lineHeight: 1, mb: 1,
    }}>
      {children}
    </Typography>
  )
}

/** "This game hasn't been played yet", for a pane whose only content was the comparison. */
export function PreviewEmpty() {
  return (
    <Box sx={{ px: 2, py: 3, textAlign: 'center' }}>
      <Typography sx={{ fontSize: TYPE_SCALE.title, fontWeight: 700, mb: 0.5 }}>This game hasn't been played yet</Typography>
      <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.disabled' }}>
        Season stats to compare appear once both clubs have played.
      </Typography>
    </Box>
  )
}

/**
 * The season comparison: a legend, the Offense and Pitching groups and a footnote, or in the
 * compact cut three rows under a hairline and nothing else. Each row is a diverging bar scaled to
 * the league's range for that stat, so the two clubs read against each other (and against the
 * league) at a glance; bars always grow toward "better", including for ERA and WHIP.
 *
 * `loading` draws the same rows with shimmering values and empty tracks, which is the loaded
 * board drawn empty: the row count and every row's height are known before a number arrives.
 */
export function ComparisonBars({ away, home, defs, awayStats, homeStats, loading, compact, compactKeys, footnote, labelFor }: {
  away: PreviewSide
  home: PreviewSide
  defs: readonly PreviewStatDef[]
  awayStats?: Record<string, PreviewStatValue | undefined>
  homeStats?: Record<string, PreviewStatValue | undefined>
  loading: boolean
  /** Three rows, one line per value, no chrome. For a host card that supplies its own. */
  compact?: boolean
  /** The rows the compact cut keeps, in order. */
  compactKeys?: readonly string[]
  /** The line under the bars: the season and what the bar length means. */
  footnote: string
  /** A row label that depends on a reader's setting (WPBL's K/7 or K/9). */
  labelFor?: (def: PreviewStatDef) => string
}) {
  const isDark = useDark()
  const trackBg = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)'

  // value + rank stacked on the outer edge, bar growing inward from it.
  const valueCell = (v: PreviewStatValue | undefined, better: boolean, color: string, align: 'right' | 'left') => (
    <Box sx={{ width: '2.75rem', flexShrink: 0, textAlign: align }}>
      {loading ? (
        <Box sx={{ ...PREVIEW_SHIMMER, width: '2rem', height: '0.8rem', ml: align === 'right' ? 'auto' : 0 }} />
      ) : (
        <>
          {/* THE COMPACT CUT IS A FOOTER AND IS TYPED LIKE ONE. At full size these were the
              heaviest ink in WPBL's Next game card, ahead of the club names the card is about.
              The winner keeps its colour at both sizes: that is the comparison.

              800 AND NOT 900 AT FULL SIZE. Weight and a saturated accent are two emphases on
              one short string, and at 900 the strokes of a tabular figure close up their counters
              and the number reads as a blob. 200 weights and the whole colour on the losing side
              is more than enough to say which one won. */}
          <Typography sx={{
            fontSize: compact ? TYPE_SCALE.meta : TYPE_SCALE.body,
            fontWeight: better ? (compact ? 700 : 800) : 600, lineHeight: 1.1,
            color: better ? color : 'text.secondary', fontVariantNumeric: 'tabular-nums',
          }}>
            {v?.display ?? '—'}
          </Typography>
          {/* The league rank, and the first thing the compact cut drops: it is a second line on
              every cell, and the bar already says longer or shorter. */}
          {!compact && (
            <Typography sx={{ fontSize: TYPE_SCALE.nano, fontWeight: 600, color: 'text.disabled', lineHeight: 1.2 }}>
              {v ? ordinal(v.rank) : ''}
            </Typography>
          )}
        </>
      )}
    </Box>
  )

  // Half-track: bar anchored at the center label, growing outward.
  const bar = (v: PreviewStatValue | undefined, better: boolean, color: string, side: 'away' | 'home') => (
    <Box sx={{
      // 4px in the footer cut, where it reads as the rule it sits under; taller on a desktop,
      // where the bar is longer and a thin one reads as faint.
      flex: 1, minWidth: 0, height: compact ? 4 : { xs: 8, md: 10 }, borderRadius: 999, bgcolor: trackBg,
      position: 'relative', overflow: 'hidden',
    }}>
      {!loading && v && (
        <Box sx={{
          position: 'absolute', top: 0, bottom: 0,
          [side === 'away' ? 'right' : 'left']: 0,
          // Floor keeps a last-in-league value visible rather than zero-width.
          width: `${Math.max(5, v.pct * 100)}%`,
          bgcolor: color, opacity: better ? 1 : 0.4,
          borderRadius: 999,
          transition: 'width 0.35s ease, opacity 0.2s',
        }} />
      )}
    </Box>
  )

  const row = (def: PreviewStatDef) => {
    const a = awayStats?.[def.key]
    const h = homeStats?.[def.key]
    // Rank already encodes direction (1 = best), so it decides the winner both ways.
    const awayBetter = !!a && !!h && a.rank < h.rank
    const homeBetter = !!a && !!h && h.rank < a.rank
    return (
      <Box key={def.key} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, py: compact ? 0.25 : 0.4 }}>
        {valueCell(a, awayBetter, away.color, 'right')}
        {bar(a, awayBetter, away.color, 'away')}
        <Typography sx={{
          flexShrink: 0, width: '2.375rem', textAlign: 'center',
          fontSize: TYPE_SCALE.micro, fontWeight: 800, color: 'text.secondary',
          textTransform: 'uppercase', letterSpacing: typePx(0.6), lineHeight: 1,
        }}>
          {labelFor ? labelFor(def) : def.label}
        </Typography>
        {bar(h, homeBetter, home.color, 'home')}
        {valueCell(h, homeBetter, home.color, 'left')}
      </Box>
    )
  }

  if (compact) {
    return (
      <Box>
        {/* A HAIRLINE, NOT A WORD, marks the break from the host card to its data: a "SEASON
            STATS" label here was a second all-caps eyebrow stacked under the card's own. */}
        <Box sx={{ height: '1px', bgcolor: 'divider', mb: 1 }} />
        {(compactKeys ?? []).map(k => defs.find(d => d.key === k)).map(d => d && row(d))}
      </Box>
    )
  }

  // A hairline rule with the group name set into it: separates Offense from Pitching without a
  // second heavy all-caps header competing with the row labels.
  const groupBlock = (group: 'hitting' | 'pitching', label: string) => (
    <Box sx={{ mt: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.4 }}>
        <Typography sx={{
          // 700 at `nano`: 8px, uppercase, letter-spaced AND dimmed, so weight was the one thing
          // not earning its place.
          fontSize: TYPE_SCALE.nano, fontWeight: 700, color: 'text.disabled',
          textTransform: 'uppercase', letterSpacing: typePx(1), lineHeight: 1, flexShrink: 0,
        }}>
          {label}
        </Typography>
        <Box sx={{ flex: 1, height: '1px', bgcolor: 'divider' }} />
      </Box>
      {defs.filter(d => d.group === group).map(row)}
    </Box>
  )

  // The club's mark plus its abbr in the bar colour, so side, club and colour tie together
  // without decoding a legend. It opens the club where the section has somewhere to send it:
  // a wall of a club's season numbers makes "how are they doing" the obvious next question.
  const teamChip = (side: PreviewSide, align: 'right' | 'left') => (
    <Box
      {...(side.onOpen ? pressable(side.onOpen) : {})}
      aria-label={side.onOpen ? side.openLabel : undefined}
      sx={{
        flex: 1, display: 'flex', alignItems: 'center', gap: 0.6, minWidth: 0,
        flexDirection: align === 'right' ? 'row-reverse' : 'row',
        ...(side.onOpen ? { cursor: 'pointer', borderRadius: 1, mx: -0.5, px: 0.5, py: 0.25, ...TAPPABLE, ...FOCUS_RING } : {}),
      }}
    >
      {side.mark(18)}
      <Typography sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 800, color: side.color, lineHeight: 1 }}>{side.abbr}</Typography>
    </Box>
  )

  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
        {teamChip(away, 'right')}
        <Typography sx={{ fontSize: TYPE_SCALE.micro, fontWeight: 700, color: 'text.disabled', flexShrink: 0, lineHeight: 1 }}>VS</Typography>
        {teamChip(home, 'left')}
      </Box>
      {groupBlock('hitting', 'Offense')}
      {groupBlock('pitching', 'Pitching')}
      <Typography sx={{ fontSize: TYPE_SCALE.micro, color: 'text.disabled', mt: 1, textAlign: 'center', lineHeight: 1.5 }}>
        {footnote}
      </Typography>
    </>
  )
}

export interface PreviewBoard {
  value: string
  label: string
  node: React.ReactNode
}

/**
 * The frame a preview block sits in. With one board it is that board under a "Season Comparison"
 * heading; with several, a toggle names and pages between them and the heading goes, since the
 * toggle already says what is showing. `bare` drops the heading and the padding for a host that
 * has titled the block and supplied the surround.
 */
export function PreviewFrame({ boards, heading = 'Season Comparison', bare, sx }: {
  boards: PreviewBoard[]
  heading?: string
  bare?: boolean
  sx?: SxProps<Theme>
}) {
  const [board, setBoard] = useState(boards[0]?.value)
  const shown = boards.find(b => b.value === board) ?? boards[0]
  const pad = bare ? { px: 0, py: 0 } : { px: 2, py: 1.5 }
  return (
    <Box sx={[pad, ...(Array.isArray(sx) ? sx : [sx])]}>
      {boards.length > 1 ? (
        <Box sx={{ mb: 1.5 }}>
          <SegNav options={boards.map(b => ({ value: b.value, label: b.label }))} value={shown.value} onChange={setBoard} mb={0} />
        </Box>
      ) : !bare && <PreviewHeading>{heading}</PreviewHeading>}
      {shown?.node}
    </Box>
  )
}

/**
 * The matchup line at the top of a preview sheet: both clubs' marks either side of "AWY at HOM".
 * Each mark opens its club where the section passes somewhere to send it.
 */
type HeaderSide = Pick<PreviewSide, 'abbr' | 'mark' | 'onOpen' | 'openLabel'>

export function MatchupHeader({ away, home }: { away: HeaderSide; home: HeaderSide }) {
  const mark = (side: HeaderSide) => (
    <Box
      {...(side.onOpen ? pressable(side.onOpen) : {})}
      aria-label={side.onOpen ? side.openLabel : undefined}
      sx={{
        display: 'flex', flexShrink: 0, borderRadius: 1,
        ...(side.onOpen ? { cursor: 'pointer', ...TAPPABLE, ...FOCUS_RING } : {}),
      }}
    >
      {side.mark(40)}
    </Box>
  )
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5, px: 2, pt: 2 }}>
      {mark(away)}
      <Typography sx={{ fontSize: TYPE_SCALE.title, fontWeight: 700 }}>
        {away.abbr} <Box component="span" sx={{ color: 'text.disabled', fontWeight: 600 }}>at</Box> {home.abbr}
      </Typography>
      {mark(home)}
    </Box>
  )
}
