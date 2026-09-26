import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { Box, Typography, Skeleton } from '@mui/material'
import { ModalShell, SectionCard, CARD_BORDER, CARD_FILL, useRailPaging, RailArrow, RailScroller, hoverOnly, chromePx } from './ui'
import { fanPhotoTeamName, type FanPhotoWithSubjects, type FanPhotoIndex } from './fanPhotos'
import { fetchWpblFanPhotoIndex, fetchWpblAllPlayers, getCachedWpblFanPhotoIndex, getCachedWpblAllPlayers, FAN_PHOTOS_CHANGED_EVENT } from './api'
import type { WpblPlayer } from './types'
import { WPBL_PHOTOS_PAGE } from './routes'
import { useCanEditFanPhotos } from './fanPhotoGate'
import { linkTo } from '../nav'
import { devFanPhotosOn, DEV_FAN_PHOTOS_EVENT, mockFanPhotos } from './dev/devFanPhotos'
import { track, EVENTS } from '../lib/analytics'
import { CONTACT_EMAIL } from '../lib/contact'
import { prefersReducedMotion } from '../lib/motion'

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
export function fanPhotoCaption(photo: FanPhotoWithSubjects, names: string[], fallback = 'Photo'): string {
  return photo.caption ?? (names.length > 0 ? names.join(', ') : (photo.categoryName ?? fallback))
}

/** Whether a caption would only repeat the page's own subject: nothing written, nobody else
 *  tagged, no category. A player page leaves that player's name out of `names` because every
 *  photo there is of them, and the tile then fell back to the bare word "Photo", which read as a
 *  missing caption. Such a tile shows its credit alone. */
const captionIsOnlySubject = (photo: FanPhotoWithSubjects, names: string[], subject?: string) =>
  !!subject && !photo.caption && names.length === 0 && !photo.categoryName

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
    <Box sx={{ mt: 3, p: { xs: 1.75, sm: 2 }, borderRadius: 2, border: '1px solid', borderColor: CARD_BORDER, bgcolor: CARD_FILL }}>
      <Typography sx={{ fontSize: '0.9rem', fontWeight: 800 }}>Your photos</Typography>
      <Typography sx={{ fontSize: '0.8rem', color: 'text.secondary', mt: 0.5, lineHeight: 1.5 }}>
        Took photos at a WPBL game? Send them in and they could be featured here and on the players'
        pages, always credited to you.
      </Typography>
      {/* Its own line: run on at the end of the sentence it wrapped mid-address on a phone, and
          the address is the one thing in this panel a reader has to act on. */}
      <Typography sx={{ fontSize: '0.8rem', mt: 0.75, lineHeight: 1.5 }}>
        {link(`Email ${CONTACT_EMAIL}`)}
      </Typography>
    </Box>
  )
}

// ─── The lightbox ────────────────────────────────────────────────────────────────

/** One photograph at full size. `contain` inside a height cap, so a tall portrait phone photo is
 *  shown whole rather than cropped, and the caption and credit stay above the fold. */
