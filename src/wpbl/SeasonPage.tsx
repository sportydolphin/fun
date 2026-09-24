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
// NO NAV PILL, like the league, glossary and sources pages beside it: a real path linked from the
// footer, which is the crawl path that has actually worked. See WPBL_SEASON_PAGE in routes.ts.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Box, Typography, CircularProgress } from '@mui/material'
import {
  fetchWpblAllPlayers, fetchWpblTeams, fetchWpblSchedule, fetchWpblAllLines,
  fetchWpblAllRunValuePlays, fetchWpblBattedBalls, computeStandings, fetchWpblVideos, getCachedWpblVideos,
} from './api'
import { buildBracket, championResult, championshipGames, aliveContenders, type ChampionResult } from './derive/bracket'
// Dev only: the season-finale simulator, so the champion block can be seen before the real final.
// The listener is DEV-guarded, so production never mounts it. See devChampion.ts.
import { DEV_CHAMPION_EVENT, devChampionState, type DevChampionState } from './dev/devChampion'
import SprayChart from './SprayChart'
import { HighlightsStrip } from './Highlights'
import { batStarScore, pitchStarScore, battingStatline, pitchingStatline } from './derive/recap'
import SeasonShapeCard from './SeasonShapeCard'
import { BracketDiagram } from './PlayoffBracket'
import LeaderboardRace from './LeaderboardRace'
import RunsByInning from './RunsByInning'
import { seasonShape, standingsAt, type SeasonPreview } from './derive/seasonShape'
import { battedHalves } from './derive/runsByInning'
import {
  aggregateBatting, aggregatePitching, wpblQualifiers, plateAppearances,
  sumBatting, sumPitching, fmtRate, fmtTwo,
  type WpblBatSeason, type WpblPitSeason,
} from './stats'
import { countsInStandings } from './season'
import { useRowFlip, useRowDividers } from './rowFlip'
import { winProbModel, gameWinProb, swingOfGame, fmtWinPct } from './derive/winProbability'
import { wpblPlayerPath, wpblGamePath, wpblTeamPath } from './routes'
import { wpblColor, wpblAccent, wpblFullName } from './constants'
import { TAPPABLE, FOCUS_RING, CARD_BORDER, FLAT_CARDS_DARK, pressable, TeamBadge, PlayerPortrait, useWpblDark, useWpblName } from './ui'
import WpblPage, { SectionHeading } from './WpblPage'
import type {
  WpblPlayer, WpblTeam, WpblGame, WpblBattingLine, WpblPitchingLine, WpblRunValuePlay,
  WpblSprayPlay, WpblStandingRow, WpblVideo,
} from './types'

/** A batter's side of the plate, from the roster's `bats`, normalised to one letter. Switch
 *  hitters ('S') and unknowns fall outside the two toggle states and simply are not counted in
 *  either, the same way the per-batter spray chart leaves a switch hitter out of its pull rate. */
const batSide = (bats: string | null | undefined): string => (bats ?? '').trim().toUpperCase()[0] ?? ''

const isModified = (e: React.MouseEvent) =>
  e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0

// ─── Leader boards ──────────────────────────────────────────────────────────────
// One accessor per category. `null` from the accessor drops the row (no denominator), which is
// what keeps a pitcher with no innings off the ERA board rather than sorting them to the top.

type BatKey = { label: string; get: (t: WpblBatSeason['totals']) => number | null; fmt: (v: number) => string; asc?: boolean; rate?: boolean }
type PitKey = { label: string; get: (t: WpblPitSeason['totals']) => number | null; fmt: (v: number) => string; asc?: boolean; rate?: boolean }

const asInt = (v: number) => String(v)

const BAT_BOARDS: BatKey[] = [
  { label: 'AVG', get: t => t.avg, fmt: fmtRate, rate: true },
  { label: 'OPS', get: t => t.ops, fmt: fmtRate, rate: true },
  { label: 'Home runs', get: t => t.hr, fmt: asInt },
  { label: 'RBI', get: t => t.rbi, fmt: asInt },
  { label: 'Hits', get: t => t.h, fmt: asInt },
  { label: 'Stolen bases', get: t => t.sb, fmt: asInt },
]

const PIT_BOARDS: PitKey[] = [
  { label: 'Wins', get: t => t.w, fmt: asInt },
  { label: 'ERA', get: t => t.era, fmt: fmtTwo, asc: true, rate: true },
  { label: 'Strikeouts', get: t => t.so, fmt: asInt },
  { label: 'WHIP', get: t => t.whip, fmt: fmtTwo, asc: true, rate: true },
  { label: 'Saves', get: t => t.s, fmt: asInt },
]

const TOP_N = 3

/** Rank a set of season lines by one accessor, dropping nulls and (for a rate title) anyone
 *  short of the qualifying bar. Ties break on the value alone; a stable enough order for three
 *  rows. */
function rankBatting(seasons: WpblBatSeason[], board: BatKey, minPa: number, active: boolean): WpblBatSeason[] {
  const eligible = seasons.filter(s => {
    if (board.get(s.totals) == null) return false
    if (board.rate && active && plateAppearances(s.totals) < minPa) return false
    return true
  })
  eligible.sort((a, b) => {
    const av = board.get(a.totals)!, bv = board.get(b.totals)!
    return board.asc ? av - bv : bv - av
  })
  return eligible.slice(0, TOP_N)
}

