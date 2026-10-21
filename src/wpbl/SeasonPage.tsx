
// /wpbl/season: the inaugural season as a finished thing.
//
// EVERY OTHER SURFACE HERE IS ABOUT TODAY. The scoreboard, the standings, Home's Next game: all
// of them answer "what is happening now", which is the right question during a season and a dead
// one after it. This page answers "what happened", the question that still has an audience in the
// offseason, and it is the read of the record the archive keeps (ROADMAP-WPBL.md #2a). So it is
// composition, not new data: every number below comes from the same box-score lines and play log
// the rest of the section already caches, run through the same aggregates.
//
// REGULAR SEASON ONLY, on purpose and everywhere. `countsInStandings` gates the fun facts and the
// biggest-plays walk, and the leader aggregates default to the regular-season scope, so a
// postseason box score cannot move a season number here any more than it can on the Stats tab.
// The one exception is Runs by inning, which offers the postseason as a SEPARATE scope behind its
// own toggle, split by the same `countsInStandings`, so a bracket run never lands in a
// regular-season square.
//
// NO TAB OF ITS OWN, like the league, glossary and sources pages beside it: a real path linked from the
// footer, which is the crawl path that has actually worked. See WPBL_SEASON_PAGE in routes.ts.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Box, Typography, useMediaQuery } from '@mui/material'
import { computeStandings } from './api'
import { buildBracket, championResult, championshipGames, aliveContenders, type ChampionResult } from './derive/bracket'
// Dev only: the season-finale simulator, so the champion block can be seen before the real final.
// The listener is DEV-guarded, so production never mounts it. See devChampion.ts.
import { DEV_CHAMPION_EVENT, devChampionState, type DevChampionState } from './dev/devChampion'
import SprayChart from './SprayChart'
import { WatchCard } from './Watch'
import { batStarScore, pitchStarScore, battingStatline, pitchingStatline } from './derive/recap'
import SeasonShapeCard from './SeasonShapeCard'
import { BracketDiagram } from './PlayoffBracket'
import LeaderboardRace from './LeaderboardRace'
import RunsByInning from './RunsByInning'
import { seasonShape, standingsAt, type SeasonPreview } from './derive/seasonShape'
import { battedHalves } from './derive/runsByInning'
import { buildRunExpectancy, playRunValues } from './derive/runExpectancy'
import { fipWeights } from './derive/linearWeights'
import { eraFipGaps } from './derive/eraFip'
import {
  aggregateBatting, aggregatePitching, wpblQualifiers, sumBatting, sumPitching, fmtRate, fmtTwo, ERA_BASIS_CANONICAL,
} from './stats'
import { countsInStandings } from './season'
import { fmtWinPct } from './derive/winProbability'
import { wpblPlayerPath, wpblGamePath, wpblTeamPath, wpblComparePath, WPBL_MATCHUPS_PAGE } from './routes'
import { batterPitcherMatchups, matchupBoard, type WpblMatchupLine } from './derive/matchups'
import { wpblColor } from './constants'
import { TAPPABLE, FOCUS_RING, CARD_BORDER, pressable, TextGhost } from './ui'
import WpblPage, { SectionHeading } from './WpblPage'
import { track, EVENTS } from '../lib/analytics'
import { shortDate } from '../lib/format'
import type { WpblPlayer, WpblTeam, WpblGame } from './types'
import { setDynamicSeo } from '../seo'
import { wpblSeasonPath } from './routes'
import { TYPE_SCALE } from '../ui/card'
import { isModified } from '../nav'
import { BAT_BOARDS, PIT_BOARDS, rankBatting, rankPitching } from './seasonPage/boards'
import { seasonMoments } from './seasonPage/moments'
import { useSeasonReads } from './seasonPage/useSeasonReads'
import { SeasonChampionBlock, FinalSeriesGames } from './seasonPage/Champion'
import { SeasonSkeleton } from './seasonPage/SeasonSkeleton'
import { FinalStandings } from './seasonPage/FinalStandings'
import {
  matchupLine, matchupExtra, StatTile, eraFipContext, PHONE_PLAYS, WildGameRow, BoardSet, JumpRow, LeaderBoard,
  withRanks, LeaderRow, PerformanceRow,
} from './seasonPage/pieces'
// The page's reads, its arithmetic and its smaller pieces live in seasonPage/; this file is the page.

/** A batter's side of the plate, from the roster's `bats`, normalized to one letter. Switch
 *  hitters ('S') and unknowns fall outside the two toggle states and simply are not counted in
 *  either, the same way the per-batter spray chart leaves a switch hitter out of its pull rate. */
const batSide = (bats: string | null | undefined): string => (bats ?? '').trim().toUpperCase()[0] ?? ''

