import { useCallback, useMemo, useState } from 'react'
import { Box, Typography } from '@mui/material'
import { ModalShell, CARD_BORDER, useRailPaging, RailArrow, RailScroller, hoverOnly } from './ui'
import type { WpblPhoto } from './types'
import { track, EVENTS } from '../lib/analytics'

// The WPBL archive gallery: freely licensed women's baseball photography mirrored from
// Wikimedia Commons into `wpbl_photos` (scripts/sync-wpbl-commons.mjs). Three consumers share
// this file: the Home "From the archive" rail, the full gallery modal behind "See all", and
// the lightbox both of them open.
//
// WHY THIS IS HISTORY AND NOT THIS WEEK'S GAME. Commons has essentially no photography of the
// current league (the survey is in the migration), but it holds the deep record of women's
// baseball: the AAGPBL, the World Cup, the pioneers. That turns out to be the more useful
// feature anyway. Every other surface under /wpbl goes blank when the league's feed stops on
// Sep 6; this one does not know the difference.
//
// ATTRIBUTION IS THE FEATURE, NOT THE FOOTER. Most of these photographs are public domain,
// but a real share are CC BY or CC BY-SA, which oblige us to name the creator and the licence
// and to point at the source. There is no version of this design that hides that, so the
// credit line is on every card and every lightbox rather than tucked behind a click. If a
// layout change ever makes the credit hard to place, the photo comes out, not the credit.
//
// NOTHING HERE IS RENDERED AS MARKUP. Commons serves descriptions and attribution as HTML
// written by whoever uploaded the file; the sync strips it to plain text and this file only
// ever puts those strings in a text node. No dangerouslySetInnerHTML, ever.

/** Where the source links point, and how. `noopener` is not optional on target=_blank:
 *  without it the opened page gets a handle on ours through window.opener. */
const linkProps = { target: '_blank', rel: 'noopener noreferrer' } as const

/** Which surface a click came from, so the rail and the gallery can be judged separately. */
export type PhotoSource = 'rail' | 'gallery'

/** "File:Betsy Jochum Headshot.jpg" → "Betsy Jochum Headshot". The last-resort label when a
 *  file has no description at all, which happens: Commons requires a licence, not a caption. */
function titleLabel(photo: WpblPhoto): string {
  return photo.title.replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, '')
}

/** What a card and a lightbox actually show. The curator's caption wins where one exists,
 *  which is the whole reason that column is there: Commons descriptions are frequently
 *  archive boilerplate ("Title: … Creator: Unknown … Rights Information: …") that reads as
 *  broken text under a photograph. */
export function photoCaption(photo: WpblPhoto): string {
  return photo.caption ?? photo.description ?? titleLabel(photo)
}

/** Alt text. Deliberately the caption rather than the file name: a screen reader getting
 *  "Nineteen forty-seven detail comma Betsy Jochum cropped dot j p g" is worse than nothing. */
const altFor = (photo: WpblPhoto) => photoCaption(photo)

// ─── Attribution ─────────────────────────────────────────────────────────────────

/**
 * The credit line. Creator, licence, and a link to the file page on Commons.
 *
 * The whole line is one link to `description_url`, which is doing two jobs: it is the
 * "indicate the source" half of what CC BY asks for, and it is where a reader goes for the
 * provenance we deliberately do not copy into our own database (the full description, the
 * upload history, the other resolutions).
 *
 * `compact` is the card variant. It drops nothing that the licence requires; it only stops
 * setting the creator and the licence on separate lines.
 */
function Credit({ photo, compact }: { photo: WpblPhoto; compact?: boolean }) {
  const creator = photo.artist ?? 'Unknown photographer'
  return (
    <Box
      component="a"
      href={photo.description_url}
      {...linkProps}
      onClick={e => { e.stopPropagation(); track(EVENTS.WPBL_PHOTO_SOURCE, { pageId: photo.page_id }) }}
      aria-label={`${creator}, ${photo.license_short}, on Wikimedia Commons, opens in a new tab`}
      sx={{
        display: 'block', textDecoration: 'none', color: 'text.disabled',
        fontSize: compact ? '0.62rem' : '0.7rem', lineHeight: 1.35,
        '&:hover': { color: 'text.secondary', textDecoration: 'underline' },
        '&:focus-visible': { outline: '2px solid', outlineColor: 'text.primary', outlineOffset: 2, borderRadius: 1 },
      }}
    >
      <Box component="span" sx={{ fontWeight: 600 }}>{creator}</Box>
      {compact ? ' · ' : <br />}
      {photo.license_short} · Wikimedia Commons ↗
    </Box>
  )
}

// ─── The lightbox ────────────────────────────────────────────────────────────────