function rankPitching(seasons: WpblPitSeason[], board: PitKey, minOuts: number, active: boolean): WpblPitSeason[] {
  const eligible = seasons.filter(s => {
    if (board.get(s.totals) == null) return false
    if (board.rate && active && s.totals.outs < minOuts) return false
    // A save or win board should not be topped by someone with one appearance and a fluke; but
    // counting stats are their own qualifier (you cannot accumulate them without playing), so
    // only the rate boards gate. The `w`/`s` boards drop a zero via the value sort naturally.
    return true
  })
  eligible.sort((a, b) => {
    const av = board.get(a.totals)!, bv = board.get(b.totals)!
    return board.asc ? av - bv : bv - av
  })
  // Drop trailing zeros on a counting board so "Saves" does not list three players tied at 0.
  const nonZero = eligible.filter(s => (board.get(s.totals) ?? 0) > 0)
  return (nonZero.length ? nonZero : eligible).slice(0, TOP_N)
}

// ─── Biggest plays / most improbable win ─────────────────────────────────────────

interface BigPlay {
  game: WpblGame
  narrative: string
  /** Win probability for the eventual winner, before and after the play. */
  winnerBefore: number
  winnerAfter: number
  teamId: string | null
}

interface Comeback {
  game: WpblGame
  /** The lowest win probability the eventual winner held at any point. */
  low: number
  winnerId: string
}

/** The eventual winner's win probability at a point, from the home-side number the model stores. */
const winnerProb = (homeSide: number, homeWon: boolean) => (homeWon ? homeSide : 1 - homeSide)

// ─── Small presentational bits ────────────────────────────────────────────────────
//
// EVERY CARD ON THIS PAGE IS AN OUTLINE WITH NO FILL, the surface the leaderboard race and the
// standings chart already use (SectionCard's `bare`). `background.paper` is a lifted grey in dark
// mode, and a page of them reads as a stack of panels rather than one document; with the fill off,
// the stronger CARD_BORDER is what draws each card. The champion banner is the one exception: it
// is the headline, and its tint is the point of it.

function StatTile({ value, label, sub, highlight }: { value: string; label: string; sub?: string; highlight?: boolean }) {
  return (
    <Box sx={{
      borderRadius: 2, p: { xs: 1.5, sm: 2 },
      border: '1px solid', borderColor: highlight ? 'var(--wpbl-accent-solid)' : CARD_BORDER,
      display: 'flex', flexDirection: 'column', gap: 0.25,
    }}>
      <Typography sx={{
        fontSize: { xs: '1.5rem', sm: '1.75rem' }, fontWeight: 800, lineHeight: 1.05,
        color: highlight ? 'var(--wpbl-accent-fg)' : 'text.primary',
      }}>{value}</Typography>
      <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, color: 'text.primary' }}>{label}</Typography>
      {sub && <Typography sx={{ fontSize: '0.74rem', color: 'text.secondary', lineHeight: 1.3 }}>{sub}</Typography>}
    </Box>
  )
}


