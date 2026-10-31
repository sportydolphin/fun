import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Box, Typography } from '@mui/material'
import { TextGhost, TeamBadge, TYPE_SCALE, FOCUS_RING, chromePx, hoverOnly } from './ui'
import { panelShiftSx, useSidePanelOpen, usePhoneLayout } from '../ui/ModalShell'
import { useWpblHeadingTag } from './PageHeading'
import { navBack, isModified } from '../nav'
import { setDynamicSeo } from '../seo'
import { track, EVENTS } from '../lib/analytics'
import { fetchWpblAllPlayers, fetchWpblVideoRow, getCachedWpblAllPlayers } from './api'
import { seriesContexts } from './derive/series'
import { WPBL_WATCH_PAGE, wpblGamePath, wpblPlayerPath, wpblWatchVideoPath } from './routes'
import { videoCredit, videoKindName, formatDuration, formatViews } from './videoChannels'
import { VideoThumb, VideoCreditLine, PagerButton, videoDateLabel } from './Highlights'
import { clipLabel, useClipTags } from './Watch'
import { YouTubePlayer } from './watch/YouTubePlayer'
import { resolveQueue } from './watch/queue'
import { eventLabel } from './watch/shelves'
import type { WpblGame, WpblPlayer, WpblTeam, WpblVideo } from './types'

// /wpbl/watch/<YouTube id>: one video, its context and what plays next.
//
// ONE TREE IN EVERY SHAPE, restyled rather than swapped, because the player must never remount: a
// remount loses the gesture that lets the next video start with sound (see YouTubePlayer), and moving
// from a reel to a Short happens inside one player. So a phone's Short is the same elements as a
// desktop's reel, with its main column made a fixed full-screen viewer.
//
// THE STAGE IS THE SAME BOX FOR A REEL AND A SHORT ON A DESKTOP. A shared link does not know which it
// is until the row lands, and a stage that changed height then would shove the page. The Short sits
// centered in it.
//
// NEXT AND PREVIOUS REPLACE THE HISTORY ENTRY. Back from the eighth clip in a row returns to the shelf
// the reader came from, not to the seventh clip.

const STAGE_MAX_HEIGHT = '76vh'
const QUEUE_SHOWN = 15
const AUTOPLAY_KEY = 'sdWatchAutoplay'
/** How far a finger must travel along the viewer's bottom strip to count as a swipe. */
const SWIPE_PX = 50

function readAutoplay(): boolean {
  try { return localStorage.getItem(AUTOPLAY_KEY) !== '0' } catch { return true }
}

