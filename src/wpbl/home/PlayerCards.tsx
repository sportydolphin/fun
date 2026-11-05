import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Skeleton, Typography, useTheme } from '@mui/material'
import type { WpblGame, WpblPlayer, WpblTeam, WpblBattingLine, WpblPitchingLine } from '../types'
import { fetchWpblPlayerLines, fetchWpblPlayerSeasons } from '../api'
import type { WpblPlayerSeasonsRead } from '../api/players'
import { currentSeason } from '../season'
import { useWpblPlayerLink, useWpblTeamLink } from '../LinkContext'
import { wpblManagerPortraitSet, type WpblPortraitSet } from '../portraits'
import { SectionCard, TeamBadge, PlayerPortrait, FittedName, TYPE_SCALE, DISPLAY_FONT, TAPPABLE, FOCUS_RING, hoverOnly, chromePx } from '../ui'
import { AGATE_SX, BRAND } from '../../ui/card'
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
import { wpblField, wpblFullName } from '../constants'
import { UNSTYLED_LINK, linkTo } from '../../nav'
import { linkPress } from '../../ui/interaction'
import { track, trackImpression, EVENTS } from '../../lib/analytics'
import { requestSectionScroll } from '../../lib/sectionScroll'
import { birthDateSettled } from '../derive/discordBirthdays'
import { awardManagerWinner, awardWinner, localIsoDate, playerOfTheDay, spotlightStories, signSeason, nextSignSeason, signGlyph, type SignBirthday } from '../derive/homePlayers'
import { useWpblSeason } from '../SeasonContext'
import { usePhoneLayout } from '../../ui/ModalShell'

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
/** The gap between a row's date tile and its name. Two across a phone leaves a name about 113px, and
 *  "B. Espinoza-Molina", already at its last stage, needs 120: a tight gap gives it the room, since a
 *  name that does not fit as "F. Last" has no shorter form to fall back on. */
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
// Medium, not bold (Nov 4, 2026): nearly every line on Home was bold, the gray labels too, so
// weight stopped marking anything. Bold is for names and figures.
const LABEL_SX = {
  fontSize: TYPE_SCALE.micro, fontWeight: 500, color: 'text.secondary', lineHeight: 1.3,
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

const STORY_SX = { ...AGATE_SX, fontSize: TYPE_SCALE.meta, textTransform: 'uppercase', letterSpacing: '0.06em', lineHeight: 1.4 } as const

/**
 * One player a day, as a printed page runs a profile (Nov 4, 2026, ROADMAP-UI.md's second audit): a
 * square headshot on the club's own color, the reason they are here over the name, the facts, and the
 * season's line along the foot in the agate face. No frame and no fill: the section's rule and
 * heading are its edge, like every other section on Home.
 *
 * IT WAS A TRADING CARD earlier the same day, with a rounded frame in the club's accent, a band of
 * club color and the jersey number at `lead` size. Between square news photos and box-score lines it
 * read as a second design system, and its band was a third blue beside the masthead's navy. The
 * number stays, as a fact on the club line.
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
  // The photo's size is a number, not a breakpoint object, so the width is asked.
  // 104 from lg as below it (Nov 4, 2026): Spotlight is a third of Home's news row there, beside
  // Latest and the leaders, and at 120 the club line ("New York Heights · RHP · #29") was cut.
  const phone = usePhoneLayout()
  const face = phone ? 96 : 104

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

  return (
    // The heading opens the player's page, the way every section's heading opens more of itself.
    // No date beside it: the card is today's by being on today's page, and the story line says why
    // this player.
    <SectionCard title="Player Spotlight" fill titleLink={player ? link(player) : { 'aria-hidden': true }}>
      <Box {...(player ? link(player) : { 'aria-hidden': true })} sx={{
        ...UNSTYLED_LINK, display: 'flex', flexDirection: 'column', minWidth: 0,
        ...(player ? { ...TAPPABLE, ...FOCUS_RING } : null),
      }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 1.5, minWidth: 0 }}>
          {/* The skeleton stays over the photo until its face has loaded, and the face fades in
              under it. Swapped straight in, the frame painted as a bare club-colored square for the
              beat before the photo arrived: a blink. */}
          <Box sx={{ position: 'relative', flexShrink: 0 }}>
            {player
              ? <Box sx={{ opacity: faceReady ? 1 : 0, transition: 'opacity 0.25s' }}>
                  <PlayerPortrait name={player.name} teamId={teamId} size={face} print eager onReady={onFaceReady} />
                </Box>
              : <Box sx={{ width: chromePx(face), height: chromePx(face) }} />}
            {!faceReady && <Skeleton variant="rectangular" sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />}
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography noWrap sx={{ ...STORY_SX, color: 'text.secondary' }}>
              {story ?? <Skeleton width="40%" />}
            </Typography>
            {player
              ? <FittedName name={player.name} sx={NAME_SX} />
              : <Typography sx={NAME_SX}><Skeleton width="55%" /></Typography>}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, minWidth: 0, mt: 0.25 }}>
              {team && <TeamBadge team={team} size={18} />}
              <Typography noWrap sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', minWidth: 0, flex: player ? undefined : 1 }}>
                {/* From lg Spotlight is a third of the news row, and "San Francisco Firebells · RHP ·
                    #29" ran past it: there the club is its name alone, after the badge that already
                    says the city. */}
                {player
                  ? <>
                      {team && <Box component="span" sx={{ display: { lg: 'none' } }}>{wpblFullName(team)}</Box>}
                      {team && <Box component="span" sx={{ display: { xs: 'none', lg: 'inline' } }}>{team.name}</Box>}
                      {(team ? [''] : []).concat([position, number].filter((v): v is string => !!v)).join(' · ')}
                    </>
                  : <Skeleton width="70%" />}
              </Typography>
            </Box>
          </Box>
        </Box>

        <Box sx={{ pt: 1.25, pb: 1.25, minWidth: 0 }}>
          {factLines.map((line, i) => (
            <Typography key={i} noWrap sx={{ fontSize: TYPE_SCALE.body, color: i === 1 ? 'text.primary' : 'text.secondary', lineHeight: 1.5 }}>
              {line ?? <Skeleton width={['60%', '50%', '55%'][i]} />}
            </Typography>
          ))}
        </Box>

        {/* The season in the agate face over a row rule, the way a profile ends on the player's line. */}
        <Box sx={{ pt: 1, borderTop: '1px solid', borderTopColor: 'divider' }}>
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
// 72, up from 56 (Nov 4, 2026, Home step 4): beside Spotlight the board ran 46px short, and the
// leader's face is the one picture on it.
const LEAD_FACE = 72

