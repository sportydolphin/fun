import { useDark } from '../../ui/useDark'
import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { edge } from '../../ui/card'
import { Box, Typography, Skeleton, alpha } from '@mui/material'
import { EmojiEventsOutlined } from '@mui/icons-material'
import { computeStandings, fetchWpblLinesForGames,
} from '../api'
import { seriesStar, type SeriesStar } from '../derive/seriesStar'
import { NameText } from '../../ui/NameText'
import { wpblColor, wpblAccent, wpblSurface, wpblFullName, formatGameTime, relativeDayShort } from '../constants'
import { useWpblGameLink, useWpblPlayerLink } from '../LinkContext'
import { WPBL_SEASON_PAGE, WPBL_RECAP_YEARS, wpblSeasonPath } from '../routes'
import { SectionCard, TeamBadge, PlayerPortrait, chromePx, INNER_BORDER, TAPPABLE, hoverOnly, FOCUS_RING, TYPE_SCALE, ICON_SIZE, CLUB_BAND, CARD_LINK_SX } from '../ui'
import { BEST_OF, buildBracket, championResult, championshipGames, aliveContenders, winsNeeded, type WpblBracket, type BracketSeries, type ChampionResult } from '../derive/bracket'
import { track, trackImpression, EVENTS } from '../../lib/analytics'
import type { WpblTeam, WpblPlayer, WpblGame } from '../types'
import { typePx } from '../../ui/scale'
import { latestSeason } from '../season'
import { ordinal } from '../percentiles'
import { trackedLinkTo } from './shared'

/**
 * Next game, when the only games left are ones the league has dated and not yet published.
 *
 * THE SAME CARD IN THE SAME SLOT, deliberately. Home's grid pairs Next game with the card beside
 * it and takes the taller of the two for both columns, so a card that vanishes does not free its
 * space, it leaves a hole in the middle of the page, through the part of the season anybody is
 * checking daily.
 *
 * WHAT IT WILL NOT DO IS PRETEND. There is no `wpbl_games` row behind this, so:
 *
 *   - nothing is clickable. The real card's whole body opens the game page; there is no page.
 *   - no reminder row and no feed-delay note. Both are keyed on a game id, and a countdown
 *     that has run out on a game the feed has never heard of is not a story about a late feed.
 *   - a club is named only once its seed can no longer move. `postseasonScheduleRows` decides
 *     that per seed, and the reason is on it: the bracket card may project because it reads as
 *     a projection, and a fixture card reads as fact.
 *
 * AWAY OVER HOME WHERE THE LEAGUE HAS DESIGNATED ONE, seed order where it has not, which is
 * `postseasonSlots` and is the same rule the schedule rows and the scoreboard chip follow. What
 * is never left silent is a pairing whose two seeds are still being argued over, because that a
 * reader cannot infer.
 *
 * NO "@", AND NOTHING IN ITS PLACE, the same call `NextGameCard` and the scoreboard strip make:
 * away over home is how a fixture is written, the rows are stacked in that order, and a card
 * whose whole point is the next game does not need a character to say which club is at home.
 */
/**
 * The season, in one card, once there are no games ahead.
 *
 * It takes the Next-game slot from the moment the final goes live (see the pivot in
 * `NextGameCard`): with no next game to count down to, the card that led "what is on" leads "what
 * happened" instead. Champion-first once the title is decided, the season's framing while the
 * final is still being played, and either way the offseason's one route from Home into the full
 * recap at `/wpbl/season` (which the More menu and the footer also link).
 *
 * Self-contained on `games` + `teams`: the standings and the bracket are a few maps over the
 * schedule it already holds, so computing them here keeps it a drop-in for the slot rather than
 * another prop threaded down through `NextGameCard`. A real `<a href>` via `trackedLinkTo`, the
 * crawl-path rule the league card and the footer follow.
 */
/** The stakes on a live championship game, or null while nobody is a win from the title yet:
 *  "Winner takes the title" when the series is level at the brink (a 2-2 in a best-of-five), else
 *  "<club> can clinch" when one club leads and can end it. `winsNeeded` keeps it right if the
 *  series length ever changes. */
function finalTitleStake(series: BracketSeries): string | null {
  const need = winsNeeded('championship')
  const { home: h, away: a } = series
  if (Math.max(h.wins, a.wins) !== need - 1) return null
  if (h.wins === a.wins) return 'Winner takes the title'
  const lead = h.wins > a.wins ? h : a
  return lead.team ? `${lead.team.name} can clinch` : null
}