export default function WpblSeasonPage({ onNavigate, onOpenGame }: {
  onNavigate: (to: string) => void
  // Opens a game as a modal hovering over this page, rather than navigating to it (which would
  // replace the page with WpblApp's Home). Supplied by the shell, which owns the overlay; see
  // GameOverlayHost. The links stay real <a href>s for crawlers, with the plain click intercepted.
  onOpenGame: (g: WpblGame, ctx: { teams: WpblTeam[]; games: WpblGame[] }) => void
}) {
  const [players, setPlayers] = useState<WpblPlayer[]>([])
  const [teams, setTeams] = useState<WpblTeam[]>([])
  const [games, setGames] = useState<WpblGame[]>([])
  const [batting, setBatting] = useState<WpblBattingLine[]>([])
  const [pitching, setPitching] = useState<WpblPitchingLine[]>([])
  const [plays, setPlays] = useState<WpblRunValuePlay[]>([])
  const [battedBalls, setBattedBalls] = useState<WpblSprayPlay[]>([])
  // The league channel's highlight reels, which moved here off the league page's media shelf.
  const [videos, setVideos] = useState<WpblVideo[]>(() => getCachedWpblVideos() ?? [])
  const [hand, setHand] = useState<'R' | 'L'>('R')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    // The four reads the leaders and fun facts need. All cached app-wide by the api layer, so on
    // a reader who has already been to Home or Stats this resolves from memory. Gated together
    // because the page has nothing to show without the lines and the schedule.
    Promise.all([
      fetchWpblAllPlayers(), fetchWpblTeams(), fetchWpblSchedule(), fetchWpblAllLines(),
    ]).then(([p, t, g, lines]) => {
      if (cancelled) return
      setPlayers(p); setTeams(t); setGames(g)
      setBatting(lines.batting); setPitching(lines.pitching)
    }).catch(() => { /* the empty state below is the whole error path */ })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  // The play log is the biggest read on the page and only the biggest-plays and improbable-win
  // blocks want it, so it is separate and never gates the leaders above it. A slow or failed
  // play read leaves those two blocks out and the rest of the page whole.
  useEffect(() => {
    let cancelled = false
    fetchWpblAllRunValuePlays().then(p => { if (!cancelled) setPlays(p) }).catch(() => { /* blocks omit themselves */ })
    return () => { cancelled = true }
  }, [])

  // The spray chart's own read: every batted ball the narrative could place. Its own effect, and
  // allowed to never arrive, for the same reason the play log is: the leaders and fun facts above
  // it do not wait on it and the section simply omits the chart until it lands.
  useEffect(() => {
    let cancelled = false
    fetchWpblBattedBalls().then(b => { if (!cancelled) setBattedBalls(b) }).catch(() => { /* section omits itself */ })
    fetchWpblVideos().then(v => { if (!cancelled) setVideos(v) }).catch(() => { /* section omits itself */ })
    return () => { cancelled = true }
  }, [])

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
  const leaguePit = useMemo(() => sumPitching(pitching, games), [pitching, games])

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

  // Biggest plays and the most improbable win, both a walk of the same per-game win-probability
  // model. Built only once the plays are in; empty until then.
  const { bigPlays, comeback } = useMemo(() => {
    if (plays.length === 0 || regFinals.length === 0) return { bigPlays: [] as BigPlay[], comeback: null as Comeback | null }
    const model = winProbModel(plays, games)
    const byGame = new Map<string, WpblRunValuePlay[]>()
    for (const p of plays) {
      const arr = byGame.get(p.game_id) ?? []
      arr.push(p); byGame.set(p.game_id, arr)
    }
    const big: BigPlay[] = []
    let best: Comeback | null = null
    for (const g of regFinals) {
      const gp = byGame.get(g.id)
      if (!gp || gp.length === 0) continue
      if (g.home_score == null || g.away_score == null || g.home_score === g.away_score) continue
      const homeWon = g.home_score > g.away_score
      const wp = gameWinProb(model, gp, g)

      // One play per game, the one it turned on. swingOfGame prefers the decisive play (largest
      // swing toward the winner) over the merely most volatile one, which is the same choice
      // Game Center's badge makes; ranking one per game keeps a single blowout from filling the
      // whole list with its own at-bats.
      const swing = swingOfGame(wp, g.status)
      if (swing) {
        big.push({
          game: g,
          narrative: swing.point.play.narrative ?? 'Big play',
          winnerBefore: winnerProb(swing.point.before, homeWon),
          winnerAfter: winnerProb(swing.point.after, homeWon),
          teamId: swing.point.play.team_id ?? null,
        })
      }

      // The lowest the eventual winner ever sat. A wire-to-wire winner never drops far below
      // 0.5; a comeback does, and the deepest one across the season is the most improbable win.
      let low = 1
      for (const pt of wp.points) low = Math.min(low, winnerProb(pt.before, homeWon))
      if (low < 0.5 && (!best || low < best.low)) {
        best = { game: g, low, winnerId: homeWon ? g.home_team_id : g.away_team_id }
      }
    }
    // Sort the plays by how far they moved the winner, and keep a handful.
    big.sort((a, b) => (b.winnerAfter - b.winnerBefore) - (a.winnerAfter - a.winnerBefore))
    return { bigPlays: big.slice(0, 6), comeback: best }
  }, [plays, games, regFinals])

  if (loading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>
  }

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
  const gameHref = (g: WpblGame) => wpblGamePath(g, teams, games)
  const playerHref = (p: WpblPlayer) => wpblPlayerPath(p, players)
  const teamHref = (t: WpblTeam) => wpblTeamPath(t, teams)

  return (
    <WpblPage
      title="The 2026 season"
      standfirst={<>
        The Women&rsquo;s Pro Baseball League&rsquo;s first season, read back through its own
        numbers: the final table and the race to it, the leaders, the things that
        make it its own league, and the plays its games turned on.{gameCount > 0 && ` Regular season, ${gameCount} games.`}
      </>}
    >
      {!hasData && (
        <Typography sx={{ color: 'text.secondary' }}>
          The season fills in here once the league feed has been ingested.
        </Typography>
      )}

      {/* Flat cards in dark mode, the same surface Home uses: every card here is already an outline
          with no fill (see the note above StatTile), and this is what gives those outlines the
          flat surface's stronger weight. */}
      {hasData && (
        <Box sx={FLAT_CARDS_DARK}>
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
                  href={gameHref} onOpen={g => onOpenGame(g, { teams, games })} />
              )}
            </Box>
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
              <SectionHeading>Playoff bracket</SectionHeading>
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
                  stat={stat} href={href} onOpen={() => onNavigate(href)} />
              )
            }
            return (
              <>
                <SectionHeading>Best playoff performances</SectionHeading>
                {/* minmax(0, ...) because a bare `1fr` track cannot shrink below its content's
                    min-content width, and a single-game line ("5-5, 1 HR, 4 RBI") is nowrap: on a
                    phone both boards ran off the right edge of the page instead of the name giving. */}
                <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))' } }}>
                  {playoffBest.bats.length > 0 && (
                    <LeaderBoard title="Hitting">
                      {playoffBest.bats.map((b, i) => row(b.id, i + 1, b.player_id, b.team_id, b.game_id, battingStatline(b)))}
                    </LeaderBoard>
                  )}
                  {playoffBest.arms.length > 0 && (
                    <LeaderBoard title="Pitching">
                      {playoffBest.arms.map((p, i) => row(p.id, i + 1, p.player_id, p.team_id, p.game_id, pitchingStatline(p)))}
                    </LeaderBoard>
                  )}
                </Box>
              </>
            )
          })()}

          {/* ── Highlights ───────────────────────────────────────────────────────
              The league channel's game recaps, here rather than on the league page since a reader
              looking back at the season is on this one. Each game page carries its own reel too. */}
          {videos.length > 0 && (
            <>
              <SectionHeading>Highlights</SectionHeading>
              <HighlightsStrip videos={videos} teams={teams} from="recap" />
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
              <SectionHeading>Final standings</SectionHeading>
              <FinalStandings rows={standingRows} orderIds={stOrderIds} cadence={preview.cadenceMs} teamHref={teamHref} onNavigate={onNavigate} />
              <Box sx={{ mt: 1.5 }}>
                <SeasonShapeCard shape={shape} onPreview={onPreview} />
              </Box>
            </>
          )}

          {/* The standings race above is the clubs; this is the players. Same idea one level down. */}
          {shape.games > 0 && (
            <>
              <SectionHeading>Leaderboard race</SectionHeading>
              <LeaderboardRace players={players} teams={teams} games={games} batting={batting} plays={plays} />
            </>
          )}

          {/* ── Notable numbers ──────────────────────────────────────────────── */}
          <SectionHeading>Notable numbers</SectionHeading>
          <Box sx={{
            display: 'grid', gap: 1,
            gridTemplateColumns: { xs: '1fr 1fr', sm: '1fr 1fr 1fr', md: 'repeat(4, 1fr)' },
          }}>
            <StatTile value={runsPerGame.toFixed(1)} label="Runs per game" sub="both clubs combined" />
            <StatTile value={fmtRate(leagueBat.avg)} label="League average" sub={`${fmtRate(leagueBat.obp)} on-base`} />
            <StatTile
              value={`${leagueBat.bb}–${leagueBat.so}`}
              label="Walks vs strikeouts"
              sub={leagueBat.bb === leagueBat.so
                ? 'dead even'
                : `${Math.abs(leagueBat.bb - leagueBat.so)} more ${leagueBat.bb > leagueBat.so ? 'walks' : 'strikeouts'}`}
            />
            <StatTile value={String(leagueBat.hr)} label="Home runs" sub={`${leagueBat.doubles} doubles`} />
            {leagueBat.triples === 0
              ? <StatTile value="0" label="Triples" sub="none, all season" highlight />
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
              sub="batting last, one venue"
            />
          </Box>

          {/* ── Spray chart ──────────────────────────────────────────────────── */}
          {battedBalls.length > 0 && (
            <>
              <SectionHeading>Where the ball goes</SectionHeading>
              <Typography sx={{ color: 'text.secondary', fontSize: '0.85rem', mt: -0.75, mb: 1.5 }}>
                Every batted ball the league placed, by the hitter&rsquo;s side of the plate.
                Right-handers pull to left field; the left-handed view is the mirror of it.
              </Typography>
              {/* Right and left, not a single mixed chart: pull, centre and oppo are defined by
                  which box the batter stood in, so a league-wide chart is only readable one side
                  at a time. The toggle is the whole point of the visual. */}
              <Box sx={{ display: 'flex', gap: 0.5, mb: 1.5 }}>
                {(['R', 'L'] as const).map(h => (
                  <Box key={h} {...pressable(() => setHand(h))} sx={{
                    ...FOCUS_RING,
                    px: 1.5, py: 0.5, borderRadius: 999, cursor: 'pointer', userSelect: 'none',
                    border: '1px solid', borderColor: hand === h ? 'transparent' : 'divider',
                    bgcolor: hand === h ? 'text.primary' : 'transparent',
                  }}>
                    <Typography sx={{
                      fontSize: '0.8rem', fontWeight: 800,
                      color: hand === h ? 'background.paper' : 'text.secondary',
                    }}>{h === 'R' ? 'Right-handed' : 'Left-handed'}</Typography>
                  </Box>
                ))}
              </Box>
              {battedByHand.length > 0 ? (
                <SprayChart plays={battedByHand} bats={hand} />
              ) : (
                <Typography sx={{ color: 'text.disabled', fontSize: '0.85rem' }}>
                  No batted balls placed for this side yet.
                </Typography>
              )}
            </>
          )}

          {/* ── Runs by inning ───────────────────────────────────────────────── */}
          {inningsReady && (
            <>
              <SectionHeading>Runs by inning</SectionHeading>
              <RunsByInning games={games} teams={teams} />
            </>
          )}

          {/* ── Leaders ──────────────────────────────────────────────────────── */}
          <SectionHeading>Batting leaders</SectionHeading>
          <LeaderGrid>
            {BAT_BOARDS.map(board => {
              const rows = rankBatting(batSeasons, board, qual.minPa, qual.active)
              if (rows.length === 0) return null
              return (
                <LeaderBoard key={board.label} title={board.label}>
                  {rows.map((s, i) => (
                    <LeaderRow
                      key={s.player.id}
                      rank={i + 1}
                      name={s.player.name}
                      teamId={s.player.team_id}
                      value={board.fmt(board.get(s.totals)!)}
                      href={playerHref(s.player)}
                      onNavigate={onNavigate}
                    />
                  ))}
                </LeaderBoard>
              )
            })}
          </LeaderGrid>

          <SectionHeading>Pitching leaders</SectionHeading>
          <LeaderGrid>
            {PIT_BOARDS.map(board => {
              const rows = rankPitching(pitSeasons, board, qual.minOuts, qual.active)
              if (rows.length === 0) return null
              return (
                <LeaderBoard key={board.label} title={board.label}>
                  {rows.map((s, i) => (
                    <LeaderRow
                      key={s.player.id}
                      rank={i + 1}
                      name={s.player.name}
                      teamId={s.player.team_id}
                      value={board.fmt(board.get(s.totals)!)}
                      href={playerHref(s.player)}
                      onNavigate={onNavigate}
                    />
                  ))}
                </LeaderBoard>
              )
            })}
          </LeaderGrid>

          {/* ── The most improbable win ──────────────────────────────────────── */}
          {comeback && (
            <>
              <SectionHeading>The most improbable win</SectionHeading>
              <Box
                component="a"
                href={gameHref(comeback.game)}
                onClick={e => { if (!isModified(e)) { e.preventDefault(); onOpenGame(comeback.game, { teams, games }) } }}
                sx={{
                  display: 'block', textDecoration: 'none', color: 'inherit',
                  borderRadius: 2, p: 2, border: '1px solid', borderColor: 'var(--wpbl-accent-solid)',
                  ...TAPPABLE,
                }}
              >
                <Typography sx={{ fontSize: '1.05rem', fontWeight: 800, mb: 0.5 }}>
                  {teamName(comeback.winnerId)} won from {fmtWinPct(comeback.low)}
                </Typography>
                <Typography sx={{ fontSize: '0.85rem', color: 'text.secondary' }}>
                  At its lowest point {teamName(comeback.winnerId)} had a {fmtWinPct(comeback.low)} chance
                  of winning, and won anyway: {teamName(comeback.game.away_team_id)}{' '}
                  {comeback.game.away_score} at {teamName(comeback.game.home_team_id)}{' '}
                  {comeback.game.home_score}, {comeback.game.game_date}.
                </Typography>
              </Box>
            </>
          )}

          {/* ── Biggest plays ────────────────────────────────────────────────── */}
          {bigPlays.length > 0 && (
            <>
              <SectionHeading>The plays that turned a game</SectionHeading>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {bigPlays.map(bp => (
                  <Box
                    key={bp.game.id}
                    component="a"
                    href={gameHref(bp.game)}
                    onClick={e => { if (!isModified(e)) { e.preventDefault(); onOpenGame(bp.game, { teams, games }) } }}
                    sx={{
                      display: 'flex', alignItems: 'center', gap: 1.5, textDecoration: 'none',
                      color: 'inherit', borderRadius: 2, p: 1.5,
                      border: '1px solid', borderColor: CARD_BORDER,
                      ...TAPPABLE,
                    }}
                  >
                    <Box sx={{ flexShrink: 0, width: 4, alignSelf: 'stretch', borderRadius: 2, bgcolor: wpblColor(bp.teamId) }} />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={{ fontSize: '0.9rem', fontWeight: 600, lineHeight: 1.35 }}>
                        {bp.narrative}
                      </Typography>
                      <Typography sx={{ fontSize: '0.76rem', color: 'text.disabled', lineHeight: 1.35 }}>
                        {teamName(bp.game.away_team_id)} at {teamName(bp.game.home_team_id)} · {bp.game.game_date}
                      </Typography>
                    </Box>
                    <Typography sx={{ flexShrink: 0, fontSize: '0.82rem', fontWeight: 800, color: 'var(--wpbl-accent-fg)' }}>
                      {fmtWinPct(bp.winnerBefore)} → {fmtWinPct(bp.winnerAfter)}
                    </Typography>
                  </Box>
                ))}
              </Box>
            </>
          )}
        </Box>
      )}
    </WpblPage>
  )
}

