import { useEffect, useMemo, useState } from 'react'
import { Box, Skeleton, Typography } from '@mui/material'
import {
  fetchWpblGameLines, fetchWpblGameRecapPlays, fetchWpblFanPhotoIndex, getCachedWpblFanPhotoIndex,
  fetchWpblVideos, getCachedWpblVideos,
} from '../api'
import { buildRecap, leagueRecapContext, type GameRecap } from '../derive/recap'
import { seriesContext, seriesTileLine } from '../derive/series'
import { gameVideos } from '../videoChannels'
import { wpblWatchVideoPath } from '../routes'
import { useWpblGameLink, useWpblPlayerLink } from '../LinkContext'
import { TeamMark, PlayerPortrait, TYPE_SCALE, TAPPABLE, FOCUS_RING, chromePx, SectionCard } from '../ui'
import { AGATE_SX, HEADLINE_SX, MEDIA_RADIUS, DISPLAY_FONT } from '../../ui/card'
import { useLiveGame, SituationStrip, LiveMatchup, LIVE_RED, LIVE_TEXT } from '../Live'
import { deriveSituation, ORDINAL } from '../derive/liveSituation'
import { INK } from '../../ui/color'
import { NameText } from '../../ui/NameText'
import { linkTo, UNSTYLED_LINK } from '../../nav'
import { track, EVENTS } from '../../lib/analytics'
import { localeDate } from '../../lib/dateFormat'
import { wpblColor, wpblFullName, relativeDayLabel } from '../constants'
import type { FanPhotoWithSubjects } from '../fanPhotos'
import type { WpblGame, WpblTeam, WpblPlayer, WpblBattingLine, WpblPitchingLine, WpblRecapPlay, WpblVideo } from '../types'

/**
 * THE IN-SEASON HOME'S LEAD (Nov 13, 2026, ROADMAP-UI.md Home step 1): the latest final, set the way a
 * paper runs last night's game on its front. The kicker, the recap's headline in the serif, its first
 * sentence as the deck, the art, then the line score, the Star and the way into the recap.
 *
 * It replaces Last game, a framed card that drew the score as two club-color bands and sat in a grid
 * of four cards of one weight: the page had no story. The score is still the first fact on it, in the
 * line score under the art and in the strip above.
 *
 * THE ART IS A FIXED 16:9 BOX IN EVERY CASE, so the skeleton can reserve it and a late read moves
 * nothing: a fan photo from that game, else the league's video of it (a link to Watch), else the
 * winner's mark and the score on the winner's color, the way a broadcast prints a final.
 *
 * ONE COLUMN, HEAD FIRST, at every width: beside it on a desktop is the side column (Next game, the
 * standings, Latest), so the lead never gets the offseason lead's photo-and-text pair.
 */
