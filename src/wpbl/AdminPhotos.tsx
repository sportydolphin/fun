import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { Box, Typography, TextField, CircularProgress, MenuItem, Select, IconButton, Dialog } from '@mui/material'
import { Close, Refresh, ChevronLeft, ChevronRight, Crop } from '@mui/icons-material'
import { Section } from '../AdminPanel'
import { supabase } from '../lib/supabase'
import {
  fetchWpblFanPhotoQueue, fetchWpblAllPlayers, fetchWpblTeams, invalidateWpblFanPhotos,
  setFanPhotoApproved, updateFanPhoto, addFanPhotoSubject, removeFanPhotoSubject, upsertFanPhotoFigure, upsertFanPhotoCategory,
  fetchFanPhotoContributors, createFanPhotoContributor, updateFanPhotoContributor, findFanPhotoBySha, insertFanPhoto,
  type WpblFanPhotoRow,
} from './api'
import { prepareForUpload, uploadPreparedPhoto } from './fanPhotoUpload'

// The crop library and its stylesheet load only when Crop is pressed.
const PhotoCropper = lazy(() => import('./PhotoCropper'))
import { fanPhotoTeamName } from './fanPhotos'
import type { WpblPlayer, WpblPhotoSubject, WpblPhotoFigure, WpblPhotoContributor, WpblTeam, WpblPhotoCategory } from './types'

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

// What every photo editor needs to hand its controls: the lookups for naming a tag, and the one
// write wrapper. `run` dims the controls while a write is in flight and reloads the queue after,
// so a double tap cannot tag the same player twice.
type Lookups = {
  players: Map<string, WpblPlayer>
  figures: Map<string, WpblPhotoFigure>
  teams: WpblTeam[]
  categories: WpblPhotoCategory[]
  /** The photographers (owner-only permission records), for the photo's Photographer field. */
  contributors: WpblPhotoContributor[]
}
type Runner = { busy: boolean; run: (fn: () => Promise<unknown>) => Promise<void> }

function useRunner(onChange: () => void): Runner {
  const [busy, setBusy] = useState(false)
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); await fn(); setBusy(false); onChange() }
  return { busy, run }
}

const tagKey = (s: WpblPhotoSubject) =>
  s.player_id ? `p:${s.player_id}` : s.team_id ? `t:${s.team_id}` : `f:${s.figure_key}`
const candidateKey = (c: Candidate) =>
  'playerId' in c.add ? `p:${c.add.playerId}` : `f:${c.add.figureKey}`

// ─── Photographers ─────────────────────────────────────────────────────────────────

type ContributorDraft = {
  display_name: string; contact: string; permission_granted_on: string
  permission_evidence: string; permission_scope: string; withdrawn_on: string
}
const EMPTY_CONTRIBUTOR: ContributorDraft = {
  display_name: '', contact: '', permission_granted_on: '', permission_evidence: '', permission_scope: 'site display', withdrawn_on: '',
}
const draftOf = (c: WpblPhotoContributor): ContributorDraft => ({
  display_name: c.display_name, contact: c.contact ?? '', permission_granted_on: c.permission_granted_on ?? '',
  permission_evidence: c.permission_evidence ?? '', permission_scope: c.permission_scope ?? '', withdrawn_on: c.withdrawn_on ?? '',
})

/**
 * A photographer's record, for adding one (the upload panel) and for editing one (the photo editor
 * and the Photographers section): the one form, so a field added to the record is editable
 * everywhere it is entered. Name and "where they said yes" are required, because a photo with no
 * credit or no permission record should not be publishable. Withdrawal is offered only when
 * editing, since nobody withdraws before they have been added.
 */
