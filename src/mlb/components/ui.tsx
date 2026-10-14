// ─── UI primitives ────────────────────────────────────────────────────────────

import { ACCENT_EDGE } from '../../ui/card'
import React from 'react'
import { Box, Typography } from '@mui/material'
import { RankMode, Palette, StatDef } from '../types'
import { ACCENT_TEXT } from '../constants'
import { statCols } from '../lib/utils'
import { pressable } from '../../ui/interaction'
import { typePx } from '../../ui/scale'

// Shared style for external link pills in the options bar
export const linkPillSx = {
  display: 'inline-flex', alignItems: 'center',
  px: 1.75, py: 0.45,
  borderRadius: 999,
  border: '1.5px solid',
  borderColor: 'outline',
  color: 'text.secondary',
  fontSize: '0.75rem',
  fontWeight: 600,
  textDecoration: 'none',
  transition: 'all 0.15s',
  '&:hover': { borderColor: ACCENT_EDGE, color: ACCENT_TEXT },
}

// WPBL's eyebrow and card header link, from src/ui/card.tsx (Oct 9, 2026).
export { SectionLabel } from '../../ui/card'

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
            {...pressable(() => onToggle?.(def.key))}
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
