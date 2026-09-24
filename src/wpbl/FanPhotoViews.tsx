import { useCallback, useEffect, useMemo, useState } from 'react'
import { Box, Typography } from '@mui/material'
import { ModalShell, SectionCard, CARD_BORDER, useRailPaging, RailArrow, RailScroller, hoverOnly } from './ui'
import { fanPhotoTeamName, type FanPhotoWithSubjects, type FanPhotoIndex } from './fanPhotos'
import { fetchWpblFanPhotoIndex, fetchWpblAllPlayers } from './api'
import type { WpblPlayer } from './types'
import { WPBL_PHOTOS_PAGE } from './routes'
import { useFanPhotosVisible } from './fanPhotoGate'
import { linkTo } from '../nav'
import { devFanPhotosOn, DEV_FAN_PHOTOS_EVENT, mockFanPhotos } from './dev/devFanPhotos'
import { track, EVENTS } from '../lib/analytics'

// How many published photos before the Home card earns its slot, and the most it shows in the
// rail. The threshold is deliberately not small: a card on the front page has to look like a
// collection, not a lonely thumbnail, and the plan parked a Home rail during the season precisely
// because it had nothing to show. Twelve is "enough". See docs/FAN_PHOTOS.md.
const HOME_MIN_PHOTOS = 12
const HOME_RAIL_MAX = 12

// The reader-facing fan-photo UI: the strip on a player page, the grid on /wpbl/photos, and the
// lightbox both open. This is NOT Photos.tsx: that renders the Commons archive (wpbl_photos), a
// different table and a different licence story. These are this season's photographs, sent by
// fans with permission, tagged by who is in them. See docs/FAN_PHOTOS.md.
//
// THE CREDIT IS ON EVERY CARD, NOT BEHIND A CLICK, exactly as it is for the archive: the moment
// a strip paints, someone's photograph is published, and the person who took it is named on it.
// Unlike the archive there is no external file page to link to; the credit is the contributor's
// name, plain text.
//
// EVERY STRING IS PLAIN TEXT. The caption and the credit are curator- and fan-entered and are
// only ever put in a text node. No dangerouslySetInnerHTML.

/** Turns a photo's tags into display names. Built at the call site from the full roster (never a
 *  club's current roster: a traded player is absent from both) and the figure dictionary. */
export type ResolveNames = (photo: FanPhotoWithSubjects) => string[]

/** What a card and the lightbox show as the line under the image: the curator's caption where
 *  there is one, else who is in it, else a bare label so a screen reader is not handed a URL. */
export function fanPhotoCaption(photo: FanPhotoWithSubjects, names: string[]): string {
  return photo.caption ?? (names.length > 0 ? names.join(', ') : 'Fan photograph')
}

function Credit({ credit }: { credit: string | null }) {
  if (!credit) return null
  return (
    <Typography sx={{ fontSize: '0.62rem', color: 'text.disabled', lineHeight: 1.35, mt: 0.5 }}>
      Photo: <Box component="span" sx={{ fontWeight: 600 }}>{credit}</Box>
    </Typography>
  )
}

// ─── The lightbox ────────────────────────────────────────────────────────────────

/** One photograph at full size. `contain` inside a height cap, so a tall portrait phone photo is
 *  shown whole rather than cropped, and the caption and credit stay above the fold. */
export function FanPhotoLightbox({ photo, names, onClose }: {
  photo: FanPhotoWithSubjects; names: string[]; onClose: () => void
}) {
  const caption = fanPhotoCaption(photo, names)
  return (
    <ModalShell eyebrow="Fan photo" onClose={onClose} maxWidth={900} zIndex={1700}>
      <Box sx={{ p: { xs: 1.5, sm: 2 } }}>
        <Box sx={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          maxHeight: { xs: '55vh', sm: '65vh' }, borderRadius: 2, overflow: 'hidden', bgcolor: 'action.hover',
        }}>
          <Box component="img" src={photo.full_url} alt={caption}
            sx={{ maxWidth: '100%', maxHeight: { xs: '55vh', sm: '65vh' }, objectFit: 'contain', display: 'block' }} />
        </Box>
        <Typography sx={{ mt: 1.25, fontSize: '0.85rem', lineHeight: 1.45 }}>{caption}</Typography>
        {photo.taken_on && (
          <Typography sx={{ fontSize: '0.7rem', color: 'text.disabled', mt: 0.4 }}>{photo.taken_on}</Typography>
        )}
        <Credit credit={photo.credit} />
      </Box>
    </ModalShell>
  )
}

// ─── One card, shared by the strip and the grid ───────────────────────────────────

