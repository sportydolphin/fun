// ─── WPBL UI primitives ─────────────────────────────────────────────────────────
// WPBL-native mirrors of the MLB app's shared primitives (`src/mlb/components/ui.tsx`)
// and modal chrome (e.g. `src/mlb/views/GamePreview.tsx`), so the two sections share
// one design language — same menus, headers, and modal shell. Kept as its own copy
// (rather than importing from src/mlb) so WPBL stays a self-contained, decoupled lazy
// chunk and the MLB side is left untouched. Only the accent differs: these are keyed
// to WPBL_ACCENT, so the league keeps its own color while the shape stays identical.
// If you restyle a primitive here, mirror the change in the MLB file (and vice versa).

import React, { useEffect } from 'react'
import { Box, Typography, useTheme } from '@mui/material'
import { WPBL_ACCENT, wpblColor, wpblSecondary, wpblLogo, wpblLogoFill } from './constants'
import type { WpblTeam } from './types'

// Is the app in dark mode? Used to pick foreground-safe team accents (see wpblAccent).
export function useWpblDark(): boolean {
  return useTheme().palette.mode === 'dark'
}

// Team badge — the one logo/color chip used across the section (schedule, standings,
// team grid, box scores). A team-color circle ringed in the team's secondary hue (so
// near-black or page-matching primaries stay defined), with the bundled logo on top:
// full-bleed for finished lockups (Boston), centered for transparent knockouts, or
// the abbreviation when no logo exists.
export function TeamBadge({ team, size = 34 }: { team: Pick<WpblTeam, 'id' | 'abbr'>; size?: number }) {
  const logo = wpblLogo(team.id)
  const fill = wpblLogoFill(team.id)
  return (
    <Box sx={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      bgcolor: wpblColor(team.id),
      border: `2px solid ${wpblSecondary(team.id)}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    }}>
      {logo
        ? <Box
            component="img" src={logo} alt={team.abbr}
            sx={fill
              ? { width: '100%', height: '100%', objectFit: 'cover' }
              : { width: '74%', height: '74%', objectFit: 'contain' }}
          />
        : <Typography sx={{ fontSize: size * 0.34, fontWeight: 800, color: '#fff' }}>{team.abbr}</Typography>}
    </Box>
  )
}

// Pill segmented control — the section nav "menu". Mirrors MLB's SegControl, wrapped
// in the same centered / mobile-horizontal-scroll container MlbStats uses for its tabs.
export function SegNav({ options, value, onChange, accent = WPBL_ACCENT }: {
  options: { value: string; label: string }[]
  value: string
  onChange: (v: string) => void
  accent?: string
}) {
  return (
    <Box sx={{
      display: 'flex', justifyContent: { xs: 'flex-start', sm: 'center' }, mb: 3,
      overflowX: 'auto',
      '&::-webkit-scrollbar': { display: 'none' },
      msOverflowStyle: 'none', scrollbarWidth: 'none',
    }}>
      <Box sx={{ display: 'inline-flex', bgcolor: 'action.hover', borderRadius: 999, p: '3px', gap: 0 }}>
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
              whiteSpace: 'nowrap',
              transition: 'all 0.15s',
              userSelect: 'none',
              bgcolor: value === opt.value ? accent : 'transparent',
              color: value === opt.value ? '#fff' : 'text.secondary',
              '&:hover': value !== opt.value ? { color: 'text.primary' } : {},
            }}
          >
            {opt.label}
          </Box>
        ))}
      </Box>
    </Box>
  )
}

// Small uppercase eyebrow label. Mirrors MLB's SectionLabel.
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

// Shared modal shell. Mirrors the MLB modal chrome: dimmed + blurred overlay, a
// vertically-centered card on `background.paper` with a soft shadow, Escape-to-close,
// a sticky uppercase eyebrow header, a round ✕ close button, and an optional sticky
// footer (e.g. the entry form's Save/Cancel).
export function ModalShell({ eyebrow, onClose, maxWidth = 720, zIndex = 1500, actions, footer, children }: {
  eyebrow: React.ReactNode
  onClose: () => void
  maxWidth?: number
  zIndex?: number
  actions?: React.ReactNode   // rendered just left of the close button
  footer?: React.ReactNode    // sticky bottom bar
  children: React.ReactNode
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <Box
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      sx={{
        position: 'fixed', inset: 0, zIndex,
        bgcolor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        p: { xs: 1, sm: 2 },
      }}
    >
      <Box sx={{
        width: '100%', maxWidth,
        bgcolor: 'background.paper', borderRadius: 3,
        border: '1px solid', borderColor: 'divider',
        boxShadow: '0 24px 64px rgba(0,0,0,0.55)',
        maxHeight: '92vh', display: 'flex', flexDirection: 'column',
      }}>
        {/* Sticky eyebrow header */}
        <Box sx={{
          px: 2, py: 1.25, borderBottom: '1px solid', borderColor: 'divider',
          display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0,
        }}>
          <Typography sx={{
            flex: 1, fontWeight: 800, fontSize: '0.72rem', color: 'text.secondary',
            textTransform: 'uppercase', letterSpacing: 1, lineHeight: 1,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {eyebrow}
          </Typography>
          {actions}
          <Box
            onClick={onClose}
            sx={{
              flexShrink: 0, width: 26, height: 26, borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', color: 'text.disabled',
              '&:hover': { bgcolor: 'action.hover', color: 'text.primary' },
            }}
          >
            <Typography sx={{ fontSize: '0.75rem', lineHeight: 1 }}>✕</Typography>
          </Box>
        </Box>

        {/* Scrollable body */}
        <Box sx={{
          flex: 1, overflowY: 'auto',
          '&::-webkit-scrollbar': { width: 4 },
          '&::-webkit-scrollbar-thumb': { bgcolor: 'divider', borderRadius: 2 },
        }}>
          {children}
        </Box>

        {footer && (
          <Box sx={{ flexShrink: 0, borderTop: '1px solid', borderColor: 'divider', px: 2, py: 1.5 }}>
            {footer}
          </Box>
        )}
      </Box>
    </Box>
  )
}