// ─── Champion ────────────────────────────────────────────────────────────────────
// The inaugural title, at the top of the recap. A gold hero rather than a stat line: the champion
// is the one thing on this page that a stat cannot carry, and the block the reader who came for
// "who won" is looking for. Full width, its own colour, and no link, because it is the answer
// rather than a route to one; the games that decided it are the cards directly under it.
function SeasonChampionBlock({ champ }: { champ: ChampionResult }) {
  const isDark = useWpblDark()
  const accent = wpblAccent(champ.champion.id, isDark)
  return (
    <Box sx={{
      borderRadius: 3, overflow: 'hidden',
      border: '1.5px solid', borderColor: 'var(--wpbl-medal-1)',
      backgroundImage: `linear-gradient(120deg, color-mix(in srgb, var(--wpbl-medal-1) 14%, transparent), color-mix(in srgb, ${accent} 12%, transparent))`,
      bgcolor: 'background.paper',
    }}>
      <Box sx={{
        display: 'flex', alignItems: 'center', gap: 0.75, px: 2, py: 0.85,
        bgcolor: 'color-mix(in srgb, var(--wpbl-medal-1) 16%, transparent)',
        borderBottom: '1px solid', borderColor: 'divider',
      }}>
        <Box aria-hidden sx={{ fontSize: '0.9rem', lineHeight: 1 }}>🏆</Box>
        <Typography sx={{
          fontSize: '0.7rem', fontWeight: 900, letterSpacing: 1, textTransform: 'uppercase',
          color: 'var(--wpbl-medal-1)',
        }}>WPBL Champions</Typography>
      </Box>
      <Box sx={{ p: { xs: 2, sm: 2.5 }, display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
        <TeamBadge team={champ.champion} size={56} />
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: '1.5rem', fontWeight: 900, lineHeight: 1.1, color: accent }}>
            {wpblFullName(champ.champion)}
          </Typography>
          <Typography sx={{ fontSize: '0.95rem', fontWeight: 700, color: 'text.primary', mt: 0.4 }}>
            Inaugural WPBL champions
          </Typography>
          {champ.runnerUp && (
            <Typography sx={{ fontSize: '0.85rem', fontWeight: 500, color: 'text.secondary', mt: 0.25 }}>
              Beat {wpblFullName(champ.runnerUp)} {champ.champWins}-{champ.rivalWins} in the championship series.
            </Typography>
          )}
        </Box>
      </Box>
    </Box>
  )
}

