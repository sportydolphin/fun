// ─── Icon Studio (dev-only) ───────────────────────────────────────────────────
// A visual tuner for each team's four icon-styling values: bubble background,
// ring color, standings-row highlight, and logo art variant. Tunes light and
// dark mode separately — the ☀/🌙 toggle switches which mode you're editing and
// previewing. Pick from each team's official palette, switch logos, then Export
// a copy-paste block of the locked-in values for the active mode.
//
// This module is lazy-loaded and gated behind import.meta.env.DEV, so it is
// stripped from production builds entirely.

import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { Box, Typography } from '@mui/material'
import {
  TEAM_ABBR, TEAM_NICKNAME, TEAM_COLOR_PALETTE, LOGO_VARIANTS, teamLogoUrl, teamLogoTransform,
  TEAM_BG, TEAM_ICON_STYLE, TEAM_ICON_STYLE_LIGHT, DEFAULT_ICON_BG_DARK, type LogoVariantKey,
} from '../constants'
import { ringColor } from '../lib/colorUtils'

// Universal fallbacks appended to every team's palette so each slot can reach
// white / neutral gray / black even when the brand palette lacks them.
const NEUTRALS = ['#FFFFFF', '#C4CED4', '#2E2E2E', '#000000']
const STORAGE_KEY = 'iconStudio.v3'

// Crop nudge/zoom steps and bounds.
const NUDGE_STEP = 3       // % per arrow press
const ZOOM_STEP  = 0.1
const OFFSET_MAX = 60      // %
const ZOOM_MIN   = 0.4
const ZOOM_MAX   = 3

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const round1 = (v: number) => Math.round(v * 10) / 10

interface IconStyle {
  bg:        string
  ring:      string
  highlight: string
  logo:      LogoVariantKey
  ox:        number
  oy:        number
  zoom:      number
}

type ModeStyles = { dark: Record<number, IconStyle>; light: Record<number, IconStyle> }

// Team ids in numeric order (108…158) — stable, matches TEAM_ABBR insertion.
const TEAM_IDS = Object.keys(TEAM_ABBR).map(Number).sort((a, b) => a - b)

// Baseline for a mode = the locked-in style for that mode if present, else the
// classic per-mode default. "Reset all" returns here.
function defaultStyle(id: number, dark: boolean): IconStyle {
  const crop = { ox: 0, oy: 0, zoom: 1 }
  const locked = (dark ? TEAM_ICON_STYLE : TEAM_ICON_STYLE_LIGHT)[id]
  if (locked) return { ...crop, ...locked, logo: locked.logo }
  const base = TEAM_BG[id] ?? '#888888'
  return dark
    ? { ...crop, bg: DEFAULT_ICON_BG_DARK, ring: ringColor(id, true), highlight: base, logo: 'capDark' }
    : { ...crop, bg: '#FFFFFF',            ring: base,                highlight: base, logo: 'primary' }
}

function logoTransform(s: IconStyle): string {
  return teamLogoTransform(s)
}

function loadStyles(): ModeStyles {
  let saved: Partial<ModeStyles> = {}
  try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') } catch { /* ignore */ }
  const build = (dark: boolean) => {
    const out: Record<number, IconStyle> = {}
    const s = (dark ? saved.dark : saved.light) ?? {}
    for (const id of TEAM_IDS) out[id] = { ...defaultStyle(id, dark), ...(s[id] ?? {}) }
    return out
  }
  return { dark: build(true), light: build(false) }
}

function swatchesFor(id: number): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const c of [...(TEAM_COLOR_PALETTE[id] ?? []), ...NEUTRALS]) {
    const up = c.toUpperCase()
    if (!seen.has(up)) { seen.add(up); out.push(c) }
  }
  return out
}

// ─── Small building blocks ────────────────────────────────────────────────────

function SwatchRow({ label, colors, value, onPick }: {
  label: string; colors: string[]; value: string; onPick: (c: string) => void
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
      <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, width: 66, flexShrink: 0, opacity: 0.7 }}>
        {label}
      </Typography>
      <Box sx={{ display: 'flex', gap: 0.6, flexWrap: 'wrap' }}>
        {colors.map(c => {
          const active = c.toUpperCase() === value.toUpperCase()
          return (
            <Box
              key={c}
              onClick={() => onPick(c)}
              title={c}
              sx={{
                width: 22, height: 22, borderRadius: '50%', cursor: 'pointer',
                bgcolor: c, flexShrink: 0,
                border: '2px solid',
                borderColor: active ? '#4ea1ff' : 'rgba(128,128,128,0.35)',
                boxShadow: active ? '0 0 0 2px rgba(78,161,255,0.35)' : 'none',
                transition: 'transform 0.1s, box-shadow 0.1s',
                '&:hover': { transform: 'scale(1.15)' },
              }}
            />
          )
        })}
      </Box>
    </Box>
  )
}