function ContributorForm({ initial, editing, submitLabel, onSubmit, onCancel }: {
  initial: ContributorDraft
  editing?: boolean
  submitLabel: string
  onSubmit: (d: ContributorDraft) => Promise<void>
  onCancel?: () => void
}) {
  const [form, setForm] = useState(initial)
  const [saving, setSaving] = useState(false)
  // `initial` seeds the draft once; callers key the form by the record, so a different
  // photographer remounts it rather than a reload wiping what is being typed.
  const ok = form.display_name.trim() !== '' && form.permission_evidence.trim() !== ''
  const submit = async () => {
    if (!ok || saving) return
    if (editing && form.withdrawn_on && !initial.withdrawn_on
      && !window.confirm(`Mark ${form.display_name.trim()} as withdrawn? Every photo of theirs will be unpublished.`)) return
    setSaving(true)
    await onSubmit(form)
    setSaving(false)
  }
  const field = (key: keyof ContributorDraft, placeholder: string, type?: string) => (
    <TextField value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
      placeholder={placeholder} label={type === 'date' ? placeholder : undefined} type={type} size="small" fullWidth
      InputLabelProps={type === 'date' ? { shrink: true } : undefined}
      InputProps={{ sx: { fontSize: '0.85rem' } }}
      sx={{ '& .MuiInputBase-input': { py: 1 } }} />
  )
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, p: 1.5, borderRadius: 2, bgcolor: 'action.hover', opacity: saving ? 0.6 : 1 }}>
      {field('display_name', 'Name to credit (required)')}
      {field('permission_evidence', 'Where they said yes: link or note (required)')}
      {/* Stacks on a phone, sits side by side once there is room. */}
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 1 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>{field('contact', 'Contact')}</Box>
        <Box sx={{ width: { xs: '100%', sm: 170 }, flexShrink: 0 }}>{field('permission_granted_on', 'Granted on', 'date')}</Box>
      </Box>
      {field('permission_scope', 'Scope (e.g. site display)')}
      {editing && (
        <Box sx={{ width: { xs: '100%', sm: 170 } }}>{field('withdrawn_on', 'Withdrawn on', 'date')}</Box>
      )}
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Box onClick={submit} role="button" tabIndex={0}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); submit() } }}
          sx={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 44, px: 2.5,
            borderRadius: 999, userSelect: 'none', fontSize: '0.8rem', fontWeight: 800, border: '1px solid',
            cursor: ok ? 'pointer' : 'default',
            borderColor: ok ? 'primary.main' : 'divider', color: ok ? 'primary.main' : 'text.disabled',
          }}>{saving ? 'Saving…' : submitLabel}</Box>
        {onCancel && (
          <Box onClick={onCancel} role="button" tabIndex={0} sx={{
            display: 'flex', alignItems: 'center', minHeight: 44, px: 1.5, cursor: 'pointer', userSelect: 'none',
            fontSize: '0.8rem', fontWeight: 700, color: 'text.secondary',
          }}>Cancel</Box>
        )}
      </Box>
    </Box>
  )
}

/** The draft as the record the API takes: blanks become nulls, the name is trimmed. */
const recordOf = (d: ContributorDraft) => ({
  display_name: d.display_name.trim(),
  contact: d.contact.trim() || null,
  permission_granted_on: d.permission_granted_on || null,
  permission_evidence: d.permission_evidence.trim(),
  permission_scope: d.permission_scope.trim() || null,
})

/**
 * Who took this photo: pick a photographer, or fix their details in place.
 *
 * PICKING SETS BOTH COLUMNS: `contributor_id` (the permission record) and `credit` (its public
 * copy, which is all a reader ever sees). Editing the record renames the credit on every photo of
 * theirs (updateFanPhotoContributor), so a typo in a name is one fix, not one per photo.
 */
function PhotographerField({ photo, lookups, runner }: { photo: WpblFanPhotoRow; lookups: Lookups; runner: Runner }) {
  const { busy, run } = runner
  const [editing, setEditing] = useState(false)
  const current = lookups.contributors.find(c => c.id === photo.contributor_id) ?? null
  const initial = useMemo(() => (current ? draftOf(current) : EMPTY_CONTRIBUTOR), [current])
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.8 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, color: 'text.disabled', flexShrink: 0 }}>Photographer</Typography>
        {/* The current record's id, or '' when there is none or it did not load: an id with no
            matching option would leave MUI's Select showing nothing at all. */}
        <Select value={current ? current.id : ''} displayEmpty size="small" disabled={busy}
          onChange={e => {
            const id = String(e.target.value)
            const c = lookups.contributors.find(x => x.id === id)
            setEditing(false)
            run(() => updateFanPhoto(photo.id, { contributor_id: c ? c.id : null, credit: c ? c.display_name : null }))
          }}
          sx={{ flex: 1, minWidth: 0, fontSize: '0.8rem', '& .MuiSelect-select': { py: 0.5 } }}>
          <MenuItem value="" sx={{ fontSize: '0.8rem' }}>
            {photo.credit ? `${photo.credit} (no record)` : 'No photographer'}
          </MenuItem>
          {lookups.contributors.map(c => (
            <MenuItem key={c.id} value={c.id} sx={{ fontSize: '0.8rem' }}>
              {c.display_name}{c.withdrawn_on ? ' (withdrawn)' : ''}
            </MenuItem>
          ))}
        </Select>
        {current && (
          <Box onClick={() => setEditing(v => !v)} role="button" tabIndex={0}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setEditing(v => !v) } }}
            sx={{ flexShrink: 0, fontSize: '0.74rem', fontWeight: 700, color: 'primary.main', cursor: 'pointer', userSelect: 'none', px: 0.5 }}>
            {editing ? 'Close' : 'Edit details'}
          </Box>
        )}
      </Box>
      {current?.withdrawn_on && (
        <Typography sx={{ fontSize: '0.68rem', color: 'warning.main', fontWeight: 700 }}>
          Withdrawn {current.withdrawn_on}: this photo should not be published.
        </Typography>
      )}
      {editing && current && (
        <ContributorForm key={current.id} initial={initial} editing submitLabel="Save photographer"
          onCancel={() => setEditing(false)}
          onSubmit={async d => {
            await run(() => updateFanPhotoContributor(current.id, { ...recordOf(d), withdrawn_on: d.withdrawn_on || null }, current))
            setEditing(false)
          }} />
      )}
    </Box>
  )
}

/**
 * The Photographers section of /admin: every permission record, how many photos it covers, and
 * the same form to fix one. This is where a photographer with no photos yet (or one whose photos
 * are all unpublished) is reachable, which the per-photo field cannot offer.
 */
