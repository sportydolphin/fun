import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Skeleton, Typography } from '@mui/material'
import type { WpblGame, WpblPlayer, WpblTeam, WpblBattingLine, WpblPitchingLine } from '../types'
import { fetchWpblPlayerLines, fetchWpblPlayerSeasons } from '../api'
import type { WpblPlayerSeasonsRead } from '../api/players'
import { currentSeason } from '../season'
import { useWpblPlayerLink, useWpblTeamLink } from '../LinkContext'
import { wpblManagerPortraitSet, type WpblPortraitSet } from '../portraits'
import { SectionCard, TeamBadge, PlayerPortrait, FittedName, TYPE_SCALE, TAPPABLE, FOCUS_RING, hoverOnly } from '../ui'
import { sumBatting, sumPitching, plateAppearances, fmtRate, wpblQualifiers } from '../stats'
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
import { wpblFullName } from '../constants'
import { UNSTYLED_LINK, linkTo } from '../../nav'
import { linkPress } from '../../ui/interaction'
import { track, trackImpression, EVENTS } from '../../lib/analytics'
import { typePx } from '../../ui/scale'
import { nameAtStage, useLineNameFit } from '../../ui/names'
import { requestSectionScroll } from '../../lib/sectionScroll'
import { birthDateSettled } from '../derive/discordBirthdays'
import { awardManagerWinner, awardWinner, homeLeaderRows, localIsoDate, playerOfTheDay, signSeason, signGlyph, type SignBirthday } from '../derive/homePlayers'
import { useWpblSeason } from '../SeasonContext'

// The offseason Home's player cards. See derive/homePlayers.ts for why these and how each picks; this file only draws them. Every player in them is a real <a href> to the player page
// (useWpblPlayerLink), which is both the point of the cards and what lets a crawler follow them.

type OpenPlayer = (p: WpblPlayer) => void

/** The star sign card's most names. Fixed, and the card always reserves this many slots, so it is
 *  the same height before the roster lands as after whatever sign's season it is: they run from 5
 *  players to 15. */
const SIGN_CAP = 12
/** Its columns, which with SIGN_CAP set its rows: six on a phone, three on a desktop. */
const SIGN_COLUMNS = { xs: 2, sm: 3, md: 4 } as const
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

const LABEL_SX = {
  fontSize: TYPE_SCALE.micro, fontWeight: 800, letterSpacing: typePx(0.6),
  textTransform: 'uppercase', color: 'text.secondary', lineHeight: 1.3,
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
  borderRadius: 1.5, px: 0.75, ml: -0.75, py: ROW_PY, ...TAPPABLE, ...FOCUS_RING,
} as const

/** Portrait, name and one quiet line under it, with an optional right-hand end. The row height
 *  is fixed by its two lines of type, which is what the skeleton reserves. */