export function FanPhotoLightbox({ photo, names, onClose, onEdit, subject }: {
  photo: FanPhotoWithSubjects; names: string[]; onClose: () => void
  /** The owner's Edit button; absent for everyone else. */
  onEdit?: () => void
  /** The page's own subject, named when nothing else would be (see captionIsOnlySubject). Out
   *  here the photo is the whole view, so the name is wanted rather than repeated. */
  subject?: string
}) {
  const caption = fanPhotoCaption(photo, names, subject)
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

function PhotoCard({ photo, names, onOpen, frame, focusable = true, subject }: {
  photo: FanPhotoWithSubjects; names: string[]; onOpen: () => void
  /** The page's own subject (a player's name on their page), named nowhere in `names`. */
  subject?: string
  /** 'rail': fixed height, width follows the photo. 'natural': full width of its column, height
   *  follows the photo (the gallery's masonry). */
  frame: 'rail' | 'natural'
  /** False on the Home rail's loop copy, which `inert` already hides; this keeps it out of the
   *  tab order in a browser too old to know `inert`. */
  focusable?: boolean
}) {
  // The subject stands in for the fallback so the photo's alt text and button name still say
  // who it is; only the VISIBLE line is dropped when it would just repeat the page's heading.
  const caption = fanPhotoCaption(photo, names, subject)
  const showCaption = !captionIsOnlySubject(photo, names, subject)
  const size = frame === 'rail'
    ? { width: '100%', height: { xs: chromePx(RAIL_TILE_H.xs), sm: chromePx(RAIL_TILE_H.sm) } }
    : { width: '100%', aspectRatio: photo.width && photo.height ? `${photo.width} / ${photo.height}` : '4 / 3' }
  return (
    <Box sx={{ minWidth: 0 }}>
      <Box
        onClick={onOpen}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }}
        role="button" tabIndex={focusable ? 0 : -1} aria-label={`View photograph: ${caption}`}
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
      {showCaption && (
        <Typography sx={{
          fontSize: '0.74rem', fontWeight: 600, lineHeight: 1.3, mt: 0.6,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>{caption}</Typography>
      )}
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
function useFanPhotoViewer(photos: FanPhotoWithSubjects[], resolveNames: ResolveNames, from: string, subject?: string) {
  const canEdit = useCanEditFanPhotos()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const open = useCallback((photo: FanPhotoWithSubjects) => {
    track(EVENTS.WPBL_FAN_PHOTO_OPENED, { photoId: photo.id, from })
    setActiveId(photo.id)
  }, [from])
  const active = activeId ? (photos.find(p => p.id === activeId) ?? null) : null
  const viewing = activeId !== null || editingId !== null
  const node = (
    <>
      {active && (
        <FanPhotoLightbox photo={active} names={resolveNames(active)} subject={subject} onClose={() => setActiveId(null)}
          onEdit={canEdit ? () => { setEditingId(active.id); setActiveId(null) } : undefined} />
      )}
      {editingId && (
        <Suspense fallback={null}>
          <FanPhotoEditor photoId={editingId} onClose={() => { setActiveId(editingId); setEditingId(null) }} />
        </Suspense>
      )}
    </>
  )
  return { open, node, viewing }
}

// ─── Auto-scroll (the Home rail) ──────────────────────────────────────────────────
//
// The Home rail drifts slowly through its photos on its own, so a reader who never touches it
// still sees more than the first three. It gets out of the way of anyone who shows interest:
//
//   • A mouse over the rail (or its arrows) PAUSES it, and it picks up from wherever the reader
//     left it, arrows included. Keyboard focus inside it does the same.
//   • A finger that actually DRAGS the rail STOPS it for good, until the page reloads. A phone
//     has no hover to resume on, and a rail that starts moving again while you are reading a
//     caption you scrolled to is the one thing worse than no auto-scroll. A touch that does not
//     move it (a tap, or a vertical page scroll that started on it) only pauses it.
//   • An open photo pauses it, and so does being off screen, where it would only burn frames.
//   • Reduced motion turns it off entirely.
//
// It LOOPS, always forward, over a second copy of the tiles laid after the first: when the drift
// has moved exactly one copy's width it steps back by that width, which lands on an identical
// frame, so the seam never shows. The copy is `inert` and aria-hidden, so a screen reader and the
// tab key walk the real tiles once, which is what the ping-pong this replaced was protecting. It
// used to bounce between the ends with a hold at each, and every reversal read as the rail having
// run out of photos.

/** Slower from md up, where the tiles are larger and the eye follows one across a wider rail. */
const AUTO_SCROLL_PX_PER_S = { phone: 24, desktop: 16 } as const

/** The drift's sub-pixel remainder, 0 to 1, set on the scroller and read by every tile's
 *  transform. One property on the parent rather than a style per tile, so a frame writes once. */
const DRIFT_VAR = '--rail-drift'

/** The drift, and whether the rail should carry the loop's second copy. They differ: a phone
 *  reader who drags the rail stops the drift for good, but the copy stays, or removing it would
 *  clamp a rail scrolled into it back to the end in one jump. */
function useRailAutoScroll(
  scrollRef: RefObject<HTMLDivElement | null>,
  areaRef: RefObject<HTMLDivElement | null>,
  enabled: boolean,
  held: boolean,
): { drifting: boolean; looping: boolean } {
  const [reduced] = useState(prefersReducedMotion)
  const [stopped, setStopped] = useState(false)
  const looping = enabled && !reduced
  const active = looping && !stopped
  const heldRef = useRef(held)
  heldRef.current = held
  const syncRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    const c = scrollRef.current
    const area = areaRef.current
    if (!active || !c || !area) return
    let hovered = false, focused = false, touching = false, onScreen = true
    let touchStartLeft = 0
    let pos = 0, last = 0, frame = 0
    // What we last wrote to scrollLeft. Anything else that moves it (the arrows, a trackpad) is
    // picked up by comparing against this, so the drift resumes from there instead of jumping.
    let written = NaN
    const wide = window.matchMedia?.('(min-width: 900px)')

    const tick = (t: number) => {
      frame = requestAnimationFrame(tick)
      const dt = last ? Math.min(t - last, 100) : 0
      last = t
      // One copy's width, gap included: the distance from the first real tile to its copy.
      // Measured every frame rather than cached, since lazy images and a text-size change both
      // move it, and two offsetLefts on a laid-out rail cost nothing.
      const first = c.firstElementChild as HTMLElement | null
      const copy = c.querySelector<HTMLElement>('[data-loop-copy] > *')
      if (!first || !copy) return
      const period = copy.offsetLeft - first.offsetLeft
      // Photos that do not fill the rail have nothing to scroll to, and wrapping them would pull
      // the copy into view beside the originals.
      if (period <= c.clientWidth) return
      if (!(Math.abs(c.scrollLeft - written) <= 2)) pos = c.scrollLeft
      pos += (wide?.matches ? AUTO_SCROLL_PX_PER_S.desktop : AUTO_SCROLL_PX_PER_S.phone) * dt / 1000
      while (pos >= period) pos -= period
      // WHOLE PIXELS TO scrollLeft, THE FRACTION TO A TRANSFORM. At 16px/s a frame moves a
      // quarter of a pixel, and the browser snaps a scroll offset to the pixel grid, so writing
      // `pos` straight in held the rail still for three frames and jumped it on the fourth: the
      // judder. A transform is not snapped, so the tiles slide the remainder (see DRIFT_VAR).
      const whole = Math.floor(pos)
      c.scrollLeft = whole
      c.style.setProperty(DRIFT_VAR, String(pos - whole))
      written = whole
    }
    const sync = () => {
      const run = onScreen && !hovered && !focused && !touching && !heldRef.current
      if (run && !frame) { last = 0; written = NaN; frame = requestAnimationFrame(tick) }
      else if (!run && frame) {
        cancelAnimationFrame(frame); frame = 0
        // Drop the sub-pixel offset while paused, so a reader scrolling by hand or with the arrows
        // is not carrying a fraction of a pixel the drift is no longer maintaining.
        c.style.removeProperty(DRIFT_VAR)
      }
    }
    syncRef.current = sync

    // Pointer events, not mouse events: a touch browser fires emulated mouseenter on every tap
    // and never the leave, which would pause a phone's rail forever on the first tap.
    const onEnter = (e: PointerEvent) => { if (e.pointerType !== 'touch') { hovered = true; sync() } }
    const onLeave = (e: PointerEvent) => { if (e.pointerType !== 'touch') { hovered = false; sync() } }
    const onFocusIn = () => { focused = true; sync() }
    const onFocusOut = (e: FocusEvent) => { focused = area.contains(e.relatedTarget as Node | null); sync() }
    const onTouchStart = () => { touching = true; touchStartLeft = c.scrollLeft; sync() }
    const onTouchEnd = () => {
      touching = false
      if (Math.abs(c.scrollLeft - touchStartLeft) > 4) setStopped(true)
      else sync()
    }
    area.addEventListener('pointerenter', onEnter)
    area.addEventListener('pointerleave', onLeave)
    area.addEventListener('focusin', onFocusIn)
    area.addEventListener('focusout', onFocusOut)
    area.addEventListener('touchstart', onTouchStart, { passive: true })
    area.addEventListener('touchend', onTouchEnd)
    area.addEventListener('touchcancel', onTouchEnd)
    const io = typeof IntersectionObserver === 'undefined' ? null
      : new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; sync() })
    io?.observe(c)
    sync()

    return () => {
      cancelAnimationFrame(frame)
      c.style.removeProperty(DRIFT_VAR)
      syncRef.current = null
      io?.disconnect()
      area.removeEventListener('pointerenter', onEnter)
      area.removeEventListener('pointerleave', onLeave)
      area.removeEventListener('focusin', onFocusIn)
      area.removeEventListener('focusout', onFocusOut)
      area.removeEventListener('touchstart', onTouchStart)
      area.removeEventListener('touchend', onTouchEnd)
      area.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [active, scrollRef, areaRef])

  // Opening a photo pauses without tearing the loop down, so it resumes where it was.
  useEffect(() => { syncRef.current?.() }, [held])

  return { drifting: active, looping }
}

// ─── The strip (player page, Game Center) ──────────────────────────────────────────

/** A horizontal rail of a subject's or a game's photos, opening the lightbox. `from` labels the
 *  open event so a player-page strip and a Game Center strip can be judged separately.
 *  `autoScroll` makes it drift on its own (Home only; see useRailAutoScroll). `phoneInset` is for
 *  a rail bled to its card's edges on a phone (see RailScroller). */
export function FanPhotoStrip({ photos, resolveNames, from, autoScroll = false, phoneInset = 0, subject }: {
  photos: FanPhotoWithSubjects[]; resolveNames: ResolveNames; from: string; autoScroll?: boolean; phoneInset?: number
  /** The page's own subject, left out of `resolveNames` because every photo here is of them. */
  subject?: string
}) {
  const { scrollRef, canPrev, canNext, syncEdges, page } = useRailPaging(photos.length)
  const { open, node, viewing } = useFanPhotoViewer(photos, resolveNames, from, subject)
  const areaRef = useRef<HTMLDivElement>(null)
  const { drifting, looping } = useRailAutoScroll(scrollRef, areaRef, autoScroll && photos.length > 0, viewing)

  if (photos.length === 0) return null
  // Each tile as wide as its photo is at the rail's height, so a portrait and a landscape shot sit
  // side by side at their own shapes.
  const tiles = (copy: boolean) => photos.map(p => {
    const a = railTileAspect(p.width, p.height)
    return (
      <Box key={p.id} sx={{
        flexShrink: 0, scrollSnapAlign: 'start',
        width: { xs: `calc(${chromePx(RAIL_TILE_H.xs)} * ${a})`, sm: `calc(${chromePx(RAIL_TILE_H.sm)} * ${a})` },
        // The drift's sub-pixel remainder (see useRailAutoScroll). Only while drifting, so a still
        // rail is not holding a compositor layer per tile for nothing.
        ...(drifting ? { transform: `translateX(calc(var(${DRIFT_VAR}, 0) * -1px))`, willChange: 'transform' } : {}),
      }}>
        <PhotoCard photo={p} names={resolveNames(p)} onOpen={() => open(p)} frame="rail" focusable={!copy} subject={subject} />
      </Box>
    )
  })
  return (
    <>
      <Box ref={areaRef} sx={{ position: 'relative' }}>
        {/* NO SNAPPING ON A DRIFTING RAIL, EVER, not only while it drifts. Snap had to be off
            during the drift (it re-snaps every nudge), which left exactly one moment it came on:
            the instant a finger drag stopped the drift, with the rail still gliding from the
            flick. Switching snap on mid-glide makes the browser yank the nearest photo into place,
            and that was the only snap the Home rail ever did. A photo rail of mixed widths reads
            fine scrolling freely; the arrows still page it on a desktop. */}
        <RailScroller scrollRef={scrollRef} onScroll={syncEdges} snap={!autoScroll} phoneInset={phoneInset}>
          {tiles(false)}
          {/* The loop's second copy (see useRailAutoScroll). `display: contents` so its tiles are
              flex items of the rail like the originals, with the same gap at the seam. `inert`
              is set through the ref because React 18 has no prop for it; it takes the copy out
              of the tab order and the accessibility tree while leaving it clickable. */}
          {looping && (
            <Box data-loop-copy aria-hidden ref={(el: HTMLElement | null) => { el?.setAttribute('inert', '') }}
              sx={{ display: 'contents' }}>
              {tiles(true)}
            </Box>
          )}
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
  const version = useFanPhotosVersion()
  const [index, setIndex] = useState<FanPhotoIndex | null>(null)
  useEffect(() => {
    let live = true
    fetchWpblFanPhotoIndex().then(idx => { if (live) setIndex(idx) }).catch(() => { /* renders nothing */ })
    return () => { live = false }
  }, [version])

  const nameById = useMemo(() => new Map(players.map(p => [p.id, p.name])), [players])
  const resolveNames = useCallback((photo: FanPhotoWithSubjects): string[] => {
    const names: string[] = []
    for (const pid of photo.playerIds) if (pid !== playerId) names.push(nameById.get(pid) ?? '—')
    for (const key of photo.figureKeys) names.push(index?.figures.get(key)?.name ?? '—')
    for (const tid of photo.teamIds) names.push(fanPhotoTeamName(index?.teams.get(tid)))
    return names
  }, [playerId, nameById, index])

  const photos = index?.byPlayer.get(playerId) ?? []
  if (photos.length === 0) return null
  const subjectName = nameById.get(playerId)
  return (
    <Box sx={{ mt: 2 }}>
      <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5, color: 'text.secondary', mb: 1 }}>
        Gallery
      </Typography>
      <FanPhotoStrip photos={photos} resolveNames={resolveNames} from="player" subject={subjectName} />
    </Box>
  )
}

