import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Box, Typography, Skeleton } from '@mui/material'
import WpblPage from './WpblPage'
import { FilterChip, FilterSelect } from '../ui/FilterChip'
import { CARD_BORDER, CARD_FILL, FOCUS_RING, TYPE_SCALE, TeamBadge, hoverOnly, NewTag, TextGhost, chromePx } from './ui'
import { WPBL_TEAMS } from './constants'
import { fetchWpblAllPlayers, fetchWpblSchedule, fetchWpblTeams, fetchWpblVideos, getCachedWpblAllPlayers, getCachedWpblSchedule, getCachedWpblTeams, getCachedWpblVideos } from './api'
import { countsInStandings } from './season'
import { seriesContexts } from './derive/series'
import { WPBL_WATCH_PAGE, findWpblPlayerBySlug, wpblGamePath, wpblPlayerPath, wpblPlayerSlug, wpblWatchVideoIdFromPath } from './routes'
import { gameVideos, watchShelves, videoCredit, videoKindName, MORE_GROUPS } from './videoChannels'
import { VideoThumb, VideoCreditLine, PLAYABLE_HOVER, videoDateLabel } from './Highlights'
import { ClipCaption, useClipTags } from './Watch'
import WatchVideoPage from './WatchVideoPage'
import WatchFront from './watch/WatchFront'
import { setHideScores, useHideScores } from './watch/hideScores'
import { CARD_LINK, GroupHeading, PlayerTile, videoLink } from './watch/parts'
import { clipEvents, clipsOfEvent, clipsOfPlayer, eventLabel, playersWithClips, splitClips } from './watch/shelves'
import { track, EVENTS } from '../lib/analytics'
import type { WpblGame, WpblPlayer, WpblTeam, WpblVideo, WpblVideoTag } from './types'
import { useNewSince } from './newSince'
import { isModified } from '../nav'

// /wpbl/watch: every video the site mirrors, from the league's channel and from WPBL from Day 1.
//
//   Featured  the front page (watch/WatchFront.tsx): one video, then a row of each kind.
//   Games     one card per game, with a button for each video of it: the league's reel, the fan's
//             condensed game and the league's full broadcast, whichever exist and this reader's
//             country can play (the broadcasts are blocked in the US; see playableIn).
//   Plays     the Shorts from a game, newest first, played vertically.
//   Clips     the other Shorts: the draft, features, the offseason's social posts.
//   Players   everyone a clip's tag names, and each one's clips.
//   Features  season compilations, press conferences and everything else with no game.
//   Podcast   the league's weekly episodes.
//
// PLAYS AND CLIPS ARE SPLIT BY THE TAGS, not by anything in the title. No Short names its game, so the
// matcher (scripts/wpbl-clip-tags.mjs) places about a third of them. The split was one feed until
// Oct 30, 2026, which in the offseason meant ten screens of social posts over the season's home runs.
//
// THE SHELF IS THE HASH (#games, #plays, #clips, #players, #features, #podcast) so a link keeps its
// shelf, without a second route and a second rewrite. What narrows a shelf follows a slash, so the
// season's home runs (#plays/home_run) and one player's clips (#players/denae-benites) can be sent to
// someone. #more was the old name for Features, and a link carrying it still lands there. A shelf is
// written with replaceState, since switching shelves is not somewhere Back should step through; a
// player is pushed, because the list of players is somewhere Back should return to.
//
// NOTHING LOADS FROM YOUTUBE until a play: every card is a poster and the player mounts on the video's
// own page. WPBL from Day 1's videos are embedded with their permission and credited on every card
// that shows one (videoCredit), the same rule as the fan photographs.
//
// A VIDEO IS A PAGE OF ITS OWN (/wpbl/watch/<id>, WatchVideoPage), AND THE SHELVES STAY MOUNTED UNDER
// IT, hidden. Back from a video has to land on the same shelf, the same club filter, the same "Show
// more" and the same scroll, and all of that is state here. A reader who lands on a video cold has no
// shelf to come back to, so it is not drawn until they ask for it.

type Shelf = 'featured' | 'games' | 'plays' | 'clips' | 'players' | 'features' | 'podcast'

/** Whether a video is new to this reader. */
interface Fresh { isNew: (v: WpblVideo) => boolean }
const SHELVES: { key: Shelf; label: string }[] = [
  { key: 'featured', label: 'Featured' },
  { key: 'games', label: 'Games' },
  { key: 'plays', label: 'Plays' },
  { key: 'clips', label: 'Clips' },
  { key: 'players', label: 'Players' },
  { key: 'features', label: 'Features' },
  { key: 'podcast', label: 'Podcast' },
]
/** The shelves a club can narrow, which are the ones whose videos carry one. */
const CLUB_SHELVES: Shelf[] = ['games', 'plays', 'clips']
const CLIPS_PAGE = 30
const shelfHash = (s: Shelf, sub?: string) => (s === 'featured' ? '' : `#${s}${sub ? `/${sub}` : ''}`)

function readHash(): { shelf: Shelf; sub: string } {
  const [h, sub = ''] = (typeof window === 'undefined' ? '' : window.location.hash.slice(1)).split('/')
  if (h === 'more') return { shelf: 'features', sub: '' }
  return SHELVES.some(x => x.key === h) ? { shelf: h as Shelf, sub: decodeURIComponent(sub) } : { shelf: 'featured', sub: '' }
}

