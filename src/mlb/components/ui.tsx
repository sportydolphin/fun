// ─── UI primitives ────────────────────────────────────────────────────────────

import React, { useState } from 'react'
import { Box, Typography, Popover, Tooltip, ClickAwayListener } from '@mui/material'
import { KeyboardArrowDown, InfoOutlined } from '@mui/icons-material'
import { RankMode, Palette, StatDef } from '../types'
import { ACCENT, ACCENT_TEXT } from '../constants'
import { statCols } from '../lib/utils'
import { linkPress, pressable, hoverOnly, FOCUS_RING } from '../../ui/interaction'
import { chromePx, typePx } from '../../ui/scale'

// The section's segmented control: the tab bar, the Stats boards, Hitting / Pitching and the rest.
//
// WPBL'S SegNav LOOK, AND FOR TWO REASONS RATHER THAN FOR MATCHING (Oct 2026). The active option was
// white on a #60a5fa fill, which measures about 2.5:1, under AA in both themes since contrast is
// absolute. It is now WPBL's raised surface chip with the foreground-safe accent as its text, which
// clears AA in either theme. And the options were click-only boxes a keyboard could not reach; they
// are now buttons (or links, with `href`) with WPBL's focus ring. Same geometry as before, so nothing
// around a control moves. The tab bar is the one a reader sees in both sections, so it now reads the
// same on both sides of the switch.
export function SegControl({ options, value, onChange }: {
  /** `href` makes the option a real link (linkPress): a tab that is a page must be one a crawler
   *  can follow and a reader can open in a new tab. Options that only switch a mode leave it off. */
  options: { value: string; label: string; href?: string }[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <Box sx={{
      display: 'inline-flex',
      bgcolor: 'action.hover',
      borderRadius: 999,
      p: chromePx(3),
      gap: 0,
    }}>
      {options.map(opt => {
        const on = value === opt.value
        return (
          <Box
            key={opt.value}
            {...(opt.href
              ? { ...linkPress(opt.href, () => onChange(opt.value)), 'aria-current': on ? ('page' as const) : undefined }
              : { ...pressable(() => onChange(opt.value)), 'aria-pressed': on })}
            sx={{
              ...FOCUS_RING,
              display: 'block', textDecoration: 'none',
              px: 1.75, py: 0.5,
              borderRadius: 999,
              cursor: 'pointer',
              fontSize: '0.75rem',
              lineHeight: 1.4,
              whiteSpace: 'nowrap',
              transition: 'all 0.15s',
              userSelect: 'none',
              bgcolor: on ? 'background.paper' : 'transparent',
              color: on ? 'var(--wpbl-accent-fg)' : 'text.secondary',
              fontWeight: on ? 700 : 600,
              boxShadow: on ? '0 1px 3px rgba(0,0,0,0.20)' : 'none',
              ...hoverOnly(on ? {} : { color: 'text.primary' }),
            }}
          >
            {opt.label}
          </Box>
        )
      })}
    </Box>
  )
}

export function PillChip({ label, selected, onChange }: {
  label: string; selected: boolean; onChange: () => void
}) {
  return (
    <Box
      onClick={onChange}
      sx={{
        px: 1.75, py: 0.45,
        borderRadius: 999,
        border: '1.5px solid',
        borderColor: selected ? ACCENT : 'divider',
        bgcolor: selected ? `${ACCENT}20` : 'transparent',
        color: selected ? ACCENT_TEXT : 'text.secondary',
        fontSize: '0.75rem',
        fontWeight: 600,
        cursor: 'pointer',
        transition: 'all 0.15s',
        userSelect: 'none',
        '&:hover': !selected ? { borderColor: ACCENT, color: ACCENT_TEXT } : {},
      }}
    >
      {label}
    </Box>
  )
}

// Shared pill button style for action row
export const pillActionSx = {
  display: 'inline-flex', alignItems: 'center', gap: 0.6,
  px: 2, py: 0.75,
  borderRadius: 999,
  border: '1.5px solid',
  borderColor: 'divider',
  cursor: 'pointer',
  fontSize: '0.8rem',
  fontWeight: 600,
  color: 'text.secondary',
  transition: 'all 0.15s',
  userSelect: 'none' as const,
  '&:hover': { borderColor: ACCENT, color: ACCENT_TEXT },
}

// Shared style for external link pills in the options bar
export const linkPillSx = {
  display: 'inline-flex', alignItems: 'center',
  px: 1.75, py: 0.45,
  borderRadius: 999,
  border: '1.5px solid',
  borderColor: 'divider',
  color: 'text.secondary',
  fontSize: '0.75rem',
  fontWeight: 600,
  textDecoration: 'none',
  transition: 'all 0.15s',
  '&:hover': { borderColor: ACCENT, color: ACCENT_TEXT },
}

// WPBL's eyebrow and card header link, from src/ui/card.tsx (Oct 9, 2026).
export { SectionLabel, CardLink } from '../../ui/card'

// ─── Stat item ───────────────────────────────────────────────────────────────

export interface StatItemProps {
  label: string
  value: string
  playerId: number
  leaderCategory: string
  leaders: Map<string, number[]>
  palette: Palette
  rankMode: RankMode
  large?: boolean
  poop?: boolean
}

export function StatItem({ label, value, playerId, leaderCategory, leaders, palette, rankMode, large, poop }: StatItemProps) {
  const ids = leaderCategory ? (leaders.get(leaderCategory) ?? []) : []
  const rank = ids.indexOf(playerId)
  const inTop5 = rank !== -1 && rank < 5
  const bottomN = ids.length > 0 && ids.length <= 30 ? 5 : 20
  const inBottom = rank !== -1 && ids.length > 0 && rank >= ids.length - bottomN

  // Emoji + rank number are rendered separately so the emoji stays fully opaque
  // (the translucent rank color would otherwise dim it).
  let emoji = ''
  let rankNum = 0
  if (rankMode !== 'none' && rank !== -1) {
    const showBadge = rankMode === 'all' || (rankMode === 'top5' && (inTop5 || inBottom))
    if (showBadge) {
      rankNum = rank + 1
      if (inTop5) emoji = poop ? '💩' : '🔥'
      else if (inBottom) emoji = poop ? '🔥' : '💩'
    }
  }

  return (
    <Box sx={{ textAlign: 'center' }}>
      <Typography sx={{
        // The palette's own secondary tone, which is tuned per card colour (teamPalette); a flat
        // 0.85 opacity over white measured 3.4:1 on the Orioles' orange.
        color: palette.sub, fontWeight: 700,
        fontSize: large ? { xs: '0.82rem', sm: '0.92rem' } : { xs: '0.74rem', sm: '0.82rem' },
        letterSpacing: typePx(0.3), mb: 0.4,
      }}>
        {label}
      </Typography>
      <Typography sx={{
        color: palette.text, fontWeight: 700,
        fontSize: large ? { xs: '2rem', sm: '2.4rem' } : { xs: '1.75rem', sm: '2.1rem' },
        lineHeight: 1, letterSpacing: typePx(-0.5),
      }}>
        {value}
      </Typography>
      <Box sx={{ mt: 0.5, minHeight: '1.3rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {rankNum > 0 ? (
          <Box sx={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 0.4,
            bgcolor: `${palette.rank}22`, borderRadius: 0.75,
            px: 0.75, py: 0.15,
          }}>
            {emoji && (
              <Typography component="span" sx={{ fontSize: '0.82rem', lineHeight: 1.4, opacity: 1 }}>
                {emoji}
              </Typography>
            )}
            <Typography component="span" sx={{ color: palette.rank, fontSize: '0.8rem', fontWeight: 800, letterSpacing: typePx(0.4), lineHeight: 1.4 }}>
              #{rankNum}
            </Typography>
          </Box>
        ) : null}
      </Box>
    </Box>
  )
}