/** A place's line, 44px on a phone (the tap target it is the whole of) and a box-score line's 30 on a
 *  desktop. Structure, so chromePx: it must not grow with the reader's text size. */
const PLACE_ROW_H = { xs: chromePx(44), md: chromePx(34) }

/** Rank, name, club, figure: the columns of a box score's leader line. The club-color tick between
 *  rank and name went on Nov 4, 2026: the club abbreviation after the name already says it, and five
 *  colored ticks under the club strip were color doing no work the text was not. */
const PLACE_GRID_SX = {
  display: 'grid', gridTemplateColumns: '1.75rem minmax(0, 1fr) auto', columnGap: 1, alignItems: 'center',
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
        ? <PlayerPortrait name={place.player.name} teamId={place.player.team_id} size={LEAD_FACE} print />
        : <Skeleton variant="rectangular" sx={{ flexShrink: 0, width: chromePx(LEAD_FACE), height: chromePx(LEAD_FACE) }} />}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        {place
          ? <FittedName name={place.player.name} sx={{ fontSize: TYPE_SCALE.heading, fontWeight: 700, lineHeight: 1.3 }} />
          : <Typography sx={{ fontSize: TYPE_SCALE.heading, lineHeight: 1.3 }}><Skeleton width="60%" /></Typography>}
        <Typography noWrap sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', lineHeight: 1.3 }}>
          {place ? [place.tied ? 'T1' : null, team ? wpblFullName(team) : null].filter(Boolean).join(' · ') : <Skeleton width="45%" />}
        </Typography>
      </Box>
      {/* One step down on a phone (Nov 4, 2026): at `hero` the figure was the largest thing on the
          screen there, bigger than the champion's name in the lead above it, beside ranks at `meta`. */}
      <Typography sx={{
        flexShrink: 0, fontFamily: DISPLAY_FONT, fontSize: { xs: TYPE_SCALE.page, md: TYPE_SCALE.hero }, fontWeight: 700, lineHeight: 1,
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

/** Second place down, as a box score prints a leaders list: one line each, no face, so the leader's
 *  face is the only picture on the board. The rank at the value's own size and ink (Nov 4, 2026): in
 *  gray at `meta` it was the smallest, faintest thing on the line, and the rank is what a list is. */
function PlaceLine({ place, team, link }: { place: Place | null; team: WpblTeam | undefined; link: RowLink | null }) {
  const cells = (
    <>
      <Typography sx={{ ...AGATE_SX, fontSize: TYPE_SCALE.body, fontWeight: 700 }}>
        {place ? placeText(place.rank, place.tied) : ''}
      </Typography>
      {/* The club right after the name, as a box score prints "Whitmore SF": in its own column at the
          far end it sat 450px from the name it belongs to on a desktop (Nov 4, 2026). */}
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75, minWidth: 0 }}>
        {place
          ? <FittedName name={place.player.name} sx={{ flex: '0 1 auto', minWidth: 0, fontSize: TYPE_SCALE.body, fontWeight: 600, lineHeight: 1.3 }} />
          : <Skeleton variant="text" width="55%" sx={{ fontSize: TYPE_SCALE.body }} />}
        <Typography sx={{ flexShrink: 0, ...AGATE_SX, fontSize: TYPE_SCALE.meta, color: 'text.secondary' }}>{team?.abbr ?? ''}</Typography>
      </Box>
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
            <PlaceLine key={i} place={placeAt(i)} team={teamOf(placeAt(i))}
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
  const clubAbbr = (id: string | null) => (id ? teams.get(id)?.abbr ?? null : null)
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
    // The share's column head in the heading row, over the figures (Nov 5, 2026): a bare "41%" at the
    // far end of a 600px line read as a number with nothing to say what it counted.
    <SectionCard title={`${AWARDS_SEASON} Fan Award Winners`} fill
      action={failed ? undefined : <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary' }}>Vote share</Typography>}
      titleLink={linkPress(WPBL_AWARDS_PATH, () => { trackCardLink('winners', 'all'); onOpenAwards?.() })}>
      {failed ? <NoDataRows /> : Array.from({ length: SEASON_ROWS }, (_, i) => {
        const r = rows?.[i]
        if (!r) return <AwardRow key={i} row={null} hidden={!!rows} />
        const value = linkPress(WPBL_AWARDS_PATH, openAt(r.id))
        if (r.player) {
          return <AwardRow key={r.id} value={value} link={link(r.player)}
            row={{ title: r.title, name: r.player.name, teamId: r.player.team_id, pct: r.pct, club: clubAbbr(r.player.team_id) }} />
        }
        // No player page for a manager: the club's is the page the award is about, as on the sheet.
        const team = teams.get(r.manager.teamId)
        const managerLink = team ? teamLink(team, () => onOpenTeam(team)) : value
        return <AwardRow key={r.id} value={value} link={managerLink as RowLink}
          row={{ title: r.title, name: r.manager.name, teamId: r.manager.teamId, pct: r.pct, club: clubAbbr(r.manager.teamId), src: wpblManagerPortraitSet(r.manager.key) }} />
      })}
    </SectionCard>
  )
}

/** The winner's face beside the name: small, since the award is the line's subject. */
const AWARD_FACE = 22

/**
 * One award, as a results page prints it (Nov 4, 2026, ROADMAP-UI.md's audit): the award's name in
 * the display face, the winner under it, the vote share in the agate face at the end, and a bar
 * under the line in the winner's club color, so the share reads as a share and not a bare "41%".
 * It was the face, the name, the award as a gray line and the number: the same row as the leaders
 * and the star sign card beside it, with the award, the subject, in the smallest type on the line.
 *
 * ONE STRUCTURE, LOADED OR NOT, so the card is one height before the tally lands: `row` null draws
 * placeholders, and `hidden` keeps an empty slot's height for a ballot with fewer than five.
 */
function AwardRow({ row, link, value, hidden }: {
  row: { title: string; name: string; teamId: string | null; pct: number; club: string | null; src?: WpblPortraitSet | null } | null
  link?: RowLink; value?: ReturnType<typeof linkPress>; hidden?: boolean
}) {
  const who = (
    <Box sx={{ flex: 1, minWidth: 0 }}>
      {/* A label, not a heading: in display caps the award's name outshouted the section's own
          heading once the section moved to the quieter tier (Nov 4, 2026). */}
      <Typography noWrap sx={{ fontWeight: 500, fontSize: TYPE_SCALE.meta, color: 'text.secondary', lineHeight: 1.3 }}>
        {row?.title ?? <Skeleton width="50%" />}
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0, mt: 0.25 }}>
        {row
          ? <PlayerPortrait name={row.name} teamId={row.teamId} size={AWARD_FACE} src={row.src} print />
          : <Skeleton variant="rectangular" sx={{ flexShrink: 0, width: chromePx(AWARD_FACE), height: chromePx(AWARD_FACE) }} />}
        {row
          ? <FittedName name={row.name} sx={{ fontSize: TYPE_SCALE.body, fontWeight: 800, lineHeight: 1.3 }} wrapperSx={{ minWidth: 0 }} />
          : <Skeleton variant="text" width="45%" sx={{ fontSize: TYPE_SCALE.body }} />}
        {row?.club && <Typography sx={{ ...AGATE_SX, flexShrink: 0, fontSize: TYPE_SCALE.meta, color: 'text.secondary' }}>{row.club}</Typography>}
      </Box>
    </Box>
  )
  return (
    // A little more room per row from `md` (Nov 4, 2026, Home step 4): with the share bars gone the
    // card ran 28px short of the star sign card beside it.
    <Box aria-hidden={hidden || !row || undefined} sx={{ py: { xs: 0.75, md: 1.1 }, ...(hidden ? { visibility: 'hidden' } : null) }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
        {row && link ? <Box {...link} sx={{ ...ROW_LINK_SX, flex: 1, py: 0 }}>{who}</Box> : who}
        {row && value
          ? <Box {...value} aria-label={`${row.title} results, ${row.pct}%`} sx={{
              ...UNSTYLED_LINK, ...TAP_AREA_SX, ...AGATE_SX, flexShrink: 0, fontSize: TYPE_SCALE.heading, lineHeight: 1.2,
              borderRadius: 1, ...hoverOnly({ textDecoration: 'underline' }), ...FOCUS_RING,
            }}>{row.pct}%</Box>
          : <Typography sx={{ ...AGATE_SX, flexShrink: 0, fontSize: TYPE_SCALE.heading, lineHeight: 1.2 }}>{'\u00a0'}</Typography>}
      </Box>
      {/* NO BAR UNDER THE SHARE (Nov 4, 2026, third audit): a gray bar on a gray track the width of
          the line said less than the figure beside it, and with only the winner's share there was
          nothing for it to be measured against. The results page has the full vote. */}
    </Box>
  )
}