export function SeasonRecapPreviewCard({ teams, games, devChampion, onOpenGame, players, onOpenPlayer }: {
  teams: Map<string, WpblTeam>; games: WpblGame[]
  onOpenGame: (g: WpblGame) => void
  players: WpblPlayer[]; onOpenPlayer: (p: WpblPlayer) => void
  /** Dev only: a simulated champion to headline instead of the real one, with no series line
   *  since a random winner is not the club that actually led the final. Null (or absent) shows
   *  whatever the real bracket gives, which is the pre-champion state while the final is on. */
  devChampion?: WpblTeam | null
}) {
  const isDark = useDark()
  const teamList = useMemo(() => [...teams.values()], [teams])
  const standings = useMemo(() => computeStandings(teamList, games), [teamList, games])
  const bracket = useMemo(() => buildBracket(standings, games), [standings, games])
  const realChamp = useMemo(() => bracket ? championResult(bracket) : null, [bracket])
  // The dev simulation headlines its own club with no series line; otherwise the real champion,
  // which carries one. Either resolves to a club to headline, or none for the pre-champion state.
  const champTeam = devChampion ?? realChamp?.champion ?? null
  const series = devChampion ? null : realChamp
  // The title series is being played RIGHT NOW: the recap card only reaches its pre-champion state
  // when the postseason calendar is exhausted, so a live championship series (started, no winner)
  // means the final is under way. This is the one moment the card should lead with the game rather
  // than the recap. `status === 'live'` guarantees both finalists are known. Not while a dev forces
  // a champion, which takes precedence.
  const finalSeries = bracket?.championship ?? null
  const finalInProgress = !champTeam && !!finalSeries && finalSeries.status === 'live'
  // The regular-season leader, for the teaser line while the title is not yet decided. `rows[0]`
  // is first by the same `computeStandings` the Standings tab and card use, so the three agree.
  const leader = standings[0] ?? null
  // The title-series games, for the in-progress and finished bodies' logs. Computed whenever the
  // championship pairing is known (both finalists), which is the only time either body draws.
  const finalLog = useMemo(
    () => finalSeries?.home.team && finalSeries?.away.team
      ? championshipGames(games, finalSeries.home.team.id, finalSeries.away.team.id)
      : [],
    [finalSeries, games])
  const star = useFinalStar(champTeam?.id ?? null, finalLog)

  const shown = useRef(false)
  useEffect(() => {
    if (shown.current) return
    shown.current = true
    trackImpression(EVENTS.WPBL_SEASON_CARD_SHOWN, { champion: champTeam?.id ?? null })
  }, [champTeam])

  // The year this card is about, which is the year `games` holds: Home hands it the current season.
  // Its recap has a page of its own once the season is over; until then the bare URL stands in.
  const year = useMemo(() => latestSeason(games), [games])
  const recap = trackedLinkTo(
    year != null && WPBL_RECAP_YEARS.includes(year) ? wpblSeasonPath(year) : WPBL_SEASON_PAGE,
    EVENTS.WPBL_SEASON_CARD_OPEN, { from: 'home' })
  const yearWord = year != null ? `${year} ` : ''
  // A body with the title series' games in it cannot be one link: the games are links of their
  // own, and an anchor inside an anchor is invalid HTML that the parser repairs by splitting the
  // outer one, so the card would come out in fragments. Those bodies put the recap link on each
  // of their other blocks instead (see `RecapLink`); only the off-season text is one link whole.
  const split = finalInProgress || !!champTeam

  // THE SPLIT BODIES PUT THE RECAP IN THE HEADER, where Reading and Compare put their way on. A solid
  // button across the foot competed with the champion for the eye, and it was the only one on Home.
  // The pre-champion body keeps its button: there the whole card is one anchor, so the link cannot
  // also be a second anchor in the header.
  const headerLink = split
    ? <Box {...recap} sx={CARD_LINK_SX}>{finalInProgress ? 'Season so far ›' : 'Recap ›'}</Box>
    : undefined

  return (
    <SectionCard title={`${yearWord}Season`} fill action={headerLink}>
      {/* The whole body is the link, the way the league card's is: a card whose one job is to send
          a reader to the recap should open it from anywhere on the card, not just a trailing word.
          `flex: 1` + centred so it absorbs whatever height the card beside it (Last game) forces,
          the same trick the real Next-game card uses in this slot. */}
      <Box
        {...(split ? {} : recap)}
        sx={{
          flex: 1, display: 'flex', flexDirection: 'column', gap: 1.25,
          // TOP-ALIGNED WHENEVER THERE ARE BLOCKS, and the slack falls under the last one. This card is
          // stretched to the height of Player of the day beside it; `space-between` used to spread
          // that slack between the champion and its own result, so the gaps on the card were sized
          // by a different card's content. Centred only for the off-season line or two.
          justifyContent: split ? 'flex-start' : 'center',
          textDecoration: 'none', color: 'inherit', borderRadius: 1, p: 0.5, mx: -0.5,
          ...(split ? null : TAPPABLE),
        }}
      >
        {finalInProgress && finalSeries ? (
          <ChampionshipInProgressBody series={finalSeries} teams={teams} log={finalLog} recap={recap} onOpenGame={onOpenGame} />
        ) : champTeam ? (
          <ChampionRecapBody champion={champTeam} series={series} teams={teams} log={finalLog} isDark={isDark} yearWord={yearWord}
            path={titlePath(champTeam, standings, bracket)} recap={recap} onOpenGame={onOpenGame}
            star={star} players={players} onOpenPlayer={onOpenPlayer} />
        ) : (
          <>
            <Typography sx={{ fontSize: TYPE_SCALE.display, fontWeight: 800, lineHeight: 1.15 }}>
              The season, in full
            </Typography>

            {/* One line of fact so the card is not a bare link: the club that led the regular season. */}
            {leader ? (
              <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.secondary' }}>
                {wpblFullName(leader.team)} finished on top at {leader.wins}–{leader.losses}.
              </Typography>
            ) : null}

            <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.secondary' }}>
              The final table and the race to it, the leaders, and the plays the season turned on.
            </Typography>

            <RecapButton>{`Read the ${yearWord}recap`}</RecapButton>
          </>
        )}
      </Box>
    </SectionCard>
  )
}