// ─── Stat picker ─────────────────────────────────────────────────────────────

export interface StatPickerProps {
  defs: StatDef[]
  selected: string[]
  onToggle: (key: string) => void
  label: string
}

export function StatPicker({ defs, selected, onToggle, label }: StatPickerProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  return (
    <>
      <Box
        onClick={e => setAnchor(e.currentTarget as HTMLElement)}
        sx={{
          display: 'inline-flex', alignItems: 'center', gap: 0.4,
          px: 1.75, py: 0.5,
          borderRadius: 999,
          border: '1.5px solid',
          borderColor: anchor ? ACCENT : 'divider',
          cursor: 'pointer',
          fontSize: '0.75rem',
          fontWeight: 600,
          color: anchor ? ACCENT_TEXT : 'text.secondary',
          transition: 'all 0.15s',
          userSelect: 'none',
          '&:hover': { borderColor: ACCENT, color: ACCENT_TEXT },
        }}
      >
        {label}
        <KeyboardArrowDown sx={{ fontSize: '0.9rem', mt: '1px' }} />
      </Box>
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        PaperProps={{ sx: { borderRadius: 2.5, p: 1.5, mt: 0.75, maxWidth: chromePx(210), boxShadow: '0 8px 32px rgba(0,0,0,0.14)' } }}
      >
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
          {defs.map(def => (
            <PillChip
              key={def.key}
              label={def.label}
              selected={selected.includes(def.key)}
              onChange={() => onToggle(def.key)}
            />
          ))}
        </Box>
      </Popover>
    </>
  )
}

