import { useMemo } from 'react'
import { Box, Typography } from '@mui/material'
import { CARD_BORDER, CARD_FILL, FOCUS_RING, NewTag, TeamBadge, TextGhost, TYPE_SCALE, chromePx, hoverOnly } from '../ui'
import { VideoCreditLine, VideoThumb, PLAYABLE_HOVER, videoDateLabel } from '../Highlights'
import { formatDuration, formatViews, gameVideos, videoCredit, videoKindName, watchShelves } from '../videoChannels'
import { seriesContexts } from '../derive/series'
import { CARD_LINK, GroupHeading, PosterTile, Rail, videoLink } from './parts'
import { continueWatching, featuredVideo, splitClips } from './shelves'
import { useStartedVideos } from './progress'
import type { WpblGame, WpblTeam, WpblVideo, WpblVideoTag } from '../types'

// The top of /wpbl/watch: one video to press play on, then a row of each kind of thing to watch, each
// a taste of its own shelf. It is the first thing a reader sees here, and until Oct 30, 2026 that was
// three rows of filter chips over forty near-identical game cards.
//
// DRAWN EMPTY FROM THE SAME COMPONENTS while the videos load, rather than from a skeleton of its own:
// `videos` null is every tile in its empty shape (CLAUDE.md, loading states). Continue watching is
// known before the read, from this browser's own store, so it holds its row from the first frame.

const RAIL_LENGTH = 12
const GHOST_TILES = 8

export type WatchFrontShelf = 'games' | 'plays' | 'clips' | 'features' | 'podcast'

export default function WatchFront({ videos, games, teams, tags, tagsReady, isNew, shelfHref, onPickShelf }: {
  videos: WpblVideo[] | null
  games: WpblGame[]
  teams: WpblTeam[]
  tags: Map<string, WpblVideoTag>
  tagsReady: boolean
  isNew: (v: WpblVideo) => boolean
  shelfHref: (s: WatchFrontShelf) => string
  onPickShelf: (s: WatchFrontShelf) => void
}) {
  const all = useMemo(() => videos ?? [], [videos])
  const started = useStartedVideos()
  const shelves = useMemo(() => watchShelves(all), [all])
  // Read once per list: the page does not need the clock to move under a reader looking at it.
  const featured = useMemo(() => (videos ? featuredVideo(videos, Date.now()) : null), [videos])
  const resume = useMemo(() => (videos ? continueWatching(videos, started) : null), [videos, started])
  const { plays } = useMemo(() => splitClips(shelves.clips, tags), [shelves.clips, tags])
  const teamById = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])
  const series = useMemo(() => seriesContexts(games, teamById), [games, teamById])
  const recentGames = useMemo(() => {
    const byId = new Map(games.map(g => [g.id, g]))
    return shelves.gameIds
      .map(id => byId.get(id))
      .filter((g): g is WpblGame => !!g)
      .sort((a, b) => b.game_date.localeCompare(a.game_date) || b.id.localeCompare(a.id))
      .slice(0, RAIL_LENGTH)
  }, [shelves.gameIds, games])
  const compilations = useMemo(() => shelves.more.filter(v => v.kind === 'compilation'), [shelves.more])
  const podcast = useMemo(() => shelves.more.filter(v => v.kind === 'podcast'), [shelves.more])

  const ghosts = (vertical?: boolean) => Array.from({ length: GHOST_TILES }, (_, i) => <PosterTile key={i} vertical={vertical} />)
  const all_ = (s: WatchFrontShelf) => ({ href: shelfHref(s), go: () => onPickShelf(s) })
  const tiles = (list: WpblVideo[]) => {
    const ids = list.map(v => v.video_id)
    return list.slice(0, RAIL_LENGTH).map(v => <PosterTile key={v.video_id} video={v} queue={ids} isNew={isNew(v)} />)
  }
  const loading = videos == null

  return (
    <>
      <Featured video={featured} isNew={featured ? isNew(featured) : false} />
      {/* The row is held from the store while the list loads, and goes if the list then has none of
          them: a video the league has pulled, which is rare enough to be worth a jump. */}
      {(resume ? resume.length > 0 : started.length > 0) && (
        <Rail title="Continue watching" label="videos to continue" count={resume?.length ?? 0}>
          {resume ? resume.slice(0, RAIL_LENGTH).map(v => <PosterTile key={v.video_id} video={v} />) : ghosts()}
        </Rail>
      )}
      <Rail title="Latest" label="latest videos" count={all.length}>
        {/* Tall ghosts: the league posts Shorts most, so one is always in the row and sets its height. */}
        {loading ? ghosts(true) : all.slice(0, RAIL_LENGTH).map(v => <PosterTile key={v.video_id} video={v} isNew={isNew(v)} />)}
      </Rail>
      <Rail title="Games" label="games" count={recentGames.length} onAll={all_('games')}>
        {loading ? ghosts(false) : recentGames.map(g => (
          <GameTile key={g.id} game={g} videos={all} teamById={teamById} isNew={isNew}
            roundLabel={series.get(g.id) ? `${series.get(g.id)!.label}, Game ${series.get(g.id)!.gameNumber}` : null} />
        ))}
      </Rail>
      {(loading || !tagsReady || plays.length > 0) && (
        <Rail title="Plays" label="plays" count={plays.length} onAll={all_('plays')}>
          {loading || !tagsReady ? ghosts(true) : (
            plays.slice(0, RAIL_LENGTH).map(v => {
              const team = teamById.get(tags.get(v.video_id)?.team_id ?? '')
              return <PosterTile key={v.video_id} video={v} isNew={isNew(v)} queue={plays.map(p => p.video_id)}
                badge={team && <TeamBadge team={team} size={20} />} />
            })
          )}
        </Rail>
      )}
      {(loading || compilations.length > 0) && (
        <Rail title="Season compilations" label="compilations" count={compilations.length} onAll={all_('features')}>
          {loading ? ghosts(false) : tiles(compilations)}
        </Rail>
      )}
      {(loading || podcast.length > 0) && (
        <Rail title="Podcast" label="podcast episodes" count={podcast.length} onAll={all_('podcast')}>
          {loading ? ghosts(false) : tiles(podcast)}
        </Rail>
      )}
    </>
  )
}

