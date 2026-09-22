import { useCallback, useEffect, useMemo, useState } from 'react'
import { Box, Typography, TextField, CircularProgress, MenuItem, Select, IconButton } from '@mui/material'
import { Close, Refresh } from '@mui/icons-material'
import { Section } from '../AdminPanel'
import {
  fetchWpblFanPhotoQueue, fetchWpblAllPlayers,
  setFanPhotoApproved, updateFanPhoto, addFanPhotoSubject, removeFanPhotoSubject, upsertFanPhotoFigure,
  type WpblFanPhotoRow,
} from './api'
import type { WpblPlayer, WpblPhotoSubject, WpblPhotoFigure } from './types'

// The fan-photo curation tool. Bytes arrive by the ingest CLI (approved = false); this is where
// they get their subjects, a caption and the approve toggle that makes them public. It never
// touches R2. See docs/FAN_PHOTOS.md.
//
// Every write goes through the is_site_owner() RLS policy (api.ts), which is the real boundary;
// this being a group inside the owner-only /admin page is only the cosmetic half. Reads are
// fresh, not the 20s bulk cache, so an edit shows on the next reload.

const KINDS: WpblPhotoFigure['kind'][] = ['mascot', 'manager', 'coach', 'broadcaster', 'staff', 'umpire']

type Filter = 'unapproved' | 'approved' | 'all'
const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'unapproved', label: 'To review' },
  { value: 'approved', label: 'Published' },
  { value: 'all', label: 'All' },
]

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <Box onClick={onClick} sx={{
      px: 1.4, py: 0.5, borderRadius: 999, cursor: 'pointer', userSelect: 'none',
      fontSize: '0.75rem', fontWeight: 700, lineHeight: 1.5, border: '1px solid',
      borderColor: active ? 'primary.main' : 'divider',
      bgcolor: active ? 'primary.main' : 'background.paper',
      color: active ? 'primary.contrastText' : 'text.secondary',
    }}>{label}</Box>
  )
}

// A caption / date field that holds its own draft and saves on blur, so typing does not fire a
// write per keystroke and a reload does not stomp on an in-progress edit.
function SavingField({ value, placeholder, type, multiline, onSave }: {
  value: string | null; placeholder: string; type?: string; multiline?: boolean
  onSave: (v: string | null) => void
}) {
  const [draft, setDraft] = useState(value ?? '')
  useEffect(() => setDraft(value ?? ''), [value])
  const commit = () => {
    const next = draft.trim() === '' ? null : draft.trim()
    if (next !== (value ?? null)) onSave(next)
  }
  return (
    <TextField
      value={draft} placeholder={placeholder} type={type} multiline={multiline} size="small" fullWidth
      onChange={e => setDraft(e.target.value)} onBlur={commit}
      InputProps={{ sx: { fontSize: '0.8rem' } }}
      sx={{ '& .MuiInputBase-input': { py: 0.5 } }}
    />
  )
}

// One taggable candidate, players and figures merged so the picker is one list.
type Candidate = { label: string; sub: string; add: { playerId: string } | { figureKey: string } }