export default function WatchPage({ path, onNavigate, onOpenGame }: {
  path: string
  /** A player link on a video's page: opens over it, as on every standalone page. */
  onNavigate: (to: string) => void
  // Opens a game as a modal over this page, as Scorigami does. The link stays a real <a href>.
  onOpenGame: (g: WpblGame, ctx: { teams: WpblTeam[]; games: WpblGame[] }) => void
}) {
  const videoId = wpblWatchVideoIdFromPath(path)
  const [shelfDrawn, setShelfDrawn] = useState(!videoId)
  if (!videoId && !shelfDrawn) setShelfDrawn(true)
  const [videos, setVideos] = useState<WpblVideo[] | null>(() => getCachedWpblVideos())
  const [games, setGames] = useState<WpblGame[]>(() => getCachedWpblSchedule() ?? [])
  const [teams, setTeams] = useState<WpblTeam[]>(() => getCachedWpblTeams() ?? [])
  const [players, setPlayers] = useState<WpblPlayer[]>(() => getCachedWpblAllPlayers() ?? [])
  const [{ shelf, sub }, setPlace] = useState(readHash)
  // One club for every shelf that can narrow by one, so a Hunters fan stays a Hunters fan moving
  // from Games to Plays.
  const [club, setClub] = useState('all')
  const { tags, ready: tagsReady } = useClipTags()

  useEffect(() => {
    let live = true
    fetchWpblVideos().then(v => { if (live) setVideos(v) }).catch(() => { if (live) setVideos(v => v ?? []) })
    fetchWpblSchedule().then(g => { if (live) setGames(g) }).catch(() => { /* cards fall back to the title */ })
    fetchWpblTeams().then(t => { if (live) setTeams(t) }).catch(() => { /* cards render without badges */ })
    fetchWpblAllPlayers().then(p => { if (live) setPlayers(p) }).catch(() => { /* the Players shelf stays empty */ })
    // The Home card links to #clips while this page may already be open underneath.
    // A video's URL has no hash, and reading it as "no shelf" would lose the one the reader left.
    const onHash = () => { if (!wpblWatchVideoIdFromPath(window.location.pathname)) setPlace(readHash()) }
    window.addEventListener('hashchange', onHash)
    window.addEventListener('popstate', onHash)
    return () => { live = false; window.removeEventListener('hashchange', onHash); window.removeEventListener('popstate', onHash) }
  }, [])

  // Where the shelf was left. A top-of-page landing on the video, and back to the same spot on the
  // way out: the browser's own restoration runs against a page whose shelf is still hidden.
  const shelfY = useRef(0)
  const onVideo = useRef(!!videoId)
  useEffect(() => {
    const onScroll = () => { if (!onVideo.current) shelfY.current = window.scrollY }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  const isVideo = !!videoId
  useLayoutEffect(() => {
    if (onVideo.current === isVideo) return
    onVideo.current = isVideo
    window.scrollTo(0, isVideo ? 0 : shelfY.current)
  }, [isVideo])

  const shelfBar = useRef<HTMLDivElement>(null)
  const backToBar = () => {
    // Switching from deep in one shelf would otherwise land the reader at the same scroll offset in
    // the next, somewhere in the middle of it. Back to where the pinned bar sits, and no further.
    const bar = shelfBar.current
    if (bar && bar.getBoundingClientRect().top <= parseFloat(getComputedStyle(bar).top) + 1) {
      const pinned = bar.parentElement ? bar.parentElement.getBoundingClientRect().top + window.scrollY : 0
      window.scrollTo({ top: Math.max(0, pinned - parseFloat(getComputedStyle(bar).top)) })
    }
  }
  const pickShelf = (s: Shelf, narrow?: string) => {
    setPlace({ shelf: s, sub: narrow ?? '' })
    backToBar()
    track(EVENTS.WPBL_PAGE_CONTROL, { page: 'watch', control: 'shelf', value: s })
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${shelfHash(s, narrow)}`)
  }
  const playerHash = (p: WpblPlayer) => shelfHash('players', wpblPlayerSlug(p, players))
  const pickPlayer = (p: WpblPlayer) => {
    setPlace({ shelf: 'players', sub: wpblPlayerSlug(p, players) })
    backToBar()
    track(EVENTS.WPBL_PAGE_CONTROL, { page: 'watch', control: 'player', value: p.id })
    window.history.pushState(window.history.state, '', `${window.location.pathname}${playerHash(p)}`)
  }

  const shelves = useMemo(() => watchShelves(videos ?? []), [videos])
  const { plays, rest } = useMemo(() => splitClips(shelves.clips, tags), [shelves.clips, tags])
  const stamped = useMemo(() => videos?.map(v => ({ id: v.video_id, at: v.published_at })) ?? null, [videos])
  // The watermark moves only once the shelf has been shown: a video opened from a link is not the
  // reader having seen what is new.
  const { isNew, markOpened } = useNewSince('watch', stamped, shelfDrawn)
  const fresh: Fresh = useMemo(() => ({ isNew: v => isNew(v.video_id, v.published_at) }), [isNew])
  const onOpened = useCallback((v: WpblVideo) => markOpened(v.video_id), [markOpened])
  const gamesNew = useMemo(() => {
    const ids = new Set(shelves.gameIds)
    return (videos ?? []).some(v => !!v.game_id && ids.has(v.game_id) && fresh.isNew(v))
  }, [videos, shelves.gameIds, fresh])
  const dots: Partial<Record<Shelf, boolean>> = {
    games: gamesNew,
    plays: plays.some(fresh.isNew),
    clips: rest.some(fresh.isNew),
    features: shelves.more.some(v => v.kind !== 'podcast' && fresh.isNew(v)),
    podcast: shelves.more.some(v => v.kind === 'podcast' && fresh.isNew(v)),
  }
  const pickClub = (id: string) => {
    setClub(id)
    track(EVENTS.WPBL_PAGE_CONTROL, { page: 'watch', control: 'club', value: id })
  }
  // Drawn while the videos load too, from the same element: the bar needs no data, and the page under
  // it holds its place with what it will draw (CLAUDE.md, loading states).
  const bar = (
    <Box ref={shelfBar} sx={SHELF_BAR}>
      <Box sx={SHELF_CHIPS}>
        {SHELVES.map(x => <FilterChip key={x.key} active={shelf === x.key} onClick={() => pickShelf(x.key)} dot={dots[x.key]}>{x.label}</FilterChip>)}
      </Box>
      {CLUB_SHELVES.includes(shelf) && (
        <Box sx={{ flexShrink: 0 }}>
          <FilterSelect ariaLabel="Club" value={club} active={club !== 'all'} onChange={pickClub}
            options={[{ value: 'all', label: 'All clubs' }, ...(teams.length ? teams : Object.values(WPBL_TEAMS)).map(t => ({ value: t.id, label: t.name }))]} />
        </Box>
      )}
    </Box>
  )

  return (
    <>
    {videoId && (
      <WatchVideoPage videoId={videoId} videos={videos} games={games} teams={teams}
        onOpenGame={onOpenGame} onNavigate={onNavigate} onOpened={onOpened} />
    )}
    {shelfDrawn && (
    <Box sx={videoId ? { display: 'none' } : undefined}>
    {/* Wide, like Reading: game cards lay out three across on a desktop and clips six. */}
    <WpblPage title="Watch" maxWidth="72rem">
      {/* PINNED, because the Games shelf is forty games long and the Clips shelf ten screens: without
          it, trying another shelf meant scrolling all the way back up. Full-bleed on a phone with its
          own background, so the list scrolls cleanly underneath. Sits under whatever chrome is pinned
          above it, which on a phone is none (see PINNED_CHROME). */}
      {bar}
      {videos != null && videos.length === 0 ? (
        <Typography sx={{ color: 'text.secondary', py: 4 }}>No videos yet</Typography>
      ) : shelf === 'featured' ? (
        <WatchFront videos={videos} games={games} teams={teams} players={players} tags={tags} tagsReady={tagsReady}
          isNew={fresh.isNew} onPickShelf={pickShelf} shelfHref={(s, narrow) => `${WPBL_WATCH_PAGE}${shelfHash(s, narrow)}`}
          playerHref={p => `${WPBL_WATCH_PAGE}${playerHash(p)}`} onPickPlayer={pickPlayer} />
      ) : videos == null ? (
        <WatchSkeleton shelf={shelf} />
      ) : (
        <>
          {shelf === 'games' && <GamesShelf videos={videos} gameIds={shelves.gameIds} games={games} teams={teams} onOpenGame={onOpenGame} fresh={fresh} club={club} />}
          {shelf === 'plays' && <PlaysShelf key={`plays-${club}`} clips={plays} tags={tags} teams={teams} games={games} players={players} fresh={fresh} club={club}
            event={sub} onEvent={e => pickShelf('plays', e)} />}
          {shelf === 'players' && <PlayersShelf slug={sub} clips={shelves.clips} tags={tags} teams={teams} games={games} players={players} fresh={fresh}
            playerHref={p => `${WPBL_WATCH_PAGE}${playerHash(p)}`} onPick={pickPlayer} onAll={() => pickShelf('players')} allHref={`${WPBL_WATCH_PAGE}${shelfHash('players')}`} onNavigate={onNavigate} />}
          {shelf === 'clips' && <ClipsShelf key={`clips-${club}`} clips={rest} tags={tags} teams={teams} games={games} fresh={fresh} club={club} />}
          {shelf === 'features' && <MoreShelf videos={shelves.more.filter(v => v.kind !== 'podcast')} fresh={fresh} />}
          {shelf === 'podcast' && <MoreShelf videos={shelves.more.filter(v => v.kind === 'podcast')} fresh={fresh} />}
        </>
      )}
    </WpblPage>
    </Box>
    )}
    </>
  )
}

// ─── Games ───────────────────────────────────────────────────────────────────

interface GameEntry { game: WpblGame; videos: WpblVideo[] }

function GamesShelf({ videos, gameIds, games, teams, onOpenGame, fresh, club }: {
  videos: WpblVideo[]; gameIds: string[]; games: WpblGame[]; teams: WpblTeam[]
  onOpenGame: (g: WpblGame, ctx: { teams: WpblTeam[]; games: WpblGame[] }) => void
  fresh: Fresh; club: string
}) {
  const teamById = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])
  const series = useMemo(() => seriesContexts(games, teamById), [games, teamById])

  // Only games the schedule knows: a card is built around the score and the clubs, and a video
  // whose game has left the schedule has neither. Newest first.
  const entries = useMemo<GameEntry[]>(() => {
    const byId = new Map(games.map(g => [g.id, g]))
    return gameIds
      .map(id => byId.get(id))
      .filter((g): g is WpblGame => !!g)
      .sort((a, b) => b.game_date.localeCompare(a.game_date) || b.id.localeCompare(a.id))
      .map(game => ({ game, videos: gameVideos(videos, game.id) }))
  }, [videos, gameIds, games])

  const rows = club === 'all' ? entries : entries.filter(e => e.game.home_team_id === club || e.game.away_team_id === club)
  // With a club picked, the queue is that club's games in the order shown. Otherwise the video's own
  // default, which keeps to one kind rather than running a reel into its three-hour broadcast.
  const queue = useMemo(() => (club === 'all' ? undefined : rows.flatMap(e => e.videos.map(v => v.video_id))), [club, rows])

  // The postseason first, under its own heading, then the regular season by month. The same
  // positive-evidence rule as the standings (countsInStandings), so a game the feed has not
  // labeled stays with the regular season rather than vanishing.
  const groups = useMemo(() => {
    const out: { key: string; label: string; items: GameEntry[] }[] = []
    const post = rows.filter(e => !countsInStandings(e.game))
    if (post.length) out.push({ key: 'post', label: 'Postseason', items: post })
    for (const e of rows.filter(e => countsInStandings(e.game))) {
      const d = new Date(`${e.game.game_date}T12:00:00`)
      const key = `${d.getFullYear()}-${d.getMonth()}`
      if (out[out.length - 1]?.key !== key) out.push({ key, label: d.toLocaleDateString([], { month: 'long', year: 'numeric' }), items: [] })
      out[out.length - 1].items.push(e)
    }
    return out
  }, [rows])

  return (
    <>
      <HideScoresRow />
      {groups.map((grp, gi) => (
        <Box component="section" key={grp.key} sx={{ mt: gi === 0 ? 0 : 2.5 }}>
          <GroupHeading>{grp.label}</GroupHeading>
          <Box sx={GAME_GRID}>
            {grp.items.map(e => (
              <GameWatchCard key={e.game.id} entry={e} teamById={teamById} roundLabel={
                series.get(e.game.id) ? `${series.get(e.game.id)!.label}, Game ${series.get(e.game.id)!.gameNumber}` : null
              } href={wpblGamePath(e.game, teams, games)} onOpenGame={() => onOpenGame(e.game, { teams, games })} fresh={fresh} queue={queue} />
            ))}
          </Box>
        </Box>
      ))}
    </>
  )
}

/** Keeps results off the cards, so a game can be watched not knowing how it went. */
function HideScoresRow() {
  const hide = useHideScores()
  return (
    <Box sx={{ display: 'flex', mb: 1.25 }}>
      <FilterChip active={hide} onClick={() => {
        setHideScores(!hide)
        track(EVENTS.WPBL_PAGE_CONTROL, { page: 'watch', control: 'hide_scores', value: hide ? 'off' : 'on' })
      }}>Hide scores</FilterChip>
    </Box>
  )
}

// The game card's parts, one definition for the loaded card and its skeleton.
const SHELF_BAR = {
  position: 'sticky', top: 'var(--app-header-h, 0px)', zIndex: 5,
  bgcolor: 'background.default', py: 1, mb: 1, mt: -1,
  mx: { xs: 'calc(50% - 50vw)', sm: 0 }, px: { xs: 'calc(50vw - 50%)', sm: 0 },
  display: 'flex', alignItems: 'center', gap: 0.75,
} as const
// The shelves scroll sideways on a phone and stop at the Club menu, which stays in reach: at the end
// of the row it would be the one control off the screen.
const SHELF_CHIPS = {
  flex: 1, minWidth: 0, display: 'flex', gap: 0.75,
  flexWrap: { xs: 'nowrap', sm: 'wrap' }, overflowX: { xs: 'auto', sm: 'visible' },
  scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' },
} as const
const GAME_GRID = {
  display: 'grid', gap: { xs: 1, sm: 1.5 },
  gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, minmax(0, 1fr))' },
} as const
const GAME_CARD = {
  border: '1px solid', borderColor: CARD_BORDER, borderRadius: 2, bgcolor: CARD_FILL, overflow: 'hidden',
  display: 'grid', alignContent: 'start',
  gridTemplateColumns: { xs: 'minmax(0, 42%) minmax(0, 1fr)', sm: 'minmax(0, 1fr)' },
  gridTemplateAreas: { xs: '"thumb info" "actions actions"', sm: '"thumb" "info" "actions"' },
} as const
const GAME_THUMB = {
  gridArea: 'thumb', alignSelf: 'start', position: 'relative',
  m: { xs: 1, sm: 0 }, mr: { xs: 0, sm: 0 }, borderRadius: { xs: 1.5, sm: 0 }, overflow: 'hidden',
} as const
const GAME_INFO = {
  gridArea: 'info', minWidth: 0, p: { xs: 1, sm: 1.25 }, pb: { xs: 0.5, sm: 0.5 },
  display: 'grid', columnGap: 1, rowGap: 0.25, alignContent: 'start',
  gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'minmax(0, 1fr) auto' },
  gridTemplateAreas: { xs: '"score" "meta" "link"', sm: '"score link" "meta meta"' },
} as const
const GAME_SCORE = { gridArea: 'score', display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0, flexWrap: 'wrap' } as const
const GAME_LINK = {
  gridArea: 'link', justifySelf: 'start', alignSelf: 'center',
  display: 'inline-flex', alignItems: 'center', fontSize: TYPE_SCALE.meta, fontWeight: 800,
  // The padding is the tap target, the negative margin keeps the text where it was.
  px: 0.75, mx: -0.75, py: 0.5, my: -0.5, borderRadius: 1,
  '@media (pointer: coarse)': { minHeight: 40 },
} as const
const GAME_ACTIONS = { gridArea: 'actions', px: { xs: 1, sm: 1.25 }, pb: 1.25, pt: { xs: 0.75, sm: 0.5 }, display: 'flex', flexDirection: 'column', gap: 0.75 } as const
const GAME_PILL = {
  display: 'inline-flex', alignItems: 'center', gap: 0.5,
  px: 1.1, py: 0.45, borderRadius: 999, border: '1px solid', borderColor: 'outline',
  bgcolor: 'background.paper', color: 'text.primary', font: 'inherit',
  fontSize: TYPE_SCALE.meta, fontWeight: 700, lineHeight: 1.4,
  '@media (pointer: coarse)': { minHeight: 38, px: 1.4 },
} as const

/**
 * A shelf before the videos land: the loaded shelf drawn empty (CLAUDE.md, loading states). The games
 * as cards in the most common shape (the league's reel and the fan's condensed game, with the fan's
 * credit under them), the Shorts as tall posters, the rest as 16:9. The front page draws its own.
 */
function WatchSkeleton({ shelf }: { shelf: Shelf }) {
  if (shelf === 'players') {
    return (
      <Box aria-hidden sx={PLAYER_GRID}>
        {Array.from({ length: 24 }, (_, i) => <PlayerTile key={i} fill />)}
      </Box>
    )
  }
  if (shelf === 'plays' || shelf === 'clips') {
    return (
      <Box aria-hidden sx={CLIP_GRID}>
        {Array.from({ length: CLIPS_PAGE }, (_, i) => <Box key={i} sx={{ aspectRatio: '9 / 16', borderRadius: 2, bgcolor: 'action.hover' }} />)}
      </Box>
    )
  }
  if (shelf !== 'games') {
    return (
      <Box aria-hidden sx={MORE_GRID}>
        {Array.from({ length: 8 }, (_, i) => <Box key={i} sx={{ aspectRatio: '16 / 9', borderRadius: 2, bgcolor: 'action.hover' }} />)}
      </Box>
    )
  }
  const side = (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
      <Skeleton variant="circular" width={chromePx(22)} height={chromePx(22)} sx={{ flexShrink: 0 }} />
      <Typography sx={{ fontSize: TYPE_SCALE.body, whiteSpace: 'nowrap' }}><TextGhost>NY</TextGhost></Typography>
      <Typography sx={{ fontSize: TYPE_SCALE.title, fontWeight: 800 }}><TextGhost>0</TextGhost></Typography>
    </Box>
  )
  return (
    <Box aria-hidden>
      <HideScoresRow />
      <GroupHeading><TextGhost>Postseason</TextGhost></GroupHeading>
      <Box sx={GAME_GRID}>
        {Array.from({ length: 9 }, (_, i) => (
          <Box key={i} sx={GAME_CARD}>
            <Box sx={GAME_THUMB}><Box sx={{ width: '100%', aspectRatio: '16 / 9', bgcolor: 'action.hover' }} /></Box>
            <Box sx={GAME_INFO}>
              <Box sx={GAME_SCORE}>
                {side}
                {/* Hidden with the clubs either side of it: where it sits depends on them. */}
                <Typography sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 700 }}><TextGhost hidden>@</TextGhost></Typography>
                {side}
              </Box>
              <Typography sx={{ gridArea: 'meta', fontSize: TYPE_SCALE.meta }}><TextGhost>Sep 00 · Semifinal, Game 1</TextGhost></Typography>
              <Box sx={GAME_LINK}><TextGhost>Box score ›</TextGhost></Box>
            </Box>
            <Box sx={GAME_ACTIONS}>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                {['Highlights', 'Condensed game'].map(label => (
                  <Box key={label} sx={GAME_PILL}>
                    <Box component="span" sx={{ fontSize: TYPE_SCALE.caption, visibility: 'hidden' }}>▶</Box><TextGhost>{label}</TextGhost>
                  </Box>
                ))}
              </Box>
              <Typography sx={{ fontSize: TYPE_SCALE.meta, lineHeight: 1.3 }}><TextGhost>Condensed game: WPBL from Day 1</TextGhost></Typography>
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  )
}

/**
 * One game: the first video's poster, the score, and a button per video.
 *
 * The poster plays the shortest watch (gameVideos puts the reel first). The buttons carry the
 * kind, not the title, since all three titles say the same matchup; the fan's credit sits under
 * them whenever their condensed game is one of the buttons.
 */
function GameWatchCard({ entry, teamById, roundLabel, href, onOpenGame, fresh, queue }: {
  entry: GameEntry; teamById: Map<string, WpblTeam>; roundLabel: string | null
  href: string; onOpenGame: () => void; fresh: Fresh; queue?: string[]
}) {
  const { game, videos } = entry
  // New while any of its videos is: the condensed game often lands a day after the reel, and the
  // button that is new carries its own dot below.
  const anyNew = videos.some(fresh.isNew)
  const away = teamById.get(game.away_team_id)
  const home = teamById.get(game.home_team_id)
  const hideScores = useHideScores()
  // The winner's bold says the result as plainly as the number does, so it goes with it.
  const scored = !hideScores && game.away_score != null && game.home_score != null
  const awayWon = scored && game.away_score! > game.home_score!
  const homeWon = scored && game.home_score! > game.away_score!
  const credited = videos.find(v => videoCredit(v))
  const credit = credited ? videoCredit(credited) : null
  const date = new Date(`${game.game_date}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' })
  // Two uploads of the same kind happen (Aug 2 was broadcast twice), and two buttons both reading
  // "Full game" would look like a rendering fault, so a repeat is numbered.
  const labels = videos.map((v, i) => {
    const name = videoKindName(v)
    const n = videos.slice(0, i).filter(w => videoKindName(w) === name).length
    return n ? `${name} ${n + 1}` : name
  })
  const side = (team: WpblTeam | undefined, id: string, score: number | null, won: boolean) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
      {team && <TeamBadge team={team} size={22} />}
      <Typography sx={{ fontSize: TYPE_SCALE.body, fontWeight: won ? 800 : 600, color: won ? 'text.primary' : 'text.secondary', whiteSpace: 'nowrap' }}>
        {team?.abbr ?? id}
      </Typography>
      {score != null && (
        <Typography sx={{ fontSize: TYPE_SCALE.title, fontWeight: 800, color: won ? 'text.primary' : 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
          {score}
        </Typography>
      )}
    </Box>
  )
  // TWO SHAPES. On a desktop, a poster over the details, three cards across. On a phone that same
  // card was 310px tall, so the 40 games ran to 13,400px of scrolling with one game per screen:
  // there it is a row instead, a small poster beside the score, with the buttons under both,
  // which fits three or four games to a screen. Grid areas rather than two components, so the
  // two shapes cannot drift apart.
  return (
    <Box sx={GAME_CARD}>
      <Box {...videoLink(videos[0], queue)} aria-label={`Play ${labels[0].toLowerCase()}: ${videos[0].title}`}
        sx={{ ...CARD_LINK, ...GAME_THUMB, ...PLAYABLE_HOVER, ...FOCUS_RING }}
      >
        {/* 42% of a phone's width, or a third of the desktop column: the large poster only
            where the box is big enough to show it (see VideoThumb). */}
        <VideoThumb video={videos[0]} badge={34} sizes="(max-width: 599px) 42vw, 400px" />
        {anyNew && <NewTag />}
      </Box>
      <Box sx={GAME_INFO}>
        <Box sx={GAME_SCORE}>
          {side(away, game.away_team_id, scored ? game.away_score : null, awayWon)}
          <Typography sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 700, color: 'text.disabled' }}>@</Typography>
          {side(home, game.home_team_id, scored ? game.home_score : null, homeWon)}
        </Box>
        <Typography sx={{ gridArea: 'meta', fontSize: TYPE_SCALE.meta, color: 'text.disabled' }}>
          {[date, roundLabel].filter(Boolean).join(' · ')}
        </Typography>
        <Box component="a" href={href}
          onClick={(e: React.MouseEvent) => {
            track(EVENTS.WPBL_PAGE_OPEN, { page: 'watch', section: 'games', kind: 'game', value: game.id })
            if (!isModified(e)) { e.preventDefault(); onOpenGame() }
          }}
          sx={{
            ...GAME_LINK, color: 'var(--wpbl-accent-fg)', textDecoration: 'none',
            ...hoverOnly({ textDecoration: 'underline' }), ...FOCUS_RING,
          }}>Box score ›</Box>
      </Box>
      <Box sx={GAME_ACTIONS}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
          {videos.map((v, i) => (
            <Box key={v.video_id} {...videoLink(v, queue)}
              sx={{ ...GAME_PILL, textDecoration: 'none', ...hoverOnly({ borderColor: 'text.secondary' }), ...FOCUS_RING }}>
              <Box component="span" aria-hidden sx={{ fontSize: TYPE_SCALE.caption }}>▶</Box>{labels[i]}
              {fresh.isNew(v) && (
                <Box component="span" role="img" aria-label="new" sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'var(--wpbl-accent-solid)' }} />
              )}
            </Box>
          ))}
        </Box>
        {credit && credited && <VideoCreditLine credit={credit} what={videoKindName(credited)} />}
      </Box>
    </Box>
  )
}