/** The in-progress card's body: the title series as a scoreboard, so the height the slot gives it
 *  carries the series rather than white space. A gold "in progress" eyebrow, the two clubs with
 *  their series wins, the stakes, and a game-by-game log; the CTA pins to the bottom. */
function ChampionshipInProgressBody({ series, teams, log, recap, onOpenGame }: {
  series: BracketSeries; teams: Map<string, WpblTeam>; log: WpblGame[]
  recap: RecapLinkProps; onOpenGame: (g: WpblGame) => void
}) {
  const isDark = useDark()
  const home = series.home.team, away = series.away.team
  if (!home || !away) return null
  const stake = finalTitleStake(series)

  const clubRow = (t: WpblTeam, wins: number, leads: boolean) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 0.85, bgcolor: wpblSurface(t.id, isDark) }}>
      <TeamBadge team={t} size={26} />
      <Typography noWrap sx={{ flex: 1, minWidth: 0, fontSize: TYPE_SCALE.body, fontWeight: 700 }}>{wpblFullName(t)}</Typography>
      <Typography sx={{
        fontSize: TYPE_SCALE.display, fontWeight: 900, fontVariantNumeric: 'tabular-nums',
        color: leads ? 'text.primary' : 'text.secondary',
      }}>{wins}</Typography>
    </Box>
  )

  return (
    <>
      <RecapLink recap={recap}>
        {/* Gold "in progress" eyebrow with a live pulse, so it reads as happening rather than as a fixture. */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, '@keyframes wpblpulse': { '0%': { opacity: 1 }, '50%': { opacity: 0.3 }, '100%': { opacity: 1 } } }}>
          <Box aria-hidden sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'var(--wpbl-medal-1)', animation: 'wpblpulse 1.5s ease-in-out infinite' }} />
          <Typography sx={{
            fontSize: TYPE_SCALE.micro, fontWeight: 900, letterSpacing: typePx(1), textTransform: 'uppercase',
            color: 'var(--wpbl-medal-1)',
          }}>Championship · in progress</Typography>
        </Box>

        {/* The two clubs and the series score, in the section's club-band treatment. */}
        <Box sx={CLUB_BAND}>
          {clubRow(home, series.home.wins, series.home.wins > series.away.wins)}
          {clubRow(away, series.away.wins, series.away.wins > series.home.wins)}
        </Box>

        <Typography sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 600, color: 'text.secondary' }}>
          Best of {BEST_OF.championship}{stake ? ` · ${stake}` : ''}
        </Typography>
      </RecapLink>

      <SeriesGameLog log={log} teams={teams} onOpenGame={onOpenGame} />
    </>
  )
}

type RecapLinkProps = ReturnType<typeof trackedLinkTo>

/** One block of the season card that opens the recap. The card used to be a single anchor; now
 *  that its games open their own box scores it is several, and each carries the same link and
 *  event, so the card still opens the recap from anywhere that is not a game. No padding of its
 *  own, so a full-bleed club band inside it still bleeds to the card edge. */
function RecapLink({ recap, sx, children }: { recap: RecapLinkProps; sx?: object; children: React.ReactNode }) {
  return (
    <Box {...recap} sx={{
      display: 'flex', flexDirection: 'column', gap: 1.25, borderRadius: 1,
      textDecoration: 'none', color: 'inherit', ...TAPPABLE, ...FOCUS_RING, ...sx,
    }}>{children}</Box>
  )
}

/** The recap's call to action for the pre-champion body, as a solid button across the card's foot.
 *
 *  Only the LOOK of a button: that body is one anchor already, and a second anchor inside it would
 *  be invalid. The split bodies (final in progress, champion) carry the recap in the card header
 *  instead, because there it sat under the champion as a second headline. */