/**
 * One photograph at full size.
 *
 * `objectFit: contain` inside a height-capped box, not the `cover` the cards use: this is the
 * one place the photograph is the subject rather than a tile in a grid, and cropping a 1948
 * team photo to fit a rectangle is exactly the wrong trade here.
 */
export function PhotoLightbox({ photo, onClose }: { photo: WpblPhoto; onClose: () => void }) {
  const caption = photoCaption(photo)
  return (
    <ModalShell eyebrow="From the archive" onClose={onClose} maxWidth={900} zIndex={1600}>
      <Box sx={{ p: { xs: 1.5, sm: 2 } }}>
        <Box sx={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          // Capped against the viewport so a tall portrait scan cannot push the caption and
          // the credit below the fold, which would leave the attribution unread on exactly
          // the images most likely to need it.
          maxHeight: { xs: '55vh', sm: '65vh' },
          borderRadius: 2, overflow: 'hidden', bgcolor: 'action.hover',
        }}>
          <Box
            component="img"
            src={photo.file_url}
            alt={altFor(photo)}
            sx={{ maxWidth: '100%', maxHeight: { xs: '55vh', sm: '65vh' }, objectFit: 'contain', display: 'block' }}
          />
        </Box>
        <Typography sx={{ mt: 1.25, fontSize: '0.85rem', lineHeight: 1.45 }}>{caption}</Typography>
        <Box sx={{ mt: 1 }}><Credit photo={photo} /></Box>
      </Box>
    </ModalShell>
  )
}

// ─── The Home rail ───────────────────────────────────────────────────────────────

/**
 * One card in the rail.
 *
 * 4:3 rather than the 16:9 the Reading and Highlights cards use next to it. Those two are
 * mirroring a video thumbnail and a Substack cover, both of which are authored at 16:9; these
 * are photographs, and a large share of them are portrait scans that 16:9 crops to a band
 * across somebody's chest.
 */
function RailCard({ photo, onOpen }: { photo: WpblPhoto; onOpen: () => void }) {
  return (
    <Box
      onClick={onOpen}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }}
      role="button"
      tabIndex={0}
      aria-label={`View photograph: ${photoCaption(photo)}`}
      sx={{
        flexShrink: 0, width: { xs: 232, sm: 248 }, cursor: 'pointer', scrollSnapAlign: 'start',
        borderRadius: 2, overflow: 'hidden', border: '1px solid', borderColor: CARD_BORDER,
        bgcolor: 'background.paper', transition: 'transform 0.1s, border-color 0.15s',
        ...hoverOnly({ borderColor: 'text.disabled' }),
        '&:active': { transform: 'scale(0.985)' },
        '&:focus-visible': { outline: '2px solid', outlineColor: 'text.primary', outlineOffset: 2 },
      }}
    >
      <Box sx={{ position: 'relative', width: '100%', aspectRatio: '4 / 3', bgcolor: 'action.hover' }}>
        <Box component="img" src={photo.thumb_url} alt={altFor(photo)} loading="lazy"
          sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
      </Box>
      <Box sx={{ p: 1, pt: 0.85 }}>
        <Typography sx={{
          fontSize: '0.76rem', fontWeight: 600, lineHeight: 1.3,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>
          {photoCaption(photo)}
        </Typography>
        {/* The credit sits on the card, not only in the lightbox. A CC BY-SA photograph is
            published the moment this rail paints, whether or not anyone clicks it. */}
        <Box sx={{ mt: 0.5 }}><Credit photo={photo} compact /></Box>
      </Box>
    </Box>
  )
}

// Collapsed state is remembered per browser, on the same terms and for the same reasons as
// the two rails above it: a per-device layout choice, needed on the very first paint, and the
// section is usable signed out. Storage is wrapped because it throws in private mode and
// inside some in-app browsers.
/**
 * The Archive strip, as one segment of Home's media shelf. Bare: the card, the title and the
 * collapse control belong to the shelf (see MediaShelf.tsx).
 *
 * The credit line stays on every card here, exactly as it did when this was its own rail. A
 * CC BY-SA photograph is published the moment the strip paints, and moving into a shared card
 * changes nothing about that.
 */