function moveTo(video: WpblVideo, queue: WpblVideo[]) {
  // The list goes with the move even when it was only a default: a default is worked out from the
  // video on screen, so recomputing it after each hop would make Previous lead somewhere other than
  // where the reader just was. A popstate, as `navigate` sends, because that is what tells the shell
  // the path moved.
  const state = { ...window.history.state, watchQueue: queue.map(v => v.video_id) }
  window.history.replaceState(state, '', wpblWatchVideoPath(video.video_id))
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export default function WatchVideoPage({ videoId, videos, games, teams, onOpenGame, onNavigate, onOpened }: {
  videoId: string
  /** The list this reader can play, or null while it loads. */
  videos: WpblVideo[] | null
  games: WpblGame[]
  teams: WpblTeam[]
  onOpenGame: (g: WpblGame, ctx: { teams: WpblTeam[]; games: WpblGame[] }) => void
  onNavigate: (to: string) => void
  /** Clears the video's New marker on the shelf. */
  onOpened: (v: WpblVideo) => void
}) {
  const phone = usePhoneLayout()
  const panelOpen = useSidePanelOpen()
  const headingTag = useWpblHeadingTag()
  const { tags, ready: tagsReady } = useClipTags()
  const [players, setPlayers] = useState<WpblPlayer[]>(() => getCachedWpblAllPlayers() ?? [])
  const [autoplay, setAutoplay] = useState(readAutoplay)
  const [shared, setShared] = useState(false)
  // A video the list does not hold is blocked in this country or gone. Only asked when it is missing.
  const [absent, setAbsent] = useState<{ id: string; title: string | null } | null>(null)

  useEffect(() => {
    let live = true
    fetchWpblAllPlayers().then(p => { if (live) setPlayers(p) }).catch(() => { /* no names to link */ })
    return () => { live = false }
  }, [])

  const video = useMemo(() => videos?.find(v => v.video_id === videoId) ?? null, [videos, videoId])
  useEffect(() => {
    if (!videos || video) return
    let live = true
    fetchWpblVideoRow(videoId)
      .then(row => { if (live) setAbsent({ id: videoId, title: row?.video.title ?? null }) })
      .catch(() => { if (live) setAbsent({ id: videoId, title: null }) })
    return () => { live = false }
  }, [videos, video, videoId])

  const queue = useMemo(() => (video && videos ? resolveQueue(video, videos, window.history.state?.watchQueue) : []), [video, videos])
  const at = video ? queue.findIndex(v => v.video_id === video.video_id) : -1
  const prev = at > 0 ? queue[at - 1] : null
  const next = at >= 0 && at < queue.length - 1 ? queue[at + 1] : null

  // Recorded here rather than on the card, so a shared link and an advance count as well. `how` is
  // set by whatever moved the page, and a landing with none came from outside.
  const how = useRef<string | null>(window.history.state?.watchFrom ? 'watch' : 'link')
  const counted = useRef<string | null>(null)
  useEffect(() => {
    if (!video || counted.current === video.video_id) return
    counted.current = video.video_id
    track(EVENTS.WPBL_HIGHLIGHT_PLAYED, { videoId: video.video_id, kind: video.is_short === true ? 'clip' : video.kind, from: how.current ?? 'watch' })
    onOpened(video)
  }, [video, onOpened])
  const advance = (v: WpblVideo | null, why: string) => {
    if (!v) return
    how.current = why
    moveTo(v, queue)
  }

  const touch = useRef<{ x: number; y: number } | null>(null)
  const mainBox = useRef<HTMLDivElement>(null)
  const heldBox = useRef<HTMLDivElement>(null)
  const inFlowHeight = useRef(0)
  const vertical = video?.is_short === true
  const viewer = phone && vertical
  // Measured on every render out of the viewer, and written straight to the element on the way in, so
  // nothing renders twice for it.
  useLayoutEffect(() => {
    if (viewer) { if (heldBox.current) heldBox.current.style.height = `${inFlowHeight.current}px` }
    else if (mainBox.current) inFlowHeight.current = mainBox.current.getBoundingClientRect().height
  })
  // A fixed viewer over a page that can still scroll underneath it drags the page along with a swipe.
  useEffect(() => {
    if (!viewer) return
    const root = document.documentElement
    const was = root.style.overflow
    root.style.overflow = 'hidden'
    return () => { root.style.overflow = was }
  }, [viewer])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The box score or a player panel opened over this page has the keys while it is up.
      if (panelOpen) return
      const to = e.key === 'ArrowLeft' ? prev : e.key === 'ArrowRight' ? next : null
      if (!to) return
      e.preventDefault()
      how.current = 'pager'
      moveTo(to, queue)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [prev, next, queue, panelOpen])

  const tag = video ? tags.get(video.video_id) : undefined
  const gameId = video?.game_id ?? tag?.game_id ?? null
  const game = gameId ? games.find(g => g.id === gameId) : undefined
  const gameById = useMemo(() => new Map(games.map(g => [g.id, g])), [games])
  const teamById = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])
  const series = useMemo(() => seriesContexts(games, teamById), [games, teamById])
  const tagged = (tag?.player_ids ?? []).map(id => players.find(p => p.id === id)).filter((p): p is WpblPlayer => !!p)

  useEffect(() => {
    if (!video) return
    const path = wpblWatchVideoPath(video.video_id)
    const name = videoKindName(video)
    setDynamicSeo({
      path,
      seo: {
        title: `${video.title} | WPBL video | sportydolphin.fun`,
        description: `${name} from the Women's Pro Baseball League: ${video.title}.`,
        // A Short tied to no game, player or club is a social post ("Keep flying"), and a page that
        // says nothing but its title is thin. It still plays and shares; it just is not offered to
        // search. Only once the tags have answered, or every clip would flicker to noindex.
        noindex: vertical && tagsReady && !tag,
        jsonLd: {
          '@context': 'https://schema.org',
          '@type': 'VideoObject',
          name: video.title,
          description: `${name} from the Women's Pro Baseball League.`,
          thumbnailUrl: [`https://i.ytimg.com/vi/${video.video_id}/hqdefault.jpg`],
          uploadDate: video.published_at,
          embedUrl: `https://www.youtube-nocookie.com/embed/${video.video_id}`,
          ...(video.duration_seconds ? { duration: `PT${video.duration_seconds}S` } : null),
          ...(video.view_count != null ? {
            interactionStatistic: {
              '@type': 'InteractionCounter',
              interactionType: { '@type': 'WatchAction' },
              userInteractionCount: video.view_count,
            },
          } : null),
        },
      },
    })
    return () => setDynamicSeo(null)
  }, [video, vertical, tag, tagsReady])

  // Asks once the list has answered, so a video on its way is never reported as missing.
  if (videos && !video && absent?.id === videoId) {
    return (
      <Box sx={{ maxWidth: '40rem', mx: 'auto', py: 6, textAlign: 'center' }}>
        <Typography component={headingTag} sx={{ fontSize: TYPE_SCALE.heading, fontWeight: 800, mb: 0.5 }}>
          {absent.title ?? 'No video'}
        </Typography>
        {absent.title && <Typography sx={{ color: 'text.secondary', fontSize: TYPE_SCALE.body }}>Not available in your country</Typography>}
        <BackLink />
      </Box>
    )
  }

  const toggleAutoplay = () => {
    const on = !autoplay
    setAutoplay(on)
    try { localStorage.setItem(AUTOPLAY_KEY, on ? '1' : '0') } catch { /* lasts the visit */ }
    track(EVENTS.WPBL_PAGE_CONTROL, { page: 'watch', control: 'autoplay', value: on ? 'on' : 'off' })
  }
  const share = async () => {
    if (!video) return
    const url = `${window.location.origin}${wpblWatchVideoPath(video.video_id)}`
    track(EVENTS.WPBL_PAGE_CONTROL, { page: 'watch', control: 'share', value: video.video_id })
    try {
      if (phone && navigator.share) await navigator.share({ title: video.title, url })
      else {
        await navigator.clipboard.writeText(url)
        setShared(true)
        setTimeout(() => setShared(false), 2000)
      }
    } catch { /* the reader closed the share sheet */ }
  }

  const swipe = viewer ? {
    onTouchStart: (e: React.TouchEvent) => { touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY } },
    onTouchEnd: (e: React.TouchEvent) => {
      const from = touch.current
      touch.current = null
      if (!from) return
      const dx = e.changedTouches[0].clientX - from.x
      const dy = e.changedTouches[0].clientY - from.y
      const along = Math.abs(dy) > Math.abs(dx) ? dy : dx
      if (Math.abs(along) < SWIPE_PX) return
      advance(along < 0 ? next : prev, 'swipe')
    },
  } : null

  const credit = video ? videoCredit(video) : null
  const facts = video ? [videoDateLabel(video), formatDuration(video.duration_seconds), formatViews(video.view_count)].filter(Boolean).join(' · ') : ''
  const roundLabel = game && series.get(game.id) ? `${series.get(game.id)!.label}, Game ${series.get(game.id)!.gameNumber}` : null
  const fromLine = video?.is_short === true ? clipLabel(tag, gameById, teamById) : null
  const eyebrow = video ? [videoKindName(video), eventLabel(tag?.event_type)].filter(Boolean).join(' · ') : null

  return (
    <Box sx={{ maxWidth: '90rem', mx: 'auto', px: { xs: 0, sm: 3 }, pb: 6, ...panelShiftSx(panelOpen, '90rem') }}>
      <Box sx={{
        display: 'grid', columnGap: 3, alignItems: 'start',
        gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: `minmax(0, 1fr) ${chromePx(340)}` },
      }}>
        <Box ref={mainBox} sx={viewer
          ? { position: 'fixed', inset: 0, zIndex: 1200, bgcolor: 'background.default', display: 'flex', flexDirection: 'column', overscrollBehavior: 'contain' }
          : { minWidth: 0 }}>
          <BackLink viewer={viewer} shown={!!video} />
          <Box sx={viewer ? { flex: 1, minHeight: 0, bgcolor: '#000', display: 'flex', justifyContent: 'center' } : {
            // Pinned on a phone so the queue scrolls under a video still playing, and full-bleed
            // against the shell's 16px gutter.
            position: { xs: 'sticky', md: 'static' }, top: 'var(--app-header-h, 0px)', zIndex: 4,
            mx: { xs: -2, sm: 0 }, bgcolor: '#000', borderRadius: { xs: 0, sm: 2 }, overflow: 'hidden',
            width: { xs: 'auto', sm: '100%' }, aspectRatio: '16 / 9', maxHeight: STAGE_MAX_HEIGHT,
            display: 'flex', justifyContent: 'center',
          }}>
            <Box sx={{
              position: 'relative', height: '100%', maxWidth: '100%',
              ...(vertical ? { aspectRatio: '9 / 16' } : { width: '100%' }),
            }}>
              {video && <YouTubePlayer video={video} onEnded={autoplay && next ? () => advance(next, 'auto') : undefined} />}
            </Box>
          </Box>

          <Box {...swipe} sx={viewer
            ? { flexShrink: 0, px: 1.5, pt: 1, pb: 'calc(env(safe-area-inset-bottom, 0px) + 8px)' }
            : { mt: 1.5 }}>
            <Typography sx={{ fontSize: TYPE_SCALE.micro, fontWeight: 800, textTransform: 'uppercase', color: 'text.secondary' }}>
              {eyebrow ?? <TextGhost>Highlights</TextGhost>}
            </Typography>
            <Typography component={headingTag} sx={{
              mt: 0.25, fontSize: viewer ? TYPE_SCALE.body : TYPE_SCALE.heading, fontWeight: 800, lineHeight: 1.25,
              // Two lines, always, with room held for them: the title is the one string a shared link
              // cannot know until the row lands, and the league's run to three lines on a phone. The
              // date it would lose is in the line under it.
              minHeight: viewer ? undefined : '2.5em',
              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
            }}>
              {video?.title ?? <TextGhost>WPBL Highlights: Championship, Game 5</TextGhost>}
            </Typography>
            <Typography sx={{ mt: 0.25, fontSize: TYPE_SCALE.meta, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
              {video ? facts : <TextGhost>Sep 22 · 8:42 · 1K views</TextGhost>}
            </Typography>

            {/* Room for the usual two rows (the game and the credit, or a clip's source and players),
                in rem because they are type. Held while the row loads, so the buttons and the queue
                below stay put. flow-root so a first row's margin stays inside the room: collapsed out
                through it, that margin is 6px the empty box did not have. */}
            <Box sx={viewer ? undefined : { minHeight: '3.5rem', display: 'flow-root' }}>
            {!viewer && game && video?.is_short !== true && (
              <GameLine game={game} teamById={teamById} roundLabel={roundLabel}
                href={wpblGamePath(game, teams, games)} onOpen={() => onOpenGame(game, { teams, games })} />
            )}
            {(fromLine || (game && video?.is_short === true)) && (
              <Box sx={{ mt: 0.5, display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 1 }}>
                {fromLine && <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', fontWeight: 600 }}>From {fromLine}</Typography>}
                {game && (
                  <Box component="a" href={wpblGamePath(game, teams, games)}
                    onClick={(e: React.MouseEvent) => { if (!isModified(e)) { e.preventDefault(); onOpenGame(game, { teams, games }) } }}
                    sx={LINK_SX}>Box score ›</Box>
                )}
              </Box>
            )}
            {!viewer && tagged.length > 0 && (
              <Box sx={{ mt: 0.5, display: 'flex', flexWrap: 'wrap', columnGap: 1.25 }}>
                {tagged.map(p => {
                  const to = wpblPlayerPath(p, players)
                  return (
                    <Box key={p.id} component="a" href={to}
                      onClick={(e: React.MouseEvent) => { if (!isModified(e)) { e.preventDefault(); onNavigate(to) } }}
                      sx={LINK_SX}>{p.name} ›</Box>
                  )
                })}
              </Box>
            )}
            {credit && <Box sx={{ mt: 0.5 }}><VideoCreditLine credit={credit} what={video ? videoKindName(video) : 'Video'} /></Box>}
            </Box>

            {/* Hidden, not absent, until the row lands: a phone does not know yet whether this is a
                Short, whose buttons sit somewhere else entirely, and the room is the same either way. */}
            <Box sx={{ mt: 1, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1, visibility: video ? 'visible' : 'hidden' }}>
              <PagerButton label="Previous" glyph="‹" onClick={prev ? () => advance(prev, 'pager') : undefined} />
              <PagerButton label="Next" glyph="›" onClick={next ? () => advance(next, 'pager') : undefined} />
              <ActionButton onClick={toggleAutoplay} pressed={autoplay}>{`Autoplay: ${autoplay ? 'On' : 'Off'}`}</ActionButton>
              <ActionButton onClick={() => { void share() }}>{shared ? 'Link copied' : 'Share'}</ActionButton>
              {video && (
                <Box component="a" target="_blank" rel="noopener noreferrer"
                  href={vertical ? `https://www.youtube.com/shorts/${video.video_id}` : `https://www.youtube.com/watch?v=${video.video_id}`}
                  onClick={() => track(EVENTS.WPBL_HIGHLIGHT_YOUTUBE, { videoId: video.video_id })}
                  sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', textDecoration: 'none', ...hoverOnly({ textDecoration: 'underline' }), ...FOCUS_RING }}>
                  YouTube ↗
                </Box>
              )}
            </Box>
          </Box>
        </Box>

        {/* The viewer is out of the flow, so what it took from the page is held here: without it the
            footer under the viewer jumps up the moment a shared link turns out to be a Short. */}
        {viewer && <Box ref={heldBox} aria-hidden />}
        <Box component="section" aria-label="Up next" sx={{ mt: { xs: 2.5, md: 0 }, minWidth: 0, visibility: viewer ? 'hidden' : 'visible' }}>
          <Typography component="h2" sx={{ fontSize: TYPE_SCALE.micro, fontWeight: 800, textTransform: 'uppercase', color: 'text.secondary', mb: 1 }}>
            Up next
          </Typography>
          <Box sx={{ display: 'grid', gap: 1 }}>
            {video
              ? queue.slice(at + 1, at + 1 + QUEUE_SHOWN).map(v => <QueueRow key={v.video_id} video={v} onPick={() => advance(v, 'queue')} />)
              : Array.from({ length: QUEUE_SHOWN }, (_, i) => <QueueRow key={i} />)}
          </Box>
        </Box>
      </Box>
    </Box>
  )
}

const LINK_SX = {
  fontSize: TYPE_SCALE.meta, fontWeight: 800, color: 'var(--wpbl-accent-fg)', textDecoration: 'none',
  ...hoverOnly({ textDecoration: 'underline' }), ...FOCUS_RING,
} as const

/** Back to where the reader came from, or to the shelf from a link opened cold. */
function BackLink({ viewer, shown = true }: { viewer?: boolean; shown?: boolean }) {
  return (
    <Box component="a" href={WPBL_WATCH_PAGE}
      onClick={(e: React.MouseEvent) => { if (!isModified(e)) { e.preventDefault(); navBack(WPBL_WATCH_PAGE) } }}
      sx={{
        display: 'inline-flex', alignItems: 'center', alignSelf: 'flex-start', minHeight: 40,
        visibility: shown ? 'visible' : 'hidden',
        color: 'text.secondary', fontSize: TYPE_SCALE.body, fontWeight: 700, textDecoration: 'none',
        ...(viewer ? { px: 1.5, pt: 'env(safe-area-inset-top, 0px)' } : { mb: { xs: 0.5, sm: 1 } }),
        ...hoverOnly({ color: 'text.primary' }), ...FOCUS_RING,
      }}>‹ Watch</Box>
  )
}

function ActionButton({ children, onClick, pressed }: { children: React.ReactNode; onClick: () => void; pressed?: boolean }) {
  return (
    <Box component="button" type="button" onClick={onClick} aria-pressed={pressed} sx={{
      px: 1.25, py: 0.5, borderRadius: 999, border: '1px solid', borderColor: 'outline', cursor: 'pointer',
      bgcolor: 'background.paper', color: 'text.primary', font: 'inherit', fontSize: TYPE_SCALE.meta, fontWeight: 700,
      '@media (pointer: coarse)': { minHeight: 44, px: 1.5 },
      ...hoverOnly({ borderColor: 'text.secondary' }), ...FOCUS_RING,
    }}>{children}</Box>
  )
}

/** The game a video is of: the score, the round and the way to its box score. */
function GameLine({ game, teamById, roundLabel, href, onOpen }: {
  game: WpblGame; teamById: Map<string, WpblTeam>; roundLabel: string | null; href: string; onOpen: () => void
}) {
  const side = (id: string, score: number | null, won: boolean) => {
    const team = teamById.get(id)
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        {team && <TeamBadge team={team} size={20} />}
        <Typography sx={{ fontSize: TYPE_SCALE.body, fontWeight: won ? 800 : 600, color: won ? 'text.primary' : 'text.secondary' }}>{team?.abbr ?? id}</Typography>
        {score != null && <Typography sx={{ fontSize: TYPE_SCALE.body, fontWeight: 800, color: won ? 'text.primary' : 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>{score}</Typography>}
      </Box>
    )
  }
  const scored = game.away_score != null && game.home_score != null
  return (
    <Box sx={{ mt: 0.75, display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: 1 }}>
      {side(game.away_team_id, game.away_score, scored && game.away_score! > game.home_score!)}
      <Typography sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 700, color: 'text.secondary' }}>@</Typography>
      {side(game.home_team_id, game.home_score, scored && game.home_score! > game.away_score!)}
      {roundLabel && <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary' }}>{roundLabel}</Typography>}
      <Box component="a" href={href}
        onClick={(e: React.MouseEvent) => { if (!isModified(e)) { e.preventDefault(); onOpen() } }}
        sx={LINK_SX}>Box score ›</Box>
    </Box>
  )
}

/** One video in the queue, or its empty shape while the list loads. The credit is plain text here
 *  rather than VideoCreditLine's link, because the whole row is already a link. */
function QueueRow({ video, onPick }: { video?: WpblVideo; onPick?: () => void }) {
  const credit = video ? videoCredit(video) : null
  const inner = (
    <>
      <Box sx={{ width: chromePx(128), flexShrink: 0, borderRadius: 1.5, overflow: 'hidden', position: 'relative' }}>
        {video ? <VideoThumb video={video} badge={24} /> : <Box sx={{ width: '100%', aspectRatio: '16 / 9', bgcolor: 'action.hover' }} />}
      </Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography sx={{
          fontSize: TYPE_SCALE.meta, fontWeight: 700, lineHeight: 1.25,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>{video?.title ?? <TextGhost>WPBL Highlights: Championship, Game 5</TextGhost>}</Typography>
        <Typography sx={{ mt: 0.25, fontSize: TYPE_SCALE.micro, fontWeight: 700, color: 'text.secondary' }}>
          {video ? [videoKindName(video), videoDateLabel(video)].join(' · ') : <TextGhost>Highlights · Sep 22</TextGhost>}
        </Typography>
        {credit && <Typography sx={{ fontSize: TYPE_SCALE.micro, color: 'text.secondary' }}>{credit.name}</Typography>}
      </Box>
    </>
  )
  const row = { display: 'flex', gap: 1, alignItems: 'center', minWidth: 0 } as const
  if (!video) return <Box sx={row}>{inner}</Box>
  return (
    <Box component="a" href={wpblWatchVideoPath(video.video_id)}
      onClick={(e: React.MouseEvent) => { if (!isModified(e)) { e.preventDefault(); onPick?.() } }}
      sx={{ ...row, color: 'inherit', textDecoration: 'none', borderRadius: 1.5, ...hoverOnly({ bgcolor: 'action.hover' }), ...FOCUS_RING }}>
      {inner}
    </Box>
  )
}
