import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Skeleton, Typography, useMediaQuery, useTheme } from '@mui/material'
import type { Theme } from '@mui/material'
import type { WpblGame, WpblPlayer, WpblTeam, WpblBattingLine, WpblPitchingLine } from '../types'
import { fetchWpblPlayerLines, fetchWpblPlayerSeasons } from '../api'
import type { WpblPlayerSeasonsRead } from '../api/players'
import { currentSeason } from '../season'
import { useWpblPlayerLink, useWpblTeamLink } from '../LinkContext'
import { wpblManagerPortraitSet, type WpblPortraitSet } from '../portraits'
import { SectionCard, TeamBadge, PlayerPortrait, FittedName, TYPE_SCALE, DISPLAY_FONT, TAPPABLE, FOCUS_RING, hoverOnly, chromePx } from '../ui'
import { AGATE_SX, BRAND, CARD_BORDER, RADIUS } from '../../ui/card'
import { sumBatting, sumPitching, plateAppearances, isBattingGame, fmtRate, wpblQualifiers } from '../stats'
import { viewPlayerSeasons } from '../derive/playerSeasons'
import { hittingColumns, OVR_COLS, pitchingColumns } from '../statColumns'
import { LEADER_CARDS, leadersFor, type LeaderCol, type LeaderSeason, type LeaderSide, type LeaderTotals } from '../LeadersBoard'
import { STATS_PATH } from '../stats/address'
import { awardVoteCount, fetchWpblAwardResults, getCachedWpblAwardResults, type AwardResults } from '../awardVotes'
import { AWARDS_SEASON, awardResultPart, fanVoteAwards, type WpblManager } from '../awards'
import { WPBL_AWARDS_PATH } from '../routes'
import { useEraBasis } from '../EraBasisContext'
import { outsToIp } from '../innings'
import { displayPosition, displayPositionFromIndex, leadsWithPitching, playedPosition, type PrimaryPosition } from '../positions'
import { wpblAccent, wpblFullName, wpblSurface } from '../constants'
import { UNSTYLED_LINK, linkTo } from '../../nav'
import { linkPress } from '../../ui/interaction'
import { track, trackImpression, EVENTS } from '../../lib/analytics'
import { requestSectionScroll } from '../../lib/sectionScroll'
import { birthDateSettled } from '../derive/discordBirthdays'
import { awardManagerWinner, awardWinner, localIsoDate, playerOfTheDay, spotlightStories, signSeason, signGlyph, type SignBirthday } from '../derive/homePlayers'
import { useWpblSeason } from '../SeasonContext'
import { usePhoneLayout } from '../../ui/ModalShell'
import { useAccessibilitySettings } from '../../AccessibilityContext'

// The offseason Home's player cards. See derive/homePlayers.ts for why these and how each picks; this file only draws them. Every player in them is a real <a href> to the player page
// (useWpblPlayerLink), which is both the point of the cards and what lets a crawler follow them.

type OpenPlayer = (p: WpblPlayer) => void

/** The star sign card's most names. Fixed, and the card always reserves this many slots, so it is
 *  the same height before the roster lands as after whatever sign's season it is: they run from 5
 *  players to 15. */
const SIGN_CAP = 12
/** Its columns, which with SIGN_CAP set its rows: two across a phone (six rows), three at `sm` and
 *  four at `md` across the page's width, and two again from `lg`, where it shares a row with the
 *  award winners (Nov 3, 2026). Not from `md`: two across half of a 960 page cut "B. Espinoza-Molina"
 *  at large text. */
const SIGN_COLUMNS = { xs: 2, sm: 3, md: 4, lg: 2 } as const
/** Its rows' face and gaps. Two across a phone leaves a name about 113px, and "B. Espinoza-Molina",
 *  already at its last stage, needs 120: a smaller face and tighter gaps give it the room, since a
 *  name that does not fit as "F. Last" has no shorter form to fall back on. */
const SIGN_FACE = 24
const SIGN_GAP = 0.75

type RowLink = { component: 'a'; href: string; onClick?: (e: React.MouseEvent) => void }

/** The player-link props for a row, with the card's own tap recorded first. */
function useTrackedPlayerLink(card: string, onOpenPlayer: OpenPlayer) {
  const playerLink = useWpblPlayerLink()
  return (p: WpblPlayer) => {
    const link = playerLink(p, onOpenPlayer) as RowLink
    return {
      ...link,
      onClick: (e: React.MouseEvent) => {
        track(EVENTS.WPBL_HOME_PLAYER_OPEN, { card, playerId: p.id })
        link.onClick?.(e)
      },
    }
  }
}

/** One impression per card per visit, once it has something in it. */
function useShown(card: string, ready: boolean) {
  const shown = useRef(false)
  useEffect(() => {
    if (shown.current || !ready) return
    shown.current = true
    trackImpression(EVENTS.WPBL_HOME_PLAYERS_SHOWN, { card }, card)
  }, [card, ready])
}

// Sentence case, not small caps: caps on every label of every card was the site's most repeated
// tic (the Nov 3, 2026 audit in ROADMAP-UI.md). Caps stay on stat abbreviations, which are caps.
const LABEL_SX = {
  fontSize: TYPE_SCALE.micro, fontWeight: 700, color: 'text.secondary', lineHeight: 1.3,
} as const

/** "Thu, Oct 16" for a 'YYYY-MM-DD'. Noon, so no zone can move it onto another day. */
function shortDate(iso: string, withYear = false): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', withYear
    ? { month: 'short', day: 'numeric', year: 'numeric' }
    : { weekday: 'short', month: 'short', day: 'numeric' })
}

// ─── A player row ───────────────────────────────────────────────────────────────

/** 44px tall on a phone, the tap target these rows are the whole of. */
const ROW_PY = { xs: 0.75, md: 0.5 } as const

