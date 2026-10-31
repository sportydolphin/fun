import { useMemo } from 'react'
import { Box, Typography } from '@mui/material'
import { CARD_BORDER, CARD_FILL, FOCUS_RING, NewTag, TeamBadge, TextGhost, TYPE_SCALE, chromePx, hoverOnly } from '../ui'
import { VideoCreditLine, VideoThumb, PLAYABLE_HOVER, videoDateLabel } from '../Highlights'
import { formatDuration, formatViews, videoCredit, videoKindName, watchShelves } from '../videoChannels'
import { seriesContexts } from '../derive/series'
import { CARD_LINK, GroupHeading, PlayerTile, PosterTile, Rail, videoLink } from './parts'
import { clipsOfEvent, continueWatching, featuredVideo, playersWithClips } from './shelves'
import { useWatchRankings } from './useWatchRankings'
import type { BestGame } from './rankings'
import { useStartedVideos } from './progress'
import type { WpblGame, WpblPlayer, WpblTeam, WpblVideo, WpblVideoTag } from '../types'

// The top of /wpbl/watch: one video to press play on, then a row of each kind of thing to watch, each
// a taste of its own shelf. It is the first thing a reader sees here, and until Oct 30, 2026 that was
// three rows of filter chips over forty near-identical game cards.
//
// DRAWN EMPTY FROM THE SAME COMPONENTS while the videos load, rather than from a skeleton of its own:
// `videos` null is every tile in its empty shape (CLAUDE.md, loading states). Continue watching is
// known before the read, from this browser's own store, so it holds its row from the first frame.
//
// BEST GAMES AND BIGGEST PLAYS ARE WHAT NO VIDEO SITE CAN SHOW: what a game or a play did to win
// probability, from this league's own play log. They load when a reader comes near (useWatchRankings).

const RAIL_LENGTH = 12
const GHOST_TILES = 8
const HOME_RUN = 'home_run'

export type WatchFrontShelf = 'games' | 'plays' | 'clips' | 'players' | 'features' | 'podcast'