function SubjectPicker({ candidates, onPick }: {
  candidates: Candidate[]; onPick: (c: Candidate) => void
}) {
  const [q, setQ] = useState('')
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return []
    return candidates.filter(c => c.label.toLowerCase().includes(s)).slice(0, 8)
  }, [q, candidates])
  return (
    <Box sx={{ position: 'relative' }}>
      <TextField
        value={q} onChange={e => setQ(e.target.value)} placeholder="Tag who is in it…"
        size="small" fullWidth InputProps={{ sx: { fontSize: '0.8rem' } }}
        sx={{ '& .MuiInputBase-input': { py: 0.5 } }}
      />
      {matches.length > 0 && (
        <Box sx={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 5, mt: 0.5,
          borderRadius: 1.5, border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper',
          boxShadow: 3, overflow: 'hidden',
        }}>
          {matches.map(c => (
            <Box key={c.label + c.sub} onMouseDown={e => { e.preventDefault(); onPick(c); setQ('') }} sx={{
              px: 1.2, py: 0.7, cursor: 'pointer', display: 'flex', alignItems: 'baseline', gap: 0.8,
              '&:hover': { bgcolor: 'action.hover' },
            }}>
              <Typography sx={{ fontSize: '0.8rem', fontWeight: 600 }}>{c.label}</Typography>
              <Typography sx={{ fontSize: '0.66rem', color: 'text.disabled' }}>{c.sub}</Typography>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  )
}

function PhotoCard({ photo, subjects, players, figures, onChange }: {
  photo: WpblFanPhotoRow
  subjects: WpblPhotoSubject[]
  players: Map<string, WpblPlayer>
  figures: Map<string, WpblPhotoFigure>
  onChange: () => void
}) {
  const [busy, setBusy] = useState(false)
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); await fn(); setBusy(false); onChange() }

  const tagged = new Set<string>()
  for (const s of subjects) tagged.add(s.player_id ? `p:${s.player_id}` : `f:${s.figure_key}`)

  const candidates: Candidate[] = useMemo(() => {
    const out: Candidate[] = []
    for (const p of players.values()) {
      if (tagged.has(`p:${p.id}`)) continue
      out.push({ label: p.name, sub: 'player', add: { playerId: p.id } })
    }
    for (const f of figures.values()) {
      if (tagged.has(`f:${f.key}`)) continue
      out.push({ label: f.name, sub: f.kind, add: { figureKey: f.key } })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players, figures, subjects])

  const subjectName = (s: WpblPhotoSubject) =>
    s.player_id ? (players.get(s.player_id)?.name ?? 'Unknown player')
                : (figures.get(s.figure_key ?? '')?.name ?? s.figure_key ?? 'Unknown')

  return (
    <Box sx={{
      display: 'flex', gap: 1.5, p: 1.5,
      '&:not(:last-child)': { borderBottom: '1px solid', borderColor: 'divider' },
      opacity: busy ? 0.6 : 1, transition: 'opacity .15s',
    }}>
      <Box sx={{ flexShrink: 0, width: 120 }}>
        <Box component="img" src={photo.card_url} alt={photo.caption ?? 'Fan photo'} loading="lazy"
          sx={{ width: 120, height: 120, objectFit: 'cover', borderRadius: 1.5, bgcolor: 'action.hover',
                display: 'block', border: '1px solid', borderColor: 'divider' }} />
        <Typography sx={{ fontSize: '0.62rem', color: 'text.disabled', mt: 0.5 }}>
          {photo.credit ?? 'no credit'}
        </Typography>
        {photo.taken_on && (
          <Typography sx={{ fontSize: '0.62rem', color: 'text.disabled' }}>shot {photo.taken_on}</Typography>
        )}
      </Box>

      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.8 }}>
        {/* subjects */}
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.6 }}>
          {subjects.length === 0 && (
            <Typography sx={{ fontSize: '0.7rem', color: 'warning.main', fontWeight: 700 }}>
              No subjects tagged yet
            </Typography>
          )}
          {subjects.map(s => (
            <Box key={s.id} sx={{
              display: 'flex', alignItems: 'center', gap: 0.3, pl: 0.9, pr: 0.4, py: 0.2,
              borderRadius: 999, bgcolor: 'action.hover',
            }}>
              <Typography sx={{ fontSize: '0.72rem', fontWeight: 600 }}>{subjectName(s)}</Typography>
              <IconButton size="small" disabled={busy} aria-label={`Remove ${subjectName(s)}`}
                onClick={() => run(() => removeFanPhotoSubject(s.id))} sx={{ p: 0.1 }}>
                <Close sx={{ fontSize: '0.85rem' }} />
              </IconButton>
            </Box>
          ))}
        </Box>

        <SubjectPicker candidates={candidates}
          onPick={c => run(() => addFanPhotoSubject(photo.id, c.add))} />

        <SavingField value={photo.caption} placeholder="Caption (plain text)" multiline
          onSave={v => run(() => updateFanPhoto(photo.id, { caption: v }))} />

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box sx={{ width: 150 }}>
            <SavingField value={photo.taken_on} placeholder="Taken on" type="date"
              onSave={v => run(() => updateFanPhoto(photo.id, { taken_on: v }))} />
          </Box>
          <Box sx={{ flex: 1 }} />
          <Box
            onClick={() => !busy && run(() => setFanPhotoApproved(photo.id, !photo.approved))}
            role="button" tabIndex={0}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!busy) run(() => setFanPhotoApproved(photo.id, !photo.approved)) } }}
            sx={{
              px: 1.5, py: 0.6, borderRadius: 999, cursor: 'pointer', userSelect: 'none',
              fontSize: '0.74rem', fontWeight: 800, border: '1px solid',
              borderColor: photo.approved ? 'success.main' : 'divider',
              bgcolor: photo.approved ? 'success.main' : 'background.paper',
              color: photo.approved ? '#fff' : 'text.secondary',
            }}
          >
            {photo.approved ? '✓ Published' : 'Publish'}
          </Box>
        </Box>
      </Box>
    </Box>
  )
}