/** "Sep 16" off a plain `game_date`. Parsed by hand rather than through Date, which reads a bare
 *  date as UTC midnight and names the day before anywhere west of Greenwich (see wpblCardDate). */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const shortDate = (date: string) => {
  const m = /^\d{4}-(\d{2})-(\d{2})/.exec(date)
  return m ? `${MONTHS[Number(m[1]) - 1] ?? ''} ${Number(m[2])}` : ''
}

// The final, one small card per game, under the banner that names who won it. The banner is the
// result and these are the route into how: each opens that game's full page. Real <a href>s with
// the plain click intercepted, like every game link on this page, so crawlers can follow them.
// A grid that wraps rather than a scrolling rail: five games fit one row on a desktop and wrap to
// two columns on a phone, and none of the five is hidden off the edge.
function FinalSeriesGames({ games, teamById, href, onOpen }: {
  games: WpblGame[]
  teamById: Map<string, WpblTeam>
  href: (g: WpblGame) => string
  onOpen: (g: WpblGame) => void
}) {
  return (
    <Box sx={{ display: 'grid', gap: 1, mt: 1.25, gridTemplateColumns: 'repeat(auto-fit, minmax(7.5rem, 1fr))' }}>
      {games.map((g, i) => {
        const away = teamById.get(g.away_team_id), home = teamById.get(g.home_team_id)
        const awayWon = g.away_score! > g.home_score!
        const side = (team: WpblTeam | undefined, score: number | null, won: boolean) => (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
            {team && <TeamBadge team={team} size={18} />}
            <Typography sx={{
              flex: 1, minWidth: 0, fontSize: '0.85rem', fontWeight: won ? 800 : 600,
              color: won ? 'text.primary' : 'text.secondary',
            }}>{team?.abbr ?? '—'}</Typography>
            <Typography sx={{
              fontSize: '0.95rem', fontWeight: won ? 900 : 600, fontVariantNumeric: 'tabular-nums',
              color: won ? 'text.primary' : 'text.secondary',
            }}>{score}</Typography>
          </Box>
        )
        return (
          <Box
            key={g.id}
            component="a"
            href={href(g)}
            aria-label={`Game ${i + 1}: ${away?.city ?? ''} ${g.away_score}, ${home?.city ?? ''} ${g.home_score}`}
            onClick={e => { if (!isModified(e)) { e.preventDefault(); onOpen(g) } }}
            sx={{
              display: 'flex', flexDirection: 'column', gap: 0.5, minWidth: 0,
              textDecoration: 'none', color: 'inherit', borderRadius: 2, px: 1.25, py: 1,
              border: '1px solid', borderColor: CARD_BORDER,
              ...TAPPABLE, ...FOCUS_RING,
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5 }}>
              <Typography sx={{
                flex: 1, fontSize: '0.66rem', fontWeight: 800, letterSpacing: 0.6,
                textTransform: 'uppercase', color: 'text.disabled',
              }}>Game {i + 1}</Typography>
              <Typography sx={{ fontSize: '0.66rem', fontWeight: 700, color: 'text.disabled' }}>{shortDate(g.game_date)}</Typography>
            </Box>
            {side(away, g.away_score, awayWon)}
            {side(home, g.home_score, !awayWon)}
          </Box>
        )
      })}
    </Box>
  )
}