const ROW_LINK_SX = {
  ...UNSTYLED_LINK, display: 'flex', alignItems: 'center', minWidth: 0,
  borderRadius: 2, px: 0.75, ml: -0.75, py: ROW_PY, ...TAPPABLE, ...FOCUS_RING,
} as const

/** Portrait, name and one quiet line under it, with an optional right-hand end. The row height
 *  is fixed by its two lines of type, which is what the skeleton reserves. */
function PersonRow({ name, teamId, src, meta, aside, link, size = 32, gap = 1, faceHidden }: {
  name: string; teamId: string | null; src?: WpblPortraitSet | null; meta: React.ReactNode
  /** Beside the link rather than inside it, since it holds links of its own. */
  aside?: React.ReactNode
  link: RowLink; size?: number
  /** Between the face and the name. The two-across star sign grid passes less. */
  gap?: number
  /** No face, so the name has its room: the star sign grid on a phone at large text. */
  faceHidden?: boolean
}) {
  const row = (
    <Box {...link} sx={{ ...ROW_LINK_SX, gap, flex: 1, ...(aside ? null : { mr: -0.75 }) }}>
      {!faceHidden && <PlayerPortrait name={name} teamId={teamId} size={size} src={src} />}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <FittedName name={name} sx={{ fontSize: TYPE_SCALE.body, fontWeight: 700, lineHeight: 1.3 }} />
        <Typography noWrap sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', lineHeight: 1.3 }}>{meta}</Typography>
      </Box>
    </Box>
  )
  return aside ? <Box sx={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>{row}{aside}</Box> : row
}

function PlayerRow({ player, ...row }: Omit<React.ComponentProps<typeof PersonRow>, 'name' | 'teamId' | 'src'> & { player: WpblPlayer }) {
  return <PersonRow name={player.name} teamId={player.team_id} {...row} />
}

/** A row that is not here yet, the same two lines tall. */
function RowSkeleton({ size = 32, gap = 1, faceHidden }: { size?: number; gap?: number; faceHidden?: boolean }) {
  return (
    <Box aria-hidden sx={{ display: 'flex', alignItems: 'center', gap, py: ROW_PY }}>
      {!faceHidden && <Skeleton variant="circular" sx={{ flexShrink: 0, width: `calc(${size}px * var(--app-chrome, 1))`, height: `calc(${size}px * var(--app-chrome, 1))` }} />}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Skeleton variant="text" width="60%" sx={{ fontSize: TYPE_SCALE.body, lineHeight: 1.3 }} />
        <Skeleton variant="text" width="40%" sx={{ fontSize: TYPE_SCALE.meta, lineHeight: 1.3 }} />
      </Box>
    </Box>
  )
}

function clubMeta(p: WpblPlayer, teams: Map<string, WpblTeam>, positions: Map<string, PrimaryPosition>): string {
  const team = p.team_id ? teams.get(p.team_id) : undefined
  return [team?.abbr, displayPositionFromIndex(p, positions).label].filter(Boolean).join(' · ')
}

/**
 * The position each player has been playing this season, from the stored season rows
 * (derive/playerSeasons.ts), so a list of names on Home prints the same position as the player
 * page one tap away. Not the box-score lines: Home stopped reading the season's lines in the
 * offseason, and these rows are one small cached read. Empty until it lands, or when the rows
 * are stale (`current` false), which leaves the roster's own label: the answer before Oct 21, 2026.
 */
function useStoredPositions(games: WpblGame[]): Map<string, PrimaryPosition> {
  const year = currentSeason(games)
  const [index, setIndex] = useState<Map<string, PrimaryPosition>>(() => new Map())
  useEffect(() => {
    if (year == null) return
    let live = true
    fetchWpblPlayerSeasons(year)
      .then(r => {
        if (!live || !r.current) return
        setIndex(new Map(r.rows.flatMap(row => (row.scope === 'regular' && row.position ? [[row.player_id, row.position] as const] : []))))
      })
      .catch(() => { /* the roster's labels stand */ })
    return () => { live = false }
  }, [year])
  return index
}

// ─── The season's boards, shared ────────────────────────────────────────────────

type Place = { player: WpblPlayer; text: string; rank: number; tied: boolean }

/** Every board Home reads off the stored season rows: the leaders board's tabs, and the boards a
 *  Spotlight story can come from, in order of importance (spotlightStories reads the order). */
const STORY_STATS: { side: LeaderSide; key: string }[] = [
  { side: 'overall', key: 'war' }, { side: 'hitting', key: 'avg' }, { side: 'hitting', key: 'hr' },
  { side: 'pitching', key: 'era' }, { side: 'pitching', key: 'so' }, { side: 'hitting', key: 'ops' },
  { side: 'hitting', key: 'rbi' }, { side: 'pitching', key: 'w' }, { side: 'hitting', key: 'sb' },
  { side: 'pitching', key: 'whip' }, { side: 'hitting', key: 'r' }, { side: 'hitting', key: 'h' },
  { side: 'hitting', key: 'obp' }, { side: 'pitching', key: 'sv' }, { side: 'pitching', key: 'ip' },
]

const statTitle = (side: LeaderSide, key: string) => LEADER_CARDS[side].find(c => c.key === key)?.title ?? key.toUpperCase()

/**
 * The season's boards, ranked as the Stats tab ranks them, off the stored season rows: one small
 * cached read (fetchWpblPlayerSeasons dedupes), shared by the leaders board and the Spotlight's pick.
 * `boards` is null until it lands; `stale` is true when the rows are behind the lines or the read
 * failed, and then there are no boards to draw.
 */
function useSeasonBoards(players: WpblPlayer[], teams: Map<string, WpblTeam>, games: WpblGame[]) {
  const { basis: eraBasis, fmtEra } = useEraBasis()
  const { season, seasonGames } = useWpblSeason(games, { current: true })
  const [read, setRead] = useState<WpblPlayerSeasonsRead | null>(null)
  useEffect(() => {
    if (season == null) return
    let live = true
    fetchWpblPlayerSeasons(season)
      .then(r => { if (live) setRead(r) })
      .catch(() => { if (live) setRead({ rows: [], current: false }) })
    return () => { live = false }
  }, [season])

  const boards = useMemo(() => {
    if (!read?.current || players.length === 0 || teams.size === 0) return null
    const view = viewPlayerSeasons(read.rows, players)
    const ctx = { league: view.league('regular'), wWeights: view.weights.woba, fWeights: view.weights.fip, fmtEra, eraBasis }
    const qual = wpblQualifiers([...teams.values()], seasonGames)
    const batting = view.batting('regular'), pitching = view.pitching('regular')
    const hit = hittingColumns(ctx), pit = pitchingColumns(ctx)
    const leaders = <T extends LeaderTotals>(seasons: LeaderSeason<T>[], cols: LeaderCol<T>[], side: LeaderSide, key: string) => {
      const col = cols.find(c => c.key === key)
      return col ? leadersFor(seasons, col, side, qual) : []
    }
    return new Map<string, Place[]>(STORY_STATS.map(({ side, key }) => [key, side === 'overall' ? leaders(view.value, OVR_COLS, side, key)
      : side === 'hitting' ? leaders(batting, hit, side, key) : leaders(pitching, pit, side, key)]))
  }, [read, players, teams, seasonGames, fmtEra, eraBasis])
  return { season, boards, stale: read != null && !read.current }
}

// ─── Player spotlight ───────────────────────────────────────────────────────────

interface Lines { batting: WpblBattingLine[]; pitching: WpblPitchingLine[] }

/** The card's stat line, the back of a baseball card: heads over figures, both in the agate face. */
function StatCell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Box sx={{ minWidth: 0, textAlign: 'center' }}>
      <Typography sx={{ ...AGATE_SX, fontSize: TYPE_SCALE.micro, color: 'text.secondary', lineHeight: 1.3 }}>{label}</Typography>
      <Typography component="div" sx={{ ...AGATE_SX, fontSize: TYPE_SCALE.display, lineHeight: 1.2 }}>
        {value}
      </Typography>
    </Box>
  )
}