// ─── Star sign, with birthdays ──────────────────────────────────────────────────

/** How near it is, when that says more than the date on the tile beside it. */
function birthdayWord(b: SignBirthday): string | null {
  if (b.offset === 0) return 'Today'
  if (b.offset === 1) return 'Tomorrow'
  if (b.offset === -1) return 'Yesterday'
  return null
}

/** The date tile's side. Structure, so chromePx: it must not grow with the reader's text size. */
const DATE_TILE = 36

/**
 * The birthday as a calendar page: the month over the day, the way a desk calendar or a team's
 * schedule poster prints a date (Nov 4, 2026, ROADMAP-UI.md's audit). Today's is the birthday
 * player's club block (wpblField), so the one that matters is the one that stands out; the rest are
 * a quiet fill, and the ones already past are printed in the secondary ink.
 */
function DateTile({ b, isDark }: { b: SignBirthday | null; isDark: boolean }) {
  const today = b?.offset === 0
  const field = today ? wpblField(b.player.team_id, isDark) : null
  const month = b?.date ? new Date(`${b.date}T12:00:00`).toLocaleDateString('en-US', { month: 'short' }) : ''
  const day = b?.date ? String(Number(b.date.slice(8, 10))) : b ? '—' : ''
  const ink = field ? field.ink : b && b.offset != null && b.offset < 0 ? 'text.secondary' : 'text.primary'
  return (
    <Box aria-hidden sx={{
      flexShrink: 0, width: chromePx(DATE_TILE), height: chromePx(DATE_TILE),
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      bgcolor: field ? field.fill : 'action.hover', color: ink,
    }}>
      <Typography sx={{ ...AGATE_SX, fontSize: TYPE_SCALE.caption, textTransform: 'uppercase', letterSpacing: '0.06em', lineHeight: 1, color: ink }}>{month}</Typography>
      <Typography sx={{ fontFamily: DISPLAY_FONT, fontWeight: 700, fontSize: TYPE_SCALE.display, lineHeight: 1, fontVariantNumeric: 'tabular-nums', color: ink }}>{day}</Typography>
    </Box>
  )
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
  // signSeason's order PICKS who fits under the cap (today and the days ahead first, so a birthday
  // today never falls off the end); the grid then prints them in calendar order. In the picking
  // order the rows ran Nov 4, 9, 18, then back to Nov 2, Oct 30, Oct 25, which read as shuffled.
  // Undated players last, as signSeason lists them.
  const shown = useMemo(() => born.slice(0, SIGN_CAP).sort((a, b) =>
    (a.offset == null ? 1 : 0) - (b.offset == null ? 1 : 0) || (a.offset ?? 0) - (b.offset ?? 0)), [born])
  // The slots the sign leaves empty go to the next sign, behind a tile naming it: one held blank,
  // they were a hole as tall as three rows on a phone. Only with room for the tile and a player.
  const next = useMemo(() => nextSignSeason(players, today), [players, today])
  const nextRoom = SIGN_CAP - shown.length - 1
  const upNext = nextRoom > 0 && next.players.length > 0 ? next.players.slice(0, nextRoom) : []
  const range = `${shortMonthDay(sign.from)} – ${shortMonthDay(sign.to)}`
  const columns = Object.fromEntries(Object.entries(SIGN_COLUMNS).map(([bp, n]) => [bp, `repeat(${n}, minmax(0, 1fr))`]))
  // DOWN EACH COLUMN, THEN ACROSS, as a paper runs a list (Nov 5, 2026). Filled across, the "Next"
  // divider took one cell of a row while the cell beside it already held the next sign's first
  // player (Dec 1 beside "Next: Sagittarius"), and the dates zigzagged between the columns.
  const rows = Object.fromEntries(Object.entries(SIGN_COLUMNS).map(([bp, n]) => [bp, `repeat(${Math.ceil(SIGN_CAP / n)}, auto)`]))
  return (
    // The sign's glyph large beside the range, as a horoscope column heads itself; it was a 12px
    // glyph in the meta line.
    <SectionCard title={`${sign.name} season`} action={
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <Typography aria-hidden sx={{ fontSize: TYPE_SCALE.page, lineHeight: 1 }}>{sign.glyph}</Typography>
        <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary' }}>{range}</Typography>
      </Box>
    }>
      <Box sx={{ display: 'grid', gridTemplateColumns: columns, gridTemplateRows: rows, gridAutoFlow: 'column', columnGap: 1.5, rowGap: 0.25 }}>
        {Array.from({ length: SIGN_CAP }, (_, i) => {
          if (upNext.length && i === shown.length) {
            return (
              // A DIVIDER, NOT A PLAYER (Nov 4, 2026): a filled tile and the sign's name in the bold
              // name slot read as one more birthday in the grid. Now an unfilled tile under a rule on
              // its left, and the label leads ("Next sign") in the quiet type a row's meta uses. Same
              // box as a player row, so the grid's height does not depend on where it falls.
              <Box key="next" sx={{ display: 'flex', alignItems: 'center', gap: SIGN_GAP, py: ROW_PY }}>
                <Box aria-hidden sx={{
                  flexShrink: 0, width: chromePx(DATE_TILE), height: chromePx(DATE_TILE),
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  borderLeft: '2px solid', borderLeftColor: 'text.secondary',
                }}>
                  <Typography sx={{ fontSize: TYPE_SCALE.page, lineHeight: 1 }}>{next.sign.glyph}</Typography>
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography noWrap sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 700, color: 'text.secondary', lineHeight: 1.3 }}>Next: {next.sign.name}</Typography>
                  <Typography noWrap sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', lineHeight: 1.3 }}>
                    From {shortMonthDay(next.sign.from)}
                  </Typography>
                </Box>
              </Box>
            )
          }
          const b = i < shown.length ? shown[i] : upNext[i - shown.length - 1]
          // Before the roster: the tile and two lines, the loaded row's shape. An empty slot past
          // the sign's last player keeps its height, so the card is one height whichever sign it is.
          if (players.length === 0 || !b) {
            return (
              <Box key={i} aria-hidden sx={{ display: 'flex', alignItems: 'center', gap: SIGN_GAP, py: ROW_PY, ...(players.length ? { visibility: 'hidden' } : null) }}>
                <DateTile b={null} isDark={isDark} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Skeleton variant="text" width="70%" sx={{ fontSize: TYPE_SCALE.body, lineHeight: 1.3 }} />
                  <Skeleton variant="text" width="50%" sx={{ fontSize: TYPE_SCALE.meta, lineHeight: 1.3 }} />
                </Box>
              </Box>
            )
          }
          const club = clubMeta(b.player, teams, positions)
          const word = birthdayWord(b)
          return (
            <Box key={b.player.id} {...link(b.player)} sx={{ ...ROW_LINK_SX, gap: SIGN_GAP }}>
              <DateTile b={b} isDark={isDark} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <FittedName name={b.player.name} sx={{ fontSize: TYPE_SCALE.body, fontWeight: 700, lineHeight: 1.3 }} />
                <Typography noWrap sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', lineHeight: 1.3 }}>
                  {word && <Box component="span" sx={{ fontWeight: 800, color: 'text.primary' }}>{word}</Box>}
                  {word && club ? ' · ' : ''}{club}
                </Typography>
              </Box>
            </Box>
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