function PhotographersSection({ contributors, photos, onChange }: {
  contributors: WpblPhotoContributor[]; photos: WpblFanPhotoRow[]; onChange: () => void
}) {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <Section title={`Photographers (${contributors.length})`}>
      {contributors.length === 0 ? (
        <Typography sx={{ px: 1.5, py: 2, fontSize: '0.8rem', color: 'text.disabled' }}>
          None yet. Add one from Upload photos.
        </Typography>
      ) : contributors.map(c => {
        const theirs = photos.filter(p => p.contributor_id === c.id)
        const published = theirs.filter(p => p.approved).length
        const isOpen = open === c.id
        return (
          <Box key={c.id} sx={{ px: 1.5, py: 1, '&:not(:last-child)': { borderBottom: '1px solid', borderColor: 'divider' } }}>
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontSize: '0.85rem', fontWeight: 700 }}>
                  {c.display_name}
                  {c.withdrawn_on && <Box component="span" sx={{ color: 'warning.main', fontSize: '0.7rem', ml: 0.75 }}>withdrawn {c.withdrawn_on}</Box>}
                </Typography>
                <Typography sx={{ fontSize: '0.7rem', color: 'text.disabled' }}>
                  {theirs.length} photo{theirs.length === 1 ? '' : 's'} · {published} published
                  {c.contact ? ` · ${c.contact}` : ''}
                </Typography>
              </Box>
              <Box onClick={() => setOpen(isOpen ? null : c.id)} role="button" tabIndex={0}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(isOpen ? null : c.id) } }}
                sx={{ flexShrink: 0, fontSize: '0.76rem', fontWeight: 700, color: 'primary.main', cursor: 'pointer', userSelect: 'none', px: 0.5, py: 0.5 }}>
                {isOpen ? 'Close' : 'Edit'}
              </Box>
            </Box>
            {isOpen && (
              <Box sx={{ mt: 1 }}>
                <ContributorForm key={c.id} initial={draftOf(c)} editing submitLabel="Save photographer"
                  onCancel={() => setOpen(null)}
                  onSubmit={async d => {
                    const ok = await updateFanPhotoContributor(c.id, { ...recordOf(d), withdrawn_on: d.withdrawn_on || null }, c)
                    if (ok) { setOpen(null); onChange() }
                  }} />
              </Box>
            )}
          </Box>
        )
      })}
    </Section>
  )
}

// The tagging controls themselves: who is tagged, the picker, the team-photo row and the caption.
// Shared by the list card and tag mode, so the two cannot drift into tagging differently.
// `recent` is tag mode's one-tap row: people tagged on the photos just before this one, because a
// batch is usually one game and the same few players.
function TagFields({ photo, subjects, lookups, runner, recent, onPicked }: {
  photo: WpblFanPhotoRow
  subjects: WpblPhotoSubject[]
  lookups: Lookups
  runner: Runner
  recent?: Candidate[]
  onPicked?: (c: Candidate) => void
}) {
  const { players, figures, teams } = lookups
  const { busy, run } = runner
  const tagged = new Set(subjects.map(tagKey))
  const teamTag = new Map(subjects.filter(s => s.team_id).map(s => [s.team_id!, s.id]))

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

  const pick = (c: Candidate) => { if (busy) return; onPicked?.(c); run(() => addFanPhotoSubject(photo.id, c.add)) }
  const quick = (recent ?? []).filter(c => !tagged.has(candidateKey(c)))

  const subjectName = (s: WpblPhotoSubject) =>
    s.player_id ? (players.get(s.player_id)?.name ?? 'Unknown player')
    : s.team_id ? `${fanPhotoTeamName(teams.find(t => t.id === s.team_id))} (team)`
    : (figures.get(s.figure_key ?? '')?.name ?? s.figure_key ?? 'Unknown')

  return (
    <Box sx={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.8 }}>
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

      {quick.length > 0 && (
        <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0.6 }}>
          <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, color: 'text.disabled', mr: 0.2 }}>
            Recent
          </Typography>
          {quick.map(c => (
            <Chip key={candidateKey(c)} label={`+ ${c.label}`} active={false} onClick={() => pick(c)} />
          ))}
        </Box>
      )}

      <SubjectPicker candidates={candidates} onPick={pick} />

      {/* Team photo: tag the whole club rather than twenty players one by one. Toggles. */}
      {teams.length > 0 && (
        <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0.6 }}>
          <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, color: 'text.disabled', mr: 0.2 }}>
            Team photo
          </Typography>
          {teams.map(t => {
            const tagId = teamTag.get(t.id)
            return (
              <Chip key={t.id} label={t.abbr} active={!!tagId} onClick={() => {
                if (busy) return
                run(() => tagId ? removeFanPhotoSubject(tagId) : addFanPhotoSubject(photo.id, { teamId: t.id }))
              }} />
            )
          })}
        </Box>
      )}

      {lookups.categories.length > 0 && (
        <CategorySelect categories={lookups.categories} value={photo.category_key}
          onChange={v => run(() => updateFanPhoto(photo.id, { category_key: v }))} />
      )}

      <SavingField value={photo.caption} placeholder="Caption (plain text)" multiline
        onSave={v => run(() => updateFanPhoto(photo.id, { caption: v }))} />

      <PhotographerField photo={photo} lookups={lookups} runner={runner} />
    </Box>
  )
}