/** The strip's height, held when a pick never played so the card does not shorten under a reader. */
const STRIP_MIN_H = `calc(${TYPE_SCALE.micro} * 1.3 + ${TYPE_SCALE.display} * 1.2)`

function SeasonStrip({ player, lines, games }: { player: WpblPlayer; lines: Lines | null; games: WpblGame[] }) {
  const { fmtEra } = useEraBasis()
  // The current season's line, on Home every day of the year: a player's lines are their career, so
  // summed whole the strip would read two seasons under one year's label.
  const { season, cut, seasonGames } = useWpblSeason(games, { current: true })
  const cells = useMemo((): [string, string][] | null => {
    if (!lines) return null
    // The player page's rule (isBattingGame), so a pitcher's empty box-score lines are not games batted.
    const bat = sumBatting(cut(lines.batting).filter(isBattingGame), seasonGames)
    const pit = sumPitching(cut(lines.pitching), seasonGames)
    const pa = plateAppearances(bat)
    const hasBatting = pa > 0
    const hasPitching = pit.outs > 0 || pit.bf > 0
    if (!hasBatting && !hasPitching) return []
    const played = playedPosition(player.position, cut(lines.batting), games)
    if (leadsWithPitching({ position: player.position, played, hasBatting, hasPitching, gs: pit.gs, bf: pit.bf, pa })) {
      return [
        ['G', String(pit.g)], ['IP', outsToIp(pit.outs)], ['ERA', fmtEra(pit.era)],
        ['K', String(pit.so)], ['WHIP', pit.whip == null ? '—' : pit.whip.toFixed(2)], ['W-L', `${pit.w}–${pit.l}`],
      ]
    }
    return [
      ['G', String(bat.g)], ['AVG', fmtRate(bat.avg)], ['OBP', fmtRate(bat.obp)],
      ['SLG', fmtRate(bat.slg)], ['HR', String(bat.hr)], ['RBI', String(bat.rbi)],
    ]
  }, [lines, cut, seasonGames, games, player.position, fmtEra])

  return (
    <Box>
      <Typography sx={{ ...LABEL_SX, mb: 0.5 }}>{season != null ? `${season} regular season` : 'Regular season'}</Typography>
      {cells && cells.length === 0 ? (
        <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.secondary', lineHeight: 1.3, minHeight: STRIP_MIN_H, display: 'flex', alignItems: 'center' }}>
          {season != null ? `No ${season} games` : 'No games'}
        </Typography>
      ) : (
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: 0.5 }}>
          {(cells ?? ['G', '', '', '', '', ''].map(l => [l, ''] as [string, string])).map(([label, value], i) => (
            // A no-break space, not ' ': a lone space collapses, so the label row took no height
            // until the stats landed and the card grew by a line under the reader.
            <StatCell key={i} label={cells ? label : ' '}
              value={cells ? value : <Skeleton variant="text" width="70%" sx={{ mx: 'auto', fontSize: TYPE_SCALE.display }} />} />
          ))}
        </Box>
      )}
    </Box>
  )
}

// One step smaller below md: on a phone the face, the name and the numeral share 340px, and at the
// desktop size the name fell back to "O. Bricker" and the club line to an ellipsis.
const NAME_SX = { fontSize: { xs: TYPE_SCALE.display, md: TYPE_SCALE.page }, fontWeight: 800, lineHeight: 1.2 } as const

