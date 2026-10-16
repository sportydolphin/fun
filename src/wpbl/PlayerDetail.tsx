import { useDark } from '../ui/useDark'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Box, Typography, Skeleton, useMediaQuery } from '@mui/material'
import { plateAppearances, fmtRate, fmtTwo } from './stats'
import { scopedLines, inSeason, seasonsPlayed, latestSeason, gamesInSeason, type SeasonScope } from './season'
import { COUNT_RANK_MIN_FIELD, type WpblStatRank } from './percentiles'
import { useEraBasis } from './EraBasisContext'
import { wpblAccent, wpblColor, wpblSecondary, wpblFullName, outsToIp } from './constants'
import { ModalShell, AfterShellEnters, PlayerPortrait, CopyLinkButton, SegNav, chromePx, hoverOnly, CARD_BORDER } from './ui'
import { ExpandButton } from '../ui/ExpandButton'
import { DetailPageBar } from './DetailPageBar'
import { WpblVisuallyHiddenH1 } from './PageHeading'
import { PLAYER_PAGE_W } from './layoutWidths'
import { SectionHead, useRankInk } from './cardParts'
import {
  StatCardContext, SeasonPicker, LineCaption, SeasonLine, RateStrip, ValueStrip, CameoBlock, StatLogTable,
  PlayerBand, BandBadge, BandChips, BAND_CHIP_SX, type BandFact, BATTING_BEST, PITCHING_BEST, LOG_PREVIEW, CARD_SECTION_SX, type StatCardEnv,
} from '../ui/playerCard'
import SwipeableViews from './SwipeableViews'
import { WrittenAbout } from './Reading'
import { aboutPlayerFirst } from './derive/articles'
import { FanPhotoPlayerStrip } from './FanPhotoViews'
import { PlayerClips } from './Watch'
import { PitchLocationCard } from './PitchLocation'
import SprayChart from './SprayChart'
import PitchProfileBlock from './PitchProfile'
import { isBattedBall } from './api'
import { displayPosition, positionName } from './positions'
import { wpblPlayerShortPath, WPBL_AWARDS_PATH } from './routes'
import { playerMatchups, playerPlayIds } from './derive/matchups'
import { EmojiEvents } from '@mui/icons-material'
import { useTheme as useMuiTheme } from '@mui/material/styles'
import { linkTo } from '../nav'
import { track, EVENTS } from '../lib/analytics'
import type { WpblTeam, WpblPlayer, WpblGame } from './types'
import { useSectionScroll } from '../lib/sectionScroll'
import { type BoardPlace } from './derive/seasonValue'
import { fmtRunValue } from '../league/runExpectancy'
import {
  statTip, gamePosition, type Role, RankProgress, FieldingLine, MatchupTable, CompareChip,
  BAND_WASH, BAND_WASH_FLOOR, SENTENCE_W, CARD_RANK_BAR,
} from './player/pieces'
import { createBandStore, BandAwareEyebrow, useBandObserver } from './player/bandStore'
import { usePlayerAwards, usePlayerLines, usePlayerMatchupPlays, useLeagueReads } from './player/usePlayerReads'
import { usePlayerSeason } from './player/usePlayerSeason'
import { ICON_SIZE, TYPE_SCALE } from '../ui/card'
import { shortDate } from '../lib/format'


// Player page: profile, season totals aggregated from box-score lines, where those totals sit
// against the league, and a per-game log. Public read; opened from a roster row, a leaderboard,
// the header search, a Home chip, a Discord link or a shared URL.
//
// TABS ON A PHONE. Every stat block stacked down one scroll runs to about twice the sheet's
// height, gives a two-way player two of everything (two headline blocks, two game logs, two sets
// of table chrome for the same games), and draws noise like fielding percentage over nine games
// as tall as a .400 average. So the roles are a segmented control and only the active one is
// mounted, the same shape Game Center uses for its boards. The control appears ONLY when a
// player has more than one real role; most of the roster is a hitter or a pitcher and sees
// their own numbers with no chrome around them.
//
// ONE WIDE COLUMN FROM md UP. A desktop dialog is not short of height, so the tabs come off and
// every role is drawn as full-width blocks (see desktopRoleBlock); the phone layout is untouched.
//
// The card's parts, its reads and its season arithmetic live in ./player/; this file holds its
// state and draws it.

// ─── the modal ───────────────────────────────────────────────────────────────