function RecapButton({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.75,
      mt: 0.5, px: 2, py: 1.1, borderRadius: 1.5,
      bgcolor: 'var(--wpbl-accent-solid)', color: '#fff', textDecoration: 'none',
      cursor: 'pointer', userSelect: 'none',
      boxShadow: '0 1px 6px -1px color-mix(in srgb, var(--wpbl-accent-solid) 55%, transparent)',
      transition: 'transform 120ms ease, filter 120ms ease',
      '&:active': { transform: 'scale(0.98)' },
      ...hoverOnly({ filter: 'brightness(1.08)', transform: 'translateY(-1px)' }),
      // The off-season card is the anchor around this, so its hover lifts the button too.
      'a:hover > &': { filter: 'brightness(1.08)' },
    }}>
      <Typography sx={{ fontSize: TYPE_SCALE.title, fontWeight: 900, color: 'inherit' }}>{children}</Typography>
      {/* Ornament, hidden from the accessibility tree: the label already says where this goes. */}
      <Box aria-hidden sx={{ fontSize: TYPE_SCALE.title, fontWeight: 900, lineHeight: 1 }}>&#8250;</Box>
    </Box>
  )
}

/** The championship series, game by game, each one a way into its Game Center.
 *
 *  ONE ROW OF EQUAL TILES, each a small box score: the game and its date, then both clubs with
 *  their runs, the winner in its colour and the loser in secondary ink. It was two columns of
 *  "GAME 1  LA 7 @ SF 6  ›" chips, which left a five-game final with an orphan in the last row and
 *  most of every chip blank between the score and its chevron. A row of five spends the width;
 *  stacking the two clubs spends height the card has spare beside Player of the day, and keeps
 *  the batting order (away over home, as a line score reads). The winner's colour runs along the
 *  tile's top, so the series reads left to right as a run of colours before any number is read.
 *  One still to come shows the clubs with no runs.
 *
 *  Badges and dates only from `lg` up: five tiles in the half-width card at 960px are about 80px,
 *  and on a phone about 60px; either holds "LA 11" and no more. The full line is the tile's
 *  accessible name. Shared by the
 *  in-progress and the champion bodies. */