/** The line over the name: why this player, the way a card's front says what it commemorates. One
 *  line of the agate face in capitals, always drawn so the band is one height before and after. */
/** The numeral's width at its largest ("#29" at `lead`), kept clear on the story line beside it. */
const NUMERAL_ROOM = { xs: '5rem', lg: '7rem' } as const

const STORY_SX = { ...AGATE_SX, fontSize: TYPE_SCALE.meta, textTransform: 'uppercase', letterSpacing: '0.06em', lineHeight: 1.4 } as const

/**
 * One player a day, as a trading card (Nov 4, 2026, ROADMAP-UI.md's audit): a band in the club's
 * own color with a square photo, the jersey number big in the corner and the reason they are here
 * over the name; the facts under it; the season's line along the bottom in the agate face. It was a
 * section like every other, a round face and three lines of prose, and nothing about it said card.
 *
 * AN OBJECT, SO IT HAS A FRAME: the club's accent, which clears 3:1 on the page in both themes
 * (src/CLAUDE.md, "Borders"), so the frame is the club as well as the edge.
 *
 * THE PICK HAS A STORY (spotlightStories): a podium finish in one of the season's headline stats, or
 * a birthday. Until Nov 4 the rotation walked everyone with a box-score line, and the front page led
 * with a 9.63 ERA and no strikeouts under nothing that said why.
 */
export function PlayerSpotlightCard({ players, teams, games, onOpenPlayer, avoid = null }: {
  players: WpblPlayer[]; teams: Map<string, WpblTeam>; games: WpblGame[]; onOpenPlayer: OpenPlayer
  /** A player another card on the page already headlines (the Star of the final). Undefined while
   *  that is still being read: the card holds its placeholder rather than draw a player it may
   *  have to swap a beat later. */
  avoid?: string | null
}) {
  const isDark = useTheme().palette.mode === 'dark'
  const today = localIsoDate()
  const { boards, stale } = useSeasonBoards(players, teams, games)
  // Null until the boards land, and empty when they cannot (stale rows, a failed read), which
  // leaves the plain rotation. Waiting on them is the same wait as the leaders board beside it.
  const stories = useMemo(() => boards
    ? spotlightStories(STORY_STATS.map(({ side, key }) => ({ title: statTitle(side, key), places: boards.get(key) ?? [] })))
    : stale ? new Map<string, string>() : null, [boards, stale])
  const pick = useMemo(
    () => (avoid === undefined || stories == null ? null : playerOfTheDay(players, today, avoid, stories)),
    [players, today, avoid, stories])
  const player = pick?.player ?? null
  const link = useTrackedPlayerLink('day', onOpenPlayer)
  useShown('day', !!player)

  // One player's lines, not the season's: the season read is the heaviest in the section and the
  // offseason Home stopped making it. This one is also the read the player page opens with, so a
  // tap through lands on a warm cache.
  const [lines, setLines] = useState<{ id: string; lines: Lines } | null>(null)
  useEffect(() => {
    if (!player) return
    let live = true
    fetchWpblPlayerLines(player.id)
      .then(l => { if (live) setLines({ id: player.id, lines: l }) })
      .catch(() => { if (live) setLines({ id: player.id, lines: { batting: [], pitching: [] } }) })
    return () => { live = false }
  }, [player])
  const own = lines && player && lines.id === player.id ? lines.lines : null
  // Keyed to the player, so a new pick (the date turning over) waits for its own face.
  const [faceFor, setFaceFor] = useState<string | null>(null)
  const playerId = player?.id ?? null
  const onFaceReady = useCallback(() => setFaceFor(playerId), [playerId])
  const faceReady = !!player && faceFor === player.id
  // The photo's size is a number, not a breakpoint object, so the width is asked. Smaller between a
  // phone and lg, where the card has half of a 960 page and the club line needs the room.
  const phone = usePhoneLayout()
  const lgUp = useMediaQuery((t: Theme) => t.breakpoints.up('lg'))
  const face = phone ? 84 : lgUp ? 108 : 88

  const teamId = player?.team_id ?? null
  const team = teamId ? teams.get(teamId) : undefined
  // Nothing until the player's own lines land, never the roster's label first: the roster can
  // list a shortstop who has been playing second, and the line read the card as SS, then 2B.
  const position = player && own ? displayPosition(player.position, own.batting, games).label : null
  const settled = player ? birthDateSettled(player) : false
  const glyph = signGlyph(player?.zodiac_sign)
  const draft = player?.draft_round != null
    ? `Round ${player.draft_round}${player.draft_pick != null ? `, pick ${player.draft_pick}` : ''}`
    : '—'

  // Three plain lines (Nov 3, 2026): every fact carries its own few words of context. Each holds one
  // row and never wraps, so the stat line under them cannot move.
  const born = player && settled ? `Born ${shortDate(player.birth_date!, true)}${player.age != null ? ` (${player.age})` : ''}` : null
  const sign = player?.zodiac_sign ? `${glyph} ${player.zodiac_sign}` : null
  const bt = player && (player.bats || player.throws) ? `B/T ${player.bats ?? '—'}/${player.throws ?? '—'}` : null
  const drafted = player?.draft_round != null ? `Drafted ${draft.replace('Round', 'round')}` : null
  const factLines = player
    ? [[born, sign].filter(Boolean).join(' · ') || '—', player.hometown ?? '—', [bt, drafted].filter(Boolean).join(' · ') || '—']
    : [null, null, null]
  const number = player?.jersey_number ? `#${player.jersey_number}` : null
  const story = !player ? null
    : pick?.reason === 'birthday' ? 'Birthday today'
    : stories?.get(player.id) ?? 'Today'
  const clubInk = player ? wpblAccent(teamId, isDark) : 'text.secondary'

  return (
    // The heading opens the player's page, the way every section's heading opens more of itself.
    // No date beside it: the card is today's by being on today's page, and the line on the band
    // says why this player.
    <SectionCard title="Player Spotlight" fill titleLink={player ? link(player) : { 'aria-hidden': true }}>
      <Box {...(player ? link(player) : { 'aria-hidden': true })} sx={{
        ...UNSTYLED_LINK, display: 'flex', flexDirection: 'column', minWidth: 0,
        border: '2px solid', borderColor: player ? clubInk : CARD_BORDER, borderRadius: RADIUS.lg, overflow: 'hidden',
        ...(player ? { ...TAPPABLE, ...FOCUS_RING } : null),
      }}>
        {/* The band: the club's own surface color, the photo, the story, the name, the numeral. */}
        <Box sx={{
          display: 'flex', alignItems: 'flex-end', gap: 1.5, px: 1.5, pt: 1.5, minWidth: 0, position: 'relative',
          bgcolor: wpblSurface(teamId, isDark),
        }}>
          {/* The skeleton stays over the photo until its face has loaded, and the face fades in
              under it. Swapped straight in, the frame painted as a bare club-colored square for the
              beat before the photo arrived: a blink. */}
          <Box sx={{ position: 'relative', flexShrink: 0, mb: 1.5 }}>
            {player
              ? <Box sx={{ opacity: faceReady ? 1 : 0, transition: 'opacity 0.25s' }}>
                  <PlayerPortrait name={player.name} teamId={teamId} size={face} square eager onReady={onFaceReady} ring={clubInk} />
                </Box>
              : <Box sx={{ width: chromePx(face), height: chromePx(face) }} />}
            {!faceReady && <Skeleton variant="rounded" sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />}
          </Box>
          <Box sx={{ flex: 1, minWidth: 0, pb: 1.5 }}>
            {/* Clear of the numeral in the corner; the name and club under it take the full width. */}
            <Typography noWrap sx={{ ...STORY_SX, color: player ? clubInk : 'text.secondary', pr: NUMERAL_ROOM }}>
              {story ?? <Skeleton width="40%" />}
            </Typography>
            {player
              ? <FittedName name={player.name} sx={NAME_SX} />
              : <Typography sx={NAME_SX}><Skeleton width="55%" /></Typography>}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, minWidth: 0, mt: 0.25 }}>
              {team && <TeamBadge team={team} size={18} />}
              <Typography noWrap sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', minWidth: 0, flex: player ? undefined : 1 }}>
                {player
                  ? [team ? wpblFullName(team) : null, position].filter(Boolean).join(' · ')
                  : <Skeleton width="70%" />}
              </Typography>
            </Box>
          </Box>
          {/* The jersey number, the card's numeral: big, in the display face, in the club's color,
              in the band's top corner the way a card prints it. Placed, not in the row: beside the
              name it took a phone's room and the name fell back to "R. Kim". */}
          <Typography aria-hidden sx={{
            position: 'absolute', top: chromePx(12), right: chromePx(12), textAlign: 'right',
            fontFamily: DISPLAY_FONT, fontSize: { xs: TYPE_SCALE.hero, lg: TYPE_SCALE.lead }, fontWeight: 700, lineHeight: 0.9,
            color: clubInk, fontVariantNumeric: 'tabular-nums',
          }}>{number ?? ''}</Typography>
        </Box>

        <Box sx={{ px: 1.5, py: 1.25, minWidth: 0 }}>
          {factLines.map((line, i) => (
            <Typography key={i} noWrap sx={{ fontSize: TYPE_SCALE.body, color: i === 1 ? 'text.primary' : 'text.secondary', lineHeight: 1.5 }}>
              {line ?? <Skeleton width={['60%', '50%', '55%'][i]} />}
            </Typography>
          ))}
        </Box>

        {/* The back of the card, along the bottom: the season in the agate face over a row rule. */}
        <Box sx={{ px: 1.5, pt: 1, pb: 1.25, borderTop: '1px solid', borderTopColor: 'divider' }}>
          {player ? <SeasonStrip player={player} lines={own} games={games} /> : <SeasonStrip player={{} as WpblPlayer} lines={null} games={games} />}
        </Box>
      </Box>
    </SectionCard>
  )
}

