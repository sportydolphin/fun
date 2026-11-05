import { CHAMPION, INK, SHADOW } from '../../ui/color'
import { useDark } from '../../ui/useDark'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Box, Typography, Skeleton, alpha } from '@mui/material'
import { computeStandings, fetchWpblLinesForGames, fetchWpblFanPhotoIndex, getCachedWpblFanPhotoIndex,
} from '../api'
import { seriesStar, type SeriesStar } from '../derive/seriesStar'
import { NameText } from '../../ui/NameText'
import { wpblColor, wpblAccent, wpblSurface, wpblLogo, wpblLogoFill, wpblFullName, formatGameTime, relativeDayShort } from '../constants'
import { useWpblGameLink, useWpblPlayerLink } from '../LinkContext'
import { WPBL_SEASON_PAGE, WPBL_RECAP_YEARS, wpblSeasonPath } from '../routes'
import { SectionCard, TeamBadge, PlayerPortrait, chromePx, TAPPABLE, hoverOnly, FOCUS_RING, TYPE_SCALE, DISPLAY_FONT, CLUB_BAND, cardFooterBand } from '../ui'
import { BEST_OF, buildBracket, championResult, championshipGames, aliveContenders, winsNeeded, type WpblBracket, type BracketSeries, type ChampionResult } from '../derive/bracket'
import { track, trackImpression, EVENTS } from '../../lib/analytics'
import type { WpblTeam, WpblPlayer, WpblGame } from '../types'
import { typePx } from '../../ui/scale'
import { latestSeason } from '../season'
import { trackedLinkTo } from './shared'
import { ordinal } from '../../lib/format'
import { trophyPalette } from '../../ui/trophy'
import { AGATE_SX, MEDIA_RADIUS, HEADLINE_SX } from '../../ui/card'
import { championPhoto, type FanPhotoIndex, type FanPhotoWithSubjects } from '../fanPhotos'

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

/** The champion, the title series and its Star, derived once for the season card and for Player
 *  Spotlight, which must not headline the same player the card's foot names (Nov 3, 2026: both
 *  showed one pitcher, a few inches apart). The Star's read is cached by game ids, so the second
 *  caller costs nothing. */
export function useChampionFinal(teams: Map<string, WpblTeam>, games: WpblGame[], devChampion?: WpblTeam | null) {
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
  return { standings, bracket, champTeam, series, finalSeries, finalInProgress, leader, finalLog, star }
}

