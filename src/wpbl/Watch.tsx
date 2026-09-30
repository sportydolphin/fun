import { useEffect, useMemo, useRef, useState } from 'react'
import { Box, Typography } from '@mui/material'
import { CARD_BORDER, CARD_FILL, TYPE_SCALE, hoverOnly, FOCUS_RING, chromePx, useRailPaging, RailArrow, RailScroller } from './ui'
import { SectionHead } from './cardParts'
import { linkTo } from '../nav'
import { track, trackImpression, EVENTS } from '../lib/analytics'
import {
  fetchWpblVideos, getCachedWpblVideos, fetchWpblVideoTags, getCachedWpblVideoTags,
  fetchWpblSchedule, getCachedWpblSchedule, fetchWpblTeams, getCachedWpblTeams,
} from './api'
import { WPBL_WATCH_PAGE } from './routes'
import { watchShelves } from './videoChannels'
import { HighlightLightbox, VideoThumb, PLAYABLE_HOVER } from './Highlights'
import type { WpblGame, WpblTeam, WpblVideo, WpblVideoTag } from './types'

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

// ─── Tagged clips: labels, the row, and its places ───────────────────────────

const ORDINAL = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`
}

/** "Top 3rd", or null for a clip not pinned to an at-bat. */
export function inningLabel(tag: Pick<WpblVideoTag, 'half' | 'inning'> | undefined): string | null {
  if (!tag?.inning || !tag.half) return null
  return `${tag.half === 'bottom' ? 'Bottom' : 'Top'} ${ORDINAL(tag.inning)}`
}

/**
 * What a clip is from, as one line: "LA @ SF · Sep 16 · Top 3rd". `withGame` off where the game is
 * already on screen (Game Center), leaving the inning alone. Null when there is nothing to say.
 */
export function clipLabel(tag: WpblVideoTag | undefined, gameById: Map<string, WpblGame>,
  teamById: Map<string, WpblTeam>, withGame = true): string | null {
  if (!tag) return null
  const parts: string[] = []
  const game = tag.game_id ? gameById.get(tag.game_id) : undefined
  if (withGame && game) {
    const abbr = (id: string) => teamById.get(id)?.abbr ?? id
    parts.push(`${abbr(game.away_team_id)} @ ${abbr(game.home_team_id)}`)
    parts.push(new Date(`${game.game_date}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' }))
  }
  const inning = inningLabel(tag)
  if (inning) parts.push(inning)
  return parts.length ? parts.join(' · ') : null
}

/** The label as the lightbox's context line. */
export function ClipContextLine({ text, action }: { text: string | null; action?: React.ReactNode }) {
  if (!text && !action) return null
  return (
    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, flexWrap: 'wrap' }}>
      {text && <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', fontWeight: 600 }}>From {text}</Typography>}
      {action}
    </Box>
  )
}

/**
 * A row of tagged clips, playing in place with next and previous: Game Center's "Clips from this
 * game" and the player page's clips. Renders nothing without a clip, which is most games and
 * most players, so it costs a page nothing to include.
 */