export default function WpblSeasonPage({ path, onNavigate, onOpenGame }: {
  /** `/wpbl/season/2026` names its year; the bare `/wpbl/season` is the latest finished one. */
  path: string
  onNavigate: (to: string) => void
  // Opens a game as a modal hovering over this page, rather than navigating to it (which would
  // replace the page with WpblApp's Home). Supplied by the shell, which owns the overlay; see
  // GameOverlayHost. The links stay real <a href>s for crawlers, with the plain click intercepted.
  onOpenGame: (g: WpblGame, ctx: { teams: WpblTeam[]; games: WpblGame[] }) => void
}) {
  const { players, teams, allGames, games, batting, pitching, plays, battedBalls, year, firstSeason, videos, loading } = useSeasonReads(path)
  // Each year's recap is its own page with its own canonical; the bare URL is the latest of them
  // and points there, which is the half seo.ts's static entry cannot know in a second season.
  useEffect(() => {
    if (year == null) return
    const title = `The ${year} WPBL season in review | sportydolphin.fun`
    setDynamicSeo({
      path: path.replace(/\/+$/, ''),
      seo: {
        title,
        description: year === firstSeason || firstSeason == null
          ? "The inaugural Women's Pro Baseball League season, in one page: batting and pitching leaders, the numbers that set this league apart, its biggest plays and its most improbable win."
          : `The ${year} Women's Pro Baseball League season, in one page: batting and pitching leaders, the numbers that set this league apart, its biggest plays and its most improbable win.`,
        canonical: wpblSeasonPath(year),
      },
    })
    return () => setDynamicSeo(null)
  }, [year, firstSeason, path])
  const [hand, setHand] = useState<'R' | 'L'>('R')
  // Phone only: the recap ran to nearly twelve screens at 375px, most of it boards stacked one
  // under another that sit side by side on a desktop. See `BoardSet` and the jump row.
  const isPhone = useMediaQuery('(max-width:600px)')
  const [allPlays, setAllPlays] = useState(false)
  const [allWild, setAllWild] = useState(false)

  const teamById = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])
  const qual = useMemo(() => wpblQualifiers(teams, games), [teams, games])

  // The season's shape, feeding both the final standings table and the chart under it: one
  // `seasonShape` read, so the table a reader scrubs to and the line they scrubbed cannot come
  // from two different folds of the season. The same one-read rule StandingsView keeps.
  const shape = useMemo(() => seasonShape(teams, games), [teams, games])

  // The champion, for the block that opens the page. Postseason, so it comes off the bracket
  // rather than the regular-season `shape` above: `championResult` reads the final series record
  // (see derive/bracket), and is null until the title is decided, which is when the block appears.
  // The rest of the page stays regular-season only; this is the one postseason fact on it, and it
  // is the top of the story a reader arriving in the offseason came for.
  const bracket = useMemo(() => buildBracket(computeStandings(teams, games), games), [teams, games])
  const realChampion = useMemo(() => bracket ? championResult(bracket) : null, [bracket])
  // The final's games, played ones only, for the cards under the champion. Off the bracket's two
  // finalists rather than `champion` below, so a dev-simulated champion still shows the real
  // series, the same choice Home's recap card makes.
  const finalGames = useMemo(() => {
    const f = bracket?.championship
    if (!f?.home.team || !f.away.team) return []
    return championshipGames(games, f.home.team.id, f.away.team.id)
      .filter(g => g.status === 'final' && g.home_score != null && g.away_score != null)
  }, [bracket, games])

  // The best single games of the postseason, at the plate and on the mound. Ranked on the recap
  // engine's own star scores, so the line that led a game's Stars of the game ranks the same way
  // here. The club is the LINE's, never the roster's: a roster row says where a player is now.
  // The mound board needs three innings, the recap's own bar, or a two-out save with two
  // strikeouts would outrank a starter's six scoreless.
  const playoffBest = useMemo(() => {
    const post = games.filter(g => g.status === 'final' && !countsInStandings(g))
    if (post.length === 0) return null
    const gameById = new Map(post.map(g => [g.id, g]))
    // "Final, game 2": numbered within each pairing by date, since the two finalists meet only
    // in the final and each semifinal pairing only in its semifinal.
    const pair = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)
    const f = bracket?.championship
    const finalKey = f?.home.team && f.away.team ? pair(f.home.team.id, f.away.team.id) : null
    const byPair = new Map<string, WpblGame[]>()
    for (const g of post) {
      const k = pair(g.home_team_id, g.away_team_id)
      byPair.set(k, [...(byPair.get(k) ?? []), g])
    }
    const round = new Map<string, string>()
    for (const [k, list] of byPair) {
      list.sort((x, y) => x.game_date.localeCompare(y.game_date) || x.id.localeCompare(y.id))
      list.forEach((g, i) => round.set(g.id, `${k === finalKey ? 'Final' : 'Semifinal'}, game ${i + 1}`))
    }
    const bats = batting
      .filter(b => gameById.has(b.game_id) && batStarScore(b) > 0)
      .sort((x, y) => batStarScore(y) - batStarScore(x) || y.hr - x.hr || y.h - x.h)
      .slice(0, 5)
    const arms = pitching
      .filter(p => gameById.has(p.game_id) && p.outs >= 9)
      .sort((x, y) => pitchStarScore(y) - pitchStarScore(x) || y.so - x.so)
      .slice(0, 5)
    return { bats, arms, gameById, round }
  }, [games, batting, pitching, bracket])
  const playerById = useMemo(() => new Map(players.map(p => [p.id, p])), [players])

  // Dev only: the season-finale simulator. Seeded from the module so a mid-session mount reads the
  // current phase, then updated by the DEV-guarded listener. In production this stays 'off' and the
  // simulated block below is dead code that tree-shakes out; a real champion always wins over it.
  const [devSim, setDevSim] = useState<DevChampionState>(
    () => import.meta.env.DEV ? devChampionState() : { phase: 'off', seed: 0 })
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const onDev = (e: Event) => setDevSim((e as CustomEvent<DevChampionState>).detail)
    window.addEventListener(DEV_CHAMPION_EVENT, onDev)
    return () => window.removeEventListener(DEV_CHAMPION_EVENT, onDev)
  }, [])

  // What the block shows: the real champion (with its series line) if there is one, else, in the
  // simulator's 'finished' phase, a random contender picked off the shared seed so it matches the
  // same club Home shows. A simulated champion carries no series line: a random winner is not the
  // club that actually led the final.
  const champion = useMemo((): ChampionResult | null => {
    if (realChampion) return realChampion
    if (import.meta.env.DEV && devSim.phase === 'finished') {
      const pool = bracket ? aliveContenders(bracket) : []
      const list = pool.length > 0 ? pool : teams
      const pick = list.length > 0 ? list[Math.floor(devSim.seed * list.length) % list.length] : null
      if (pick) return { champion: pick, runnerUp: null, champWins: 0, rivalWins: 0 }
    }
    return null
  }, [realChampion, devSim.phase, devSim.seed, bracket, teams])
  const lastCol = shape.columns.length - 1
  // What the reader is pointing at on the chart below, in two speeds (see SeasonPreview): the
  // figures track the cursor, the row order waits for it to settle. Null on both means the table
  // is the season's last frame, which is the record this page is here to keep.
  const [preview, setPreview] = useState<SeasonPreview>({ live: null, settled: null })
  const onPreview = useCallback((view: SeasonPreview) => setPreview(view), [])
  // Which part of the recap a reader left it from. `section` names the block, `kind` what it opened.
  const opened = (section: string, kind: 'game' | 'player' | 'team') =>
    track(EVENTS.WPBL_PAGE_OPEN, { page: 'season', section, kind })
  // Order from the settled column, figures from the live one: a row is its rank on one day and
  // its record on another for as long as a scrub lasts. See StandingsView for the reasoning.
  const stOrder = standingsAt(shape, preview.settled ?? lastCol)
  const stFigures = standingsAt(shape, preview.live ?? lastCol)
  const standingRows = useMemo(() => {
    if (stOrder === stFigures) return stOrder
    const byTeam = new Map(stFigures.map(r => [r.team.id, r]))
    return stOrder.map(r => byTeam.get(r.team.id) ?? r)
  }, [stOrder, stFigures])
  // The SETTLED order's ids, for the row-flip: keyed off `stOrder` (a shape frame, stable until the
  // settled day moves) rather than `standingRows` (a fresh array on every figure tick), so the flip
  // re-measures only when a row can actually have changed places. Same rule as StandingsView.
  const stOrderIds = useMemo(() => stOrder.map(r => r.team.id), [stOrder])

  const batSeasons = useMemo(() => aggregateBatting(players, batting, games), [players, batting, games])
  const pitSeasons = useMemo(() => aggregatePitching(players, pitching, games), [players, pitching, games])

  // League totals, regular season, for the fun facts. sumBatting/sumPitching default to the
  // regular scope, so the postseason is already out.
  const leagueBat = useMemo(() => sumBatting(batting, games), [batting, games])
  // The most lopsided matchup each way, for the "Lopsided matchups" teaser. The boards' own order,
  // so the tile and the top row of /wpbl/matchups are the same matchup.
  const topMatchups = useMemo(() => {
    if (plays.length === 0) return null
    const lines = batterPitcherMatchups(plays, games)
    const batter = matchupBoard(lines, 'batter')[0] ?? null
    const pitcher = matchupBoard(lines, 'pitcher')[0] ?? null
    return batter || pitcher ? { batter, pitcher } : null
  }, [plays, games])
  const leaguePit = useMemo(() => sumPitching(pitching, games), [pitching, games])
  /** The pair's compare page, batter first as the tile reads, or nothing until the roster can
   *  spell both slugs. The same page a row on /wpbl/matchups opens. */
  const matchupHref = (l: WpblMatchupLine) => {
    const b = playerById.get(l.batterId), p = playerById.get(l.pitcherId)
    return b && p ? wpblComparePath(b, p, players) : undefined
  }

  // ERA against FIP. FIP's weights come off the play log, so this block waits on it the way the
  // biggest-plays block does and is simply absent until it lands.
  const eraFip = useMemo(() => {
    if (plays.length === 0) return null
    const w = fipWeights(playRunValues(plays, games, buildRunExpectancy(plays, games)))
    return eraFipGaps(pitSeasons, leaguePit, w, qual.minOuts)
  }, [plays, games, pitSeasons, leaguePit, qual.minOuts])

  const regFinals = useMemo(
    () => games.filter(g => g.status === 'final' && countsInStandings(g)),
    [games],
  )

  // Whether the heatmap has anything to draw, checked here so its heading never renders over an
  // empty section: a final whose line score is missing or does not add up is skipped by the derive.
  const inningsReady = useMemo(() => regFinals.some(g => battedHalves(g) != null), [regFinals])

  // The batted balls behind the spray chart: regular season only (a Set of the finals' ids), and
  // split by the batter's side of the plate. The join is batter_id -> roster `bats`, because a
  // batted-ball row carries no handedness of its own. Switch hitters fall into neither side, so
  // the two views together are slightly fewer than every ball, which the chart's own count shows.
  const battedByHand = useMemo(() => {
    const side = new Map(players.map(p => [p.id, batSide(p.bats)]))
    const regularIds = new Set(regFinals.map(g => g.id))
    return battedBalls.filter(p => regularIds.has(p.game_id) && side.get(p.batter_id) === hand)
  }, [battedBalls, players, regFinals, hand])

  // Home record: one hub venue means "home" is only batting last, so this is the cleanest read
  // any league can produce on whether batting last is worth anything.
  const homeRecord = useMemo(() => {
    let w = 0, l = 0
    for (const g of regFinals) {
      if (g.home_score == null || g.away_score == null || g.home_score === g.away_score) continue
      if (g.home_score > g.away_score) w++; else l++
    }
    return { w, l }
  }, [regFinals])

  // Biggest plays and the most improbable win; see seasonMoments.
  const { bigPlays, comeback, wildest } = useMemo(() => seasonMoments(plays, games, regFinals), [plays, games, regFinals])

  const gameCount = regFinals.length
  const hasData = gameCount > 0 && leagueBat.ab > 0
  const runsPerGame = gameCount > 0 ? leagueBat.r / gameCount : 0
  const stealPct = leagueBat.sb + leagueBat.cs > 0
    ? (leagueBat.sb / (leagueBat.sb + leagueBat.cs)) * 100 : null

  const teamName = (id: string | null | undefined) => {
    if (!id) return ''
    const t = teamById.get(id)
    return t ? t.city : id
  }
  const gameHref = (g: WpblGame) => wpblGamePath(g, teams, allGames)
  const playerHref = (p: WpblPlayer) => wpblPlayerPath(p, players)
  const teamHref = (t: WpblTeam) => wpblTeamPath(t, teams)

  return (
    <WpblPage
      title={year != null ? `The ${year} season` : 'The season'}
      // A LABEL, NOT A SUMMARY OF THE PAGE (house rule, Oct 21, 2026: labels, not narration). The
      // page's own headings say what is on it; what they cannot say is the sample.
      standfirst={loading
        ? <TextGhost>Regular season · 30 games</TextGhost>
        : gameCount > 0 ? `Regular season · ${gameCount} games` : undefined}
    >
      {loading && <SeasonSkeleton isPhone={isPhone} />}

      {!loading && !hasData && (
        <Typography sx={{ color: 'text.secondary' }}>No data</Typography>
      )}

      {/* Flat cards in dark mode, the same surface Home uses: every card here is already an outline
          with no fill (see the note above StatTile), and this is what gives those outlines the
          flat surface's stronger weight. */}
      {hasData && (
        <Box>
          {/* ── Champion ─────────────────────────────────────────────────────────
              The one postseason fact on an otherwise regular-season page, and it leads because in
              the offseason the champion IS the top of the story. Absent until the title is
              decided, so the page reads as the season-so-far during the postseason and gains its
              headline the day the final ends. */}
          {champion && (
            <Box sx={{ mb: 2.5 }}>
              <SeasonChampionBlock champ={champion} />
              {finalGames.length > 0 && (
                <FinalSeriesGames games={finalGames} teamById={teamById}
                  href={gameHref} onOpen={g => { opened('final_games', 'game'); onOpenGame(g, { teams, games: allGames }) }} />
              )}
            </Box>
          )}

          {/* ── Jump row ─────────────────────────────────────────────────────────
              Phone only. Only the sections that rendered, so no link points at nothing. */}
          {isPhone && (
            <JumpRow links={[
              bracket?.started ? ['season-bracket', 'Bracket'] : null,
              shape.games > 0 ? ['season-standings', 'Standings'] : null,
              ['season-batting', 'Batting'],
              ['season-pitching', 'Pitching'],
              bigPlays.length > 0 ? ['season-plays', 'Plays'] : null,
            ]} />
          )}

          {/* ── Playoff bracket ──────────────────────────────────────────────────
              How the champion got there: both semifinals and the final, as a record. Home's
              diagram without its extras: no odds (every series is decided, and a decided series
              shows none anyway), no pick'em, and no series overview, which previews a series and
              has nothing to say about one that is over. The diagram already stacks on a phone
              and spreads into the bracket shape from `sm` up. Only once the postseason has begun,
              so the recap never carries a projection. */}
          {bracket?.started && (
            <>
              <SectionHeading seen="season" id="season-bracket">Playoff bracket</SectionHeading>
              <BracketDiagram bracket={bracket} bare />
            </>
          )}

          {/* ── Best playoff performances ────────────────────────────────────────
              Postseason, like the champion above it and unlike everything below: the single
              lines that stood out across the semifinals and the final. Each row opens the game. */}
          {playoffBest && (playoffBest.bats.length > 0 || playoffBest.arms.length > 0) && (() => {
            const row = (key: string, rank: number, playerId: string, teamId: string | null, gameId: string, stat: string) => {
              const g = playoffBest.gameById.get(gameId)!
              const opp = teamById.get(g.home_team_id === teamId ? g.away_team_id : g.home_team_id)
              // Straight to the box score, not the Recap a final opens on, and on the player's
              // own club: the row is one line, and that is where it is. Through onNavigate, which
              // opens a game URL as an overlay over this page with its query intact.
              const href = `${gameHref(g)}?tab=box${teamId === g.home_team_id ? '&side=home' : ''}`
              return (
                <PerformanceRow key={key} rank={rank} name={playerById.get(playerId)?.name ?? '—'} teamId={teamId}
                  context={`${playoffBest.round.get(gameId) ?? 'Postseason'}${opp ? ` vs ${opp.abbr}` : ''}`}
                  stat={stat} href={href} onOpen={() => { opened('playoff_best', 'game'); onNavigate(href) }} />
              )
            }
            return (
              <>
                <SectionHeading seen="season">Best playoff performances</SectionHeading>
                {/* minmax(0, ...) because a bare `1fr` track cannot shrink below its content's
                    min-content width, and a single-game line ("5-5, 1 HR, 4 RBI") is nowrap: on a
                    phone both boards ran off the right edge of the page instead of the name giving. */}
                <BoardSet phone={isPhone} columns={{ xs: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))' }} boards={[
                  playoffBest.bats.length > 0 ? {
                    key: 'hitting', chip: 'Hitting',
                    node: (
                      <LeaderBoard title="Hitting">
                        {playoffBest.bats.map((b, i) => row(b.id, i + 1, b.player_id, b.team_id, b.game_id, battingStatline(b)))}
                      </LeaderBoard>
                    ),
                  } : null,
                  playoffBest.arms.length > 0 ? {
                    key: 'pitching', chip: 'Pitching',
                    node: (
                      <LeaderBoard title="Pitching">
                        {playoffBest.arms.map((p, i) => row(p.id, i + 1, p.player_id, p.team_id, p.game_id, pitchingStatline(p)))}
                      </LeaderBoard>
                    ),
                  } : null,
                ]} />
              </>
            )
          })()}

          {/* ── Watch ────────────────────────────────────────────────────────────
              The door to /wpbl/watch, which replaced the twelve-card highlights rail that sat here.
              Each game page still carries its own videos. */}
          {videos.length > 0 && (
            <>
              <SectionHeading seen="season">Watch</SectionHeading>
              <WatchCard from="recap" eyebrow={false} />
            </>
          )}

          {/* ── Final standings ──────────────────────────────────────────────────
              The record spine of the page, so it leads. The table is the season's last frame;
              the chart under it is every earlier one, and dragging the chart scrubs the table
              back to any date. Both are drawn from the one `shape` above, so they cannot
              disagree. Regular season only, like everything else here: `seasonShape` folds
              `standingsFinals`, which drops the postseason. */}
          {shape.games > 0 && (
            <>
              <SectionHeading seen="season" id="season-standings">Final standings</SectionHeading>
              <FinalStandings rows={standingRows} orderIds={stOrderIds} cadence={preview.cadenceMs} teamHref={teamHref}
                onNavigate={href => { opened('standings', 'team'); onNavigate(href) }} />
              <Box sx={{ mt: 1.5 }}>
                <SeasonShapeCard shape={shape} onPreview={onPreview} page="season" />
              </Box>
            </>
          )}

          {/* The standings race above is the clubs; this is the players. Same idea one level down. */}
          {shape.games > 0 && (
            <>
              <SectionHeading seen="season">Leaderboard race</SectionHeading>
              <LeaderboardRace players={players} teams={teams} games={games} batting={batting} plays={plays} />
            </>
          )}

          {/* ── Notable numbers ──────────────────────────────────────────────── */}
          <SectionHeading seen="season">Notable numbers</SectionHeading>
          <Box sx={{
            display: 'grid', gap: 1,
            gridTemplateColumns: { xs: '1fr 1fr', sm: '1fr 1fr 1fr', md: 'repeat(4, 1fr)' },
          }}>
            <StatTile value={runsPerGame.toFixed(1)} label="Runs per game" sub="Both clubs" />
            <StatTile value={fmtRate(leagueBat.avg)} label="League average" sub={`${fmtRate(leagueBat.obp)} on-base`} />
            <StatTile
              value={`${leagueBat.bb}–${leagueBat.so}`}
              label="BB–K"
              sub={leagueBat.bb === leagueBat.so
                ? 'Even'
                : `+${Math.abs(leagueBat.bb - leagueBat.so)} ${leagueBat.bb > leagueBat.so ? 'BB' : 'K'}`}
            />
            <StatTile value={String(leagueBat.hr)} label="Home runs" sub={`${leagueBat.doubles} doubles`} />
            {leagueBat.triples === 0
              ? <StatTile value="0" label="Triples" highlight />
              : <StatTile value={String(leagueBat.triples)} label="Triples" />}
            <StatTile
              value={String(leagueBat.sb)}
              label="Stolen bases"
              sub={stealPct != null ? `${stealPct.toFixed(0)}% success` : undefined}
            />
            <StatTile value={String(leagueBat.hbp)} label="Hit batters" sub={`${leaguePit.wp} wild pitches`} />
            <StatTile value={String(leaguePit.bk)} label="Balks" />
            <StatTile
              value={`${homeRecord.w}–${homeRecord.l}`}
              label="Home record"
              sub="One venue"
            />
          </Box>

          {/* ── Lopsided matchups ───────────────────────────────────────────── */}
          {/* The two most lopsided matchups of the regular season, one each way, as a door into the
              full board at /wpbl/matchups. This page is where offseason readers arrive, and the
              board is the part of the season no one else covering the league can show. */}
          {topMatchups && (
            <>
              <SectionHeading seen="season" info="The most one-sided batter vs pitcher records of the regular season, one each way.">Lopsided matchups</SectionHeading>
              <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
                {/* BATTER FIRST ON BOTH, because the big number is always the batter's line: led by
                    the pitcher, "0-for-5" above "Jaida Lee vs ..." read as the pitcher going hitless. */}
                {topMatchups.batter && <StatTile value={matchupLine(topMatchups.batter)} label={`${topMatchups.batter.batterName} vs ${topMatchups.batter.pitcherName}`} sub={`${matchupExtra(topMatchups.batter)}batter's edge`} href={matchupHref(topMatchups.batter)} onNavigate={onNavigate} />}
                {topMatchups.pitcher && <StatTile value={matchupLine(topMatchups.pitcher)} label={`${topMatchups.pitcher.batterName} vs ${topMatchups.pitcher.pitcherName}`} sub={`${matchupExtra(topMatchups.pitcher)}pitcher's edge`} href={matchupHref(topMatchups.pitcher)} onNavigate={onNavigate} />}
              </Box>
              <Box
                component="a"
                href={WPBL_MATCHUPS_PAGE}
                onClick={(e: React.MouseEvent) => { if (!isModified(e)) { e.preventDefault(); onNavigate(WPBL_MATCHUPS_PAGE) } }}
                sx={{
                  display: 'inline-block', mt: 1.25, fontSize: TYPE_SCALE.body, fontWeight: 700,
                  color: 'var(--wpbl-accent-fg)', textDecoration: 'none', ...FOCUS_RING,
                  '@media (hover: hover)': { '&:hover': { textDecoration: 'underline' } },
                }}
              >
                All batter vs pitcher matchups ›
              </Box>
            </>
          )}

          {/* ── Spray chart ──────────────────────────────────────────────────── */}
          {battedBalls.length > 0 && (
            <>
              <SectionHeading seen="season" info={[
                'Every batted ball the league placed, by the side of the plate the hitter batted from.',
                'Right-handers pull to left field; the left-handed view is the mirror of it.',
              ]}>Spray chart</SectionHeading>
              {/* Right and left, not a single mixed chart: pull, center and oppo are defined by
                  which box the batter stood in, so a league-wide chart is only readable one side
                  at a time. The toggle is the whole point of the visual. */}
              <Box sx={{ display: 'flex', gap: 0.5, mb: 1.5 }}>
                {(['R', 'L'] as const).map(h => (
                  <Box key={h} {...pressable(() => { setHand(h); track(EVENTS.WPBL_PAGE_CONTROL, { page: 'season', control: 'spray_hand', value: h }) })} sx={{
                    ...FOCUS_RING,
                    px: 1.5, py: 0.5, borderRadius: 999, cursor: 'pointer', userSelect: 'none',
                    border: '1px solid', borderColor: hand === h ? 'transparent' : 'outline',
                    bgcolor: hand === h ? 'text.primary' : 'transparent',
                  }}>
                    <Typography sx={{
                      fontSize: TYPE_SCALE.body, fontWeight: 800,
                      color: hand === h ? 'background.paper' : 'text.secondary',
                    }}>{h === 'R' ? 'Right-handed' : 'Left-handed'}</Typography>
                  </Box>
                ))}
              </Box>
              {battedByHand.length > 0 ? (
                <SprayChart plays={battedByHand} bats={hand} />
              ) : (
                <Typography sx={{ color: 'text.disabled', fontSize: TYPE_SCALE.body }}>No data</Typography>
              )}
            </>
          )}

          {/* ── Runs by inning ───────────────────────────────────────────────── */}
          {inningsReady && (
            <>
              <SectionHeading seen="season">Runs by inning</SectionHeading>
              <RunsByInning games={games} teams={teams} />
            </>
          )}

          {/* ── Leaders ──────────────────────────────────────────────────────── */}
          <SectionHeading seen="season" id="season-batting">Batting leaders</SectionHeading>
          <BoardSet phone={isPhone} boards={BAT_BOARDS.map(board => {
              const rows = rankBatting(batSeasons, board, qual.minPa, qual.active)
              if (rows.length === 0) return null
              return { key: board.label, chip: board.chip, node: (
                <LeaderBoard key={board.label} title={board.label}>
                  {withRanks(rows.map(s => board.fmt(board.get(s.totals)!))).map(({ rank, wide }, i) => {
                    const s = rows[i]
                    return (
                      <LeaderRow
                        key={s.player.id}
                        rank={rank}
                        wide={wide}
                        name={s.player.name}
                        teamId={s.player.team_id}
                        value={board.fmt(board.get(s.totals)!)}
                        href={playerHref(s.player)}
                        onNavigate={href => { opened('batting_leaders', 'player'); onNavigate(href) }}
                      />
                    )
                  })}
                </LeaderBoard>
              ) }
            })} />

          <SectionHeading seen="season" id="season-pitching">Pitching leaders</SectionHeading>
          <BoardSet phone={isPhone} boards={PIT_BOARDS.map(board => {
              const rows = rankPitching(pitSeasons, board, qual.minOuts, qual.active)
              if (rows.length === 0) return null
              return { key: board.label, chip: board.chip, node: (
                <LeaderBoard key={board.label} title={board.label}>
                  {withRanks(rows.map(s => board.fmt(board.get(s.totals)!))).map(({ rank, wide }, i) => {
                    const s = rows[i]
                    return (
                      <LeaderRow
                        key={s.player.id}
                        rank={rank}
                        wide={wide}
                        name={s.player.name}
                        teamId={s.player.team_id}
                        value={board.fmt(board.get(s.totals)!)}
                        href={playerHref(s.player)}
                        onNavigate={href => { opened('pitching_leaders', 'player'); onNavigate(href) }}
                      />
                    )
                  })}
                </LeaderBoard>
              ) }
            })} />

          {/* ── ERA vs FIP ───────────────────────────────────────────────────────
              Label headings and a stated fact per row, no verdict: see derive/eraFip.ts for why
              the row says which number moved rather than calling it luck. */}
          {eraFip && (eraFip.eraLower.length > 0 || eraFip.eraHigher.length > 0) && (
            <>
              <SectionHeading seen="season" info={[
                'FIP: an ERA built only from strikeouts, walks, hit batters and home runs, the outcomes no fielder touches.',
                `Qualified pitchers, regular season, per ${ERA_BASIS_CANONICAL} innings.`,
                ...(leaguePit.babip != null ? [`League BABIP: ${fmtRate(leaguePit.babip)}.`] : []),
              ]}>ERA vs FIP</SectionHeading>
              <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(2, minmax(0, 1fr))' } }}>
                {([['ERA lower than FIP', eraFip.eraLower], ['ERA higher than FIP', eraFip.eraHigher]] as const)
                  .filter(([, rows]) => rows.length > 0)
                  .map(([title, rows]) => (
                    <LeaderBoard key={title} title={title}>
                      {rows.map((r, i) => {
                        const href = playerHref(r.season.player)
                        return (
                          <PerformanceRow
                            key={r.season.player.id}
                            rank={i + 1}
                            name={r.season.player.name}
                            teamId={r.season.player.team_id}
                            stat={`ERA ${fmtTwo(r.era)}`}
                            context={eraFipContext(r)}
                            wrapContext
                            href={href}
                            onOpen={() => { opened('era_fip', 'player'); onNavigate(href) }}
                          />
                        )
                      })}
                    </LeaderBoard>
                  ))}
              </Box>
            </>
          )}

          {/* ── The wildest games ────────────────────────────────────────────── */}
          {wildest.length > 0 && (
            <>
              <SectionHeading seen="season" id="season-wildest" info={[
                'Ranked by every swing in win probability over a game, added up.',
                'The line is the winner’s win probability, play by play.',
              ]}>Wildest games</SectionHeading>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {(isPhone && !allWild ? wildest.slice(0, PHONE_PLAYS) : wildest).map((w, i) => (
                  <WildGameRow
                    key={w.game.id} rank={i + 1} wild={w} teamName={teamName} phone={isPhone}
                    href={gameHref(w.game)}
                    onOpen={() => { opened('wildest_games', 'game'); onOpenGame(w.game, { teams, games: allGames }) }}
                  />
                ))}
                {isPhone && wildest.length > PHONE_PLAYS && (
                  <Box {...pressable(() => setAllWild(v => !v))} sx={{
                    ...FOCUS_RING, alignSelf: 'center', cursor: 'pointer', userSelect: 'none',
                    px: 1.5, py: 0.75, borderRadius: 999, border: '1px solid', borderColor: CARD_BORDER,
                    fontSize: TYPE_SCALE.body, fontWeight: 800, color: 'var(--wpbl-accent-fg)',
                  }}>
                    {allWild ? 'Show fewer' : `Show all ${wildest.length}`}
                  </Box>
                )}
              </Box>
            </>
          )}

          {/* ── The most improbable win ──────────────────────────────────────── */}
          {comeback && (
            <>
              <SectionHeading seen="season" info="The lowest win probability any winner had at some point in a game.">Most improbable win</SectionHeading>
              <Box
                component="a"
                href={gameHref(comeback.game)}
                onClick={e => { opened('improbable_win', 'game'); if (!isModified(e)) { e.preventDefault(); onOpenGame(comeback.game, { teams, games: allGames }) } }}
                sx={{
                  display: 'block', textDecoration: 'none', color: 'inherit',
                  borderRadius: 2, p: 2, border: '1px solid', borderColor: 'var(--wpbl-accent-fg)',
                  ...TAPPABLE,
                }}
              >
                <Typography sx={{ fontSize: TYPE_SCALE.heading, fontWeight: 800, mb: 0.5 }}>
                  {teamName(comeback.winnerId)} won from {fmtWinPct(comeback.low)}
                </Typography>
                <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.secondary' }}>
                  {teamName(comeback.game.away_team_id)} {comeback.game.away_score} at{' '}
                  {teamName(comeback.game.home_team_id)} {comeback.game.home_score} · {shortDate(comeback.game.game_date)}
                </Typography>
              </Box>
            </>
          )}

          {/* ── Biggest plays ────────────────────────────────────────────────── */}
          {bigPlays.length > 0 && (
            <>
              <SectionHeading seen="season" id="season-plays" info="The plays that moved the eventual winner’s win probability the most, one per game: before and after.">Biggest plays</SectionHeading>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {(isPhone && !allPlays ? bigPlays.slice(0, PHONE_PLAYS) : bigPlays).map(bp => (
                  <Box
                    key={bp.game.id}
                    component="a"
                    href={gameHref(bp.game)}
                    onClick={e => { opened('turning_plays', 'game'); if (!isModified(e)) { e.preventDefault(); onOpenGame(bp.game, { teams, games: allGames }) } }}
                    sx={{
                      display: 'flex', alignItems: 'center', gap: 1.5, textDecoration: 'none',
                      color: 'inherit', borderRadius: 2, p: 1.5,
                      border: '1px solid', borderColor: CARD_BORDER,
                      ...TAPPABLE,
                    }}
                  >
                    <Box sx={{ flexShrink: 0, width: 4, alignSelf: 'stretch', borderRadius: 2, bgcolor: wpblColor(bp.teamId) }} />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={{ fontSize: TYPE_SCALE.title, fontWeight: 600, lineHeight: 1.35 }}>
                        {bp.narrative}
                      </Typography>
                      <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.disabled', lineHeight: 1.35 }}>
                        {teamName(bp.game.away_team_id)} at {teamName(bp.game.home_team_id)} · {shortDate(bp.game.game_date)}
                      </Typography>
                    </Box>
                    <Typography sx={{ flexShrink: 0, fontSize: TYPE_SCALE.body, fontWeight: 800, color: 'var(--wpbl-accent-fg)' }}>
                      {fmtWinPct(bp.winnerBefore)} → {fmtWinPct(bp.winnerAfter)}
                    </Typography>
                  </Box>
                ))}
                {isPhone && bigPlays.length > PHONE_PLAYS && (
                  <Box {...pressable(() => setAllPlays(v => !v))} sx={{
                    ...FOCUS_RING, alignSelf: 'center', cursor: 'pointer', userSelect: 'none',
                    px: 1.5, py: 0.75, borderRadius: 999, border: '1px solid', borderColor: CARD_BORDER,
                    fontSize: TYPE_SCALE.body, fontWeight: 800, color: 'var(--wpbl-accent-fg)',
                  }}>
                    {allPlays ? 'Show fewer' : `Show all ${bigPlays.length}`}
                  </Box>
                )}
              </Box>
            </>
          )}
        </Box>
      )}
    </WpblPage>
  )
}
