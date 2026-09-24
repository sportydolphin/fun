import { useEffect, useMemo, useState } from 'react'
import { Box, Typography, CircularProgress } from '@mui/material'
import WpblPage from './WpblPage'
import { FanPhotoGrid } from './FanPhotoViews'
import { useFanPhotosVisible } from './fanPhotoGate'
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
  // Owner-only for now (see useFanPhotosVisible). Anyone else gets the page's own empty state, the
  // same thing it showed before the first photo was published, rather than a hole in the site.
  const visible = useFanPhotosVisible()
  const [index, setIndex] = useState<FanPhotoIndex | null>(null)
  const [players, setPlayers] = useState<WpblPlayer[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string>('all')

  useEffect(() => {
    let live = true
    Promise.all([fetchWpblFanPhotoIndex(), fetchWpblAllPlayers()])
      .then(([idx, pl]) => { if (live) { setIndex(idx); setPlayers(pl); setLoading(false) } })
      .catch(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [])

  const nameById = useMemo(() => new Map(players.map(p => [p.id, p.name])), [players])
  const resolveNames = useMemo(() => (photo: FanPhotoWithSubjects): string[] => {
    const names: string[] = []
    for (const pid of photo.playerIds) names.push(nameById.get(pid) ?? '—')
    for (const key of photo.figureKeys) names.push(index?.figures.get(key)?.name ?? '—')
    for (const tid of photo.teamIds) names.push(fanPhotoTeamName(index?.teams.get(tid)))
    return names
  }, [nameById, index])

  // The subjects that actually have photos, each with its set, sorted by name. Only these can be
  // filtered to; a player nobody has photographed does not get an empty chip.
  const subjects: SubjectFilter[] = useMemo(() => {
    if (!index) return []
    const out: SubjectFilter[] = []
    for (const [pid, photos] of index.byPlayer) out.push({ key: `p:${pid}`, label: nameById.get(pid) ?? 'Unknown', photos })
    for (const [fkey, photos] of index.byFigure) out.push({ key: `f:${fkey}`, label: index.figures.get(fkey)?.name ?? fkey, photos })
    for (const [tid, photos] of index.byTeam) out.push({ key: `t:${tid}`, label: fanPhotoTeamName(index.teams.get(tid)), photos })
    return out.sort((a, b) => a.label.localeCompare(b.label))
  }, [index, nameById])

  const shown = useMemo(() => {
    if (!index) return []
    if (selected === 'all') return index.photos
    return subjects.find(s => s.key === selected)?.photos ?? index.photos
  }, [index, selected, subjects])

  const total = visible ? (index?.photos.length ?? 0) : 0
  const standfirst = total > 0
    ? `${total} photograph${total === 1 ? '' : 's'} of this season's players, sent in by fans with permission. Every one carries the photographer's credit.`
    : "Photographs of this season's players, sent in by fans with permission."

  return (
    <WpblPage title="Fan photos" standfirst={standfirst}>
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>
      ) : total === 0 ? (
        <Box sx={{ py: 6, textAlign: 'center' }}>
          <Typography sx={{ fontSize: '0.9rem', color: 'text.secondary' }}>No fan photos yet.</Typography>
        </Box>
      ) : (
        <>
          {/* Filter by subject. "All" plus one chip per person who appears in a photo; the count
              rides on each so the reader can see who has the most before tapping. */}
          {subjects.length > 1 && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mb: 2.5 }}>
              <FilterChip label={`All (${total})`} active={selected === 'all'} onClick={() => setSelected('all')} />
              {subjects.map(s => (
                <FilterChip key={s.key} label={`${s.label} (${s.photos.length})`}
                  active={selected === s.key} onClick={() => setSelected(s.key)} />
              ))}
            </Box>
          )}
          <FanPhotoGrid photos={shown} resolveNames={resolveNames} from="gallery" />
        </>
      )}
    </WpblPage>
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
