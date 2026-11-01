import { useEffect, useMemo, useState } from 'react'
import { edge } from '../../ui/card'
import { Box, Typography } from '@mui/material'
import {
  fetchWpblAllPlayers, fetchWpblAllLines, fetchWpblTrackedGameIds, computeStandings, countsInStandings,
  fetchWpblAllRunValuePlays, getCachedWpblAllRunValuePlays,
  getCachedWpblAllPlayers, getCachedWpblAllLines, getCachedWpblTrackedGameIds, wpblHomeCacheAgeMs,
} from '../api'
import { wpblColor } from '../constants'
import { useWpblHeadingTag } from '../PageHeading'
import { TeamBadge, CARD_BORDER, CARD_FILL, hoverOnly, FOCUS_RING, TYPE_SCALE, TAB_TITLE_SX } from '../ui'
import { useWpblTeamLink } from '../LinkContext'
import { UNSTYLED_LINK } from '../../nav'
import { LiveHero } from '../Live'
import { useForegroundInterval } from '../../lib/foregroundInterval'
import PlayoffBracket from '../PlayoffBracket'
import { postseasonScheduleRows, buildBracket, championResult, championBannerUntil } from '../derive/bracket'
import {
  aggregateBatting, wpblQualifiers,
} from '../stats'
// The dismissal key and the dev-only undo. Their own module so the dev settings menu can reach
// the undo without dragging this file into the main bundle. See discordInvite.ts.
import { DISCORD_DISMISS_KEY, DISCORD_DEV_SHOW_EVENT } from '../discordInvite'
// Dev only: the settings gear can force the championship banner on with a random winner. Its own
// module for the bundle reason in discordInvite.ts; the whole listener is DEV-guarded below.
import { DEV_CHAMPION_EVENT, devChampionState, type DevChampionState } from '../dev/devChampion'
import { LastGameCard } from '../RecapCard'
import { WpblMatchupPreview } from '../GamePreview'
import { mvpRaceIsWorthDrawing } from '../MvpRace'
import FanVoteCard, { FanAwardsCta } from '../FanVote'
import { awardsResultsShowOnHome } from '../awards'
import { FanPhotoHomeCard } from '../FanPhotoViews'
import { buildRunExpectancy, playRunValues } from '../derive/runExpectancy'
import { mvpRace } from '../derive/mvpRace'
import { WatchCard } from '../Watch'
import { FanAwardWinnersCard, PlayerSpotlightCard, SeasonLeadersCard, StarSignCard } from './PlayerCards'
import type { WpblRunValuePlay } from '../types'
import type { WpblTeam, WpblPlayer, WpblGame, WpblSiteGame, WpblBattingLine, WpblPitchingLine } from '../types'
import { typePx } from '../../ui/scale'
import { useWpblSeason } from '../SeasonContext'
import { offseasonByCalendar, nextOpeningDay, rememberNextOpeningDay } from '../offseasonCalendar'
import { regularSeasonOver } from '../season'
import { localIsoDate } from '../derive/homePlayers'
import { HEADER_GAP, homeWideSx } from './shared'
import { type MatchupPreviewArg, Scoreboard } from './Scoreboard'
import { NextGameCard } from './NextGameCard'
import { gameYear, devChampionPick, ChampionBanner } from './ChampionCards'
import { useNewTrackingBatch, NewTrackingBanner } from './TrackingBanner'
import { DiscordCard } from './DiscordCard'
import { LatestReadingCard, ReadingHomeCard } from './ReadingCards'
import { LeagueCard } from './LeagueCard'
import { ComparePreviewCard } from './ComparePreviewCard'
import { CardSkeleton, WATCH_CARD_SKELETON_H } from './Skeletons'

// WPBL home dashboard: the scoreboard strip, then a card feed in two columns from md up and one
// column on a phone. Everything on it is derived from data the section already caches: the
// schedule, the standings and season totals from box-score lines.

/**
 * Whether a Home landing will read the season's box-score lines, judged by the calendar for a
 * caller that runs before the schedule has arrived (the warm-up in WpblApp). Once there is a
 * champion and the award results are off the page, the only cards that drew from them (Compare
 * and the ballot) are gone, and the lines are the heaviest read in the section.
 *
 * A HINT, NOT THE GATE. Home decides for itself from the real schedule (`needsLines` in WpblHome).
 * The calendar is wrong in spring until POSTSEASON_SCHEDULE is updated for the new season, and the
 * cost of that is only a lost head start: Home still fetches the lines once it has mounted.
 */
export function homeLandingReadsLines(now = Date.now()): boolean {
  return !(offseasonByCalendar(now) && !awardsResultsShowOnHome(now))
}

