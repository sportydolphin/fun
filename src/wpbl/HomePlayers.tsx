import { useEffect, useMemo, useRef, useState } from 'react'
import { Box, Skeleton, Typography } from '@mui/material'
import type { WpblGame, WpblPlayer, WpblTeam, WpblBattingLine, WpblPitchingLine } from './types'
import { fetchWpblPlayerLines } from './api'
import { useWpblPlayerLink } from './LinkContext'
import { SectionCard, TeamBadge, PlayerPortrait, FittedName, TYPE_SCALE, TAPPABLE, FOCUS_RING, hoverOnly } from './ui'
import { sumBatting, sumPitching, plateAppearances, fmtRate } from './stats'
import { useEraBasis } from './EraBasisContext'
import { outsToIp } from './innings'
import { displayPosition, leadsWithPitching } from './positions'
import { wpblFullName } from './constants'
import { WPBL_LEAGUE_PAGE } from './routes'
import { linkTo, UNSTYLED_LINK } from '../nav'
import { track, trackImpression, EVENTS } from '../lib/analytics'
import { typePx } from '../ui/scale'
import { useIsAdmin } from '../lib/admin'
import { birthDateSettled } from './derive/discordBirthdays'
import {
  localIsoDate, playerOfTheDay, upcomingBirthdays, signSeason, signGlyph, hometownOfTheDay,
  type UpcomingBirthday,
} from './derive/homePlayers'

// The offseason Home's player cards. See derive/homePlayers.ts for why these four and how each
// picks; this file only draws them. Every player in them is a real <a href> to the player page
// (useWpblPlayerLink), which is both the point of the cards and what lets a crawler follow them.

type OpenPlayer = (p: WpblPlayer) => void

/**
 * Whether this reader gets the new offseason Home with these cards on it. The site owner only, for
 * now, while it is looked at on real data; everyone else keeps the old layout. A LAYOUT PREVIEW,
 * NOT A GATE ON ANY ONE CARD: both layouts draw the fan ballot (routes.test.ts pins that), so
 * deleting this to ship the new Home is a one-line change in Home.tsx.
 */
export function useNewOffseasonHome(): boolean {
  return useIsAdmin()
}

/** How many rows each list card holds. One number for the three so they are about the same
 *  height side by side, and so the skeleton can reserve exactly that. */
export const HOME_PLAYER_ROWS = 5
/** The star-sign card's cap: two columns of HOME_PLAYER_ROWS. */
const SIGN_CAP = HOME_PLAYER_ROWS * 2

/** The player-link props for a row, with the card's own tap recorded first. */
function useTrackedPlayerLink(card: string, onOpenPlayer: OpenPlayer) {
  const playerLink = useWpblPlayerLink()
  return (p: WpblPlayer) => {
    const link = playerLink(p, onOpenPlayer) as { onClick?: (e: React.MouseEvent) => void }
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

/** Portrait, name and one quiet line under it, with an optional right-hand end. The row height
 *  is fixed by its two lines of type, which is what the skeleton reserves. */
function PlayerRow({ player, meta, end, link, size = 32 }: {
  player: WpblPlayer; meta: React.ReactNode; end?: React.ReactNode
  link: ReturnType<ReturnType<typeof useTrackedPlayerLink>>; size?: number
}) {
  return (
    <Box {...link} sx={{
      ...UNSTYLED_LINK, display: 'flex', alignItems: 'center', gap: 1, minWidth: 0,
      borderRadius: 1.5, px: 0.75, mx: -0.75, py: 0.5, ...TAPPABLE, ...FOCUS_RING,
    }}>
      <PlayerPortrait name={player.name} teamId={player.team_id} size={size} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <FittedName name={player.name} sx={{ fontSize: TYPE_SCALE.body, fontWeight: 700, lineHeight: 1.3 }} />
        <Typography noWrap sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', lineHeight: 1.3 }}>{meta}</Typography>
      </Box>
      {end && <Box sx={{ flexShrink: 0, textAlign: 'right' }}>{end}</Box>}
    </Box>
  )
}

/** A row that is not here yet, the same two lines tall. */
function RowSkeleton({ size = 32 }: { size?: number }) {
  return (
    <Box aria-hidden sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5 }}>
      <Skeleton variant="circular" sx={{ flexShrink: 0, width: `calc(${size}px * var(--app-chrome, 1))`, height: `calc(${size}px * var(--app-chrome, 1))` }} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Skeleton variant="text" width="60%" sx={{ fontSize: TYPE_SCALE.body, lineHeight: 1.3 }} />
        <Skeleton variant="text" width="40%" sx={{ fontSize: TYPE_SCALE.meta, lineHeight: 1.3 }} />
      </Box>
    </Box>
  )
}

function clubMeta(p: WpblPlayer, teams: Map<string, WpblTeam>): string {
  const team = p.team_id ? teams.get(p.team_id) : undefined
  return [team?.abbr, p.position].filter(Boolean).join(' · ')
}