// ─── Final standings ───────────────────────────────────────────────────────────────
// The season's last frame, or whichever day the chart below is scrubbed to. Compact on
// purpose: the full Standings tab carries L10, streak and the form strip, and this is the
// record read rather than the live table. Rank 1 is tinted, so a reader who scrubs back watches
// the accent travel to whoever led on that date.

// rank | club | W | L | PCT | (GB) | DIFF. The numeric columns are in rem so they hold their
// width against the reader's text size, which is the box-reserving-type rule from CLAUDE.md.
// GB is dropped on a phone: at 375px the fixed columns crowd the club name down to an initial,
// and PCT plus the record already say where each club sits, so GB is the one to lose. Its cell
// is display:none on xs and the xs template has one fewer track, so the grid stays aligned.
const ST_COLS = '1.25rem minmax(0, 1fr) 1.75rem 1.75rem 2.75rem 2.25rem 2.75rem'
const ST_COLS_XS = '1.1rem minmax(0, 1fr) 1.5rem 1.5rem 2.6rem 2.7rem'

const fmtGb = (gb: number) => (gb === 0 ? '—' : Number.isInteger(gb) ? String(gb) : gb.toFixed(1))
const fmtDiff = (d: number) => (d > 0 ? `+${d}` : String(d))

function FinalStandings({ rows, orderIds, cadence, teamHref, onNavigate }: {
  rows: WpblStandingRow[]
  /** The SETTLED order the flip is keyed on, so a scrub that only moves the figures does not
   *  re-measure. Its identity is stable until a club actually changes places. */
  orderIds: string[]
  /** When playback is driving, how long until the next day lands; the row travel is fit inside it. */
  cadence: number | undefined
  teamHref: (t: WpblTeam) => string; onNavigate: (to: string) => void
}) {
  // Four clubs changing places IS the reading of a scrub, so the rows slide past each other rather
  // than snapping to the new order, the same as the Standings tab. The DOM still reorders (React
  // keys the rows by club), which keeps a screen reader's order honest; the flip only puts the
  // movement back. See rowFlip.ts, and StandingsView for the surface this mirrors.
  const rowRef = useRowFlip(orderIds, cadence)
  // The lines between the clubs, lifted off the rows and drawn as their own layer over them: a
  // border on a row travels with the club standing in it and is painted under the opaque backing a
  // moving row needs, so a reorder would take every divider with it. The rows keep a transparent
  // border for its GEOMETRY and the lines are drawn at the fixed slots. See `useRowDividers`.
  const dividers = useRowDividers(rows.length, '[data-standings-row]')
  return (
    // `position: relative` is load-bearing twice: the divider overlay is placed against it, and it
    // is what each row's `offsetTop` resolves to. See `useRowDividers`.
    <Box sx={{ position: 'relative', borderRadius: 2, border: '1px solid', borderColor: CARD_BORDER, overflow: 'hidden' }} ref={dividers.ref}>
      {/* Column labels. Same grid as the rows, so the numbers sit under their headings. */}
      <Box sx={{
        display: 'grid', gridTemplateColumns: { xs: ST_COLS_XS, sm: ST_COLS }, alignItems: 'center', gap: 1,
        px: 1.25, py: 0.75, borderBottom: '1px solid', borderColor: 'divider',
        fontSize: '0.68rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em',
        color: 'text.secondary',
      }}>
        <Box />
        <Box>Club</Box>
        <Box sx={{ textAlign: 'right' }}>W</Box>
        <Box sx={{ textAlign: 'right' }}>L</Box>
        <Box sx={{ textAlign: 'right' }}>PCT</Box>
        <Box sx={{ textAlign: 'right', display: { xs: 'none', sm: 'block' } }}>GB</Box>
        <Box sx={{ textAlign: 'right' }}>DIFF</Box>
      </Box>
      {rows.map((r, i) => {
        const leader = i === 0
        const diff = r.runsFor - r.runsAgainst
        return (
          <Box
            key={r.team.id}
            component="a"
            data-standings-row=""
            ref={rowRef(r.team.id)}
            href={teamHref(r.team)}
            onClick={e => { if (!isModified(e)) { e.preventDefault(); onNavigate(teamHref(r.team)) } }}
            sx={{
              ...FOCUS_RING,
              display: 'grid', gridTemplateColumns: { xs: ST_COLS_XS, sm: ST_COLS }, alignItems: 'center', gap: 1,
              px: 1.25, py: 0.85, textDecoration: 'none', color: 'inherit',
              // Border here for its HEIGHT, drawn by the overlay below. Transparent rather than
              // removed, so the slot keeps the pixel it has always been spaced by and nothing
              // reflows when a club moves. The first row's line is the header's borderBottom.
              borderTop: i === 0 ? 'none' : '1px solid', borderColor: 'transparent',
              bgcolor: leader ? 'var(--wpbl-compare-lead)' : 'transparent',
              fontVariantNumeric: 'tabular-nums',
              // ONLY WHILE MOVING. A row has no background of its own, so two clubs crossing print
              // through each other; this gives the moving pair an opaque page-coloured backing and
              // a stacking order for exactly as long as the move lasts. `background.default`, the
              // PAGE's colour, because the card has no fill of its own: `background.paper` here
              // would flash a lighter band across the table on every move. The leader keeps its
              // tint, composited over the opaque backing. See rowFlip.ts.
              '&[data-moving]': {
                position: 'relative', bgcolor: 'background.default',
                ...(leader ? { backgroundImage: 'linear-gradient(var(--wpbl-compare-lead), var(--wpbl-compare-lead))' } : {}),
              },
              '&[data-moving="up"]': { zIndex: 2 },
              '&[data-moving="down"]': { zIndex: 1 },
              ...TAPPABLE,
            }}
          >
            <Typography sx={{ fontSize: '0.82rem', fontWeight: 800, color: leader ? 'var(--wpbl-accent-fg)' : 'text.disabled' }}>
              {i + 1}
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.9, minWidth: 0 }}>
              {/* The club logo, matching the Standings tab. */}
              <TeamBadge team={r.team} size={22} />
              {/* Full name where it fits, the nickname on a phone: once the fixed numeric columns
                  claim their widths the full name truncates, and the badge already carries the city. */}
              <Typography sx={{ fontSize: '0.9rem', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: { xs: 'none', sm: 'block' } }}>
                {wpblFullName(r.team)}
              </Typography>
              <Typography sx={{ fontSize: '0.9rem', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: { xs: 'block', sm: 'none' } }}>
                {r.team.name}
              </Typography>
            </Box>
            <Typography sx={{ textAlign: 'right', fontSize: '0.9rem', fontWeight: 700 }}>{r.wins}</Typography>
            <Typography sx={{ textAlign: 'right', fontSize: '0.9rem', fontWeight: 700 }}>{r.losses}</Typography>
            <Typography sx={{ textAlign: 'right', fontSize: '0.9rem', fontWeight: 800 }}>{fmtRate(r.pct)}</Typography>
            <Typography sx={{ textAlign: 'right', fontSize: '0.88rem', color: 'text.secondary', display: { xs: 'none', sm: 'block' } }}>{fmtGb(r.gamesBack)}</Typography>
            <Typography sx={{
              textAlign: 'right', fontSize: '0.88rem', fontWeight: 700,
              color: diff > 0 ? 'var(--wpbl-pos)' : diff < 0 ? 'var(--wpbl-neg)' : 'text.secondary',
            }}>{fmtDiff(diff)}</Typography>
          </Box>
        )
      })}
      {/* THE DIVIDERS, over the rows rather than on them, so a crossing club passes UNDER the line
          instead of dragging it along. Skip the first slot: the line above row 0 is the header's
          own borderBottom, and drawing one here too would double it. `zIndex` clears the 2 a row
          moving up takes. See `useRowDividers`. */}
      {dividers.tops.map((top, i) => (i === 0 ? null : (
        <Box key={i} aria-hidden sx={{
          position: 'absolute', left: 0, right: 0, top: `${top}px`,
          // Ornament: a hairline reserving room for nothing, so raw px is the unit and it stays one
          // line on every device. See CLAUDE.md.
          height: '1px', bgcolor: 'divider', pointerEvents: 'none', zIndex: 3,
        }} />
      )))}
    </Box>
  )
}