export function ClipStrip({ clips, labelFor, from, title = 'Clips' }: {
  clips: WpblVideo[]
  /** The line under each poster and in the lightbox, or null. */
  labelFor: (v: WpblVideo) => string | null
  /** For WPBL_HIGHLIGHT_PLAYED: 'game' or 'player'. */
  from: string
  title?: string
}) {
  const [active, setActive] = useState<number | null>(null)
  const { scrollRef, canPrev, canNext, syncEdges, page } = useRailPaging(clips.length)
  if (clips.length === 0) return null
  const play = (i: number) => {
    track(EVENTS.WPBL_HIGHLIGHT_PLAYED, { videoId: clips[i].video_id, kind: 'clip', from })
    setActive(i)
  }
  return (
    <Box sx={{ mt: 2 }}>
      <SectionHead title={title} />
      <Box sx={{ position: 'relative' }}>
        <RailScroller scrollRef={scrollRef} onScroll={syncEdges}>
          {clips.map((v, i) => {
            const label = labelFor(v)
            return (
              <Box key={v.video_id} sx={{ flexShrink: 0, width: chromePx(112), scrollSnapAlign: 'start' }}>
                <Box
                  onClick={() => play(i)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); play(i) } }}
                  role="button" tabIndex={0} aria-label={`Play clip: ${v.title}`}
                  sx={{ position: 'relative', borderRadius: 2, overflow: 'hidden', cursor: 'pointer', ...PLAYABLE_HOVER, ...FOCUS_RING }}
                >
                  <VideoThumb video={v} vertical badge={30} />
                  <ClipCaption title={v.title} lines={3} />
                </Box>
                {label && (
                  <Typography sx={{ mt: 0.4, fontSize: TYPE_SCALE.micro, fontWeight: 700, color: 'text.disabled', lineHeight: 1.3 }}>
                    {label}
                  </Typography>
                )}
              </Box>
            )
          })}
        </RailScroller>
        <RailArrow dir="left" show={canPrev} onClick={() => page(-1)} label="clips" />
        <RailArrow dir="right" show={canNext} onClick={() => page(1)} label="clips" />
      </Box>
      {active != null && clips[active] && (
        <HighlightLightbox
          video={clips[active]}
          onClose={() => setActive(null)}
          onPrev={active > 0 ? () => setActive(active - 1) : undefined}
          onNext={active < clips.length - 1 ? () => setActive(active + 1) : undefined}
          context={<ClipContextLine text={labelFor(clips[active])} />}
        />
      )}
    </Box>
  )
}

/** Every Short with a tag, and the tags, from the two app-wide caches. */
export function useClipTags(): { videos: WpblVideo[]; tags: Map<string, WpblVideoTag> } {
  const [videos, setVideos] = useState<WpblVideo[]>(() => getCachedWpblVideos() ?? [])
  const [tags, setTags] = useState<Map<string, WpblVideoTag>>(() => getCachedWpblVideoTags() ?? new Map())
  useEffect(() => {
    let live = true
    fetchWpblVideos().then(v => { if (live) setVideos(v) }).catch(() => { /* renders nothing */ })
    fetchWpblVideoTags().then(t => { if (live) setTags(t) }).catch(() => { /* renders nothing */ })
    return () => { live = false }
  }, [])
  return { videos, tags }
}

/**
 * Game Center's clips: every Short pinned to this game, in the order the plays happened. A clip
 * pinned to the game but not an at-bat follows the pinned ones, by upload time.
 */
export function GameClips({ gameId }: { gameId: string }) {
  const { videos, tags } = useClipTags()
  const mine = useMemo(() => videos
    .filter(v => v.is_short === true && tags.get(v.video_id)?.game_id === gameId)
    .sort((a, b) => {
      const sa = tags.get(a.video_id)?.play_sequence ?? Infinity
      const sb = tags.get(b.video_id)?.play_sequence ?? Infinity
      return sa - sb || a.published_at.localeCompare(b.published_at)
    }), [videos, tags, gameId])
  const none = useMemo(() => ({ games: new Map<string, WpblGame>(), teams: new Map<string, WpblTeam>() }), [])
  return <ClipStrip clips={mine} from="game" title="Clips from this game"
    labelFor={v => clipLabel(tags.get(v.video_id), none.games, none.teams, false)} />
}

/** A player's clips, newest first, each labelled with the game it is from where it has one. */
export function PlayerClips({ playerId }: { playerId: string }) {
  const { videos, tags } = useClipTags()
  const [games, setGames] = useState<WpblGame[]>(() => getCachedWpblSchedule() ?? [])
  const [teams, setTeams] = useState<WpblTeam[]>(() => getCachedWpblTeams() ?? [])
  useEffect(() => {
    let live = true
    fetchWpblSchedule().then(g => { if (live) setGames(g) }).catch(() => { /* labels without a game */ })
    fetchWpblTeams().then(t => { if (live) setTeams(t) }).catch(() => { /* labels without a game */ })
    return () => { live = false }
  }, [])
  const gameById = useMemo(() => new Map(games.map(g => [g.id, g])), [games])
  const teamById = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])
  const mine = useMemo(() => videos.filter(v => v.is_short === true && tags.get(v.video_id)?.player_ids.includes(playerId)),
    [videos, tags, playerId])
  return <ClipStrip clips={mine} from="player" labelFor={v => clipLabel(tags.get(v.video_id), gameById, teamById)} />
}
