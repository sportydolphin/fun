import { useCallback, useEffect, useMemo, useState } from 'react'
import { Box, Typography, TextField, MenuItem, Select, IconButton, Button, CircularProgress } from '@mui/material'
import { ArrowUpward, ArrowDownward, DeleteOutlined, EditOutlined, CheckCircle, RadioButtonUnchecked } from '@mui/icons-material'
import {
  fetchRoadmap, addRoadmapItem, updateRoadmapItem, deleteRoadmapItem, PRIORITIES, AREAS,
  type RoadmapItem, type RoadmapPriority, type RoadmapArea,
} from './lib/roadmap'
import { typePx } from './ui/scale'
import { TYPE_SCALE, ICON_SIZE } from './ui/card'

// /admin → Roadmap: the priority list, edited in place. ROADMAP-WPBL.md keeps the reasoning and
// the shipped log; this is the order. Every write is applied to local state only after the
// database accepts it, so a refused write (a lapsed session) leaves the list as the table has it
// rather than showing an order that was never saved.

const TIER_LABEL: Record<RoadmapPriority, string> = { P0: 'P0', P1: 'P1', P2: 'P2', P3: 'P3', parked: 'Parked' }
const AREA_LABEL: Record<RoadmapArea, string> = { site: 'Site', wpbl: 'WPBL', mlb: 'MLB' }

const nextPosition = (items: RoadmapItem[], tier: RoadmapPriority) =>
  Math.max(0, ...items.filter(i => i.priority === tier && !i.done_at).map(i => i.position)) + 1

function TierLabel({ children, count }: { children: React.ReactNode; count: number }) {
  return (
    <Typography component="h3" sx={{
      fontSize: TYPE_SCALE.micro, fontWeight: 800, letterSpacing: typePx(1), textTransform: 'uppercase',
      color: 'text.secondary', mt: 2, mb: 0.75,
    }}>{children} · {count}</Typography>
  )
}

function AreaTag({ area }: { area: RoadmapArea }) {
  return (
    <Box component="span" sx={{
      px: 0.75, py: 0.1, borderRadius: 999, border: '1px solid', borderColor: 'outline',
      fontSize: TYPE_SCALE.caption, fontWeight: 700, color: 'text.secondary', flexShrink: 0,
    }}>{AREA_LABEL[area]}</Box>
  )
}

function Row({ item, first, last, onMove, onPatch, onDelete }: {
  item: RoadmapItem
  first: boolean
  last: boolean
  onMove: (dir: -1 | 1) => void
  onPatch: (patch: Partial<RoadmapItem>) => Promise<boolean>
  onDelete: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(item.title)
  const [notes, setNotes] = useState(item.notes)
  const done = item.done_at != null

  const save = async () => {
    if (!title.trim()) return
    if (await onPatch({ title: title.trim(), notes: notes.trim() })) setEditing(false)
  }

  return (
    <Box sx={{
      display: 'flex', gap: 1, p: 1.25, border: '1px solid', borderColor: 'outline', borderRadius: 2,
      bgcolor: 'background.paper', mb: 0.75,
    }}>
      <IconButton size="small" onClick={() => onPatch({ done_at: done ? null : new Date().toISOString() })}
        aria-label={done ? `Reopen ${item.title}` : `Mark ${item.title} done`} sx={{ alignSelf: 'flex-start', mt: -0.25 }}>
        {done ? <CheckCircle sx={{ fontSize: ICON_SIZE.md, color: 'success.main' }} /> : <RadioButtonUnchecked sx={{ fontSize: ICON_SIZE.md }} />}
      </IconButton>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        {editing ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <TextField size="small" label="Title" value={title} onChange={e => setTitle(e.target.value)} slotProps={{ htmlInput: { maxLength: 200 } }} />
            <TextField size="small" label="Notes" value={notes} onChange={e => setNotes(e.target.value)} multiline minRows={2} slotProps={{ htmlInput: { maxLength: 4000 } }} />
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button size="small" variant="contained" onClick={save} disabled={!title.trim()}>Save</Button>
              <Button size="small" onClick={() => { setTitle(item.title); setNotes(item.notes); setEditing(false) }}>Cancel</Button>
            </Box>
          </Box>
        ) : (<>
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75, flexWrap: 'wrap' }}>
            <Typography sx={{
              fontSize: TYPE_SCALE.title, fontWeight: 700, lineHeight: 1.3,
              color: done ? 'text.secondary' : 'text.primary', textDecoration: done ? 'line-through' : 'none',
            }}>{item.title}</Typography>
            <AreaTag area={item.area} />
          </Box>
          {item.notes && (
            <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', lineHeight: 1.45, mt: 0.4, whiteSpace: 'pre-wrap' }}>
              {item.notes}
            </Typography>
          )}
        </>)}
        {!editing && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.75, flexWrap: 'wrap' }}>
            {!done && (
              <Select size="small" value={item.priority} onChange={e => onPatch({ priority: e.target.value as RoadmapPriority })}
                inputProps={{ 'aria-label': `Priority of ${item.title}` }} sx={{ fontSize: TYPE_SCALE.meta, minWidth: '5.5rem', '& .MuiSelect-select': { py: 0.4 } }}>
                {PRIORITIES.map(p => <MenuItem key={p} value={p}>{TIER_LABEL[p]}</MenuItem>)}
              </Select>
            )}
            <Select size="small" value={item.area} onChange={e => onPatch({ area: e.target.value as RoadmapArea })}
              inputProps={{ 'aria-label': `Area of ${item.title}` }} sx={{ fontSize: TYPE_SCALE.meta, minWidth: '5.5rem', '& .MuiSelect-select': { py: 0.4 } }}>
              {AREAS.map(a => <MenuItem key={a} value={a}>{AREA_LABEL[a]}</MenuItem>)}
            </Select>
            {!done && (<>
              <IconButton size="small" disabled={first} onClick={() => onMove(-1)} aria-label={`Move ${item.title} up`}>
                <ArrowUpward sx={{ fontSize: ICON_SIZE.sm }} />
              </IconButton>
              <IconButton size="small" disabled={last} onClick={() => onMove(1)} aria-label={`Move ${item.title} down`}>
                <ArrowDownward sx={{ fontSize: ICON_SIZE.sm }} />
              </IconButton>
            </>)}
            <IconButton size="small" onClick={() => setEditing(true)} aria-label={`Edit ${item.title}`}>
              <EditOutlined sx={{ fontSize: ICON_SIZE.sm }} />
            </IconButton>
            <IconButton size="small" onClick={onDelete} aria-label={`Delete ${item.title}`} sx={{ ml: 'auto' }}>
              <DeleteOutlined sx={{ fontSize: ICON_SIZE.sm }} />
            </IconButton>
          </Box>
        )}
      </Box>
    </Box>
  )
}