function SeriesGameLog({ log, teams, onOpenGame }: {
  log: WpblGame[]; teams: Map<string, WpblTeam>; onOpenGame: (g: WpblGame) => void
}) {
  const isDark = useDark()
  const gameLink = useWpblGameLink()
  if (log.length === 0) return null
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: `repeat(${log.length}, minmax(0, 1fr))`, gap: 0.75 }}>
      {log.map((g, i) => {
        const a = teams.get(g.away_team_id), h = teams.get(g.home_team_id)
        const played = g.status === 'final' && g.home_score != null && g.away_score != null
        const homeWon = played && g.home_score! > g.away_score!
        const winner = played ? (homeWon ? h : a) : undefined
        const time = formatGameTime(g.game_date, g.start_time)
        const label = played
          ? `Game ${i + 1}: ${a ? wpblFullName(a) : 'Away'} ${g.away_score}, ${h ? wpblFullName(h) : 'Home'} ${g.home_score}`
          : `Game ${i + 1}: ${relativeDayShort(g.game_date)}${time ? `, ${time}` : ''}`
        const club = (t: WpblTeam | undefined, score: number | null, won: boolean) => (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
            {t && <Box sx={{ display: { xs: 'none', lg: 'flex' }, flexShrink: 0 }}><TeamBadge team={t} size={16} /></Box>}
            <Typography noWrap sx={{
              flex: 1, minWidth: 0, fontSize: TYPE_SCALE.meta, fontWeight: won ? 800 : 600,
              color: won && t ? wpblAccent(t.id, isDark) : 'text.secondary',
            }}>{t?.abbr ?? '—'}</Typography>
            <Typography sx={{
              flexShrink: 0, fontSize: TYPE_SCALE.body, fontWeight: won ? 900 : 600, fontVariantNumeric: 'tabular-nums',
              color: won ? 'text.primary' : 'text.secondary',
            }}>{score ?? ''}</Typography>
          </Box>
        )
        return (
          <Box key={g.id} {...gameLink(g, onOpenGame)} aria-label={label} sx={{
            display: 'flex', flexDirection: 'column', gap: 0.4, minWidth: 0,
            px: { xs: 0.6, lg: 1 }, pt: 0.6, pb: 0.75,
            border: '1px solid', borderColor: INNER_BORDER, borderRadius: 1.5,
            // The winner's colour along the top, lifted to the border floor like any club edge.
            ...(winner ? { borderTop: '3px solid', borderTopColor: edge(wpblColor(winner.id)) } : null),
            textDecoration: 'none', color: 'inherit', cursor: 'pointer',
            transition: 'background 0.12s, border-color 0.12s',
            ...hoverOnly({ bgcolor: 'action.hover' }), ...FOCUS_RING,
          }}>
            <Box aria-hidden sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5, minWidth: 0 }}>
              <Typography sx={{
                flexShrink: 0, fontSize: TYPE_SCALE.micro, fontWeight: 800, letterSpacing: typePx(0.5),
                textTransform: 'uppercase', color: 'text.secondary', lineHeight: 1.2,
              }}>G{i + 1}</Typography>
              <Typography noWrap sx={{ display: { xs: 'none', lg: 'block' }, minWidth: 0, fontSize: TYPE_SCALE.caption, color: 'text.secondary', lineHeight: 1.2 }}>
                {relativeDayShort(g.game_date)}
              </Typography>
            </Box>
            <Box aria-hidden sx={{ display: 'flex', flexDirection: 'column', gap: 0.2 }}>
              {club(a, played ? g.away_score : null, played && !homeWon)}
              {club(h, played ? g.home_score : null, homeWon)}
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}

/** The champion's Star of the final, off a read of the final's own lines (see
 *  fetchWpblLinesForGames: the offseason Home does not load the season's). `undefined` while that
 *  read is in flight, so the card can hold the row's place; null when there is no champion, no
 *  played game, or nobody on the champion with a line worth naming. */
function useFinalStar(championId: string | null, log: WpblGame[]): SeriesStar | null | undefined {
  const ids = log.filter(g => g.status === 'final').map(g => g.id).join(',')
  const key = championId && ids ? `${championId}|${ids}` : null
  const [res, setRes] = useState<{ key: string; star: SeriesStar | null } | null>(null)
  useEffect(() => {
    if (!key || !championId) return
    let cancelled = false
    fetchWpblLinesForGames(ids.split(',')).then(l => {
      if (!cancelled) setRes({ key, star: seriesStar(championId, l.batting, l.pitching) })
    })
    return () => { cancelled = true }
  }, [key, championId, ids])
  if (!key) return null
  return res?.key === key ? res.star : undefined
}

/** One row of the champion's road to the title: the stage, then what happened in it. */
interface TitlePathStep {
  stage: string
  /** The club beaten, for a series row; absent for the regular season. */
  beat?: WpblTeam
  /** "28–20 · 2nd seed", or a series score "2–1". */
  detail: string
}

/** The champion's regular season and semifinal, the two steps before the final the hero already
 *  states. Off the standings and the bracket the card has computed anyway, so it costs no read.
 *  A step the data cannot vouch for is left out rather than guessed: a dev-simulated champion that
 *  did not actually win its semifinal gets no semifinal row. */
function titlePath(champion: WpblTeam, standings: ReturnType<typeof computeStandings>, bracket: WpblBracket | null): TitlePathStep[] {
  const steps: TitlePathStep[] = []
  const row = standings.find(r => r.team.id === champion.id)
  const semi = bracket?.semifinals.find(s => s.home.team?.id === champion.id || s.away.team?.id === champion.id)
  const mine = semi ? (semi.home.team?.id === champion.id ? semi.home : semi.away) : null
  if (row) {
    steps.push({
      stage: 'Standings',
      detail: `${row.wins}–${row.losses}${mine?.seed != null ? ` · ${ordinal(mine.seed)} seed` : ''}`,
    })
  }
  if (semi && mine && semi.winner?.id === champion.id) {
    const other = mine === semi.home ? semi.away : semi.home
    if (other.team) steps.push({ stage: 'Semifinal', beat: other.team, detail: `${mine.wins}–${other.wins}` })
  }
  return steps
}

/** The finished-season body: the champion crowned with its final, the road there, and the final
 *  game by game.
 *
 *  THE SERIES SCORE LIVES IN THE HERO. It used to be its own line under it, small grey text with
 *  the RUNNER-UP's badge leading "def. San Francisco Firebells", which read at a glance as the
 *  Firebells having beaten someone, while the right half of the hero band sat empty. Now the band
 *  says the whole result: who won, what, and 3–2 over whom.
 *
 *  Blocks stack from the top at a fixed gap. The card is stretched to Player of the day beside it,
 *  and the slack goes under the last block instead of between the champion and its own result.
 *  A dev-simulated champion has no real series, so its hero shows the crown alone and the strip
 *  carries the real finalists' games. */
function ChampionRecapBody({ champion, series, teams, log, path, star, players, onOpenPlayer, isDark, recap, onOpenGame, yearWord }: {
  /** The Star of the final: undefined while its read is in flight, null for none. */
  star: SeriesStar | null | undefined
  players: WpblPlayer[]
  onOpenPlayer: (p: WpblPlayer) => void
  /** "2026 ", or nothing before the schedule has a year. */
  yearWord: string
  champion: WpblTeam
  series: ChampionResult | null
  teams: Map<string, WpblTeam>
  log: WpblGame[]
  path: TitlePathStep[]
  isDark: boolean
  recap: RecapLinkProps
  onOpenGame: (g: WpblGame) => void
}) {
  // Only games that were played: a decided series has no fixture left, and this also drops a
  // still-scheduled decider under a dev-simulated champion, where the real series is not over.
  const played = log.filter(g => g.status === 'final' && g.home_score != null && g.away_score != null)
  const runnerUp = series?.runnerUp ?? null
  const playerLink = useWpblPlayerLink()
  // The roster is a separate read from the lines, so the star waits on both: a resolved star whose
  // player has not landed yet is still loading, not missing.
  const starPlayer = star ? players.find(p => p.id === star.playerId) ?? null : null
  const starLoading = star === undefined || (!!star && !starPlayer && players.length === 0)
  const stageSx = {
    fontSize: TYPE_SCALE.micro, fontWeight: 800, letterSpacing: typePx(0.5), textTransform: 'uppercase',
    color: 'text.secondary', lineHeight: 1.3,
  } as const
  return (
    <>
      <RecapLink recap={recap}>
        {/* A ROW, NAMED EXPLICITLY: CLUB_BAND is a column (it stacks two club rows). The gradient
            warms to gold on the right, which is where the series score now sits. */}
        <Box sx={{
          ...CLUB_BAND, flexDirection: 'row', alignItems: 'center', gap: 1.5, px: 2, py: 1.5,
          background: `linear-gradient(105deg, ${wpblSurface(champion.id, isDark)} 55%, ${alpha('#e0a100', isDark ? 0.22 : 0.15)})`,
        }}>
          <TeamBadge team={champion} size={52} ring="var(--wpbl-medal-1)" />
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4 }}>
              <EmojiEventsOutlined sx={{ fontSize: ICON_SIZE.sm, color: 'var(--wpbl-medal-1)' }} />
              <Typography sx={{
                fontSize: TYPE_SCALE.micro, fontWeight: 900, letterSpacing: typePx(1), textTransform: 'uppercase',
                color: 'var(--wpbl-medal-1)',
              }}>{`${yearWord}WPBL Champions`}</Typography>
            </Box>
            {/* Wraps rather than ellipsising: the score column takes the right of this row, and on
                a phone at Large text the full name needs a second line, not a cut. */}
            <Typography sx={{
              fontSize: TYPE_SCALE.display, fontWeight: 800, lineHeight: 1.15,
              color: wpblAccent(champion.id, isDark),
            }}>{wpblFullName(champion)}</Typography>
          </Box>
          {series && runnerUp && (
            <Box sx={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}
              aria-label={`Beat ${wpblFullName(runnerUp)} ${series.champWins}–${series.rivalWins} in the final`}>
              <Typography aria-hidden sx={{
                fontSize: TYPE_SCALE.page, fontWeight: 900, lineHeight: 1.05, fontVariantNumeric: 'tabular-nums',
                color: 'var(--wpbl-medal-1)',
              }}>{series.champWins}–{series.rivalWins}</Typography>
              <Typography aria-hidden sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 700, color: 'text.secondary', whiteSpace: 'nowrap' }}>
                def. {runnerUp.abbr}
              </Typography>
            </Box>
          )}
        </Box>
      </RecapLink>

      {/* THE ROAD TO THE TITLE: each stage's label OVER its row, at every width. A label column
          beside the rows took 8.5rem out of the game tiles, which on a desktop cut "LA" to "L" and
          the dates to "Se…", and the card had height to spare beside Player of the day anyway. */}
      <Box sx={{
        display: 'flex', flexDirection: 'column', gap: 0.4,
        '& > .stage:not(:first-of-type)': { mt: 0.75 },
      }}>
        {path.map(step => (
          <Fragment key={step.stage}>
            <Typography className="stage" sx={stageSx}>{step.stage}</Typography>
            <RecapLink recap={recap} sx={{ flexDirection: 'row', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
              {step.beat && <TeamBadge team={step.beat} size={20} />}
              <Typography sx={{ minWidth: 0, fontSize: TYPE_SCALE.body, fontWeight: 600 }}>
                {step.beat ? <>def. {wpblFullName(step.beat)} </> : null}
                <Box component="span" sx={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{step.detail}</Box>
              </Typography>
            </RecapLink>
          </Fragment>
        ))}
        {played.length > 0 && (
          <>
            <Typography className="stage" sx={stageSx}>Final</Typography>
            <SeriesGameLog log={played} teams={teams} onOpenGame={onOpenGame} />
          </>
        )}
        {/* THE STAR OF THE FINAL, after the games it was picked from. A real link to the player page,
            since a player page is what readers open most. Its read lands after first paint, so the
            row holds its place in the same shape (a 32px portrait over two lines) while it does. */}
        {(starLoading || starPlayer) && (
          <>
            <Typography className="stage" sx={stageSx}>Star of the final</Typography>
            {starLoading || !star || !starPlayer ? (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                {/* EXACTLY the loaded row's box, in the loaded row's units: the portrait is chrome
                    (PlayerPortrait scales its px), the two lines are type at line height 1.25. A raw
                    32px circle and Typography's default 1.5 each made this row a few px off the one
                    replacing it, and on a desktop that moved Player of the day beside it. */}
                <Skeleton variant="circular" sx={{ width: chromePx(32), height: chromePx(32), flexShrink: 0 }} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Box sx={{ height: `calc(${TYPE_SCALE.body} * 1.25)`, display: 'flex', alignItems: 'center' }}>
                    <Skeleton variant="rounded" sx={{ width: '8rem', height: '0.65em', fontSize: TYPE_SCALE.body }} />
                  </Box>
                  <Box sx={{ height: `calc(${TYPE_SCALE.meta} * 1.25)`, display: 'flex', alignItems: 'center' }}>
                    <Skeleton variant="rounded" sx={{ width: '6rem', height: '0.65em', fontSize: TYPE_SCALE.meta }} />
                  </Box>
                </Box>
              </Box>
            ) : (
              <Box {...linkWithEvent(playerLink(starPlayer, onOpenPlayer), starPlayer.id)} sx={{
                display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, borderRadius: 1,
                textDecoration: 'none', color: 'inherit', ...TAPPABLE, ...FOCUS_RING,
              }}>
                <PlayerPortrait name={starPlayer.name} teamId={champion.id} size={32} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <NameText name={starPlayer.name} component="p" sx={{ fontSize: TYPE_SCALE.body, fontWeight: 800, lineHeight: 1.25 }} />
                  <Typography noWrap sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', fontVariantNumeric: 'tabular-nums', lineHeight: 1.25 }}>
                    {star.statline}{star.games > 1 ? ` in ${star.games} games` : ''}
                  </Typography>
                </Box>
              </Box>
            )}
          </>
        )}
      </Box>
    </>
  )
}

/** A player link that records the season card's tap first, under the same event the offseason
 *  Home's other player cards use, so /admin counts every player opened from Home in one place. */
function linkWithEvent(link: object, playerId: string) {
  const l = link as { onClick?: (e: React.MouseEvent) => void }
  return {
    ...l,
    onClick: (e: React.MouseEvent) => {
      track(EVENTS.WPBL_HOME_PLAYER_OPEN, { card: 'final_star', playerId })
      l.onClick?.(e)
    },
  }
}

/**
 * Home, before its first read lands.
 *
 * IT IS A COPY OF HOME'S LAYOUT, NOT A STACK OF GREY BARS, and it lives beside the page it
 * mirrors so the two are edited together. Home is the one view that breaks out of the 720px page
 * column (see homeWideSx), so a generic section skeleton paints at the wrong width and a fraction
 * of the height: the whole page would jump sideways and drop its footer on every cold load. Every
 * block below therefore reuses the real element's own wrapper and spacing rather than
 * approximating them.
 *
 * The Discord invite is read from the same key the card is, because reserving its height for
 * someone who dismissed it is the same mistake in the other direction.
 *
 * A skeleton is still an approximation, and the reserves are deliberately FLOORS: content that
 * comes in taller pushes the page down, which is the failure that costs nothing, while a reserve
 * nobody fills leaves a hole. That is also why the postseason bracket is drawn here at all: it is
 * the tallest block on the page on a desktop, and a season where it does not render is a season
 * with no finals in it, which is over in the first week.
 */
/** The season a title belongs to: the year of its last championship game. The feed's own season
 *  carries no year we store, and a final is never played across New Year. */
export function gameYear(games: WpblGame[], result: ChampionResult): string {
  const log = result.runnerUp ? championshipGames(games, result.champion.id, result.runnerUp.id) : []
  return log[log.length - 1]?.game_date.slice(0, 4) ?? String(new Date().getFullYear())
}

/** The dev season-finale simulator's champion pick: a club chosen deterministically from a seed,
 *  so the top banner, the recap card and the season page all land on the SAME club off a shared
 *  seed without one telling another. `aliveContenders` gives the clubs that can still win; before
 *  there is a bracket (pre-postseason) it falls back to every club, so the simulator still
 *  previews. Dev only, reached only from the DEV-guarded call sites, so it drops out of the
 *  production bundle with them. */
export function devChampionPick(bracket: WpblBracket | null, teams: WpblTeam[], seed: number): WpblTeam | null {
  const pool = bracket ? aliveContenders(bracket) : []
  const list = pool.length > 0 ? pool : teams
  return list.length > 0 ? list[Math.floor(seed * list.length) % list.length] : null
}

/**
 * The new champion, at the top of Home.
 *
 * A title is the one biggest thing that happens to the league all year, so for the days it is
 * news it takes the top of the page, the same slot the live game gets. The real banner renders
 * from the moment the championship is decided until the end of the next day (see `championView`
 * in WpblHome); a dev toggle can force it on early with a random plausible winner, which is what
 * `dev` marks.
 *
 * Fed the champion and, for the real one, the series line off the same record the bracket draws,
 * rather than recomputing either. The dev preview carries no score line: a random club is not
 * the one that actually leads the final, so a real "won 3-1" beside it would be a lie.
 */
export function ChampionBanner({ champion, season, runnerUp, champWins, rivalWins, dev, onOpenTeam }: {
  champion: WpblTeam
  /** The year of the title, off the clinching game, so the line under the name is right in any
   *  season rather than calling every champion the inaugural one. */
  season: string
  runnerUp?: WpblTeam | null
  champWins?: number | null
  rivalWins?: number | null
  dev?: boolean
  onOpenTeam?: (t: WpblTeam) => void
}) {
  const dark = useDark()
  const accent = wpblAccent(champion.id, dark)
  const open = onOpenTeam
    ? () => { track(EVENTS.WPBL_BRACKET_TEAM, { teamId: champion.id, from: 'champion-banner' }); onOpenTeam(champion) }
    : undefined
  const showSeries = !dev && champWins != null && rivalWins != null && runnerUp

  // One shared trophy gold for every club, no club colour in the field. The title is a league
  // award, so every champion banner reads as the same trophy, and the club lives in the badge and
  // the name. This replaced a gold-into-club-colour gradient that turned to mud for the two warm
  // clubs (SF red went rust, LA gold went flat brown) and needed a per-club special case to hide it.
  const gold = dark ? '#ffce55' : '#e8a900'
  const goldSoft = dark ? '#f2c04a' : '#3d2905' // strip text: bright on dark, deep espresso on the gold ribbon (small uppercase, needs AA on the bright gold)
  const stripBg = dark
    ? `linear-gradient(90deg, ${alpha(gold, 0.32)}, ${alpha(gold, 0.15)})`
    : `linear-gradient(90deg, #ffd766, #f0b200)`
  // The field goes DARK under the name and keeps the gold on the far edge, like an engraved plaque:
  // the name sits over the left half, and a flat gold field left every bright club name short of AA
  // there (SF was 2.67:1). Dark is espresso warming to a gold edge; light stays bright under the
  // name and deepens to gold. Do not flatten this to an even gold and do not put the club colour
  // back in the field: both drop the name below 4.5:1. Measured worst point under the name clears
  // 4.5:1 for all four in both themes, SF the floor at 4.72 dark / 5.39 light.
  const cardBg = dark
    ? 'linear-gradient(115deg, #241906 0%, #2e2109 52%, #463610 100%)'
    : 'linear-gradient(115deg, #fff0c2 0%, #ffe19a 55%, #f3c257 100%)'
  // The name carries the club: its accent on the dark field, a deeper club/near-black mix on the
  // bright one. Los Angeles' accent is itself a gold and would sit gold-on-gold in dark, so it
  // takes a cream-gold there; light mode's deep mix reads on gold for every club, LA included.
  const nameColor = dark
    ? (champion.id === 'LA' ? '#f0d38a' : accent)
    : `color-mix(in srgb, ${accent} 78%, #1a0f00)`

  return (
    <Box
      {...(open ? { role: 'button', tabIndex: 0, onClick: open,
        onKeyDown: (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open() } } } : {})}
      sx={{
        mb: 2, borderRadius: 3, overflow: 'hidden', position: 'relative',
        cursor: open ? 'pointer' : 'default',
        border: '1.5px solid', borderColor: alpha(gold, dark ? 0.55 : 0.7),
        boxShadow: `0 2px 14px -6px ${alpha(gold, dark ? 0.5 : 0.55)}`,
        // A warm gold trophy card warming to a hint of the club's own colour, so the title reads
        // as the one biggest thing on the page without a flat colour block fighting the cards
        // under it.
        backgroundImage: cardBg,
        ...FOCUS_RING,
      }}
    >
      {/* Gold ribbon, the champion equivalent of LiveHero's red one. A real gold fill with
          high-contrast text rather than a faint wash of the muddy medal colour. */}
      <Box sx={{
        display: 'flex', alignItems: 'center', gap: 0.75, px: 2, py: 0.75,
        background: stripBg,
        borderBottom: '1px solid', borderColor: alpha(gold, dark ? 0.28 : 0.4),
      }}>
        <Box aria-hidden sx={{ fontSize: TYPE_SCALE.body, lineHeight: 1 }}>🏆</Box>
        <Typography sx={{
          fontSize: TYPE_SCALE.meta, fontWeight: 900, letterSpacing: typePx(1), textTransform: 'uppercase',
          color: goldSoft,
        }}>Champions</Typography>
        {dev && (
          <Typography sx={{
            fontSize: TYPE_SCALE.nano, fontWeight: 800, letterSpacing: typePx(0.5), textTransform: 'uppercase',
            color: dark ? 'warning.main' : '#3d2905', ml: 0.25, opacity: dark ? 1 : 0.9,
          }}>· dev preview</Typography>
        )}
      </Box>

      <Box sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1.75, minWidth: 0 }}>
        <TeamBadge team={champion} size={52} />
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{
            fontSize: TYPE_SCALE.display, fontWeight: 900, lineHeight: 1.15, color: nameColor,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{wpblFullName(champion)}</Typography>
          <Typography sx={{ fontSize: TYPE_SCALE.body, fontWeight: 700, color: 'text.primary', mt: 0.35 }}>
            {season} WPBL champions
          </Typography>
          {showSeries && (
            <Typography sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 600, color: 'text.secondary', mt: 0.15 }}>
              Won the final {champWins}-{rivalWins} over {runnerUp!.name}
            </Typography>
          )}
        </Box>
      </Box>
    </Box>
  )
}