// ─── Clips ───────────────────────────────────────────────────────────────────

const CLIP_GRID = {
  display: 'grid', gap: { xs: 0.75, sm: 1 },
  gridTemplateColumns: { xs: 'repeat(3, minmax(0, 1fr))', sm: 'repeat(4, minmax(0, 1fr))', md: 'repeat(5, minmax(0, 1fr))', lg: 'repeat(6, minmax(0, 1fr))' },
} as const

/**
 * Shorts, newest first, in pages of thirty.
 *
 * Split at opening day, because the channel's Shorts are two different things either side of it:
 * before, the draft, tryouts and the build-up; from it, the season itself. Opening day is the
 * schedule's first game, not a date written here, so next season moves the line on its own.
 *
 * The club comes from the clip tags (wpbl_video_tags), which name one for about half the Shorts. A
 * clip with no club is under "All clubs" only: it is not evidence of being about nobody, just of a
 * title that did not say.
 */
function ClipsShelf({ clips, tags, games, teams, fresh, club }: {
  clips: WpblVideo[]; tags: Map<string, WpblVideoTag>; games: WpblGame[]; teams: WpblTeam[]; fresh: Fresh; club: string
}) {
  const teamById = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])
  const opening = useMemo(() => games.reduce<string | null>((min, g) => (!min || g.game_date < min ? g.game_date : min), null), [games])
  // Midnight Pacific on opening day, as UTC: the league's earliest time zone, so nothing posted on
  // opening day anywhere in the country falls before the line.
  const openingAt = opening ? `${opening}T07:00:00Z` : null
  const [limit, setLimit] = useState(CLIPS_PAGE)
  const clubOf = (v: WpblVideo) => tags.get(v.video_id)?.team_id ?? null
  const list = club === 'all' ? clips : clips.filter(v => clubOf(v) === club)
  // The whole filtered list, not the page of it on screen, so next runs past the "Show more".
  const queue = list.map(v => v.video_id)
  const shown = list.slice(0, limit)
  const groups = [
    { key: 'season', label: `${opening?.slice(0, 4) ?? ''} season`, items: openingAt ? shown.filter(v => v.published_at >= openingAt) : shown },
    { key: 'before', label: 'Before the season', items: openingAt ? shown.filter(v => v.published_at < openingAt) : [] },
  ].filter(g => g.items.length > 0)

  if (list.length === 0) return <Typography sx={{ color: 'text.secondary', py: 4 }}>No videos</Typography>
  return (
    <>
      {groups.map((grp, gi) => (
        <Box component="section" key={grp.key} sx={{ mt: gi === 0 ? 0 : 2.5 }}>
          {/* A heading only where it divides something: on the Plays shelf every clip is the season. */}
          {(groups.length > 1 || grp.key === 'before') && <GroupHeading>{grp.label}</GroupHeading>}
          <Box sx={CLIP_GRID}>
            {grp.items.map(v => {
              const team = teamById.get(clubOf(v) ?? '')
              const isNew = fresh.isNew(v)
              return (
                <Box key={v.video_id} {...videoLink(v, queue)}
                  aria-label={`Play${isNew ? ' new' : ''} clip: ${v.title}`}
                  sx={{ ...CARD_LINK, position: 'relative', borderRadius: 2, overflow: 'hidden', ...PLAYABLE_HOVER, ...FOCUS_RING }}
                >
                  <VideoThumb video={v} vertical badge={34} />
                  <ClipCaption title={v.title} lines={3} />
                  {/* The date chip carries the marker rather than a second tag beside it: a clip
                      poster is ~110px wide on a phone, with a club badge in the other corner. */}
                  <Typography sx={{
                    position: 'absolute', top: 6, left: 6, px: 0.6, borderRadius: 1,
                    bgcolor: isNew ? 'var(--wpbl-accent-solid)' : 'rgba(0,0,0,0.55)',
                    color: '#fff', fontSize: TYPE_SCALE.micro, fontWeight: isNew ? 800 : 700, lineHeight: 1.6, pointerEvents: 'none',
                  }}>{isNew ? `New · ${videoDateLabel(v)}` : videoDateLabel(v)}</Typography>
                  {team && (
                    <Box sx={{ position: 'absolute', top: 5, right: 5, pointerEvents: 'none', lineHeight: 0 }}>
                      <TeamBadge team={team} size={20} />
                    </Box>
                  )}
                </Box>
              )
            })}
          </Box>
        </Box>
      ))}
      {list.length > limit && (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
          <Box component="button" type="button" onClick={() => setLimit(l => l + CLIPS_PAGE)} sx={{
            px: 2, py: 0.75, borderRadius: 999, border: '1px solid', borderColor: 'outline', cursor: 'pointer',
            bgcolor: 'background.paper', color: 'text.primary', font: 'inherit', fontSize: TYPE_SCALE.body, fontWeight: 700,
            ...hoverOnly({ borderColor: 'text.secondary' }), ...FOCUS_RING,
          }}>Show more ({list.length - limit} left)</Box>
        </Box>
      )}
    </>
  )
}

