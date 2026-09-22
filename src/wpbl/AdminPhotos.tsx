import { useCallback, useEffect, useMemo, useState } from 'react'
import { Box, Typography, TextField, CircularProgress, MenuItem, Select, IconButton } from '@mui/material'
import { Close, Refresh } from '@mui/icons-material'
import { Section } from '../AdminPanel'
import { supabase } from '../lib/supabase'
import {
  fetchWpblFanPhotoQueue, fetchWpblAllPlayers,
  setFanPhotoApproved, updateFanPhoto, addFanPhotoSubject, removeFanPhotoSubject, upsertFanPhotoFigure,
  fetchFanPhotoContributors, createFanPhotoContributor, findFanPhotoBySha, insertFanPhoto,
  type WpblFanPhotoRow,
} from './api'
import { prepareForUpload, uploadPreparedPhoto } from './fanPhotoUpload'
import type { WpblPlayer, WpblPhotoSubject, WpblPhotoFigure, WpblPhotoContributor } from './types'

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

// Upload from the browser: pick a contributor (the permission record), then pick photos. Each
// file is hashed, checked against the library so the same shot is never uploaded twice, rendered
// to webp in a canvas (EXIF dropped), sent to R2 through the owner-gated endpoint, and inserted
// as an unpublished row. The CLI ingest still exists for a laptop and a big drop folder; this is
// the from-a-phone path. See docs/FAN_PHOTOS.md.
type UploadRow = { name: string; status: 'preparing' | 'uploading' | 'duplicate' | 'done' | 'error'; msg?: string }
const STATUS_COLOR: Record<UploadRow['status'], string> = {
  preparing: 'text.disabled', uploading: 'info.main', duplicate: 'warning.main',
  done: 'success.main', error: 'error.main',
}
const STATUS_LABEL: Record<UploadRow['status'], string> = {
  preparing: 'preparing…', uploading: 'uploading…', duplicate: 'already uploaded', done: 'uploaded', error: 'failed',
}