// A photo's category. Empty means an ordinary fan photo, which is what every photo was before
// categories existed, so it is the default and needs no name of its own here.
function CategorySelect({ categories, value, onChange, size = 'compact' }: {
  categories: WpblPhotoCategory[]; value: string | null; onChange: (v: string | null) => void
  size?: 'compact' | 'touch'
}) {
  return (
    <Select value={value ?? ''} displayEmpty size="small" onChange={e => onChange(e.target.value === '' ? null : String(e.target.value))}
      sx={{ fontSize: size === 'touch' ? '0.85rem' : '0.8rem', '& .MuiSelect-select': { py: size === 'touch' ? 1.25 : 0.5 } }}>
      <MenuItem value="" sx={{ fontSize: '0.8rem' }}>Fan photo (no category)</MenuItem>
      {categories.map(c => <MenuItem key={c.key} value={c.key} sx={{ fontSize: '0.8rem' }}>{c.name}</MenuItem>)}
    </Select>
  )
}

function PublishButton({ approved, label, onClick }: { approved: boolean; label?: string; onClick: () => void }) {
  return (
    <Box
      onClick={onClick}
      role="button" tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }}
      sx={{
        flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: { xs: 44, sm: 0 }, px: 2, py: 0.6, borderRadius: 999, cursor: 'pointer', userSelect: 'none',
        fontSize: '0.8rem', fontWeight: 800, border: '1px solid',
        borderColor: approved ? 'success.main' : 'primary.main',
        bgcolor: approved ? 'success.main' : 'primary.main',
        color: '#fff',
      }}
    >
      {label ?? (approved ? '✓ Published' : 'Publish')}
    </Box>
  )
}

