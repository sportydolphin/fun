import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { Box, Typography } from '@mui/material'
import { ModalShell, SectionCard, TeamBadge, CARD_BORDER } from './ui'
import type { WpblVideo, WpblTeam } from './types'

// The WPBL highlights surface: a mirror of the league's official YouTube uploads, read from
// the wpbl_videos table (populated by scripts/sync-wpbl-youtube.mjs). Two consumers share
// this file — the Home "Highlights" rail and the per-game recap card in GameDetail — plus
// the lightbox they both open. Nothing here touches YouTube until a viewer clicks Play: the
// cards are static thumbnail facades, and only then do we mount the privacy-mode embed.

// A recognisable friendly label for a video's date. Highlights carry the game date parsed
// from the title (game_date_hint); everything else falls back to the upload time.
function videoDateLabel(v: WpblVideo): string {
  const iso = v.game_date_hint ? `${v.game_date_hint}T00:00:00` : v.published_at
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

// Play-button overlay shared by every thumbnail facade.
function PlayBadge({ size = 44 }: { size?: number }) {
  return (
    <Box sx={{
      position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
      // Gentle scrim so the white glyph reads over any thumbnail, deepening on hover.
      background: 'linear-gradient(180deg, rgba(0,0,0,0.05), rgba(0,0,0,0.35))',
      transition: 'background 0.15s',
    }}>
      <Box sx={{
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

// The click-to-play lightbox. Rendered only while a video is selected, so the YouTube embed
// (privacy-enhanced youtube-nocookie host) mounts on demand and autoplays — no network to
// YouTube happens from any list view.
export function HighlightLightbox({ video, onClose }: { video: WpblVideo; onClose: () => void }) {
  const src = `https://www.youtube-nocookie.com/embed/${video.video_id}?autoplay=1&rel=0&modestbranding=1`
  return (
    <ModalShell eyebrow="Highlights" onClose={onClose} maxWidth={880} zIndex={1600}>
      <Box sx={{ p: { xs: 1.5, sm: 2 } }}>
        <Box sx={{ position: 'relative', width: '100%', aspectRatio: '16 / 9', borderRadius: 2, overflow: 'hidden', bgcolor: '#000' }}>
          <Box
            component="iframe"
            src={src}
            title={video.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }}
          />
        </Box>
        <Typography sx={{ mt: 1.25, fontSize: '0.9rem', fontWeight: 600, lineHeight: 1.3 }}>{video.title}</Typography>
        <Box sx={{ mt: 0.75 }}>
          <Box
            component="a"
            href={`https://www.youtube.com/watch?v=${video.video_id}`}
            target="_blank"
            rel="noopener noreferrer"
            sx={{ fontSize: '0.75rem', color: 'text.secondary', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
          >
            Watch on YouTube ↗
          </Box>
        </Box>
      </Box>
    </ModalShell>
  )
}

// One card in the Home rail: a 16:9 thumbnail facade with a play badge, then the matchup
// badges + date + title beneath. Sized for a horizontal scroller.
function RailCard({ video, teamById, onPlay }: {
  video: WpblVideo; teamById: Map<string, WpblTeam>; onPlay: () => void
}) {
  const away = video.away_hint ? teamById.get(video.away_hint) : undefined
  const home = video.home_hint ? teamById.get(video.home_hint) : undefined
  const dateLabel = videoDateLabel(video)
  return (
    <Box
      onClick={onPlay}
      sx={{
        flexShrink: 0, width: { xs: 232, sm: 248 }, cursor: 'pointer', scrollSnapAlign: 'start',
        borderRadius: 2, overflow: 'hidden', border: '1px solid', borderColor: CARD_BORDER,
        bgcolor: 'background.paper', transition: 'transform 0.1s, border-color 0.15s',
        '&:hover': { borderColor: 'text.disabled' },
        '&:hover .play-badge': { background: 'linear-gradient(180deg, rgba(0,0,0,0.1), rgba(0,0,0,0.45))' },
        '&:active': { transform: 'scale(0.985)' },
      }}
    >
      <Box sx={{ position: 'relative', width: '100%', aspectRatio: '16 / 9', bgcolor: 'action.hover' }}>
        {video.thumbnail_url && (
          <Box component="img" src={video.thumbnail_url} alt="" loading="lazy"
            sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
        )}
        <Box className="play-badge" sx={{ position: 'absolute', inset: 0 }}><PlayBadge /></Box>
      </Box>
      <Box sx={{ p: 1, pt: 0.85 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5, minHeight: 22 }}>
          {away && home ? (
            <>
              <TeamBadge team={away} size={20} />
              <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, color: 'text.secondary' }}>@</Typography>
              <TeamBadge team={home} size={20} />
              <Box sx={{ flex: 1 }} />
            </>
          ) : <Box sx={{ flex: 1 }} />}
          {dateLabel && <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, color: 'text.disabled' }}>{dateLabel}</Typography>}
        </Box>
        <Typography sx={{
          fontSize: '0.78rem', fontWeight: 600, lineHeight: 1.3,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>
          {video.title}
        </Typography>
      </Box>
    </Box>
  )
}

// The Home "Highlights" rail — a horizontal scroller of the most recent uploads. Renders
// nothing when there are no videos (pre-migration / empty feed), so it never shows an empty
// shell. Highlights (matched to a game) lead; the tail keeps whatever else the feed carried.
export function HighlightsRail({ videos, teams }: { videos: WpblVideo[]; teams: WpblTeam[] }) {
  const teamById = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])
  const [active, setActive] = useState<WpblVideo | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Newest first (the query already orders this way), highlights ahead of podcasts/features
  // so the rail leads with game recaps. Cap the rail so it stays a glanceable strip.
  const shown = useMemo(() => {
    const rank = (v: WpblVideo) => (v.kind === 'highlight' ? 0 : v.kind === 'podcast' ? 1 : 2)
    return [...videos].sort((a, b) => rank(a) - rank(b)).slice(0, 12)
  }, [videos])

  const [atStart, setAtStart] = useState(true)
  const [atEnd, setAtEnd] = useState(true)
  const syncEdges = useCallback(() => {
    const c = scrollRef.current
    if (!c) return
    setAtStart(c.scrollLeft <= 1)
    setAtEnd(c.scrollLeft + c.clientWidth >= c.scrollWidth - 1)
  }, [])
  useEffect(() => { syncEdges() }, [shown, syncEdges])

  if (shown.length === 0) return null
  return (
    <SectionCard title="Highlights" subtitle="Game recaps from the WPBL channel" icon="▶️">
      <Box sx={{ position: 'relative' }}>
        <Box ref={scrollRef} onScroll={syncEdges} data-swipe-ignore="true" sx={{
          display: 'flex', gap: 1.25, overflowX: 'auto', pb: 0.5,
          scrollSnapType: 'x proximity',
          '&::-webkit-scrollbar': { display: 'none' },
          msOverflowStyle: 'none', scrollbarWidth: 'none',
        }}>
          {shown.map(v => <RailCard key={v.video_id} video={v} teamById={teamById} onPlay={() => setActive(v)} />)}
        </Box>
        {!atStart && (
          <Box sx={{ position: 'absolute', left: 0, top: 0, bottom: 6, width: 24, pointerEvents: 'none', background: t => `linear-gradient(to right, ${t.palette.background.paper}, transparent)` }} />
        )}
        {!atEnd && (
          <Box sx={{ position: 'absolute', right: 0, top: 0, bottom: 6, width: 24, pointerEvents: 'none', background: t => `linear-gradient(to left, ${t.palette.background.paper}, transparent)` }} />
        )}
      </Box>
      {active && <HighlightLightbox video={active} onClose={() => setActive(null)} />}
    </SectionCard>
  )
}

// The per-game recap strip shown at the top of GameDetail for a final game that has a
// matched highlight. Compact: a small thumbnail facade + label, opening the same lightbox.
export function GameHighlightCard({ video }: { video: WpblVideo }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Box
        onClick={() => setOpen(true)}
        sx={{
          display: 'flex', alignItems: 'center', gap: 1.25, cursor: 'pointer',
          p: 1, borderRadius: 2, border: '1px solid', borderColor: CARD_BORDER, bgcolor: 'background.paper',
          transition: 'border-color 0.15s, background 0.15s',
          '&:hover': { borderColor: 'text.disabled', bgcolor: 'action.hover' },
          '&:hover .play-badge': { background: 'linear-gradient(180deg, rgba(0,0,0,0.1), rgba(0,0,0,0.45))' },
          '&:active': { transform: 'scale(0.99)' },
        }}
      >
        <Box sx={{ position: 'relative', width: 108, flexShrink: 0, aspectRatio: '16 / 9', borderRadius: 1.5, overflow: 'hidden', bgcolor: 'action.hover' }}>
          {video.thumbnail_url && (
            <Box component="img" src={video.thumbnail_url} alt="" loading="lazy"
              sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
          )}
          <Box className="play-badge" sx={{ position: 'absolute', inset: 0 }}><PlayBadge size={30} /></Box>
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: '0.7rem', fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: 'text.secondary' }}>
            Watch Highlights
          </Typography>
          <Typography sx={{
            fontSize: '0.82rem', fontWeight: 600, lineHeight: 1.3, mt: 0.25,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>
            {video.title}
          </Typography>
        </Box>
      </Box>
      {open && <HighlightLightbox video={video} onClose={() => setOpen(false)} />}
    </>
  )
}