export default function WatchFront({ videos, games, teams, players, tags, tagsReady, isNew, shelfHref, onPickShelf, playerHref, onPickPlayer }: {
  videos: WpblVideo[] | null
  games: WpblGame[]
  teams: WpblTeam[]
  players: WpblPlayer[]
  tags: Map<string, WpblVideoTag>
  tagsReady: boolean
  isNew: (v: WpblVideo) => boolean
  /** `sub` narrows the shelf: a kind of play on Plays. */
  shelfHref: (s: WatchFrontShelf, sub?: string) => string
  onPickShelf: (s: WatchFrontShelf, sub?: string) => void
  playerHref: (p: WpblPlayer) => string
  onPickPlayer: (p: WpblPlayer) => void
}) {
  const all = useMemo(() => videos ?? [], [videos])
  const started = useStartedVideos()
  const shelves = useMemo(() => watchShelves(all), [all])
  // Read once per list: the page does not need the clock to move under a reader looking at it.
  const featured = useMemo(() => (videos ? featuredVideo(videos, Date.now()) : null), [videos])
  const resume = useMemo(() => (videos ? continueWatching(videos, started) : null), [videos, started])
  const homeRuns = useMemo(() => clipsOfEvent(shelves.clips, tags, HOME_RUN), [shelves.clips, tags])
  const inClips = useMemo(() => playersWithClips(shelves.clips, tags, players), [shelves.clips, tags, players])
  const teamById = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])
  const series = useMemo(() => seriesContexts(games, teamById), [games, teamById])
  const compilations = useMemo(() => shelves.more.filter(v => v.kind === 'compilation'), [shelves.more])
  const podcast = useMemo(() => shelves.more.filter(v => v.kind === 'podcast'), [shelves.more])
  const { sentinel, rankings, failed } = useWatchRankings(videos, shelves.clips, games, tags, tagsReady)

  const ghosts = (vertical?: boolean, footerRoom?: boolean) =>
    Array.from({ length: GHOST_TILES }, (_, i) => <PosterTile key={i} vertical={vertical} footerRoom={footerRoom} />)
  const onAll = (s: WatchFrontShelf, sub?: string) => ({ href: shelfHref(s, sub), go: () => onPickShelf(s, sub) })
  const tiles = (list: WpblVideo[]) => {
    const ids = list.map(v => v.video_id)
    return list.slice(0, RAIL_LENGTH).map(v => <PosterTile key={v.video_id} video={v} queue={ids} isNew={isNew(v)} />)
  }
  const loading = videos == null
  const clubBadge = (v: WpblVideo) => {
    const team = teamById.get(tags.get(v.video_id)?.team_id ?? '')
    return team && <TeamBadge team={team} size={20} />
  }

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
      <div ref={sentinel} />
      {/* Both ranked rows hold their room until the model answers, and go if it never does. */}
      {!failed && (!rankings || rankings.bestGames.length > 0) && (
        <Rail title="Best games" info="Games ranked by every swing in win probability, added up. Scores stay off this row."
          label="best games" count={rankings?.bestGames.length ?? 0} onAll={onAll('games')}>
          {rankings
            ? rankings.bestGames.slice(0, RAIL_LENGTH).map(b => (
              <BestGameTile key={b.game.id} best={b} teamById={teamById} queue={rankings.bestGames.map(x => x.video.video_id)} isNew={isNew(b.video)}
                roundLabel={series.get(b.game.id) ? `${series.get(b.game.id)!.label}, Game ${series.get(b.game.id)!.gameNumber}` : null} />
            ))
            : Array.from({ length: GHOST_TILES }, (_, i) => <BestGameTile key={i} />)}
        </Rail>
      )}
      {(loading || !tagsReady || homeRuns.length > 0) && (
        <Rail title="Home runs" label="home runs" count={homeRuns.length} onAll={onAll('plays', HOME_RUN)}>
          {loading || !tagsReady ? ghosts(true) : homeRuns.slice(0, RAIL_LENGTH).map(v => (
            <PosterTile key={v.video_id} video={v} isNew={isNew(v)} queue={homeRuns.map(h => h.video_id)} badge={clubBadge(v)} />
          ))}
        </Rail>
      )}
      {!failed && (!rankings || rankings.biggestPlays.length > 0) && (
        <Rail title="Biggest plays" info="Clips of a single play, ranked by how far that play moved win probability."
          label="biggest plays" count={rankings?.biggestPlays.length ?? 0} onAll={onAll('plays')}>
          {rankings
            ? rankings.biggestPlays.slice(0, RAIL_LENGTH).map(c => (
              <PosterTile key={c.video.video_id} video={c.video} isNew={isNew(c.video)} footerRoom badge={clubBadge(c.video)}
                queue={rankings.biggestPlays.map(x => x.video.video_id)}
                footer={c.label ? `${c.points}-point swing. ${c.label}` : `${c.points}-point swing`} />
            ))
            : ghosts(true, true)}
        </Rail>
      )}
      {(loading || compilations.length > 0) && (
        <Rail title="Season compilations" label="compilations" count={compilations.length} onAll={onAll('features')}>
          {loading ? ghosts(false) : tiles(compilations)}
        </Rail>
      )}
      {(loading || !tagsReady || players.length === 0 || inClips.length > 0) && (
        <Rail title="Players" label="players" count={inClips.length} onAll={onAll('players')}>
          {loading || !tagsReady || players.length === 0
            ? Array.from({ length: GHOST_TILES }, (_, i) => <PlayerTile key={i} />)
            : inClips.slice(0, RAIL_LENGTH).map(({ player, count }) => (
              <PlayerTile key={player.id} player={player} count={count} href={playerHref(player)} onPick={() => onPickPlayer(player)} />
            ))}
        </Rail>
      )}
      {(loading || podcast.length > 0) && (
        <Rail title="Podcast" label="podcast episodes" count={podcast.length} onAll={onAll('podcast')}>
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

/** A game worth watching: the poster, who played and when, and what kind of game it was. No score. */
function BestGameTile({ best, teamById, roundLabel, queue, isNew }: {
  best?: BestGame; teamById?: Map<string, WpblTeam>; roundLabel?: string | null; queue?: string[]; isNew?: boolean
}) {
  const outer = {
    flexShrink: 0, width: chromePx(280), minWidth: 0, scrollSnapAlign: 'start', borderRadius: 2,
    border: '1px solid', borderColor: CARD_BORDER, bgcolor: CARD_FILL, overflow: 'hidden', ...PLAYABLE_HOVER,
  } as const
  const lines = { px: 1, pt: 0.75, pb: 0.75 } as const
  const factsSx = { mt: 0.25, minHeight: '1.1rem', fontSize: TYPE_SCALE.micro, fontWeight: 700, color: 'text.secondary' } as const
  const dateSx = { mt: 0.25, fontSize: TYPE_SCALE.micro, fontWeight: 700, color: 'text.secondary' } as const
  const row = { display: 'flex', alignItems: 'center', gap: 0.5, minHeight: chromePx(20) } as const
  if (!best) {
    return (
      <Box sx={outer}>
        <Box sx={{ width: '100%', aspectRatio: '16 / 9', bgcolor: 'action.hover' }} />
        <Box sx={lines}>
          <Box sx={row}><Typography sx={{ fontSize: TYPE_SCALE.meta }}><TextGhost>LA @ SF</TextGhost></Typography></Box>
          <Typography sx={dateSx}><TextGhost>Sep 22 · Championship, Game 5</TextGhost></Typography>
          <Typography sx={factsSx}><TextGhost>3 lead changes</TextGhost></Typography>
        </Box>
      </Box>
    )
  }
  const { game, video, facts } = best
  const date = new Date(`${game.game_date}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' })
  const side = (id: string) => {
    const team = teamById?.get(id)
    return (
      <>
        {team && <TeamBadge team={team} size={20} />}
        <Typography sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 800 }}>{team?.abbr ?? id}</Typography>
      </>
    )
  }
  const credit = videoCredit(video)
  return (
    <Box sx={outer}>
      <Box {...videoLink(video, queue)} aria-label={`Play ${videoKindName(video).toLowerCase()}: ${video.title}`} sx={{ ...CARD_LINK, ...FOCUS_RING }}>
        <Box sx={{ position: 'relative' }}>
          <VideoThumb video={video} badge={34} />
          {isNew && <NewTag />}
        </Box>
        <Box sx={{ ...lines, pb: credit ? 0 : 0.75 }}>
          <Box sx={row}>
            {side(game.away_team_id)}
            <Typography sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 700, color: 'text.secondary', mx: 0.25 }}>@</Typography>
            {side(game.home_team_id)}
          </Box>
          <Typography sx={dateSx}>{roundLabel ? `${date} · ${roundLabel}` : date}</Typography>
          <Typography sx={factsSx}>{facts}</Typography>
        </Box>
      </Box>
      {credit && <Box sx={{ px: 1, pb: 0.75 }}><VideoCreditLine credit={credit} /></Box>}
    </Box>
  )
}
