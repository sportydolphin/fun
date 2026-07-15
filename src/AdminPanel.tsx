import React, { useEffect, useState } from 'react'
import {
  Dialog, DialogTitle, DialogContent, IconButton,
  Box, Typography, Divider, CircularProgress, Button,
} from '@mui/material'
import { Close, Lock } from '@mui/icons-material'
import { supabase } from './lib/supabase'
import { isSubscribed } from './lib/push'

// ─── Types ────────────────────────────────────────────────────────────────────

interface PayrollRow { updated_at: string; season: number }
interface StatRow    { display_name: string; accuracy_pct: number; correct_predictions: number; total_predictions: number }
interface AppTile     { label: string; emoji: string; desc: string; path: string; color: string }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const h = Math.floor(diff / 3_600_000)
  if (h < 1)  return 'just now'
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function FreshnessChip({ updatedAt }: { updatedAt: string }) {
  const ageH = (Date.now() - new Date(updatedAt).getTime()) / 3_600_000
  const fresh = ageH < 26
  return (
    <Box sx={{
      display: 'inline-flex', alignItems: 'center', gap: 0.5,
      px: 1, py: 0.25, borderRadius: 999,
      bgcolor: fresh ? '#22c55e18' : '#f9731618',
      border: '1px solid', borderColor: fresh ? '#22c55e40' : '#f9731640',
    }}>
      <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: fresh ? '#22c55e' : '#f97316' }} />
      <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, color: fresh ? '#22c55e' : '#f97316' }}>
        {fresh ? 'Fresh' : 'Stale'}
      </Typography>
    </Box>
  )
}

// ─── Stat row ─────────────────────────────────────────────────────────────────

function StatRow({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 0.9 }}>
      <Box>
        <Typography sx={{ fontSize: '0.82rem', fontWeight: 600 }}>{label}</Typography>
        {sub && <Typography sx={{ fontSize: '0.68rem', color: 'text.disabled', mt: 0.1 }}>{sub}</Typography>}
      </Box>
      <Box sx={{ textAlign: 'right' }}>{value}</Box>
    </Box>
  )
}

