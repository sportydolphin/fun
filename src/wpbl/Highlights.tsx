import { useEffect, useState, type ReactNode } from 'react'
import { Box, Typography } from '@mui/material'
import { ModalShell, CARD_BORDER, CARD_FILL, chromePx, hoverOnly, FOCUS_RING } from './ui'
import { track, EVENTS } from '../lib/analytics'
import type { WpblVideo } from './types'
import { videoCredit, videoLabel, videoKindName } from './videoChannels'

// The pieces every video surface shares: the thumbnail facade, the play badge, the credit line and
// the lightbox. Three consumers: the Watch page and its Home card (Watch.tsx, WatchPage.tsx), and
// the per-game cards in GameDetail and the recap card below. Nothing here touches YouTube until a
// viewer clicks Play: the cards are static thumbnail facades, and only then does the privacy-mode
// embed mount.

// Play-button overlay shared by every thumbnail facade. The `.play-disc` class lets a
// parent card scale the disc on hover (the transition below is otherwise idle).
export function PlayBadge({ size = 44 }: { size?: number }) {
  return (
    <Box sx={{
      position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
      // Gentle scrim so the white glyph reads over any thumbnail, deepening on hover.
      background: 'linear-gradient(180deg, rgba(0,0,0,0.05), rgba(0,0,0,0.35))',
      transition: 'background 0.15s',
    }}>
      <Box className="play-disc" sx={{
        width: size, height: size, borderRadius: '50%', flexShrink: 0,
        bgcolor: 'rgba(0,0,0,0.55)', border: '2px solid rgba(255,255,255,0.9)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'transform 0.12s, background 0.15s',
      }}>
        {/* Simple play triangle, nudged right to sit optically centred in the disc. */}
        <Box sx={{
          width: 0, height: 0, ml: '3px',
          borderStyle: 'solid', borderWidth: `${size * 0.18}px 0 ${size * 0.18}px ${size * 0.28}px`,
          borderColor: 'transparent transparent transparent #fff',
        }} />
      </Box>
    </Box>
  )
}

/** The hover treatment a card holding a PlayBadge spreads into its `sx`. */
export const PLAYABLE_HOVER = {
  '&:hover .play-badge': { background: 'linear-gradient(180deg, rgba(0,0,0,0.1), rgba(0,0,0,0.45))' },
  '&:hover .play-disc': { transform: 'scale(1.08)' },
} as const

/**
 * A thumbnail facade: the poster frame, a play badge over it, and nothing from YouTube.
 *
 * A SHORT'S POSTER IS LANDSCAPE. YouTube serves every thumbnail at 4:3 or 16:9, a Short's with the
 * vertical frame pillarboxed in the middle, so `cover` in a 9:16 box crops to exactly the frame and
 * the black bars fall outside it. Nothing here needs to know which poster size it was given.
 *
 * THE POSTER IS SIZED TO THE BOX, NOT TO WHAT THE ROW STORES. The sync stores the largest poster the
 * Data API offers, maxresdefault (1280x720, 70-130KB), and a 110px clip on a phone was downloading
 * all of it: thirty of them is 2.5MB for one screen of the Clips shelf. `hqdefault` (480x360, about
 * 12KB) exists for every upload, and cropped to 9:16 it still carries the full vertical frame at
 * 202px wide, which is all a clip poster ever shows. So a vertical or small box always takes it, and
 * a large 16:9 box offers both through srcset and lets the browser choose by `sizes`: a phone card
 * takes the small one, a desktop card the large. hqdefault is letterboxed, and `cover` in a 16:9 box
 * crops the bars off exactly.
 */
export function VideoThumb({ video, vertical, badge = 44, radius = 0, sizes }: {
  video: WpblVideo; vertical?: boolean; badge?: number; radius?: number
  /** The rendered width, as an <img sizes> value, for a 16:9 box big enough to want the large
   *  poster. Omitted, the box is small and takes hqdefault alone. */
  sizes?: string
}) {
  const small = `https://i.ytimg.com/vi/${video.video_id}/hqdefault.jpg`
  const large = video.thumbnail_url && video.thumbnail_url !== small ? video.thumbnail_url : null
  const useSet = !vertical && sizes && large
  return (
    <Box sx={{
      position: 'relative', width: '100%', aspectRatio: vertical ? '9 / 16' : '16 / 9',
      bgcolor: 'action.hover', overflow: 'hidden', borderRadius: radius,
    }}>
      <Box component="img" src={small} alt="" loading="lazy" decoding="async"
        {...(useSet ? { srcSet: `${small} 480w, ${large} 1280w`, sizes } : {})}
        sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
      <Box className="play-badge" sx={{ position: 'absolute', inset: 0 }}><PlayBadge size={badge} /></Box>
    </Box>
  )
}