function LogoPicker({ id, style, onPick }: {
  id: number; style: IconStyle; onPick: (k: LogoVariantKey) => void
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
      <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, width: 66, flexShrink: 0, opacity: 0.7 }}>
        Logo
      </Typography>
      <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
        {LOGO_VARIANTS.map(v => {
          const active = v.key === style.logo
          return (
            <Box key={v.key} onClick={() => onPick(v.key)} title={v.label} sx={{ cursor: 'pointer', textAlign: 'center' }}>
              <Box sx={{
                width: 34, height: 34, borderRadius: '50%',
                bgcolor: style.bg,
                border: `2px solid ${active ? '#4ea1ff' : style.ring}`,
                boxShadow: active ? '0 0 0 2px rgba(78,161,255,0.35)' : 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                overflow: 'hidden', mx: 'auto',
                transition: 'transform 0.1s',
                '&:hover': { transform: 'scale(1.1)' },
              }}>
                <Box component="img" src={teamLogoUrl(id, v.key)} alt={v.label}
                  sx={{ width: 24, height: 24, objectFit: 'contain' }} />
              </Box>
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}

// A faithful mimic of the real standings row so choices are judged in context.
function RowPreview({ id, style, dark }: { id: number; style: IconStyle; dark: boolean }) {
  const rowBg   = dark ? '#17171b' : '#ffffff'
  const rowText = dark ? '#f2f2f2' : '#111'
  return (
    <Box sx={{
      display: 'flex', alignItems: 'center', gap: 1.25,
      px: 1.25, py: '9px', borderRadius: 1.5,
      bgcolor: rowBg,
      border: `1px solid ${dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}`,
      borderLeftWidth: 3, borderLeftColor: style.highlight,
    }}>
      <Box sx={{
        width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
        bgcolor: style.bg,
        border: `2.5px solid ${style.ring}`,
        boxShadow: `0 0 0 1px ${style.ring}30`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
      }}>
        <Box component="img" src={teamLogoUrl(id, style.logo)} alt={TEAM_ABBR[id]}
          sx={{ width: 20, height: 20, objectFit: 'contain', transform: logoTransform(style), transformOrigin: 'center' }} />
      </Box>
      <Typography sx={{ fontSize: '0.84rem', fontWeight: 700, color: rowText, lineHeight: 1.2 }}>
        {TEAM_NICKNAME[id] ?? TEAM_ABBR[id]}
      </Typography>
      <Box sx={{ flex: 1 }} />
      <Typography sx={{ fontSize: '0.8rem', fontWeight: 600, color: dark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.55)' }}>
        50–40
      </Typography>
    </Box>
  )
}

// ─── Crop overlay ─────────────────────────────────────────────────────────────
// Big popup for centering/zooming a logo within the bubble, with dashed
// centerlines. Arrow keys nudge, +/- zoom, Esc closes.

function ArrowBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <Box onClick={onClick} sx={{
      width: 38, height: 38, borderRadius: 1.5, cursor: 'pointer', userSelect: 'none',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: '1.1rem', fontWeight: 800, lineHeight: 1,
      bgcolor: 'rgba(255,255,255,0.1)', color: '#fff',
      border: '1px solid rgba(255,255,255,0.2)',
      '&:hover': { bgcolor: 'rgba(255,255,255,0.2)' },
    }}>
      {children}
    </Box>
  )
}

function CropOverlay({ id, style, onChange, onClose }: {
  id: number; style: IconStyle; onChange: (s: IconStyle) => void; onClose: () => void
}) {
  const nudge  = (dx: number, dy: number) => onChange({ ...style, ox: clamp(style.ox + dx, -OFFSET_MAX, OFFSET_MAX), oy: clamp(style.oy + dy, -OFFSET_MAX, OFFSET_MAX) })
  const zoomBy = (dz: number) => onChange({ ...style, zoom: clamp(round1(style.zoom + dz), ZOOM_MIN, ZOOM_MAX) })
  const recenter = () => onChange({ ...style, ox: 0, oy: 0 })
  const resetAll = () => onChange({ ...style, ox: 0, oy: 0, zoom: 1 })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if      (e.key === 'ArrowLeft')  { nudge(-NUDGE_STEP, 0); e.preventDefault() }
      else if (e.key === 'ArrowRight') { nudge(NUDGE_STEP, 0);  e.preventDefault() }
      else if (e.key === 'ArrowUp')    { nudge(0, -NUDGE_STEP); e.preventDefault() }
      else if (e.key === 'ArrowDown')  { nudge(0, NUDGE_STEP);  e.preventDefault() }
      else if (e.key === '+' || e.key === '=') zoomBy(ZOOM_STEP)
      else if (e.key === '-' || e.key === '_') zoomBy(-ZOOM_STEP)
      else if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const lineSx = { position: 'absolute' as const, bgcolor: 'transparent', pointerEvents: 'none' as const, zIndex: 2 }

  return (
    <Box onClick={onClose} sx={{
      position: 'fixed', inset: 0, zIndex: 2700, bgcolor: 'rgba(0,0,0,0.78)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2,
    }}>
      <Box onClick={e => e.stopPropagation()} sx={{
        bgcolor: '#1b1b1f', color: '#eee', borderRadius: 2, border: '1px solid rgba(255,255,255,0.14)',
        p: 2.5, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, maxWidth: '94vw',
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: 2 }}>
          <Typography sx={{ fontWeight: 800, fontSize: '0.95rem' }}>Adjust crop: {TEAM_NICKNAME[id] ?? TEAM_ABBR[id]}</Typography>
          <StudioButton onClick={onClose}>Done</StudioButton>
        </Box>

        {/* Big bubble with dashed centerlines */}
        <Box sx={{ position: 'relative', width: 280, height: 280 }}>
          <Box sx={{
            width: '100%', height: '100%', borderRadius: '50%',
            bgcolor: style.bg, border: `5px solid ${style.ring}`,
            overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Box component="img" src={teamLogoUrl(id, style.logo)} alt={TEAM_ABBR[id]}
              sx={{ width: '72%', height: '72%', objectFit: 'contain', transform: logoTransform(style), transformOrigin: 'center' }} />
          </Box>
          {/* dashed cross through the center */}
          <Box sx={{ ...lineSx, top: 0, bottom: 0, left: '50%', borderLeft: '1.5px dashed #ff3b8b', transform: 'translateX(-50%)' }} />
          <Box sx={{ ...lineSx, left: 0, right: 0, top: '50%', borderTop: '1.5px dashed #ff3b8b', transform: 'translateY(-50%)' }} />
        </Box>

        {/* Readout */}
        <Typography sx={{ fontSize: '0.72rem', opacity: 0.7, fontFamily: 'ui-monospace, monospace' }}>
          x {style.ox}  ·  y {style.oy}  ·  zoom {style.zoom.toFixed(1)}×
        </Typography>

        {/* Controls: d-pad + zoom */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap', justifyContent: 'center' }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 38px)', gridTemplateRows: 'repeat(3, 38px)', gap: 0.75 }}>
            <Box /><ArrowBtn onClick={() => nudge(0, -NUDGE_STEP)}>↑</ArrowBtn><Box />
            <ArrowBtn onClick={() => nudge(-NUDGE_STEP, 0)}>←</ArrowBtn>
            <ArrowBtn onClick={recenter}>⊙</ArrowBtn>
            <ArrowBtn onClick={() => nudge(NUDGE_STEP, 0)}>→</ArrowBtn>
            <Box /><ArrowBtn onClick={() => nudge(0, NUDGE_STEP)}>↓</ArrowBtn><Box />
          </Box>
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.75 }}>
            <Box sx={{ display: 'flex', gap: 0.75 }}>
              <ArrowBtn onClick={() => zoomBy(-ZOOM_STEP)}>−</ArrowBtn>
              <ArrowBtn onClick={() => zoomBy(ZOOM_STEP)}>＋</ArrowBtn>
            </Box>
            <Typography sx={{ fontSize: '0.58rem', opacity: 0.6, textTransform: 'uppercase', letterSpacing: 0.6 }}>zoom</Typography>
          </Box>
          <StudioButton onClick={resetAll}>Reset crop</StudioButton>
        </Box>
        <Typography sx={{ fontSize: '0.6rem', opacity: 0.45 }}>Arrow keys nudge · + / − zoom · Esc closes</Typography>
      </Box>
    </Box>
  )
}

// ─── Team card ────────────────────────────────────────────────────────────────

function TeamCard({ id, style, dark, onChange }: {
  id: number; style: IconStyle; dark: boolean; onChange: (s: IconStyle) => void
}) {
  const swatches = swatchesFor(id)
  const [cropping, setCropping] = useState(false)
  const cropped = style.ox !== 0 || style.oy !== 0 || style.zoom !== 1
  return (
    <Box sx={{
      borderRadius: 2, p: 1.5,
      bgcolor: dark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
      border: '1px solid', borderColor: dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
    }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75, mb: 1 }}>
        <Typography sx={{ fontSize: '0.9rem', fontWeight: 800 }}>{TEAM_NICKNAME[id] ?? TEAM_ABBR[id]}</Typography>
        <Typography sx={{ fontSize: '0.62rem', opacity: 0.5, fontWeight: 700 }}>{TEAM_ABBR[id]} · {id}</Typography>
        <Box sx={{ flex: 1 }} />
        <Box onClick={() => setCropping(true)} sx={{
          fontSize: '0.62rem', fontWeight: 700, cursor: 'pointer', userSelect: 'none',
          px: 0.9, py: 0.35, borderRadius: 999,
          border: '1px solid', borderColor: cropped ? '#4ea1ff' : 'rgba(128,128,128,0.4)',
          color: cropped ? '#4ea1ff' : 'inherit', opacity: cropped ? 1 : 0.75,
          '&:hover': { opacity: 1 },
        }}>
          ✥ Crop{cropped ? ' •' : ''}
        </Box>
      </Box>

      <Box sx={{ mb: 1.25 }}>
        <RowPreview id={id} style={style} dark={dark} />
      </Box>

      <SwatchRow label="Background" colors={swatches} value={style.bg}        onPick={c => onChange({ ...style, bg: c })} />
      <SwatchRow label="Ring"       colors={swatches} value={style.ring}      onPick={c => onChange({ ...style, ring: c })} />
      <SwatchRow label="Highlight"  colors={swatches} value={style.highlight} onPick={c => onChange({ ...style, highlight: c })} />
      <LogoPicker id={id} style={style} onPick={k => onChange({ ...style, logo: k })} />

      {cropping && <CropOverlay id={id} style={style} onChange={onChange} onClose={() => setCropping(false)} />}
    </Box>
  )
}