// ─── Section header ───────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box sx={{ mb: 2.5 }}>
      <Typography sx={{ fontSize: '0.65rem', fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase', color: 'text.disabled', mb: 1 }}>
        {title}
      </Typography>
      <Box sx={{ borderRadius: 2, border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
        {children}
      </Box>
    </Box>
  )
}

// ─── Quick link button ────────────────────────────────────────────────────────

function QuickLink({ label, href, emoji }: { label: string; href: string; emoji: string }) {
  return (
    <Box
      component="a" href={href} target="_blank" rel="noopener noreferrer"
      sx={{
        display: 'flex', alignItems: 'center', gap: 1.25,
        px: 1.5, py: 1.1, textDecoration: 'none',
        '&:hover': { bgcolor: 'action.hover' },
        '&:not(:last-child)': { borderBottom: '1px solid', borderColor: 'divider' },
      }}
    >
      <Typography sx={{ fontSize: '1rem', lineHeight: 1 }}>{emoji}</Typography>
      <Typography sx={{ fontSize: '0.82rem', fontWeight: 600, color: 'text.primary' }}>{label}</Typography>
      <Typography sx={{ ml: 'auto', fontSize: '0.72rem', color: 'text.disabled' }}>↗</Typography>
    </Box>
  )
}

// ─── Other apps tile grid ──────────────────────────────────────────────────────

function AppGrid({ apps, isAppLocked, onOpenApp }: {
  apps: AppTile[]
  isAppLocked: (path: string) => boolean
  onOpenApp: (path: string) => void
}) {
  return (
    <Box sx={{ p: 1, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1 }}>
      {apps.map(a => {
        const locked = isAppLocked(a.path)
        return (
          <Box
            key={a.path}
            onClick={() => onOpenApp(a.path)}
            sx={{
              bgcolor: a.color, borderRadius: 2, p: 1.25,
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.4,
              cursor: 'pointer', userSelect: 'none', position: 'relative',
              transition: 'transform 0.15s ease',
              '&:hover': { transform: 'translateY(-2px)' },
            }}
          >
            {locked && (
              <Box sx={{ position: 'absolute', top: 4, right: 4, bgcolor: 'rgba(0,0,0,0.25)', borderRadius: '50%', width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Lock sx={{ fontSize: '0.55rem', color: 'rgba(255,255,255,0.9)' }} />
              </Box>
            )}
            <Typography sx={{ fontSize: '1.3rem', lineHeight: 1 }}>{a.emoji}</Typography>
            <Typography sx={{ color: '#fff', fontWeight: 700, fontSize: '0.68rem', textAlign: 'center', lineHeight: 1.2 }}>
              {a.label}
            </Typography>
          </Box>
        )
      })}
    </Box>
  )
}

// ─── Test-notification section ──────────────────────────────────────────────
// Fires the send-test-push edge function, which pushes a test notification to
// the current user's own devices regardless of whether there are games today.

function TestNotificationSection({ open }: { open: boolean }) {
  const [subscribedHere, setSubscribedHere] = useState<boolean | null>(null)
  const [status, setStatus] = useState<'idle' | 'sending' | 'done' | 'error'>('idle')
  const [msg, setMsg]       = useState('')

  useEffect(() => {
    if (!open) return
    setStatus('idle'); setMsg('')
    isSubscribed().then(setSubscribedHere).catch(() => setSubscribedHere(false))
  }, [open])

  const sendTest = async () => {
    setStatus('sending'); setMsg('')
    const { data, error } = await supabase.functions.invoke('send-test-push')
    if (error) {
      let m = 'Send failed. Is the send-test-push function deployed with VAPID secrets set?'
      try {
        const body = await (error as { context?: Response }).context?.json?.()
        if (body?.error) m = body.error
      } catch { /* keep default */ }
      setMsg(m); setStatus('error')
      return
    }
    const sent = (data as { sent?: number })?.sent ?? 0
    const devices = (data as { devices?: number })?.devices ?? 0
    setMsg(sent > 0
      ? `Sent to ${sent}/${devices} device(s). Check your notifications.`
      : `No device accepted the push (0/${devices}). Your subscription may be stale — toggle reminders off/on in Settings.`)
    setStatus(sent > 0 ? 'done' : 'error')
  }

  return (
    <Section title="Notifications">
      <Box sx={{ p: 1.5 }}>
        <Button
          fullWidth variant="outlined"
          onClick={sendTest}
          disabled={status === 'sending'}
          sx={{ textTransform: 'none', fontWeight: 700 }}
        >
          {status === 'sending' ? 'Sending…' : '🔔 Send test notification to me'}
        </Button>
        {subscribedHere === false && status === 'idle' && (
          <Typography sx={{ fontSize: '0.68rem', color: 'text.disabled', mt: 0.75, lineHeight: 1.4 }}>
            This device isn’t subscribed yet — enable “Daily pick reminders” in Settings first. (The test still reaches any other device you’ve subscribed.)
          </Typography>
        )}
        {msg && (
          <Typography sx={{
            fontSize: '0.72rem', mt: 0.75, lineHeight: 1.4,
            color: status === 'error' ? 'error.main' : 'success.main',
          }}>
            {msg}
          </Typography>
        )}
      </Box>
    </Section>
  )
}

// ─── Admin Panel ──────────────────────────────────────────────────────────────

export function AdminPanel({ open, onClose, apps, isAppLocked, onOpenApp }: {
  open: boolean
  onClose: () => void
  apps: AppTile[]
  isAppLocked: (path: string) => boolean
  onOpenApp: (path: string) => void
}) {
  const [payrolls, setPayrolls]   = useState<PayrollRow[] | null>(null)
  const [predCount, setPredCount] = useState<number | null>(null)
  const [botStats, setBotStats]   = useState<StatRow[] | null>(null)
  const [loading, setLoading]     = useState(false)

  useEffect(() => {
    if (!open) return
    setLoading(true)

    Promise.all([
      // Most-recent payroll update per season
      supabase.from('team_payrolls')
        .select('season, updated_at')
        .order('updated_at', { ascending: false })
        .limit(1),

      // Total prediction count
      supabase.from('game_predictions')
        .select('*', { count: 'exact', head: true }),

      // Bot + user leaderboard stats
      supabase.from('prediction_stats')
        .select('display_name, accuracy_pct, correct_predictions, total_predictions')
        .order('accuracy_pct', { ascending: false })
        .limit(10),
    ]).then(([pr, pc, bs]) => {
      setPayrolls((pr.data ?? []) as PayrollRow[])
      setPredCount(pc.count ?? 0)
      setBotStats((bs.data ?? []) as StatRow[])
    }).finally(() => setLoading(false))
  }, [open])

  const latestPayroll = payrolls?.[0]

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth
      PaperProps={{ sx: { borderRadius: 3 } }}>

      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pb: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography sx={{ fontSize: '1rem', fontWeight: 800 }}>⚡ Admin</Typography>
          <Box sx={{ px: 1, py: 0.2, borderRadius: 999, bgcolor: 'warning.main', opacity: 0.9 }}>
            <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, color: '#000', letterSpacing: 0.5 }}>OWNER</Typography>
          </Box>
        </Box>
        <IconButton size="small" onClick={onClose} sx={{ color: 'text.secondary' }}>
          <Close sx={{ fontSize: '1.1rem' }} />
        </IconButton>
      </DialogTitle>

      <Divider />

      <DialogContent sx={{ pt: 2.5 }}>
        {/* ── Other apps ─────────────────────────────────────────────── */}
        <Section title="Other Apps">
          <AppGrid apps={apps} isAppLocked={isAppLocked} onOpenApp={onOpenApp} />
        </Section>

        {/* ── Test notification ──────────────────────────────────────── */}
        <TestNotificationSection open={open} />

        {loading ? (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <CircularProgress size={24} />
          </Box>
        ) : (
          <>
            {/* ── Payroll data ─────────────────────────────────────────── */}
            <Section title="Payroll Data">
              {latestPayroll ? (
                <Box sx={{ px: 1.5 }}>
                  <StatRow
                    label={`${latestPayroll.season} season`}
                    sub={`Updated ${timeAgo(latestPayroll.updated_at)}`}
                    value={<FreshnessChip updatedAt={latestPayroll.updated_at} />}
                  />
                </Box>
              ) : (
                <Box sx={{ px: 1.5, py: 1 }}>
                  <Typography sx={{ fontSize: '0.8rem', color: 'text.disabled' }}>
                    No payroll data — run <code>npm run payrolls</code>
                  </Typography>
                </Box>
              )}
            </Section>

            {/* ── Prediction activity ───────────────────────────────────── */}
            <Section title="Prediction Activity">
              <Box sx={{ px: 1.5 }}>
                <StatRow
                  label="Total predictions"
                  value={<Typography sx={{ fontSize: '0.88rem', fontWeight: 700 }}>{predCount?.toLocaleString() ?? '—'}</Typography>}
                />
              </Box>
            </Section>

            {/* ── Leaderboard ───────────────────────────────────────────── */}
            {botStats && botStats.length > 0 && (
              <Section title="Prediction Leaderboard">
                <Box sx={{ px: 1.5 }}>
                  {botStats.map((s, i) => (
                    <React.Fragment key={s.display_name}>
                      {i > 0 && <Divider />}
                      <StatRow
                        label={s.display_name}
                        sub={`${s.correct_predictions}/${s.total_predictions} correct`}
                        value={
                          <Typography sx={{ fontSize: '0.88rem', fontWeight: 700, color: s.accuracy_pct >= 55 ? 'success.main' : 'text.primary' }}>
                            {s.accuracy_pct}%
                          </Typography>
                        }
                      />
                    </React.Fragment>
                  ))}
                </Box>
              </Section>
            )}

            {/* ── Quick links ───────────────────────────────────────────── */}
            <Section title="Quick Links">
              <QuickLink emoji="🔄" label="GitHub Actions — Run workflows" href="https://github.com/sportydolphin/fun/actions" />
              <QuickLink emoji="🗄️" label="Supabase Dashboard" href="https://supabase.com/dashboard" />
              <QuickLink emoji="📦" label="GitHub Repository" href="https://github.com/sportydolphin/fun" />
            </Section>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
