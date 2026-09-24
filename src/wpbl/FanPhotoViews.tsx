import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { Box, Typography } from '@mui/material'
import { ModalShell, SectionCard, CARD_BORDER, useRailPaging, RailArrow, RailScroller, hoverOnly, chromePx } from './ui'
import { fanPhotoTeamName, type FanPhotoWithSubjects, type FanPhotoIndex } from './fanPhotos'
import { fetchWpblFanPhotoIndex, fetchWpblAllPlayers, FAN_PHOTOS_CHANGED_EVENT } from './api'
import type { WpblPlayer } from './types'
import { WPBL_PHOTOS_PAGE } from './routes'
import { useFanPhotosVisible, useCanEditFanPhotos } from './fanPhotoGate'
import { linkTo } from '../nav'
import { devFanPhotosOn, DEV_FAN_PHOTOS_EVENT, mockFanPhotos } from './dev/devFanPhotos'
import { track, EVENTS } from '../lib/analytics'
import { CONTACT_EMAIL } from '../lib/contact'

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

// The owner's in-place editor (tag mode on one photo). Lazy, so no reader downloads admin code.
const FanPhotoEditor = lazy(() => import('./AdminPhotos').then(m => ({ default: m.FanPhotoEditor })))

/** A counter that ticks whenever the owner edits a photo in place. Surfaces put it in their fetch
 *  effect's deps, so an edit shows everywhere at once rather than on the next page load. */
export function useFanPhotosVersion(): number {
  const [n, setN] = useState(0)
  useEffect(() => {
    const bump = () => setN(x => x + 1)
    window.addEventListener(FAN_PHOTOS_CHANGED_EVENT, bump)
    return () => window.removeEventListener(FAN_PHOTOS_CHANGED_EVENT, bump)
  }, [])
  return n
}

/** Turns a photo's tags into display names. Built at the call site from the full roster (never a
 *  club's current roster: a traded player is absent from both) and the figure dictionary. */
export type ResolveNames = (photo: FanPhotoWithSubjects) => string[]

/** What a card and the lightbox show as the line under the image: the curator's caption where
 *  there is one, else who is in it (a team photo names the club), else its category ("Fan
 *  signs"), else a bare label so a screen reader is not handed a URL. */
export function fanPhotoCaption(photo: FanPhotoWithSubjects, names: string[]): string {
  return photo.caption ?? (names.length > 0 ? names.join(', ') : (photo.categoryName ?? 'Photo'))
}

function Credit({ credit }: { credit: string | null }) {
  if (!credit) return null
  return (
    <Typography sx={{ fontSize: '0.62rem', color: 'text.disabled', lineHeight: 1.35, mt: 0.5 }}>
      Photo: <Box component="span" sx={{ fontWeight: 600 }}>{credit}</Box>
    </Typography>
  )
}

// ─── Asking for photos ────────────────────────────────────────────────────────────
//
// The gallery grows only by fans sending photos in, so the surfaces that show it also ask. The
// email is pre-filled with what curation needs anyway: the name to credit, the game, and a plain
// statement that the sender took the photos and is happy for them to be shown. That last line is
// the point: the reply IS the permission record, and its link goes straight into the
// contributor's "where they said yes" field in /admin.
const SUBMIT_BODY = [
  "Hi! I'd like my photos featured in the WPBL gallery on sportydolphin.fun.",
  '',
  'Name to credit: ',
  'Game(s) and date(s): ',
  '',
  "I took these photos and I'm happy for them to be shown on sportydolphin.fun, credited to me.",
  '',
  '(Attach the photos, or link to where they are posted.)',
].join('\n')

export const FAN_PHOTO_SUBMIT_HREF =
  `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('Photos for the WPBL gallery')}&body=${encodeURIComponent(SUBMIT_BODY)}`

/** The ask. `line` is one quiet row under a rail (Home); `block` is a small panel under the full
 *  gallery, where a reader who has just scrolled every photo is the likeliest to have their own. */
export function FanPhotoSubmitNote({ variant }: { variant: 'line' | 'block' }) {
  const link = (label: string) => (
    <Box component="a" href={FAN_PHOTO_SUBMIT_HREF} sx={{
      color: 'primary.main', fontWeight: 700, textDecoration: 'none',
      '&:hover': { textDecoration: 'underline' },
      '&:focus-visible': { outline: '2px solid', outlineColor: 'text.primary', outlineOffset: 2, borderRadius: 0.5 },
    }}>{label}</Box>
  )
  if (variant === 'line') {
    return (
      <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary', mt: 1 }}>
        Took photos at a game? {link('Send them in to be featured')}.
      </Typography>
    )
  }
  return (
    <Box sx={{ mt: 3, p: { xs: 1.75, sm: 2 }, borderRadius: 2, border: '1px solid', borderColor: CARD_BORDER, bgcolor: 'background.paper' }}>
      <Typography sx={{ fontSize: '0.9rem', fontWeight: 800 }}>Your photos</Typography>
      <Typography sx={{ fontSize: '0.8rem', color: 'text.secondary', mt: 0.5, lineHeight: 1.5 }}>
        Took photos at a WPBL game? Send them in and they could be featured here and on the players'
        pages, always credited to you. {link(`Email ${CONTACT_EMAIL}`)}
      </Typography>
    </Box>
  )
}