export function PhotosStrip({ photos }: { photos: WpblPhoto[] }) {
  const [active, setActive] = useState<WpblPhoto | null>(null)
  const [galleryOpen, setGalleryOpen] = useState(false)
  // The query already returns the curator's order.
  const shown = useMemo(() => photos.slice(0, 12), [photos])
  const { scrollRef, canPrev, canNext, syncEdges, page } = useRailPaging(shown.length)

  const openPhoto = useCallback((photo: WpblPhoto) => {
    track(EVENTS.WPBL_PHOTO_OPENED, { pageId: photo.page_id, from: 'rail' })
    setActive(photo)
  }, [])
  const openGallery = useCallback(() => {
    track(EVENTS.WPBL_PHOTOS_GALLERY, { count: photos.length })
    setGalleryOpen(true)
  }, [photos.length])

  if (shown.length === 0) return null
  return (
    <>
      <Box sx={{ position: 'relative' }}>
        <RailScroller scrollRef={scrollRef} onScroll={syncEdges}>
          {shown.map(p => <RailCard key={p.page_id} photo={p} onOpen={() => openPhoto(p)} />)}
        </RailScroller>
        <RailArrow dir="left" show={canPrev} onClick={() => page(-1)} label="photographs" />
        <RailArrow dir="right" show={canNext} onClick={() => page(1)} label="photographs" />
      </Box>
      {photos.length > shown.length && (
        <Box sx={{ mt: 1 }}>
          <Box
            onClick={openGallery}
            role="button"
            tabIndex={0}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openGallery() } }}
            sx={{
              display: 'inline-block', fontSize: '0.72rem', fontWeight: 700,
              color: 'text.secondary', cursor: 'pointer', px: 0.5, borderRadius: 1,
              '&:hover': { color: 'text.primary' },
              '&:focus-visible': { outline: '2px solid', outlineColor: 'text.primary', outlineOffset: 2 },
            }}
          >
            All {photos.length} photographs
          </Box>
        </Box>
      )}
      {galleryOpen && <PhotosGallery photos={photos} onClose={() => setGalleryOpen(false)} />}
      {/* After the gallery so a photo opened from inside it stacks on top rather than behind. */}
      {active && <PhotoLightbox photo={active} onClose={() => setActive(null)} />}
    </>
  )
}

// ─── The full gallery ────────────────────────────────────────────────────────────

/**
 * Everything, as a grid.
 *
 * `auto-fill` with a minimum rather than a fixed column count: the set is small enough that a
 * phone showing one column per row and a desktop showing four is the same browsing experience
 * at two sizes, and it keeps the thumbnails from stretching when the count is odd.
 */
export function PhotosGallery({ photos, onClose }: { photos: WpblPhoto[]; onClose: () => void }) {
  const [active, setActive] = useState<WpblPhoto | null>(null)
  return (
    <>
      <ModalShell
        eyebrow={`From the archive · ${photos.length} photograph${photos.length === 1 ? '' : 's'}`}
        onClose={onClose}
        maxWidth={860}
        zIndex={1600}
      >
        <Box sx={{ p: 2 }}>
          {/* Said once, at the top, rather than repeated on every tile: what this collection
              is and why the site can show it. The per-photo credit below still carries the
              creator and the licence, which is what the licences actually require. */}
          <Typography sx={{ fontSize: '0.76rem', color: 'text.secondary', lineHeight: 1.5, mb: 1.75 }}>
            Freely licensed photographs of women's baseball, from the All-American Girls
            Professional Baseball League through to the present day, held by Wikimedia Commons.
            Every image links back to its file page, where its full provenance lives.
          </Typography>
          <Box sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
            gap: 1.5,
          }}>
            {photos.map(p => (
              <Box key={p.page_id}>
                <Box
                  onClick={() => { track(EVENTS.WPBL_PHOTO_OPENED, { pageId: p.page_id, from: 'gallery' }); setActive(p) }}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActive(p) } }}
                  role="button"
                  tabIndex={0}
                  aria-label={`View photograph: ${photoCaption(p)}`}
                  sx={{
                    position: 'relative', width: '100%', aspectRatio: '4 / 3', cursor: 'pointer',
                    borderRadius: 1.5, overflow: 'hidden', bgcolor: 'action.hover',
                    border: '1px solid', borderColor: CARD_BORDER,
                    transition: 'border-color 0.15s, transform 0.1s',
                    ...hoverOnly({ borderColor: 'text.disabled' }),
                    '&:active': { transform: 'scale(0.99)' },
                    '&:focus-visible': { outline: '2px solid', outlineColor: 'text.primary', outlineOffset: 2 },
                  }}
                >
                  <Box component="img" src={p.thumb_url} alt={altFor(p)} loading="lazy"
                    sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                </Box>
                <Typography sx={{
                  fontSize: '0.72rem', fontWeight: 600, lineHeight: 1.3, mt: 0.6,
                  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                }}>
                  {photoCaption(p)}
                </Typography>
                <Box sx={{ mt: 0.35 }}><Credit photo={p} compact /></Box>
              </Box>
            ))}
          </Box>
        </Box>
      </ModalShell>
      {active && <PhotoLightbox photo={active} onClose={() => setActive(null)} />}
    </>
  )
}