// ─── The season's leaders and award winners ─────────────────────────────────────

/** The award winners' rows, fixed so the card does not move when its read lands. Five because the
 *  ballot has five awards; the leaders board draws five places for the same reason. */
const SEASON_ROWS = 5

/** The board's stats, one at a time behind a row of stat tabs. Labels are the stat-table heads (caps
 *  are what these abbreviations are); the full name is the board's heading tooltip and the link's. */
const LEADER_STATS: { side: LeaderSide; key: string; label: string }[] = [
  { side: 'overall', key: 'war', label: 'WAR' }, { side: 'hitting', key: 'avg', label: 'AVG' },
  { side: 'hitting', key: 'hr', label: 'HR' }, { side: 'pitching', key: 'era', label: 'ERA' },
  { side: 'pitching', key: 'so', label: 'K' },
]

/** The Stats tab's Players board sorted by a stat, the address its own leader cards "See all" to. */
const statBoardPath = (side: LeaderSide, key: string): string =>
  `${STATS_PATH}?board=players${side === 'hitting' ? '' : `&side=${side}`}&sort=${key}`

const trackCardLink = (card: string, target: string) => track(EVENTS.WPBL_HOME_CARD_LINK, { card, target })

/** Reaches past the 17px of type to the height of a tap target, without moving the header. */
const TAP_AREA_SX = {
  position: 'relative', '&::after': { content: '""', position: 'absolute', inset: '-14px 0' },
} as const

