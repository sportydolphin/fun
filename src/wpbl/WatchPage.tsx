import { useEffect, useMemo, useRef, useState } from 'react'
import { Box, Typography, CircularProgress } from '@mui/material'
import WpblPage from './WpblPage'
import { ChipRow, FilterChip } from './FilterChips'
import { CARD_BORDER, CARD_FILL, FLAT_CARDS_DARK, FOCUS_RING, TYPE_SCALE, TeamBadge, hoverOnly, NewTag } from './ui'
import { fetchWpblSchedule, fetchWpblTeams, fetchWpblVideos, getCachedWpblSchedule, getCachedWpblTeams, getCachedWpblVideos } from './api'
import { countsInStandings } from './season'
import { seriesContexts } from './derive/series'
import { wpblGamePath } from './routes'
import { gameVideos, watchShelves, videoCredit, videoKindName, MORE_GROUPS } from './videoChannels'
import { HighlightLightbox, VideoThumb, VideoCreditLine, PLAYABLE_HOVER, videoDateLabel } from './Highlights'
import { ClipCaption, ClipContextLine, clipLabel, useClipTags } from './Watch'
import { track, EVENTS } from '../lib/analytics'
import type { WpblGame, WpblTeam, WpblVideo } from './types'
import { useNewSince } from './newSince'
import { typePx } from '../ui/scale'

// /wpbl/watch: every video the site mirrors, from the league's channel and from WPBL from Day 1,
// on three shelves.
//
//   Games  one card per game, with a button for each video of it: the league's reel, the fan's
//          condensed game and the league's full broadcast, whichever exist and this reader's
//          country can play (the broadcasts are blocked in the US; see playableIn).
//   Clips  the league's Shorts, newest first, played vertically.
//   More   everything that belongs to no game: the fan's compilations, features, press
//          conferences, the podcast.
//
// CLIPS ARE NOT FILED BY GAME, and that was measured rather than assumed. Not one of the 291
// Shorts names its game. Matching the player a title names against the play-by-play pins about
// 70 of them to a game and an at-bat; the rest are features, hype and moments with no name in the
// title. A shelf organised by game would hide three quarters of it, so the shelf is a feed by date,
// and pinning a clip to its game is a later phase that adds a badge rather than a structure.
//
// THE SHELF IS THE HASH (#games, #clips, #more) so the Home card can link straight to the clips
// and a shared link keeps its shelf, without a second route and a second rewrite. It is written
// with replaceState: switching shelves is not somewhere Back should step through.
//
// NOTHING LOADS FROM YOUTUBE until a play: every card is a poster and the embed mounts in the
// lightbox. WPBL from Day 1's videos are embedded with their permission and credited on every card
// that shows one (videoCredit), the same rule as the fan photographs.

type Shelf = 'games' | 'clips' | 'more'

/** Whether a video is new to this reader, and the call that says they have now played it. */
interface Fresh { isNew: (v: WpblVideo) => boolean; opened: (v: WpblVideo) => void }
const SHELVES: Shelf[] = ['games', 'clips', 'more']
const CLIPS_PAGE = 30

function shelfFromHash(): Shelf {
  const h = typeof window === 'undefined' ? '' : window.location.hash.slice(1)
  return (SHELVES as string[]).includes(h) ? h as Shelf : 'games'
}