// ─── The lightbox ────────────────────────────────────────────────────────────────

/** One photograph at full size. `contain` inside a height cap, so a tall portrait phone photo is
 *  shown whole rather than cropped, and the caption and credit stay above the fold. */
export function FanPhotoLightbox({ photo, names, onClose, onEdit }: {
  photo: FanPhotoWithSubjects; names: string[]; onClose: () => void
  /** The owner's Edit button; absent for everyone else. */
  onEdit?: () => void
}) {
  const caption = fanPhotoCaption(photo, names)
  return (
    <ModalShell eyebrow="Gallery" onClose={onClose} maxWidth={900} zIndex={1700}>
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
        {onEdit && (
          <Box onClick={onEdit} role="button" tabIndex={0}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onEdit() } }}
            sx={{
              display: 'inline-flex', alignItems: 'center', mt: 1.25, px: 1.6, py: 0.5, borderRadius: 999,
              border: '1px solid', borderColor: 'primary.main', color: 'primary.main', cursor: 'pointer',
              fontSize: '0.76rem', fontWeight: 800, userSelect: 'none',
            }}>Edit photo</Box>
        )}
      </Box>
    </ModalShell>
  )
}

// ─── One card, shared by the strip and the grid ───────────────────────────────────
//
// NO PHOTO IS EVER CROPPED TO FIT ITS TILE. These tiles used to be a fixed 4:3 box with
// `object-fit: cover`, which cut the edges off anything else: a portrait phone photo lost its top
// and bottom, and a photographed mock baseball card lost its border, which is the whole design.
// Instead the TILE takes the photo's shape (from the stored render dimensions) and the image is
// `contain`ed inside it, so the worst case is a thin band of background, never a missing edge.

/** The width:height a rail tile is drawn at. The photo's own ratio, held between a baseball card
 *  on its end and a wide panorama so one extreme shot cannot make a tile a sliver or a whole
 *  screen. Outside that band the image is letterboxed inside the tile, still whole. Unknown
 *  dimensions (an old row) fall back to 4:3. */
export function railTileAspect(width: number | null, height: number | null): number {
  if (!width || !height) return 4 / 3
  return Math.min(RAIL_ASPECT_MAX, Math.max(RAIL_ASPECT_MIN, width / height))
}
const RAIL_ASPECT_MIN = 0.7
const RAIL_ASPECT_MAX = 2

/** The rail's one fixed dimension. Structure, so it scales with the chrome (see chromePx). */
const RAIL_TILE_H = { xs: 168, sm: 184 } as const

function PhotoCard({ photo, names, onOpen, frame }: {
  photo: FanPhotoWithSubjects; names: string[]; onOpen: () => void
  /** 'rail': fixed height, width follows the photo. 'natural': full width of its column, height
   *  follows the photo (the gallery's masonry). */
  frame: 'rail' | 'natural'
}) {
  const caption = fanPhotoCaption(photo, names)
  const size = frame === 'rail'
    ? { width: '100%', height: { xs: chromePx(RAIL_TILE_H.xs), sm: chromePx(RAIL_TILE_H.sm) } }
    : { width: '100%', aspectRatio: photo.width && photo.height ? `${photo.width} / ${photo.height}` : '4 / 3' }
  return (
    <Box sx={{ minWidth: 0 }}>
      <Box
        onClick={onOpen}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }}
        role="button" tabIndex={0} aria-label={`View photograph: ${caption}`}
        sx={{
          position: 'relative', ...size, cursor: 'pointer',
          borderRadius: 1.5, overflow: 'hidden', bgcolor: 'action.hover',
          border: '1px solid', borderColor: CARD_BORDER, transition: 'border-color 0.15s, transform 0.1s',
          ...hoverOnly({ borderColor: 'text.disabled' }),
          '&:active': { transform: 'scale(0.99)' },
          '&:focus-visible': { outline: '2px solid', outlineColor: 'text.primary', outlineOffset: 2 },
        }}
      >
        <Box component="img" src={photo.card_url} alt={caption} loading="lazy"
          sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }} />
      </Box>
      <Typography sx={{
        fontSize: '0.74rem', fontWeight: 600, lineHeight: 1.3, mt: 0.6,
        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
      }}>{caption}</Typography>
      <Credit credit={photo.credit} />
    </Box>
  )
}