/** The figure at a row's end, a link of its own beside the row's link to the person. */
function RowValue({ link, label, children }: {
  link: { component: 'a'; href: string; onClick: (e: React.MouseEvent) => void }; label: string; children: React.ReactNode
}) {
  return (
    <Box {...link} aria-label={label} sx={{
      ...UNSTYLED_LINK, ...TAP_AREA_SX, fontSize: TYPE_SCALE.body, fontWeight: 800, fontVariantNumeric: 'tabular-nums',
      lineHeight: 1.3, borderRadius: 1, ...hoverOnly({ textDecoration: 'underline' }), ...FOCUS_RING,
    }}>
      {children}
    </Box>
  )
}

const ROW_ASIDE_SX = { flexShrink: 0, display: 'flex', alignItems: 'center', columnGap: 0.75, ml: 0.75 } as const

/** Both cards' answer to a read that failed: the rows' own height held, so nothing under it moves. */
function NoDataRows() {
  return (
    <Box sx={{ position: 'relative' }}>
      <Typography sx={{ position: 'absolute', fontSize: TYPE_SCALE.body, color: 'text.secondary' }}>No data</Typography>
      <Box aria-hidden sx={{ visibility: 'hidden' }}>
        {Array.from({ length: SEASON_ROWS }, (_, i) => <RowSkeleton key={i} />)}
      </Box>
    </Box>
  )
}

// ─── The leaders board ──────────────────────────────────────────────────────────

/** The leader's face. Big enough to be the board's picture, which the four lines under it are not. */
const LEAD_FACE = 56

/** A place's line, 44px on a phone (the tap target it is the whole of) and a box-score line's 30 on a
 *  desktop. Structure, so chromePx: it must not grow with the reader's text size. */
const PLACE_ROW_H = { xs: chromePx(44), md: chromePx(30) }

/** Rank, team tick, name, club, figure: the columns of a box score's leader line. */
const PLACE_GRID_SX = {
  display: 'grid', gridTemplateColumns: '1.75rem 3px minmax(0, 1fr) auto auto', columnGap: 1, alignItems: 'center',
} as const

/** "1", or "T2" for a share of second: a newspaper's leaders list marks a tie on the rank. */
const placeText = (rank: number, tied: boolean) => `${tied ? 'T' : ''}${rank}`

/** The stat tabs. Buttons that say which is on (`aria-pressed`), not a tablist: the board under them
 *  is one region that changes, not five panels. */
function StatTabs({ value, onChange }: { value: string; onChange: (key: string) => void }) {
  return (
    <Box role="group" aria-label="Stat" sx={{ display: 'flex', gap: 2, mb: 1, borderBottom: '1px solid', borderBottomColor: 'divider' }}>
      {LEADER_STATS.map(s => {
        const on = s.key === value
        return (
          <Box key={s.key} component="button" type="button" aria-pressed={on}
            title={LEADER_CARDS[s.side].find(c => c.key === s.key)?.title ?? s.label}
            onClick={() => onChange(s.key)}
            sx={{
              all: 'unset', cursor: 'pointer', ...AGATE_SX, fontSize: TYPE_SCALE.body, lineHeight: 1,
              // The tap target is the tab's height, and the underline sits on the row's own rule.
              py: 1, mb: '-1px', borderBottom: '2px solid',
              borderBottomColor: on ? BRAND.fg : 'transparent',
              color: on ? 'text.primary' : 'text.secondary',
              ...hoverOnly({ color: 'text.primary' }), ...FOCUS_RING,
            }}>
            {s.label}
          </Box>
        )
      })}
    </Box>
  )
}

/** First place: the face, the name in full and the figure in the display face, the one number the
 *  board is about. A tie for first shows the first of them here and its T1 says the rest follow. */
function LeadPlace({ place, team, link }: { place: Place | null; team: WpblTeam | undefined; link: RowLink | null }) {
  const body = (
    <>
      {place
        ? <PlayerPortrait name={place.player.name} teamId={place.player.team_id} size={LEAD_FACE} />
        : <Skeleton variant="circular" sx={{ flexShrink: 0, width: chromePx(LEAD_FACE), height: chromePx(LEAD_FACE) }} />}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        {place
          ? <FittedName name={place.player.name} sx={{ fontSize: TYPE_SCALE.heading, fontWeight: 700, lineHeight: 1.3 }} />
          : <Typography sx={{ fontSize: TYPE_SCALE.heading, lineHeight: 1.3 }}><Skeleton width="60%" /></Typography>}
        <Typography noWrap sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', lineHeight: 1.3 }}>
          {place ? [place.tied ? 'T1' : null, team ? wpblFullName(team) : null].filter(Boolean).join(' · ') : <Skeleton width="45%" />}
        </Typography>
      </Box>
      <Typography sx={{
        flexShrink: 0, fontFamily: DISPLAY_FONT, fontSize: TYPE_SCALE.hero, fontWeight: 700, lineHeight: 1,
        fontVariantNumeric: 'tabular-nums', minWidth: '3ch', textAlign: 'right',
      }}>
        {place?.text ?? ''}
      </Typography>
    </>
  )
  const sx = { display: 'flex', alignItems: 'center', gap: 1.25, py: 1 } as const
  return link
    ? <Box {...link} sx={{ ...ROW_LINK_SX, ...sx, mr: -0.75 }}>{body}</Box>
    : <Box aria-hidden sx={sx}>{body}</Box>
}

/** Second place down, as a box score prints a leaders list: one line each, the club's color as a
 *  tick rather than a face, so the leader's face is the only picture on the board. */
