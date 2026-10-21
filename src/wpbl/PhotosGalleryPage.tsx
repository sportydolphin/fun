import { useEffect, useMemo, useRef, useState } from 'react'
import { Box, Typography, Popover } from '@mui/material'
import WpblPage from './WpblPage'
import { ChipRow, FilterChip, filterChipSx } from '../ui/FilterChip'
import { pressable, hoverOnly, FOCUS_RING } from '../ui/interaction'
import { NameText } from '../ui/NameText'
import { chromePx } from '../ui/scale'
import { FanPhotoGrid, FanPhotoGridSkeleton, FanPhotoSubmitNote, FanPhotoTagInvite, useFanPhotosVersion } from './FanPhotoViews'
import { TextGhost } from './ui'
import { fetchWpblFanPhotoIndex, fetchWpblAllPlayers, fetchWpblPhotos, getCachedWpblPhotos } from './api'
import { ArchiveGrid } from './Photos'
import { fanPhotoTeamName, type FanPhotoIndex, type FanPhotoWithSubjects } from './fanPhotos'
import type { WpblPlayer, WpblPhoto } from './types'
import { track, EVENTS } from '../lib/analytics'
import { TYPE_SCALE } from '../ui/card'

// The /wpbl/photos gallery: every published fan photograph, filterable by who is in it, plus the
// Wikimedia Commons archive of women's baseball history as one more category. A sibling
// route on the same footing as the glossary and scorigami pages, wearing the shared WpblPage
// shell. The same photos also sit on each player's own page (FanPhotoPlayerStrip); this is the
// browse-all surface, indexable and shareable. See docs/FAN_PHOTOS.md.
//
// Names come from the FULL roster, never a club's current sheet: a traded player is on neither
// club's live roster, so a name map built from those would drop her (CLAUDE.md).

type SubjectFilter = { key: string; label: string; photos: FanPhotoWithSubjects[] }

/** The archive's category key. Not a curator category, so it cannot collide with one. */
const ARCHIVE = '__archive'