export function RecapLead({ game, games, teams, players, onOpenGame, onOpenPlayer, art = true }: {
  game: WpblGame
  /** The whole schedule: the recap's verbs calibrate to the league's run environment, and the
   *  postseason kicker reads the series from it. */
  games: WpblGame[]
  teams: Map<string, WpblTeam>
  players: WpblPlayer[]
  onOpenGame: (g: WpblGame) => void
  onOpenPlayer: (p: WpblPlayer) => void
  /** The art box. Off under a live game, where this is the second story of the column. */
  art?: boolean
}) {
  const gameLink = useWpblGameLink()
  const playerLink = useWpblPlayerLink()
  const data = useGameLines(game.id)
  const byId = useMemo(() => new Map(players.map(p => [p.id, p])), [players])
  const nameOf = useMemo(() => (id: string) => byId.get(id)?.name ?? '—', [byId])
  const ctx = useMemo(() => leagueRecapContext(games), [games])
  const series = useMemo(() => seriesContext(game, games, teams), [game, games, teams])
  // Built before the box score lands too: the headline and the deck need only the score, so the
  // lead's words are there on first paint and the Star joins them when the lines arrive.
  const recap = useMemo(() => buildRecap(game, teams, data?.batting ?? [], data?.pitching ?? [], data?.plays ?? [], nameOf, ctx, series),
    [game, teams, data, nameOf, ctx, series])
  const away = teams.get(game.away_team_id), home = teams.get(game.home_team_id)
  if (!recap || !away || !home) return <RecapLeadSkeleton />

  const open = gameLink(game, onOpenGame)
  const star = recap.stars[0]
  const starPlayer = star ? byId.get(star.playerId) ?? null : null
  const seriesLine = series ? seriesTileLine(series, home.abbr, away.abbr) : null
  const kicker = `Final · ${seriesLine ?? relativeDayLabel(game.game_date)}`

  return (
    <Box component="article" aria-label={recap.headline} sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <Box {...open} sx={{ ...LINK_SX, display: 'block' }}>
        <Typography sx={KICKER_SX}>{kicker}</Typography>
        <Typography component="h3" sx={{ ...HEADLINE_SX, fontSize: HEADLINE_SIZE, lineHeight: 1.05, textWrap: 'balance', mt: 0.5 }}>
          {recap.headline}
        </Typography>
        <Typography sx={{ ...DECK_SX, mt: 1 }}>{firstSentence(recap.blurb)}</Typography>
      </Box>

      {art && <LeadArt game={game} recap={recap} open={open} />}

      <Box sx={{ minHeight: BODY_H, display: 'flex', flexDirection: 'column' }}>
        <LineScore recap={recap} away={away} home={home} open={open} />

        {/* The Star, a real link to the player page, since a player page is what readers open most.
            The lines land after first paint, so the row holds its shape until they do. */}
        <Box sx={{ mt: 1.5, pt: 1.25, borderTop: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1.25, minHeight: chromePx(56) }}>
          {star && starPlayer ? (
            <Box {...playerLink(starPlayer, (p: WpblPlayer) => { track(EVENTS.WPBL_HOME_PLAYER_OPEN, { card: 'game_star', playerId: p.id }); onOpenPlayer(p) })} sx={{
              ...LINK_SX, flex: 1, display: 'flex', alignItems: 'center', gap: 1.25,
            }}>
              <PlayerPortrait name={starPlayer.name} teamId={star.teamId} size={56} print />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={LABEL_SX}>Star of the game</Typography>
                <NameText name={starPlayer.name} component="p" sx={{ fontSize: TYPE_SCALE.heading, fontWeight: 700, lineHeight: 1.25 }} />
                <Typography noWrap sx={{ ...AGATE_SX, fontSize: TYPE_SCALE.meta, color: 'text.secondary', lineHeight: 1.3 }}>{star.statline}</Typography>
              </Box>
            </Box>
          ) : data ? null : (
            <>
              <Skeleton variant="rectangular" sx={{ width: chromePx(56), height: chromePx(56), flexShrink: 0 }} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={LABEL_SX}>Star of the game</Typography>
                <Skeleton variant="text" width="8rem" sx={{ fontSize: TYPE_SCALE.heading }} />
              </Box>
            </>
          )}
        </Box>

        <Box {...open} sx={{ ...LINK_SX, mt: 1.5, alignSelf: 'flex-start' }}>
          <Typography sx={{ fontSize: TYPE_SCALE.body, fontWeight: 700 }}>Full recap ›</Typography>
        </Box>
      </Box>
    </Box>
  )
}

/** The lead before the schedule has a final to lead with, at the loaded lead's heights. */
export function RecapLeadSkeleton() {
  return (
    <Box aria-hidden sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <Box>
        <Skeleton variant="text" width="30%" sx={{ fontSize: TYPE_SCALE.micro }} />
        <Skeleton variant="text" width="85%" sx={{ fontSize: HEADLINE_SIZE, lineHeight: 1.05, mt: 0.5 }} />
        <Skeleton variant="text" width="70%" sx={{ ...DECK_SX, mt: 1 }} />
      </Box>
      <Box sx={ART_BOX_SX}><Skeleton variant="rectangular" sx={{ width: '100%', height: '100%' }} /></Box>
      <Typography sx={CAPTION_SX}>{NBSP}</Typography>
      <Box sx={{ minHeight: BODY_H }} />
    </Box>
  )
}

/** A no-break space: holds a line's height with nothing in it. */
const NBSP = ' '