function PersonRow({ name, teamId, src, meta, aside, link, size = 32, gap = 1 }: {
  name: string; teamId: string | null; src?: WpblPortraitSet | null; meta: React.ReactNode
  /** Beside the link rather than inside it, since it holds links of its own. */
  aside?: React.ReactNode
  link: RowLink; size?: number
  /** Between the face and the name. The two-across star sign grid passes less. */
  gap?: number
}) {
  const row = (
    <Box {...link} sx={{ ...ROW_LINK_SX, gap, flex: 1, ...(aside ? null : { mr: -0.75 }) }}>
      <PlayerPortrait name={name} teamId={teamId} size={size} src={src} />
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
function RowSkeleton({ size = 32, gap = 1 }: { size?: number; gap?: number }) {
  return (
    <Box aria-hidden sx={{ display: 'flex', alignItems: 'center', gap, py: ROW_PY }}>
      <Skeleton variant="circular" sx={{ flexShrink: 0, width: `calc(${size}px * var(--app-chrome, 1))`, height: `calc(${size}px * var(--app-chrome, 1))` }} />
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

// ─── Player spotlight ───────────────────────────────────────────────────────────

interface Lines { batting: WpblBattingLine[]; pitching: WpblPitchingLine[] }

/** One stat in the season strip: label over value. */
function StatCell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Box sx={{ minWidth: 0, textAlign: 'center' }}>
      <Typography sx={{ ...LABEL_SX }}>{label}</Typography>
      <Typography component="div" sx={{ fontSize: TYPE_SCALE.title, fontWeight: 800, fontVariantNumeric: 'tabular-nums', lineHeight: 1.3 }}>
        {value}
      </Typography>
    </Box>
  )
}

function SeasonStrip({ player, lines, games }: { player: WpblPlayer; lines: Lines | null; games: WpblGame[] }) {
  const { fmtEra } = useEraBasis()
  // The current season's line, on Home every day of the year: a player's lines are their career, so
  // summed whole the strip would read two seasons under one year's label.
  const { season, cut, seasonGames } = useWpblSeason(games, { current: true })
  const cells = useMemo((): [string, string][] | null => {
    if (!lines) return null
    const bat = sumBatting(cut(lines.batting), seasonGames)
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
        // Two lines tall, the strip's own height, so a birthday pick who never played does not
        // shorten the card under the reader.
        <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.secondary', lineHeight: 1.3, minHeight: '2.6em', display: 'flex', alignItems: 'center' }}>
          {season != null ? `No ${season} games` : 'No games'}
        </Typography>
      ) : (
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: 0.5 }}>
          {(cells ?? ['G', '', '', '', '', ''].map(l => [l, ''] as [string, string])).map(([label, value], i) => (
            // A no-break space, not ' ': a lone space collapses, so the label row took no height
            // until the stats landed and the card grew by a line under the reader.
            <StatCell key={i} label={cells ? label : ' '}
              value={cells ? value : <Skeleton variant="text" width="70%" sx={{ mx: 'auto', fontSize: TYPE_SCALE.title }} />} />
          ))}
        </Box>
      )}
    </Box>
  )
}

const NAME_SX = { fontSize: TYPE_SCALE.display, fontWeight: 800, lineHeight: 1.2 } as const

/** One fact under the header: a small label over a value. */
function Fact({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <Box sx={{ minWidth: 0, gridColumn: wide ? '1 / -1' : undefined }}>
      <Typography sx={{ ...LABEL_SX }}>{label}</Typography>
      <Typography noWrap sx={{ fontSize: TYPE_SCALE.body, fontWeight: 600, lineHeight: 1.35 }}>{children}</Typography>
    </Box>
  )
}