function PhotoCard({ photo, subjects, lookups, onChange, onOpen }: {
  photo: WpblFanPhotoRow
  subjects: WpblPhotoSubject[]
  lookups: Lookups
  onChange: () => void
  onOpen: () => void
}) {
  const runner = useRunner(onChange)
  const { busy, run } = runner
  const togglePublish = () => { if (!busy) run(() => setFanPhotoApproved(photo.id, !photo.approved)) }

  // A grid rather than a row: beside a 120px thumbnail a phone has ~190px left, too little for the
  // date field and Publish together, and the Section clips its overflow, so Publish was simply cut
  // off. On a phone the actions take the card's full width under the thumbnail.
  return (
    <Box sx={{
      display: 'grid', columnGap: 1.5, rowGap: 1, p: 1.5,
      gridTemplateColumns: { xs: '84px minmax(0, 1fr)', sm: '120px minmax(0, 1fr)' },
      gridTemplateAreas: { xs: '"img fields" "actions actions"', sm: '"img fields" "img actions"' },
      gridTemplateRows: { sm: 'auto 1fr' },
      '&:not(:last-child)': { borderBottom: '1px solid', borderColor: 'divider' },
      opacity: busy ? 0.6 : 1, transition: 'opacity .15s',
    }}>
      <Box sx={{ gridArea: 'img', minWidth: 0 }}>
        {/* The thumbnail opens tag mode on this photo: a 120px square is too small to tell who is who. */}
        <Box component="button" type="button" onClick={onOpen} aria-label="Open in tag mode"
          sx={{ p: 0, border: 0, bgcolor: 'transparent', cursor: 'zoom-in', display: 'block', width: '100%' }}>
          <Box component="img" src={photo.card_url} alt={photo.caption ?? 'Fan photo'} loading="lazy"
            sx={{ width: '100%', aspectRatio: '1', objectFit: 'contain', borderRadius: 1.5, bgcolor: 'action.hover',
                  display: 'block', border: '1px solid', borderColor: 'divider' }} />
        </Box>
        {photo.taken_on && (
          <Typography sx={{ fontSize: '0.62rem', color: 'text.disabled', mt: 0.5 }}>shot {photo.taken_on}</Typography>
        )}
      </Box>

      <Box sx={{ gridArea: 'fields', minWidth: 0 }}>
        <TagFields photo={photo} subjects={subjects} lookups={lookups} runner={runner} />
      </Box>

      <Box sx={{ gridArea: 'actions', minWidth: 0, display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box sx={{ flex: { xs: 1, sm: '0 0 150px' }, minWidth: 0 }}>
          <SavingField value={photo.taken_on} placeholder="Taken on" type="date"
            onSave={v => run(() => updateFanPhoto(photo.id, { taken_on: v }))} />
        </Box>
        <Box sx={{ flex: 1, display: { xs: 'none', sm: 'block' } }} />
        <PublishButton approved={photo.approved} onClick={togglePublish} />
      </Box>
    </Box>
  )
}

// Tag mode: one photo at a time, as large as the screen allows, with the same controls directly
// under it, and a way to step through the rest. The list card's thumbnail is too small to tell
// who is who, which made tagging a batch a matter of opening each one elsewhere.
//
// It walks a SNAPSHOT of the ids that were on screen when it opened, not the live filtered list:
// publishing a photo drops it out of "To review", and walking the live list would skip the next
// one under the reader's thumb. Each step looks its photo up fresh, so edits show immediately.
function TagMode({ ids, start, photos, subjectsByPhoto, lookups, onChange, onClose }: {
  ids: string[]
  start: number
  photos: WpblFanPhotoRow[]
  subjectsByPhoto: Map<string, WpblPhotoSubject[]>
  lookups: Lookups
  onChange: () => void
  onClose: () => void
}) {
  const [at, setAt] = useState(start)
  const [recent, setRecent] = useState<Candidate[]>([])
  const [cropping, setCropping] = useState(false)
  const runner = useRunner(onChange)
  const { busy, run } = runner
  const byId = useMemo(() => new Map(photos.map(p => [p.id, p])), [photos])
  const photo = byId.get(ids[at])
  const last = at >= ids.length - 1

  // Stepping always leaves the crop step: a crop belongs to the photo it was started on.
  const go = useCallback((d: number) => {
    setCropping(false)
    setAt(i => Math.min(ids.length - 1, Math.max(0, i + d)))
  }, [ids.length])

  // Arrow keys step through, except while typing, where they move the caret, and while cropping,
  // where the cropper uses them to nudge the selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (cropping) return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if (e.key === 'ArrowRight') go(1)
      else if (e.key === 'ArrowLeft') go(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, cropping])

  // Most recent first, eight at most: enough for one club's regulars without becoming a roster.
  const onPicked = (c: Candidate) =>
    setRecent(r => [c, ...r.filter(x => candidateKey(x) !== candidateKey(c))].slice(0, 8))

  const publishAndNext = () => {
    if (busy || !photo) return
    if (!photo.approved) run(() => setFanPhotoApproved(photo.id, true))
    if (!last) go(1)
  }

  const navBtn = { color: '#fff', '&.Mui-disabled': { color: 'rgba(255,255,255,0.25)' } }

  return (
    <Dialog open fullScreen onClose={onClose} PaperProps={{ sx: { bgcolor: 'background.default' } }}>
      {/* Top bar: close, position, and the step buttons, over the photo's dark backdrop. */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.5, bgcolor: '#000', color: '#fff' }}>
        <IconButton onClick={onClose} aria-label="Close tag mode" sx={navBtn}><Close /></IconButton>
        <Typography sx={{ fontSize: '0.8rem', fontWeight: 700, flex: 1 }}>
          {ids.length > 0 ? `${at + 1} / ${ids.length}` : ''}
        </Typography>
        {photo && (
          <IconButton onClick={() => setCropping(c => !c)} aria-label={cropping ? 'Stop cropping' : 'Crop photo'}
            sx={{ ...navBtn, ...(cropping ? { bgcolor: 'rgba(255,255,255,0.18)' } : {}) }}><Crop /></IconButton>
        )}
        <IconButton onClick={() => go(-1)} disabled={at === 0} aria-label="Previous photo" sx={navBtn}><ChevronLeft /></IconButton>
        <IconButton onClick={() => go(1)} disabled={last} aria-label="Next photo" sx={navBtn}><ChevronRight /></IconButton>
      </Box>

      <Box sx={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        {cropping && photo ? (
          <Suspense fallback={<Box sx={{ height: { xs: '48vh', md: '62vh' }, bgcolor: '#000' }} />}>
            <PhotoCropper key={photo.id} photo={photo}
              onCancel={() => setCropping(false)}
              onDone={() => { setCropping(false); onChange() }} />
          </Suspense>
        ) : <>
        {/* The photo, contained rather than cropped: a face at the edge of the frame is exactly the
            one you need to see. Capped so the controls start above the fold on a phone. */}
        <Box sx={{
          bgcolor: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center',
          height: { xs: '48vh', md: '62vh' }, flexShrink: 0,
        }}>
          {photo ? (
            <Box component="img" key={photo.id} src={photo.full_url} alt={photo.caption ?? 'Fan photo'}
              sx={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block' }} />
          ) : (
            <Typography sx={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.85rem' }}>This photo is gone.</Typography>
          )}
        </Box>

        {photo && (
          <Box sx={{
            width: '100%', maxWidth: 720, mx: 'auto', p: { xs: 1.5, sm: 2 },
            display: 'flex', flexDirection: 'column', gap: 1.2,
            opacity: busy ? 0.6 : 1, transition: 'opacity .15s',
          }}>
            <Typography sx={{ fontSize: '0.7rem', color: 'text.disabled' }}>
              {photo.approved ? 'Published' : 'Not published'}
            </Typography>
            <TagFields photo={photo} subjects={subjectsByPhoto.get(photo.id) ?? []} lookups={lookups}
              runner={runner} recent={recent} onPicked={onPicked} />
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              <Box sx={{ flex: { xs: '1 1 100%', sm: '0 0 160px' }, minWidth: 0 }}>
                <SavingField value={photo.taken_on} placeholder="Taken on" type="date"
                  onSave={v => run(() => updateFanPhoto(photo.id, { taken_on: v }))} />
              </Box>
              <Box sx={{ flex: 1, display: { xs: 'none', sm: 'block' } }} />
              {photo.approved && (
                <Box onClick={() => { if (!busy) run(() => setFanPhotoApproved(photo.id, false)) }} role="button" tabIndex={0}
                  sx={{ fontSize: '0.74rem', fontWeight: 700, color: 'text.secondary', cursor: 'pointer', px: 1, userSelect: 'none' }}>
                  Unpublish
                </Box>
              )}
              {!last && !photo.approved && (
                <Box onClick={() => go(1)} role="button" tabIndex={0} sx={{
                  display: 'flex', alignItems: 'center', minHeight: { xs: 44, sm: 0 }, px: 2, py: 0.6,
                  borderRadius: 999, border: '1px solid', borderColor: 'divider', cursor: 'pointer', userSelect: 'none',
                  fontSize: '0.8rem', fontWeight: 800, color: 'text.secondary',
                }}>Skip</Box>
              )}
              <PublishButton approved={photo.approved}
                label={photo.approved ? (last ? '✓ Published' : 'Next') : (last ? 'Publish' : 'Publish & next')}
                onClick={publishAndNext} />
            </Box>
          </Box>
        )}
        </>}
      </Box>
    </Dialog>
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

// Create a category (Fan signs, The ballpark) for photos that are not of anyone in particular.
// The key is the name's slug, so saving the same name again renames nothing and duplicates nothing.
function CategoryAdder({ count, onAdded }: { count: number; onAdded: () => void }) {
  const [name, setName] = useState('')
  const [blurb, setBlurb] = useState('')
  const [busy, setBusy] = useState(false)
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const add = async () => {
    if (!slug || busy) return
    setBusy(true)
    const ok = await upsertFanPhotoCategory({ key: slug, name: name.trim(), blurb: blurb.trim() || null, sort_order: count })
    setBusy(false)
    if (ok) { setName(''); setBlurb(''); onAdded() }
  }
  return (
    <Box sx={{ display: 'flex', gap: 1, p: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
      <TextField value={name} onChange={e => setName(e.target.value)} placeholder="New category (e.g. Fan signs)"
        size="small" InputProps={{ sx: { fontSize: '0.8rem' } }} sx={{ flex: 1, minWidth: 180 }} />
      <TextField value={blurb} onChange={e => setBlurb(e.target.value)} placeholder="One-line description (optional)"
        size="small" InputProps={{ sx: { fontSize: '0.8rem' } }} sx={{ flex: 2, minWidth: 180 }} />
      <Box onClick={add} role="button" tabIndex={0} sx={{
        px: 1.5, py: 0.6, borderRadius: 999, cursor: slug ? 'pointer' : 'default', userSelect: 'none',
        fontSize: '0.74rem', fontWeight: 800, border: '1px solid',
        borderColor: slug ? 'primary.main' : 'divider', color: slug ? 'primary.main' : 'text.disabled',
      }}>Add category</Box>
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

function UploadPanel({ categories, contributors, onContributorsChanged, onUploaded }: {
  categories: WpblPhotoCategory[]
  /** Loaded by the page, so a photographer edited in the Photographers section shows here too. */
  contributors: WpblPhotoContributor[]
  onContributorsChanged: () => Promise<void>
  onUploaded: () => void
}) {
  // Which category this batch goes into. Kept across batches, since a run of sign photos is
  // usually uploaded in several goes.
  const [category, setCategory] = useState<string | null>(null)
  const [selected, setSelected] = useState('')
  const [adding, setAdding] = useState(false)
  const [rows, setRows] = useState<UploadRow[]>([])
  const [busy, setBusy] = useState(false)

  const saveContributor = async (d: ContributorDraft) => {
    const id = await createFanPhotoContributor(recordOf(d))
    if (id) { setAdding(false); await onContributorsChanged(); setSelected(id) }
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
          category_key: category,
        })
        set(i, id ? 'done' : 'error', id ? undefined : 'saved to R2 but the row insert failed')
      } catch (e) {
        set(i, 'error', (e as Error).message)
      }
    }
    setBusy(false)
    onUploaded()
  }

  // Every tappable control shares one comfortable pill shape and a 44px minimum, so nothing on
  // this panel is a small target on a phone.
  const tap = (active: boolean, accent = false) => ({
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.6,
    minHeight: 44, px: 2, borderRadius: 999, userSelect: 'none' as const,
    fontSize: '0.8rem', fontWeight: 800, border: '1px solid',
    cursor: active ? 'pointer' : 'default',
    borderColor: accent && active ? 'primary.main' : 'divider',
    color: accent && active ? 'primary.main' : active ? 'text.secondary' : 'text.disabled',
  })

  return (
    <Section title="Upload photos">
      <Box sx={{ p: { xs: 1.5, sm: 2 }, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {/* contributor: pick who took them, or add a new permission record. Same height, so the
            Select and the button line up rather than jostling on a phone. */}
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'stretch' }}>
          <Select value={selected} onChange={e => setSelected(e.target.value)} displayEmpty size="small"
            sx={{ fontSize: '0.85rem', flex: 1, minWidth: 0, '& .MuiSelect-select': { py: 1.25 } }}>
            <MenuItem value="" disabled sx={{ fontSize: '0.85rem' }}>Photographer…</MenuItem>
            {contributors.map(c => <MenuItem key={c.id} value={c.id} sx={{ fontSize: '0.85rem' }}>{c.display_name}</MenuItem>)}
          </Select>
          <Box onClick={() => setAdding(a => !a)} role="button" tabIndex={0} sx={{ ...tap(true), flexShrink: 0 }}>
            {adding ? 'Cancel' : '+ New'}
          </Box>
        </Box>

        {adding && (
          <ContributorForm initial={EMPTY_CONTRIBUTOR} submitLabel="Save photographer" onSubmit={saveContributor} />
        )}

        {categories.length > 0 && (
          <CategorySelect categories={categories} value={category} onChange={setCategory} size="touch" />
        )}

        {/* the file picker: disabled until a photographer is chosen, so every photo has a credit.
            Tall and two-line so it reads as the main action and is an easy tap on a phone. */}
        <Box component="label" sx={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 0.4,
          minHeight: 88, px: 2, py: 2, textAlign: 'center',
          borderRadius: 2, border: '2px dashed', borderColor: selected && !busy ? 'primary.main' : 'divider',
          color: selected && !busy ? 'primary.main' : 'text.disabled',
          cursor: selected && !busy ? 'pointer' : 'default',
        }}>
          {busy && <CircularProgress size={18} sx={{ mb: 0.3 }} />}
          <Typography sx={{ fontSize: '0.9rem', fontWeight: 800, color: 'inherit' }}>
            {busy ? 'Uploading…' : selected ? 'Choose photos to upload' : 'Pick a photographer first'}
          </Typography>
          {!busy && selected && (
            <Typography sx={{ fontSize: '0.72rem', color: 'text.disabled', fontWeight: 600 }}>
              JPEG or PNG, from your camera roll or camera
            </Typography>
          )}
          <input type="file" accept="image/*" multiple hidden disabled={!selected || busy}
            onChange={e => { onFiles(e.target.files); e.target.value = '' }} />
        </Box>

        {rows.length > 0 && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.6 }}>
            {rows.map((r, i) => (
              <Box key={`${r.name}-${i}`} sx={{ display: 'flex', alignItems: 'baseline', gap: 1, py: 0.2 }}>
                <Typography noWrap sx={{ fontSize: '0.78rem', flex: 1, minWidth: 0 }}>{r.name}</Typography>
                <Typography sx={{ fontSize: '0.74rem', fontWeight: 700, color: STATUS_COLOR[r.status], flexShrink: 0 }}>
                  {STATUS_LABEL[r.status]}
                </Typography>
              </Box>
            ))}
            {rows.some(r => r.msg) && (
              <Typography sx={{ fontSize: '0.68rem', color: 'error.main', mt: 0.3 }}>
                {rows.filter(r => r.msg).map(r => `${r.name}: ${r.msg}`).join(' · ')}
              </Typography>
            )}
          </Box>
        )}
      </Box>
    </Section>
  )
}

/**
 * Tag mode on ONE photo, opened from the enlarged view on a public surface by the owner, so a
 * wrong tag or a typo can be fixed where it was noticed rather than by finding the photo again in
 * /admin. Loads its own fresh copy of the queue (the public surfaces only hold the published
 * shape), and on close drops the public caches so every mounted surface shows the edit.
 */
export function FanPhotoEditor({ photoId, onClose }: { photoId: string; onClose: () => void }) {
  const [data, setData] = useState<{
    photos: WpblFanPhotoRow[]; subjects: WpblPhotoSubject[]; figures: WpblPhotoFigure[]
    categories: WpblPhotoCategory[]; players: WpblPlayer[]; teams: WpblTeam[]; contributors: WpblPhotoContributor[]
  } | null>(null)
  const load = useCallback(() => {
    Promise.all([fetchWpblFanPhotoQueue(), fetchWpblAllPlayers(), fetchWpblTeams(), fetchFanPhotoContributors()])
      .then(([q, players, teams, contributors]) => setData({ ...q, players, teams, contributors }))
  }, [])
  useEffect(() => load(), [load])

  const lookups = useMemo<Lookups | null>(() => data && ({
    players: new Map(data.players.map(p => [p.id, p])),
    figures: new Map(data.figures.map(f => [f.key, f])),
    teams: data.teams,
    categories: data.categories,
    contributors: data.contributors,
  }), [data])
  const subjectsByPhoto = useMemo(() => {
    const m = new Map<string, WpblPhotoSubject[]>()
    for (const s of data?.subjects ?? []) m.set(s.photo_id, [...(m.get(s.photo_id) ?? []), s])
    return m
  }, [data])

  const close = () => { invalidateWpblFanPhotos(); onClose() }

  if (!data || !lookups) {
    return (
      <Dialog open fullScreen onClose={close}>
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: '#000' }}>
          <CircularProgress sx={{ color: '#fff' }} />
        </Box>
      </Dialog>
    )
  }
  return (
    <TagMode ids={[photoId]} start={0} photos={data.photos} subjectsByPhoto={subjectsByPhoto}
      lookups={lookups} onChange={load} onClose={close} />
  )
}