/** The Shorts from a game, narrowed by the kind of play and by who is in it. Neither is pinned: the
 *  row above is the shelves, and these belong to this one. */
function PlaysShelf({ clips, tags, games, teams, players, fresh, club, event, onEvent }: {
  clips: WpblVideo[]; tags: Map<string, WpblVideoTag>; games: WpblGame[]; teams: WpblTeam[]; players: WpblPlayer[]
  fresh: Fresh; club: string; event: string; onEvent: (e: string) => void
}) {
  const [playerId, setPlayerId] = useState('all')
  const events = useMemo(() => clipEvents(clips, tags), [clips, tags])
  const known = events.some(e => e.event === event)
  const byEvent = known ? clipsOfEvent(clips, tags, event) : clips
  const inThem = useMemo(() => playersWithClips(byEvent, tags, players), [byEvent, tags, players])
  // A player picked under one kind of play may have none of the next: every player, rather than an
  // empty grid with nothing on screen to explain it.
  const activePlayer = inThem.some(p => p.player.id === playerId) ? playerId : 'all'
  const list = activePlayer === 'all' ? byEvent : clipsOfPlayer(byEvent, tags, activePlayer)
  return (
    <>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mb: 1.5 }}>
        <FilterSelect ariaLabel="Play" value={known ? event : 'all'} active={known}
          onChange={v => onEvent(v === 'all' ? '' : v)}
          options={[{ value: 'all', label: 'All plays' }, ...events.map(e => ({ value: e.event, label: `${eventLabel(e.event)} (${e.count})` }))]} />
        <FilterSelect ariaLabel="Player" value={activePlayer} active={activePlayer !== 'all'} onChange={setPlayerId}
          options={[{ value: 'all', label: 'All players' }, ...inThem.map(p => ({ value: p.player.id, label: `${p.player.name} (${p.count})` }))]} />
      </Box>
      <ClipsShelf key={`${event}-${activePlayer}`} clips={list} tags={tags} teams={teams} games={games} fresh={fresh} club={club} />
    </>
  )
}