function PlaceLine({ place, team, link, isDark }: { place: Place | null; team: WpblTeam | undefined; link: RowLink | null; isDark: boolean }) {
  const cells = (
    <>
      <Typography sx={{ ...AGATE_SX, fontSize: TYPE_SCALE.meta, color: 'text.secondary' }}>
        {place ? placeText(place.rank, place.tied) : ''}
      </Typography>
      <Box aria-hidden sx={{ height: '1em', fontSize: TYPE_SCALE.body, bgcolor: place ? wpblAccent(place.player.team_id, isDark) : 'transparent' }} />
      {place
        ? <FittedName name={place.player.name} sx={{ fontSize: TYPE_SCALE.body, fontWeight: 600, lineHeight: 1.3 }} />
        : <Skeleton variant="text" width="55%" sx={{ fontSize: TYPE_SCALE.body }} />}
      <Typography sx={{ ...AGATE_SX, fontSize: TYPE_SCALE.meta, color: 'text.secondary' }}>{team?.abbr ?? ''}</Typography>
      <Typography sx={{ ...AGATE_SX, fontSize: TYPE_SCALE.body, minWidth: '3ch', textAlign: 'right' }}>{place?.text ?? ''}</Typography>
    </>
  )
  const sx = { ...PLACE_GRID_SX, minHeight: PLACE_ROW_H } as const
  return link
    ? <Box {...link} sx={{ ...ROW_LINK_SX, ...sx, py: 0, mr: -0.75 }}>{cells}</Box>
    : <Box aria-hidden sx={sx}>{cells}</Box>
}

/**
 * The season's leaders, one stat at a time: the leader large, the next four as box-score lines. Off
 * the stored season rows, the one small read that can rank the league, so the offseason Home still
 * never touches the box-score lines. Rows that have gone stale read "No data" rather than bringing
 * those lines back; a correction leaves them stale only until the job's next run, and the Stats tab
 * one tap away has its own fallback.
 *
 * ONE BOARD WITH A STAT PICKER, not five leaders in a list (Nov 3, 2026, ROADMAP-UI.md's audit:
 * "Leaders as widget grids"). Five rows of face, name, stat name and number was the same row as the
 * award winners and the star sign card beside it, and named only the leader of each stat. The board
 * names five places, and the picker keeps every stat it had one tap away.
 */
export function SeasonLeadersCard({ players, teams, games, onOpenPlayer, rosterFailed }: {
  players: WpblPlayer[]; teams: Map<string, WpblTeam>; games: WpblGame[]; onOpenPlayer: OpenPlayer
  /** The roster's read has answered with nothing: there is nobody to name, and never will be. */
  rosterFailed?: boolean
}) {
  const isDark = useTheme().palette.mode === 'dark'
  const link = useTrackedPlayerLink('leaders', onOpenPlayer)
  const [statKey, setStatKey] = useState(LEADER_STATS[0].key)
  const { season, boards: all, stale } = useSeasonBoards(players, teams, games)
  // The board's five stats, five places each.
  const boards = useMemo(() => all && new Map(LEADER_STATS.map(({ key }) => [key, (all.get(key) ?? []).slice(0, SEASON_ROWS)])), [all])
  useShown('leaders', !!boards)

  const stat = LEADER_STATS.find(s => s.key === statKey) ?? LEADER_STATS[0]
  const places = boards?.get(stat.key) ?? null
  const failed = stale || (!!boards && [...boards.values()].every(b => b.length === 0)) || (!!rosterFailed && !boards)
  const teamOf = (p: Place | null | undefined) => (p?.player.team_id ? teams.get(p.player.team_id) : undefined)
  const placeAt = (i: number): Place | null => places?.[i] ?? null
  return (
    // The year before the schedule lands too: a title needs no data, and the only season this card
    // can be drawn for until 2027 is the ballot's. The heading opens the full board on the stat that
    // is showing, which is more of exactly this.
    <SectionCard title={`${season ?? AWARDS_SEASON} Leaders`} fill
      titleLink={linkTo(statBoardPath(stat.side, stat.key), () => trackCardLink('leaders', stat.key))}>
      <StatTabs value={stat.key} onChange={k => { setStatKey(k); trackCardLink('leaders', `tab:${k}`) }} />
      {failed ? <NoDataRows /> : (
        <Box aria-live="polite">
          <LeadPlace place={placeAt(0)} team={teamOf(placeAt(0))} link={placeAt(0) ? link(placeAt(0)!.player) : null} />
          {[1, 2, 3, 4].map(i => (
            <PlaceLine key={i} place={placeAt(i)} team={teamOf(placeAt(i))} isDark={isDark}
              link={placeAt(i) ? link(placeAt(i)!.player) : null} />
          ))}
        </Box>
      )}
    </SectionCard>
  )
}

type WinnerRow = { id: string; title: string; pct: number } & ({ player: WpblPlayer; manager?: undefined } | { manager: WpblManager; player?: undefined })