function UploadPanel({ onUploaded }: { onUploaded: () => void }) {
  const [contributors, setContributors] = useState<WpblPhotoContributor[]>([])
  const [selected, setSelected] = useState('')
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ display_name: '', contact: '', permission_granted_on: '', permission_evidence: '', permission_scope: 'site display' })
  const [rows, setRows] = useState<UploadRow[]>([])
  const [busy, setBusy] = useState(false)

  const loadContribs = useCallback(() => { fetchFanPhotoContributors().then(setContributors) }, [])
  useEffect(() => loadContribs(), [loadContribs])

  const canSaveContributor = form.display_name.trim() !== '' && form.permission_evidence.trim() !== ''
  const saveContributor = async () => {
    if (!canSaveContributor) return
    setBusy(true)
    const id = await createFanPhotoContributor({
      display_name: form.display_name.trim(),
      contact: form.contact.trim() || null,
      permission_granted_on: form.permission_granted_on || null,
      permission_evidence: form.permission_evidence.trim(),
      permission_scope: form.permission_scope.trim() || null,
    })
    setBusy(false)
    if (id) {
      setForm({ display_name: '', contact: '', permission_granted_on: '', permission_evidence: '', permission_scope: 'site display' })
      setAdding(false); await loadContribs(); setSelected(id)
    }
  }

  const onFiles = async (fileList: FileList | null) => {
    const contributor = contributors.find(c => c.id === selected)
    if (!fileList || fileList.length === 0 || !contributor) return
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (!token) { setRows([{ name: '—', status: 'error', msg: 'Not signed in' }]); return }

    const files = Array.from(fileList)
    setRows(files.map(f => ({ name: f.name, status: 'preparing' as const })))
    setBusy(true)
    const set = (i: number, status: UploadRow['status'], msg?: string) =>
      setRows(r => r.map((row, j) => (j === i ? { ...row, status, msg } : row)))
    for (let i = 0; i < files.length; i++) {
      try {
        const prepared = await prepareForUpload(files[i])
        const existing = await findFanPhotoBySha(prepared.sha256)
        if (existing) { set(i, 'duplicate', existing.approved ? 'already published' : 'in the queue'); continue }
        set(i, 'uploading')
        const loc = await uploadPreparedPhoto(prepared, token)
        const id = await insertFanPhoto({
          sha256: prepared.sha256, storage_path: loc.storage_path, card_url: loc.card_url, full_url: loc.full_url,
          width: prepared.width, height: prepared.height, credit: contributor.display_name, contributor_id: contributor.id,
        })
        set(i, id ? 'done' : 'error', id ? undefined : 'saved to R2 but the row insert failed')
      } catch (e) {
        set(i, 'error', (e as Error).message)
      }
    }
    setBusy(false)
    onUploaded()
  }

  const field = (key: keyof typeof form, placeholder: string, type?: string) => (
    <TextField value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
      placeholder={placeholder} type={type} size="small" InputProps={{ sx: { fontSize: '0.8rem' } }}
      sx={{ '& .MuiInputBase-input': { py: 0.5 } }} />
  )

  return (
    <Section title="Upload photos">
      <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
        {/* contributor: pick who took them, or add a new permission record */}
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <Select value={selected} onChange={e => setSelected(e.target.value)} displayEmpty size="small"
            sx={{ fontSize: '0.8rem', minWidth: 200, flex: 1 }}>
            <MenuItem value="" disabled sx={{ fontSize: '0.8rem' }}>Photographer…</MenuItem>
            {contributors.map(c => <MenuItem key={c.id} value={c.id} sx={{ fontSize: '0.8rem' }}>{c.display_name}</MenuItem>)}
          </Select>
          <Box onClick={() => setAdding(a => !a)} role="button" tabIndex={0} sx={{
            px: 1.3, py: 0.55, borderRadius: 999, cursor: 'pointer', userSelect: 'none', fontSize: '0.74rem',
            fontWeight: 800, border: '1px solid', borderColor: 'divider', color: 'text.secondary',
          }}>{adding ? 'Cancel' : '+ New'}</Box>
        </Box>

        {adding && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.8, p: 1.2, borderRadius: 1.5, bgcolor: 'action.hover' }}>
            {field('display_name', 'Name to credit (required)')}
            {field('permission_evidence', 'Where they said yes: Discord/email link (required)')}
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <Box sx={{ flex: 1, minWidth: 120 }}>{field('contact', 'Contact')}</Box>
              <Box sx={{ width: 150 }}>{field('permission_granted_on', 'Granted on', 'date')}</Box>
            </Box>
            {field('permission_scope', 'Scope (e.g. site display)')}
            <Box onClick={saveContributor} role="button" tabIndex={0} sx={{
              alignSelf: 'flex-start', px: 1.5, py: 0.6, borderRadius: 999,
              cursor: canSaveContributor ? 'pointer' : 'default', userSelect: 'none', fontSize: '0.74rem', fontWeight: 800,
              border: '1px solid', borderColor: canSaveContributor ? 'primary.main' : 'divider',
              color: canSaveContributor ? 'primary.main' : 'text.disabled',
            }}>Save photographer</Box>
          </Box>
        )}

        {/* the file picker: disabled until a photographer is chosen, so every photo has a credit */}
        <Box component="label" sx={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, py: 1.6,
          borderRadius: 1.5, border: '2px dashed', borderColor: selected && !busy ? 'primary.main' : 'divider',
          color: selected && !busy ? 'primary.main' : 'text.disabled',
          cursor: selected && !busy ? 'pointer' : 'default', fontSize: '0.82rem', fontWeight: 700,
        }}>
          {busy ? <CircularProgress size={16} /> : null}
          {busy ? 'Uploading…' : selected ? 'Choose photos to upload' : 'Pick a photographer first'}
          <input type="file" accept="image/*" multiple hidden disabled={!selected || busy}
            onChange={e => { onFiles(e.target.files); e.target.value = '' }} />
        </Box>

        {rows.length > 0 && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.3, mt: 0.3 }}>
            {rows.map((r, i) => (
              <Box key={`${r.name}-${i}`} sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
                <Typography noWrap sx={{ fontSize: '0.72rem', flex: 1, minWidth: 0 }}>{r.name}</Typography>
                <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, color: STATUS_COLOR[r.status] }}>
                  {STATUS_LABEL[r.status]}
                </Typography>
              </Box>
            ))}
            {rows.some(r => r.msg) && (
              <Typography sx={{ fontSize: '0.64rem', color: 'error.main', mt: 0.3 }}>
                {rows.filter(r => r.msg).map(r => `${r.name}: ${r.msg}`).join(' · ')}
              </Typography>
            )}
          </Box>
        )}
      </Box>
    </Section>
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

      <UploadPanel onUploaded={load} />

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
