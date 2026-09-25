import { useEffect, useMemo, useState } from 'react'
import { Box, Typography, CircularProgress } from '@mui/material'
import WpblPage from './WpblPage'
import { ChipRow, FilterChip } from './FilterChips'
import { FanPhotoGrid, FanPhotoSubmitNote, useFanPhotosVersion } from './FanPhotoViews'
import { fetchWpblFanPhotoIndex, fetchWpblAllPlayers, fetchWpblPhotos, getCachedWpblPhotos } from './api'
import { ArchiveGrid } from './Photos'
import { fanPhotoTeamName, type FanPhotoIndex, type FanPhotoWithSubjects } from './fanPhotos'
import type { WpblPlayer, WpblPhoto } from './types'
import { track, EVENTS } from '../lib/analytics'

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
  // NO CHIP FOR THE UNCATEGORISED FAN PHOTOS: they are what the gallery IS, and "All" already
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
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>
      ) : total === 0 && archive.length === 0 ? (
        <Box sx={{ py: 6, textAlign: 'center' }}>
          <Typography sx={{ fontSize: '0.9rem', color: 'text.secondary' }}>No photos yet.</Typography>
          <FanPhotoSubmitNote variant="block" />
        </Box>
      ) : (
        <>
          {/* Category first (Fan signs, the archive), then who is in them within it. "This season"
              is every photo from 2026, which is what the gallery opens on. */}
          {(categoryChips.length > 0 || archive.length > 0) && (
            <ChipRow mb={1}>
              <FilterChip label={`This season (${total})`} active={category === '*'} onClick={() => pickCategory('*')} />
              {categoryChips.map(c => (
                <FilterChip key={c.key} label={`${c.label} (${c.count})`}
                  active={category === c.key} onClick={() => pickCategory(c.key)} />
              ))}
              {archive.length > 0 && (
                <FilterChip label={`From the archive (${archive.length})`} active={showingArchive}
                  onClick={() => pickCategory(ARCHIVE)} />
              )}
            </ChipRow>
          )}
          {/* Filter by subject. "Everyone" plus one chip per person who appears in a photo; the
              count rides on each so the reader can see who has the most before tapping. */}
          {!showingArchive && subjects.length > 1 && (
            <ChipRow mb={2}>
              <FilterChip label={`Everyone (${inCategory.length})`} active={selected === 'all'} onClick={() => pickSubject('all')} />
              {subjects.map(s => (
                <FilterChip key={s.key} label={`${s.label} (${s.photos.length})`}
                  active={selected === s.key} onClick={() => pickSubject(s.key)} />
              ))}
            </ChipRow>
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