/** The one video at the top: side by side on a desktop, stacked and full-bleed on a phone. */
function Featured({ video, isNew }: { video: WpblVideo | null; isNew: boolean }) {
  const credit = video ? videoCredit(video) : null
  const facts = video ? [videoDateLabel(video), formatDuration(video.duration_seconds), formatViews(video.view_count)].filter(Boolean).join(' · ') : null
  return (
    <Box component="section" aria-label="Featured" sx={{
      display: 'grid', columnGap: 2, alignItems: 'center',
      gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 2fr) minmax(0, 1fr)' },
    }}>
      <Box sx={{ position: 'relative', borderRadius: { xs: 0, sm: 2 }, overflow: 'hidden', mx: { xs: 'calc(50% - 50vw)', sm: 0 } }}>
        {video ? (
          <Box {...videoLink(video)} aria-label={`Play: ${video.title}`} sx={{ ...CARD_LINK, ...PLAYABLE_HOVER, ...FOCUS_RING }}>
            <VideoThumb video={video} badge={56} sizes="(max-width: 899px) 100vw, 800px" />
            {isNew && <NewTag />}
          </Box>
        ) : <Box sx={{ width: '100%', aspectRatio: '16 / 9', bgcolor: 'action.hover' }} />}
      </Box>
      <Box sx={{ mt: { xs: 1, md: 0 }, minWidth: 0 }}>
        <GroupHeading>{video ? videoKindName(video) : <TextGhost>Compilation</TextGhost>}</GroupHeading>
        <Typography component="h2" sx={{ fontSize: TYPE_SCALE.heading, fontWeight: 800, lineHeight: 1.25 }}>
          {video?.title ?? <TextGhost>The Entire WPBL Season in 19 Minutes</TextGhost>}
        </Typography>
        <Typography sx={{ mt: 0.25, fontSize: TYPE_SCALE.meta, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
          {facts ?? <TextGhost>Sep 22 · 19:10 · 146 views</TextGhost>}
        </Typography>
        {video ? (
          credit && <Box sx={{ mt: 0.25 }}><VideoCreditLine credit={credit} /></Box>
        ) : <Typography sx={{ mt: 0.25, fontSize: TYPE_SCALE.meta, lineHeight: 1.3 }}><TextGhost>Video: WPBL from Day 1</TextGhost></Typography>}
        {video ? (
          <Box {...videoLink(video)} sx={{
            mt: 1, display: 'inline-flex', alignItems: 'center', gap: 0.5, px: 1.5, py: 0.6, borderRadius: 999,
            border: '1px solid', borderColor: 'outline', bgcolor: 'background.paper', color: 'text.primary',
            fontSize: TYPE_SCALE.body, fontWeight: 700, textDecoration: 'none',
            '@media (pointer: coarse)': { minHeight: 44 },
            ...hoverOnly({ borderColor: 'text.secondary' }), ...FOCUS_RING,
          }}><Box component="span" aria-hidden sx={{ fontSize: TYPE_SCALE.caption }}>▶</Box>Play</Box>
        ) : (
          <Box sx={{ mt: 1, display: 'inline-flex', px: 1.5, py: 0.6, fontSize: TYPE_SCALE.body, '@media (pointer: coarse)': { minHeight: 44 } }}><TextGhost>▶ Play</TextGhost></Box>
        )}
      </Box>
    </Box>
  )
}

/** A game in the rail: its first video's poster, and the score under it. */
function GameTile({ game, videos, teamById, roundLabel, isNew }: {
  game: WpblGame; videos: WpblVideo[]; teamById: Map<string, WpblTeam>; roundLabel: string | null; isNew: (v: WpblVideo) => boolean
}) {
  const list = gameVideos(videos, game.id).filter(v => v.is_short !== true)
  const first = list[0]
  const credit = first ? videoCredit(first) : null
  const scored = game.away_score != null && game.home_score != null
  const date = new Date(`${game.game_date}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' })
  const side = (id: string, score: number | null, won: boolean) => {
    const team = teamById.get(id)
    const ink = won ? 'text.primary' : 'text.secondary'
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        {team && <TeamBadge team={team} size={20} />}
        <Typography sx={{ fontSize: TYPE_SCALE.meta, fontWeight: won ? 800 : 600, color: ink }}>{team?.abbr ?? id}</Typography>
        {score != null && <Typography sx={{ fontSize: TYPE_SCALE.body, fontWeight: 800, color: ink, fontVariantNumeric: 'tabular-nums' }}>{score}</Typography>}
      </Box>
    )
  }
  if (!first) return null
  return (
    <Box sx={{
      flexShrink: 0, width: chromePx(280), minWidth: 0, scrollSnapAlign: 'start', borderRadius: 2,
      border: '1px solid', borderColor: CARD_BORDER, bgcolor: CARD_FILL, overflow: 'hidden', ...PLAYABLE_HOVER,
    }}>
      <Box {...videoLink(first)} aria-label={`Play ${videoKindName(first).toLowerCase()}: ${first.title}`} sx={{ ...CARD_LINK, ...FOCUS_RING }}>
        <Box sx={{ position: 'relative' }}>
          <VideoThumb video={first} badge={34} />
          {list.some(isNew) && <NewTag />}
        </Box>
        <Box sx={{ px: 1, pt: 0.75, pb: credit ? 0 : 0.75 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            {side(game.away_team_id, game.away_score, scored && game.away_score! > game.home_score!)}
            <Typography sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 700, color: 'text.secondary' }}>@</Typography>
            {side(game.home_team_id, game.home_score, scored && game.home_score! > game.away_score!)}
          </Box>
          <Typography sx={{ mt: 0.25, fontSize: TYPE_SCALE.micro, fontWeight: 700, color: 'text.secondary' }}>
            {roundLabel ? `${date} · ${roundLabel}` : date}
          </Typography>
        </Box>
      </Box>
      {credit && <Box sx={{ px: 1, pb: 0.75 }}><VideoCreditLine credit={credit} /></Box>}
    </Box>
  )
}