export default function WpblHome({ teams, games, siteGames = [], liveGame, onOpenGame, onOpenPlayer, onOpenTeam, onViewTracking, awardsOpen, onOpenAwards, onCloseAwards }: {
  teams: WpblTeam[]
  games: WpblGame[]
  /** The league's mirrored website calendar, which is where a postseason game's home club
   *  comes from until the stats feed publishes the fixture. Optional: without it the rows fall
   *  back to their own published constant. */
  siteGames?: WpblSiteGame[]
  liveGame: WpblGame | null
  onOpenGame: (g: WpblGame) => void
  onOpenPlayer: (p: WpblPlayer) => void
  onOpenTeam: (t: WpblTeam) => void
  // 'runs' is here for the MVP card's "Full board" link: the number it draws comes off the
  // Run value board, so that is the only honest place to send someone who wants the rest of
  // the field. `openStats` in WpblApp already takes the wider group type.
  onViewStats: (group: 'hitting' | 'pitching' | 'runs', sortKey?: string) => void
  onViewTracking: () => void
  /**
   * The fan awards ballot, which is a route rather than a piece of local state.
   *
   * IT IS OWNED BY WpblApp AND NOT BY THE CARD, because /wpbl/awards has to open it: a sheet
   * that holds its own `open` boolean cannot be addressed. So the card reports the intent upward
   * and renders whatever the history entry says, exactly as the player and game modals in this
   * section do. Optional so the card still works if a caller has no router to hand.
   */
  awardsOpen?: boolean
  onOpenAwards?: () => void
  onCloseAwards?: () => void
}) {
  const teamMap = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])
  // HOME IS THE CURRENT SEASON, whatever year the reader picked on Stats. `games` stays the whole
  // schedule for the cards about fixtures (the scoreboard, next and last game), which have to see
  // next year's opener in the spring; everything that sums or seeds a season (the standings behind
  // the bracket, the leaders, the ballot, the race) reads `seasonGames` and lines cut to match.
  const { cut, seasonGames, schedule, current } = useWpblSeason(games, { current: true })
  // A seeded-but-unplayed postseason chip opened as a matchup preview. Local, not a route: there
  // is no feed game to address, so this is a plain modal that closes on X/Escape.
  const [matchup, setMatchup] = useState<MatchupPreviewArg | null>(null)
  const headingTag = useWpblHeadingTag()
  const teamLink = useWpblTeamLink()

  // Leaders + tracking data, fetched here so only the home view pays for it. Seeded from the
  // shared session cache so swiping back to Home (the default tab, so the most re-entered)
  // repaints instantly instead of flashing every card's skeleton and re-pulling all three
  // datasets.
  const [players, setPlayers] = useState<WpblPlayer[]>(() => getCachedWpblAllPlayers() ?? [])
  const [allLines, setLines] = useState<{ batting: WpblBattingLine[]; pitching: WpblPitchingLine[] }>(
    () => getCachedWpblAllLines() ?? { batting: [], pitching: [] })
  const lines = useMemo(() => ({ batting: cut(allLines.batting), pitching: cut(allLines.pitching) }), [allLines, cut])
  // Only the distinct game ids that carry tracking, not the whole table: the banner reduces it to
  // a set of ids anyway, so this is a one-column read instead of the 766-row, 13-column scan the
  // full fetch does (see fetchWpblTrackedGameIds). The Tracking tab still pulls the real rows.
  const [trackedGameIds, setTrackedGameIds] = useState<string[]>(() => getCachedWpblTrackedGameIds() ?? [])
  const [loadingLeaders, setLoadingLeaders] = useState(() => wpblHomeCacheAgeMs() === Infinity)
  // The play log, for the MVP race that seeds the ballot's MVP and Pitcher shortlists, and
  // DELIBERATELY NOT in the fetch below.
  //
  // It is the most expensive read on the section (about 80KB gzipped and a second or so on a
  // phone), on a page where many visitors fire one event and leave, so it must not cost the page
  // its first paint. It is a SEPARATE effect that starts after the ones above and blocks nothing:
  // every card on Home renders on its own schedule, and the ballot slot holds a placeholder until
  // this lands (see the right-hand column).
  //
  // The fetcher is the same session-cached one the Run value board uses, so a reader who opens
  // both pays once, in whichever order they happen to visit.
  const [allPlays, setPlays] = useState<WpblRunValuePlay[]>(() => getCachedWpblAllRunValuePlays(current) ?? [])
  const plays = useMemo(() => cut(allPlays), [allPlays, cut])
  // Whether that read has ANSWERED yet, which is not the same question as whether it returned
  // anything, and the right column's ordering turns on the difference. See the note at the
  // bottom of the column.
  const [playsSettled, setPlaysSettled] = useState(() => getCachedWpblAllRunValuePlays(current) != null)
  // Discord invite dismissal, read once. Owned here (not inside DiscordCard) so a dismissed
  // invite unmounts the card entirely and leaves no empty wrapper taking up row-gap.
  const [discordDismissed, setDiscordDismissed] = useState(() => {
    try { return localStorage.getItem(DISCORD_DISMISS_KEY) === '1' } catch { return false }
  })
  // Dev only: the settings gear can put the invite back. `import.meta.env.DEV` is a build-time
  // constant, so the whole body of this effect is eliminated from the production bundle and
  // the listener is never registered there.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const onShow = () => setDiscordDismissed(false)
    window.addEventListener(DISCORD_DEV_SHOW_EVENT, onShow)
    return () => window.removeEventListener(DISCORD_DEV_SHOW_EVENT, onShow)
  }, [])

  // The MVP race's data, on its own. Failure is silent and the card just never appears, which
  // is the right outcome for a card that is a bonus rather than the page: nothing above it
  // depends on this resolving.
  //
  // NOT FETCHED AT ALL once the ballot's results have come off Home: the race then feeds nothing
  // on this page (see `seasonCards`, which keys on the same predicate), and the play log is four
  // pages plus a corrections read that every offseason visitor would pay for an unused number.
  //
  // ON A PHONE, NOT UNTIL THE READER MOVES. There the ballot is stacked two screens down, and this
  // read is the heaviest on the page (about 260KB of play log, then the run-value arithmetic on
  // top), so fetching it on arrival spent a phone's first seconds on a card nobody could see yet:
  // Lighthouse's mobile run had it racing the page's largest image. The first scroll or touch
  // starts it, which is long before anyone scrolls two screens. Desktop, where the ballot sits in
  // the first row and is on screen at once, still fetches on arrival. 900px is `md`, where Home's
  // two columns stack.
  useEffect(() => {
    if (!awardsResultsShowOnHome()) return
    let cancelled = false
    // This season's plays only: the card is this year's race. See fetchWpblPlayLog.
    const load = () => fetchWpblAllRunValuePlays(current)
      .then(p => { if (!cancelled) { setPlays(p); setPlaysSettled(true) } })
      .catch(() => { if (!cancelled) setPlaysSettled(true) /* no card, no error state: see above */ })
    const stacked = typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 899.95px)').matches
    if (!stacked || getCachedWpblAllRunValuePlays(current)) {
      load()
      return () => { cancelled = true }
    }
    const evs = ['scroll', 'wheel', 'touchstart', 'pointerdown', 'keydown'] as const
    let started = false
    const start = () => {
      if (started) return
      started = true
      evs.forEach(e => window.removeEventListener(e, start))
      load()
    }
    evs.forEach(e => window.addEventListener(e, start, { passive: true }))
    return () => { cancelled = true; evs.forEach(e => window.removeEventListener(e, start)) }
  }, [current])

  // While a game is live, refresh only the box-score lines, and on a gentle cadence. Deliberately
  // NOT re-pulled on the tick: the full player roster (static) and the whole pitch_tracking table
  // (large), because a full-table scan on every tick is enough load to peg the WPBL database.
  // Tracking only feeds the new-batch banner, and the league publishes it in batches days after a
  // game, so a live tick could not surface anything new anyway; it refreshes on the next visit.
  useForegroundInterval(() => {
    fetchWpblAllLines()
      .then(setLines)
      .catch(() => { /* keep last-good */ })
  }, liveGame ? 60000 : null)

  // The league's batting seasons: the pool the compare preview draws its pair from.
  const batSeasons = useMemo(() => aggregateBatting(players, lines.batting, seasonGames), [players, lines.batting, seasonGames])

  // Only enforce the PA / IP rate qualifier once every team has played 2+ games.
  const qual = useMemo(() => wpblQualifiers(teams, seasonGames), [teams, seasonGames])

  // Standings order for the bracket below. Its own memo rather than a prop threaded down from
  // StandingsCard: both call `computeStandings` on the same two arrays, so they cannot
  // disagree, and hoisting it would put the table's data in the page's scope for one consumer.
  const standingsRows = useMemo(() => computeStandings(teams, seasonGames), [teams, seasonGames])

  // The bracket, for the champion banner and whether the season is done. The PlayoffBracket card builds its own from
  // the same two arrays, so the two cannot disagree, and it is a handful of maps over the
  // schedule rather than anything worth threading down. Null until there are finals, and
  // `.champion` null until the title series is decided, so the offseason Home simply is not
  // there until it is true.
  const bracket = useMemo(() => buildBracket(standingsRows, seasonGames), [standingsRows, seasonGames])

  // Dev only: the settings gear simulates the end of the season in two phases (see devChampion.ts).
  // The whole listener is DEV-guarded, so in production this state stays 'off' and every branch
  // below is dead code that tree-shakes out. Seeded from the module so a mid-session mount reads
  // the current phase, not just future changes. Never overrides a real champion.
  const [devSim, setDevSim] = useState<DevChampionState>(
    () => import.meta.env.DEV ? devChampionState() : { phase: 'off', seed: 0 })
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const onDev = (e: Event) => setDevSim((e as CustomEvent<DevChampionState>).detail)
    window.addEventListener(DEV_CHAMPION_EVENT, onDev)
    return () => window.removeEventListener(DEV_CHAMPION_EVENT, onDev)
  }, [])
  // The simulated champion, only in the 'finished' phase: a random club that could win, picked off
  // the shared seed so the banner, the recap card and the season page land on the same one. The
  // DEV guard is first so production short-circuits to null and drops `devChampionPick` with it.
  const devChampTeam = useMemo(() => {
    if (!import.meta.env.DEV || devSim.phase !== 'finished') return null
    return devChampionPick(bracket, teams, devSim.seed)
  }, [devSim.phase, devSim.seed, bracket, teams])
  // 'started' or 'finished' both force the recap card into the Next-game slot: once the final is
  // under way there is no next game, which is the real trigger this stands in for.
  const devForceRecap = import.meta.env.DEV && devSim.phase !== 'off'

  // Whether the final is decided, the switch every offseason change on this page keys on. A
  // dev-simulated champion counts, so the offseason preview shows the offseason Home.
  const realChampion = useMemo(() => bracket ? championResult(bracket) : null, [bracket])
  const seasonDone = !!realChampion || !!devChampTeam
  // Next year's opener, for the skeleton's guess on a later load (see offseasonByCalendar).
  const opener = nextOpeningDay(schedule, current)
  useEffect(() => { rememberNextOpeningDay(opener) }, [opener])

  // Whether anything on this render reads the box-score lines. Off only on the offseason Home once
  // the award results have come down: Compare and the ballot are filtered out of `seasonCards`
  // below on these same two conditions, and nothing else on the page takes `lines` or
  // `batSeasons`. A live game turns it back on for LiveHero's sake. Decided from the real
  // schedule, which Home always has by the time it mounts; see homeLandingReadsLines for the
  // calendar guess the warm-up makes before then.
  const needsLines = !seasonDone || awardsResultsShowOnHome() || !!liveGame

  // Full load once, then revalidate on later mounts only when the cache is cold or stale:
  // a quick swipe back to a warm Home is instant and silent. Players are static for the
  // session; lines seed the leaders, and the tracked-game-id list drives the new-batch banner.
  // The lines are left out when nothing on the page reads them (see needsLines), which is every
  // offseason visit: ~73KB gzipped and ~340KB of JSON to parse, for no card at all.
  useEffect(() => {
    if (needsLines && wpblHomeCacheAgeMs() < 30_000) return
    let cancelled = false
    Promise.all([
      fetchWpblAllPlayers(),
      needsLines ? fetchWpblAllLines() : Promise.resolve(null),
      fetchWpblTrackedGameIds(),
    ])
      .then(([p, l, ids]) => {
        if (cancelled) return
        setPlayers(p); if (l) setLines(l); setTrackedGameIds(ids); setLoadingLeaders(false)
      })
      .catch(() => { if (!cancelled) setLoadingLeaders(false) })
    return () => { cancelled = true }
  }, [needsLines])

  // What the top-of-page banner draws, or null for none. The real one is up only until the end of
  // the day after the title was clinched (see championBannerUntil), then the season card carries
  // the champion alone. Read against the clock at render rather than a timer: a page left open
  // across that midnight keeps it until the next render, which costs nothing. The dev preview has
  // no window, since it exists to be looked at whenever someone is working on it, and it wins
  // over the real one: it is only ever on because someone switched it on, and in the offseason the
  // real banner has already come down, so deferring to it would leave nothing to preview.
  const championView = useMemo(() => {
    if (devChampTeam) return { champion: devChampTeam, season: String(new Date().getFullYear()), dev: true }
    if (!realChampion) return null
    const until = championBannerUntil(seasonGames, realChampion)
    if (until == null || Date.now() >= until) return null
    return { ...realChampion, season: gameYear(seasonGames, realChampion), dev: false }
  }, [realChampion, devChampTeam, seasonGames])

  /**
   * The bracket card, and whether it leads the page.
   *
   * `bracketLeads` is true from the last regular-season game until the first postseason FINAL.
   * A postseason game that is final is, by construction, the latest final in the league, so
   * `LastGameCard` is showing it and this stops leading. Keyed on the game rather than on the
   * calendar so a rain-out carries the same answer.
   *
   * THE FIRST HALF NEEDS regularSeasonOver. With only the postseason test, this was true from
   * Opening Day: a desktop reader spent the whole regular season under a bracket of early odds,
   * with Next game pushed to the fold.
   *
   * Built once and rendered in one of two places, never both: the same card in the page twice
   * is two impression events, two sets of controls, and both of them found by anything that
   * walks the text.
   */
  const bracketCard = standingsRows.length > 0 && seasonGames.some(g => g.status === 'final')
    ? (
      <Box sx={{ mt: 1.5 }}>
        <PlayoffBracket rows={standingsRows} games={seasonGames} onOpenTeam={onOpenTeam}
          onOpenPlayer={onOpenPlayer} onOpenGame={onOpenGame} from="home" />
      </Box>
    )
    : null
  const bracketLeads = regularSeasonOver(seasonGames, localIsoDate())
    && !seasonGames.some(g => g.status === 'final' && !countsInStandings(g))

  // The postseason as dated-but-undrawn rows, for the scoreboard strip. The same function the
  // Schedule tab reads, so the two cannot disagree about who plays whom or about which
  // if-necessary games are still conditional.
  const postRows = useMemo(
    () => postseasonScheduleRows(standingsRows, seasonGames, siteGames), [standingsRows, seasonGames, siteGames])

  // The MVP race. Two passes over the play log (the run-expectancy table, then every play
  // priced against it), memoized on the three arrays they read, because this is the most
  // arithmetic any card on Home does and none of it is cheap enough to redo on a repaint.
  //
  // The postseason is already out: both functions run their input through `regularSeasonLines`
  // themselves, which is also why this cannot disagree with the Run value board about which
  // games counted.
  const race = useMemo(() => {
    if (plays.length === 0 || players.length === 0) return null
    const table = buildRunExpectancy(plays, seasonGames)
    return mvpRace(playRunValues(plays, seasonGames, table), players, seasonGames)
  }, [plays, players, seasonGames])

  // New-tracking batch banner: fires when the set of tracked games grows since last seen.
  const { newCount: newTrackingCount, ack: ackTracking } = useNewTrackingBatch(trackedGameIds)
  const viewTracking = () => { ackTracking(); onViewTracking() }

  // Built here rather than inline because the right column renders its two cards in one of two
  // ORDERS (see the note there), and the same element has to be the same element in both so its
  // key can carry it across the swap without a remount. The key matters twice as much here: the
  // compare card holds a per-mount seed, so a remount would re-deal the pair mid-visit.
  const compareCard = (
    <ComparePreviewCard
      key="leaders"
      batSeasons={batSeasons}
      qual={qual}
      teams={teams}
      players={players}
      loading={loadingLeaders}
    />
  )

  // ONCE THERE IS A CHAMPION THE TOP GRID DROPS TO THE TWO CARDS ABOUT HOW IT ENDED: the season
  // card (the way into the recap) and the awards results. Last game is the final's last game,
  // already in the season card's game log, and it would sit frozen on that game until the next
  // season. Compare is the one card here not about the season at all, and the Stats tab and every
  // player page still reach it.
  const seasonCards = (!awardsResultsShowOnHome()
    // Past the results window: the ballot's slot gives way, exactly as it does when there
    // is no race to draw. Compare takes row 1 and an empty cell takes row 2, so the season
    // column collapses to what Next game needs rather than holding a slot for a card that
    // is not coming back.
    ? [compareCard, <Box key="mvp-empty" />]
    : mvpRaceIsWorthDrawing(race)
    ? [
      /* It spends whatever slack the row gives it on the chart, which is the one child
         that gets better with height; see the note on RaceChart's `fill`. */
      /* THE FAN BALLOT, not an MVP race card. The race is a number already on the Stats tab
          and on the player pages it ranks, so here it only seeds the ballot's MVP and Pitcher
          shortlists. The ballot asks something the section cannot answer on its own, and it
          keeps working after the feed stops and everything else here freezes. */
      /* Keyed `mvp`, the key the placeholder and the empty cell below also use, so the slot
          keeps one identity across all three branches and the compare card beside it is never
          remounted. */
      <FanVoteCard key="mvp" players={players} teams={teams} games={seasonGames}
        batting={lines.batting} pitching={lines.pitching} race={race} plays={plays}
        onOpenPlayer={onOpenPlayer} onOpenTeam={onOpenTeam}
        open={awardsOpen} onOpen={onOpenAwards} onClose={onCloseAwards} fill />,
      compareCard,
    ]
    // STILL IN FLIGHT IS NOT THE SAME AS NOTHING TO DRAW. The play log is fetched last and on
    // purpose (it is the one read allowed to be slow), so for the second or so after the page paints
    // there is no race yet. Treating that like "no race" would put Compare in row 1 for that second
    // and move it when the race arrives, sliding it down the screen under the reader. Holding the
    // slot costs a placeholder and settles the layout once.
    //
    // THE PLACEHOLDER MUST NOT BE TALLER THAN Next game. On desktop this slot is row 1 of a subgrid
    // whose other column is Next game (~16.4rem), so Next game already sets the row height; a taller
    // placeholder inflates row 1 while the play log is in flight and lets it COLLAPSE the instant the
    // ballot lands, which is the jump the slot exists to prevent. On a phone the two are stacked, so
    // this matches the ballot's own ~16rem instead.
    : !playsSettled
      ? [<CardSkeleton key="mvp" minHeight={{ xs: '16rem', md: '16rem' }} titleWidth="5.5rem" lines={4} />, compareCard]
      // Answered, and there is genuinely no race to draw (a season too young). Compare takes row 1 and
      // an empty grid cell takes row 2, so the row collapses to whatever Next game needs rather than
      // reserving a slot for a card that is never coming.
      : [compareCard, <Box key="mvp-empty" />])
    .filter(c => !seasonDone || (c !== compareCard && c.key !== 'mvp-empty'))

  return (
    <Box sx={homeWideSx}>
      {/* THE FAN AWARDS INVITATION, PHONES ONLY AND FIRST ON THE PAGE. See FanAwardsCta: the
          ballot card itself sits in Home's second column, which on a phone is two screens
          down, and it is the one card here that asks the reader for something rather than
          telling them something. Above the league header rather than under the scoreboard,
          because the header is `sm`-only and the scoreboard is the first thing a phone reader
          sees: anywhere else is already past the fold. It takes itself down when voting
          closes. */}
      <FanAwardsCta onOpen={onOpenAwards} />

      {/* Slim league header. On mobile it's just the title; on wider screens the club chips
          sit inline to the right. */}
      <Box sx={{
        display: 'flex', flexDirection: { xs: 'column', sm: 'row' },
        alignItems: { xs: 'flex-start', sm: 'center' }, gap: { xs: 1, sm: 1.5 },
        mb: { xs: 1.5, sm: HEADER_GAP },
      }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {/* The page's one <h1>. It carries the full league name (an exact match for that
              search) while the <title> in seo.ts leads with "WPBL Stats"; between them the
              home page covers both the brand term and the acronym people actually type. Every
              other WPBL tab is a separate route with its own h1. */}
          {/* WEIGHT 800. At 600 the page's one `h1` sits lighter than the `h2`s beneath it
              (0.95rem/700) while being only slightly bigger, so it reads as a caption above
              "Scoreboard" rather than as the top of anything. Size alone does not make a title
              on this page: the heaviest ink on it is the club names at display/800, and a title
              has to be in that conversation to win. */}
          {/* DRAWN AT EVERY WIDTH. On a phone the section nav is the bottom bar, so nothing at the
              top of the screen names the league but this; without it Home opened onto bare
              scoreboard tiles. It fits one line on a 375px phone. Never delete it: it is the page's
              one h1, an exact match for the search people type for this league, and Google indexes
              the mobile DOM. */}
          <Typography component={headingTag} sx={TAB_TITLE_SX}>
            Women's Pro Baseball League
          </Typography>
        </Box>
        {/* Team chips: badge + abbreviation in a tappable pill so they read as controls (not
            decoration) on touch, where there's no hover. Ring adopts the club color on hover,
            and a press-scale gives tactile feedback. Each jumps to that team's page. Hidden on
            mobile: the chips are redundant there with the full Teams tab a swipe away. */}
        <Box sx={{ display: { xs: 'none', sm: 'flex' }, flexWrap: 'wrap', gap: 0.75, flexShrink: 0 }}>
          {teams.map(t => (
            <Box
              key={t.id}
              {...teamLink(t, onOpenTeam)}
              sx={{
                ...UNSTYLED_LINK, ...FOCUS_RING,
                display: 'flex', alignItems: 'center', gap: 0.6,
                pl: '3px', pr: 0.9, py: '3px', borderRadius: 999,
                cursor: 'pointer', userSelect: 'none',
                border: '1px solid', borderColor: CARD_BORDER, bgcolor: CARD_FILL,
                transition: 'border-color 0.15s, transform 0.1s',
                ...hoverOnly({ borderColor: edge(wpblColor(t.id)) }),
                '&:active': { transform: 'scale(0.94)' },
              }}
            >
              <TeamBadge team={t} size={24} />
              <Typography sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 800, letterSpacing: typePx(0.3) }}>{t.abbr}</Typography>
            </Box>
          ))}
        </Box>
      </Box>

      {/* The new champion, for the day it is crowned and the day after. Top of the page, above
          everything else on it: a title outranks the live game and the tracking note for the days
          it is news. Renders nothing otherwise, unless a dev forces a preview. */}
      {championView && (
        <ChampionBanner
          champion={championView.champion}
          season={championView.season}
          runnerUp={'runnerUp' in championView ? championView.runnerUp : undefined}
          champWins={'champWins' in championView ? championView.champWins : undefined}
          rivalWins={'rivalWins' in championView ? championView.rivalWins : undefined}
          dev={championView.dev}
          onOpenTeam={onOpenTeam}
        />
      )}

      {/* A new pitch-tracking batch was just published: point readers to the Tracked board */}
      {newTrackingCount > 0 && (
        <NewTrackingBanner count={newTrackingCount} onView={viewTracking} onDismiss={ackTracking} />
      )}

      {/* Live game hero: the one in-progress game, front and center */}
      {liveGame && <LiveHero game={liveGame} teams={teams} players={players} onOpen={() => onOpenGame(liveGame)} />}

      {/* Scoreboard. The postseason rows come from the calendar the league published, and each
          one retires itself the day the feed carries a real game on its date.

          Gone once there is a champion, for the reason Last game goes: nothing is left to be
          played, so the strip would sit frozen on the final's scores until next season, and the
          season card's game log already carries those five games. Keyed on the champion like the
          rest of the offseason Home, so a dev-simulated champion previews it too. */}
      {!seasonDone && (
        <Scoreboard games={games} teams={teamMap} postseason={postRows} onOpenGame={onOpenGame} onOpenMatchup={setMatchup} />
      )}

      {/* THE OFFSEASON HOME LEADS WITH A PLAYER. A player page is what readers open most, and until
          Oct 2026 this page had no link to one: the gallery, Reading and Watch each point at a hub,
          the season card at the recap and its games. Player Spotlight sits beside the season card
          so a player is above the fold at every width, the leaders and the fan award winners answer
          who stood out, and the star sign card under the gallery (the players whose sign's season it
          is, with their birthdays) puts a dozen more names on the page, every one a real link. None
          of them costs a box-score read: they select from the roster the page already holds, the
          stored season rows and the award tally, and Player Spotlight reads its one player's lines. */}
      {seasonDone && (
        <>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 1.5, mt: 1.5 }}>
            <PlayerSpotlightCard players={players} teams={teamMap} games={games} onOpenPlayer={onOpenPlayer} />
            <NextGameCard games={games} teams={teamMap} postseason={postRows} onOpenGame={onOpenGame} players={players} onOpenPlayer={onOpenPlayer}
              devForceRecap={devForceRecap} devChampion={devChampTeam} />
          </Box>
          {/* The award results, for the days they stay up after the final (AWARDS_RESULTS_UNTIL). */}
          {seasonCards.length > 0 && <Box sx={{ mt: 1.5 }}>{seasonCards}</Box>}

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 1.5, mt: 1.5 }}>
            <SeasonLeadersCard players={players} teams={teamMap} games={games} onOpenPlayer={onOpenPlayer}
              rosterFailed={!loadingLeaders && players.length === 0} />
            <FanAwardWinnersCard players={players} teams={teamMap} onOpenPlayer={onOpenPlayer} onOpenTeam={onOpenTeam} onOpenAwards={onOpenAwards}
              rosterFailed={!loadingLeaders && players.length === 0} />
          </Box>

          {/* Fan photos: with no games left, the one block besides the player cards that changes
              from one visit to the next, and the rail reshuffles every load. */}
          <FanPhotoHomeCard reserve />

          {/* The players born under the sign whose season it is, each with their birthday: one card
              that does what a birthdays card and a star sign card did apart. Full width, so the
              names sit four abreast on a desktop rather than in a narrow column. */}
          <Box sx={{ mt: 1.5 }}>
            <StarSignCard players={players} teams={teamMap} games={games} onOpenPlayer={onOpenPlayer} />
          </Box>

          {/* Reading and Watch share a row: each was a full-width block for three posts or six
              posters, about a screen of desktop between them for nine links to two hub pages. */}
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 1.5, mt: 1.5 }}>
            <ReadingHomeCard teamById={teamMap} />
            <WatchCard from="home" compact placeholder={<CardSkeleton minHeight={WATCH_CARD_SKELETON_H} titleWidth="4rem" lines={0} />} />
          </Box>
        </>
      )}

      {!seasonDone && bracketLeads && bracketCard}

      {/* THE BRACKET LEADS THE PAGE UNTIL THE POSTSEASON HAS A GAME IN IT.
          Full width and outside the grid below on purpose either way: three series boxes side
          by side need the room, and the two columns down there share row boundaries through
          subgrid, which a third card of a different shape would break.

          It normally sits under the season's cards, so it does not displace Next game and its
          countdown. Between the last regular-season game and the first postseason one that
          ordering is wrong: Last game is a regular-season final nobody is waiting on, the
          bracket is the only thing on the page about what happens next, and it carries the
          pick'em, which has a deadline. The moment a postseason game is final, Last game IS that
          game and wins the argument again, and this puts itself back without anyone deciding to.

          Keyed on a postseason FINAL rather than on the calendar, so a rain-out moves it too. */}
      {/* Two columns: today's games on the left, the season's cards on the right.

          EVEN TRACKS, not three up. Three columns at this page's width give each card about
          317px, which clips club and player names; two at about 490px clip nothing. A tidier
          bottom edge is not worth reading "Meggie Meidling…".

          SUBGRID, so the two columns share their ROW boundaries. As two independent flex
          columns they would agree only at the top, and the ragged bottom edge would leave a
          notch under the shorter column. The parent declares two rows; each column spans both
          and re-uses them, so row 1 is max(Next game, ballot) in BOTH columns and row 2 is
          max(Last game, Compare). The bottom edge is flush by construction rather than by luck
          of the content.

          Every card in here is `fill`, and the shorter one in each row places the difference
          deliberately (see the `mt: 'auto'` in NextGameCard and LastGameCard, and the body
          distribution in ComparePreviewCard). Without that, stretching a card would just move
          the ragged edge inside it.

          NO `order` VALUES, which is the reason for subgrid rather than four bare grid items.
          Four items in one grid would align rows for free, but the single mobile column would
          then interleave the two columns, and fixing that needs `order` at one breakpoint: a
          second numbering scheme to keep in step with DOM order by hand. Keeping the columns as
          real elements means mobile is plain DOM order, and the columns drop back to flex below md.

          Subgrid is Chrome 117 / Safari 16 / Firefox 71. Where it is missing the declaration
          is dropped and each column falls back to its own two auto rows: degraded, not broken.

          In-season only: the offseason Home draws its own rows above. */}
      {!seasonDone && <Box sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
        gridTemplateRows: { md: 'auto auto' },
        // Its OWN top margin, rather than living off the scoreboard's bottom one. Every block in this
        // stack brings its own margin, and a block that depends on its neighbor for its spacing breaks
        // the next time something (the Discord invite) is inserted between them. Margins collapse, so a
        // dismissed invite still leaves 12px here rather than 24.
        mt: 1.5,
        // One gap in both directions, and it is Home's gap: 1.5 is the step between the scoreboard and
        // this grid, between this grid and the league card, and between the two cards stacked in each
        // column. With the cards sharing row boundaries, a wider column gap crossing narrower row gaps
        // reads as two grids rather than one.
        gap: 1.5,
      }}>
        {/* Today's games. */}
        <Box sx={{
          minWidth: 0, gap: 1.5,
          display: { xs: 'flex', md: 'grid' }, flexDirection: 'column',
          gridRow: { md: 'span 2' }, gridTemplateRows: { md: 'subgrid' },
        }}>
          <NextGameCard games={games} teams={teamMap} postseason={postRows} onOpenGame={onOpenGame} players={players} onOpenPlayer={onOpenPlayer}
            devForceRecap={devForceRecap} devChampion={devChampTeam} />
          <LastGameCard games={games} teams={teamMap} players={players} onOpenGame={onOpenGame} onOpenPlayer={onOpenPlayer} />
        </Box>

        {/* The season's cards.

            NO STANDINGS TABLE: it is a whole tab of its own, in the nav that is on screen the
            entire time, and a miniature copy spends a phone's screen on the one card every reader
            already knows where to find. Home still computes `computeStandings` for the bracket
            below. */}
        <Box sx={{
          minWidth: 0, gap: 1.5,
          display: { xs: 'flex', md: 'grid' }, flexDirection: 'column',
          gridRow: { md: 'span 2' }, gridTemplateRows: { md: 'subgrid' },
        }}>
          {/* THE BALLOT LEADS THIS COLUMN, SO IT IS THE ONE SEASON CARD ABOVE THE FOLD on a
              desktop. Row 1 pairs it with Next game and row 2 pairs Compare with Last game.

              KEYED, because the ballot waits on the play log (its shortlists come from the MVP race)
              and the slot contents change when that lands, about a second after first paint.
              Without stable keys React reconciles by position and remounts the compare card, which
              holds a per-mount seed and would re-deal its pair mid-visit. */}
          {seasonCards}
        </Box>
      </Box>}

      {/* Discord invite, mobile only, and under the games: above them it pushed Next game down a
          phone's first screen for a promo. Hidden at md+ because the desktop feed is a two-column
          subgrid with shared row boundaries that a loose card would break; a desktop home for it
          is a later job. */}
      {!discordDismissed && (
        <Box sx={{ display: { xs: 'block', md: 'none' }, mt: 1.5 }}>
          <DiscordCard onDismiss={() => setDiscordDismissed(true)} />
        </Box>
      )}

      {/* Its ordinary home, under the season's numbers. See bracketLeads. */}
      {/* Not in the offseason: the season card carries the final's games and the recap carries the
          whole bracket, and here it was 400px of a picture that will not change until spring. */}
      {!seasonDone && !bracketLeads && bracketCard}

      {/* The latest post, then About the league: two single lines, last on the page at both
          breakpoints, since everything above is about games. Both carry their own impression
          events so the reach of each can be read rather than assumed. */}
      {/* Fan photos during a season, once there are enough (see HOME_MIN_PHOTOS). Above The league
          and below everything about the games, the explore-and-relive zone. In the offseason it
          moves to the top instead (see above). Renders nothing, and adds no gap, until the
          threshold is met. */}
      {!seasonDone && <FanPhotoHomeCard />}

      <Box sx={{ mt: 1.5, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {!seasonDone && <WatchCard from="home" />}
        {!seasonDone && <LatestReadingCard />}
        <LeagueCard />
      </Box>

      {matchup && (
        <WpblMatchupPreview
          away={matchup.away} home={matchup.home} teams={teams} games={seasonGames}
          eyebrow={matchup.eyebrow} onClose={() => setMatchup(null)}
          onOpenTeam={onOpenTeam} onOpenPlayer={onOpenPlayer}
        />
      )}
    </Box>
  )
}