// ─── The Home card ──────────────────────────────────────────────────────────────

/**
 * The fan-photos card on Home: a slowly drifting rail of photographs in random order and a link
 * to the full gallery. Shows
 * year-round once there are HOME_MIN_PHOTOS published, because the photos keep arriving and the
 * card grows with them; it sits low on Home (above "The league"), the explore-and-relive zone,
 * where it stays out of the live cards during a season and rises on its own once those go quiet.
 *
 * Self-fetching off the app-wide-cached index, so Home hands it nothing. In dev the offseason
 * preview can pad it with mock rows (see devFanPhotos), which is the only way to see the card
 * before twelve real photos exist.
 */
/** The Home card's shape with nothing in it: the same card, a rail of tiles at the rail's height
 *  with their two caption lines, and the ask under it, so the real card lands on the same pixels. */
export function FanPhotoHomeCardSkeleton() {
  return (
    <Box sx={{ mt: 1.5 }} aria-hidden>
      <SectionCard title="2026 gallery">
        <Box sx={{ mx: { xs: -2, sm: 0 }, display: 'flex', gap: 1.25, overflow: 'hidden', pb: 0.5 }}>
          {[1.5, 1, 1.5, 1.33, 1.5].map((a, i) => (
            <Box key={i} sx={{ flexShrink: 0, width: { xs: `calc(${chromePx(RAIL_TILE_H.xs)} * ${a})`, sm: `calc(${chromePx(RAIL_TILE_H.sm)} * ${a})` } }}>
              <Skeleton variant="rounded" sx={{ width: '100%', height: { xs: chromePx(RAIL_TILE_H.xs), sm: chromePx(RAIL_TILE_H.sm) } }} />
              <Skeleton variant="text" width="60%" sx={{ fontSize: '0.74rem', lineHeight: 1.3, mt: 0.6 }} />
              <Skeleton variant="text" width="45%" sx={{ fontSize: '0.62rem', lineHeight: 1.35, mt: 0.5 }} />
            </Box>
          ))}
        </Box>
        <Skeleton variant="text" width="16rem" sx={{ fontSize: '0.72rem', mt: 1, maxWidth: '100%' }} />
      </SectionCard>
    </Box>
  )
}