// The small form for creating a non-player figure so it becomes taggable (a mascot, a manager).
function FigureAdder({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = useState('')
  const [kind, setKind] = useState<WpblPhotoFigure['kind']>('mascot')
  const [busy, setBusy] = useState(false)
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const add = async () => {
    if (!slug) return
    setBusy(true)
    const ok = await upsertFanPhotoFigure({ key: `${kind}:${slug}`, name: name.trim(), kind, blurb: null, team_id: null })
    setBusy(false)
    if (ok) { setName(''); onAdded() }
  }
  return (
    <Box sx={{ display: 'flex', gap: 1, p: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
      <TextField value={name} onChange={e => setName(e.target.value)} placeholder="New figure name (mascot, manager…)"
        size="small" InputProps={{ sx: { fontSize: '0.8rem' } }} sx={{ flex: 1, minWidth: 180 }} />
      <Select value={kind} onChange={e => setKind(e.target.value as WpblPhotoFigure['kind'])} size="small"
        sx={{ fontSize: '0.8rem', minWidth: 130 }}>
        {KINDS.map(k => <MenuItem key={k} value={k} sx={{ fontSize: '0.8rem' }}>{k}</MenuItem>)}
      </Select>
      <Box onClick={() => !busy && add()} role="button" tabIndex={0} sx={{
        px: 1.5, py: 0.6, borderRadius: 999, cursor: slug ? 'pointer' : 'default', userSelect: 'none',
        fontSize: '0.74rem', fontWeight: 800, border: '1px solid',
        borderColor: slug ? 'primary.main' : 'divider', color: slug ? 'primary.main' : 'text.disabled',
      }}>Add figure</Box>
    </Box>
  )
}

export default function AdminPhotos() {
  const [photos, setPhotos] = useState<WpblFanPhotoRow[]>([])
  const [subjects, setSubjects] = useState<WpblPhotoSubject[]>([])
  const [figures, setFigures] = useState<WpblPhotoFigure[]>([])
  const [players, setPlayers] = useState<WpblPlayer[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>('unapproved')

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([fetchWpblFanPhotoQueue(), fetchWpblAllPlayers()]).then(([q, pl]) => {
      setPhotos(q.photos); setSubjects(q.subjects); setFigures(q.figures); setPlayers(pl)
      setLoading(false)
    })
  }, [])
  useEffect(() => load(), [load])

  const playersById = useMemo(() => new Map(players.map(p => [p.id, p])), [players])
  const figuresByKey = useMemo(() => new Map(figures.map(f => [f.key, f])), [figures])
  const subjectsByPhoto = useMemo(() => {
    const m = new Map<string, WpblPhotoSubject[]>()
    for (const s of subjects) m.set(s.photo_id, [...(m.get(s.photo_id) ?? []), s])
    return m
  }, [subjects])

  const counts = useMemo(() => ({
    unapproved: photos.filter(p => !p.approved).length,
    approved: photos.filter(p => p.approved).length,
    all: photos.length,
  }), [photos])

  const shown = photos.filter(p =>
    filter === 'all' ? true : filter === 'approved' ? p.approved : !p.approved)

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, mb: 1.5, flexWrap: 'wrap' }}>
        {FILTERS.map(f => (
          <Chip key={f.value} label={`${f.label} (${counts[f.value]})`}
            active={filter === f.value} onClick={() => setFilter(f.value)} />
        ))}
        <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 0.5 }}>
          {loading && <CircularProgress size={14} />}
          <IconButton size="small" onClick={load} sx={{ color: 'text.secondary' }} aria-label="Refresh">
            <Refresh sx={{ fontSize: '1.05rem' }} />
          </IconButton>
        </Box>
      </Box>

      <Section title="Figures (non-player subjects)">
        <FigureAdder onAdded={load} />
        {figures.length > 0 && (
          <Box sx={{ px: 1.5, pb: 1.5, display: 'flex', flexWrap: 'wrap', gap: 0.6 }}>
            {figures.map(f => (
              <Box key={f.key} sx={{ px: 1, py: 0.3, borderRadius: 999, bgcolor: 'action.hover',
                fontSize: '0.7rem', fontWeight: 600, color: 'text.secondary' }}>
                {f.name} · {f.kind}
              </Box>
            ))}
          </Box>
        )}
      </Section>

      <Section title="Photos">
        {shown.length === 0 ? (
          <Box sx={{ px: 1.5, py: 3, textAlign: 'center' }}>
            <Typography sx={{ fontSize: '0.8rem', color: 'text.disabled' }}>
              {loading ? 'Loading…'
                : filter === 'unapproved' ? 'Nothing waiting. Ingest a batch, or check Published.'
                : 'No photos here yet.'}
            </Typography>
          </Box>
        ) : (
          shown.map(p => (
            <PhotoCard key={p.id} photo={p} subjects={subjectsByPhoto.get(p.id) ?? []}
              players={playersById} figures={figuresByKey} onChange={load} />
          ))
        )}
      </Section>

      <Typography sx={{ fontSize: '0.64rem', color: 'text.disabled', mt: 1 }}>
        Bytes arrive by the ingest CLI ("npm run ingest-fan-photos"); this only tags, captions and
        publishes. A photo is invisible to readers until Published. A clear foreground photo of
        members of the public, especially children, does not go up.
      </Typography>
    </Box>
  )
}