/** The closed ballot's awards, each a link to its winner and a vote share, read off the tally alone. */
export function FanAwardWinnersCard({ players, teams, onOpenPlayer, onOpenTeam, onOpenAwards, rosterFailed }: {
  players: WpblPlayer[]; teams: Map<string, WpblTeam>; onOpenPlayer: OpenPlayer; onOpenTeam: (t: WpblTeam) => void
  /** Through WpblApp, which owns the results sheet: going to the address alone opens nothing. */
  onOpenAwards?: () => void
  /** The roster's read has answered with nothing: there is nobody to name, and never will be. */
  rosterFailed?: boolean
}) {
  const link = useTrackedPlayerLink('winners', onOpenPlayer)
  const teamLink = useWpblTeamLink()
  const [results, setResults] = useState<AwardResults | null>(() => getCachedWpblAwardResults())
  const ready = players.length > 0
  useEffect(() => {
    if (!ready) return
    let live = true
    fetchWpblAwardResults().then(r => { if (live) setResults(r) })
    return () => { live = false }
  }, [ready])

  const rows = useMemo(() => {
    if (!results || !ready) return null
    const share = (id: string, key: string) => {
      const total = awardVoteCount(results, id)
      return total > 0 ? Math.round(((results[id]?.[key] ?? 0) / total) * 100) : 0
    }
    return fanVoteAwards().flatMap(({ id, title, pick }): WinnerRow[] => {
      if (pick === 'manager') {
        const manager = awardManagerWinner(results, id)
        return manager ? [{ id, title, manager, pct: share(id, manager.key) }] : []
      }
      const player = awardWinner(results, id, players)
      return player ? [{ id, title, player, pct: share(id, player.id) }] : []
    })
  }, [results, ready, players])
  useShown('winners', !!rows?.length)

  const openAt = (id: string) => () => {
    trackCardLink('winners', id)
    requestSectionScroll(awardResultPart(id))
    onOpenAwards?.()
  }
  const failed = rows?.length === 0 || (!!rosterFailed && !rows)
  return (
    <SectionCard title={`${AWARDS_SEASON} Fan Award Winners`} fill
      titleLink={linkPress(WPBL_AWARDS_PATH, () => { trackCardLink('winners', 'all'); onOpenAwards?.() })}>
      {failed ? <NoDataRows /> : Array.from({ length: SEASON_ROWS }, (_, i) => {
        const r = rows?.[i]
        if (!rows) return <RowSkeleton key={i} />
        if (!r) return <Box key={i} aria-hidden sx={{ visibility: 'hidden' }}><RowSkeleton /></Box>
        const aside = (
          <Box sx={ROW_ASIDE_SX}>
            <RowValue label={`${r.title} results, ${r.pct}%`} link={linkPress(WPBL_AWARDS_PATH, openAt(r.id))}>{r.pct}%</RowValue>
          </Box>
        )
        if (r.player) return <PlayerRow key={r.id} player={r.player} link={link(r.player)} meta={r.title} aside={aside} />
        // No player page for a manager: the club's is the page the award is about, as on the sheet.
        const team = teams.get(r.manager.teamId)
        const managerLink = team ? teamLink(team, () => onOpenTeam(team)) : linkPress(WPBL_AWARDS_PATH, openAt(r.id))
        return (
          <PersonRow key={r.id} name={r.manager.name} teamId={r.manager.teamId} src={wpblManagerPortraitSet(r.manager.key)}
            link={managerLink as RowLink} meta={r.title} aside={aside} />
        )
      })}
    </SectionCard>
  )
}

// ─── Star sign, with birthdays ──────────────────────────────────────────────────

/** "Oct 16", or how near it is when that says more. */
function birthdayLabel(b: SignBirthday): string {
  if (b.offset === 0) return 'Today'
  if (b.offset === 1) return 'Tomorrow'
  if (b.offset === -1) return 'Yesterday'
  return b.date ? shortMonthDay(b.date.slice(5)) : ''
}

export function StarSignCard({ players, teams, games, onOpenPlayer }: {
  players: WpblPlayer[]; teams: Map<string, WpblTeam>; games: WpblGame[]; onOpenPlayer: OpenPlayer
}) {
  const isDark = useTheme().palette.mode === 'dark'
  const positions = useStoredPositions(games)
  const today = localIsoDate()
  const { sign, players: born } = useMemo(() => signSeason(players, today), [players, today])
  const link = useTrackedPlayerLink('sign', onOpenPlayer)
  useShown('sign', born.length > 0)
  const shown = born.slice(0, SIGN_CAP)
  const range = `${shortMonthDay(sign.from)} – ${shortMonthDay(sign.to)}`
  const columns = Object.fromEntries(Object.entries(SIGN_COLUMNS).map(([bp, n]) => [bp, `repeat(${n}, minmax(0, 1fr))`]))
  // Two across a phone at large text leaves a name about 125px, and "B. Espinoza-Molina", already at
  // its last stage, needs 138: the face goes there, which gives the name the 30px it lacked rather
  // than cutting it (CLAUDE.md, names). The rows stay the same height without it.
  const phone = usePhoneLayout()
  const { textScale } = useAccessibilitySettings()
  const faceHidden = phone && textScale === 'large'
  return (
    <SectionCard title={`${sign.name} season`} action={
      <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary' }}>{sign.glyph} {range}</Typography>
    }>
      <Box sx={{ display: 'grid', gridTemplateColumns: columns, columnGap: 1 }}>
        {Array.from({ length: SIGN_CAP }, (_, i) => {
          if (players.length === 0) return <RowSkeleton key={i} size={SIGN_FACE} gap={SIGN_GAP} faceHidden={faceHidden} />
          const b = shown[i]
          // An empty slot keeps the row a sign with few players would otherwise give back, so
          // the card is one height whichever sign's season it is.
          if (!b) return <Box key={i} aria-hidden />
          const club = clubMeta(b.player, teams, positions)
          return (
            <PlayerRow key={b.player.id} player={b.player} link={link(b.player)} size={SIGN_FACE} gap={SIGN_GAP} faceHidden={faceHidden}
              meta={<>
                {b.date && (
                  <Box component="span" sx={{ fontWeight: b.offset === 0 ? 800 : 600, // The player's club color, not the brand's: since the brand became a red (Nov 4, 2026), a
                  // red "Today" read as an alert rather than a birthday.
                  color: b.offset === 0 ? wpblAccent(b.player.team_id, isDark) : 'text.primary' }}>
                    {birthdayLabel(b)}
                  </Box>
                )}
                {b.date && club ? ' · ' : ''}{club}
              </>} />
          )
        })}
      </Box>
    </SectionCard>
  )
}

/** 'MM-DD' as "Sep 23". */
function shortMonthDay(md: string): string {
  return new Date(`2026-${md}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