function PhotoCard({ photo, names, onOpen }: {
  photo: FanPhotoWithSubjects; names: string[]; onOpen: () => void
}) {
  const caption = fanPhotoCaption(photo, names)
  return (
    <Box sx={{ minWidth: 0 }}>
      <Box
        onClick={onOpen}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }}
        role="button" tabIndex={0} aria-label={`View photograph: ${caption}`}
        sx={{
          position: 'relative', width: '100%', aspectRatio: '4 / 3', cursor: 'pointer',
          borderRadius: 1.5, overflow: 'hidden', bgcolor: 'action.hover',
          border: '1px solid', borderColor: CARD_BORDER, transition: 'border-color 0.15s, transform 0.1s',
          ...hoverOnly({ borderColor: 'text.disabled' }),
          '&:active': { transform: 'scale(0.99)' },
          '&:focus-visible': { outline: '2px solid', outlineColor: 'text.primary', outlineOffset: 2 },
        }}
      >
        <Box component="img" src={photo.card_url} alt={caption} loading="lazy"
          sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
      </Box>
      <Typography sx={{
        fontSize: '0.74rem', fontWeight: 600, lineHeight: 1.3, mt: 0.6,
        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
      }}>{caption}</Typography>
      <Credit credit={photo.credit} />
    </Box>
  )
}

// ─── The strip (player page, Game Center) ──────────────────────────────────────────

/** A horizontal rail of a subject's or a game's photos, opening the lightbox. `from` labels the
 *  open event so a player-page strip and a Game Center strip can be judged separately. */
export function FanPhotoStrip({ photos, resolveNames, from }: {
  photos: FanPhotoWithSubjects[]; resolveNames: ResolveNames; from: string
}) {
  const [active, setActive] = useState<FanPhotoWithSubjects | null>(null)
  const { scrollRef, canPrev, canNext, syncEdges, page } = useRailPaging(photos.length)

  const open = useCallback((photo: FanPhotoWithSubjects) => {
    track(EVENTS.WPBL_FAN_PHOTO_OPENED, { photoId: photo.id, from })
    setActive(photo)
  }, [from])

  if (photos.length === 0) return null
  return (
    <>
      <Box sx={{ position: 'relative' }}>
        <RailScroller scrollRef={scrollRef} onScroll={syncEdges}>
          {photos.map(p => (
            <Box key={p.id} sx={{ flexShrink: 0, width: { xs: 208, sm: 224 }, scrollSnapAlign: 'start' }}>
              <PhotoCard photo={p} names={resolveNames(p)} onOpen={() => open(p)} />
            </Box>
          ))}
        </RailScroller>
        <RailArrow dir="left" show={canPrev} onClick={() => page(-1)} label="photographs" />
        <RailArrow dir="right" show={canNext} onClick={() => page(1)} label="photographs" />
      </Box>
      {active && <FanPhotoLightbox photo={active} names={resolveNames(active)} onClose={() => setActive(null)} />}
    </>
  )
}

// ─── The grid (the /wpbl/photos gallery) ───────────────────────────────────────────

/** Everything, as a responsive grid. `auto-fill` with a minimum so a phone shows one or two per
 *  row and a desktop four, without stretching an odd count. */
export function FanPhotoGrid({ photos, resolveNames, from }: {
  photos: FanPhotoWithSubjects[]; resolveNames: ResolveNames; from: string
}) {
  const [active, setActive] = useState<FanPhotoWithSubjects | null>(null)
  const open = useCallback((photo: FanPhotoWithSubjects) => {
    track(EVENTS.WPBL_FAN_PHOTO_OPENED, { photoId: photo.id, from })
    setActive(photo)
  }, [from])

  return (
    <>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 1.5 }}>
        {photos.map(p => <PhotoCard key={p.id} photo={p} names={resolveNames(p)} onOpen={() => open(p)} />)}
      </Box>
      {active && <FanPhotoLightbox photo={active} names={resolveNames(active)} onClose={() => setActive(null)} />}
    </>
  )
}

// ─── The player-page strip (self-contained) ────────────────────────────────────────

/**
 * The photo strip on a player's page: every fan photograph she is tagged in. Self-contained so
 * PlayerDetail only has to drop it in with the player and the roster it already holds; it fetches
 * the app-wide-cached index itself, so several player pages share one read, and renders NOTHING
 * until there are photos (which is most of the roster, for now).
 *
 * Names for the OTHER people in a shot come from the full roster passed in, never a club's current
 * roster: a traded player is absent from both her old and new club's live sheet, so a name map
 * built from those would drop her (CLAUDE.md). The subject that is this player is left out of the
 * caption, since it is her page.
 */