const PLAYER_GRID = {
  display: 'grid', gap: { xs: 0.75, sm: 1 },
  gridTemplateColumns: { xs: 'repeat(3, minmax(0, 1fr))', sm: 'repeat(5, minmax(0, 1fr))', md: 'repeat(7, minmax(0, 1fr))' },
} as const

/** Everyone in a clip, or one player's clips. A slug naming nobody is the list: the hash is not a page
 *  the edge can 404, and the list is what a reader who mistyped it wanted anyway. */
function PlayersShelf({ slug, clips, tags, games, teams, players, fresh, playerHref, onPick, onAll, allHref, onNavigate }: {
  slug: string; clips: WpblVideo[]; tags: Map<string, WpblVideoTag>; games: WpblGame[]; teams: WpblTeam[]; players: WpblPlayer[]
  fresh: Fresh; playerHref: (p: WpblPlayer) => string; onPick: (p: WpblPlayer) => void; onAll: () => void; allHref: string
  onNavigate: (to: string) => void
}) {
  const list = useMemo(() => playersWithClips(clips, tags, players), [clips, tags, players])
  const picked = slug ? findWpblPlayerBySlug(slug, players) : null
  if (picked) {
    return (
      <>
        <Box sx={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 1.25, mb: 1.5 }}>
          <Typography component="h2" sx={{ fontSize: TYPE_SCALE.heading, fontWeight: 800 }}>{picked.name}</Typography>
          <Box component="a" href={wpblPlayerPath(picked, players)}
            onClick={(e: React.MouseEvent) => { if (!isModified(e)) { e.preventDefault(); onNavigate(wpblPlayerPath(picked, players)) } }}
            sx={PLAYER_LINK}>Player page ›</Box>
          <Box component="a" href={allHref} onClick={(e: React.MouseEvent) => { if (!isModified(e)) { e.preventDefault(); onAll() } }}
            sx={PLAYER_LINK}>All players ›</Box>
        </Box>
        <ClipsShelf key={picked.id} clips={clipsOfPlayer(clips, tags, picked.id)} tags={tags} teams={teams} games={games} fresh={fresh} club="all" />
      </>
    )
  }
  if (list.length === 0) return <Typography sx={{ color: 'text.secondary', py: 4 }}>No videos</Typography>
  return (
    <Box sx={PLAYER_GRID}>
      {list.map(({ player, count }) => <PlayerTile key={player.id} fill player={player} count={count} href={playerHref(player)} onPick={() => onPick(player)} />)}
    </Box>
  )
}