export default function PhotosGalleryPage() {
  const version = useFanPhotosVersion()
  const [index, setIndex] = useState<FanPhotoIndex | null>(null)
  const [players, setPlayers] = useState<WpblPlayer[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string>('all')
  const [category, setCategory] = useState<string>('*')
  // The Wikimedia Commons archive: a different collection (history, not this season), shown as
  // one more category so the site's photographs live in one place. Its own read, gating nothing.
  const [archive, setArchive] = useState<WpblPhoto[]>(() => getCachedWpblPhotos() ?? [])
  useEffect(() => {
    let live = true
    fetchWpblPhotos().then(p => { if (live) setArchive(p) }).catch(() => { /* no archive chip */ })
    return () => { live = false }
  }, [])

  useEffect(() => {
    let live = true
    Promise.all([fetchWpblFanPhotoIndex(), fetchWpblAllPlayers()])
      .then(([idx, pl]) => { if (live) { setIndex(idx); setPlayers(pl); setLoading(false) } })
      .catch(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [version])

  const nameById = useMemo(() => new Map(players.map(p => [p.id, p.name])), [players])
  const resolveNames = useMemo(() => (photo: FanPhotoWithSubjects): string[] => {
    const names: string[] = []
    for (const pid of photo.playerIds) names.push(nameById.get(pid) ?? '—')
    for (const key of photo.figureKeys) names.push(index?.figures.get(key)?.name ?? '—')
    for (const tid of photo.teamIds) names.push(fanPhotoTeamName(index?.teams.get(tid)))
    return names
  }, [nameById, index])

  // Categories that actually hold a published photo, in the curator's order. '*' is all of them.
  // NO CHIP FOR THE UNCATEGORIZED FAN PHOTOS: they are what the gallery IS, and "All" already
  // shows them, so a "Fan photos" chip beside it offered the same thing minus the few special sets,
  // which nobody reaches for. With no categories in use the row does not draw.
  const categoryChips = useMemo(() => {
    if (!index) return []
    const out: Array<{ key: string; label: string; count: number }> = []
    for (const c of index.categories) {
      const n = index.byCategory.get(c.key)?.length ?? 0
      if (n > 0) out.push({ key: c.key, label: c.name, count: n })
    }
    return out
  }, [index])
  const inCategory = useMemo(() => {
    if (!index) return []
    if (category === '*') return index.photos
    if (category === ARCHIVE) return []
    return index.byCategory.get(category) ?? []
  }, [index, category])

  // The subjects that actually have photos in the chosen category, each with its set, sorted by
  // name. Only these can be filtered to; a player nobody has photographed does not get an empty chip,
  // and a category of signs (which tag nobody) shows no subject row at all.
  const subjects: SubjectFilter[] = useMemo(() => {
    if (!index) return []
    const buckets = new Map<string, SubjectFilter>()
    const add = (key: string, label: string, photo: FanPhotoWithSubjects) => {
      const b = buckets.get(key)
      if (b) b.photos.push(photo)
      else buckets.set(key, { key, label, photos: [photo] })
    }
    for (const photo of inCategory) {
      for (const pid of photo.playerIds) add(`p:${pid}`, nameById.get(pid) ?? 'Unknown', photo)
      for (const fkey of photo.figureKeys) add(`f:${fkey}`, index.figures.get(fkey)?.name ?? fkey, photo)
      for (const tid of photo.teamIds) add(`t:${tid}`, fanPhotoTeamName(index.teams.get(tid)), photo)
    }
    return [...buckets.values()].sort((a, b) => a.label.localeCompare(b.label))
  }, [index, inCategory, nameById])

  const shown = useMemo(() => {
    if (selected === 'all') return inCategory
    return subjects.find(s => s.key === selected)?.photos ?? inCategory
  }, [inCategory, selected, subjects])

  const pickCategory = (key: string) => {
    setCategory(key); setSelected('all')
    track(EVENTS.WPBL_PAGE_CONTROL, { page: 'photos', control: 'category', value: key })
  }
  const pickSubject = (key: string) => {
    setSelected(key)
    track(EVENTS.WPBL_PAGE_CONTROL, { page: 'photos', control: 'subject', value: key })
  }

  const total = index?.photos.length ?? 0

  const showingArchive = category === ARCHIVE

  return (
    // NO STANDFIRST. The count it carried is on the "All" chip directly below, and the credit line
    // is on every photo, so the sentence was two lines of a phone screen spent before the filters.
    <WpblPage title="Photos">
      {loading ? (
        <GallerySkeleton />
      ) : total === 0 && archive.length === 0 ? (
        <Box sx={{ py: 6, textAlign: 'center' }}>
          <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.secondary' }}>No photos yet.</Typography>
          <FanPhotoSubmitNote variant="block" />
        </Box>
      ) : (
        <>
          <FanPhotoTagInvite />
          {/* Category first (Fan signs, the archive), then who is in them within it. "This season"
              is every photo from 2026, which is what the gallery opens on. */}
          {(categoryChips.length > 0 || archive.length > 0) && (
            <ChipRow mb={1}>
              <FilterChip active={category === '*'} onClick={() => pickCategory('*')}>{`This season (${total})`}</FilterChip>
              {categoryChips.map(c => (
                <FilterChip key={c.key}
                  active={category === c.key} onClick={() => pickCategory(c.key)}>{`${c.label} (${c.count})`}</FilterChip>
              ))}
              {archive.length > 0 && (
                <FilterChip active={showingArchive}
                  onClick={() => pickCategory(ARCHIVE)}>{`From the archive (${archive.length})`}</FilterChip>
              )}
            </ChipRow>
          )}
          {/* Filter by subject: ONE chip that opens the list. It was a chip per person, which by
              October was forty chips wrapping to five lines above the photos on a desktop and a
              long sideways scroll on a phone, before a single photo. */}
          {!showingArchive && subjects.length > 1 && (
            <Box sx={{ mb: 2 }}>
              <SubjectPicker subjects={subjects} total={inCategory.length} selected={selected} onPick={pickSubject} />
            </Box>
          )}
          {showingArchive
            ? <Box sx={{ mt: 1 }}><ArchiveGrid photos={archive} /></Box>
            : <FanPhotoGrid photos={shown} resolveNames={resolveNames} from="gallery" />}
          <FanPhotoSubmitNote variant="block" />
        </>
      )}
    </WpblPage>
  )
}

/**
 * The gallery before the index lands, drawn as the loaded page (CLAUDE.md, loading states): the
 * invite, the category row, the one "who" chip and the grid. It was a centered spinner, which left
 * the footer near the top of the screen.
 */

function GallerySkeleton() {
  const chip = (label: string, active = false) => (
    <FilterChip key={label} active={active} onClick={() => {}}><TextGhost>{label}</TextGhost></FilterChip>
  )
  return (
    <Box aria-hidden>
      <FanPhotoTagInvite />
      <ChipRow mb={1}>
        {['This season (000)', 'Fan Sign (0)', 'Fans (0)', 'From the archive (00)'].map((l, i) => chip(l, i === 0))}
      </ChipRow>
      <Box sx={{ mb: 2 }}>
        <Box sx={{ ...filterChipSx(false), gap: 0.4, display: 'inline-flex' }}>
          <TextGhost>Who's in it: Everyone (000)</TextGhost>
          <Box component="span" sx={{ fontSize: TYPE_SCALE.caption }}>▾</Box>
        </Box>
      </Box>
      <FanPhotoGridSkeleton />
    </Box>
  )
}

const GROUPS: Array<{ prefix: string; label: string }> = [
  { prefix: 't:', label: 'Clubs' },
  { prefix: 'p:', label: 'Players' },
  { prefix: 'f:', label: 'Others' },
]

/** "Who's in it": one chip, and the list behind it grouped (clubs, players, the figures), each with
 *  its count, and a search box once the list is long. */
function SubjectPicker({ subjects, total, selected, onPick }: {
  subjects: SubjectFilter[]; total: number; selected: string; onPick: (key: string) => void
}) {
  const anchor = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const current = subjects.find(s => s.key === selected)
  const q = query.trim().toLowerCase()
  const groups = GROUPS
    .map(g => ({ ...g, rows: subjects.filter(s => s.key.startsWith(g.prefix) && (!q || s.label.toLowerCase().includes(q))) }))
    .filter(g => g.rows.length > 0)
  const close = () => { setOpen(false); setQuery('') }
  const choose = (key: string) => { onPick(key); close() }

  const row = (key: string, label: string, count: number) => (
    <Box key={key} {...pressable(() => choose(key))} aria-pressed={selected === key}
      sx={{
        display: 'flex', alignItems: 'center', gap: 1, px: 1, py: 0.6, minHeight: chromePx(36), borderRadius: 1.5,
        cursor: 'pointer', ...FOCUS_RING,
        fontWeight: selected === key ? 800 : 500,
        color: selected === key ? 'var(--wpbl-accent-fg)' : 'text.primary',
        ...hoverOnly({ bgcolor: 'action.hover' }),
      }}>
      <NameText component="span" name={label} sx={{ flex: 1, minWidth: 0, fontSize: TYPE_SCALE.body, fontWeight: 'inherit' }} />
      <Box component="span" sx={{ color: 'text.secondary', fontSize: TYPE_SCALE.meta, fontVariantNumeric: 'tabular-nums' }}>{count}</Box>
    </Box>
  )

  return (
    <>
      <Box ref={anchor} {...pressable(() => setOpen(true))} aria-haspopup="dialog" aria-expanded={open}
        sx={{ ...filterChipSx(open || !!current), gap: 0.4, display: 'inline-flex' }}>
        {current ? `Who's in it: ${current.label} (${current.photos.length})` : `Who's in it: Everyone (${total})`}
        <Box component="span" sx={{ fontSize: TYPE_SCALE.caption }}>▾</Box>
      </Box>
      <Popover open={open} anchorEl={anchor.current} onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }} transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{ paper: { sx: {
          borderRadius: 2.5, mt: 0.75, width: chromePx(300), maxWidth: 'calc(100vw - 32px)', maxHeight: '60vh',
          display: 'flex', flexDirection: 'column', border: '1px solid', borderColor: 'outline',
        } } }}>
        {subjects.length > 8 && (
          <Box sx={{ p: 1, pb: 0.5 }}>
            <Box component="input" autoFocus value={query} aria-label="Search people and clubs" placeholder="Search"
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
              sx={{
                width: '100%', boxSizing: 'border-box', fontSize: TYPE_SCALE.body, fontFamily: 'inherit',
                borderRadius: 2, border: '1px solid', borderColor: 'outline', bgcolor: 'transparent', color: 'text.primary',
                px: 1.25, py: 0.75, outline: 'none', '&:focus': { borderColor: 'var(--wpbl-accent-fg)' },
              }} />
          </Box>
        )}
        <Box sx={{ overflowY: 'auto', p: 0.75 }}>
          {!q && row('all', 'Everyone', total)}
          {groups.map(g => (
            <Box key={g.prefix} role="group" aria-label={g.label}>
              <Typography sx={{ fontSize: TYPE_SCALE.caption, fontWeight: 800, color: 'text.secondary', px: 1, pt: 1, pb: 0.25 }}>
                {g.label}
              </Typography>
              {g.rows.map(s => row(s.key, s.label, s.photos.length))}
            </Box>
          ))}
          {q && groups.length === 0 && (
            <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.secondary', px: 1, py: 1 }}>No one by that name.</Typography>
          )}
        </Box>
      </Popover>
    </>
  )
}