export function FanPhotoHomeCard({ reserve = false }: {
  /** Hold the card's height while its reads are in flight. Only where the card sits ABOVE other
   *  content (the offseason top slot): there a card that renders nothing and then appears pushes
   *  the whole page down by its own height, a second after the reader started reading it. Lower
   *  down it can keep rendering nothing, since nothing under it is on screen yet. */
  reserve?: boolean
} = {}) {
  const version = useFanPhotosVersion()
  // Seeded from the session caches, which the section warms beside the schedule, so a Home that
  // mounts after they land draws the rail on its first paint.
  const [index, setIndex] = useState<FanPhotoIndex | null>(() => getCachedWpblFanPhotoIndex())
  const [players, setPlayers] = useState<WpblPlayer[]>(() => getCachedWpblAllPlayers() ?? [])
  const [mockOn, setMockOn] = useState(() => import.meta.env.DEV && devFanPhotosOn())

  useEffect(() => {
    let live = true
    Promise.all([fetchWpblFanPhotoIndex(), fetchWpblAllPlayers()])
      .then(([idx, pl]) => { if (live) { setIndex(idx); setPlayers(pl) } })
      .catch(() => { /* renders nothing */ })
    return () => { live = false }
  }, [version])

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

  // A fresh random order on every load, so the rail (which shows at most HOME_RAIL_MAX) is a
  // different sample each visit rather than always the newest dozen. Each photo draws its sort key
  // once, by id: an in-place edit refetches the index, and reshuffling then would rearrange the
  // rail under the owner who just made the edit.
  const sortKeys = useRef(new Map<string, number>())
  const shuffled = useMemo(() => {
    const keys = sortKeys.current
    for (const p of photos) if (!keys.has(p.id)) keys.set(p.id, Math.random())
    return [...photos].sort((a, b) => keys.get(a.id)! - keys.get(b.id)!)
  }, [photos])

  if (reserve && index === null) return <FanPhotoHomeCardSkeleton />
  if (photos.length < HOME_MIN_PHOTOS) return null

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
        {/* Edge to edge on a phone: the card's side padding is 2 of a ~340px body, and the rail
            is the one thing on the card that gains from every pixel of width. The negative margin
            matches the card body's `px: 2`; the card's own overflow clips the tiles at its border.
            `phoneInset` puts the same 2 back inside the scroller, so at rest the photos line up
            with the title and the note, and only a scrolling photo runs to the edge. */}
        <Box sx={{ mx: { xs: -2, sm: 0 } }}>
          <FanPhotoStrip photos={shuffled.slice(0, HOME_RAIL_MAX)} resolveNames={resolveNames} from="home" autoScroll phoneInset={2} />
        </Box>
        <FanPhotoSubmitNote variant="line" />
      </SectionCard>
    </Box>
  )
}