// ─── Player of the day ──────────────────────────────────────────────────────────

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
  const cells = useMemo((): [string, string][] | null => {
    if (!lines) return null
    const bat = sumBatting(lines.batting, games)
    const pit = sumPitching(lines.pitching, games)
    const pa = plateAppearances(bat)
    const hasBatting = pa > 0
    const hasPitching = pit.outs > 0 || pit.bf > 0
    if (!hasBatting && !hasPitching) return []
    if (leadsWithPitching({ position: player.position, hasBatting, hasPitching, gs: pit.gs, bf: pit.bf, pa })) {
      return [
        ['G', String(pit.g)], ['IP', outsToIp(pit.outs)], ['ERA', fmtEra(pit.era)],
        ['K', String(pit.so)], ['WHIP', pit.whip == null ? '—' : pit.whip.toFixed(2)], ['W-L', `${pit.w}–${pit.l}`],
      ]
    }
    return [
      ['G', String(bat.g)], ['AVG', fmtRate(bat.avg)], ['OBP', fmtRate(bat.obp)],
      ['SLG', fmtRate(bat.slg)], ['HR', String(bat.hr)], ['RBI', String(bat.rbi)],
    ]
  }, [lines, games, player.position, fmtEra])

  return (
    <Box>
      <Typography sx={{ ...LABEL_SX, mb: 0.5 }}>2026 regular season</Typography>
      {cells && cells.length === 0 ? (
        // Two lines tall, the strip's own height, so a birthday pick who never played does not
        // shorten the card under the reader.
        <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.secondary', lineHeight: 1.3, minHeight: '2.6em', display: 'flex', alignItems: 'center' }}>
          Did not appear in a 2026 game.
        </Typography>
      ) : (
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: 0.5 }}>
          {(cells ?? ['G', '', '', '', '', ''].map(l => [l, ''] as [string, string])).map(([label, value], i) => (
            <StatCell key={i} label={cells ? label : ' '}
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

export function PlayerOfTheDayCard({ players, teams, games, onOpenPlayer }: {
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

  const team = player?.team_id ? teams.get(player.team_id) : undefined
  const position = player
    ? (own ? displayPosition(player.position, own.batting, games).label : player.position)
    : null
  const settled = player ? birthDateSettled(player) : false
  const glyph = signGlyph(player?.zodiac_sign)
  const draft = player?.draft_round != null
    ? `Round ${player.draft_round}${player.draft_pick != null ? `, pick ${player.draft_pick}` : ''}`
    : '—'

  return (
    <SectionCard title="Player of the day" fill action={
      // A birthday says so here rather than as a line over the name, which would make the header a
      // line taller on the days it applies and move the card under a reader as the roster lands.
      pick?.reason === 'birthday'
        ? <Typography sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 800, color: 'var(--wpbl-accent-fg)' }}>🎂 Birthday today</Typography>
        : <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary' }}>{shortDate(today)}</Typography>
    }>
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 1.5 }}>
        {/* ONE STRUCTURE, LOADED OR NOT: the same boxes with placeholder content, so the header
            and the facts take the same height before the roster lands as after. */}
        <Box {...(player ? link(player) : { 'aria-hidden': true })} sx={{
          ...UNSTYLED_LINK, display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0,
          borderRadius: 2, p: 0.5, mx: -0.5, ...(player ? { ...TAPPABLE, ...FOCUS_RING } : null),
        }}>
          {player
            ? <PlayerPortrait name={player.name} teamId={player.team_id} size={72} />
            : <Skeleton variant="circular" sx={{ flexShrink: 0, width: 'calc(72px * var(--app-chrome, 1))', height: 'calc(72px * var(--app-chrome, 1))' }} />}
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
            and a value that wraps only for some players would move everything under it. */}
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', columnGap: 2, rowGap: 1 }}>
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

// ─── Birthdays ──────────────────────────────────────────────────────────────────

function birthdayWhen(b: UpcomingBirthday): string {
  if (b.offset === 0) return 'Today 🎂'
  if (b.offset === -1) return 'Yesterday'
  if (b.offset === 1) return 'Tomorrow'
  return shortDate(b.date)
}

export function BirthdaysCard({ players, teams, onOpenPlayer }: {
  players: WpblPlayer[]; teams: Map<string, WpblTeam>; onOpenPlayer: OpenPlayer
}) {
  const today = localIsoDate()
  const list = useMemo(() => upcomingBirthdays(players, today, { limit: HOME_PLAYER_ROWS }), [players, today])
  const link = useTrackedPlayerLink('birthdays', onOpenPlayer)
  useShown('birthdays', list.length > 0)
  return (
    <SectionCard title="Birthdays" fill>
      <Box>
        {players.length === 0
          ? Array.from({ length: HOME_PLAYER_ROWS }, (_, i) => <RowSkeleton key={i} />)
          : list.map(b => (
            <PlayerRow key={b.player.id + b.date} player={b.player} link={link(b.player)}
              meta={clubMeta(b.player, teams)}
              end={<>
                <Typography sx={{ fontSize: TYPE_SCALE.meta, fontWeight: b.offset === 0 ? 800 : 600, lineHeight: 1.3, color: b.offset === 0 ? 'var(--wpbl-accent-fg)' : 'text.primary' }}>
                  {birthdayWhen(b)}
                </Typography>
                <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', lineHeight: 1.3 }}>
                  {b.age == null ? ' ' : b.offset < 0 ? `turned ${b.age}` : `turns ${b.age}`}
                </Typography>
              </>} />
          ))}
      </Box>
    </SectionCard>
  )
}

// ─── Star sign ──────────────────────────────────────────────────────────────────

export function StarSignCard({ players, teams, onOpenPlayer }: {
  players: WpblPlayer[]; teams: Map<string, WpblTeam>; onOpenPlayer: OpenPlayer
}) {
  const today = localIsoDate()
  const { sign, players: born } = useMemo(() => signSeason(players, today), [players, today])
  const link = useTrackedPlayerLink('sign', onOpenPlayer)
  useShown('sign', born.length > 0)
  const shown = born.slice(0, SIGN_CAP)
  const range = `${shortMonthDay(sign.from)} – ${shortMonthDay(sign.to)}`
  return (
    <SectionCard title={`${sign.name} season`} fill action={
      <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary' }}>{range}</Typography>
    }>
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 1 }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', columnGap: 1.5 }}>
          {players.length === 0
            ? Array.from({ length: SIGN_CAP }, (_, i) => <RowSkeleton key={i} size={28} />)
            : shown.map(p => (
              <PlayerRow key={p.id} player={p} link={link(p)} size={28}
                meta={clubMeta(p, teams)} />
            ))}
        </Box>
        <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', minHeight: '1.4em' }}>
          {players.length === 0 ? ' '
            : `${sign.glyph} ${born.length} ${born.length === 1 ? sign.name : `${sign.name}s`} on the roster.`}
        </Typography>
      </Box>
    </SectionCard>
  )
}

/** 'MM-DD' as "Sep 23". */
function shortMonthDay(md: string): string {
  return new Date(`2026-${md}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ─── Hometowns ──────────────────────────────────────────────────────────────────

/** The town in "Town, State, Country", or null when the hometown is no more than its region. */
function townOf(hometown: string | null): string | null {
  const parts = (hometown ?? '').split(',').map(s => s.trim()).filter(Boolean)
  return parts.length > 2 ? parts.slice(0, -2).join(', ') : null
}

export function HometownCard({ players, teams, onOpenPlayer }: {
  players: WpblPlayer[]; teams: Map<string, WpblTeam>; onOpenPlayer: OpenPlayer
}) {
  const today = localIsoDate()
  const spot = useMemo(() => hometownOfTheDay(players, today), [players, today])
  const link = useTrackedPlayerLink('hometown', onOpenPlayer)
  useShown('hometown', !!spot)
  const league = linkTo(WPBL_LEAGUE_PAGE)
  const rows = spot?.players.slice(0, HOME_PLAYER_ROWS - 1) ?? []
  const more = spot ? spot.players.length - rows.length : 0
  return (
    <SectionCard title="Hometowns" fill action={
      <Box {...league} sx={{
        ...UNSTYLED_LINK, fontSize: TYPE_SCALE.meta, fontWeight: 800, color: 'var(--wpbl-accent-fg)',
        ...hoverOnly({ textDecoration: 'underline' }), ...FOCUS_RING,
      }}>All ›</Box>
    }>
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 1 }}>
        <Box>
          {/* The place, a row tall, so the list under it lines up with the birthdays beside it. */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5, minHeight: `calc(32px * var(--app-chrome, 1) + 8px)` }}>
            {spot ? (
              <>
                {/* A pin, not the country's flag: Windows has no flag emoji and draws the two
                    letters of the code instead, which read as a stray "CA" at this size. */}
                <Typography aria-hidden sx={{ fontSize: TYPE_SCALE.display, lineHeight: 1 }}>📍</Typography>
                <Box sx={{ minWidth: 0 }}>
                  <Typography noWrap sx={{ fontSize: TYPE_SCALE.body, fontWeight: 800, lineHeight: 1.3 }}>{spot.region}</Typography>
                  <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', lineHeight: 1.3 }}>
                    {spot.players.length} players call it home
                  </Typography>
                </Box>
              </>
            ) : <Skeleton variant="text" width="60%" sx={{ fontSize: TYPE_SCALE.body }} />}
          </Box>
          {players.length === 0
            ? Array.from({ length: HOME_PLAYER_ROWS - 1 }, (_, i) => <RowSkeleton key={i} />)
            : rows.map(p => {
              // The town alone: the region is the heading. A hometown that IS the region ("Perth,
              // Australia") has nothing left to say, so that row shows the club alone.
              const town = townOf(p.hometown)
              return (
                <PlayerRow key={p.id} player={p} link={link(p)}
                  meta={[town, clubMeta(p, teams)].filter(Boolean).join(' · ')} />
              )
            })}
        </Box>
        <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', minHeight: '1.4em' }}>
          {more > 0 ? `And ${more} more from ${spot?.region.split(',')[0]}.` : ' '}
        </Typography>
      </Box>
    </SectionCard>
  )
}