export function PlayerSpotlightCard({ players, teams, games, onOpenPlayer }: {
  players: WpblPlayer[]; teams: Map<string, WpblTeam>; games: WpblGame[]; onOpenPlayer: OpenPlayer
}) {
  const today = localIsoDate()
  const pick = useMemo(() => playerOfTheDay(players, today), [players, today])
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

  const team = player?.team_id ? teams.get(player.team_id) : undefined
  // Nothing until the player's own lines land, never the roster's label first: the roster can
  // list a shortstop who has been playing second, and the line read the card as SS, then 2B.
  const position = player && own ? displayPosition(player.position, own.batting, games).label : null
  const settled = player ? birthDateSettled(player) : false
  const glyph = signGlyph(player?.zodiac_sign)
  const draft = player?.draft_round != null
    ? `Round ${player.draft_round}${player.draft_pick != null ? `, pick ${player.draft_pick}` : ''}`
    : '—'

  return (
    <SectionCard title="Player Spotlight" fill action={
      // A birthday says so here rather than as a line over the name, which would make the header a
      // line taller on the days it applies and move the card under a reader as the roster lands.
      pick?.reason === 'birthday'
        ? <Typography sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 800, color: 'var(--wpbl-accent-fg)' }}>Birthday today</Typography>
        : <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary' }}>{shortDate(today)}</Typography>
    }>
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 1.5 }}>
        {/* ONE STRUCTURE, LOADED OR NOT: the same boxes with placeholder content, so the header
            and the facts take the same height before the roster lands as after. */}
        <Box {...(player ? link(player) : { 'aria-hidden': true })} sx={{
          ...UNSTYLED_LINK, display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0,
          borderRadius: 2, p: 0.5, mx: -0.5, ...(player ? { ...TAPPABLE, ...FOCUS_RING } : null),
        }}>
          {/* The skeleton circle stays over the portrait until its face has loaded, and the face
              fades in under it. Swapped straight in, the frame painted as a bare club-colored disc
              for the beat before the photo arrived: grey, then navy, then a face, a blink. */}
          <Box sx={{ position: 'relative', flexShrink: 0 }}>
            {player
              ? <Box sx={{ opacity: faceReady ? 1 : 0, transition: 'opacity 0.25s' }}>
                  <PlayerPortrait name={player.name} teamId={player.team_id} size={72} eager onReady={onFaceReady} />
                </Box>
              : <Box sx={{ width: 'calc(72px * var(--app-chrome, 1))', height: 'calc(72px * var(--app-chrome, 1))' }} />}
            {!faceReady && <Skeleton variant="circular" sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />}
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
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
        </Box>

        {/* Hometown takes a row of its own: "Town, State, Country" wraps in half a phone's width,
            and a value that wraps only for some players would move everything under it.

            Not on a phone, where this grid made the card a full screen before the season card. The
            desktop keeps it because the season card beside it sets the row's height, and without
            the bio this card would stretch around empty space. The profile carries it either way. */}
        <Box sx={{ display: { xs: 'none', md: 'grid' }, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', columnGap: 2, rowGap: 1 }}>
          <Fact label="Hometown" wide>{player ? (player.hometown ?? '—') : <Skeleton width="50%" />}</Fact>
          <Fact label="Born">{player ? (settled ? shortDate(player.birth_date!, true) : '—') : <Skeleton width="60%" />}</Fact>
          <Fact label="Star sign">{player ? (player.zodiac_sign ? `${glyph} ${player.zodiac_sign}` : '—') : <Skeleton width="50%" />}</Fact>
          <Fact label="Age">{player ? (player.age ?? '—') : <Skeleton width="30%" />}</Fact>
          <Fact label="Bats / Throws">{player ? `${player.bats ?? '—'} / ${player.throws ?? '—'}` : <Skeleton width="40%" />}</Fact>
          <Fact label="Drafted">{player ? draft : <Skeleton width="60%" />}</Fact>
          <Fact label="Number">{player ? (player.jersey_number ? `#${player.jersey_number}` : '—') : <Skeleton width="30%" />}</Fact>
        </Box>

        {player ? <SeasonStrip player={player} lines={own} games={games} /> : <SeasonStrip player={{} as WpblPlayer} lines={null} games={games} />}

        <Box sx={{ display: 'flex', justifyContent: 'flex-end', minHeight: '1.4em' }}>
          {player && (
            <Box {...link(player)} sx={{
              ...UNSTYLED_LINK, fontSize: TYPE_SCALE.meta, fontWeight: 800, color: 'var(--wpbl-accent-fg)',
              ...hoverOnly({ textDecoration: 'underline' }), ...FOCUS_RING,
            }}>
              Full profile ›
            </Box>
          )}
        </Box>
      </Box>
    </SectionCard>
  )
}

// ─── The season's leaders and award winners ─────────────────────────────────────

/** Both cards' rows, fixed so neither moves when its read lands. Five because the ballot has five
 *  awards, and the leaders match so the two stay one height side by side. */
const SEASON_ROWS = 5

/** The Stats tab's own cards: rates gated and figures printed as that board does. More than the rows
 *  on purpose, in reading order: one player can lead most of these in a short season, and those past
 *  the fifth row are how the card still names five (homeLeaderRows). */
const LEADER_STATS: { side: LeaderSide; key: string }[] = [
  { side: 'overall', key: 'war' }, { side: 'hitting', key: 'avg' }, { side: 'hitting', key: 'hr' },
  { side: 'pitching', key: 'era' }, { side: 'pitching', key: 'so' },
  { side: 'hitting', key: 'sb' }, { side: 'pitching', key: 'ip' }, { side: 'hitting', key: 'rbi' },
  { side: 'hitting', key: 'r' }, { side: 'pitching', key: 'w' },
]

/** The Stats tab's Players board sorted by a stat, the address its own leader cards "See all" to. */
const statBoardPath = (side: LeaderSide, key: string): string =>
  `${STATS_PATH}?board=players${side === 'hitting' ? '' : `&side=${side}`}&sort=${key}`

