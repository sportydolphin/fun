import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Typography } from '@mui/material'
import { ModalShell, SectionCard, TeamBadge, CARD_BORDER } from './ui'
import type { WpblVideo, WpblTeam } from './types'
import { scrollBehavior } from '../lib/motion'

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

// Play-button overlay shared by every thumbnail facade. The `.play-disc` class lets a
// parent card scale the disc on hover (the transition below is otherwise idle).
function PlayBadge({ size = 44 }: { size?: number }) {
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
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPlay() } }}
      role="button"
      tabIndex={0}
      aria-label={`Play highlights: ${video.title}`}
      sx={{
        flexShrink: 0, width: { xs: 232, sm: 248 }, cursor: 'pointer', scrollSnapAlign: 'start',
        borderRadius: 2, overflow: 'hidden', border: '1px solid', borderColor: CARD_BORDER,
        bgcolor: 'background.paper', transition: 'transform 0.1s, border-color 0.15s',
        '&:hover': { borderColor: 'text.disabled' },
        '&:hover .play-badge': { background: 'linear-gradient(180deg, rgba(0,0,0,0.1), rgba(0,0,0,0.45))' },
        '&:hover .play-disc': { transform: 'scale(1.08)' },
        '&:active': { transform: 'scale(0.985)' },
        '&:focus-visible': { outline: '2px solid', outlineColor: 'text.primary', outlineOffset: 2 },
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

// Desktop-only paging arrow. Touch users swipe the rail; a mouse user has no visible
// scrollbar (it's hidden) and no drag affordance, so on fine-pointer/hover devices we
// float a chevron over each edge that pages the scroller. Hidden on touch (via the
// media query) and faded out at whichever end of the rail it can't move toward.
function RailArrow({ dir, show, onClick }: { dir: 'left' | 'right'; show: boolean; onClick: () => void }) {
  return (
    <Box
      onClick={onClick}
      aria-label={dir === 'left' ? 'Previous highlights' : 'More highlights'}
      role="button"
      tabIndex={-1}
      sx={{
        position: 'absolute', top: '34%', [dir]: -4, transform: 'translateY(-50%)', zIndex: 2,
        width: 34, height: 34, borderRadius: '50%',
        display: 'none', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
        bgcolor: 'background.paper', border: '1px solid', borderColor: CARD_BORDER,
        boxShadow: '0 2px 8px rgba(0,0,0,0.28)', color: 'text.primary',
        opacity: show ? 1 : 0, pointerEvents: show ? 'auto' : 'none',
        transition: 'opacity 0.15s, background 0.15s',
        '&:hover': { bgcolor: 'action.hover' },
        // Only devices with a precise, hover-capable pointer (i.e. a desktop mouse/trackpad)
        // get the arrows; touch devices keep the clean swipe surface.
        '@media (hover: hover) and (pointer: fine)': { display: 'flex' },
      }}
    >
      <Box sx={{
        width: 0, height: 0, borderStyle: 'solid',
        ...(dir === 'left'
          ? { borderWidth: '6px 8px 6px 0', borderColor: 'transparent currentColor transparent transparent', mr: '2px' }
          : { borderWidth: '6px 0 6px 8px', borderColor: 'transparent transparent transparent currentColor', ml: '2px' }),
      }} />
    </Box>
  )
}

// The Home "Highlights" rail — a horizontal scroller of the most recent uploads. Renders
// nothing when there are no videos (pre-migration / empty feed), so it never shows an empty
// shell. Highlights (matched to a game) lead; the tail keeps whatever else the feed carried.
// Collapsed state is remembered per browser, mirroring how the Discord invite remembers a
// dismissal (`wpbl_discord_dismissed` in Home.tsx). Deliberately localStorage and not an
// account preference: it's a per-device layout choice, it must be known on the very first
// paint (a signed-in round trip would flash the rail open before collapsing it), and the
// section is usable signed-out. Reads/writes are wrapped because storage throws in private
// mode and inside some in-app browsers — a failure there just means the choice isn't kept.
const COLLAPSE_KEY = 'wpbl_highlights_collapsed'

function readCollapsed(): boolean {
  try { return localStorage.getItem(COLLAPSE_KEY) === '1' } catch { return false }
}

export function HighlightsRail({ videos, teams }: { videos: WpblVideo[]; teams: WpblTeam[] }) {
  const teamById = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])
  const [active, setActive] = useState<WpblVideo | null>(null)
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const scrollRef = useRef<HTMLDivElement>(null)

  const toggleCollapsed = useCallback(() => {
    setCollapsed(prev => {
      const next = !prev
      try { localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0') } catch { /* choice just isn't remembered */ }
      return next
    })
  }, [])

  // Newest first (the query already orders this way), highlights ahead of podcasts/features
  // so the rail leads with game recaps. Cap the rail so it stays a glanceable strip.
  const shown = useMemo(() => {
    const rank = (v: WpblVideo) => (v.kind === 'highlight' ? 0 : v.kind === 'podcast' ? 1 : 2)
    return [...videos].sort((a, b) => rank(a) - rank(b)).slice(0, 12)
  }, [videos])

  // Which paging arrows can do anything: hidden at the ends so a desktop user isn't offered
  // a dead control. Re-checked on scroll, on content change, and on resize (the reachable
  // scroll distance shifts as the strip's width changes).
  const [canPrev, setCanPrev] = useState(false)
  const [canNext, setCanNext] = useState(false)
  const syncEdges = useCallback(() => {
    const c = scrollRef.current
    if (!c) return
    const max = c.scrollWidth - c.clientWidth
    setCanPrev(c.scrollLeft > 1)
    setCanNext(c.scrollLeft < max - 1)
  }, [])
  useEffect(() => { syncEdges() }, [shown, syncEdges])
  useEffect(() => {
    window.addEventListener('resize', syncEdges)
    return () => window.removeEventListener('resize', syncEdges)
  }, [syncEdges])

  // Page by most of the visible width, leaving a card of overlap so nothing is skipped.
  const page = (dir: 1 | -1) => {
    const c = scrollRef.current
    if (!c) return
    c.scrollBy({ left: dir * Math.max(c.clientWidth * 0.8, 200), behavior: scrollBehavior() })
  }

  if (shown.length === 0) return null
  // No edge-fade overlay here (unlike the small scoreboard chips): over a full-size video
  // card the gradient sat on top of the very card the user just snapped into focus, reading
  // as "this one is faded/disabled." A half-peeking neighbour card is the "swipe for more"
  // cue on touch; on desktop the floating arrows (RailArrow) do the paging instead.
  return (
    <SectionCard
      title="Highlights"
      subtitle="Game recaps from the WPBL channel"
      collapsed={collapsed}
      onToggleCollapse={toggleCollapsed}
    >
      <Box sx={{ position: 'relative' }}>
        <Box ref={scrollRef} onScroll={syncEdges} data-swipe-ignore="true" sx={{
          display: 'flex', gap: 1.25, overflowX: 'auto', pb: 0.5,
          scrollSnapType: 'x proximity',
          '&::-webkit-scrollbar': { display: 'none' },
          msOverflowStyle: 'none', scrollbarWidth: 'none',
        }}>
          {shown.map(v => <RailCard key={v.video_id} video={v} teamById={teamById} onPlay={() => setActive(v)} />)}
        </Box>
        <RailArrow dir="left" show={canPrev} onClick={() => page(-1)} />
        <RailArrow dir="right" show={canNext} onClick={() => page(1)} />
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
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(true) } }}
        role="button"
        tabIndex={0}
        aria-label={`Watch highlights: ${video.title}`}
        sx={{
          display: 'flex', alignItems: 'center', gap: 1.25, cursor: 'pointer',
          p: 1, borderRadius: 2, border: '1px solid', borderColor: CARD_BORDER, bgcolor: 'background.paper',
          transition: 'border-color 0.15s, background 0.15s',
          '&:hover': { borderColor: 'text.disabled', bgcolor: 'action.hover' },
          '&:hover .play-badge': { background: 'linear-gradient(180deg, rgba(0,0,0,0.1), rgba(0,0,0,0.45))' },
          '&:hover .play-disc': { transform: 'scale(1.08)' },
          '&:active': { transform: 'scale(0.99)' },
          '&:focus-visible': { outline: '2px solid', outlineColor: 'text.primary', outlineOffset: 2 },
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
