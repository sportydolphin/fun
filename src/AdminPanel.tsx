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

// Minute-precision relative time — the WPBL feed cron runs every ~2 min, so hour-grained
// timeAgo would read "just now" almost always and hide whether the mirror is actually live.
function timeAgoMin(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
  if (m < 1)  return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`
}

// WPBL feed-mirror ingest health, consolidated here from the WPBL home header. Cron runs
// ~every 2 min: green = fresh + clean, amber = stale (>6 min) or per-game errors on the
// last run, red = the last run failed outright.
interface WpblRunRow { ran_at: string; ok: boolean; mode: string | null; games: number; boxscores: number; error_count: number }
function WpblFreshnessChip({ run }: { run: WpblRunRow }) {
  const stale = Date.now() - new Date(run.ran_at).getTime() > 6 * 60_000
  const color = !run.ok ? '#ef4444' : (run.error_count > 0 || stale) ? '#f97316' : '#22c55e'
  const text  = !run.ok ? 'Failed'  : run.error_count > 0 ? 'Errors' : stale ? 'Stale' : 'Fresh'
  return (
    <Box sx={{
      display: 'inline-flex', alignItems: 'center', gap: 0.5,
      px: 1, py: 0.25, borderRadius: 999,
      bgcolor: `${color}18`, border: '1px solid', borderColor: `${color}40`,
    }}>
      <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: color }} />
      <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, color }}>{text}</Typography>
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

// ─── Admin Panel ──────────────────────────────────────────────────────────────

export function AdminPanel({ open, onClose, apps, isAppLocked, onOpenApp }: {
  open: boolean
  onClose: () => void
  apps: AppTile[]
  isAppLocked: (path: string) => boolean
  onOpenApp: (path: string) => void
}) {
  const [payrolls, setPayrolls]   = useState<PayrollRow[] | null>(null)
  const [wpblRun, setWpblRun]     = useState<WpblRunRow | null>(null)
  const [predCount, setPredCount] = useState<number | null>(null)
  const [userCount, setUserCount] = useState<number | null>(null)
  const [usersOpen, setUsersOpen] = useState(false)
  const [feedbackNew, setFeedbackNew]   = useState<number | null>(null)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [loading, setLoading]     = useState(false)

  // Summary counts for the panel's clickable rows. Split out so the modals can refresh
  // just their own count after an action, without re-running the whole panel load.
  const loadFeedbackCount = React.useCallback(() => {
    supabase.from('feedback')
      .select('*', { count: 'exact', head: true })
      .is('handled_at', null)
      .then(({ count }) => setFeedbackNew(count ?? 0))
  }, [])

  // Active (non-deactivated) users. Filters out is_deleted, falling back to a plain
  // count if that column isn't migrated yet.
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
    if (!open) return
    loadFeedbackCount()
    loadUserCount()
  }, [open, loadFeedbackCount, loadUserCount])

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

      // Most-recent WPBL feed-mirror ingest run (health/freshness)
      supabase.from('wpbl_ingest_runs')
        .select('ran_at, ok, mode, games, boxscores, error_count')
        .order('ran_at', { ascending: false })
        .limit(1),
    ]).then(([pr, pc, wp]) => {
      setPayrolls((pr.data ?? []) as PayrollRow[])
      setPredCount(pc.count ?? 0)
      setWpblRun((((wp.data ?? [])[0]) ?? null) as WpblRunRow | null)
    }).finally(() => setLoading(false))
  }, [open])

  const latestPayroll = payrolls?.[0]

  return (
    <>
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

        {/* ── User feedback — opens the full queue in its own popup ───── */}
        <Section title="Feedback">
          <Box
            onClick={() => setFeedbackOpen(true)}
            sx={{
              display: 'flex', alignItems: 'center', gap: 1.25, px: 1.5, py: 1.1,
              cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' },
            }}
          >
            <Typography sx={{ fontSize: '1rem', lineHeight: 1 }}>📮</Typography>
            <Typography sx={{ fontSize: '0.82rem', fontWeight: 600, color: 'text.primary' }}>
              View feedback
            </Typography>
            <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1 }}>
              {feedbackNew != null && feedbackNew > 0 && (
                <Box sx={{ px: 1, py: 0.2, borderRadius: 999, bgcolor: 'primary.main' }}>
                  <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, color: '#fff', letterSpacing: 0.5 }}>
                    {feedbackNew} NEW
                  </Typography>
                </Box>
              )}
              <Typography sx={{ fontSize: '0.9rem', color: 'text.disabled' }}>›</Typography>
            </Box>
          </Box>
        </Section>

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
                    No payroll data. Run <code>npm run payrolls</code>
                  </Typography>
                </Box>
              )}
            </Section>

            {/* ── WPBL feed mirror ─────────────────────────────────────── */}
            <Section title="WPBL Ingest">
              {wpblRun ? (
                <Box sx={{ px: 1.5 }}>
                  <StatRow
                    label="Feed mirror"
                    sub={`${wpblRun.mode ?? '—'} · ${wpblRun.games} games, ${wpblRun.boxscores} boxscores · ${timeAgoMin(wpblRun.ran_at)}${wpblRun.error_count > 0 ? ` · ${wpblRun.error_count} error(s)` : ''}`}
                    value={<WpblFreshnessChip run={wpblRun} />}
                  />
                </Box>
              ) : (
                <Box sx={{ px: 1.5, py: 1 }}>
                  <Typography sx={{ fontSize: '0.8rem', color: 'text.disabled' }}>
                    No ingest runs logged yet.
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

            {/* ── Users — opens the full roster in its own popup ─────────── */}
            <Section title="Users">
              <Box
                onClick={() => setUsersOpen(true)}
                sx={{
                  display: 'flex', alignItems: 'center', gap: 1.25, px: 1.5, py: 1.1,
                  cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' },
                }}
              >
                <Typography sx={{ fontSize: '1rem', lineHeight: 1 }}>👥</Typography>
                <Typography sx={{ fontSize: '0.82rem', fontWeight: 600, color: 'text.primary' }}>
                  Manage users
                </Typography>
                <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1 }}>
                  {userCount != null && (
                    <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: 'text.secondary' }}>
                      {userCount}
                    </Typography>
                  )}
                  <Typography sx={{ fontSize: '0.9rem', color: 'text.disabled' }}>›</Typography>
                </Box>
              </Box>
            </Section>

            {/* ── Quick links ───────────────────────────────────────────── */}
            <Section title="Quick Links">
              <QuickLink emoji="🔄" label="GitHub Actions — Run workflows" href="https://github.com/sportydolphin/fun/actions" />
              <QuickLink emoji="☁️" label="Cloudflare Pages — Deploys" href="https://dash.cloudflare.com/ffbac30453d122b1e45cbd885857b100/pages/view/fun" />
              <QuickLink emoji="🗄️" label="Supabase Dashboard" href="https://supabase.com/dashboard" />
              <QuickLink emoji="📦" label="GitHub Repository" href="https://github.com/sportydolphin/fun" />
            </Section>
          </>
        )}
      </DialogContent>
    </Dialog>

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