function AddForm({ onAdd }: { onAdd: (row: { title: string; notes: string; priority: RoadmapPriority; area: RoadmapArea }) => Promise<boolean> }) {
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [priority, setPriority] = useState<RoadmapPriority>('P2')
  const [area, setArea] = useState<RoadmapArea>('site')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!title.trim() || busy) return
    setBusy(true)
    if (await onAdd({ title: title.trim(), notes: notes.trim(), priority, area })) { setTitle(''); setNotes('') }
    setBusy(false)
  }

  return (
    <Box component="form" onSubmit={e => { e.preventDefault(); submit() }} sx={{
      display: 'flex', flexDirection: 'column', gap: 1, p: 1.25, border: '1px solid', borderColor: 'outline',
      borderRadius: 2, bgcolor: 'background.paper',
    }}>
      <TextField size="small" label="New item" value={title} onChange={e => setTitle(e.target.value)} slotProps={{ htmlInput: { maxLength: 200 } }} />
      <TextField size="small" label="Notes" value={notes} onChange={e => setNotes(e.target.value)} multiline minRows={1} slotProps={{ htmlInput: { maxLength: 4000 } }} />
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
        <Select size="small" value={priority} onChange={e => setPriority(e.target.value as RoadmapPriority)}
          inputProps={{ 'aria-label': 'Priority' }} sx={{ fontSize: TYPE_SCALE.body, minWidth: '6rem' }}>
          {PRIORITIES.map(p => <MenuItem key={p} value={p}>{TIER_LABEL[p]}</MenuItem>)}
        </Select>
        <Select size="small" value={area} onChange={e => setArea(e.target.value as RoadmapArea)}
          inputProps={{ 'aria-label': 'Area' }} sx={{ fontSize: TYPE_SCALE.body, minWidth: '6rem' }}>
          {AREAS.map(a => <MenuItem key={a} value={a}>{AREA_LABEL[a]}</MenuItem>)}
        </Select>
        <Button type="submit" variant="contained" size="small" disabled={!title.trim() || busy} sx={{ ml: 'auto' }}>Add</Button>
      </Box>
    </Box>
  )
}