const trackCardLink = (card: string, target: string) => track(EVENTS.WPBL_HOME_CARD_LINK, { card, target })

/** Reaches past the 17px of type to the height of a tap target, without moving the header. */
const TAP_AREA_SX = {
  position: 'relative', '&::after': { content: '""', position: 'absolute', inset: '-14px 0' },
} as const

function CardLink({ link, label }: { link: { component: 'a'; href: string; onClick: (e: React.MouseEvent) => void }; label: string }) {
  return (
    <Box {...link} sx={{
      ...UNSTYLED_LINK, ...TAP_AREA_SX, fontSize: TYPE_SCALE.meta, fontWeight: 800, color: 'var(--wpbl-accent-fg)',
      ...hoverOnly({ textDecoration: 'underline' }), ...FOCUS_RING,
    }}>
      {label}
    </Box>
  )
}

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

/** Overlap between the tied faces, enough to read as one row without hiding the second face. */
const TIED_FACE_OVERLAP = -1.25

/**
 * The players tied for a stat, two named and any others counted: "D. Benites, K. Whitmore". Each is
 * its own link, so the row is not one tap target as the others are. Names fit as a line together
 * (useLineNameFit), since a tie has no name that owns a width of its own.
 */
function TiedRow({ players, link, meta, aside }: {
  players: WpblPlayer[]; link: ReturnType<typeof useTrackedPlayerLink>; meta: string; aside: React.ReactNode
}) {
  const named = players.slice(0, 2)
  const others = players.length - named.length
  const { ref, stage } = useLineNameFit<HTMLDivElement>(named.map(p => p.name))
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1, minWidth: 0, py: ROW_PY }}>
        <Box sx={{ display: 'flex', flexShrink: 0 }}>
          {named.map((p, i) => (
            // The name beside it is the same link for a keyboard or a screen reader.
            <Box key={p.id} {...link(p)} aria-hidden tabIndex={-1}
              sx={{ ...UNSTYLED_LINK, display: 'flex', borderRadius: '50%', ml: i ? TIED_FACE_OVERLAP : 0, ...hoverOnly({ zIndex: 1 }) }}>
              <PlayerPortrait name={p.name} teamId={p.team_id} size={32} />
            </Box>
          ))}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box ref={ref} sx={{
            fontSize: TYPE_SCALE.body, fontWeight: 700, lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {named.map((p, i) => (
              <Fragment key={p.id}>
                {i > 0 && ', '}
                <Box component="a" {...link(p)} sx={{ ...UNSTYLED_LINK, ...hoverOnly({ textDecoration: 'underline' }), ...FOCUS_RING }}>
                  {nameAtStage(p.name, stage)}
                </Box>
              </Fragment>
            ))}
            {others > 0 && ` +${others}`}
          </Box>
          <Typography noWrap sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', lineHeight: 1.3 }}>{meta}</Typography>
        </Box>
      </Box>
      {aside}
    </Box>
  )
}

/**
 * The season's leaders in the headline stats, off the stored season rows: the one small read that
 * can rank the league, so the offseason Home still never touches the box-score lines. Rows that have
 * gone stale read "No data" rather than bringing those lines back; a correction leaves them stale
 * only until the job's next run, and the Stats tab one tap away has its own fallback.
 */