// ─── Stat grid (shared) ───────────────────────────────────────────────────────

export interface StatGridProps {
  defs: StatDef[]
  stats: any
  selected: string[]
  palette: Palette
  rankMode: RankMode
  playerId: number
  leaders: Map<string, number[]>
  season: number | string
  label: string
  large?: boolean
  onToggle?: (key: string) => void
  mt?: number
  bigYear?: boolean     // show the season year large & bright, without the group word
  showHeader?: boolean  // false suppresses the header entirely (e.g. 2nd section of a two-way card)
  sectionLabel?: string // when set, header shows just this group label (no season), used by the player card, which shows the year separately up top
}

export function StatGrid({ defs, stats, selected, palette, rankMode, playerId, leaders, season, label, large, onToggle, mt, bigYear, showHeader = true, sectionLabel }: StatGridProps) {
  const visible = defs.filter(d => selected.includes(d.key))
  if (!stats || visible.length === 0) return null
  const cols = statCols(visible.length)
  return (
    <Box sx={{ borderTop: `1px solid ${palette.divider}`, pt: 2.5, mt: mt ?? 0 }}>
      {showHeader && (sectionLabel ? (
        <Typography sx={{ textAlign: 'center', color: palette.rank, fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: typePx(2.5), mb: 2 }}>
          {sectionLabel}
        </Typography>
      ) : bigYear ? (
        <Typography sx={{
          textAlign: 'center', color: palette.text, fontWeight: 800,
          fontSize: large ? '1.5rem' : '1.2rem', letterSpacing: typePx(-0.3), lineHeight: 1, mb: 2,
        }}>
          {season}
        </Typography>
      ) : (
        <Typography sx={{ textAlign: 'center', color: palette.rank, fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: typePx(2.5), mb: 2 }}>
          {season} {label}
        </Typography>
      ))}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center' }}>
        {visible.map(def => (
          <Box
            key={def.key}
            onClick={() => onToggle?.(def.key)}
            sx={{
              width: `${100 / cols}%`, pb: 2,
              cursor: onToggle ? 'pointer' : 'default',
              transition: 'background 0.15s',
              borderRadius: 2,
              '&:hover': onToggle ? { bgcolor: 'action.hover' } : {},
            }}
          >
            <StatItem
              // W-L shows a "12-4" value, so use the short label here rather than
              // the leaderboard's "Wins" (which ranks by wins alone).
              label={def.key === 'wl' ? def.label : (def.leaderLabel ?? def.label)}
              value={def.format(def.getValue(stats))}
              playerId={playerId}
              leaderCategory={def.leaderCategory}
              leaders={leaders}
              palette={palette}
              rankMode={rankMode}
              large={large}
              poop={def.poop}
            />
          </Box>
        ))}
      </Box>
    </Box>
  )
}

// Info icon whose tooltip works on touch too. A bare <Tooltip><InfoOutlined/></Tooltip>
// only opens on desktop hover or a 700ms long-press; inside a clickable card a mobile
// tap just bubbles up to the card. This toggles on tap, stops that bubble, and keeps
// hover behaviour on desktop. Padded hit area (m offsets it back) makes it thumb-sized.
export function InfoTip({ text, size = 0.88 }: { text: React.ReactNode; size?: number }) {
  const [open, setOpen] = useState(false)
  return (
    <ClickAwayListener onClickAway={() => setOpen(false)}>
      <Tooltip
        arrow
        placement="top"
        open={open}
        disableFocusListener
        disableHoverListener
        disableTouchListener
        title={
          <Box sx={{ maxWidth: chromePx(240), py: 0.5 }}>
            {typeof text === 'string'
              ? <Typography sx={{ fontSize: '0.72rem', lineHeight: 1.5 }}>{text}</Typography>
              : text}
          </Box>
        }
      >
        <Box
          component="span"
          onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
          sx={{
            display: 'inline-flex', alignItems: 'center',
            p: 0.75, m: -0.75, cursor: 'pointer', color: 'text.disabled',
            '&:hover': { color: 'text.secondary' },
          }}
        >
          <InfoOutlined sx={{ fontSize: `${size}rem`, color: 'inherit' }} />
        </Box>
      </Tooltip>
    </ClickAwayListener>
  )
}