export default function AdminRoadmap() {
  const [items, setItems] = useState<RoadmapItem[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [areaFilter, setAreaFilter] = useState<RoadmapArea | 'all'>('all')
  const [showDone, setShowDone] = useState(false)

  const load = useCallback(() => {
    fetchRoadmap().then(r => { setItems(r ?? []); setFailed(r == null) })
  }, [])
  useEffect(() => load(), [load])

  const visible = useMemo(
    () => (items ?? []).filter(i => areaFilter === 'all' || i.area === areaFilter),
    [items, areaFilter])
  const tiers = useMemo(() => PRIORITIES.map(p => ({
    tier: p,
    rows: visible.filter(i => i.priority === p && !i.done_at).sort((a, b) => a.position - b.position),
  })), [visible])
  const done = useMemo(
    () => visible.filter(i => i.done_at).sort((a, b) => (b.done_at ?? '').localeCompare(a.done_at ?? '')),
    [visible])

  const patch = useCallback(async (id: string, p: Partial<RoadmapItem>) => {
    const all = items ?? []
    const cur = all.find(i => i.id === id)
    if (!cur) return false
    // A row that changes tier, or comes back from Done, joins the bottom of its tier.
    const rejoins = (p.priority && p.priority !== cur.priority) || (cur.done_at && p.done_at === null)
    const full = rejoins ? { ...p, position: nextPosition(all.filter(i => i.id !== id), p.priority ?? cur.priority) } : p
    const ok = await updateRoadmapItem(id, full)
    if (ok) setItems(xs => (xs ?? []).map(i => i.id === id ? { ...i, ...full } : i))
    return ok
  }, [items])

  // Swap with the neighbor in the tier AS DRAWN, so a move under an area filter steps past the
  // hidden rows rather than appearing to do nothing.
  const move = useCallback(async (row: RoadmapItem, dir: -1 | 1) => {
    const list = tiers.find(t => t.tier === row.priority)?.rows ?? []
    const at = list.findIndex(i => i.id === row.id)
    const other = list[at + dir]
    if (!other) return
    // Equal positions (two rows added in the same tier from different tabs) would swap to the
    // same order; nudge them apart first.
    const [a, b] = other.position === row.position
      ? [row.position + dir, row.position]
      : [other.position, row.position]
    const [ok1, ok2] = await Promise.all([
      updateRoadmapItem(row.id, { position: a }),
      updateRoadmapItem(other.id, { position: b }),
    ])
    if (ok1 && ok2) setItems(xs => (xs ?? []).map(i => i.id === row.id ? { ...i, position: a } : i.id === other.id ? { ...i, position: b } : i))
    else load()
  }, [tiers, load])

  const remove = useCallback(async (row: RoadmapItem) => {
    if (!window.confirm(`Delete "${row.title}"? This cannot be undone.`)) return
    if (await deleteRoadmapItem(row.id)) setItems(xs => (xs ?? []).filter(i => i.id !== row.id))
  }, [])

  const add = useCallback(async (row: { title: string; notes: string; priority: RoadmapPriority; area: RoadmapArea }) => {
    const made = await addRoadmapItem({ ...row, position: nextPosition(items ?? [], row.priority) })
    if (made) setItems(xs => [...(xs ?? []), made])
    return made != null
  }, [items])

  if (items == null) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>

  const filterChip = (value: RoadmapArea | 'all', label: string) => (
    <Button key={value} size="small" variant={areaFilter === value ? 'contained' : 'outlined'} onClick={() => setAreaFilter(value)}
      aria-pressed={areaFilter === value} sx={{ borderRadius: 999, minWidth: 0, px: 1.5, fontSize: TYPE_SCALE.meta }}>{label}</Button>
  )

  return (
    <Box sx={{ mt: 2, maxWidth: '48rem' }}>
      {failed && (
        <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'error.main', mb: 1.5 }}>
          Could not read the roadmap. Signed out, or the table has not been migrated yet.
        </Typography>
      )}
      <AddForm onAdd={add} />
      <Box sx={{ display: 'flex', gap: 0.75, mt: 1.5, flexWrap: 'wrap' }}>
        {filterChip('all', 'All')}
        {AREAS.map(a => filterChip(a, AREA_LABEL[a]))}
      </Box>
      {tiers.map(({ tier, rows }) => (
        <Box key={tier}>
          <TierLabel count={rows.length}>{TIER_LABEL[tier]}</TierLabel>
          {rows.length === 0 && <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary' }}>Nothing here.</Typography>}
          {rows.map((r, i) => (
            <Row key={r.id} item={r} first={i === 0} last={i === rows.length - 1}
              onMove={dir => move(r, dir)} onPatch={p => patch(r.id, p)} onDelete={() => remove(r)} />
          ))}
        </Box>
      ))}
      {done.length > 0 && (
        <Box>
          <Button size="small" onClick={() => setShowDone(v => !v)} aria-expanded={showDone} sx={{ mt: 2, px: 0, fontSize: TYPE_SCALE.meta }}>
            {showDone ? 'Hide done' : `Show done (${done.length})`}
          </Button>
          {showDone && done.map(r => (
            <Row key={r.id} item={r} first last onMove={() => {}} onPatch={p => patch(r.id, p)} onDelete={() => remove(r)} />
          ))}
        </Box>
      )}
    </Box>
  )
}