// A recognisable friendly label for a video's date. Game videos carry the game date parsed from
// the title (game_date_hint); everything else falls back to the upload time.
export function videoDateLabel(v: WpblVideo): string {
  const iso = v.game_date_hint ? `${v.game_date_hint}T00:00:00` : v.published_at
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

/**
 * The click-to-play lightbox. Rendered only while a video is selected, so the YouTube embed
 * (privacy-enhanced youtube-nocookie host) mounts on demand and autoplays: no network to YouTube
 * happens from any list view.
 *
 * A Short plays in a 9:16 frame capped by the screen's height, since a vertical video sized to the
 * dialog's width runs off the bottom of a laptop. `onPrev` / `onNext` turn it into a pager (the
 * clips shelf), on buttons and the arrow keys; the embed remounts per video, which is what stops
 * the previous one playing on underneath. `context` is a line under the title saying what the
 * clip is from (its game and inning), when the clip has been tagged.
 */
export function HighlightLightbox({ video, onClose, onPrev, onNext, context }: {
  video: WpblVideo; onClose: () => void; onPrev?: () => void; onNext?: () => void
  context?: ReactNode
}) {
  // playsinline: without it iOS Safari takes the video to its own fullscreen player on play, which
  // for a Short means leaving the page, the next/previous buttons and the title all at once.
  const src = `https://www.youtube-nocookie.com/embed/${video.video_id}?autoplay=1&rel=0&modestbranding=1&playsinline=1`
  const credit = videoCredit(video)
  const vertical = video.is_short === true
  useEffect(() => {
    if (!onPrev && !onNext) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' && onPrev) { e.preventDefault(); onPrev() }
      if (e.key === 'ArrowRight' && onNext) { e.preventDefault(); onNext() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onPrev, onNext])
  const watchUrl = vertical ? `https://www.youtube.com/shorts/${video.video_id}` : `https://www.youtube.com/watch?v=${video.video_id}`
  return (
    <ModalShell eyebrow={videoKindName(video)} onClose={onClose} maxWidth={vertical ? chromePx(460) : 880} zIndex={1600}>
      <Box sx={{ p: { xs: 1.5, sm: 2 } }}>
        <Box sx={{
          position: 'relative', borderRadius: 2, overflow: 'hidden', bgcolor: '#000', mx: 'auto',
          ...(vertical
            // Height-led: the frame is as tall as the screen allows and its width follows.
            ? { aspectRatio: '9 / 16', height: 'min(70vh, 44rem)', maxWidth: '100%' }
            : { aspectRatio: '16 / 9', width: '100%' }),
        }}>
          <Box
            key={video.video_id}
            component="iframe"
            src={src}
            title={video.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }}
          />
        </Box>
        <Typography sx={{ mt: 1.25, fontSize: '0.9rem', fontWeight: 600, lineHeight: 1.3 }}>{video.title}</Typography>
        {context && <Box sx={{ mt: 0.5 }}>{context}</Box>}
        {credit && <Box sx={{ mt: 0.5 }}><VideoCreditLine credit={credit} /></Box>}
        <Box sx={{ mt: 0.75, display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box
            component="a"
            href={watchUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => track(EVENTS.WPBL_HIGHLIGHT_YOUTUBE, { videoId: video.video_id })}
            sx={{ flex: 1, fontSize: '0.75rem', color: 'text.secondary', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
          >
            Watch on YouTube ↗
          </Box>
          {(onPrev || onNext) && (
            <>
              <PagerButton label="Previous" glyph="‹" onClick={onPrev} />
              <PagerButton label="Next" glyph="›" onClick={onNext} />
            </>
          )}
        </Box>
      </Box>
    </ModalShell>
  )
}

function PagerButton({ label, glyph, onClick }: { label: string; glyph: string; onClick?: () => void }) {
  return (
    <Box component="button" type="button" onClick={onClick} disabled={!onClick} aria-label={label}
      sx={{
        width: chromePx(36), height: chromePx(36), borderRadius: '50%', cursor: onClick ? 'pointer' : 'default',
        // A thumb needs more than a cursor: 44px is the smallest target a finger hits reliably, and
        // these are the only way to the next clip on a phone, where the embed swallows every swipe.
        '@media (pointer: coarse)': { width: 44, height: 44 },
        border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', color: 'text.primary',
        fontSize: '1.2rem', fontWeight: 700, lineHeight: 1, opacity: onClick ? 1 : 0.35,
        display: 'flex', alignItems: 'center', justifyContent: 'center', p: 0,
        ...(onClick ? hoverOnly({ borderColor: 'text.secondary' }) : {}), ...FOCUS_RING,
      }}>
      {glyph}
    </Box>
  )
}

// "Video: WPBL from Day 1", linking to their channel. A real link rather than text, so the
// credit sends people to the person who made the video. It stops propagation because on the
// game card it sits inside the card's own click target, which would otherwise open the player
// underneath the new tab.
export function VideoCreditLine({ credit, what = 'Video' }: {
  credit: { name: string; url: string }
  /** What the credit is for. The Watch page's game card holds the league's videos too, so there
   *  it names the one that is theirs. */
  what?: string
}) {
  return (
    <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary', lineHeight: 1.3 }}>
      {what}:{' '}
      <Box
        component="a"
        href={credit.url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={e => e.stopPropagation()}
        onKeyDown={e => e.stopPropagation()}
        sx={{ color: 'inherit', fontWeight: 700, textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
      >
        {credit.name}
      </Box>
    </Typography>
  )
}

// Every video of one game, stacked: the league's reel, a fan's condensed game and the league's
// broadcast, whichever exist. Callers pass `gameVideos(...)`, which puts the shortest watch first.
export function GameHighlightCards({ videos }: { videos: WpblVideo[] }) {
  if (videos.length === 0) return null
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {videos.map(v => <GameHighlightCard key={v.video_id} video={v} />)}
    </Box>
  )
}

// The per-game recap strip shown at the top of GameDetail for a final game that has a
// matched highlight. Compact: a small thumbnail facade + label, opening the same lightbox.
function GameHighlightCard({ video }: { video: WpblVideo }) {
  const [open, setOpen] = useState(false)
  const credit = videoCredit(video)
  const label = videoLabel(video)
  // `from` separates the surfaces that open the same lightbox: the Watch page is browsing, this
  // one is a reader already inside a box score.
  const play = () => { track(EVENTS.WPBL_HIGHLIGHT_PLAYED, { videoId: video.video_id, kind: video.kind, from: 'game' }); setOpen(true) }
  return (
    <>
      <Box
        onClick={play}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); play() } }}
        role="button"
        tabIndex={0}
        aria-label={`${label}: ${video.title}`}
        sx={{
          display: 'flex', alignItems: 'center', gap: 1.25, cursor: 'pointer',
          p: 1, borderRadius: 2, border: '1px solid', borderColor: CARD_BORDER, bgcolor: CARD_FILL,
          transition: 'border-color 0.15s, background 0.15s',
          ...hoverOnly({ borderColor: 'text.disabled', bgcolor: 'action.hover' }),
          ...PLAYABLE_HOVER,
          '&:active': { transform: 'scale(0.99)' },
          '&:focus-visible': { outline: '2px solid', outlineColor: 'text.primary', outlineOffset: 2 },
        }}
      >
        <Box sx={{ width: chromePx(108), flexShrink: 0 }}>
          <VideoThumb video={video} badge={30} radius={1.5} />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: '0.7rem', fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: 'text.secondary' }}>
            {label}
          </Typography>
          <Typography sx={{
            fontSize: '0.82rem', fontWeight: 600, lineHeight: 1.3, mt: 0.25,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>
            {video.title}
          </Typography>
          {credit && <Box sx={{ mt: 0.25 }}><VideoCreditLine credit={credit} /></Box>}
        </Box>
      </Box>
      {open && <HighlightLightbox video={video} onClose={() => setOpen(false)} />}
    </>
  )
}