// ─── Export panel ─────────────────────────────────────────────────────────────

function buildExport(styles: Record<number, IconStyle>, constName: string): string {
  const lines = TEAM_IDS.map(id => {
    const s = styles[id]
    const abbr = TEAM_ABBR[id]
    let crop = ''
    if (s.ox !== 0) crop += `, ox: ${s.ox}`
    if (s.oy !== 0) crop += `, oy: ${s.oy}`
    if (s.zoom !== 1) crop += `, zoom: ${s.zoom}`
    return `  [${abbr}]:${' '.repeat(Math.max(1, 4 - abbr.length))}{ bg: '${s.bg.toUpperCase()}', ring: '${s.ring.toUpperCase()}', highlight: '${s.highlight.toUpperCase()}', logo: '${s.logo}'${crop} },`
  })
  return `export const ${constName}: Record<number, TeamIconStyle> = {\n${lines.join('\n')}\n}`
}

function ExportOverlay({ text, onClose }: { text: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const copy = useCallback(() => {
    navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })
  }, [text])
  return (
    <Box onClick={onClose} sx={{
      position: 'fixed', inset: 0, zIndex: 2600, bgcolor: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2,
    }}>
      <Box onClick={e => e.stopPropagation()} sx={{
        width: 'min(720px, 94vw)', maxHeight: '86vh', display: 'flex', flexDirection: 'column',
        bgcolor: '#1b1b1f', color: '#eee', borderRadius: 2, border: '1px solid rgba(255,255,255,0.14)', overflow: 'hidden',
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, py: 1.25, borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
          <Typography sx={{ fontWeight: 800, fontSize: '0.9rem' }}>Export: paste this to lock in values</Typography>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <StudioButton onClick={copy}>{copied ? 'Copied ✓' : 'Copy'}</StudioButton>
            <StudioButton onClick={onClose}>Close</StudioButton>
          </Box>
        </Box>
        <Box component="textarea" readOnly value={text} sx={{
          flex: 1, m: 0, p: 2, border: 'none', outline: 'none', resize: 'none',
          bgcolor: '#0e0e10', color: '#c8e1ff', fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
          fontSize: '0.72rem', lineHeight: 1.5, whiteSpace: 'pre',
        }} />
      </Box>
    </Box>
  )
}

// ─── Shared button ────────────────────────────────────────────────────────────

function StudioButton({ children, onClick, accent }: { children: React.ReactNode; onClick: () => void; accent?: boolean }) {
  return (
    <Box onClick={onClick} sx={{
      px: 1.5, py: 0.6, borderRadius: 999, cursor: 'pointer', userSelect: 'none',
      fontSize: '0.72rem', fontWeight: 700, lineHeight: 1, whiteSpace: 'nowrap',
      bgcolor: accent ? '#2f6df6' : 'rgba(255,255,255,0.1)',
      color: '#fff',
      border: '1px solid', borderColor: accent ? '#2f6df6' : 'rgba(255,255,255,0.2)',
      transition: 'background 0.12s',
      '&:hover': { bgcolor: accent ? '#4d84ff' : 'rgba(255,255,255,0.18)' },
    }}>
      {children}
    </Box>
  )
}

// ─── Studio root ──────────────────────────────────────────────────────────────

export default function IconStudio({ onClose }: { onClose: () => void }) {
  const [all, setAll] = useState<ModeStyles>(loadStyles)
  const [dark, setDark] = useState(true)
  const [exportText, setExportText] = useState<string | null>(null)

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(all)) } catch { /* ignore */ }
  }, [all])

  const modeKey = dark ? 'dark' : 'light'
  const active = all[modeKey]

  const setTeam = useCallback((id: number, s: IconStyle) => {
    setAll(prev => ({ ...prev, [modeKey]: { ...prev[modeKey], [id]: s } }))
  }, [modeKey])

  const resetAll = useCallback(() => {
    if (confirm(`Reset every team's ${modeKey}-mode values back to the defaults?`)) {
      const fresh: Record<number, IconStyle> = {}
      for (const id of TEAM_IDS) fresh[id] = defaultStyle(id, dark)
      setAll(prev => ({ ...prev, [modeKey]: fresh }))
    }
  }, [modeKey, dark])

  const canvasBg = dark ? '#0e0e10' : '#f5f5f7'
  const canvasFg = dark ? '#f2f2f2' : '#141414'

  const cards = useMemo(() => TEAM_IDS.map(id => (
    <TeamCard key={id} id={id} style={active[id]} dark={dark} onChange={s => setTeam(id, s)} />
  )), [active, dark, setTeam])

  return (
    <Box sx={{
      position: 'fixed', inset: 0, zIndex: 2500,
      bgcolor: canvasBg, color: canvasFg,
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Sticky header */}
      <Box sx={{
        display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap',
        px: 2, py: 1.25, borderBottom: '1px solid', borderColor: dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)',
        bgcolor: canvasBg, position: 'sticky', top: 0, zIndex: 2,
      }}>
        <Typography sx={{ fontWeight: 900, fontSize: '1rem', letterSpacing: '-0.3px' }}>🎨 Icon Studio</Typography>
        <Typography sx={{ fontSize: '0.66rem', opacity: 0.55, fontWeight: 600 }}>
          dev only · editing <b>{dark ? 'DARK' : 'LIGHT'}</b> · saved locally
        </Typography>
        <Box sx={{ flex: 1 }} />
        <StudioButton onClick={() => setDark(d => !d)}>{dark ? '☀ Edit light mode' : '🌙 Edit dark mode'}</StudioButton>
        <StudioButton onClick={resetAll}>Reset {modeKey}</StudioButton>
        <StudioButton accent onClick={() => setExportText(buildExport(active, dark ? 'TEAM_ICON_STYLE' : 'TEAM_ICON_STYLE_LIGHT'))}>Export {modeKey}</StudioButton>
        <StudioButton onClick={onClose}>✕ Close</StudioButton>
      </Box>

      {/* Scrollable grid */}
      <Box sx={{ flex: 1, overflowY: 'auto', p: 2 }}>
        <Box sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: '1fr 1fr', xl: '1fr 1fr 1fr' },
          gap: 1.5, maxWidth: 1400, mx: 'auto',
        }}>
          {cards}
        </Box>
      </Box>

      {exportText && <ExportOverlay text={exportText} onClose={() => setExportText(null)} />}
    </Box>
  )
}
