import { useCallback, useEffect, useState } from 'react'
import { Box, Typography } from '@mui/material'
import { Section } from '../AdminPanel'
import { TYPE_SCALE } from '../ui/card'
import { pressable } from '../ui/interaction'
import {
  fetchPendingPhotoSubmissions, fetchSubmissionRender, approvePhotoSubmission, rejectPhotoSubmission,
  blockPhotoUploader, daysLeft, type PhotoSubmission, type SubmissionSubject,
} from './api'
import { fanPhotoTeamName } from './fanPhotos'
import type { WpblPlayer, WpblPhotoFigure, WpblTeam } from './types'

// /admin → Photos → Submitted: fans' photos waiting in the private bucket (docs/FAN_UPLOADS.md,
// phase 2). Approve re-renders the photo in this browser and publishes it; Reject keeps it out
// with a reason the fan will see; Block stops the account and rejects all it has waiting. The
// fan's picks are shown as they sent them and become suggestions on approval, never tags.

const THUMB_W = 120
const THUMB_H = 90

function Action({ label, tone, disabled, onClick }: {
  label: string; tone: 'primary' | 'plain' | 'danger'; disabled: boolean; onClick: () => void
}) {
  const filled = tone === 'primary'
  return (
    <Box {...pressable(() => { if (!disabled) onClick() })} aria-disabled={disabled} sx={{
      px: 1.4, py: 0.5, borderRadius: 999, cursor: disabled ? 'default' : 'pointer', userSelect: 'none',
      fontSize: TYPE_SCALE.meta, fontWeight: 700, lineHeight: 1.5, border: '1px solid',
      borderColor: tone === 'danger' ? 'error.main' : filled ? 'primary.main' : 'outline',
      bgcolor: filled ? 'primary.main' : 'background.paper',
      color: filled ? 'primary.contrastText' : tone === 'danger' ? 'error.main' : 'text.secondary',
    }}>{label}</Box>
  )
}

/** The private render, fetched with the owner's token (an <img src> cannot send one). */
function Thumb({ id }: { id: string }) {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  useEffect(() => {
    let url: string | null = null
    let live = true
    fetchSubmissionRender(id, 'card')
      .then(b => { if (!live) return; url = URL.createObjectURL(b); setSrc(url) })
      .catch(e => { if (live) setFailed((e as Error).message) })
    return () => { live = false; if (url) URL.revokeObjectURL(url) }
  }, [id])
  return (
    <Box sx={{
      width: THUMB_W, height: THUMB_H, flexShrink: 0, borderRadius: 1, overflow: 'hidden', bgcolor: 'action.hover',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {src ? <Box component="img" src={src} alt="" sx={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        : failed ? <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', px: 1, textAlign: 'center' }}>{failed}</Typography>
        : null}
    </Box>
  )
}

export default function AdminPhotoSubmissions({ players, figures, teams, onPublished }: {
  players: Map<string, WpblPlayer>; figures: Map<string, WpblPhotoFigure>; teams: WpblTeam[]
  /** A photo was published, so the library below should reload. */
  onPublished: () => void
}) {
  const [rows, setRows] = useState<PhotoSubmission[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(() => { fetchPendingPhotoSubmissions().then(setRows) }, [])
  useEffect(() => load(), [load])

  const subjectName = (s: SubmissionSubject) =>
    'player' in s ? (players.get(s.player)?.name ?? 'Unknown player')
    : 'team' in s ? `${fanPhotoTeamName(teams.find(t => t.id === s.team))} (team)`
    : (figures.get(s.figure)?.name ?? s.figure)

  const act = async (id: string, run: () => Promise<unknown>, published = false) => {
    setBusy(id); setError(null)
    try {
      await run()
      if (published) onPublished()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
      load()
    }
  }
  const approve = (s: PhotoSubmission) => act(s.id, () => approvePhotoSubmission(s), true)
  const reject = (s: PhotoSubmission) => {
    const reason = window.prompt('Reason (the photographer sees it):', '')
    if (reason === null) return
    act(s.id, () => rejectPhotoSubmission(s.id, reason))
  }
  const block = (s: PhotoSubmission) => {
    if (!window.confirm(`Block ${s.credit_name} from uploading? Everything they have waiting is rejected.`)) return
    act(s.id, () => blockPhotoUploader(s.user_id, `Blocked from the submission by ${s.credit_name}`))
  }

  return (
    <Section title={`Submitted (${rows?.length ?? 0})`}>
      {error && (
        <Typography role="alert" sx={{ px: 1.5, py: 1, fontSize: TYPE_SCALE.body, color: 'error.main', borderBottom: '1px solid', borderColor: 'divider' }}>
          {error}
        </Typography>
      )}
      {rows === null ? (
        <Box sx={{ px: 1.5, py: 1, display: 'flex', gap: 1.5 }}>
          <Box sx={{ width: THUMB_W, height: THUMB_H, borderRadius: 1, bgcolor: 'action.hover' }} />
        </Box>
      ) : rows.length === 0 ? (
        <Typography sx={{ px: 1.5, py: 2, fontSize: TYPE_SCALE.body, color: 'text.secondary' }}>None waiting</Typography>
      ) : rows.map(s => {
        const left = daysLeft(s.created_at)
        const disabled = busy !== null
        return (
          <Box key={s.id} sx={{
            px: 1.5, py: 1.25, display: 'flex', gap: 1.5, alignItems: 'flex-start', flexWrap: 'wrap',
            '&:not(:last-child)': { borderBottom: '1px solid', borderColor: 'divider' },
          }}>
            <Thumb id={s.id} />
            <Box sx={{ flex: 1, minWidth: 180 }}>
              <Typography sx={{ fontSize: TYPE_SCALE.title, fontWeight: 700 }}>{s.credit_name}</Typography>
              <Typography sx={{ fontSize: TYPE_SCALE.meta, color: left <= 5 ? 'warning.main' : 'text.secondary' }}>
                {new Date(s.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                {' · '}{left === 0 ? 'Expires today' : `Expires in ${left} day${left === 1 ? '' : 's'}`}
              </Typography>
              {s.subjects.length > 0 && (
                <Typography sx={{ fontSize: TYPE_SCALE.body, mt: 0.5 }}>
                  In it: {s.subjects.map(subjectName).join(', ')}
                </Typography>
              )}
              {s.note && (
                <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.secondary', mt: 0.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                  {s.note}
                </Typography>
              )}
              <Box sx={{ display: 'flex', gap: 0.75, mt: 1, flexWrap: 'wrap' }}>
                <Action label={busy === s.id ? 'Working…' : 'Approve'} tone="primary" disabled={disabled} onClick={() => approve(s)} />
                <Action label="Reject" tone="plain" disabled={disabled} onClick={() => reject(s)} />
                <Action label="Block" tone="danger" disabled={disabled} onClick={() => block(s)} />
              </Box>
            </Box>
          </Box>
        )
      })}
    </Section>
  )
}