// ─── Opening a photo, and the owner's edit ────────────────────────────────────────
//
// Shared by the strip and the grid. The open photo is held by ID, not as an object, so after an
// edit (which refetches the index) the lightbox shows the edited photo rather than a stale copy.
// Edit swaps the lightbox for the full-screen editor and puts the lightbox back on close; the two
// are never stacked, since the editor is a plain MUI dialog under the lightbox's z-index.
function useFanPhotoViewer(photos: FanPhotoWithSubjects[], resolveNames: ResolveNames, from: string) {
  const canEdit = useCanEditFanPhotos()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const open = useCallback((photo: FanPhotoWithSubjects) => {
    track(EVENTS.WPBL_FAN_PHOTO_OPENED, { photoId: photo.id, from })
    setActiveId(photo.id)
  }, [from])
  const active = activeId ? (photos.find(p => p.id === activeId) ?? null) : null
  const node = (
    <>
      {active && (
        <FanPhotoLightbox photo={active} names={resolveNames(active)} onClose={() => setActiveId(null)}
          onEdit={canEdit ? () => { setEditingId(active.id); setActiveId(null) } : undefined} />
      )}
      {editingId && (
        <Suspense fallback={null}>
          <FanPhotoEditor photoId={editingId} onClose={() => { setActiveId(editingId); setEditingId(null) }} />
        </Suspense>
      )}
    </>
  )
  return { open, node }
}

// ─── The strip (player page, Game Center) ──────────────────────────────────────────

/** A horizontal rail of a subject's or a game's photos, opening the lightbox. `from` labels the
 *  open event so a player-page strip and a Game Center strip can be judged separately. */
export function FanPhotoStrip({ photos, resolveNames, from }: {
  photos: FanPhotoWithSubjects[]; resolveNames: ResolveNames; from: string
}) {
  const { scrollRef, canPrev, canNext, syncEdges, page } = useRailPaging(photos.length)
  const { open, node } = useFanPhotoViewer(photos, resolveNames, from)

  if (photos.length === 0) return null
  return (
    <>
      <Box sx={{ position: 'relative' }}>
        <RailScroller scrollRef={scrollRef} onScroll={syncEdges}>
          {photos.map(p => {
            // Each tile as wide as its photo is at the rail's height, so a portrait and a
            // landscape shot sit side by side at their own shapes.
            const a = railTileAspect(p.width, p.height)
            return (
              <Box key={p.id} sx={{
                flexShrink: 0, scrollSnapAlign: 'start',
                width: { xs: `calc(${chromePx(RAIL_TILE_H.xs)} * ${a})`, sm: `calc(${chromePx(RAIL_TILE_H.sm)} * ${a})` },
              }}>
                <PhotoCard photo={p} names={resolveNames(p)} onOpen={() => open(p)} frame="rail" />
              </Box>
            )
          })}
        </RailScroller>
        <RailArrow dir="left" show={canPrev} onClick={() => page(-1)} label="photographs" />
        <RailArrow dir="right" show={canNext} onClick={() => page(1)} label="photographs" />
      </Box>
      {node}
    </>
  )
}

// ─── The grid (the /wpbl/photos gallery) ───────────────────────────────────────────

/** Everything, as masonry columns: each photo the full width of its column at its own height, so
 *  nothing is cropped or letterboxed. CSS columns rather than a grid because a grid row would be as
 *  tall as its tallest photo, leaving holes beside every landscape shot. A phone gets two columns,
 *  a desktop four. Reading order runs down each column, which a gallery can afford. */
export function FanPhotoGrid({ photos, resolveNames, from }: {
  photos: FanPhotoWithSubjects[]; resolveNames: ResolveNames; from: string
}) {
  const { open, node } = useFanPhotoViewer(photos, resolveNames, from)

  return (
    <>
      <Box sx={{ columnWidth: chromePx(160), columnGap: 1.5 }}>
        {photos.map(p => (
          <Box key={p.id} sx={{ breakInside: 'avoid', display: 'inline-block', width: '100%', mb: 1.5 }}>
            <PhotoCard photo={p} names={resolveNames(p)} onOpen={() => open(p)} frame="natural" />
          </Box>
        ))}
      </Box>
      {node}
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
  const version = useFanPhotosVersion()
  const [index, setIndex] = useState<FanPhotoIndex | null>(null)
  useEffect(() => {
    if (!visible) return
    let live = true
    fetchWpblFanPhotoIndex().then(idx => { if (live) setIndex(idx) }).catch(() => { /* renders nothing */ })
    return () => { live = false }
  }, [visible, version])

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
        Gallery
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
  const version = useFanPhotosVersion()
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
  }, [visible, version])

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
        title="2026 gallery"
        action={
          <Box {...seeAll} sx={{
            textDecoration: 'none', fontSize: '0.72rem', fontWeight: 700, color: 'text.secondary',
            '&:hover': { color: 'text.primary' },
            '&:focus-visible': { outline: '2px solid', outlineColor: 'text.primary', outlineOffset: 2, borderRadius: 1 },
          }}>See all {photos.length} →</Box>
        }
      >
        <FanPhotoStrip photos={photos.slice(0, HOME_RAIL_MAX)} resolveNames={resolveNames} from="home" />
        <FanPhotoSubmitNote variant="line" />
      </SectionCard>
    </Box>
  )
}