export function SeasonRecapPreviewCard({ teams, games, devChampion, onOpenGame, players, onOpenPlayer, lead }: {
  teams: Map<string, WpblTeam>; games: WpblGame[]
  onOpenGame: (g: WpblGame) => void
  players: WpblPlayer[]; onOpenPlayer: (p: WpblPlayer) => void
  /** Dev only: a simulated champion to headline instead of the real one, with no series line
   *  since a random winner is not the club that actually led the final. Null (or absent) shows
   *  whatever the real bracket gives, which is the pre-champion state while the final is on. */
  devChampion?: WpblTeam | null
  /** The page's lead: the champion's band and the road to the title side by side from `md`. */
  lead?: boolean
}) {
  const isDark = useDark()
  const { standings, bracket, champTeam, series, finalSeries, finalInProgress, leader, finalLog, star } =
    useChampionFinal(teams, games, devChampion)

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
  const championLead = !!lead && !!champTeam && !finalInProgress

  // THE SPLIT BODIES PUT THE RECAP IN THE HEADER, where Reading and Compare put their way on. A solid
  // button across the foot competed with the champion for the eye, and it was the only one on Home.
  // The pre-champion body keeps its button: there the whole card is one anchor, so the link cannot
  // also be a second anchor in the header.

  return (
    // THE LEAD DRAWS NO SECTION HEADING once there is a champion: its band says "2026 WPBL Champions"
    // and carries the recap link, and a "2026 Season ›" over it was a second headline. The h2 stays
    // for screen readers.
    <SectionCard title={`${yearWord}Season`} fill
      headingHidden={championLead}
      titleLink={split && !championLead ? recap : undefined}>
      {/* The whole body is the link, the way the league card's is: a card whose one job is to send
          a reader to the recap should open it from anywhere on the card, not just a trailing word.
          `flex: 1` + centered so it absorbs whatever height the card beside it (Last game) forces,
          the same trick the real Next-game card uses in this slot. */}
      <Box
        {...(split ? {} : recap)}
        sx={{
          flex: 1, display: 'flex', flexDirection: 'column', gap: 1.25,
          // TOP-ALIGNED WHENEVER THERE ARE BLOCKS, and the slack falls under the last one. This card is
          // stretched to the height of Player of the day beside it; `space-between` used to spread
          // that slack between the champion and its own result, so the gaps on the card were sized
          // by a different card's content. Centered only for the off-season line or two.
          justifyContent: split ? 'flex-start' : 'center',
          textDecoration: 'none', color: 'inherit', borderRadius: 1, p: 0.5, mx: -0.5,
          ...(split ? null : TAPPABLE),
        }}
      >
        {finalInProgress && finalSeries ? (
          <ChampionshipInProgressBody series={finalSeries} teams={teams} log={finalLog} recap={recap} onOpenGame={onOpenGame} />
        ) : champTeam ? (
          <ChampionRecapBody champion={champTeam} series={series} teams={teams} log={finalLog} isDark={isDark}
            path={titlePath(champTeam, standings, bracket, series)} recap={recap} onOpenGame={onOpenGame}
            star={star} players={players} onOpenPlayer={onOpenPlayer} lead={lead} year={year} />
        ) : (
          <>
            <Typography sx={{ fontSize: TYPE_SCALE.display, fontWeight: 800, lineHeight: 1.15 }}>
              Season recap
            </Typography>

            {/* One line of fact so the card is not a bare link: the club that led the regular season. */}
            {leader ? (
              <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.secondary' }}>
                1st: {wpblFullName(leader.team)} {leader.wins}–{leader.losses}
              </Typography>
            ) : null}

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
        fontFamily: DISPLAY_FONT, fontSize: TYPE_SCALE.display, fontWeight: 900, fontVariantNumeric: 'tabular-nums',
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
function RecapLink({ recap, sx, label, children }: {
  recap: RecapLinkProps; sx?: object
  /** The link's name when nothing inside it is text: the lead's photo. */
  label?: string
  children: React.ReactNode
}) {
  return (
    <Box {...recap} aria-label={label} sx={{
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
      mt: 0.5, px: 2, py: 1.1, borderRadius: 2,
      bgcolor: 'var(--wpbl-accent-solid)', color: INK.white, textDecoration: 'none',
      cursor: 'pointer', userSelect: 'none',
      boxShadow: SHADOW.accentGlow,
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
 *  ONE COLUMN PER GAME, WITH NO BOX AROUND IT: game, winner, score, under a bar in the winner's
 *  color. Five outlined tiles of two stacked club rows made every game read the same; the bars alone
 *  now tell the series (LA, LA, SF, SF, LA) before a number is read. The accent rather than the
 *  club's primary, because the Queens' primary is black and `edge()` lifts black to a gray that says
 *  nothing about who won. The winner's score leads, which is why the row needs no loser's name.
 *
 *  A game still to come has no winner to name, so it shows its date in a neutral bar. That is the
 *  in-progress body; a phone's column is about 60px, so the date and time wrap rather than hide. The
 *  full line is each column's accessible name. Shared by the in-progress and the champion bodies. */
function SeriesGameLog({ log, teams, onOpenGame, championId }: {
  log: WpblGame[]; teams: Map<string, WpblTeam>; onOpenGame: (g: WpblGame) => void
  /** A decided final: the champion's wins get the strong bar and the rival's the quiet one, in ink
   *  rather than club color (Nov 4, 2026). The lead already sits under the club strip and the
   *  champion's gold, and two more club colors in five bars made it the loudest block on the page.
   *  The series still reads at a glance as won, won, lost, lost, won. Absent while the final is on,
   *  where neither club is the subject and each keeps its own color. */
  championId?: string
}) {
  const isDark = useDark()
  const gameLink = useWpblGameLink()
  if (log.length === 0) return null
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: `repeat(${log.length}, minmax(0, 1fr))`, gap: 0.5 }}>
      {log.map((g, i) => {
        const a = teams.get(g.away_team_id), h = teams.get(g.home_team_id)
        const played = g.status === 'final' && g.home_score != null && g.away_score != null
        const homeWon = played && g.home_score! > g.away_score!
        const winner = played ? (homeWon ? h : a) : undefined
        const time = formatGameTime(g.game_date, g.start_time)
        const ink = !winner ? 'outline'
          : championId ? (winner.id === championId ? 'text.primary' : 'outline')
          : wpblAccent(winner.id, isDark)
        const label = played
          ? `Game ${i + 1}: ${a ? wpblFullName(a) : 'Away'} ${g.away_score}, ${h ? wpblFullName(h) : 'Home'} ${g.home_score}`
          : `Game ${i + 1}: ${relativeDayShort(g.game_date)}${time ? `, ${time}` : ''}`
        return (
          <Box key={g.id} {...gameLink(g, onOpenGame)} aria-label={label} sx={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.15, minWidth: 0,
            pt: 0.6, pb: 0.5, textAlign: 'center',
            borderTop: '3px solid', borderTopColor: ink,
            textDecoration: 'none', color: 'inherit', cursor: 'pointer',
            transition: 'background 0.12s',
            ...hoverOnly({ bgcolor: 'action.hover' }), ...FOCUS_RING,
          }}>
            <Typography aria-hidden sx={{
              fontSize: TYPE_SCALE.micro, fontWeight: 800, 
              color: 'text.secondary', lineHeight: 1.2,
            }}>G{i + 1}</Typography>
            {winner ? (
              // One line, "LA 7–6", as an agate line prints a result: the club and the score on three
              // stacked lines made five games the busiest block in the lead (Nov 4, 2026).
              <Typography aria-hidden noWrap sx={{ ...AGATE_SX, fontSize: TYPE_SCALE.meta, lineHeight: 1.25 }}>
                <Box component="span" sx={championId
                  ? { fontWeight: 800, color: winner.id === championId ? 'text.primary' : 'text.secondary' }
                  : { color: wpblAccent(winner.id, isDark) }}>{winner.abbr}</Box>
                {' '}{Math.max(g.home_score!, g.away_score!)}–{Math.min(g.home_score!, g.away_score!)}
              </Typography>
            ) : (
              <Typography aria-hidden sx={{ fontSize: TYPE_SCALE.caption, color: 'text.secondary', lineHeight: 1.25 }}>
                {relativeDayShort(g.game_date)}{time ? <><br />{time}</> : null}
              </Typography>
            )}
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

/** One column of the champion's road to the title: the stage, its one number, and what the number
 *  was against. */
interface TitlePathStep {
  stage: string
  /** "8–7", or a series score "2–1". */
  value: string
  /** "3rd seed", or the club beaten. */
  note?: string
  /** The step that won the title, and so the one column in gold. */
  title?: boolean
}

/** The champion's season, semifinal and final, off the standings and the bracket the card has
 *  computed anyway, so it costs no read. A step the data cannot vouch for is left out rather than
 *  guessed: a dev-simulated champion has no final, and none that did not actually win its semifinal
 *  gets a semifinal. */
function titlePath(champion: WpblTeam, standings: ReturnType<typeof computeStandings>, bracket: WpblBracket | null, series: ChampionResult | null): TitlePathStep[] {
  const steps: TitlePathStep[] = []
  const row = standings.find(r => r.team.id === champion.id)
  const semi = bracket?.semifinals.find(s => s.home.team?.id === champion.id || s.away.team?.id === champion.id)
  const mine = semi ? (semi.home.team?.id === champion.id ? semi.home : semi.away) : null
  if (row) {
    steps.push({
      stage: 'Season',
      value: `${row.wins}–${row.losses}`,
      note: mine?.seed != null ? `${ordinal(mine.seed)} seed` : undefined,
    })
  }
  if (semi && mine && semi.winner?.id === champion.id) {
    const other = mine === semi.home ? semi.away : semi.home
    if (other.team) steps.push({ stage: 'Semifinal', value: `${mine.wins}–${other.wins}`, note: `def. ${other.team.abbr}` })
  }
  if (series?.runnerUp) {
    steps.push({ stage: 'Final', value: `${series.champWins}–${series.rivalWins}`, note: `def. ${series.runnerUp.abbr}`, title: true })
  }
  return steps
}

/** The champion's band inks for the season card off Home's lead: the field is the club's primary,
 *  and all four primaries are near-black, so a light theme gets the same dark band rather than a
 *  washed-out translation of it. This is why the card does not use `trophyPalette`, whose field has
 *  to change with the theme because it is gold. */
const HERO_INK = { gold: CHAMPION.gold, name: CHAMPION.name, text: CHAMPION.text } as const

/** The champion's photo for the lead: the index from the session cache when the section warmed it,
 *  else after its read. Null until then and when nothing fits (championPhoto). */
function useChampionPhoto(championId: string, finals: WpblGame[]): FanPhotoWithSubjects | null {
  const [index, setIndex] = useState<FanPhotoIndex | null>(() => getCachedWpblFanPhotoIndex())
  useEffect(() => {
    let live = true
    fetchWpblFanPhotoIndex().then(idx => { if (live) setIndex(idx) }).catch(() => { /* the mark stays */ })
    return () => { live = false }
  }, [])
  const dates = finals.map(g => g.game_date).join(',')
  return useMemo(
    () => (index ? championPhoto(index.byTeam.get(championId) ?? [], dates ? dates.split(',') : []) : null),
    [index, championId, dates],
  )
}

/** The lead's label column: a stage of the road, or "Star of the final". Regular weight: a label as
 *  bold as the figure beside it stops reading as a label. */
const LEAD_LABEL_SX = { fontSize: TYPE_SCALE.meta, color: 'text.secondary', lineHeight: 1.3 } as const

/**
 * THE OFFSEASON HOME'S LEAD, AS A FRONT PAGE RUNS ONE (Nov 4, 2026, ROADMAP-UI.md's third audit): the
 * title photo large on the left with its credit under it, and beside it the kicker, the club's name
 * as the headline, the road to the title as three lines of agate, and the Star. The final's games
 * are the score strip above it since Nov 5. On the page's own ground in both themes, with no box
 * around either half.
 *
 * WHY NOT THE BAR AND THE PANEL IT REPLACES: the photo was a 16:5 strip over a black bar, beside a
 * gray filled panel of another height with a blank stretch above the Star. Two boxes that did not
 * line up, the only filled card left on the page, a headline at 40px, and a light theme that was
 * still dark across the top.
 *
 * THE PHOTO IS A FIXED 3:2 AT EVERY WIDTH, so the skeleton can reserve it and its read landing late
 * moves nothing. It holds the club's mark on its primary until the photo has loaded, or for good when
 * there is no photo (a dev-simulated champion, or a final nobody photographed).
 */
function ChampionLead({ champion, played, path, star, starPlayer, starLoading, recap, onOpenPlayer, year }: {
  champion: WpblTeam
  played: WpblGame[]
  path: TitlePathStep[]
  star: SeriesStar | null | undefined
  starPlayer: WpblPlayer | null
  starLoading: boolean
  recap: RecapLinkProps
  onOpenPlayer: (p: WpblPlayer) => void
  year?: number | null
}) {
  const photo = useChampionPhoto(champion.id, played)
  const [shown, setShown] = useState<string | null>(null)
  const loaded = !!photo && shown === photo.id
  const logo = wpblLogo(champion.id)
  const field = wpblColor(champion.id)
  const playerLink = useWpblPlayerLink()
  return (
    <Box sx={LEAD_GRID_SX}>
      <Box component="figure" sx={{ m: 0, minWidth: 0, gridArea: 'photo' }}>
        <RecapLink recap={recap} label={year != null ? `${year} season recap` : 'Season recap'} sx={{ gap: 0, borderRadius: MEDIA_RADIUS }}>
          <Box sx={{ position: 'relative', overflow: 'hidden', bgcolor: field, aspectRatio: '3 / 2', borderRadius: MEDIA_RADIUS }}>
            {logo && (
              <Box component="img" src={logo} alt="" aria-hidden sx={{
                position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                width: '30%', aspectRatio: '1', borderRadius: '50%',
                objectFit: wpblLogoFill(champion.id) ? 'cover' : 'contain',
                opacity: loaded ? 0 : 0.3, transition: 'opacity 0.3s',
              }} />
            )}
            {photo && (
              // Decorative: the link already says where it goes, and the headline beside it says who won.
              // THE PAGE'S LARGEST PAINT, so it goes first and at the size drawn (Nov 5, 2026): it was the
              // 1600px render at default priority on every screen, behind the gallery's first tile. The
              // column is 7/12 of Home's width from md (about half the window; 900 is
              // MUI's md), the full width below.
              <Box component="img" src={photo.full_url} alt="" aria-hidden onLoad={() => setShown(photo.id)}
                srcSet={`${photo.card_url} 800w, ${photo.full_url} 1600w`}
                sizes="(min-width: 900px) 55vw, 100vw"
                fetchPriority="high" loading="eager" sx={{
                position: 'absolute', inset: 0, width: '100%', height: '100%',
                objectFit: 'cover', objectPosition: 'center 35%',
                opacity: loaded ? 1 : 0, transition: 'opacity 0.3s',
              }} />
            )}
          </Box>
        </RecapLink>
        {/* The credit under the picture, as the gallery prints it, not a chip over the photo. One line
            held even before the photo lands, so the column does not grow by it. */}
        <Typography component="figcaption" noWrap sx={{ ...AGATE_SX, mt: 0.5, fontSize: TYPE_SCALE.meta, color: 'text.secondary', lineHeight: 1.4 }}>
          {photo?.credit ? `Photo: ${photo.credit}` : ' '}
        </Typography>
      </Box>

      <RecapLink recap={recap} sx={{ gap: 0.25, gridArea: 'head', minWidth: 0 }}>
          <Typography sx={{ fontSize: TYPE_SCALE.micro, fontWeight: 900, letterSpacing: typePx(1), textTransform: 'uppercase', color: 'var(--wpbl-medal-1)' }}>
            {year != null ? `${year} WPBL Champions` : 'WPBL Champions'}
          </Typography>
          {/* The headline: the club's full name, allowed to wrap rather than cut at a narrow column. */}
          {/* A step between `hero` and `lead` from md to lg, where the column is about 350px and
              Newsreader at `lead` broke "Los Angeles" itself across two lines. */}
          <Typography component="p" sx={{ ...HEADLINE_SX, fontSize: { xs: TYPE_SCALE.hero, md: '2.75rem', lg: TYPE_SCALE.lead }, lineHeight: 1.0, textWrap: 'balance' }}>
            {wpblFullName(champion)}
          </Typography>
      </RecapLink>

      <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0, gridArea: 'body' }}>
        {/* The road, one line per stage, as an agate column prints a club's postseason. */}
        {path.length > 0 && (
          <RecapLink recap={recap} sx={{ gap: 0, mt: { xs: 0.5, md: 2 } }}>
            {path.map(step => (
              <Box key={step.stage} sx={{
                display: 'grid', gridTemplateColumns: 'minmax(0, 6rem) minmax(0, 3.5rem) minmax(0, 1fr)', alignItems: 'baseline', columnGap: 1,
                py: 0.6, borderTop: '1px solid', borderColor: 'divider',
              }}>
                <Typography sx={LEAD_LABEL_SX}>{step.stage}</Typography>
                <Typography sx={{ ...AGATE_SX, fontSize: TYPE_SCALE.heading, lineHeight: 1.2, fontVariantNumeric: 'tabular-nums' }}>{step.value}</Typography>
                {/* "def. SF" like the semifinal's "def. NY": the full name cut to "def. San Francis…"
                    in the 900px column. */}
                <Typography noWrap sx={LEAD_LABEL_SX}>{step.note}</Typography>
              </Box>
            ))}
          </RecapLink>
        )}

        {/* NO ROW OF THE FINAL'S GAMES (Nov 5, 2026): the score strip above the lead carries them
            all winter (Scoreboard's `final`). */}

        {/* THE STAR OF THE FINAL, a real link to the player page, since a player page is what readers
            open most. Its read lands after first paint, so the row holds its place in the same shape
            while it does. */}
        {(starLoading || starPlayer) && (
          <Box sx={{ mt: 1.5, pt: 1.25, borderTop: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1.25 }}>
            {starLoading || !star || !starPlayer ? (
              <>
                <Skeleton variant="rectangular" sx={{ width: chromePx(56), height: chromePx(56), flexShrink: 0 }} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={LEAD_LABEL_SX}>Star of the final</Typography>
                  <Box sx={{ height: `calc(${TYPE_SCALE.heading} * 1.25)`, display: 'flex', alignItems: 'center' }}>
                    <Skeleton variant="rounded" sx={{ width: '8rem', height: '0.65em', fontSize: TYPE_SCALE.heading }} />
                  </Box>
                  <Box sx={{ height: `calc(${TYPE_SCALE.meta} * 1.3)`, display: 'flex', alignItems: 'center' }}>
                    <Skeleton variant="rounded" sx={{ width: '6rem', height: '0.65em', fontSize: TYPE_SCALE.meta }} />
                  </Box>
                </Box>
              </>
            ) : (
              <Box {...linkWithEvent(playerLink(starPlayer, onOpenPlayer), starPlayer.id)} sx={{
                flex: 1, display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0, borderRadius: 1,
                textDecoration: 'none', color: 'inherit', ...TAPPABLE, ...FOCUS_RING,
              }}>
                <PlayerPortrait name={starPlayer.name} teamId={champion.id} size={56} print />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={LEAD_LABEL_SX}>Star of the final</Typography>
                  <NameText name={starPlayer.name} component="p" sx={{ fontSize: TYPE_SCALE.heading, fontWeight: 700, lineHeight: 1.25 }} />
                  <Typography noWrap sx={{ ...AGATE_SX, fontSize: TYPE_SCALE.meta, color: 'text.secondary', fontVariantNumeric: 'tabular-nums', lineHeight: 1.3 }}>
                    {star.statline}{star.games > 1 ? ` in ${star.games} games` : ''}
                  </Typography>
                </Box>
              </Box>
            )}
          </Box>
        )}

        {/* Where the lead goes, said once in words: a phone has no hover to show the headline is a link. */}
        <RecapLink recap={recap} sx={{ mt: 1.5, alignSelf: 'flex-start' }}>
          <Typography sx={{ fontSize: TYPE_SCALE.body, fontWeight: 700 }}>Season recap ›</Typography>
        </RecapLink>
      </Box>
    </Box>
  )
}

/**
 * The lead's three parts: the head (kicker and headline), the photo and the body (the road, the Star,
 * the recap link). From md the photo takes seven columns and the head sits over the body beside it.
 * ON A PHONE THE HEAD COMES FIRST (Nov 5, 2026): under a full-width 3:2 photo, the masthead and the
 * strip, "Los Angeles Queens" started about 680px down a 812px screen, so the first screen was a
 * picture with no story. A paper's front page runs its headline over the art for the same reason.
 */
const LEAD_GRID_SX = {
  display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 7fr) minmax(0, 5fr)' },
  gridTemplateAreas: { xs: '"head" "photo" "body"', md: '"photo head" "photo body"' },
  gridTemplateRows: { md: 'auto 1fr' },
  columnGap: 3, rowGap: { xs: 1.5, md: 0 }, alignItems: 'start',
} as const

/** The head and the body at their loaded heights, for the skeleton: a headline of one line on a
 *  phone and two in the narrower desktop column; the road, the Star and the recap link. Measured at
 *  375, 960 and 1440 in Newsreader (Nov 5, 2026). In rem, since all of it is type. */
const LEAD_HEAD_H = { xs: '3.395rem', md: '6.645rem', lg: '8.145rem' } as const
const LEAD_BODY_H = { xs: '12.9rem', md: '13.6rem' } as const

/** Home's lead before the season's read lands, in the loaded lead's own wrapper and grid: the photo
 *  is the same 3:2 box at the same column width, so it reserves itself exactly at every width, and
 *  the text column takes its measured height. Beside the lead so the two are edited together. */
export function ChampionLeadSkeleton() {
  return (
    <SectionCard title="Season" fill headingHidden>
      <Box aria-hidden sx={{ p: 0.5, mx: -0.5 }}>
        <Box sx={LEAD_GRID_SX}>
          <Box sx={{ minWidth: 0, gridArea: 'photo' }}>
            <Skeleton variant="rectangular" sx={{ width: '100%', height: 'auto', aspectRatio: '3 / 2' }} />
            <Typography sx={{ ...AGATE_SX, mt: 0.5, fontSize: TYPE_SCALE.meta, lineHeight: 1.4 }}>{' '}</Typography>
          </Box>
          <Box sx={{ minWidth: 0, gridArea: 'head', minHeight: LEAD_HEAD_H }}>
            <Skeleton variant="text" width="45%" sx={{ fontSize: TYPE_SCALE.micro }} />
            <Skeleton variant="text" width="85%" sx={{ fontSize: { xs: TYPE_SCALE.hero, md: '2.75rem', lg: TYPE_SCALE.lead } }} />
          </Box>
          <Box sx={{ minWidth: 0, gridArea: 'body', minHeight: LEAD_BODY_H }} />
        </Box>
      </Box>
    </SectionCard>
  )
}

/** The finished-season body off Home's lead (the lead is `ChampionLead`): the club over a full-bleed
 *  field in its own color, the road there, the final game by game, and the Star.
 *
 *  THE LOGO IS DECORATION, cropped off the band's right edge and hidden from the accessibility tree:
 *  the name beside it already says who this is. Its fade is on the image alone, never the text.
 *
 *  The Star is pinned to the card's foot, so slack from a card beside it falls between the games and
 *  the Star instead of under a block that ends the card early. A dev-simulated champion has no real
 *  series, so its band shows the crown alone and the row carries the real finalists. */
function ChampionRecapBody({ champion, series, teams, log, path, star, players, onOpenPlayer, isDark, recap, onOpenGame, lead, year }: {
  /** The Star of the final: undefined while its read is in flight, null for none. */
  star: SeriesStar | null | undefined
  players: WpblPlayer[]
  onOpenPlayer: (p: WpblPlayer) => void
  champion: WpblTeam
  series: ChampionResult | null
  teams: Map<string, WpblTeam>
  log: WpblGame[]
  path: TitlePathStep[]
  isDark: boolean
  recap: RecapLinkProps
  onOpenGame: (g: WpblGame) => void
  lead?: boolean
  /** The season, for the lead's kicker ("2026 WPBL Champions"), which stands in for its heading. */
  year?: number | null
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
  if (lead) {
    return <ChampionLead champion={champion} played={played} path={path}
      star={star} starPlayer={starPlayer} starLoading={starLoading} recap={recap}
      onOpenPlayer={onOpenPlayer} year={year} />
  }
  const logo = wpblLogo(champion.id)
  const stageSx = {
    fontSize: TYPE_SCALE.micro, fontWeight: 800, color: 'text.secondary', lineHeight: 1.3,
  } as const
  const ink = { band: wpblColor(champion.id), ...HERO_INK, score: INK.white }
  return (
    <>
      <RecapLink recap={recap}>
        <Box sx={{
          ...CLUB_BAND, position: 'relative', px: 2, pt: 1.75, pb: 1.5,
          bgcolor: ink.band,
          borderTop: '2px solid', borderTopColor: ink.gold,
        }}>
          {logo && (
            <Box component="img" src={logo} alt="" aria-hidden sx={{
              position: 'absolute', top: '50%', right: '-3rem', transform: 'translateY(-50%)',
              width: chromePx(190), height: chromePx(190), borderRadius: '50%',
              objectFit: wpblLogoFill(champion.id) ? 'cover' : 'contain',
              opacity: 0.22, pointerEvents: 'none',
            }} />
          )}
          <Box sx={{ position: 'relative', minWidth: 0 }}>
            <Typography sx={{
              fontSize: TYPE_SCALE.micro, fontWeight: 900, letterSpacing: typePx(1), textTransform: 'uppercase',
              color: ink.gold,
            }}>WPBL Champions</Typography>
            <Typography sx={{ mt: 0.75, fontSize: TYPE_SCALE.title, fontWeight: 600, lineHeight: 1.2, color: ink.text }}>
              {champion.city}
            </Typography>
            <Typography sx={{ fontFamily: DISPLAY_FONT, fontSize: TYPE_SCALE.hero, fontWeight: 900, lineHeight: 1.05, color: ink.name }}>
              {champion.name}
            </Typography>
            {series && runnerUp && (
              <Box sx={{ mt: 0.75, display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 0.75 }}>
                <Typography sx={{ fontFamily: DISPLAY_FONT, fontSize: TYPE_SCALE.page, fontWeight: 900, lineHeight: 1.2, fontVariantNumeric: 'tabular-nums', color: ink.score }}>
                  {series.champWins}–{series.rivalWins}
                </Typography>
                <Typography sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 600, color: ink.text }}>
                  Final vs. {wpblFullName(runnerUp)}
                </Typography>
              </Box>
            )}
          </Box>
        </Box>
      </RecapLink>

      {/* THREE EQUAL COLUMNS AT ANY COUNT, so a dev champion's missing final leaves a gap on the right
          rather than stretching the season across the card. */}
      {path.length > 0 && (
        <RecapLink recap={recap} sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 1 }}>
          {path.map(step => (
            <Box key={step.stage} sx={{ minWidth: 0 }}>
              <Typography sx={stageSx}>{step.stage}</Typography>
              <Typography sx={{
                fontFamily: DISPLAY_FONT, fontSize: TYPE_SCALE.display, fontWeight: 900, lineHeight: 1.2, fontVariantNumeric: 'tabular-nums',
                color: step.title ? 'var(--wpbl-medal-1)' : 'text.primary',
              }}>{step.value}</Typography>
              {step.note && <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', lineHeight: 1.25 }}>{step.note}</Typography>}
            </Box>
          ))}
        </RecapLink>
      )}

      {played.length > 0 && <SeriesGameLog log={played} teams={teams} onOpenGame={onOpenGame} championId={champion.id} />}

      {(starLoading || starPlayer) && (
        <Box sx={{ ...cardFooterBand(isDark), mt: 'auto', mb: -2 }}>
          {starLoading || !star || !starPlayer ? (
            <>
              <Skeleton variant="circular" sx={{ width: chromePx(48), height: chromePx(48), flexShrink: 0 }} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={stageSx}>Star of the final</Typography>
                <Box sx={{ height: `calc(${TYPE_SCALE.body} * 1.25)`, display: 'flex', alignItems: 'center' }}>
                  <Skeleton variant="rounded" sx={{ width: '8rem', height: '0.65em', fontSize: TYPE_SCALE.body }} />
                </Box>
                <Box sx={{ height: `calc(${TYPE_SCALE.meta} * 1.25)`, display: 'flex', alignItems: 'center' }}>
                  <Skeleton variant="rounded" sx={{ width: '6rem', height: '0.65em', fontSize: TYPE_SCALE.meta }} />
                </Box>
              </Box>
            </>
          ) : (
            <Box {...linkWithEvent(playerLink(starPlayer, onOpenPlayer), starPlayer.id)} sx={{
              flex: 1, display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, borderRadius: 1,
              textDecoration: 'none', color: 'inherit', ...TAPPABLE, ...FOCUS_RING,
            }}>
              <PlayerPortrait name={starPlayer.name} teamId={champion.id} size={48} ring="var(--wpbl-medal-1)" />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={stageSx}>Star of the final</Typography>
                <NameText name={starPlayer.name} component="p" sx={{ fontSize: TYPE_SCALE.body, fontWeight: 800, lineHeight: 1.25 }} />
                <Typography noWrap sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', fontVariantNumeric: 'tabular-nums', lineHeight: 1.25 }}>
                  {star.statline}{star.games > 1 ? ` in ${star.games} games` : ''}
                </Typography>
              </Box>
            </Box>
          )}
        </Box>
      )}
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
 * IT IS A COPY OF HOME'S LAYOUT, NOT A STACK OF GRAY BARS, and it lives beside the page it
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
 * the one that actually leads the final, so a real "won 3–1" beside it would be a lie.
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

  // Measured worst point under the name clears 4.5:1 for all four clubs in both themes, SF the floor
  // at 4.72 dark / 5.39 light (a flat gold field had it at 2.67:1).
  const { gold, goldSoft, stripBg, cardBg } = trophyPalette(dark)
  // The name carries the club: its accent on the dark field, a deeper club/near-black mix on the
  // bright one. Los Angeles' accent is itself a gold and would sit gold-on-gold in dark, so it
  // takes a cream-gold there; light mode's deep mix reads on gold for every club, LA included.
  const nameColor = dark
    ? (champion.id === 'LA' ? CHAMPION.name : accent)
    : `color-mix(in srgb, ${accent} 78%, ${CHAMPION.shade})`

  return (
    <Box
      {...(open ? { role: 'button', tabIndex: 0, onClick: open,
        onKeyDown: (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open() } } } : {})}
      sx={{
        mb: 2, borderRadius: 3, overflow: 'hidden', position: 'relative',
        cursor: open ? 'pointer' : 'default',
        border: '1.5px solid', borderColor: alpha(gold, dark ? 0.55 : 0.7),
        boxShadow: `0 2px 14px -6px ${alpha(gold, dark ? 0.5 : 0.55)}`,
        // A warm gold trophy card warming to a hint of the club's own color, so the title reads
        // as the one biggest thing on the page without a flat color block fighting the cards
        // under it.
        backgroundImage: cardBg,
        ...FOCUS_RING,
      }}
    >
      {/* Gold ribbon, the champion equivalent of LiveHero's red one. A real gold fill with
          high-contrast text rather than a faint wash of the muddy medal color. */}
      <Box sx={{
        display: 'flex', alignItems: 'center', gap: 0.75, px: 2, py: 0.75,
        background: stripBg,
        borderBottom: '1px solid', borderColor: alpha(gold, dark ? 0.28 : 0.4),
      }}>
        <Typography sx={{
          fontSize: TYPE_SCALE.meta, fontWeight: 900, letterSpacing: typePx(1), textTransform: 'uppercase',
          color: goldSoft,
        }}>Champions</Typography>
        {dev && (
          <Typography sx={{
            fontSize: TYPE_SCALE.nano, fontWeight: 800, letterSpacing: typePx(0.5), textTransform: 'uppercase',
            color: dark ? 'warning.main' : CHAMPION.devInk, ml: 0.25, opacity: dark ? 1 : 0.9,
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
              Won the final {champWins}–{rivalWins} over {runnerUp!.name}
            </Typography>
          )}
        </Box>
      </Box>
    </Box>
  )
}
