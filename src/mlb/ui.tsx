// ─── UI primitives ────────────────────────────────────────────────────────────

import React, { useState } from 'react'
import { Box, Typography, Popover } from '@mui/material'
import { KeyboardArrowDown } from '@mui/icons-material'
import { RankMode, Palette, StatDef } from './types'
import { ACCENT } from './constants'
import { statCols } from './utils'

export function SegControl({ options, value, onChange }: {
  options: { value: string; label: string }[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <Box sx={{
      display: 'inline-flex',
      bgcolor: 'action.hover',
      borderRadius: 999,
      p: '3px',
      gap: 0,
    }}>
      {options.map(opt => (
        <Box
          key={opt.value}
          onClick={() => onChange(opt.value)}
          sx={{
            px: 1.75, py: 0.5,
            borderRadius: 999,
            cursor: 'pointer',
            fontSize: '0.75rem',
            fontWeight: 600,
            lineHeight: 1.4,
            transition: 'all 0.15s',
            userSelect: 'none',
            bgcolor: value === opt.value ? ACCENT : 'transparent',
            color: value === opt.value ? '#fff' : 'text.secondary',
            '&:hover': value !== opt.value ? { color: 'text.primary' } : {},
          }}
        >
          {opt.label}
        </Box>
      ))}
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
        color: selected ? ACCENT : 'text.secondary',
        fontSize: '0.75rem',
        fontWeight: 600,
        cursor: 'pointer',
        transition: 'all 0.15s',
        userSelect: 'none',
        '&:hover': !selected ? { borderColor: ACCENT, color: ACCENT } : {},
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
  '&:hover': { borderColor: ACCENT, color: ACCENT },
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
  '&:hover': { borderColor: ACCENT, color: ACCENT },
}

export function SectionLabel({ children, strong }: { children: React.ReactNode; strong?: boolean }) {
  return (
    <Typography sx={{
      fontSize: strong ? '0.78rem' : '0.63rem',
      fontWeight: strong ? 800 : 700,
      textTransform: 'uppercase', letterSpacing: 1.8,
      color: strong ? 'text.primary' : 'text.disabled', mb: 1,
    }}>
      {children}
    </Typography>
  )
}

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
        color: palette.text, fontWeight: 700,
        fontSize: large ? { xs: '0.82rem', sm: '0.92rem' } : { xs: '0.74rem', sm: '0.82rem' },
        letterSpacing: 0.3, opacity: 0.85, mb: 0.4,
      }}>
        {label}
      </Typography>
      <Typography sx={{
        color: palette.text, fontWeight: 700,
        fontSize: large ? { xs: '2rem', sm: '2.4rem' } : { xs: '1.75rem', sm: '2.1rem' },
        lineHeight: 1, letterSpacing: '-0.5px',
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
            <Typography component="span" sx={{ color: palette.rank, fontSize: '0.8rem', fontWeight: 800, letterSpacing: 0.4, lineHeight: 1.4 }}>
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
          color: anchor ? ACCENT : 'text.secondary',
          transition: 'all 0.15s',
          userSelect: 'none',
          '&:hover': { borderColor: ACCENT, color: ACCENT },
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
        PaperProps={{ sx: { borderRadius: 2.5, p: 1.5, mt: 0.75, maxWidth: 210, boxShadow: '0 8px 32px rgba(0,0,0,0.14)' } }}
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
  sectionLabel?: string // when set, header shows just this group label (no season) — used by the player card, which shows the year separately up top
}

export function StatGrid({ defs, stats, selected, palette, rankMode, playerId, leaders, season, label, large, onToggle, mt, bigYear, showHeader = true, sectionLabel }: StatGridProps) {
  const visible = defs.filter(d => selected.includes(d.key))
  if (!stats || visible.length === 0) return null
  const cols = statCols(visible.length)
  return (
    <Box sx={{ borderTop: `1px solid ${palette.divider}`, pt: 2.5, mt: mt ?? 0 }}>
      {showHeader && (sectionLabel ? (
        <Typography sx={{ textAlign: 'center', color: palette.rank, fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 2.5, mb: 2 }}>
          {sectionLabel}
        </Typography>
      ) : bigYear ? (
        <Typography sx={{
          textAlign: 'center', color: palette.text, fontWeight: 800,
          fontSize: large ? '1.5rem' : '1.2rem', letterSpacing: '-0.3px', lineHeight: 1, mb: 2,
        }}>
          {season}
        </Typography>
      ) : (
        <Typography sx={{ textAlign: 'center', color: palette.rank, fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 2.5, mb: 2 }}>
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
