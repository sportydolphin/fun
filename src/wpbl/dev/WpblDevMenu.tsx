import { useState } from 'react'
import { Box, Typography, Button, Popover, Divider, Tooltip, CircularProgress } from '@mui/material'
import { SegNav } from '../ui'
import {
  useDevLive, enableDevLive, disableDevLive, regenerateDevLive, finalizeDevLive,
  stepDevLive, startAutoplay, stopAutoplay, setAutoplaySpeed,
} from './devLive'

// Dev-only floating menu (rendered only when import.meta.env.DEV) that fabricates a live
// WPBL game so the live hero / Game Center / play-by-play can be exercised locally with
// no real game in Supabase. Mirrors the MLB dev settings pattern (src/MlbStats.tsx).

const SPEEDS: { label: string; ms: number }[] = [
  { label: 'Fast', ms: 1500 }, { label: 'Med', ms: 3500 }, { label: 'Slow', ms: 7000 },
]

export default function WpblDevMenu() {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [busy, setBusy] = useState(false)
  const sim = useDevLive()
  const g = sim.game

  const withBusy = (fn: () => Promise<void> | void) => async () => { setBusy(true); await fn(); setBusy(false) }

  const statusLine = !g ? '' :
    g.status === 'final'
      ? `Final · ${g.away_score}–${g.home_score} · ${sim.plays.length} plays`
      : `${g.live_half === 'top' ? 'Top' : 'Bot'} ${g.live_inning} · ${g.away_score}–${g.home_score} · ${g.live_outs} out · ${sim.plays.length} plays`

  return (
    <>
      <Tooltip title="WPBL dev tools (local only)">
        <Box
          onClick={e => setAnchor(e.currentTarget)}
          sx={{
            position: 'fixed', bottom: 16, right: 16, zIndex: 1800,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 40, height: 40, borderRadius: '50%', cursor: 'pointer',
            bgcolor: 'background.paper', color: sim.enabled ? '#ef4444' : (anchor ? 'warning.main' : 'text.disabled'),
            border: '1px solid', borderColor: sim.enabled ? '#ef4444' : (anchor ? 'warning.main' : 'divider'),
            boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
            '&:hover': { color: 'warning.main', borderColor: 'warning.main' },
            transition: 'color 0.15s, border-color 0.15s',
          }}
        >
          <Typography sx={{ fontSize: '1.15rem', lineHeight: 1 }}>🧪</Typography>
        </Box>
      </Tooltip>

      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        PaperProps={{ sx: { borderRadius: 2.5, p: 2, mb: 1, width: 270, boxShadow: '0 8px 32px rgba(0,0,0,0.2)' } }}
      >
        <Typography sx={{ fontSize: '0.62rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: 'warning.main', mb: 1.5 }}>
          🧪 WPBL Dev · local only
        </Typography>

        <Typography sx={{ fontSize: '0.78rem', fontWeight: 600, color: 'text.secondary', mb: 0.75 }}>
          Live game simulator
        </Typography>
        <SegNav
          options={[{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }]}
          value={sim.enabled ? 'on' : 'off'}
          onChange={withBusy(() => (sim.enabled ? disableDevLive() : enableDevLive()))}
        />

        {sim.enabled && g && (
          <Box sx={{ mt: 1.25, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
            <Typography sx={{ fontSize: '0.7rem', color: 'text.disabled' }}>
              {g.away_team_id} @ {g.home_team_id} · {statusLine}
            </Typography>

            {g.status === 'live' && (
              <>
                <SegNav
                  options={[{ value: 'play', label: '▶ Auto' }, { value: 'pause', label: '⏸ Pause' }]}
                  value={sim.autoplay ? 'play' : 'pause'}
                  onChange={v => (v === 'play' ? startAutoplay() : stopAutoplay())}
                />
                <Box sx={{ display: 'flex', gap: 0.5 }}>
                  {SPEEDS.map(s => (
                    <Button key={s.ms} size="small" variant={sim.speedMs === s.ms ? 'contained' : 'outlined'}
                      onClick={() => setAutoplaySpeed(s.ms)} sx={{ textTransform: 'none', fontSize: '0.68rem', flex: 1, minWidth: 0 }}>
                      {s.label}
                    </Button>
                  ))}
                </Box>
                <Button fullWidth size="small" variant="outlined" onClick={() => stepDevLive()} sx={{ textTransform: 'none', fontWeight: 600 }}>
                  ⏭ Step one play
                </Button>
                <Button fullWidth size="small" variant="outlined" color="error" onClick={() => finalizeDevLive()} sx={{ textTransform: 'none', fontWeight: 600 }}>
                  🏁 End game (Final)
                </Button>
              </>
            )}

            <Button fullWidth size="small" variant="contained" disabled={busy} onClick={withBusy(() => regenerateDevLive())} sx={{ textTransform: 'none', fontWeight: 600 }}>
              {busy ? <CircularProgress size={16} color="inherit" /> : '🎲 New matchup'}
            </Button>
          </Box>
        )}

        <Divider sx={{ my: 1.5 }} />
        <Typography sx={{ fontSize: '0.66rem', color: 'text.disabled', lineHeight: 1.4 }}>
          Uses the two teams' real rosters + the live scoring engine. Open the home hero or Game Center to watch it update.
        </Typography>
      </Popover>
    </>
  )
}
