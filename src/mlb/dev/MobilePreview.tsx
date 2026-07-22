// ─── Dev-only mobile device preview ───────────────────────────────────────────
// Renders the whole app again inside a phone-sized <iframe>, wrapped in a device
// bezel, over a dimmed backdrop. Because the iframe is a real nested document,
// everything that keys off viewport width — CSS media queries, MUI `sx`
// breakpoints, useMediaQuery, window.innerWidth — resolves against the phone's
// dimensions rather than the desktop window's.
//
// Lazy-loaded and gated behind import.meta.env.DEV; see devDevice.ts.

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Box, Typography, Tooltip } from '@mui/material'
import {
  useDevDevice, setDeviceMode, setDevicePreset, toggleDeviceOrientation,
  currentPreset, DEVICE_PRESETS, FRAME_PARAM,
} from './devDevice'

// Room left for the toolbar above the phone + breathing space around it.
const CHROME_V = 132
const CHROME_H = 64
const BEZEL    = 12

export default function MobilePreview() {
  const device = useDevDevice()
  const preset = currentPreset(device)
  const [reloadKey, setReloadKey] = useState(0)

  const w = device.landscape ? preset.h : preset.w
  const h = device.landscape ? preset.w : preset.h

  // The framed app navigates independently, so the src is fixed at mount time —
  // recomputing it on every outer navigation would blow away the inner state.
  const src = useMemo(() => {
    const url = new URL(window.location.href)
    url.searchParams.set(FRAME_PARAM, '1')
    return url.toString()
  }, [reloadKey])

  // Shrink to fit when the phone is taller than the desktop window. A CSS
  // transform (not `zoom`) so the iframe's own viewport stays at native size.
  const [scale, setScale] = useState(1)
  useEffect(() => {
    const fit = () => setScale(Math.min(
      1,
      (window.innerHeight - CHROME_V) / (h + BEZEL * 2),
      (window.innerWidth  - CHROME_H) / (w + BEZEL * 2),
    ))
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [w, h])

  // Escape exits the simulation.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDeviceMode('desktop') }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Nothing behind the overlay should scroll while the phone is up.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  return createPortal(
    <Box sx={{
      position: 'fixed', inset: 0, zIndex: 2000,
      bgcolor: 'rgba(9,11,16,0.92)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1.5,
    }}>
      {/* Toolbar */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap', justifyContent: 'center', px: 2 }}>
        <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: '#f59e0b', mr: 0.5 }}>
          📱 Mobile sim
        </Typography>
        {DEVICE_PRESETS.map(d => (
          <ChromeButton key={d.id} active={d.id === preset.id} onClick={() => setDevicePreset(d.id)}>
            {d.label}
          </ChromeButton>
        ))}
        <Tooltip title="Rotate">
          <span><ChromeButton active={device.landscape} onClick={toggleDeviceOrientation}>⟳ Rotate</ChromeButton></span>
        </Tooltip>
        <ChromeButton onClick={() => setReloadKey(k => k + 1)}>↻ Reload</ChromeButton>
        <ChromeButton accent onClick={() => setDeviceMode('desktop')}>✕ Exit (Esc)</ChromeButton>
      </Box>

      {/* Device bezel */}
      <Box sx={{
        transform: `scale(${scale})`, transformOrigin: 'top center',
        // Keep the flex layout honest about the shrunken footprint.
        height: (h + BEZEL * 2) * scale, width: (w + BEZEL * 2) * scale,
        display: 'flex', justifyContent: 'center',
      }}>
        <Box sx={{
          p: `${BEZEL}px`, borderRadius: `${BEZEL + 26}px`, bgcolor: '#111318',
          border: '1px solid #2c313c', boxShadow: '0 24px 70px rgba(0,0,0,0.6)',
          position: 'relative', flexShrink: 0,
        }}>
          {/* Notch */}
          <Box sx={{
            position: 'absolute', top: BEZEL + 6, left: '50%', transform: 'translateX(-50%)',
            width: 92, height: 20, borderRadius: 10, bgcolor: '#111318', zIndex: 1, pointerEvents: 'none',
            display: device.landscape ? 'none' : 'block',
          }} />
          <Box
            component="iframe"
            key={reloadKey}
            src={src}
            title="Mobile preview"
            sx={{ width: w, height: h, border: 0, borderRadius: '26px', bgcolor: 'background.default', display: 'block' }}
          />
        </Box>
      </Box>

      <Typography sx={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.45)', textAlign: 'center', px: 2 }}>
        {preset.label} · {w}×{h}{scale < 1 ? ` · shown at ${Math.round(scale * 100)}%` : ''} — real viewport, so breakpoints match a phone. Pointer is still a mouse, so `(hover: hover)` stays true.
      </Typography>
    </Box>,
    document.body,
  )
}

function ChromeButton({ children, onClick, active = false, accent = false }: {
  children: React.ReactNode
  onClick:  () => void
  active?:  boolean
  accent?:  boolean
}) {
  return (
    <Box
      onClick={onClick}
      sx={{
        px: 1.1, py: 0.5, borderRadius: 1.5, cursor: 'pointer', userSelect: 'none',
        fontSize: '0.68rem', fontWeight: 700, lineHeight: 1,
        border: '1px solid',
        borderColor: accent ? '#f59e0b' : active ? '#60a5fa' : 'rgba(255,255,255,0.18)',
        color:       accent ? '#f59e0b' : active ? '#60a5fa' : 'rgba(255,255,255,0.72)',
        bgcolor:     active ? 'rgba(96,165,250,0.12)' : 'transparent',
        '&:hover':   { borderColor: accent ? '#fbbf24' : '#93c5fd', color: accent ? '#fbbf24' : '#93c5fd' },
        transition: 'all 0.15s',
      }}
    >
      {children}
    </Box>
  )
}