const PLAYER_LINK = {
  fontSize: TYPE_SCALE.meta, fontWeight: 800, color: 'var(--wpbl-accent-fg)', textDecoration: 'none',
  ...hoverOnly({ textDecoration: 'underline' }), ...FOCUS_RING,
} as const

// ─── More ────────────────────────────────────────────────────────────────────

const MORE_GRID = {
  display: 'grid', gap: { xs: 1, sm: 1.5 },
  gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(3, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' },
} as const

function MoreShelf({ videos, fresh }: { videos: WpblVideo[]; fresh: Fresh }) {
  const groups = MORE_GROUPS.map(g => ({ ...g, items: videos.filter(g.test) })).filter(g => g.items.length > 0)
  return (
    <>
      {groups.map((grp, gi) => (
        <Box component="section" key={grp.key} sx={{ mt: gi === 0 ? 0 : 2.5 }}>
          <GroupHeading>{grp.label}</GroupHeading>
          <Box sx={MORE_GRID}>
            {grp.items.map(v => {
              const credit = videoCredit(v)
              return (
                <Box key={v.video_id} sx={{
                  position: 'relative', border: '1px solid', borderColor: CARD_BORDER, borderRadius: 2, bgcolor: CARD_FILL, overflow: 'hidden',
                  ...hoverOnly({ borderColor: 'text.disabled' }), ...PLAYABLE_HOVER,
                }}>
                  {/* The link stops above the credit, which is a link of its own to their channel. */}
                  <Box {...videoLink(v, grp.items.map(x => x.video_id))}
                    aria-label={`Play${fresh.isNew(v) ? ', new' : ''}: ${v.title}`}
                    sx={{ ...CARD_LINK, ...FOCUS_RING }}>
                    <Box sx={{ position: 'relative' }}>
                      <VideoThumb video={v} badge={34} />
                      {fresh.isNew(v) && <NewTag />}
                    </Box>
                    <Box sx={{ p: 1, pt: 0.75, pb: credit ? 0 : 1 }}>
                      <Typography sx={{
                        fontSize: TYPE_SCALE.body, fontWeight: 600, lineHeight: 1.3,
                        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                      }}>{v.title}</Typography>
                      <Typography sx={{ mt: 0.25, fontSize: TYPE_SCALE.micro, color: 'text.disabled', fontWeight: 700 }}>{videoDateLabel(v)}</Typography>
                    </Box>
                  </Box>
                  {credit && <Box sx={{ px: 1, pb: 1, pt: 0.25 }}><VideoCreditLine credit={credit} /></Box>}
                </Box>
              )
            })}
          </Box>
        </Box>
      ))}
    </>
  )
}
