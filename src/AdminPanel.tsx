import React, { useEffect, useState } from 'react'
import {
  Dialog, DialogTitle, DialogContent, IconButton,
  Box, Typography, Divider, CircularProgress, Button,
} from '@mui/material'
import { Close, Lock, Check, Undo, DeleteOutline, MailOutline, PersonOffOutlined, RestartAlt, ContentCopy } from '@mui/icons-material'
import { supabase } from './lib/supabase'
import { isSubscribed } from './lib/push'
import { fetchFeedback, setFeedbackHandled, deleteFeedback, FeedbackRow } from './lib/feedback'
import { fetchAdminUsers, setUserDeleted, AdminUser } from './lib/adminUsers'

// ─── Types ────────────────────────────────────────────────────────────────────

interface PayrollRow { updated_at: string; season: number }
interface AppTile     { label: string; emoji: string; desc: string; path: string; color: string }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const h = Math.floor(diff / 3_600_000)
  if (h < 1)  return 'just now'
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// Minute-precision relative time — the WPBL feed cron runs every ~2 min, so hour-grained
// timeAgo would read "just now" almost always and hide whether the mirror is actually live.
function timeAgoMin(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
  if (m < 1)  return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`
}

// ─── Status pills ─────────────────────────────────────────────────────────────
//
// Four pipelines report health here and each used to rebuild the same pill markup with its
// own colour literals, which is how three of them ended up with subtly different padding.
// One primitive renders the pill; each pipeline contributes a pure `Status`. Pure because
// the thresholds ARE the feature: a job that quietly stopped still looking healthy is the
// failure mode, so they are unit-tested rather than eyeballed.

export type Tone = 'ok' | 'warn' | 'bad' | 'idle'
export interface Status { tone: Tone; label: string }

const TONE: Record<Tone, string> = {
  ok:   '#22c55e',
  warn: '#f97316',
  bad:  '#ef4444',
  idle: '#94a3b8',
}

export function StatusPill({ tone, label, title }: Status & { title?: string }) {
  const color = TONE[tone]
  return (
    <Box title={title} sx={{
      display: 'inline-flex', alignItems: 'center', gap: 0.5,
      px: 1, py: 0.25, borderRadius: 999,
      bgcolor: `${color}18`, border: '1px solid', borderColor: `${color}40`,
    }}>
      <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: color }} />
      <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, color }}>{label}</Typography>
    </Box>
  )
}

/** Payrolls refresh daily; 26h rather than 24 so a cron that slips an hour isn't amber. */
export function payrollStatus(updatedAt: string): Status {
  const ageH = (Date.now() - new Date(updatedAt).getTime()) / 3_600_000
  return ageH < 26 ? { tone: 'ok', label: 'Fresh' } : { tone: 'warn', label: 'Stale' }
}

// WPBL feed-mirror ingest health, consolidated here from the WPBL home header. Cron runs
// ~every 2 min: green = fresh + clean, amber = stale (>6 min) or per-game errors on the
// last run, red = the last run failed outright.
interface WpblRunRow { ran_at: string; ok: boolean; mode: string | null; games: number; boxscores: number; error_count: number }
export function ingestStatus(run: WpblRunRow): Status {
  const stale = Date.now() - new Date(run.ran_at).getTime() > 6 * 60_000
  if (!run.ok) return { tone: 'bad', label: 'Failed' }
  if (run.error_count > 0) return { tone: 'warn', label: 'Errors' }
  return stale ? { tone: 'warn', label: 'Stale' } : { tone: 'ok', label: 'Fresh' }
}

// Nightly play-by-play validation health. The counts matter less than the freshness: the job
// deliberately never fails on findings (most are known and are not going anywhere), so the
// only thing that needs attention here is the run going missing.
//
// Stale at 26h rather than 24: the schedule is daily and GitHub's cron is best-effort, so a
// run that slips an hour under load is not worth an amber chip.
export interface WpblValidationRow { ran_at: string; ok: boolean; new_findings: number; total_findings: number }
export function validationStatus(run: WpblValidationRow): Status {
  const stale = Date.now() - new Date(run.ran_at).getTime() > 26 * 60 * 60_000
  if (!run.ok) return { tone: 'bad', label: 'Failed' }
  if (stale) return { tone: 'warn', label: 'Stale' }
  return run.new_findings > 0
    ? { tone: 'warn', label: `${run.new_findings} new` }
    : { tone: 'ok', label: 'Clean' }
}

// TrackMan publishing health. Unlike the two above this is not about OUR job failing: the
// watcher runs nightly and will keep reporting whatever it finds. It is about the LEAGUE,
// which published pitch tracking for two games and then stopped.
//
// So "behind" is the normal state and is deliberately not red. Red would train the eye to
// ignore this row over the weeks it is expected to sit there. What earns attention is the
// good news: green when the feed has caught up with the schedule, which is the thing the
// Home teaser card used to be watching for before it hid itself permanently.
export interface WpblTrackingRow {
  last_tracked_game_date: string | null
  tracked_game_count: number
  last_final_game_date: string | null
  last_checked_at: string | null
  last_advanced_at: string | null
}
export function trackingStatus(row: WpblTrackingRow): Status {
  const lagDays = row.last_tracked_game_date && row.last_final_game_date
    ? Math.round((Date.parse(row.last_final_game_date + 'T00:00:00Z')
                - Date.parse(row.last_tracked_game_date + 'T00:00:00Z')) / 86_400_000)
    : null
  // Stale at 50h, not 26 like the nightly validator: this is a daily job whose findings do
  // not change for weeks, so one missed run is not worth flagging.
  const watcherStale = !row.last_checked_at || Date.now() - Date.parse(row.last_checked_at) > 50 * 60 * 60_000
  if (watcherStale) return { tone: 'warn', label: 'Watcher stale' }
  if (lagDays == null) return { tone: 'idle', label: 'No data' }
  return lagDays <= 0
    ? { tone: 'ok', label: 'Current' }
    : { tone: 'idle', label: `${lagDays}d behind` }
}

/** Kept as a component because a test renders it directly. */
export function WpblValidationChip({ run }: { run: WpblValidationRow }) {
  return <StatusPill {...validationStatus(run)} />
}

// ─── Stat row ─────────────────────────────────────────────────────────────────

export function StatRow({ label, value, sub }: { label: React.ReactNode; value: React.ReactNode; sub?: React.ReactNode }) {
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

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
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

function TestNotificationSection() {
  const [subscribedHere, setSubscribedHere] = useState<boolean | null>(null)
  const [status, setStatus] = useState<'idle' | 'sending' | 'done' | 'error'>('idle')
  const [msg, setMsg]       = useState('')

  useEffect(() => {
    isSubscribed().then(setSubscribedHere).catch(() => setSubscribedHere(false))
  }, [])

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
      : `No device accepted the push (0/${devices}). Your subscription may be stale. Toggle reminders off and back on in Settings.`)
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
            This device isn’t subscribed yet. Enable “Daily pick reminders” in Settings first. (The test still reaches any other device you’ve subscribed.)
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

// ─── Feedback section ─────────────────────────────────────────────────────────
// The owner's queue for footer "Send feedback" submissions. RLS scopes reads/edits
// to the owner (scripts/create_feedback.sql), so this only ever shows data to them.

function FeedbackRowItem({ row, busy, onToggleHandled, onDelete }: {
  row:             FeedbackRow
  busy:            boolean
  onToggleHandled: () => void
  onDelete:        () => void
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const handled = row.handled_at != null

  return (
    <Box sx={{ px: 1.5, py: 1.1, opacity: handled ? 0.55 : 1 }}>
      {/* Message */}
      <Typography sx={{
        fontSize: '0.82rem', lineHeight: 1.4, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        textDecoration: handled ? 'line-through' : 'none',
      }}>
        {row.message}
      </Typography>

      {/* Meta: when · where · who */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.75, mt: 0.5 }}>
        <Typography sx={{ fontSize: '0.66rem', color: 'text.disabled', whiteSpace: 'nowrap' }}>
          {timeAgo(row.created_at)}
        </Typography>
        {row.path && (
          <Typography sx={{ fontSize: '0.66rem', color: 'text.disabled', fontFamily: 'monospace', wordBreak: 'break-all' }}>
            {row.path}
          </Typography>
        )}
        {row.email && (
          <Box
            component="a" href={`mailto:${row.email}?subject=${encodeURIComponent('Re: your feedback on sportydolphin.fun')}`}
            sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.3, fontSize: '0.66rem', color: 'primary.main', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
          >
            <MailOutline sx={{ fontSize: '0.8rem' }} />
            {row.email}
          </Box>
        )}
      </Box>

      {/* Actions */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.75 }}>
        <Button
          size="small" variant="text" disabled={busy}
          onClick={onToggleHandled}
          startIcon={handled ? <Undo sx={{ fontSize: '0.9rem' }} /> : <Check sx={{ fontSize: '0.9rem' }} />}
          sx={{ textTransform: 'none', fontSize: '0.7rem', fontWeight: 700, minWidth: 0, py: 0.2 }}
        >
          {handled ? 'Reopen' : 'Mark handled'}
        </Button>
        <Box sx={{ ml: 'auto' }}>
          {confirmDelete ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Button size="small" variant="text" disabled={busy} onClick={onDelete}
                sx={{ textTransform: 'none', fontSize: '0.7rem', fontWeight: 800, color: 'error.main', minWidth: 0, py: 0.2 }}>
                Delete?
              </Button>
              <Button size="small" variant="text" onClick={() => setConfirmDelete(false)}
                sx={{ textTransform: 'none', fontSize: '0.7rem', color: 'text.disabled', minWidth: 0, py: 0.2 }}>
                Cancel
              </Button>
            </Box>
          ) : (
            <IconButton size="small" disabled={busy} onClick={() => setConfirmDelete(true)} sx={{ color: 'text.disabled' }}>
              <DeleteOutline sx={{ fontSize: '1rem' }} />
            </IconButton>
          )}
        </Box>
      </Box>
    </Box>
  )
}

function FeedbackModal({ open, onClose, onChanged }: {
  open:       boolean
  onClose:    () => void
  onChanged?: () => void   // fired after a mark/delete so the admin panel's count refreshes
}) {
  const [rows, setRows]       = useState<FeedbackRow[] | null>(null)
  const [busyId, setBusyId]   = useState<string | null>(null)
  const [showHandled, setShowHandled] = useState(false)

  useEffect(() => {
    if (!open) return
    setRows(null)
    setShowHandled(false)
    fetchFeedback().then(setRows).catch(() => setRows([]))
  }, [open])

  const toggleHandled = async (row: FeedbackRow) => {
    const next = row.handled_at == null
    setBusyId(row.id)
    const ok = await setFeedbackHandled(row.id, next)
    if (ok) {
      setRows(prev => prev?.map(r => r.id === row.id ? { ...r, handled_at: next ? new Date().toISOString() : null } : r) ?? null)
      onChanged?.()
    }
    setBusyId(null)
  }

  const remove = async (row: FeedbackRow) => {
    setBusyId(row.id)
    const ok = await deleteFeedback(row.id)
    if (ok) { setRows(prev => prev?.filter(r => r.id !== row.id) ?? null); onChanged?.() }
    setBusyId(null)
  }

  const openCount    = rows?.filter(r => r.handled_at == null).length ?? 0
  const visible      = (rows ?? []).filter(r => showHandled || r.handled_at == null)
  const handledCount = (rows?.length ?? 0) - openCount

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth
      PaperProps={{ sx: { borderRadius: 3 } }}>

      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pb: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography sx={{ fontSize: '1rem', fontWeight: 800 }}>📮 Feedback</Typography>
          {rows && openCount > 0 && (
            <Box sx={{ px: 1, py: 0.2, borderRadius: 999, bgcolor: 'primary.main' }}>
              <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, color: '#fff', letterSpacing: 0.5 }}>
                {openCount} NEW
              </Typography>
            </Box>
          )}
        </Box>
        <IconButton size="small" onClick={onClose} sx={{ color: 'text.secondary' }}>
          <Close sx={{ fontSize: '1.1rem' }} />
        </IconButton>
      </DialogTitle>

      <Divider />

      <DialogContent sx={{ p: 0 }}>
        {rows === null ? (
          <Box sx={{ textAlign: 'center', py: 5 }}>
            <CircularProgress size={24} />
          </Box>
        ) : rows.length === 0 ? (
          <Box sx={{ px: 2, py: 3, textAlign: 'center' }}>
            <Typography sx={{ fontSize: '0.85rem', color: 'text.disabled' }}>
              No feedback yet.
            </Typography>
          </Box>
        ) : (
          <>
            {visible.length === 0 ? (
              <Box sx={{ px: 2, py: 3, textAlign: 'center' }}>
                <Typography sx={{ fontSize: '0.85rem', color: 'text.disabled' }}>
                  All caught up — nothing new.
                </Typography>
              </Box>
            ) : visible.map((r, i) => (
              <React.Fragment key={r.id}>
                {i > 0 && <Divider />}
                <FeedbackRowItem
                  row={r}
                  busy={busyId === r.id}
                  onToggleHandled={() => toggleHandled(r)}
                  onDelete={() => remove(r)}
                />
              </React.Fragment>
            ))}
            {handledCount > 0 && (
              <Box sx={{ borderTop: '1px solid', borderColor: 'divider' }}>
                <Button fullWidth size="small" variant="text" onClick={() => setShowHandled(s => !s)}
                  sx={{ textTransform: 'none', fontSize: '0.72rem', color: 'text.disabled', py: 0.8 }}>
                  {showHandled ? 'Hide handled' : `Show handled (${handledCount})`}
                </Button>
              </Box>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ─── Users section ────────────────────────────────────────────────────────────
// Roster popup: every registered user with their client-readable details + a
// reversible soft-delete (deactivate). RLS scopes the toggle to the owner.

// Shared table cell / header styles for the users table.
const uCellSx = { px: 1.25, py: 0.9, borderTop: '1px solid', borderColor: 'divider', verticalAlign: 'middle' } as const
const uHeadSx = {
  px: 1.25, py: 0.85, fontSize: '0.6rem', fontWeight: 800, letterSpacing: 0.6,
  textTransform: 'uppercase' as const, color: 'text.disabled', textAlign: 'left' as const,
  whiteSpace: 'nowrap' as const, position: 'sticky' as const, top: 0, zIndex: 1,
  bgcolor: 'background.paper', borderBottom: '1px solid', borderColor: 'divider',
} as const

function UserRowItem({ u, busy, onToggleDeleted }: {
  u:               AdminUser
  busy:            boolean
  onToggleDeleted: () => void
}) {
  const [confirmDeactivate, setConfirmDeactivate] = useState(false)
  const hasStats = u.predictions != null && u.predictions > 0

  const copyId = () => { navigator.clipboard?.writeText(u.user_id).catch(() => {}) }

  return (
    <Box component="tr" sx={{ opacity: u.is_deleted ? 0.55 : 1 }}>
      {/* User: name + status, id + copy beneath */}
      <Box component="td" sx={uCellSx}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
          <Typography sx={{
            fontSize: '0.85rem', fontWeight: 700, wordBreak: 'break-word',
            textDecoration: u.is_deleted ? 'line-through' : 'none',
          }}>
            {u.username}
          </Typography>
          {u.is_deleted && (
            <Box sx={{ px: 0.6, py: 0.1, borderRadius: 999, bgcolor: 'error.main', opacity: 0.85, flexShrink: 0 }}>
              <Typography sx={{ fontSize: '0.5rem', fontWeight: 800, color: '#fff', letterSpacing: 0.5 }}>
                DEACTIVATED
              </Typography>
            </Box>
          )}
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3, mt: 0.2 }}>
          <Typography sx={{ fontSize: '0.6rem', color: 'text.disabled', fontFamily: 'monospace', maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {u.user_id}
          </Typography>
          <IconButton size="small" onClick={copyId} sx={{ p: 0.15, color: 'text.disabled' }}>
            <ContentCopy sx={{ fontSize: '0.65rem' }} />
          </IconButton>
        </Box>
      </Box>

      {/* Joined */}
      <Box component="td" sx={{ ...uCellSx, fontSize: '0.72rem', color: 'text.secondary', whiteSpace: 'nowrap' }}>
        {timeAgo(u.created_at)}
      </Box>

      {/* Picks (correct/total) */}
      <Box component="td" sx={{ ...uCellSx, textAlign: 'center', fontSize: '0.8rem', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', color: hasStats ? 'text.primary' : 'text.disabled' }}>
        {hasStats ? `${u.correct}/${u.predictions}` : '—'}
      </Box>

      {/* Accuracy */}
      <Box component="td" sx={{ ...uCellSx, textAlign: 'center', fontSize: '0.8rem', fontWeight: 700, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', color: hasStats ? 'text.primary' : 'text.disabled' }}>
        {hasStats ? `${u.accuracyPct}%` : '—'}
      </Box>

      {/* Action */}
      <Box component="td" sx={{ ...uCellSx, textAlign: 'right', whiteSpace: 'nowrap' }}>
        {u.is_deleted ? (
          <Button
            size="small" variant="text" disabled={busy} onClick={onToggleDeleted}
            startIcon={<RestartAlt sx={{ fontSize: '0.9rem' }} />}
            sx={{ textTransform: 'none', fontSize: '0.7rem', fontWeight: 700, minWidth: 0, py: 0.2 }}
          >
            Restore
          </Button>
        ) : confirmDeactivate ? (
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25 }}>
            <Button size="small" variant="text" disabled={busy}
              onClick={() => { onToggleDeleted(); setConfirmDeactivate(false) }}
              sx={{ textTransform: 'none', fontSize: '0.7rem', fontWeight: 800, color: 'error.main', minWidth: 0, py: 0.2 }}>
              Deactivate?
            </Button>
            <Button size="small" variant="text" onClick={() => setConfirmDeactivate(false)}
              sx={{ textTransform: 'none', fontSize: '0.7rem', color: 'text.disabled', minWidth: 0, py: 0.2 }}>
              Cancel
            </Button>
          </Box>
        ) : (
          <IconButton size="small" disabled={busy} onClick={() => setConfirmDeactivate(true)} title="Deactivate" sx={{ color: 'text.disabled' }}>
            <PersonOffOutlined sx={{ fontSize: '1rem' }} />
          </IconButton>
        )}
      </Box>
    </Box>
  )
}

function UserModal({ open, onClose, onChanged }: {
  open:       boolean
  onClose:    () => void
  onChanged?: () => void
}) {
  const [users, setUsers]   = useState<AdminUser[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [query, setQuery]   = useState('')
  const [showDeleted, setShowDeleted] = useState(false)

  useEffect(() => {
    if (!open) return
    setUsers(null); setQuery(''); setShowDeleted(false)
    fetchAdminUsers().then(setUsers).catch(() => setUsers([]))
  }, [open])

  const toggleDeleted = async (u: AdminUser) => {
    const next = !u.is_deleted
    setBusyId(u.user_id)
    const ok = await setUserDeleted(u.user_id, next)
    if (ok) {
      setUsers(prev => prev?.map(x => x.user_id === u.user_id
        ? { ...x, is_deleted: next, deleted_at: next ? new Date().toISOString() : null } : x) ?? null)
      onChanged?.()
    }
    setBusyId(null)
  }

  const activeCount = users?.filter(u => !u.is_deleted).length ?? 0
  const deletedCount = (users?.length ?? 0) - activeCount
  const q = query.trim().toLowerCase()
  const visible = (users ?? [])
    .filter(u => showDeleted || !u.is_deleted)
    .filter(u => !q || u.username.toLowerCase().includes(q) || u.user_id.toLowerCase().includes(q))

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth
      PaperProps={{ sx: { borderRadius: 3 } }}>

      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pb: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography sx={{ fontSize: '1rem', fontWeight: 800 }}>👥 Users</Typography>
          {users && (
            <Box sx={{ px: 1, py: 0.2, borderRadius: 999, bgcolor: 'action.selected' }}>
              <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, letterSpacing: 0.5 }}>
                {activeCount}
              </Typography>
            </Box>
          )}
        </Box>
        <IconButton size="small" onClick={onClose} sx={{ color: 'text.secondary' }}>
          <Close sx={{ fontSize: '1.1rem' }} />
        </IconButton>
      </DialogTitle>

      <Divider />

      <DialogContent sx={{ p: 0 }}>
        {users === null ? (
          <Box sx={{ textAlign: 'center', py: 5 }}>
            <CircularProgress size={24} />
          </Box>
        ) : users.length === 0 ? (
          <Box sx={{ px: 2, py: 3, textAlign: 'center' }}>
            <Typography sx={{ fontSize: '0.85rem', color: 'text.disabled' }}>No users yet.</Typography>
          </Box>
        ) : (
          <>
            {/* Search */}
            <Box sx={{ px: 1.5, py: 1.25, borderBottom: '1px solid', borderColor: 'divider' }}>
              <Box
                component="input"
                placeholder="Search username or id…"
                value={query}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
                sx={{
                  width: '100%', boxSizing: 'border-box', px: 1.25, py: 0.9,
                  fontSize: '0.82rem', color: 'text.primary',
                  bgcolor: 'action.hover', border: '1px solid', borderColor: 'divider',
                  borderRadius: 1.5, outline: 'none',
                  '&:focus': { borderColor: 'primary.main' },
                }}
              />
            </Box>

            {visible.length === 0 ? (
              <Box sx={{ px: 2, py: 3, textAlign: 'center' }}>
                <Typography sx={{ fontSize: '0.85rem', color: 'text.disabled' }}>No matches.</Typography>
              </Box>
            ) : (
              <Box sx={{ maxHeight: 400, overflow: 'auto' }}>
                <Box component="table" sx={{ width: '100%', minWidth: 460, borderCollapse: 'collapse' }}>
                  <Box component="thead">
                    <Box component="tr">
                      <Box component="th" sx={uHeadSx}>User</Box>
                      <Box component="th" sx={uHeadSx}>Joined</Box>
                      <Box component="th" sx={{ ...uHeadSx, textAlign: 'center' }}>Picks</Box>
                      <Box component="th" sx={{ ...uHeadSx, textAlign: 'center' }}>Acc</Box>
                      <Box component="th" sx={{ ...uHeadSx, textAlign: 'right' }} />
                    </Box>
                  </Box>
                  <Box component="tbody">
                    {visible.map(u => (
                      <UserRowItem
                        key={u.user_id}
                        u={u}
                        busy={busyId === u.user_id}
                        onToggleDeleted={() => toggleDeleted(u)}
                      />
                    ))}
                  </Box>
                </Box>
              </Box>
            )}

            {deletedCount > 0 && (
              <Box sx={{ borderTop: '1px solid', borderColor: 'divider' }}>
                <Button fullWidth size="small" variant="text" onClick={() => setShowDeleted(s => !s)}
                  sx={{ textTransform: 'none', fontSize: '0.72rem', color: 'text.disabled', py: 0.8 }}>
                  {showDeleted ? 'Hide deactivated' : `Show deactivated (${deletedCount})`}
                </Button>
              </Box>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ─── Pipeline health ──────────────────────────────────────────────────────────
//
// The four background jobs whose state the owner has to be able to see: the WPBL feed
// mirror, the league's TrackMan publishing, the nightly scoring check, and MLB payrolls.
//
// These used to be four one-row Sections buried under seven analytics cards, which put the
// only urgent thing on the page furthest from the top. They are one card now, and
// `HealthStrip` puts the same four states in the header so a dead pipeline is visible from
// whichever group is open.

interface PayrollRow { updated_at: string; season: number }

export interface OpsHealth {
  payroll:     PayrollRow | null
  ingest:      WpblRunRow | null
  validation:  WpblValidationRow | null
  tracking:    WpblTrackingRow | null
  predictions: number | null
  loading:     boolean
  /** Re-read every table. Wired to the page's refresh button, which used to reload the
      analytics half and silently leave the pipeline states as they were. */
  reload:      () => void
}

/**
 * One read of every operational table, shared by the header strip and the Health group.
 *
 * Lifted out of the old panel component so the strip can render without the group it
 * summarises being mounted: the whole point is that it shows on the Audience tab too.
 */
export function useOpsHealth(): OpsHealth {
  const [state, setState] = useState<Omit<OpsHealth, 'loading' | 'reload'>>({
    payroll: null, ingest: null, validation: null, tracking: null, predictions: null,
  })
  const [loading, setLoading] = useState(true)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let live = true
    Promise.all([
      // Most-recent payroll update per season
      supabase.from('team_payrolls')
        .select('season, updated_at')
        .order('updated_at', { ascending: false })
        .limit(1),

      // Total prediction count
      supabase.from('game_predictions')
        .select('*', { count: 'exact', head: true }),

      // Most-recent WPBL feed-mirror ingest run (health/freshness)
      supabase.from('wpbl_ingest_runs')
        .select('ran_at, ok, mode, games, boxscores, error_count')
        .order('ran_at', { ascending: false })
        .limit(1),

      // Most-recent play-by-play validation pass
      supabase.from('wpbl_pbp_validation_runs')
        .select('ran_at, ok, new_findings, total_findings')
        .order('ran_at', { ascending: false })
        .limit(1),

      // How far the league's TrackMan publishing has got. A single row, written nightly by
      // scripts/watch-wpbl-tracking.mjs; empty until that job has run once.
      supabase.from('wpbl_tracking_watch')
        .select('last_tracked_game_date, tracked_game_count, last_final_game_date, last_checked_at, last_advanced_at')
        .limit(1),
    ]).then(([pr, pc, wp, wv, wt]) => {
      if (!live) return
      setState({
        payroll:     (((pr.data ?? [])[0]) ?? null) as PayrollRow | null,
        predictions: pc.count ?? 0,
        ingest:      (((wp.data ?? [])[0]) ?? null) as WpblRunRow | null,
        validation:  (((wv.data ?? [])[0]) ?? null) as WpblValidationRow | null,
        tracking:    (((wt.data ?? [])[0]) ?? null) as WpblTrackingRow | null,
      })
    }).finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [nonce])

  return { ...state, loading, reload: React.useCallback(() => setNonce(n => n + 1), []) }
}

/**
 * Every pipeline's state as one row, in the order they matter.
 *
 * A pipeline with no row yet is 'idle' and never 'ok': "not yet run" and "ran and was fine"
 * are different answers, and collapsing them is how a job that never started reads green.
 */
const IDLE: Status = { tone: 'idle', label: 'Not yet run' }

export function healthStatuses(h: OpsHealth): Array<Status & { key: string; name: string }> {
  return [
    { key: 'ingest',   name: 'Ingest',   ...(h.ingest     ? ingestStatus(h.ingest)              : IDLE) },
    { key: 'trackman', name: 'TrackMan', ...(h.tracking   ? trackingStatus(h.tracking)          : IDLE) },
    { key: 'scoring',  name: 'Scoring',  ...(h.validation ? validationStatus(h.validation)      : IDLE) },
    { key: 'payrolls', name: 'Payrolls', ...(h.payroll    ? payrollStatus(h.payroll.updated_at) : IDLE) },
  ]
}

/**
 * The four pipeline states, compact, for the page header.
 *
 * Sits above whichever group is open, so a dead pipeline never depends on scrolling to the
 * bottom of the page to be noticed, which is where all four of these used to live. Clicking
 * it opens the Health group, where the detail is.
 */
export function HealthStrip({ health, onOpen }: { health: OpsHealth; onOpen: () => void }) {
  if (health.loading) return null
  return (
    <Box
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }}
      aria-label="Pipeline health: open the Health group"
      sx={{
        display: 'flex', flexWrap: 'wrap', gap: 1, mb: 1.5, cursor: 'pointer',
        alignItems: 'center', userSelect: 'none', borderRadius: 1.5, p: 0.5, mx: -0.5,
        '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      {healthStatuses(health).map(st => (
        <Box key={st.key} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
          <Typography sx={{ fontSize: '0.66rem', fontWeight: 700, color: 'text.disabled' }}>{st.name}</Typography>
          <StatusPill tone={st.tone} label={st.label} />
        </Box>
      ))}
    </Box>
  )
}

/**
 * The Health group: one card, one row per pipeline, with when it last ran and what it found.
 *
 * Replaced four separate Sections that spent four headers and four borders on four single
 * lines, in an order that put the every-two-minutes job below the once-a-day ones.
 */
export function HealthGroup({ health }: { health: OpsHealth }) {
  const { payroll, ingest, validation, tracking, loading } = health
  if (loading) {
    return (
      <Section title="Pipelines">
        <Box sx={{ textAlign: 'center', py: 4 }}><CircularProgress size={24} /></Box>
      </Section>
    )
  }
  return (
    <>
      <Section title="Pipelines">
        <Box sx={{ px: 1.5 }}>
          {/* The feed mirror runs every two minutes, so it leads. */}
          <StatRow
            label="WPBL ingest"
            sub={ingest
              ? `${ingest.mode ?? '—'} · ${ingest.games} games, ${ingest.boxscores} boxscores · ${timeAgoMin(ingest.ran_at)}${ingest.error_count > 0 ? ` · ${ingest.error_count} error(s)` : ''}`
              : 'No ingest runs logged yet.'}
            value={<StatusPill {...(ingest ? ingestStatus(ingest) : IDLE)} />}
          />
          {/* Not our job failing: this one watches for the LEAGUE's radar publishing to resume. */}
          <StatRow
            label="TrackMan publishing"
            sub={tracking?.last_tracked_game_date
              ? `Through ${tracking.last_tracked_game_date} · ${tracking.tracked_game_count} game${tracking.tracked_game_count === 1 ? '' : 's'} · checked ${timeAgoMin(tracking.last_checked_at ?? '')}`
              : tracking
                ? 'The league has published none of it yet.'
                : 'Nightly at 08:30 UTC. Nothing recorded yet.'}
            value={<StatusPill {...(tracking ? trackingStatus(tracking) : IDLE)} />}
          />
          {/* Stale is the state that matters here; findings are expected and mostly known. */}
          <StatRow
            label="Scoring check"
            sub={validation
              ? `${validation.total_findings} open · ${timeAgoMin(validation.ran_at)}`
              : 'Nightly at 08:00 UTC. Nothing recorded yet.'}
            value={<StatusPill {...(validation ? validationStatus(validation) : IDLE)} />}
          />
          <StatRow
            label="MLB payrolls"
            sub={payroll
              ? `${payroll.season} season · updated ${timeAgo(payroll.updated_at)}`
              : 'No payroll data. Run npm run payrolls'}
            value={<StatusPill {...(payroll ? payrollStatus(payroll.updated_at) : IDLE)} />}
          />
        </Box>
      </Section>

      <Section title="Quick Links">
        <QuickLink emoji="🔄" label="GitHub Actions: run workflows" href="https://github.com/sportydolphin/fun/actions" />
        <QuickLink emoji="☁️" label="Cloudflare Pages: deploys" href="https://dash.cloudflare.com/ffbac30453d122b1e45cbd885857b100/pages/view/fun" />
        <QuickLink emoji="🗄️" label="Supabase Dashboard" href="https://supabase.com/dashboard" />
        <QuickLink emoji="📦" label="GitHub Repository" href="https://github.com/sportydolphin/fun" />
      </Section>
    </>
  )
}

// ─── Tools ────────────────────────────────────────────────────────────────────

/** A row that opens a drill-down modal. Feedback and Users had a copy each. */
function DrillRow({ emoji, label, badge, onClick }: {
  emoji: string; label: string; badge?: React.ReactNode; onClick: () => void
}) {
  return (
    <Box
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }}
      sx={{
        display: 'flex', alignItems: 'center', gap: 1.25, px: 1.5, py: 1.1,
        cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      <Typography sx={{ fontSize: '1rem', lineHeight: 1 }}>{emoji}</Typography>
      <Typography sx={{ fontSize: '0.82rem', fontWeight: 600, color: 'text.primary' }}>{label}</Typography>
      <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1 }}>
        {badge}
        <Typography sx={{ fontSize: '0.9rem', color: 'text.disabled' }}>›</Typography>
      </Box>
    </Box>
  )
}

// The things the owner *does*: fire a test push, work the feedback queue, manage users, open
// one of the small apps. This began as a maxWidth="xs" dialog off the account menu, then
// became the whole operational half of one long page; the freshness reads moved to
// HealthGroup above, so what is left here is only the actions. Feedback and Users stay
// modals: they are drill-downs opened FROM the page, not competing with it.
export function AdminTools({ apps, isAppLocked, onOpenApp }: {
  apps: AppTile[]
  isAppLocked: (path: string) => boolean
  onOpenApp: (path: string) => void
}) {
  const [userCount, setUserCount] = useState<number | null>(null)
  const [usersOpen, setUsersOpen] = useState(false)
  const [feedbackNew, setFeedbackNew]   = useState<number | null>(null)
  const [feedbackOpen, setFeedbackOpen] = useState(false)

  // Summary counts for the clickable rows. Split out so each modal can refresh just its own
  // count after an action, without re-running the whole panel load.
  const loadFeedbackCount = React.useCallback(() => {
    supabase.from('feedback')
      .select('*', { count: 'exact', head: true })
      .is('handled_at', null)
      .then(({ count }) => setFeedbackNew(count ?? 0))
  }, [])

  // Active (non-deactivated) users. Filters out is_deleted, falling back to a plain count if
  // that column isn't migrated yet.
  const loadUserCount = React.useCallback(async () => {
    const r = await supabase.from('usernames')
      .select('*', { count: 'exact', head: true })
      .eq('is_deleted', false)
    if (r.error) {
      const all = await supabase.from('usernames').select('*', { count: 'exact', head: true })
      setUserCount(all.count ?? 0)
    } else {
      setUserCount(r.count ?? 0)
    }
  }, [])

  useEffect(() => {
    loadFeedbackCount()
    loadUserCount()
  }, [loadFeedbackCount, loadUserCount])

  return (
    <>
      <Box>
        <Section title="Queues">
          <DrillRow
            emoji="📮"
            label="View feedback"
            onClick={() => setFeedbackOpen(true)}
            badge={feedbackNew != null && feedbackNew > 0 ? (
              <Box sx={{ px: 1, py: 0.2, borderRadius: 999, bgcolor: 'primary.main' }}>
                <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, color: '#fff', letterSpacing: 0.5 }}>
                  {feedbackNew} NEW
                </Typography>
              </Box>
            ) : undefined}
          />
          <Box sx={{ height: '1px', bgcolor: 'divider' }} />
          <DrillRow
            emoji="👥"
            label="Manage users"
            onClick={() => setUsersOpen(true)}
            badge={userCount != null ? (
              <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: 'text.secondary' }}>
                {userCount}
              </Typography>
            ) : undefined}
          />
        </Section>

        <TestNotificationSection />

        <Section title="Other Apps">
          <AppGrid apps={apps} isAppLocked={isAppLocked} onOpenApp={onOpenApp} />
        </Section>
      </Box>

      <FeedbackModal
        open={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
        onChanged={loadFeedbackCount}
      />

      <UserModal
        open={usersOpen}
        onClose={() => setUsersOpen(false)}
        onChanged={loadUserCount}
      />
    </>
  )
}
