import React, { useEffect, useMemo, useState } from 'react'
import { Box, Typography, CircularProgress } from '@mui/material'
import WpblPage from './WpblPage'
import { FanPhotoGrid, FanPhotoSubmitNote, useFanPhotosVersion } from './FanPhotoViews'
import { fetchWpblFanPhotoIndex, fetchWpblAllPlayers } from './api'
import { fanPhotoTeamName, type FanPhotoIndex, type FanPhotoWithSubjects } from './fanPhotos'
import type { WpblPlayer } from './types'

// The /wpbl/photos gallery: every published fan photograph, filterable by who is in it. A sibling
// route on the same footing as the glossary and scorigami pages, wearing the shared WpblPage
// shell. The same photos also sit on each player's own page (FanPhotoPlayerStrip); this is the
// browse-all surface, indexable and shareable. See docs/FAN_PHOTOS.md.
//
// Names come from the FULL roster, never a club's current sheet: a traded player is on neither
// club's live roster, so a name map built from those would drop her (CLAUDE.md).

type SubjectFilter = { key: string; label: string; photos: FanPhotoWithSubjects[] }

export default function PhotosGalleryPage() {
  const version = useFanPhotosVersion()
  const [index, setIndex] = useState<FanPhotoIndex | null>(null)
  const [players, setPlayers] = useState<WpblPlayer[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string>('all')
  const [category, setCategory] = useState<string>('*')

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

  const pickCategory = (key: string) => { setCategory(key); setSelected('all') }

  const total = index?.photos.length ?? 0

  return (
    // NO STANDFIRST. The count it carried is on the "All" chip directly below, and the credit line
    // is on every photo, so the sentence was two lines of a phone screen spent before the filters.
    <WpblPage title="2026 gallery">
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>
      ) : total === 0 ? (
        <Box sx={{ py: 6, textAlign: 'center' }}>
          <Typography sx={{ fontSize: '0.9rem', color: 'text.secondary' }}>No photos yet.</Typography>
          <FanPhotoSubmitNote variant="block" />
        </Box>
      ) : (
        <>
          {/* Category first (Fan signs, ...), then who is in them within it. */}
          {categoryChips.length > 0 && (
            <ChipRow mb={1}>
              <FilterChip label={`All (${total})`} active={category === '*'} onClick={() => pickCategory('*')} />
              {categoryChips.map(c => (
                <FilterChip key={c.key} label={`${c.label} (${c.count})`}
                  active={category === c.key} onClick={() => pickCategory(c.key)} />
              ))}
            </ChipRow>
          )}
          {/* Filter by subject. "Everyone" plus one chip per person who appears in a photo; the
              count rides on each so the reader can see who has the most before tapping. */}
          {subjects.length > 1 && (
            <ChipRow mb={2}>
              <FilterChip label={`Everyone (${inCategory.length})`} active={selected === 'all'} onClick={() => setSelected('all')} />
              {subjects.map(s => (
                <FilterChip key={s.key} label={`${s.label} (${s.photos.length})`}
                  active={selected === s.key} onClick={() => setSelected(s.key)} />
              ))}
            </ChipRow>
          )}
          <FanPhotoGrid photos={shown} resolveNames={resolveNames} from="gallery" />
          <FanPhotoSubmitNote variant="block" />
        </>
      )}
    </WpblPage>
  )
}

/** A row of filter chips: ONE LINE THAT SCROLLS SIDEWAYS ON A PHONE, wrapping from sm up.
 *
 *  Wrapped at 375px the subject row was twenty-odd pills stacked eleven lines deep, a full screen of
 *  names in front of the first photo, on the page whose whole point is the photos. One swipeable
 *  line costs one line, and the chip cut off at the right edge is what says there is more.
 *  Full-bleed on a phone (cancelling the page's gutter and handing it back as padding) so a
 *  chip scrolls out under the screen edge rather than being clipped at an invisible margin. From
 *  sm up there is room for a few rows and wrapping shows every name at once. */
function ChipRow({ mb, children }: { mb: number; children: React.ReactNode }) {
  return (
    <Box sx={{
      display: 'flex', gap: 0.75, mb,
      flexWrap: { xs: 'nowrap', sm: 'wrap' },
      overflowX: { xs: 'auto', sm: 'visible' },
      // `50% - 50vw` rather than a fixed -16px: the page sits inside two 16px gutters (the
      // section's and WpblPage's), and this reaches the screen edge whatever they add up to.
      mx: { xs: 'calc(50% - 50vw)', sm: 0 }, px: { xs: 'calc(50vw - 50%)', sm: 0 },
      scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' },
      '& > *': { flexShrink: 0, whiteSpace: 'nowrap' },
    }}>
      {children}
    </Box>
  )
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <Box onClick={onClick} role="button" tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }}
      sx={{
        px: 1.3, py: 0.5, borderRadius: 999, cursor: 'pointer', userSelect: 'none',
        fontSize: '0.76rem', fontWeight: 700, lineHeight: 1.5, border: '1px solid',
        borderColor: active ? 'primary.main' : 'divider',
        bgcolor: active ? 'primary.main' : 'background.paper',
        color: active ? 'primary.contrastText' : 'text.secondary',
        '&:hover': { borderColor: active ? 'primary.main' : 'text.secondary' },
        '&:focus-visible': { outline: '2px solid', outlineColor: 'text.primary', outlineOffset: 2 },
      }}>
      {label}
    </Box>
  )
}