// ─── Leader board pieces ──────────────────────────────────────────────────────────

function LeaderGrid({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{
      display: 'grid', gap: 1.5,
      gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr' },
    }}>
      {children}
    </Box>
  )
}

function LeaderBoard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box sx={{ minWidth: 0, borderRadius: 2, p: 1.5, border: '1px solid', borderColor: CARD_BORDER }}>
      <Typography component="h3" sx={{ fontSize: '0.78rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'text.secondary', mb: 1 }}>
        {title}
      </Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
        {children}
      </Box>
    </Box>
  )
}

function LeaderRow({ rank, name, teamId, value, href, onNavigate }: {
  rank: number; name: string; teamId: string | null; value: string; href: string; onNavigate: (to: string) => void
}) {
  return (
    <Box
      component="a"
      href={href}
      onClick={e => { if (!isModified(e)) { e.preventDefault(); onNavigate(href) } }}
      sx={{
        ...FOCUS_RING,
        display: 'flex', alignItems: 'center', gap: 1, textDecoration: 'none', color: 'inherit',
        borderRadius: 1.5, px: 0.75, py: 0.5, ...TAPPABLE,
      }}
    >
      <Typography sx={{ flexShrink: 0, width: '1rem', fontSize: '0.8rem', fontWeight: 700, color: 'text.disabled' }}>
        {rank}
      </Typography>
      {/* The player's face, not a bare team-colour dot: the portrait keeps the club signal (it
          falls back to initials on the team colour with a team-secondary ring) while turning an
          anonymous leaderboard into a row of people, which is what a season recap is about. */}
      <PlayerPortrait name={name} teamId={teamId} size={28} />
      <Typography sx={{ flex: 1, minWidth: 0, fontSize: '0.88rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {name}
      </Typography>
      <Typography sx={{ flexShrink: 0, fontSize: '0.88rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </Typography>
    </Box>
  )
}

/** One single-game line on the playoff boards: the leader row's shape with a second line saying
 *  which game, and the whole row a link to that game rather than to the player, because the game
 *  is what it is ranking. */
function PerformanceRow({ rank, name, teamId, context, stat, href, onOpen }: {
  rank: number; name: string; teamId: string | null; context: string; stat: string
  href: string; onOpen: () => void
}) {
  // "A. Lansdell" on a phone, the section's answer everywhere a name shares a row with a stat.
  const shortName = useWpblName()
  return (
    <Box
      component="a"
      href={href}
      onClick={e => { if (!isModified(e)) { e.preventDefault(); onOpen() } }}
      sx={{
        ...FOCUS_RING,
        display: 'flex', alignItems: 'center', gap: 1, textDecoration: 'none', color: 'inherit',
        borderRadius: 1.5, px: 0.75, py: 0.5, ...TAPPABLE,
      }}
    >
      <Typography sx={{ flexShrink: 0, width: '1rem', fontSize: '0.8rem', fontWeight: 700, color: 'text.disabled' }}>
        {rank}
      </Typography>
      <PlayerPortrait name={name} teamId={teamId} size={28} />
      {/* THE STAT RIDES THE NAME'S LINE, NOT A COLUMN OF ITS OWN. As a third column beside both
          lines it held its full width through the second line too, so on a phone "Semifinal,
          game 3 vs NY" came out as "Semifinal, game …" under a stat that was only one line tall.
          Here the name gives way to the stat, and the game underneath gets the whole row. */}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, minWidth: 0 }}>
          <Typography sx={{ flex: 1, minWidth: 0, fontSize: '0.88rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {shortName(name)}
          </Typography>
          <Typography sx={{ flexShrink: 0, fontSize: '0.82rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
            {stat}
          </Typography>
        </Box>
        <Typography sx={{ fontSize: '0.72rem', color: 'text.disabled', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {context}
        </Typography>
      </Box>
    </Box>
  )
}