const LINK_SX = { ...UNSTYLED_LINK, color: 'inherit', textDecoration: 'none', borderRadius: 1, minWidth: 0, ...TAPPABLE, ...FOCUS_RING } as const
const KICKER_SX = { fontSize: TYPE_SCALE.micro, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'text.secondary', lineHeight: 1.3 } as const
const LABEL_SX = { fontSize: TYPE_SCALE.meta, color: 'text.secondary', lineHeight: 1.3 } as const
const DECK_SX = { fontSize: TYPE_SCALE.title, lineHeight: 1.4, color: 'text.secondary', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' } as const
const CAPTION_SX = { ...AGATE_SX, mt: 0.5, fontSize: TYPE_SCALE.meta, lineHeight: 1.4 } as const
const HEADLINE_SIZE = { xs: TYPE_SCALE.hero, md: '2.75rem' } as const
const ART_BOX_SX = { position: 'relative', overflow: 'hidden', aspectRatio: '16 / 9', borderRadius: MEDIA_RADIUS, mt: 1.5 } as const

/** The body (the line score, the Star, the recap link) at its loaded height, so the skeleton holds
 *  it. The head takes its own height: a fixed one left a hole under a one-line headline, and the
 *  skeleton draws the usual one line of headline and one of deck. In rem: all of it is type. */
const BODY_H = '13.2rem'

/** The recap's first sentence, for the deck: the rest is the recap's. */
function firstSentence(text: string): string {
  const m = text.match(/^.+?[.!?](?=\s|$)/)
  return m ? m[0] : text
}

/** The game's box score and play log, for the Star; null until both answer. One read per game. */
function useGameLines(gameId: string) {
  const [data, setData] = useState<{ id: string; batting: WpblBattingLine[]; pitching: WpblPitchingLine[]; plays: WpblRecapPlay[] } | null>(null)
  useEffect(() => {
    let live = true
    Promise.all([fetchWpblGameLines(gameId), fetchWpblGameRecapPlays(gameId)])
      .then(([l, plays]) => { if (live) setData({ id: gameId, batting: l.batting, pitching: l.pitching, plays }) })
      .catch(() => { /* the lead keeps its words and drops the Star */ })
    return () => { live = false }
  }, [gameId])
  return data?.id === gameId ? data : null
}

/** A photo from the game, landscape first; the curated order breaks ties. */
function gamePhoto(photos: FanPhotoWithSubjects[] | undefined): FanPhotoWithSubjects | null {
  if (!photos?.length) return null
  return photos.find(p => (p.width ?? 0) > (p.height ?? 0)) ?? null
}

/** The art's source, read from the session caches first so a warm Home paints it at once. */
function useLeadArt(gameId: string): { photo: FanPhotoWithSubjects | null; video: WpblVideo | null; settled: boolean } {
  const [index, setIndex] = useState(() => getCachedWpblFanPhotoIndex())
  const [videos, setVideos] = useState(() => getCachedWpblVideos())
  useEffect(() => {
    let live = true
    fetchWpblFanPhotoIndex().then(i => { if (live) setIndex(i) }).catch(() => { if (live) setIndex(null) })
    fetchWpblVideos().then(v => { if (live) setVideos(v) }).catch(() => { if (live) setVideos([]) })
    return () => { live = false }
  }, [])
  return useMemo(() => {
    const photo = index ? gamePhoto(index.byGame.get(gameId)) : null
    const video = !photo && videos ? gameVideos(videos, gameId).find(v => v.is_short !== true) ?? null : null
    return { photo, video, settled: !!index && !!videos }
  }, [index, videos, gameId])
}

function LeadArt({ game, recap, open }: { game: WpblGame; recap: GameRecap; open: object }) {
  const { photo, video, settled } = useLeadArt(game.id)
  const [shown, setShown] = useState<string | null>(null)
  const winner = recap.winner.id
  const field = wpblColor(winner)

  if (photo) {
    const loaded = shown === photo.id
    const day = photo.taken_on ? localeDate(new Date(`${photo.taken_on}T12:00:00Z`), 'en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : null
    return (
      <Box component="figure" sx={{ m: 0, minWidth: 0 }}>
        <Box {...open} aria-label={recap.headline} sx={{ ...LINK_SX, display: 'block', borderRadius: MEDIA_RADIUS }}>
          <Box sx={{ ...ART_BOX_SX, bgcolor: field }}>
            {/* THE PAGE'S LARGEST PAINT in season, so it goes first and at the size drawn: 7/12 of
                Home's width from md, the full width below. */}
            <Box component="img" src={photo.full_url} alt="" aria-hidden onLoad={() => setShown(photo.id)}
              srcSet={`${photo.card_url} 800w, ${photo.full_url} 1600w`}
              sizes="(min-width: 900px) 55vw, 100vw" fetchPriority="high" loading="eager"
              sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 35%', opacity: loaded ? 1 : 0, transition: 'opacity 0.3s' }} />
          </Box>
        </Box>
        <Box component="figcaption" sx={{ display: 'flex', gap: 1.5, alignItems: 'baseline', minWidth: 0 }}>
          <Typography noWrap sx={{ ...CAPTION_SX, flex: 1, minWidth: 0 }}>
            {photo.caption?.trim() || (day ? `${wpblFullName(recap.winner)}, ${day}` : wpblFullName(recap.winner))}
          </Typography>
          {photo.credit && (
            <Typography noWrap sx={{ ...CAPTION_SX, flexShrink: 0, fontWeight: 500, color: 'text.secondary' }}>Photo: {photo.credit}</Typography>
          )}
        </Box>
      </Box>
    )
  }

  if (video) {
    const poster = `https://i.ytimg.com/vi/${video.video_id}/hqdefault.jpg`
    const large = video.thumbnail_url && video.thumbnail_url !== poster ? video.thumbnail_url : null
    return (
      <Box component="figure" sx={{ m: 0, minWidth: 0 }}>
        <Box {...linkTo(wpblWatchVideoPath(video.video_id), () => track(EVENTS.WPBL_LATEST_OPEN, { kind: 'lead-video' }))}
          aria-label={`Watch: ${video.title}`} sx={{ ...LINK_SX, display: 'block', borderRadius: MEDIA_RADIUS }}>
          <Box sx={{ ...ART_BOX_SX, bgcolor: field }}>
            <Box component="img" src={poster} alt="" aria-hidden fetchPriority="high" loading="eager"
              {...(large ? { srcSet: `${poster} 480w, ${large} 1280w`, sizes: '(min-width: 900px) 55vw, 100vw' } : {})}
              sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
            <PlayMark />
          </Box>
        </Box>
        <Typography noWrap sx={CAPTION_SX}>Watch: {video.title}</Typography>
      </Box>
    )
  }

  // NOTHING TO SHOW, OR NOT YET: the winner's mark and the score on its color. Drawn while the two
  // reads are out as well, rather than a gray box that then turns into it.
  const loser = recap.loser.id
  return (
    <Box sx={{ m: 0, minWidth: 0 }}>
      <Box {...open} aria-label={recap.headline} sx={{ ...LINK_SX, display: 'block', borderRadius: MEDIA_RADIUS }}>
        <Box sx={{ ...ART_BOX_SX, bgcolor: field, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6%' }}>
          {settled && (
            <>
              <TeamMark team={recap.winner} size={120} ink={INK.white} />
              <Typography aria-hidden sx={{ ...AGATE_SX, fontFamily: DISPLAY_FONT, fontWeight: 700, fontSize: { xs: `calc(${TYPE_SCALE.lead} * 1.15)`, md: `calc(${TYPE_SCALE.lead} * 1.85)` }, lineHeight: 1, color: INK.white }}>
                {recap.winnerScore}–{recap.loserScore}
              </Typography>
              <Box sx={{ opacity: 0.55 }}><TeamMark team={{ id: loser, abbr: recap.loser.abbr }} size={72} ink={INK.white} /></Box>
            </>
          )}
        </Box>
      </Box>
      <Typography sx={CAPTION_SX}>{NBSP}</Typography>
    </Box>
  )
}

/** A play triangle in a square, the rail arrows' shape, so the poster reads as a video. */
function PlayMark() {
  return (
    <Box aria-hidden sx={{
      position: 'absolute', left: 16, bottom: 16, width: 48, height: 48, bgcolor: 'rgba(0,0,0,0.72)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <Box component="svg" viewBox="0 0 24 24" sx={{ width: 22, height: 22, fill: INK.white }}><path d="M8 5v14l11-7z" /></Box>
    </Box>
  )
}

/** R H E per club, as a box score heads its game: away over home, the winner in full ink. */
function LineScore({ recap, away, home, open }: { recap: GameRecap; away: WpblTeam; home: WpblTeam; open: object }) {
  const lineOf = (t: WpblTeam) => recap.teamLine.find(l => l.teamId === t.id)
  const cell = { ...AGATE_SX, fontSize: TYPE_SCALE.body, textAlign: 'right' } as const
  const head = { ...AGATE_SX, fontSize: TYPE_SCALE.micro, fontWeight: 700, color: 'text.secondary', textAlign: 'right', letterSpacing: '0.04em' } as const
  const row = (t: WpblTeam) => {
    const l = lineOf(t)
    const won = recap.winner.id === t.id
    const ink = won ? 'text.primary' : 'text.secondary'
    return (
      <Box key={t.id} sx={{ ...GRID_SX, py: 0.6, borderTop: '1px solid', borderColor: 'divider' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
          <TeamMark team={t} size={22} />
          <Typography noWrap sx={{ fontSize: TYPE_SCALE.body, fontWeight: won ? 700 : 600, color: ink, minWidth: 0 }}>{wpblFullName(t)}</Typography>
        </Box>
        <Typography sx={{ ...cell, fontSize: TYPE_SCALE.heading, fontWeight: won ? 800 : 600, color: ink }}>{l?.r ?? ''}</Typography>
        <Typography sx={{ ...cell, color: 'text.secondary' }}>{l?.h ?? ''}</Typography>
        <Typography sx={{ ...cell, color: 'text.secondary' }}>{l?.e ?? ''}</Typography>
      </Box>
    )
  }
  return (
    <Box {...open} sx={{ ...LINK_SX, display: 'block', mt: 1.5 }}>
      <Box sx={{ ...GRID_SX, pb: 0.25 }}>
        <span />
        <Typography sx={head}>R</Typography>
        <Typography sx={head}>H</Typography>
        <Typography sx={head}>E</Typography>
      </Box>
      {row(away)}
      {row(home)}
    </Box>
  )
}

const GRID_SX = { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 3ch 3ch 3ch', columnGap: 1.5, alignItems: 'baseline' } as const

/** The section the lead sits in: a heading for screen readers only, as the offseason lead has. */
export function LeadSection({ title = 'Last game', children }: { title?: string; children: React.ReactNode }) {
  return <SectionCard title={title} fill headingHidden>{children}</SectionCard>
}

/**
 * THE LEAD WHILE A GAME IS ON (Nov 13, 2026): the live game set as the front page sets a story, not
 * the framed red card it was (LiveHero, still drawn over the offseason page). A red kicker with the
 * inning, the two clubs and their runs at headline size, the inning-by-inning line, then the
 * situation and who is up. The whole lead opens Game Center.
 */
export function LiveLead({ game: seed, teams, players, onOpenGame }: {
  game: WpblGame
  teams: Map<string, WpblTeam>
  players: WpblPlayer[]
  onOpenGame: (g: WpblGame) => void
}) {
  const gameLink = useWpblGameLink()
  const game = useLiveGame(seed)
  const away = teams.get(game.away_team_id), home = teams.get(game.home_team_id)
  if (!away || !home) return <RecapLeadSkeleton />
  const s = game.live_state ? deriveSituation(game.live_state, away, home, { away: game.away_line, home: game.home_line }) : null
  const open = gameLink(game, onOpenGame)
  const when = s ? (s.between && s.breakLabel ? s.breakLabel : `${s.half === 'top' ? 'Top' : 'Bottom'} ${ORDINAL(s.inning)}`) : 'In progress'
  const innings = Math.max(7, ...(game.away_line ?? []).map(e => e.inning), ...(game.home_line ?? []).map(e => e.inning))
  const runsIn = (line: WpblGame['away_line'], i: number) => line?.find(e => e.inning === i)?.runs
  const scoreLine = (t: WpblTeam, runs: number, batting: boolean) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, py: 0.75, borderTop: '1px solid', borderColor: 'divider' }}>
      <TeamMark team={t} size={40} />
      <Typography noWrap sx={{ fontSize: { xs: TYPE_SCALE.display, md: TYPE_SCALE.page }, fontWeight: 700, minWidth: 0 }}>{wpblFullName(t)}</Typography>
      {batting && <Box aria-label="At bat" role="img" sx={{ width: 8, height: 8, flexShrink: 0, borderRadius: '50%', bgcolor: LIVE_RED }} />}
      <Box sx={{ flex: 1 }} />
      <Typography sx={{ fontFamily: DISPLAY_FONT, fontWeight: 700, fontSize: { xs: TYPE_SCALE.hero, md: TYPE_SCALE.lead }, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{runs}</Typography>
    </Box>
  )
  // The line score by inning, as a box score heads its game: the clubs' abbreviations, an inning a
  // column, and the runs at the end. Innings not reached yet hold their column empty.
  const cols = `minmax(0, 1fr) repeat(${innings}, 2.5ch) 3.5ch`
  const head = { ...AGATE_SX, fontSize: TYPE_SCALE.micro, fontWeight: 700, color: 'text.secondary', textAlign: 'center' } as const
  const lineRow = (t: WpblTeam, line: WpblGame['away_line'], runs: number) => (
    <Box sx={{ display: 'grid', gridTemplateColumns: cols, columnGap: 0.5, py: 0.25 }}>
      <Typography sx={{ ...AGATE_SX, fontSize: TYPE_SCALE.meta }}>{t.abbr}</Typography>
      {Array.from({ length: innings }, (_, i) => (
        <Typography key={i} sx={{ ...AGATE_SX, fontSize: TYPE_SCALE.meta, color: 'text.secondary', textAlign: 'center' }}>{runsIn(line, i + 1) ?? ''}</Typography>
      ))}
      <Typography sx={{ ...AGATE_SX, fontSize: TYPE_SCALE.meta, fontWeight: 800, textAlign: 'center' }}>{runs}</Typography>
    </Box>
  )
  return (
    <Box component="article" aria-label={`Live: ${wpblFullName(away)} ${game.away_score ?? 0}, ${wpblFullName(home)} ${game.home_score ?? 0}`}
      {...open} sx={{ ...LINK_SX, display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <Box aria-hidden sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: LIVE_RED, '@keyframes wpblpulse': { '0%': { opacity: 1 }, '50%': { opacity: 0.3 }, '100%': { opacity: 1 } }, animation: 'wpblpulse 1.5s ease-in-out infinite' }} />
        <Typography sx={{ ...KICKER_SX, color: LIVE_TEXT }}>Live · {when}</Typography>
      </Box>
      <Box sx={{ mt: 1.5 }}>
        {scoreLine(away, game.away_score ?? 0, !!s && !s.between && s.battingTeam.id === away.id)}
        {scoreLine(home, game.home_score ?? 0, !!s && !s.between && s.battingTeam.id === home.id)}
      </Box>
      <Box aria-hidden sx={{ mt: 0.5, pt: 0.75, borderTop: '1px solid', borderColor: 'divider' }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: cols, columnGap: 0.5 }}>
          <span />
          {Array.from({ length: innings }, (_, i) => <Typography key={i} sx={head}>{i + 1}</Typography>)}
          <Typography sx={head}>R</Typography>
        </Box>
        {lineRow(away, game.away_line, game.away_score ?? 0)}
        {lineRow(home, game.home_line, game.home_score ?? 0)}
      </Box>
      {s && (
        <Box sx={{ mt: 1.5, display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 3, rowGap: 1 }}>
          <SituationStrip s={s} />
          {!s.between && <LiveMatchup s={s} players={players} />}
        </Box>
      )}
      <Typography sx={{ mt: 1.5, fontSize: TYPE_SCALE.body, fontWeight: 700 }}>Game Center ›</Typography>
    </Box>
  )
}
