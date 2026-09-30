import { useEffect, useMemo, useRef, useState } from 'react'
import { Box, Typography } from '@mui/material'
import { CARD_BORDER, CARD_FILL, TYPE_SCALE, hoverOnly, FOCUS_RING } from './ui'
import { linkTo } from '../nav'
import { track, trackImpression, EVENTS } from '../lib/analytics'
import { fetchWpblVideos, getCachedWpblVideos } from './api'
import { WPBL_WATCH_PAGE } from './routes'
import { watchShelves } from './videoChannels'
import { HighlightLightbox, VideoThumb, PLAYABLE_HOVER } from './Highlights'
import type { WpblVideo } from './types'

/**
 * The door to /wpbl/watch: the newest clips as a row of posters, and a link to everything.
 *
 * It replaced the season recap's twelve-card highlights rail (Sep 29, 2026), and sits on Home
 * beside the latest-post line, which is the same job for the writing. CLIPS RATHER THAN REELS
 * because they are what the league posts most of and the only thing here that changes week to
 * week; a game's reel is one tap further, on the page, filed under its game.
 *
 * A clip plays IN PLACE, with next and previous over the whole clips shelf, rather than sending
 * the reader to the page first: the card's whole promise is "something to watch", and a detour
 * through a page to keep it would be the four-steps-to-the-fourteenth-post problem Reading was
 * built to fix. Renders nothing until there is a clip.
 */
export function WatchCard({ from, eyebrow = true }: {
  /** Which surface drew it, for the WATCH events: 'home' or 'recap'. */
  from: string
  /** Its own "Watch" label. Off where a section heading above it already says so. */
  eyebrow?: boolean
}) {
  const [videos, setVideos] = useState<WpblVideo[]>(() => getCachedWpblVideos() ?? [])
  useEffect(() => {
    let live = true
    fetchWpblVideos().then(v => { if (live) setVideos(v) }).catch(() => { /* renders nothing */ })
    return () => { live = false }
  }, [])
  const { clips, gameIds } = useMemo(() => watchShelves(videos), [videos])
  // Only where the reader can play one: the broadcasts are blocked in the US, and the list here
  // has already had what this reader cannot play taken out (fetchWpblVideos).
  const hasBroadcasts = useMemo(() => videos.some(v => v.kind === 'full_game'), [videos])
  const [active, setActive] = useState<number | null>(null)

  const shown = useRef(false)
  useEffect(() => {
    if (shown.current || clips.length === 0) return
    shown.current = true
    trackImpression(EVENTS.WPBL_WATCH_SHOWN, { count: videos.length, from }, from)
  }, [clips.length, videos.length, from])
  if (clips.length === 0) return null

  const all = linkTo(WPBL_WATCH_PAGE)
  const openPage = (e: React.MouseEvent) => { track(EVENTS.WPBL_WATCH_OPEN, { from, action: 'page' }); all.onClick(e) }
  const play = (i: number) => {
    track(EVENTS.WPBL_WATCH_OPEN, { from, action: 'play' })
    track(EVENTS.WPBL_HIGHLIGHT_PLAYED, { videoId: clips[i].video_id, kind: 'clip', from })
    setActive(i)
  }
  // Six posters on a desktop, four on a phone: at 375px six would be a row of stamps.
  const row = clips.slice(0, 6)
  const summary = `${gameIds.length} games, ${clips.length} clips`
  return (
    <Box sx={{
      border: '1px solid', borderColor: CARD_BORDER, borderRadius: 3, bgcolor: CARD_FILL,
      px: 2, py: 1.5, display: 'flex', flexDirection: 'column', gap: 1,
    }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
        <Typography sx={{
          flex: 1, minWidth: 0, fontSize: eyebrow ? TYPE_SCALE.micro : TYPE_SCALE.meta,
          fontWeight: eyebrow ? 800 : 600, letterSpacing: eyebrow ? 0.6 : 0,
          textTransform: eyebrow ? 'uppercase' : 'none', color: 'text.secondary',
        }}>{eyebrow ? 'Watch' : summary}</Typography>
        <Box {...all} onClick={openPage} sx={{
          flexShrink: 0, fontSize: TYPE_SCALE.meta, fontWeight: 800, color: 'var(--wpbl-accent-solid)',
          textDecoration: 'none', ...hoverOnly({ textDecoration: 'underline' }), ...FOCUS_RING,
        }}>All videos ›</Box>
      </Box>
      <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: { xs: 'repeat(4, minmax(0, 1fr))', md: 'repeat(6, minmax(0, 1fr))' } }}>
        {row.map((v, i) => (
          <Box
            key={v.video_id}
            onClick={() => play(i)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); play(i) } }}
            role="button"
            tabIndex={0}
            aria-label={`Play clip: ${v.title}`}
            sx={{
              display: { xs: i < 4 ? 'block' : 'none', md: 'block' },
              borderRadius: 2, overflow: 'hidden', cursor: 'pointer', position: 'relative',
              ...PLAYABLE_HOVER, ...FOCUS_RING,
            }}
          >
            <VideoThumb video={v} vertical badge={30} />
            <ClipCaption title={v.title} />
          </Box>
        ))}
      </Box>
      {eyebrow && (
        <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.disabled' }}>
          {hasBroadcasts ? 'Highlights, condensed games and full broadcasts' : 'Highlights and condensed games'} of {gameIds.length} games, and {clips.length} clips.
        </Typography>
      )}
      {active != null && (
        <HighlightLightbox
          video={clips[active]}
          onClose={() => setActive(null)}
          onPrev={active > 0 ? () => setActive(active - 1) : undefined}
          onNext={active < clips.length - 1 ? () => setActive(active + 1) : undefined}
        />
      )}
    </Box>
  )
}

/** A clip's title laid over the foot of its poster, the way the Shorts shelf on YouTube does it:
 *  a clip's title is the clip ("GIANELLONI GRAND SLAM"), so it belongs on the picture. */
export function ClipCaption({ title, lines = 2 }: { title: string; lines?: number }) {
  return (
    <Box sx={{
      position: 'absolute', left: 0, right: 0, bottom: 0, px: 0.75, pb: 0.6, pt: 2.5,
      background: 'linear-gradient(180deg, rgba(0,0,0,0), rgba(0,0,0,0.78))', pointerEvents: 'none',
    }}>
      <Typography sx={{
        color: '#fff', fontSize: TYPE_SCALE.micro, fontWeight: 700, lineHeight: 1.25,
        display: '-webkit-box', WebkitLineClamp: lines, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        textShadow: '0 1px 2px rgba(0,0,0,0.6)',
      }}>{title}</Typography>
    </Box>
  )
}