export function SeasonLeadersCard({ players, teams, games, onOpenPlayer, rosterFailed }: {
  players: WpblPlayer[]; teams: Map<string, WpblTeam>; games: WpblGame[]; onOpenPlayer: OpenPlayer
  /** The roster's read has answered with nothing: there is nobody to name, and never will be. */
  rosterFailed?: boolean
}) {
  const { basis: eraBasis, fmtEra } = useEraBasis()
  const { season, seasonGames } = useWpblSeason(games, { current: true })
  const link = useTrackedPlayerLink('leaders', onOpenPlayer)
  const [read, setRead] = useState<WpblPlayerSeasonsRead | null>(null)
  useEffect(() => {
    if (season == null) return
    let live = true
    fetchWpblPlayerSeasons(season)
      .then(r => { if (live) setRead(r) })
      .catch(() => { if (live) setRead({ rows: [], current: false }) })
    return () => { live = false }
  }, [season])

  const rows = useMemo(() => {
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
    return homeLeaderRows(LEADER_STATS.map(({ side, key }) => ({
      stat: { side, key, title: LEADER_CARDS[side].find(c => c.key === key)?.title ?? key },
      leaders: side === 'overall' ? leaders(view.value, OVR_COLS, side, key)
        : side === 'hitting' ? leaders(batting, hit, side, key) : leaders(pitching, pit, side, key),
    })), SEASON_ROWS)
  }, [read, players, teams, seasonGames, fmtEra, eraBasis])
  useShown('leaders', !!rows?.length)

  const failed = (read != null && !read.current) || rows?.length === 0 || (!!rosterFailed && !rows)
  return (
    // The year before the schedule lands too: a title needs no data, and the only season this card
    // can be drawn for until 2027 is the ballot's.
    <SectionCard title={`${season ?? AWARDS_SEASON} Leaders`} fill action={
      <CardLink link={linkTo(STATS_PATH, () => trackCardLink('leaders', 'all'))} label="All leaders ›" />
    }>
      {failed
        ? <NoDataRows />
        : Array.from({ length: SEASON_ROWS }, (_, i) => {
            const r = rows?.[i]
            if (!rows) return <RowSkeleton key={i} />
            if (!r) return <Box key={i} aria-hidden sx={{ visibility: 'hidden' }}><RowSkeleton /></Box>
            const key = r.stats[0].stat.key
            const titles = r.stats.map(s => s.stat.title).join(' · ')
            const aside = (
              <Box sx={ROW_ASIDE_SX}>
                {r.stats.map(({ stat, text }) => (
                  <RowValue key={stat.key} label={`${stat.title} ${text}`}
                    link={linkTo(statBoardPath(stat.side, stat.key), () => trackCardLink('leaders', stat.key))}>
                    {text}
                  </RowValue>
                ))}
              </Box>
            )
            return r.players.length > 1
              ? <TiedRow key={key} players={r.players} link={link} meta={`${titles} · Tied`} aside={aside} />
              : <PlayerRow key={key} player={r.players[0]} link={link(r.players[0])} meta={titles} aside={aside} />
          })}
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
    <SectionCard title={`${AWARDS_SEASON} Fan Award Winners`} fill action={
      <CardLink link={linkPress(WPBL_AWARDS_PATH, () => { trackCardLink('winners', 'all'); onOpenAwards?.() })} label="All results ›" />
    }>
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
  const positions = useStoredPositions(games)
  const today = localIsoDate()
  const { sign, players: born } = useMemo(() => signSeason(players, today), [players, today])
  const link = useTrackedPlayerLink('sign', onOpenPlayer)
  useShown('sign', born.length > 0)
  const shown = born.slice(0, SIGN_CAP)
  const range = `${shortMonthDay(sign.from)} – ${shortMonthDay(sign.to)}`
  const columns = Object.fromEntries(Object.entries(SIGN_COLUMNS).map(([bp, n]) => [bp, `repeat(${n}, minmax(0, 1fr))`]))
  return (
    <SectionCard title={`${sign.name} season`} action={
      <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary' }}>{sign.glyph} {range}</Typography>
    }>
      <Box sx={{ display: 'grid', gridTemplateColumns: columns, columnGap: 1 }}>
        {Array.from({ length: SIGN_CAP }, (_, i) => {
          if (players.length === 0) return <RowSkeleton key={i} size={SIGN_FACE} gap={SIGN_GAP} />
          const b = shown[i]
          // An empty slot keeps the row a sign with few players would otherwise give back, so
          // the card is one height whichever sign's season it is.
          if (!b) return <Box key={i} aria-hidden />
          const club = clubMeta(b.player, teams, positions)
          return (
            <PlayerRow key={b.player.id} player={b.player} link={link(b.player)} size={SIGN_FACE} gap={SIGN_GAP}
              meta={<>
                {b.date && (
                  <Box component="span" sx={{ fontWeight: b.offset === 0 ? 800 : 600, color: b.offset === 0 ? 'var(--wpbl-accent-fg)' : 'text.primary' }}>
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