export default function WatchPage({ onOpenGame }: {
  // Opens a game as a modal over this page, as Scorigami does. The link stays a real <a href>.
  onOpenGame: (g: WpblGame, ctx: { teams: WpblTeam[]; games: WpblGame[] }) => void
}) {
  const [videos, setVideos] = useState<WpblVideo[] | null>(() => getCachedWpblVideos())
  const [games, setGames] = useState<WpblGame[]>(() => getCachedWpblSchedule() ?? [])
  const [teams, setTeams] = useState<WpblTeam[]>(() => getCachedWpblTeams() ?? [])
  const [shelf, setShelf] = useState<Shelf>(shelfFromHash)

  useEffect(() => {
    let live = true
    fetchWpblVideos().then(v => { if (live) setVideos(v) }).catch(() => { if (live) setVideos(v => v ?? []) })
    fetchWpblSchedule().then(g => { if (live) setGames(g) }).catch(() => { /* cards fall back to the title */ })
    fetchWpblTeams().then(t => { if (live) setTeams(t) }).catch(() => { /* cards render without badges */ })
    // The Home card links to #clips while this page may already be open underneath.
    const onHash = () => setShelf(shelfFromHash())
    window.addEventListener('hashchange', onHash)
    window.addEventListener('popstate', onHash)
    return () => { live = false; window.removeEventListener('hashchange', onHash); window.removeEventListener('popstate', onHash) }
  }, [])

  const shelfBar = useRef<HTMLDivElement>(null)
  const pickShelf = (s: Shelf) => {
    setShelf(s)
    // Switching from deep in one shelf would otherwise land the reader at the same scroll offset in
    // the next, somewhere in the middle of it. Back to where the pinned bar sits, and no further.
    const bar = shelfBar.current
    if (bar && bar.getBoundingClientRect().top <= parseFloat(getComputedStyle(bar).top) + 1) {
      const pinned = bar.parentElement ? bar.parentElement.getBoundingClientRect().top + window.scrollY : 0
      window.scrollTo({ top: Math.max(0, pinned - parseFloat(getComputedStyle(bar).top)) })
    }
    track(EVENTS.WPBL_PAGE_CONTROL, { page: 'watch', control: 'shelf', value: s })
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${s === 'games' ? '' : `#${s}`}`)
  }

  const shelves = useMemo(() => watchShelves(videos ?? []), [videos])
  const moreCount = shelves.more.length
  const stamped = useMemo(() => videos?.map(v => ({ id: v.video_id, at: v.published_at })) ?? null, [videos])
  const { isNew, markOpened } = useNewSince('watch', stamped, true)
  const fresh: Fresh = useMemo(() => ({
    isNew: v => isNew(v.video_id, v.published_at),
    opened: v => markOpened(v.video_id),
  }), [isNew, markOpened])
  const gamesNew = useMemo(() => {
    const ids = new Set(shelves.gameIds)
    return (videos ?? []).some(v => !!v.game_id && ids.has(v.game_id) && fresh.isNew(v))
  }, [videos, shelves.gameIds, fresh])

  return (
    // Wide, like Reading: game cards lay out three across on a desktop and clips six.
    // The standfirst is kept to what a phone can take in three lines: it sits between the reader
    // and the first video, and at four lines it was pushing the first poster below the fold.
    <WpblPage title="Watch" maxWidth="72rem" standfirst={<>
      Every game on video, and every clip the league has posted. Condensed games by{' '}
      <Box component="a" href="https://www.youtube.com/@wpblfanrecaps" target="_blank" rel="noopener noreferrer"
        sx={{ color: 'inherit', fontWeight: 700 }}>WPBL from Day 1</Box>, with permission.
    </>}>
      <Box sx={FLAT_CARDS_DARK}>
        {videos == null ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>
        ) : videos.length === 0 ? (
          <Typography sx={{ color: 'text.secondary', py: 4 }}>No videos yet.</Typography>
        ) : (
          <>
            {/* PINNED, because the Games shelf is forty games long and the Clips shelf ten screens:
                without it, trying another shelf meant scrolling all the way back up. Full-bleed on
                a phone with its own background, so the list scrolls cleanly underneath; ChipRow's
                own bleed then resolves to nothing, since its 50% is already the screen. Sits under
                whatever chrome is pinned above it, which on a phone is none (see PINNED_CHROME). */}
            <Box ref={shelfBar} sx={{
              position: 'sticky', top: 'var(--app-header-h, 0px)', zIndex: 5,
              bgcolor: 'background.default', py: 1, mb: 1, mt: -1,
              mx: { xs: 'calc(50% - 50vw)', sm: 0 }, px: { xs: 'calc(50vw - 50%)', sm: 0 },
            }}>
              <ChipRow mb={0}>
                <FilterChip label={`Games (${shelves.gameIds.length})`} active={shelf === 'games'} onClick={() => pickShelf('games')} dot={gamesNew} />
                <FilterChip label={`Clips (${shelves.clips.length})`} active={shelf === 'clips'} onClick={() => pickShelf('clips')} dot={shelves.clips.some(fresh.isNew)} />
                {moreCount > 0 && <FilterChip label={`More (${moreCount})`} active={shelf === 'more'} onClick={() => pickShelf('more')} dot={shelves.more.some(fresh.isNew)} />}
              </ChipRow>
            </Box>
            {shelf === 'games' && <GamesShelf videos={videos} gameIds={shelves.gameIds} games={games} teams={teams} onOpenGame={onOpenGame} fresh={fresh} />}
            {shelf === 'clips' && <ClipsShelf clips={shelves.clips} games={games} teams={teams} onOpenGame={onOpenGame} fresh={fresh} />}
            {shelf === 'more' && <MoreShelf videos={shelves.more} fresh={fresh} />}
          </>
        )}
      </Box>
    </WpblPage>
  )
}

// ─── Games ───────────────────────────────────────────────────────────────────

interface GameEntry { game: WpblGame; videos: WpblVideo[] }

function GamesShelf({ videos, gameIds, games, teams, onOpenGame, fresh }: {
  videos: WpblVideo[]; gameIds: string[]; games: WpblGame[]; teams: WpblTeam[]
  onOpenGame: (g: WpblGame, ctx: { teams: WpblTeam[]; games: WpblGame[] }) => void
  fresh: Fresh
}) {
  const [club, setClub] = useState('all')
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

  const clubChips = useMemo(() => teams
    .map(t => ({ team: t, count: entries.filter(e => e.game.home_team_id === t.id || e.game.away_team_id === t.id).length }))
    .filter(c => c.count > 0), [teams, entries])
  const rows = club === 'all' ? entries : entries.filter(e => e.game.home_team_id === club || e.game.away_team_id === club)

  // The postseason first, under its own heading, then the regular season by month. The same
  // positive-evidence rule as the standings (countsInStandings), so a game the feed has not
  // labelled stays with the regular season rather than vanishing.
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
      {clubChips.length > 1 && (
        <ChipRow mb={1.75}>
          <FilterChip label={`All clubs (${entries.length})`} active={club === 'all'} onClick={() => setClub('all')} />
          {clubChips.map(c => (
            <FilterChip key={c.team.id} label={`${c.team.name} (${c.count})`} active={club === c.team.id}
              onClick={() => { setClub(c.team.id); track(EVENTS.WPBL_PAGE_CONTROL, { page: 'watch', control: 'club', value: c.team.id }) }} />
          ))}
        </ChipRow>
      )}
      {groups.map((grp, gi) => (
        <Box component="section" key={grp.key} sx={{ mt: gi === 0 ? 0 : 2.5 }}>
          <GroupHeading>{grp.label}</GroupHeading>
          <Box sx={{
            display: 'grid', gap: { xs: 1, sm: 1.5 },
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, minmax(0, 1fr))' },
          }}>
            {grp.items.map(e => (
              <GameWatchCard key={e.game.id} entry={e} teamById={teamById} roundLabel={
                series.get(e.game.id) ? `${series.get(e.game.id)!.label}, Game ${series.get(e.game.id)!.gameNumber}` : null
              } href={wpblGamePath(e.game, teams, games)} onOpenGame={() => onOpenGame(e.game, { teams, games })} fresh={fresh} />
            ))}
          </Box>
        </Box>
      ))}
    </>
  )
}

function GroupHeading({ children }: { children: React.ReactNode }) {
  return (
    <Typography component="h2" sx={{
      fontSize: TYPE_SCALE.micro, fontWeight: 800, textTransform: 'uppercase', letterSpacing: typePx(0.6),
      color: 'text.secondary', mb: 1,
    }}>{children}</Typography>
  )
}

const isModified = (e: React.MouseEvent) => e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0

/**
 * One game: the first video's poster, the score, and a button per video.
 *
 * The poster plays the shortest watch (gameVideos puts the reel first). The buttons carry the
 * kind, not the title, since all three titles say the same matchup; the fan's credit sits under
 * them whenever their condensed game is one of the buttons.
 */
function GameWatchCard({ entry, teamById, roundLabel, href, onOpenGame, fresh }: {
  entry: GameEntry; teamById: Map<string, WpblTeam>; roundLabel: string | null
  href: string; onOpenGame: () => void; fresh: Fresh
}) {
  const { game, videos } = entry
  const [active, setActive] = useState<WpblVideo | null>(null)
  const play = (v: WpblVideo) => { track(EVENTS.WPBL_HIGHLIGHT_PLAYED, { videoId: v.video_id, kind: v.kind, from: 'watch' }); fresh.opened(v); setActive(v) }
  // New while any of its videos is: the condensed game often lands a day after the reel, and the
  // button that is new carries its own dot below.
  const anyNew = videos.some(fresh.isNew)
  const away = teamById.get(game.away_team_id)
  const home = teamById.get(game.home_team_id)
  const scored = game.away_score != null && game.home_score != null
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
    <Box sx={{
      border: '1px solid', borderColor: CARD_BORDER, borderRadius: 2, bgcolor: CARD_FILL, overflow: 'hidden',
      display: 'grid', alignContent: 'start',
      gridTemplateColumns: { xs: 'minmax(0, 42%) minmax(0, 1fr)', sm: 'minmax(0, 1fr)' },
      gridTemplateAreas: { xs: '"thumb info" "actions actions"', sm: '"thumb" "info" "actions"' },
    }}>
      <Box
        onClick={() => play(videos[0])}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); play(videos[0]) } }}
        role="button" tabIndex={0} aria-label={`Play ${labels[0].toLowerCase()}: ${videos[0].title}`}
        sx={{
          gridArea: 'thumb', cursor: 'pointer', alignSelf: 'start', position: 'relative',
          m: { xs: 1, sm: 0 }, mr: { xs: 0, sm: 0 }, borderRadius: { xs: 1.5, sm: 0 }, overflow: 'hidden',
          ...PLAYABLE_HOVER, ...FOCUS_RING,
        }}
      >
        {/* 42% of a phone's width, or a third of the desktop column: the large poster only
            where the box is big enough to show it (see VideoThumb). */}
        <VideoThumb video={videos[0]} badge={34} sizes="(max-width: 599px) 42vw, 400px" />
        {anyNew && <NewTag />}
      </Box>
      <Box sx={{
        gridArea: 'info', minWidth: 0, p: { xs: 1, sm: 1.25 }, pb: { xs: 0.5, sm: 0.5 },
        display: 'grid', columnGap: 1, rowGap: 0.25, alignContent: 'start',
        gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'minmax(0, 1fr) auto' },
        gridTemplateAreas: { xs: '"score" "meta" "link"', sm: '"score link" "meta meta"' },
      }}>
        <Box sx={{ gridArea: 'score', display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0, flexWrap: 'wrap' }}>
          {side(away, game.away_team_id, game.away_score, awayWon)}
          <Typography sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 700, color: 'text.disabled' }}>@</Typography>
          {side(home, game.home_team_id, game.home_score, homeWon)}
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
            gridArea: 'link', justifySelf: 'start', alignSelf: 'center',
            display: 'inline-flex', alignItems: 'center', fontSize: TYPE_SCALE.meta, fontWeight: 800,
            color: 'var(--wpbl-accent-solid)', textDecoration: 'none',
            // The padding is the tap target, the negative margin keeps the text where it was.
            px: 0.75, mx: -0.75, py: 0.5, my: -0.5, borderRadius: 1,
            '@media (pointer: coarse)': { minHeight: 40 },
            ...hoverOnly({ textDecoration: 'underline' }), ...FOCUS_RING,
          }}>Box score ›</Box>
      </Box>
      <Box sx={{ gridArea: 'actions', px: { xs: 1, sm: 1.25 }, pb: 1.25, pt: { xs: 0.75, sm: 0.5 }, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
          {videos.map((v, i) => (
            <Box key={v.video_id} component="button" type="button" onClick={() => play(v)}
              sx={{
                display: 'inline-flex', alignItems: 'center', gap: 0.5, cursor: 'pointer',
                px: 1.1, py: 0.45, borderRadius: 999, border: '1px solid', borderColor: 'divider',
                bgcolor: 'background.paper', color: 'text.primary', font: 'inherit',
                fontSize: TYPE_SCALE.meta, fontWeight: 700, lineHeight: 1.4,
                '@media (pointer: coarse)': { minHeight: 38, px: 1.4 },
                ...hoverOnly({ borderColor: 'text.secondary' }), ...FOCUS_RING,
              }}>
              <Box component="span" aria-hidden sx={{ fontSize: '0.6rem' }}>▶</Box>{labels[i]}
              {fresh.isNew(v) && (
                <Box component="span" role="img" aria-label="new" sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'var(--wpbl-accent-solid)' }} />
              )}
            </Box>
          ))}
        </Box>
        {credit && credited && <VideoCreditLine credit={credit} what={videoKindName(credited)} />}
      </Box>
      {active && <HighlightLightbox video={active} onClose={() => setActive(null)} />}
    </Box>
  )
}

// ─── Clips ───────────────────────────────────────────────────────────────────

/**
 * The Shorts, newest first, in pages of thirty.
 *
 * Split at opening day, because the channel's Shorts are two different things either side of it:
 * before, the draft, tryouts and the build-up; from it, the season itself. Opening day is the
 * schedule's first game, not a date written here, so next season moves the line on its own.
 *
 * The club filter and the poster's club badge come from the clip tags (wpbl_video_tags), which
 * name a club for about half the Shorts. A clip with no club is under "All clubs" only: it is not
 * evidence of being about nobody, just of a title that did not say.
 */
function ClipsShelf({ clips, games, teams, onOpenGame, fresh }: {
  clips: WpblVideo[]; games: WpblGame[]; teams: WpblTeam[]
  onOpenGame: (g: WpblGame, ctx: { teams: WpblTeam[]; games: WpblGame[] }) => void
  fresh: Fresh
}) {
  const { tags } = useClipTags()
  const gameById = useMemo(() => new Map(games.map(g => [g.id, g])), [games])
  const teamById = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])
  const opening = useMemo(() => games.reduce<string | null>((min, g) => (!min || g.game_date < min ? g.game_date : min), null), [games])
  // Midnight Pacific on opening day, as UTC: the league's earliest time zone, so nothing posted on
  // opening day anywhere in the country falls before the line.
  const openingAt = opening ? `${opening}T07:00:00Z` : null
  const season = openingAt ? clips.filter(c => c.published_at >= openingAt) : clips
  const before = openingAt ? clips.filter(c => c.published_at < openingAt) : []
  const [phase, setPhase] = useState<'season' | 'before' | 'all'>('all')
  const [club, setClub] = useState('all')
  const [limit, setLimit] = useState(CLIPS_PAGE)
  const [active, setActive] = useState<number | null>(null)
  const byPhase = phase === 'season' ? season : phase === 'before' ? before : clips
  const clubOf = (v: WpblVideo) => tags.get(v.video_id)?.team_id ?? null
  const clubChips = teams
    .map(t => ({ team: t, count: byPhase.filter(v => clubOf(v) === t.id).length }))
    .filter(c => c.count > 0)
  // A club picked under one phase may have nothing under the next: fall back to every club
  // rather than show an empty grid with no chip explaining it.
  const activeClub = club !== 'all' && clubChips.some(c => c.team.id === club) ? club : 'all'
  const list = activeClub === 'all' ? byPhase : byPhase.filter(v => clubOf(v) === activeClub)
  const year = opening?.slice(0, 4) ?? ''
  const pick = (p: typeof phase) => { setPhase(p); setLimit(CLIPS_PAGE); track(EVENTS.WPBL_PAGE_CONTROL, { page: 'watch', control: 'clips', value: p }) }
  const pickClub = (id: string) => { setClub(id); setLimit(CLIPS_PAGE); track(EVENTS.WPBL_PAGE_CONTROL, { page: 'watch', control: 'clip_club', value: id }) }
  const play = (i: number) => { track(EVENTS.WPBL_HIGHLIGHT_PLAYED, { videoId: list[i].video_id, kind: 'clip', from: 'watch' }); fresh.opened(list[i]); setActive(i) }

  const current = active != null ? list[active] : undefined
  const currentTag = current ? tags.get(current.video_id) : undefined
  const currentGame = currentTag?.game_id ? gameById.get(currentTag.game_id) : undefined

  return (
    <>
      {before.length > 0 && season.length > 0 && (
        <ChipRow mb={1}>
          <FilterChip label={`All clips (${clips.length})`} active={phase === 'all'} onClick={() => pick('all')} />
          <FilterChip label={`${year} season (${season.length})`} active={phase === 'season'} onClick={() => pick('season')} />
          <FilterChip label={`Before the season (${before.length})`} active={phase === 'before'} onClick={() => pick('before')} />
        </ChipRow>
      )}
      {clubChips.length > 1 && (
        <ChipRow mb={1.75}>
          <FilterChip label="All clubs" active={activeClub === 'all'} onClick={() => pickClub('all')} />
          {clubChips.map(c => (
            <FilterChip key={c.team.id} label={`${c.team.name} (${c.count})`} active={activeClub === c.team.id} onClick={() => pickClub(c.team.id)} />
          ))}
        </ChipRow>
      )}
      <Box sx={{
        display: 'grid', gap: { xs: 0.75, sm: 1 },
        gridTemplateColumns: { xs: 'repeat(3, minmax(0, 1fr))', sm: 'repeat(4, minmax(0, 1fr))', md: 'repeat(5, minmax(0, 1fr))', lg: 'repeat(6, minmax(0, 1fr))' },
      }}>
        {list.slice(0, limit).map((v, i) => {
          const team = teamById.get(clubOf(v) ?? '')
          const isNew = fresh.isNew(v)
          return (
            <Box key={v.video_id}
              onClick={() => play(i)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); play(i) } }}
              role="button" tabIndex={0} aria-label={`Play${isNew ? ' new' : ''} clip: ${v.title}`}
              sx={{ position: 'relative', borderRadius: 2, overflow: 'hidden', cursor: 'pointer', ...PLAYABLE_HOVER, ...FOCUS_RING }}
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
      {list.length > limit && (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
          <Box component="button" type="button" onClick={() => setLimit(l => l + CLIPS_PAGE)} sx={{
            px: 2, py: 0.75, borderRadius: 999, border: '1px solid', borderColor: 'divider', cursor: 'pointer',
            bgcolor: 'background.paper', color: 'text.primary', font: 'inherit', fontSize: TYPE_SCALE.body, fontWeight: 700,
            ...hoverOnly({ borderColor: 'text.secondary' }), ...FOCUS_RING,
          }}>Show more ({list.length - limit} left)</Box>
        </Box>
      )}
      {active != null && current && (
        <HighlightLightbox
          video={current}
          onClose={() => setActive(null)}
          // Paging past the loaded thirty loads the next page, so the grid behind the lightbox
          // always holds the clip on screen when it closes.
          onPrev={active > 0 ? () => { fresh.opened(list[active - 1]); setActive(active - 1) } : undefined}
          onNext={active < list.length - 1 ? () => { fresh.opened(list[active + 1]); setLimit(l => Math.max(l, active + 2)); setActive(active + 1) } : undefined}
          context={<ClipContextLine
            text={clipLabel(currentTag, gameById, teamById)}
            action={currentGame && (
              <Box component="a" href={wpblGamePath(currentGame, teams, games)}
                onClick={(e: React.MouseEvent) => {
                  track(EVENTS.WPBL_PAGE_OPEN, { page: 'watch', section: 'clips', kind: 'game', value: currentGame.id })
                  if (isModified(e)) return
                  e.preventDefault()
                  setActive(null)
                  onOpenGame(currentGame, { teams, games })
                }}
                sx={{
                  fontSize: TYPE_SCALE.meta, fontWeight: 800, color: 'var(--wpbl-accent-solid)',
                  textDecoration: 'none', ...hoverOnly({ textDecoration: 'underline' }), ...FOCUS_RING,
                }}>Box score ›</Box>
            )}
          />}
        />
      )}
    </>
  )
}

// ─── More ────────────────────────────────────────────────────────────────────

function MoreShelf({ videos, fresh }: { videos: WpblVideo[]; fresh: Fresh }) {
  const [active, setActive] = useState<WpblVideo | null>(null)
  const groups = MORE_GROUPS.map(g => ({ ...g, items: videos.filter(g.test) })).filter(g => g.items.length > 0)
  const play = (v: WpblVideo) => { track(EVENTS.WPBL_HIGHLIGHT_PLAYED, { videoId: v.video_id, kind: v.kind, from: 'watch' }); fresh.opened(v); setActive(v) }
  return (
    <>
      {groups.map((grp, gi) => (
        <Box component="section" key={grp.key} sx={{ mt: gi === 0 ? 0 : 2.5 }}>
          <GroupHeading>{grp.label}</GroupHeading>
          <Box sx={{
            display: 'grid', gap: { xs: 1, sm: 1.5 },
            gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(3, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' },
          }}>
            {grp.items.map(v => {
              const credit = videoCredit(v)
              return (
                <Box key={v.video_id}
                  onClick={() => play(v)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); play(v) } }}
                  role="button" tabIndex={0} aria-label={`Play${fresh.isNew(v) ? ', new' : ''}: ${v.title}`}
                  sx={{
                    position: 'relative', border: '1px solid', borderColor: CARD_BORDER, borderRadius: 2, bgcolor: CARD_FILL, overflow: 'hidden',
                    cursor: 'pointer', ...hoverOnly({ borderColor: 'text.disabled' }), ...PLAYABLE_HOVER, ...FOCUS_RING,
                  }}
                >
                  <VideoThumb video={v} badge={34} />
                  {fresh.isNew(v) && <NewTag />}
                  <Box sx={{ p: 1, pt: 0.75 }}>
                    <Typography sx={{
                      fontSize: TYPE_SCALE.body, fontWeight: 600, lineHeight: 1.3,
                      display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                    }}>{v.title}</Typography>
                    <Typography sx={{ mt: 0.25, fontSize: TYPE_SCALE.micro, color: 'text.disabled', fontWeight: 700 }}>{videoDateLabel(v)}</Typography>
                    {credit && <Box sx={{ mt: 0.25 }}><VideoCreditLine credit={credit} /></Box>}
                  </Box>
                </Box>
              )
            })}
          </Box>
        </Box>
      ))}
      {active && <HighlightLightbox video={active} onClose={() => setActive(null)} />}
    </>
  )
}