export function FanPhotoPlayerStrip({ playerId, players }: { playerId: string; players: WpblPlayer[] }) {
  const visible = useFanPhotosVisible()
  const [index, setIndex] = useState<FanPhotoIndex | null>(null)
  useEffect(() => {
    if (!visible) return
    let live = true
    fetchWpblFanPhotoIndex().then(idx => { if (live) setIndex(idx) }).catch(() => { /* renders nothing */ })
    return () => { live = false }
  }, [visible])

  const nameById = useMemo(() => new Map(players.map(p => [p.id, p.name])), [players])
  const resolveNames = useCallback((photo: FanPhotoWithSubjects): string[] => {
    const names: string[] = []
    for (const pid of photo.playerIds) if (pid !== playerId) names.push(nameById.get(pid) ?? '—')
    for (const key of photo.figureKeys) names.push(index?.figures.get(key)?.name ?? '—')
    for (const tid of photo.teamIds) names.push(fanPhotoTeamName(index?.teams.get(tid)))
    return names
  }, [playerId, nameById, index])

  const photos = index?.byPlayer.get(playerId) ?? []
  if (!visible || photos.length === 0) return null
  return (
    <Box sx={{ mt: 2 }}>
      <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5, color: 'text.secondary', mb: 1 }}>
        Fan photos
      </Typography>
      <FanPhotoStrip photos={photos} resolveNames={resolveNames} from="player" />
    </Box>
  )
}

// ─── The Home card ──────────────────────────────────────────────────────────────

/**
 * The fan-photos card on Home: a rail of recent photographs and a link to the full gallery. Shows
 * year-round once there are HOME_MIN_PHOTOS published, because the photos keep arriving and the
 * card grows with them; it sits low on Home (above "The league"), the explore-and-relive zone,
 * where it stays out of the live cards during a season and rises on its own once those go quiet.
 *
 * Self-fetching off the app-wide-cached index, so Home hands it nothing. In dev the offseason
 * preview can pad it with mock rows (see devFanPhotos), which is the only way to see the card
 * before twelve real photos exist.
 */
export function FanPhotoHomeCard() {
  const visible = useFanPhotosVisible()
  const [index, setIndex] = useState<FanPhotoIndex | null>(null)
  const [players, setPlayers] = useState<WpblPlayer[]>([])
  const [mockOn, setMockOn] = useState(() => import.meta.env.DEV && devFanPhotosOn())

  useEffect(() => {
    if (!visible) return
    let live = true
    Promise.all([fetchWpblFanPhotoIndex(), fetchWpblAllPlayers()])
      .then(([idx, pl]) => { if (live) { setIndex(idx); setPlayers(pl) } })
      .catch(() => { /* renders nothing */ })
    return () => { live = false }
  }, [visible])

  // Dev only: the settings menu can force the card on with mock rows. The listener and its import
  // tree-shake out of production behind this guard.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const onDev = (e: Event) => setMockOn((e as CustomEvent<boolean>).detail)
    window.addEventListener(DEV_FAN_PHOTOS_EVENT, onDev)
    return () => window.removeEventListener(DEV_FAN_PHOTOS_EVENT, onDev)
  }, [])

  const nameById = useMemo(() => new Map(players.map(p => [p.id, p.name])), [players])
  const resolveNames = useCallback((photo: FanPhotoWithSubjects): string[] => {
    const names: string[] = []
    for (const pid of photo.playerIds) names.push(nameById.get(pid) ?? '—')
    for (const key of photo.figureKeys) names.push(index?.figures.get(key)?.name ?? '—')
    for (const tid of photo.teamIds) names.push(fanPhotoTeamName(index?.teams.get(tid)))
    return names
  }, [nameById, index])

  const real = index?.photos ?? []
  const photos = import.meta.env.DEV && mockOn ? mockFanPhotos(real, players, HOME_MIN_PHOTOS) : real
  if (!visible || photos.length < HOME_MIN_PHOTOS) return null

  const seeAll = linkTo(WPBL_PHOTOS_PAGE)
  // Its own top margin (Home's 1.5 step), carried here rather than by a wrapper on Home, so a
  // hidden card (below the threshold) leaves no empty gap above "The league".
  return (
    <Box sx={{ mt: 1.5 }}>
      <SectionCard
        title="Fan photos"
        action={
          <Box {...seeAll} sx={{
            textDecoration: 'none', fontSize: '0.72rem', fontWeight: 700, color: 'text.secondary',
            '&:hover': { color: 'text.primary' },
            '&:focus-visible': { outline: '2px solid', outlineColor: 'text.primary', outlineOffset: 2, borderRadius: 1 },
          }}>See all {photos.length} →</Box>
        }
      >
        <FanPhotoStrip photos={photos.slice(0, HOME_RAIL_MAX)} resolveNames={resolveNames} from="home" />
      </SectionCard>
    </Box>
  )
}