export default function PlayerDetailModal({ player, openingSeason = null, teams, games, players, onClose, onOpenGame, onOpenBoard, panel = false, onBack, backLabel, layout = 'modal', onExpand }: {
  player: WpblPlayer
  /** The year to open on, typed with the name in the search ("Whitmore 2026"), or 'career'
   *  ("Whitmore career"). A year the player has no line in falls back to their newest, as any
   *  unknown pick does, and so does a career for a player with one season. */
  openingSeason?: number | 'career' | null
  teams: WpblTeam[]
  games: WpblGame[]
  /** The full roster, needed to prove a name slug is unambiguous. Empty only during the first
   *  moment of a cold load, which the share URL falls back around. */
  players: WpblPlayer[]
  onClose: () => void
  /** Open a game from the log. The section's `openGame` closes this player as it goes, so
   *  Back walks off the game and lands on the player's page again, which is the same stack the
   *  reverse trip already builds (a player opened from a game sits on top of it). Optional only so
   *  a log still renders in a harness that has nowhere to send the click. */
  onOpenGame?: (game: WpblGame) => void
  /** Open the Stats table sorted by a stat with this player picked out, from a rank on the card.
   *  Without it the ranks are plain text. */
  onOpenBoard?: (group: 'hitting' | 'pitching', sortKey: string, opts: { qualified: boolean; playerId: string }) => void
  /** Open as the desktop side panel rather than a centred dialog. See ModalShell's `panel`. */
  panel?: boolean
  /** A back control in the panel's header, for a player opened from the Game Center panel. */
  onBack?: () => void
  backLabel?: string
  /** `page` draws the player as a full desktop page instead of a modal: the desktop layout below
   *  (every role in full, no role tabs), under the same bar the full Game Center has. The caller only
   *  asks for it on a desktop. */
  layout?: 'modal' | 'page'
  /** Offer the side panel's "Expand" to the full page. Shown only while this IS the side panel. */
  onExpand?: () => void
}) {
  const isDark = useDark()

  // The fan awards this player won, for the ribbon under their name. See usePlayerAwards.
  const awards = usePlayerAwards(player.id)


  /**
   * Which of the two layouts to BUILD, rather than which to show.
   *
   * A CSS `display` pair is wrong here, because both trees would mount: on a phone a two-way
   * player would build the desktop stack as well, which is two game logs and a pitch-location
   * plot rendered to be hidden. The pager exists precisely so that only the role on screen is
   * mounted (see SwipeableViews), and a hidden second tree hands that back.
   *
   * MUI's `md`, asked of the theme, because this file's other breakpoints are MUI's and these two
   * have to agree: the role pills and the pane's rate strip are still hidden with CSS at `md`, so a
   * disagreement would show a phone control over a desktop layout.
   *
   * NEVER WIDE IN THE SIDE PANEL. The panel renders this card's content under a theme with every
   * breakpoint out of reach, so all of its CSS draws the phone layout there (see ModalShell's
   * PANEL_THEME). This hook runs HERE, though, outside that provider, where the viewport is a
   * desktop's; it has to be told, or it would build the desktop stack into a phone-width column
   * and hide the role pills it needs. ModalShell opens the panel on exactly this same `md` test.
   */
  const mdUp = useMediaQuery(useMuiTheme().breakpoints.up('md'))
  const wide = mdUp && !panel
  // Each phone pane's copy of the band, and which of them are on screen. The header takes the
  // player's name when the ACTIVE pane's band has scrolled out, so a reader deep in a game log
  // still sees whose it is. Measured against each band's own scroller (see the observer below), so
  // "out" means scrolled out of the sheet, not merely off the page or still sliding in.
  const bandEls = useRef<(HTMLDivElement | null)[]>([])
  // A store rather than state: see BandStore.
  const bandStore = useMemo(createBandStore, [])
  const setBandHidden = bandStore.set
  const { basis: eraBasis, fmtEra } = useEraBasis()

  // The SHORT /p/<code> form, for pasting into a DM or a post. functions/p 302s it to the readable
  // /wpbl/players/<slug> the address bar shows, which is what Google indexes and what
  // functions/wpbl/index.ts OG-rewrites, so the unfurl still comes across as the player. It needs
  // only the id (no wait on the roster), and is built from the current origin so a link copied out
  // of a local or preview build resolves against that build.
  const shareUrl = useMemo(
    () => `${window.location.origin}${wpblPlayerShortPath(player)}`,
    [player])
  const gameById = useMemo(() => new Map(games.map(g => [g.id, g])), [games])
  const teamById = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])

  // WHICH YEAR. Everything below the band is one season's: the lines are every game the player has
  // ever played, so each read is cut to the year on screen before anything sums it (see inSeason).
  // The player's newest season until the reader picks another, which a retired player's page needs
  // and a current one never notices. Not in the address: it resets with the player, like the scope.
  const [pickedSeason, setPickedSeason] = useState<number | 'career' | null>(openingSeason)
  // Which slice of the season the whole card shows. Defaults to the regular season, which is
  // what this page has always shown and what the OG cards and the Discord `/player` card still
  // publish; the toggle below only appears for a player who actually has postseason lines. Every
  // total, the game log and the pitch plot read through this; the ranks do not (see `ranks`).
  const [scope, setScope] = useState<SeasonScope>('regular')
  const { loading, allBatting, allPitching, allFielding, pitchLocs } = usePlayerLines(player, () => {
    // The rest of what belongs to the PREVIOUS player. The side panel swaps players on every row
    // clicked down a leaderboard, so a Playoffs scope or a scrolled-away band carried over would
    // show the next player's card already filtered, or with the header naming nobody.
    setScope('regular')
    setPickedSeason(openingSeason)
    bandStore.reset()
  })
  // "Whitmore game log" from the search: the part's heading, once its data has drawn it.
  useSectionScroll()
  const seasons = useMemo(
    () => seasonsPlayed([...allBatting, ...allPitching, ...allFielding], games),
    [allBatting, allPitching, allFielding, games])
  const season: number | null = typeof pickedSeason === 'number' && seasons.includes(pickedSeason)
    ? pickedSeason
    : seasons[0] ?? latestSeason(games)
  // EVERY SEASON SUMMED, offered once there are two. No ranks, no percentiles, no qualifying bar:
  // each of those is a season's league and a season's bar, and a career has neither. `season` stays
  // the newest year underneath, for the few things that want a year even then.
  const career = pickedSeason === 'career' && seasons.length > 1
  // Null only with no schedule and no lines, where there is nothing to cut.
  const thisSeason = <T extends { game_id: string }>(rows: T[]): T[] => (career || season == null ? rows : inSeason(rows, games, season))
  const batting = useMemo(() => thisSeason(allBatting), [allBatting, games, season, career]) // eslint-disable-line react-hooks/exhaustive-deps
  const pitching = useMemo(() => thisSeason(allPitching), [allPitching, games, season, career]) // eslint-disable-line react-hooks/exhaustive-deps
  const fielding = useMemo(() => thisSeason(allFielding), [allFielding, games, season, career]) // eslint-disable-line react-hooks/exhaustive-deps
  // That year's games, for whatever measures a season by its schedule: the qualifying bar under
  // the ranks. The schedule handed to a sum stays whole, since the lines are already cut.
  const seasonGames = useMemo(() => (career || season == null ? games : gamesInSeason(games, season)), [games, season, career])


  // The club that season was played for, off the lines, which carry the club of each game: the band
  // wears it, so a past year reads in that year's colours. The newest season keeps the roster's club,
  // which is "now" and is right for a player traded since their last game. A season with no line
  // naming a club falls back to it too.
  const clubId = useMemo(() => {
    if (career || season == null || season === latestSeason(games)) return player.team_id
    const last = [...batting, ...pitching]
      .filter(l => l.team_id)
      .sort((a, b) => (gameById.get(b.game_id)?.game_date ?? '').localeCompare(gameById.get(a.game_id)?.game_date ?? ''))[0]
    return last?.team_id ?? player.team_id
  }, [season, career, games, batting, pitching, gameById, player.team_id])
  const team = useMemo(() => teams.find(t => t.id === clubId), [teams, clubId])
  const color = team ? wpblAccent(team.id, isDark) : '#888'
  // The RAW club colours, for the header band only. Everywhere else on this page uses
  // `color` above, which is the foreground-safe accent.
  const teamPrimary = wpblColor(clubId)
  const teamSecondary = wpblSecondary(clubId)
  // The wash this club can carry, and its mid-ramp at 60% of it so the gradient keeps its shape
  // whatever the end is. Hex pairs because the colour is a hex string and this is appended to it.
  const wash = BAND_WASH[clubId ?? ''] ?? BAND_WASH_FLOOR
  const washEnd = wash.toString(16).padStart(2, '0')
  const washMid = Math.round(wash * 0.6).toString(16).padStart(2, '0')

  // Season-scoped like every other number on this page. The tracking read asks for every pitch
  // under every feed id the player has held, which is right for finding them and wrong for
  // plotting them: the card sits beside a pitching line that follows the same scope, and its own
  // caption counts `pt.g` games from that same total.
  const seasonPitchLocs = useMemo(() => scopedLines(thisSeason(pitchLocs), games, scope), [pitchLocs, games, season, career, scope]) // eslint-disable-line react-hooks/exhaustive-deps
  const trackedPitchGames = useMemo(() => new Set(seasonPitchLocs.map(r => r.game_id)).size, [seasonPitchLocs])
  const matchupPlays = usePlayerMatchupPlays(player)
  // Follows the scope toggle like every other number on the card.
  const matchups = useMemo(
    () => (matchupPlays ? playerMatchups(new Set(playerPlayIds(player)), thisSeason(matchupPlays), games, scope) : null),
    [matchupPlays, player, games, season, career, scope]) // eslint-disable-line react-hooks/exhaustive-deps
  // Her balls in play, for the spray chart, off the same plays: every one she hit is a plate
  // appearance she took part in. It used to be a read of the whole league's batted balls, which a
  // player page opened cold paid for in full to draw one player's chart.
  //
  // Matched on the id, never the name: the league mints a new player_id per club, so a traded
  // player's rows carry two of them, and `api_ids` is what makes them one person. The batter
  // id on a play is already our own uuid, so this is the resolved one.
  const myBattedBalls = useMemo(
    () => (matchupPlays ? thisSeason(matchupPlays.filter(p => p.batter_id === player.id && isBattedBall(p))) : []),
    [matchupPlays, player.id, games, season, career]) // eslint-disable-line react-hooks/exhaustive-deps
  const { leagueLines, articles } = useLeagueReads()

  // A different player also resets the scroll position (see usePlayerLines for the rest): the next
  // player opens at their name, not
  // halfway down a game log at whatever depth the last one was read to. Every scroller in the
  // shell's body, since on the phone layout each role pane scrolls on its own.
  const contentRef = useRef<HTMLDivElement>(null)
  const scrolledFor = useRef(player.id)
  useEffect(() => {
    if (scrolledFor.current === player.id) return
    scrolledFor.current = player.id
    const body = contentRef.current?.parentElement
    if (!body) return
    for (const el of [body, ...Array.from(body.querySelectorAll<HTMLElement>('*'))]) {
      if (el.scrollTop > 0) el.scrollTop = 0
    }
  }, [player.id])

  const {
    bt, pt, ft, battingLog, pitchingLog, hasPostseason, hasBatting, hasPitching, hasSeasonBatting, hasSeasonPitching,
    hasFielding, fieldedPositions, ranks, valueOn, myValue, ranksPending,
    pitcherFirst, battingCameo, pitchingCameo, twoWay, battingMeta, pitchingMeta,
  } = usePlayerSeason({ player, players, teams, games, seasonGames, season, career, scope, batting, pitching, fielding, leagueLines, eraBasis, thisSeason })
  const ink = useRankInk()
  // What the shared card parts need from this section: its stat definitions as tooltips, its rank
  // blue, and the bar a rank has to clear to be printed (see CARD_RANK_BAR).
  const cardEnv = useMemo<StatCardEnv>(
    () => ({ tip: k => statTip(k, eraBasis), ink, rankBar: CARD_RANK_BAR }),
    [eraBasis, ink])


  // The control only exists for a genuine two-way player. Everyone else gets her own numbers
  // with no chrome: a lone pill that cannot be switched away from is worse than no pill.
  //
  // The reader's pick, or null for the primary role. DERIVED rather than copied into state by an
  // effect, because an effect runs a commit late: the render where the lines land and make a
  // pitcher's card lead with pitching would still hold the old 'batting', and the pager would draw
  // the second pane for a frame before swinging back.
  const [pickedRole, setRole] = useState<Role | null>(null)
  const role: Role = pickedRole ?? (pitcherFirst ? 'pitching' : 'batting')
  useEffect(() => { setRole(null) }, [pitcherFirst])
  const selectRole = (v: string, via: 'pill' | 'swipe') => {
    const next = v as Role
    if (next === role) return
    // Whether anyone ever looks at the second role is the question this restructure raises,
    // and the tab is the only place it can be answered. Same argument as `wpbl_game_tab`.
    // `via` splits taps from swipes, which is the only way to know whether the gesture is
    // worth what it costs the layout: the band above had to become pinned chrome to give the
    // pager a definite height to live in.
    track(EVENTS.WPBL_PLAYER_ROLE, { role: next, from: role, via, playerId: player.id })
    setRole(next)
  }

  // Opponent label for a game the player appeared in.
  //
  // `lineTeam` is the club the player played THAT game for, off the box-score line, not the one
  // on their roster row. A traded player's old games are still in the log, and reading the
  // current club would ask "was Los Angeles at home?" of a New York game played in July: neither
  // side matches, so the label would fall through to naming the player's own team and the row
  // would read "@ NY" for a game played for New York. The line always knows; the roster row only
  // knows now.
  const oppLabel = (gameId: string, lineTeam: string | null): { date: string; text: string } => {
    const g = gameById.get(gameId)
    if (!g) return { date: '', text: '' }
    const forTeam = lineTeam ?? player.team_id
    const isHome = g.home_team_id === forTeam
    const oppId = isHome ? g.away_team_id : g.home_team_id
    const opp = teamById.get(oppId)
    const date = shortDate(g.game_date)
    const abbr = opp?.abbr ?? oppId
    return { date, text: `${isHome ? 'vs' : '@'} ${abbr}` }
  }

  // The lead columns of one game-log row, plus what tapping it does. Every log builds its
  // stat cells itself and takes the rest from here, so the two of them cannot drift on which
  // club a traded player's row is read against (see oppLabel) or on where the row goes.
  const logRow = (gameId: string, lineTeam: string | null) => {
    const g = gameById.get(gameId)
    const o = oppLabel(gameId, lineTeam)
    // No handler for a game the schedule does not hold, rather than a dead row that looks
    // pressable: the log is built from box-score lines and the schedule is fetched separately,
    // so a line can arrive for a game this render has not seen.
    return { lead: [o.date, o.text], onOpen: g && onOpenGame ? () => onOpenGame(g) : undefined }
  }

  // Box-score lines come back in whatever order the API returns them, which is not
  // chronological, so a game log rendered straight off them reads as shuffled. Sort on the
  // game's real ISO date, not the "Aug 13" label the row displays, which would sort
  // alphabetically and put August after April. Sort is stable, so two games sharing a date
  // (a doubleheader) keep their relative order.
  //
  // NEWEST FIRST. Oldest-first reads down the season the way it was played, which is a nice
  // narrative at ten games and at forty buries last night at the bottom of a scroll, the one row
  // anyone opening a player page late in a season is looking for. It also decides what the
  // capped log shows without scrolling, since the cap clips the BOTTOM of the list (see
  // StatLogTable).
  const newestFirst = <T extends { game_id: string }>(lines: T[]): T[] =>
    [...lines].sort((a, b) => {
      const da = gameById.get(a.game_id)?.game_date ?? ''
      const db = gameById.get(b.game_id)?.game_date ?? ''
      return db.localeCompare(da)
    })

  // Posts naming this player: the ones whose headline names them first (the profiles), then the
  // rest, each newest first. See aboutPlayerFirst.
  const writtenAbout = useMemo(
    () => aboutPlayerFirst(articles.filter(a => a.player_ids.includes(player.id)), player.name ?? ''),
    [articles, player.id, player.name])

  // The position she has actually been playing, which is not always the one on the roster.
  const pos = displayPosition(player.position, batting, games)
  // THE META LINE IN WORDS. It was "#3 · CF · listed RHP · B/T R/R · 28 yrs", five codes in a row,
  // and "listed RHP" read as a note about our data rather than a fact about the player. What that
  // phrase was protecting is kept: a two-way player whose filed position is the mound says so as a
  // second position ("Center field / Pitcher"), and anyone else the season has moved still names
  // the listing, so a reader who knows her as the club's catcher does not wonder whether we lost her.
  const played = positionName(pos.label)
  const filed = pos.overridden ? positionName(pos.official) : null
  const posText = !played ? null
    : !filed || filed === played ? played
      : twoWay ? `${played} / ${filed}`
        : `${played} (listed ${filed.toLowerCase()})`
  const hands = [player.bats ? `Bats ${player.bats}` : null, player.throws ? `throws ${player.throws}` : null].filter(Boolean).join(', ')
  // Uniform number leads the meta line when the roster carries one (69 of 118 do). It is a
  // fact of identity a reader looks for first, so it goes ahead of position and handedness.
  const subParts = [
    player.jersey_number ? `#${player.jersey_number}` : null,
    posText,
    hands ? hands.charAt(0).toUpperCase() + hands.slice(1) : null,
    player.age != null ? `Age ${player.age}` : null,
  ].filter(Boolean)
  // The facts with a label. On a phone they are the lines under the meta, as before; on a wide
  // card they take the band's right-hand side, where the form strip used to repeat the top of the
  // game log. A draft slot on its own ("Round 1, Pick 1") read as a stray line, so it says what it is.
  const draft = player.draft_round
    ? `Round ${player.draft_round}${player.draft_pick ? `, pick ${player.draft_pick}` : ''}`
    : null
  const facts: BandFact[] = [
    ...(player.hometown ? [{ label: 'Hometown', value: player.hometown }] : []),
    ...(draft ? [{ label: 'Drafted', value: draft, inline: `Drafted ${draft.charAt(0).toLowerCase()}${draft.slice(1)}` }] : []),
  ]

  // ── the two panes ──────────────────────────────────────────────────────────

  /**
   * A counting rank worth printing in a cell.
   *
   * The bar is `bestCountingRanks`' own, kept deliberately: top 5, against a field of at least
   * ten, and never a "1st" that is really a tie on zero. What is dropped is that helper's
   * two-row CAP, which was rationing vertical space that a rank sitting inside a cell does not
   * spend. See SeasonLine.
   */
  const countRank = (rs: WpblStatRank[] | undefined, key: string): WpblStatRank | null => {
    const r = rs?.find(x => x.key === key)
    return r && r.of >= COUNT_RANK_MIN_FIELD && r.rank <= CARD_RANK_BAR && r.value > 0 ? r : null
  }
  /** A rate's rank, at the same bar: a 9th of 16 under an ERA is a verdict, not a fact worth ink. */
  const rateRank = (rs: WpblStatRank[] | undefined, key: string): WpblStatRank | null => {
    const r = rs?.find(x => x.key === key)
    return r && r.rank <= CARD_RANK_BAR ? r : null
  }

  /**
   * A printed rank opens the league table it was taken from, sorted by that stat, with this player
   * picked out: MLB's stat card did this first. A rate rank is against the QUALIFIED field and a
   * counting rank against everyone who recorded the stat, so the board opens on the same population
   * the rank was counted in, or the row it scrolls to would sit at a different place than "3rd".
   * The counting keys carry a `c_` prefix and two of them are spelled differently on the table.
   */
  const linkRanks = <C extends object>(r: Role, cells: C[]): (C & { onRank?: () => void })[] =>
    !onOpenBoard ? cells : cells.map(c => {
      const key = (c as { rank?: { key: string } | null }).rank?.key
      if (!key) return c
      const counting = key.startsWith('c_')
      const col = !counting ? key : key === 'c_outs' ? 'ip' : key === 'c_s' ? 'sv' : key.slice(2)
      const group = r === 'pitching' ? 'pitching' : 'hitting'
      return { ...c, onRank: () => onOpenBoard(group, col, { qualified: !counting, playerId: player.id }) }
    })

  /**
   * THE HEADLINE: the four numbers every stat site leads a player with. AVG, HR, RBI and OPS for a
   * hitter; W-L (or saves, for a reliever), ERA, strikeouts and WHIP for a pitcher, which is ESPN's
   * player header and MLB.com's, so a reader arriving from either finds them where they look. Drawn
   * at every width, over the standard line, with each rank's field ("2nd of 21").
   */
  const leadsWithSaves = pt.gs === 0 && pt.s > 0
  const headline = (r: Role) => {
    // A count's place in the whole field, as a rate's is in the qualified one. Nothing for a zero,
    // which is not a place.
    const countCell = (label: string, value: number, rs: WpblStatRank[] | undefined, key: string) =>
      ({ label, value: String(value), rank: countRank(rs, key) })
    return r === 'pitching' ? [
      leadsWithSaves ? countCell('SV', pt.s, ranks?.pitchingCounts, 'c_s') : { label: 'W-L', value: `${pt.w}-${pt.l}` },
      { label: 'ERA', value: fmtEra(pt.era), rank: rateRank(ranks?.pitching, 'era') },
      countCell('SO', pt.so, ranks?.pitchingCounts, 'c_so'),
      { label: 'WHIP', value: fmtTwo(pt.whip), rank: rateRank(ranks?.pitching, 'whip') },
    ] : [
      { label: 'AVG', value: fmtRate(bt.avg), rank: rateRank(ranks?.batting, 'avg') },
      countCell('HR', bt.hr, ranks?.battingCounts, 'c_hr'),
      countCell('RBI', bt.rbi, ranks?.battingCounts, 'c_rbi'),
      { label: 'OPS', value: fmtRate(bt.ops), rank: rateRank(ranks?.batting, 'ops') },
    ]
  }
  /** A rate in the standard line, ranked only at the card's bar: "1st" under OBP, never "9th". */
  const lineRate = (label: string, value: string, rs: WpblStatRank[] | undefined, key: string) =>
    ({ label, value, rank: rateRank(rs, key) })

  const rateHead = (r: Role) => (
    <Box sx={{ mb: 1.5 }}>
      <RateStrip cells={linkRanks(r, headline(r))} />
    </Box>
  )

  /** How much of a season these numbers are, in the units the qualifying bar is set in.
   *
   *  IT IS THE TABLE'S CAPTION, not a line of its own: set on the table's own top rule, with the
   *  season on the left and the sample on the right, it is what every stat page puts over a line
   *  of numbers, and it connects the rate strip and the table instead of floating between them.
   *
   *  BOTH HALVES SHOW AT EVERY WIDTH. On the desktop card this is the only place that says how
   *  much of a season these numbers are, and the season label is the only place the card says
   *  WHICH season these are. */
  //
  //  THE SCOPE CONTROL SITS ON IT, AT EVERY WIDTH. It used to be a full-size segmented control of
  //  its own on a phone, directly under the band and 160px below the Pitching / Batting pills, so
  //  the top of the card read as two navigation bars. It re-slices exactly the numbers under this
  //  caption, so it belongs on it, and it is the compact size so it reads as a setting on a section
  //  rather than as navigation. On a phone the sample drops under the season label to make room.
  // Back to the regular season on a new year, as on a new player: the next one may have no playoffs.
  const pickSeason = (y: number | 'career') => {
    setPickedSeason(y)
    setScope('regular')
  }
  const lineCaption = (r: Role, scopeControl?: React.ReactNode, metaOverride?: React.ReactNode) => {
    const noun = scope === 'postseason' ? 'postseason' : 'season'
    // The year comes off the SCHEDULE rather than the clock (see `season`): this card is a
    // permanent page with a shareable URL, and read next January a wall-clock year would relabel a
    // 2026 line as 2027's.
    const label = career ? (scope === 'postseason' ? 'Career postseason' : 'Career')
      : season != null ? `${season} ${noun}` : noun.charAt(0).toUpperCase() + noun.slice(1)
    return (
      <LineCaption
        picker={season != null
          ? <SeasonPicker<true> career label={label} season={career ? 'career' : season} seasons={seasons} onChange={pickSeason} />
          : <Typography sx={{ ...sectionSx, mb: 0 }}>{label}</Typography>}
        meta={metaOverride !== undefined ? metaOverride : r === 'pitching' ? pitchingMeta : battingMeta}
        control={scopeControl}
      />
    )
  }

  // The log's totals row only off the regular season. On it the row repeated the season line a
  // few inches above, figure for figure, and on a phone it was the most cramped row on the card.
  // On Playoffs or Both it is the reminder, at the foot of a long list, of which games it adds up.
  const logTotals = scope !== 'regular'

  // Each pane in two halves, because a desktop dialog puts them side by side: `season` is what
  // is true about her year, `log` is the record of the games it came out of. On anything
  // narrower they simply stack in this order and nothing about the reading changes.
  /** Under the season line: the side's wins added, and a hitter's runs on the bases. A dash for a
   *  player the board does not list, which is a season with no plate appearance on that side. */
  const valueStrip = (r: Role) => {
    if (!valueOn) return null
    const cell = (label: string, p: BoardPlace | null | undefined, digits: 1 | 2, sample: string, term: string) => ({
      label, term, value: myValue ? (p ? fmtRunValue(p.value, digits) : '—') : sample,
      rank: p && p.rank <= CARD_RANK_BAR ? p : null,
    })
    // IN WORDS, NOT "Pit WPA" AND "BsR". These are the site's own reads of the play log, the two
    // figures on the card a reader is least likely to know, and a pair of abbreviations under the
    // table read as more numbers rather than as a claim. The tooltip still carries the term.
    // ONE SIDE, SAID SO WHEN THERE ARE TWO: the Stats table's WPA is both sides added, so for a
    // player with a line on each side this figure is not that one. From the lines, so the label is
    // right on first paint.
    const split = hasSeasonBatting && hasSeasonPitching
    const cells = r === 'pitching'
      ? [cell(split ? 'Wins added pitching' : 'Wins added', myValue?.wpaPitching, 2, '+0.00', 'WPA')]
      : [cell(split ? 'Wins added batting' : 'Wins added', myValue?.wpaHitting, 2, '+0.00', 'WPA'), cell('Baserunning runs', myValue?.bases, 1, '+0.0', 'BsR')]
    return <ValueStrip cells={cells} placeholder={!myValue} />
  }

  const battingPane = {
    hasLog: battingLog.length > 0,
    /** Between the season line and the log: how the season was hit, from every pitch seen. */
    profile: <PitchProfileBlock player={player} side="batting" players={players} teams={teams} games={games} season={career ? null : season} scope={scope} accent={color} />,
    /** Under the profile: her line against every pitcher she has faced. */
    matchups: <MatchupTable player={player} side="batting" lines={matchups?.vsPitchers ?? []} players={players} scope={scope} accent={color} />,
    line: (scopeControl?: React.ReactNode) => (
      <>
        {lineCaption('batting', scopeControl)}
        {rateHead('batting')}
        {/* THE STANDARD LINE, in MLB.com's column order with the rates at the end, which is how
            every stat site's table reads, so the header row is a thing a reader checks rather than
            reads. Every column is always drawn: 3B and CS sit where a reader expects them even at
            zero. The less-read columns follow the rates once they have happened, in
            Baseball-Reference's order. NO TOTAL BASES: SLG is it divided by at-bats, and it is still
            ranked, so a total-bases lead still reaches the card through the counting ranks.
            A stat in the headline is drawn there and SeasonLine leaves it out here, at every width.
            SO carries no rank, ever: second in the league in strikeouts is not an achievement. */}
        <SeasonLine ranksPending={ranksPending} reserveRanks headline={headline('batting').map(c => c.label)} cols={linkRanks('batting', [
          { label: 'G', value: bt.g },
          { label: 'AB', value: bt.ab },
          { label: 'R', value: bt.r, rank: countRank(ranks?.battingCounts, 'c_r') },
          { label: 'H', value: bt.h, rank: countRank(ranks?.battingCounts, 'c_h') },
          { label: '2B', value: bt.doubles, rank: countRank(ranks?.battingCounts, 'c_2b') },
          { label: '3B', value: bt.triples, rank: countRank(ranks?.battingCounts, 'c_3b') },
          { label: 'HR', value: bt.hr },
          { label: 'RBI', value: bt.rbi },
          { label: 'BB', value: bt.bb, rank: countRank(ranks?.battingCounts, 'c_bb') },
          { label: 'SO', value: bt.so },
          { label: 'SB', value: bt.sb, rank: countRank(ranks?.battingCounts, 'c_sb') },
          { label: 'CS', value: bt.cs },
          { label: 'AVG', value: fmtRate(bt.avg), breakBefore: true },
          lineRate('OBP', fmtRate(bt.obp), ranks?.batting, 'obp'),
          lineRate('SLG', fmtRate(bt.slg), ranks?.batting, 'slg'),
          { label: 'OPS', value: fmtRate(bt.ops) },
          // The extras start a row of their own when the line folds, whichever of them is first.
          ...[
            ...(bt.gdp ? [{ label: 'GDP', value: bt.gdp }] : []),
            ...(bt.hbp ? [{ label: 'HBP', value: bt.hbp }] : []),
            ...(bt.sh ? [{ label: 'SH', value: bt.sh }] : []),
            ...(bt.sf ? [{ label: 'SF', value: bt.sf }] : []),
          ].map((c, i) => (i === 0 ? { ...c, breakBefore: true } : c)),
        ])} />
        {valueStrip('batting')}
      </>
    ),
    season: (
      <>
        {pitchingCameo && (
          <CameoBlock label="Also pitched"
            text={`${fmtEra(pt.era)} ERA over ${outsToIp(pt.outs)} IP, ${pt.so} K`} />
        )}
        {/* Only the meter survives here: the ranks themselves have moved into the cells they
            belong to, and what is left is the administrative note about why some of them are
            missing. Drawn only for a player who is actually short of the bar. */}
        {ranks && ranks.batReason !== 'ok' && (
          <RankProgress reason={ranks.batReason} have={plateAppearances(bt)} need={ranks.qualifiers.minPa}
            unit="PA" fmt={String} noun="batters" color={ink} />
        )}
      </>
    ),
    log: (
      <StatLogTable
        title="Game log" part="log"
        // The box score's order, matching the season line above it. TB stays HERE and not
        // there: over one night it is the slugging line of that night and worth marking as a
        // best game, and over a season it is SLG times at-bats.
        statHeaders={['POS', 'AB', 'R', 'H', '2B', '3B', 'HR', 'RBI', 'SB', 'BB', 'SO', 'TB']}
        // No position in the totals: a season is not played at one. The em dash is this
        // project's glyph for "no value", which is exactly what that cell is. See `logTotals`.
        totals={!logTotals ? undefined : ['—', bt.ab, bt.r, bt.h, bt.doubles, bt.triples, bt.hr, bt.rbi, bt.sb, bt.bb, bt.so, bt.tb]}
        best={BATTING_BEST}
        accent={color}
        rows={newestFirst(battingLog).map(l => ({ ...logRow(l.game_id, l.team_id), cells: [gamePosition(l.position), l.ab, l.r, l.h, l.doubles, l.triples, l.hr, l.rbi, l.sb, l.bb, l.so, l.tb] }))}
      />
    ),
    /** What follows the pitch profile. */
    extras: myBattedBalls.length > 0
      ? (
        <Box sx={{ mt: 2.5 }}>
          <SectionHead title="Hit locations" part="spray" />
          <SprayChart plays={myBattedBalls} bats={player.bats} />
        </Box>
      )
      : null,
  }

  const pitchingPane = {
    hasLog: pitchingLog.length > 0 || seasonPitchLocs.length > 0,
    /** Between the season line and the log: how the season was pitched, from every pitch thrown. */
    profile: <PitchProfileBlock player={player} side="pitching" players={players} teams={teams} games={games} season={career ? null : season} scope={scope} accent={color} />,
    /** Under the profile: what every batter she has faced did against her. */
    matchups: <MatchupTable player={player} side="pitching" lines={matchups?.vsBatters ?? []} players={players} scope={scope} accent={color} />,
    line: (scopeControl?: React.ReactNode) => (
      <>
        {lineCaption('pitching', scopeControl)}
        {rateHead('pitching')}
        {/* MLB.com's pitching order, the rates where it puts them. The rarer columns follow WHIP once
            they have happened, and the pitch count closes the line: it is the only figure on the card
            saying how hard the innings were, which the counting stats cannot (they say what was given
            up). Batters faced is not a column, being very nearly innings times three plus the
            baserunners already itemised; `pt.bf` is still read, by the role rule in positions.ts. */}
        <SeasonLine ranksPending={ranksPending} reserveRanks headline={headline('pitching').map(c => c.label)} cols={linkRanks('pitching', [
          { label: 'W', value: pt.w, rank: countRank(ranks?.pitchingCounts, 'c_w') },
          { label: 'L', value: pt.l },
          { label: 'ERA', value: fmtEra(pt.era) },
          { label: 'G', value: pt.g },
          { label: 'GS', value: pt.gs },
          { label: 'SV', value: pt.s, rank: leadsWithSaves ? null : countRank(ranks?.pitchingCounts, 'c_s') },
          { label: 'IP', value: outsToIp(pt.outs), rank: countRank(ranks?.pitchingCounts, 'c_outs') },
          { label: 'H', value: pt.h },
          { label: 'R', value: pt.r },
          { label: 'ER', value: pt.er },
          { label: 'HR', value: pt.hr },
          { label: 'BB', value: pt.bb },
          { label: 'SO', value: pt.so },
          { label: 'WHIP', value: fmtTwo(pt.whip) },
          ...(pt.hbp ? [{ label: 'HBP', value: pt.hbp }] : []),
          ...(pt.wp ? [{ label: 'WP', value: pt.wp }] : []),
          ...(pt.bk ? [{ label: 'BK', value: pt.bk }] : []),
          { label: 'P', value: pt.pitches },
        ])} />
        {valueStrip('pitching')}
      </>
    ),
    season: (
      <>
        {battingCameo && (
          <CameoBlock label="Also batted"
            text={`${fmtRate(bt.avg)}/${fmtRate(bt.obp)}/${fmtRate(bt.slg)}, ${bt.h}-for-${bt.ab}${bt.hr ? `, ${bt.hr} HR` : ''}`} />
        )}
        {ranks && ranks.pitReason !== 'ok' && (
          <RankProgress reason={ranks.pitReason} have={pt.outs} need={ranks.qualifiers.minOuts}
            unit="IP" fmt={outsToIp} noun="pitchers" color={ink} />
        )}
      </>
    ),
    log: (
      <>
        {/* THE GAME LOG FIRST, and the pitch plot under it. League pitch tracking reaches a handful
            of games (the card's own summary reads like "44 pitches · 1 of 5 games") and the
            endpoints carrying it are key-gated, so the gap is not going to close. A complete record
            of every appearance outranks a sample of one of them. */}
        {/* No POS column here, unlike the batting log: a pitching line's position is 'p'
            in every row of every pitcher's season. */}
        <StatLogTable
          title="Game log" part="log"
          statHeaders={['DEC', 'IP', 'H', 'R', 'ER', 'HR', 'BB', 'SO', 'P']}
          // The record stands in for the decision column, which is the only cell here whose
          // season form is a different thing from the sum of the games above it.
          totals={!logTotals ? undefined : [`${pt.w}-${pt.l}`, outsToIp(pt.outs), pt.h, pt.r, pt.er, pt.hr, pt.bb, pt.so, pt.pitches]}
          best={PITCHING_BEST}
          accent={color}
          rows={newestFirst(pitchingLog).map(l => ({ ...logRow(l.game_id, l.team_id), cells: [l.decision ?? '—', outsToIp(l.outs), l.h, l.r, l.er, l.hr, l.bb, l.so, l.pitches ?? '—'] }))}
        />
      </>
    ),
    // ONLY WITH HALF THE PITCHER'S GAMES TRACKED. The league's radar reached the first couple of
    // games of the season and stopped, so for nearly every pitcher this plot was a handful of
    // pitches from one outing (13 pitches, 1 of 9 games), collapsed because it could not be
    // trusted and still taking a row to say so. The pitch profile above reads every game.
    extras: trackedPitchGames > 0 && pt.g > 0 && trackedPitchGames * 2 >= pt.g
      ? <Box sx={{ mt: 2 }}><PitchLocationCard rows={seasonPitchLocs} accent={color} gamesPitched={pt.g} /></Box>
      : null,
  }

  /**
   * THE LOADING STATE: this card drawn empty, in the same tree the loaded card uses.
   *
   * It used to be the band pinned over a spinner. When the lines landed the band moved from that
   * pinned slot into the pane's scroller, so React threw the portrait away and drew it again, and
   * everything under it arrived at once. Now the pane is the real pane holding samples (see
   * FigureBar), so the band stays put, the portrait is the same element, and the bars under it
   * become figures in place.
   *
   * THE MOST LIKELY SHAPE, where the shape depends on what has not loaded: one role, guessed off
   * the filed position (a two-way player gains the role switch above the band when the lines say
   * so); the Regular / Playoffs control, held invisibly, since every club in the league played in
   * the postseason; the hitter's sample line under the caption, which a qualified pitcher's card
   * does not have; and a game log long enough for its Show more control.
   */
  const skeletonPane = (r: Role) => {
    // A rank on every sample holds a rank row open under each row of the line, which the loaded
    // card nearly always has: every hitter measured led the league in something worth printing.
    const sample = (labels: [string, string][]) => labels.map(([label, value]) => ({ label, value, rank: { rank: 1, of: 1 } }))
    const lineCols = r === 'pitching'
      ? sample([['W', '2'], ['L', '2'], ['ERA', '4.50'], ['G', '6'], ['GS', '5'], ['SV', '0'], ['IP', '20.0'], ['H', '20'],
        ['R', '10'], ['ER', '10'], ['HR', '2'], ['BB', '10'], ['SO', '15'], ['WHIP', '1.50'], ['HBP', '1'], ['WP', '2'], ['P', '350']])
      : sample([['G', '15'], ['AB', '50'], ['R', '10'], ['H', '15'], ['2B', '3'], ['3B', '1'], ['HR', '3'], ['RBI', '10'], ['BB', '6'],
        ['SO', '8'], ['SB', '3'], ['CS', '1'], ['AVG', '.250'], ['OBP', '.350'], ['SLG', '.400'], ['OPS', '.750'], ['HBP', '1'], ['SF', '1']])
    const head = r === 'pitching'
      ? sample([['W-L', '2-2'], ['ERA', '4.50'], ['SO', '15'], ['WHIP', '1.50']])
      : sample([['AVG', '.250'], ['HR', '3'], ['RBI', '10'], ['OPS', '.750']])
    const logHeaders = r === 'pitching'
      ? ['DEC', 'IP', 'H', 'R', 'ER', 'HR', 'BB', 'SO', 'P']
      : ['POS', 'AB', 'R', 'H', '2B', '3B', 'HR', 'RBI', 'SB', 'BB', 'SO', 'TB']
    const logCells = r === 'pitching' ? ['W', '5.0', '5', '2', '2', '1', '2', '5', '80'] : ['CF', '4', '1', '1', '1', '1', '1', '1', '1', '1', '1', '2']
    return {
      hasLog: true,
      profile: null,
      matchups: null,
      extras: null,
      season: null,
      line: () => (
        <>
          {lineCaption(r,
            <Box aria-hidden sx={{ visibility: 'hidden' }}>{scopeNav}</Box>,
            r === 'pitching' ? '' : <Skeleton variant="text" sx={{ display: 'inline-block', width: '3.5em' }} />)}
          <Box sx={{ mb: 1.5 }}><RateStrip cells={head} placeholder /></Box>
          <SeasonLine cols={lineCols} headline={head.map(c => c.label)} placeholder reserveRanks />
          {valueStrip(r)}
        </>
      ),
      log: (
        <StatLogTable
          title="Game log" part="log"
          statHeaders={logHeaders}
          accent={color}
          placeholder
          rows={Array.from({ length: LOG_PREVIEW + 3 }, () => ({ lead: ['Aug 00', '@ BOS'], cells: logCells }))}
        />
      ),
    }
  }
  const paneFor = (r: Role) => (loading ? skeletonPane(r) : r === 'pitching' ? pitchingPane : battingPane)

  // One control, drawn on the season caption at every width (see lineCaption).
  const scopeNav = (
    <SegNav
      options={[
        { value: 'regular', label: 'Regular' },
        { value: 'postseason', label: 'Playoffs' },
        { value: 'all', label: 'Both' },
      ]}
      value={scope}
      onChange={v => setScope(v as SeasonScope)}
      accent={color}
      mb={0}
      size="sm"
    />
  )

  const showTabs = twoWay
  // The pager's index space, primary role first. A two-way player gets both panes; everyone
  // else gets exactly one, which is what keeps a lone unswitchable pill off the page. A
  // one-panel pager is not a special case: it simply has no neighbour to reach, so a sideways
  // drag rubber-bands and lets go, which is the same answer the tab bar gives.
  //
  // While loading, the one role the filed position points to: see skeletonPane.
  const roles: Role[] = loading
    ? [/P/.test(player.position ?? '') ? 'pitching' : 'batting']
    : twoWay
      ? (pitcherFirst ? ['pitching', 'batting'] : ['batting', 'pitching'])
      : [pitcherFirst ? 'pitching' : 'batting']
  const roleIndex = Math.max(0, roles.indexOf(role))
  // Fielding and the reading list belong to the PLAYER, not to a role, so they ride inside
  // whichever pane is on screen rather than sitting under the pager: a block below the panes
  // would be pinned chrome at the bottom of the sheet, and a block in only the primary pane
  // would hide a catcher's fielding line behind a tab.
  //
  /**
   * THE DESKTOP PAGE: one stack of full-width blocks, per role.
   *
   * NOT A RAIL OF RATES BESIDE THE TABLES. A left rail has nothing substantial to hold, and it
   * cannot be narrowed: the log asks for its natural width and the rail takes whatever is left, so
   * the SHORTER the log the WIDER the void, and a pitcher, who has the least to say, gets the
   * emptiest card. Any floor small enough to fix that is one the batting log would push through,
   * back into its own horizontal scroller.
   *
   * ACROSS THE TOP THERE IS NOTHING LEFT OVER. The headline spans, the standard line under it
   * spans, the log under that spans, and the card is a single column of full-width blocks, which
   * is both the shape the phone uses and the shape every stat page has always had.
   *
   * NO TABS ON A DESKTOP: tabs buy vertical space on a phone, a desktop dialog is not short of it,
   * and a two-way player is exactly who a stat site puts two tables on one page for. Baseball
   * Reference has never asked anyone to choose between Standard Batting and Standard Pitching.
   * That is also why the club band has no headline rates: it could only ever show one role.
   *
   * The phone keeps the pager and the pills, which is what a 375px column can hold.
   */
  const desktopRoleBlock = (r: Role, first: boolean, last: boolean) => {
    const pane = paneFor(r)
    return (
      <Box key={r} sx={{ mb: last ? 0 : 3.5 }}>
        {/* Named only when there are two of them. On a single-role card the heading would be
            answering a question nobody asked: a hitter's page does not need to say "Batting". */}
        {twoWay && (
          <Typography sx={{ ...sectionSx, color: color, mb: 1 }}>
            {r === 'pitching' ? 'Pitching' : 'Batting'}
          </Typography>
        )}
        {/* The same headline and standard line as the phone: four figures with their ranks, then
            the line in the order every stat site prints it. Until Oct 2026 the desktop put the rates
            first as the line's own lead columns, an order no other site uses. */}
        {pane.line(first && hasPostseason ? scopeNav : undefined)}
        {/* THE CAMEO AND THE QUALIFYING METER: without them a desktop reader of a below-the-bar
            player meets four unranked rates and no word about why, and a two-way cameo loses the
            one line saying the player also pitched. Capped to a reading measure, because both are
            sentences and a sentence set across 1050px is not read. */}
        <Box sx={{ maxWidth: chromePx(SENTENCE_W) }}>{pane.season}</Box>
        {/* WHAT SHE DID, THEN HOW. The game log follows the season line, as it does on every stat
            site, then her record against each opponent, then the pitch profile and the charts,
            which explain the numbers above them. The profile used to come second, and on a phone
            it put about 420px of pitch mix between the season and the games it came from. */}
        {pane.log}
        {pane.matchups}
        {pane.profile}
        {pane.extras}
        {/* Fielding belongs to the PLAYER, not to a role, so it is drawn once, after the last
            role. On a two-way card it would otherwise appear twice, and its totals are the
            player's mound work and outfield work added together either way. LAST among the stats:
            it is the least reliable number on the card. The pitch plot above it used to be the
            one block below fielding, as stale data, and it now draws only for a pitcher with at
            least half her games tracked. */}
        {last && hasFielding && (
          <FieldingLine ft={ft} positions={twoWay ? fieldedPositions : undefined} />
        )}
      </Box>
    )
  }

  /**
   * THE PHONE'S PANE, and only the phone's: above 900px `wide` swaps this whole pager out for
   * `desktopRoleBlock`, and `wide` is MUI's `md` to the pixel. Do not add `md` layout here: it
   * cannot render, and an unreachable layout is the first thing the next reader finds when they
   * go looking for how the desktop works.
   */
  /** The club band. Drawn once, pinned, on a desktop; once per pane, scrolled, on a phone. */
  const bandBlock = (ref?: (el: HTMLDivElement | null) => void) => (
    <PlayerBand
      bandRef={ref}
      // A grab surface only while pinned; a pane's copy (the one handed a ref) scrolls natively.
      // See PlayerBand.
      grab={!ref}
      // The secondary washes OVER an opaque primary rather than being the last stop of a gradient
      // that runs out of colour. As a plain gradient the right-hand end would be `secondary` at low
      // alpha over whatever sits behind the card, which in light mode is white, so the band would
      // fade to near-white exactly where text sits. Washing over the primary keeps every point on the
      // band dark enough for white text, and the club's actual hue stays visible in light mode.
      //
      // MORE OF THE CLUB, LESS OF THE BLACK: the wash starts early and ramps to whatever each club can
      // carry, so the band reads as the club's colours rather than as black with a hint of something
      // in one corner. See BAND_WASH for what sets the number.
      background={{
        color: teamPrimary,
        image: `linear-gradient(105deg, transparent 0%, transparent 26%, ${teamSecondary}${washMid} 62%, ${teamSecondary}${washEnd} 100%)`,
      }}
      stripe={teamSecondary}
      // A rounded square rather than a circle, and bigger. A circle crops a head-and-shoulders
      // portrait to the face; at this size there is room for the shoulders and the uniform, which
      // is most of what makes a player recognisable. One size at every width, deliberately: a JS
      // media query picking a size does not re-render on a live window resize the way the band's
      // CSS breakpoints do.
      portrait={<PlayerPortrait key={player.id} name={player.name} teamId={clubId} square size={84} priority />}
      // The page's <h1>. A player page is a modal over a tab but it is a real page with its own URL
      // and title, and the tab underneath stops rendering an h1 while this is open; see PageHeading.tsx.
      name={player.name}
      nameAs="h1"
      badge={twoWay ? <BandBadge>Two-way</BandBadge> : undefined}
      meta={subParts.length > 0 ? subParts.join(' · ') : undefined}
      // 0.75 alpha (PlayerBand's default) for the phone's lines and the wide card's labels: the band
      // carries a strong club hue, and at 0.62 they fall to 3.7:1 over New York's sky blue. Separate
      // FACTS: the draft line shows for a player with no hometown on file.
      facts={facts}
      // THE FAN AWARDS THIS PLAYER WON, as a seal under the facts rather than a card further down: it
      // is a fact about the player, it outlasts the season, and a card would put it below the fold on
      // a phone. A real link, so it is crawlable and opens in a new tab. Gold trophy on a light wash,
      // the one mark the results sheet itself spends on a winner.
      chips={awards.length > 0 ? (
        // One row like MLB's band, the rest behind "+N" (see BandChips).
        <BandChips noun={['fan award', 'fan awards']}>
          {awards.map(a => (
            <Box key={a.id} {...linkTo(WPBL_AWARDS_PATH)}
              onClickCapture={() => track(EVENTS.WPBL_AWARD_OPEN, { from: 'player', category: a.id })}
              aria-label={`2026 fan award: ${a.title}. See the results`}
              sx={{
                ...BAND_CHIP_SX,
                ...hoverOnly({ bgcolor: 'rgba(255,255,255,0.26)' }),
                '&:focus-visible': { outline: '2px solid #fff', outlineOffset: 2 },
              }}>
              <EmojiEvents aria-hidden sx={{ fontSize: ICON_SIZE.sm, color: '#eab308' }} />
              Fan vote · {a.title}
            </Box>
          ))}
        </BandChips>
      ) : undefined}
    />
  )
  const band = bandBlock()

  // Where the band and the scope toggle live, and whether the header shows the player's name.
  // Pinned on a desktop (a dialog is not short of height), and pinned while there is nothing to
  // scroll (loading, or a player with no stats), since a scroller around a spinner buys nothing.
  const noStats = !loading && !hasBatting && !hasPitching && !hasFielding
  const bandPinned = wide || noStats
  useBandObserver(bandEls, setBandHidden, bandPinned, player.id, twoWay, pitcherFirst, loading)


  const panels = roles.map((r, i) => {
    const pane = paneFor(r)
    return (
      // `pt` answers to the role pills, because what sits directly under them is the rate strip:
      // full pane padding plus the optical space a large numeral carries above its digits would put
      // the widest gap on the card between the control and the numbers it controls.
      <Box key={r} sx={{ px: 2, pt: showTabs ? 1 : 2, pb: 2 }}>
        {/* The band bleeds to the pane's edges (it was full-width when pinned). The scope toggle
            is on the season caption below it (see lineCaption). */}
        {!bandPinned && (
          <Box sx={{ mx: -2, mt: showTabs ? -1 : -2, mb: 2 }}>
            {bandBlock(el => { bandEls.current[i] = el })}
          </Box>
        )}
        {pane.line(hasPostseason ? scopeNav : undefined)}
        {pane.season}
        {/* The desktop's order, for the reason given there. */}
        {pane.log}
        {/* Everything under the log is below the first screen of a phone, so it mounts once the
            sheet has finished rising instead of during it. See AfterShellEnters. */}
        <AfterShellEnters>
          {pane.matchups}
          {pane.profile}
          {pane.extras}
          {/* Last among the stats, as on the desktop: see desktopRoleBlock. */}
          {hasFielding && <FieldingLine ft={ft} positions={showTabs ? fieldedPositions : undefined} />}
          {/* Rendered even for a player with no line yet (see the no-stats branch below): someone
              who has been written about but has not logged a game is exactly the case where this
              is the most interesting thing on the page. Renders nothing when nobody has written
              about the player, which is most of the roster. */}
          <FanPhotoPlayerStrip playerId={player.id} players={players} />
          <PlayerClips playerId={player.id} />
          <WrittenAbout articles={writtenAbout} title={`Written about ${player.name}`} accent={color} wide />
        </AfterShellEnters>
      </Box>
    )
  })

  // Full club name where it fits, the nickname on a phone. The header row also carries the
  // Compare and Copy-link chips and the close button, and "New York Heights" plus those two
  // chips overran a 360px header and ellipsised the club to "New York Heig…". The nickname
  // ("Heights") is the same fact, shorter, and clears the row; both are the club, so this
  // reads as a compact label rather than a truncation.
  const clubEyebrow = team ? (
    // The side panel's header is as narrow as a phone's and carries the same two chips, but it
    // renders outside the panel's phone theme (it is the shell's chrome, not the card), so its
    // breakpoints see a desktop. It is told instead, or "San Francisco Firebells" ellipsises.
    mdUp && panel ? team.name : (
      <>
        <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>{wpblFullName(team)}</Box>
        <Box component="span" sx={{ display: { xs: 'inline', sm: 'none' } }}>{team.name}</Box>
      </>
    )
  ) : 'Player'
  const eyebrow = bandPinned ? clubEyebrow : (
    <BandAwareEyebrow store={bandStore} index={roleIndex} name={player.name}>{clubEyebrow}</BandAwareEyebrow>
  )
  const actions = (
    <>
      <CompareChip player={player} roster={players} />
      <CopyLinkButton url={shareUrl} title={`Copy a link to ${player.name}`}
        onCopy={() => track(EVENTS.WPBL_SHARE_COPIED, { kind: 'player', playerId: player.id })} />
    </>
  )
  const body = (
    <StatCardContext.Provider value={cardEnv}>
      {/* Two sizings, because the sheet and the dialog are shaped differently, and the same
          arrangement the game card uses for the same reason.
          On a phone the sheet holds a definite height, so this fills it (`flex: 1`) and every
          percentage below resolves, which is what lets each role pane scroll itself and what
          gives the pager a slot to live in at all.
          Above sm the modal is content-height on purpose, so a short player sizes it down
          instead of forcing full height, and this is clamped rather than filled. `flex: 1`
          there would collapse the pane to nothing, since a flex item with a zero basis
          contributes nothing to an auto-height parent. */}
      {/* Busy while the panes are samples: a screen reader is told the card is still arriving
          rather than read a page of empty cells. */}
      <Box ref={contentRef} aria-busy={loading || undefined} sx={{
        display: 'flex', flexDirection: 'column', minHeight: 0,
        flex: { xs: '1 1 0%', sm: '0 1 auto' },
        maxHeight: { xs: 'none', sm: '100%' },
      }}>
      {/* Identity, on the club's own colours.
          The band takes the club's PRIMARY as its background: all four WPBL primaries are
          near-black (BOS #00281e, LA #000000, NY #091b47, SF #2d1747), so white text clears 12:1
          on every one of them and the wash of secondary across the right stays well under the
          point where it would stop being readable. The stripe along the bottom is the secondary
          at full strength, which is where each club's actual hue lives: orange, gold, sky, red.
          It carries the same 2px as the ring around the portrait sitting on it, deliberately, so
          the band reads as one object drawn in one weight rather than as a photo with a heavier
          rule under it.
          Deliberately NOT `wpblAccent`: that is the foreground-safe variant, built to be read
          as text on the page background. Here the colour IS the background. */}
      {/* `data-sheet-drag` makes this band the sheet's grab surface on a phone, and it is not
          decoration: this page is taller than the sheet, so its body is a real scroller, and a
          scroller takes ownership of a touch before the drag handler can. That would leave the
          small handle and the eyebrow bar as the only places a reader could pull the card back
          down. The band is the obvious thing to grab and the one block here nobody scrolls to
          READ, which is exactly the trade the attribute is for. See useSheetDrag. */}
      {/* PINNED ON A DESKTOP, SCROLLED ON A PHONE. It used to be pinned everywhere, which a phone could
          not afford: with the sheet's header and the scope toggle it held about 240px of an 812px
          screen still while the stats scrolled in what was left. On a phone it is now the first thing
          in each pane's scroller (see `panels`), and the sheet header takes the player's name once
          it has scrolled away (see `bandOut`), so whose numbers these are is never off screen. It
          stays a drag surface: at the top of the pane, where it is, a pull down closes the sheet. */}
      {bandPinned && band}

      {/* No loading branch: while the lines are in flight the panes below are drawn from samples
          (see skeletonPane), so the card has its finished shape from the first frame. */}
      {noStats ? (
        <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', p: 2 }}>
          <Box sx={{ textAlign: 'center', py: 5, color: 'text.secondary' }}>
            <Typography sx={{ fontSize: TYPE_SCALE.title, fontWeight: 700, mb: 0.5 }}>No stats yet</Typography>
            <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.disabled' }}>Season totals appear here once this player logs a game.</Typography>
          </Box>
          <FanPhotoPlayerStrip playerId={player.id} players={players} />
          <PlayerClips playerId={player.id} />
          <WrittenAbout articles={writtenAbout} title={`Written about ${player.name}`} accent={color} />
        </Box>
      ) : (
        <>
          {/* Regular / Playoffs / Both, for a player who actually played in the postseason. A
              card-level control, above the role pills and outside the pager's scroller, because it
              re-slices every number on the card (both roles) rather than switching between them.
              Pinned so it does not scroll away under the totals it governs. */}

          {showTabs && !wide && (
            /* The pinned strip the role pills live in, and its padding is not arbitrary: it matches
                Game Center's tab bar, which is the same control doing the same job over the same kind
                of pager.
                More padding below than above: the pill belongs to the chrome ABOVE it, not to the pane
                below, and with no bottom padding its edge would sit flush against the scroller's clip
                line, putting a row of stats sliced through the middle directly under the control, which
                reads as a broken layout rather than as content that continues. */
            <Box sx={{ flexShrink: 0, px: 2, pt: 0.75, pb: 1 }}>
              <SegNav
                options={roles.map(r => ({ value: r, label: r === 'pitching' ? 'Pitching' : 'Batting' }))}
                value={role}
                onChange={v => selectRole(v, 'pill')}
                accent={color}
                mb={0}
              />
            </Box>
          )}
          {/* The two roles page under a finger, the same gesture and the same component as the
              game card's tabs (`mode="pane"`, because this is a modal with a locked body and an
              inner scroller rather than the window-scrolled page the pager was first built for).
              Two panes is exactly where a swipe is worth having: the tab bar is a 40px target
              at the top of a sheet, and the thing a reader wants to compare is the other half of
              the same player.
              A role is mounted the first time it is shown and then kept, which is the pager's
              own trade: a remount mid-swipe re-shapes a whole game log and a pitch-location plot
              in the frame the finger is moving, and that stutter is the one thing that makes a
              finger-tracked pager feel broken. An unvisited role still costs nothing. */}
          {wide ? (
            /* THE DESKTOP PAGE. One scroller holding every role in full, rather than a pager
               holding one of them. See desktopRoleBlock for what each role is made of and why
               the tabs come off up here. */
            <Box sx={{ minHeight: 0, overflowY: 'auto', px: 2, pt: 2, pb: 2 }}>
              {roles.map((r, i) => desktopRoleBlock(r, i === 0, i === roles.length - 1))}
              {/* Under everything, spanning, for the reason it always did: it is the one block
                  here that is neither a season fact nor a game, and a well-covered player put
                  346px of article cards against a rail with nothing like that much to say.
                  NOT UNTIL THE LINES ARE IN. These three fetch on their own and land first, on
                  the bottom of the screen under a one-role skeleton, and the season blocks then
                  pushed them down by up to 2,800px: most of a cold player page's layout shift
                  in October 2026. Drawn after, they arrive below everything already there. */}
              {!loading && (
                <>
                  <FanPhotoPlayerStrip playerId={player.id} players={players} />
                  <PlayerClips playerId={player.id} />
                  <Box sx={{ mt: 1 }}>
                    <WrittenAbout articles={writtenAbout} title={`Written about ${player.name}`} accent={color} wide />
                  </Box>
                </>
              )}
            </Box>
          ) : (
            <SwipeableViews
              mode="pane"
              index={roleIndex}
              onIndexChange={i => selectRole(roles[i], 'swipe')}
              panels={panels}
            />
          )}
        </>
      )}
      </Box>
    </StatCardContext.Provider>
  )

  // THE FULL PAGE: the desktop layout as a page in the section's flow rather than a dialog over it.
  // Same card, same body, framed the way the full Game Center is (see DetailPageBar), at the width
  // the desktop dialog was measured at. The header names the club in full: a page has the room the
  // panel does not, and the band below already carries the name.
  if (layout === 'page') return (
    <Box component="article" sx={{ width: PLAYER_PAGE_W, ml: `calc((100% - ${PLAYER_PAGE_W}) / 2)`, pb: 4 }}>
      <WpblVisuallyHiddenH1>{player.name}</WpblVisuallyHiddenH1>
      <DetailPageBar onBack={onClose} eyebrow={team ? wpblFullName(team) : 'Player'} actions={actions} />
      <Box sx={{ bgcolor: 'background.paper', border: '1px solid', borderColor: CARD_BORDER, borderRadius: 3, overflow: 'hidden' }}>
        {body}
      </Box>
    </Box>
  )

  return (
    <ModalShell
      eyebrow={eyebrow}
      onClose={onClose}
      // A fixed pair rather than a value derived from the content, so the dialog cannot resize under
      // the reader as the season totals land. The widest block on the card is the batting season
      // line (about 666px), then the batting game log (about 600), both comfortably inside the md
      // width; what the extra room buys is a fourteen-column log not read at its own minimum.
      // Re-measure against the SEASON LINE if a column is ever added to it. Through `chromePx`
      // because it is structure: spent raw against the desktop type scale it would wrap a long name
      // onto two lines.
      maxWidth={{ xs: chromePx(640), md: chromePx(880) }}
      zIndex={1600}
      actions={<>
        {panel && mdUp && onExpand && <ExpandButton onExpand={onExpand} title={`Open ${player.name}'s full page`} />}
        {actions}
      </>}
      // A sheet on a phone, like Game Center: this opens from a roster row, a leaderboard, a Home
      // chip and a shared link, and a close button in the far top corner is the furthest point on a
      // phone from the thumb holding it. So it comes up from the bottom edge with a handle and
      // swipes back down. Above sm a centred dialog is right.
      sheet
      // Constant height while it is a sheet, so it does not leap up the screen when the season
      // totals and game logs finish loading under the reader's thumb. Same reason as the game
      // card, whose box score lands the same way.
      sheetFill
      panel={panel}
      // A different player is a new opening: the panel rises over any dialog opened since it
      // first appeared, which is how a player picked in the series view lands on top of it.
      openKey={player.id}
      onBack={onBack}
      backLabel={backLabel}
    >
      {body}
    </ModalShell>
  )
}

const sectionSx = CARD_SECTION_SX