export default function AdminPhotos() {
  const [photos, setPhotos] = useState<WpblFanPhotoRow[]>([])
  const [subjects, setSubjects] = useState<WpblPhotoSubject[]>([])
  const [figures, setFigures] = useState<WpblPhotoFigure[]>([])
  const [players, setPlayers] = useState<WpblPlayer[]>([])
  const [teams, setTeams] = useState<WpblTeam[]>([])
  const [categories, setCategories] = useState<WpblPhotoCategory[]>([])
  const [contributors, setContributors] = useState<WpblPhotoContributor[]>([])
  // '*' is every category; '' is the uncategorised fan photos.
  const [categoryFilter, setCategoryFilter] = useState<string>('*')
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>('unapproved')
  const [tagging, setTagging] = useState<{ ids: string[]; start: number } | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([fetchWpblFanPhotoQueue(), fetchWpblAllPlayers(), fetchWpblTeams(), fetchFanPhotoContributors()]).then(([q, pl, tm, cs]) => {
      setPhotos(q.photos); setSubjects(q.subjects); setFigures(q.figures); setCategories(q.categories); setPlayers(pl); setTeams(tm)
      setContributors(cs)
      setLoading(false)
    })
  }, [])
  const reloadContributors = useCallback(async () => { setContributors(await fetchFanPhotoContributors()) }, [])
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
    (filter === 'all' ? true : filter === 'approved' ? p.approved : !p.approved)
    && (categoryFilter === '*' || (p.category_key ?? '') === categoryFilter))
  const lookups = useMemo<Lookups>(() => ({ players: playersById, figures: figuresByKey, teams, categories, contributors }),
    [playersById, figuresByKey, teams, categories, contributors])
  const openTagMode = (start: number) => setTagging({ ids: shown.map(p => p.id), start })

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, mb: 1.5, flexWrap: 'wrap' }}>
        {FILTERS.map(f => (
          <Chip key={f.value} label={`${f.label} (${counts[f.value]})`}
            active={filter === f.value} onClick={() => setFilter(f.value)} />
        ))}
        {categories.length > 0 && (
          <Select value={categoryFilter} onChange={e => setCategoryFilter(String(e.target.value))} size="small"
            sx={{ fontSize: '0.75rem', '& .MuiSelect-select': { py: 0.4 } }}>
            <MenuItem value="*" sx={{ fontSize: '0.8rem' }}>Any category</MenuItem>
            <MenuItem value="" sx={{ fontSize: '0.8rem' }}>Fan photos</MenuItem>
            {categories.map(c => <MenuItem key={c.key} value={c.key} sx={{ fontSize: '0.8rem' }}>{c.name}</MenuItem>)}
          </Select>
        )}
        <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 0.5 }}>
          {loading && <CircularProgress size={14} />}
          {shown.length > 0 && (
            <Chip label={`Tag mode (${shown.length})`} active={false} onClick={() => openTagMode(0)} />
          )}
          <IconButton size="small" onClick={load} sx={{ color: 'text.secondary' }} aria-label="Refresh">
            <Refresh sx={{ fontSize: '1.05rem' }} />
          </IconButton>
        </Box>
      </Box>

      <UploadPanel categories={categories} contributors={contributors}
        onContributorsChanged={reloadContributors} onUploaded={load} />

      <PhotographersSection contributors={contributors} photos={photos} onChange={load} />

      <Section title="Categories">
        <CategoryAdder count={categories.length} onAdded={load} />
        {categories.length > 0 && (
          <Box sx={{ px: 1.5, pb: 1.5, display: 'flex', flexWrap: 'wrap', gap: 0.6 }}>
            {categories.map(c => (
              <Box key={c.key} sx={{ px: 1, py: 0.3, borderRadius: 999, bgcolor: 'action.hover',
                fontSize: '0.7rem', fontWeight: 600, color: 'text.secondary' }}>
                {c.name} · {photos.filter(p => p.category_key === c.key).length}
              </Box>
            ))}
          </Box>
        )}
      </Section>

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
          shown.map((p, i) => (
            <PhotoCard key={p.id} photo={p} subjects={subjectsByPhoto.get(p.id) ?? []}
              lookups={lookups} onChange={load} onOpen={() => openTagMode(i)} />
          ))
        )}
      </Section>

      {tagging && (
        <TagMode ids={tagging.ids} start={tagging.start} photos={photos} subjectsByPhoto={subjectsByPhoto}
          lookups={lookups} onChange={load} onClose={() => setTagging(null)} />
      )}

      <Typography sx={{ fontSize: '0.64rem', color: 'text.disabled', mt: 1 }}>
        Bytes arrive by the ingest CLI ("npm run ingest-fan-photos"); this only tags, captions and
        publishes. A photo is invisible to readers until Published. A clear foreground photo of
        members of the public, especially children, does not go up.
      </Typography>
    </Box>
  )
}
