import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Skeleton, Typography } from '@mui/material'
import type { WpblGame, WpblPlayer, WpblTeam, WpblBattingLine, WpblPitchingLine } from '../types'
import { fetchWpblPlayerLines } from '../api'
import { useWpblPlayerLink } from '../LinkContext'
import { SectionCard, TeamBadge, PlayerPortrait, FittedName, TYPE_SCALE, TAPPABLE, FOCUS_RING, hoverOnly } from '../ui'
import { sumBatting, sumPitching, plateAppearances, fmtRate } from '../stats'
import { useEraBasis } from '../EraBasisContext'
import { outsToIp } from '../innings'
import { displayPosition, leadsWithPitching, playedPosition } from '../positions'
import { wpblFullName } from '../constants'
import { UNSTYLED_LINK } from '../../nav'
import { track, trackImpression, EVENTS } from '../../lib/analytics'
import { typePx } from '../../ui/scale'
import { birthDateSettled } from '../derive/discordBirthdays'
import { localIsoDate, playerOfTheDay, signSeason, signGlyph, type SignBirthday } from '../derive/homePlayers'
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
function PlayerRow({ player, meta, end, link, size = 32, gap = 1 }: {
  player: WpblPlayer; meta: React.ReactNode; end?: React.ReactNode
  link: ReturnType<ReturnType<typeof useTrackedPlayerLink>>; size?: number
  /** Between the face and the name. The two-across star sign grid passes less. */
  gap?: number
}) {
  return (
    <Box {...link} sx={{
      ...UNSTYLED_LINK, display: 'flex', alignItems: 'center', gap, minWidth: 0,
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
function RowSkeleton({ size = 32, gap = 1 }: { size?: number; gap?: number }) {
  return (
    <Box aria-hidden sx={{ display: 'flex', alignItems: 'center', gap, py: 0.5 }}>
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
  // Keyed to the player, so a new pick (the date turning over) waits for its own face.
  const [faceFor, setFaceFor] = useState<string | null>(null)
  const playerId = player?.id ?? null
  const onFaceReady = useCallback(() => setFaceFor(playerId), [playerId])
  const faceReady = !!player && faceFor === player.id

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

// ─── Star sign, with birthdays ──────────────────────────────────────────────────

/** "Oct 16", or how near it is when that says more. */
function birthdayLabel(b: SignBirthday): string {
  if (b.offset === 0) return 'Today'
  if (b.offset === 1) return 'Tomorrow'
  if (b.offset === -1) return 'Yesterday'
  return b.date ? shortMonthDay(b.date.slice(5)) : ''
}

export function StarSignCard({ players, teams, onOpenPlayer }: {
  players: WpblPlayer[]; teams: Map<string, WpblTeam>; onOpenPlayer: OpenPlayer
}) {
  const today = localIsoDate()
  const { sign, players: born } = useMemo(() => signSeason(players, today), [players, today])
  const link = useTrackedPlayerLink('sign', onOpenPlayer)
  useShown('sign', born.length > 0)
  const shown = born.slice(0, SIGN_CAP)
  const range = `${shortMonthDay(sign.from)} – ${shortMonthDay(sign.to)}`
  const columns = Object.fromEntries(Object.entries(SIGN_COLUMNS).map(([bp, n]) => [bp, `repeat(${n}, minmax(0, 1fr))`]))
  return (
    <SectionCard title={`${sign.name} season`} action={
      <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary' }}>{range}</Typography>
    }>
      <Box sx={{ display: 'grid', gridTemplateColumns: columns, columnGap: 1 }}>
        {Array.from({ length: SIGN_CAP }, (_, i) => {
          if (players.length === 0) return <RowSkeleton key={i} size={SIGN_FACE} gap={SIGN_GAP} />
          const b = shown[i]
          // An empty slot keeps the row a sign with few players would otherwise give back, so
          // the card is one height whichever sign's season it is.
          if (!b) return <Box key={i} aria-hidden />
          const club = clubMeta(b.player, teams)
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
      <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', mt: 1, minHeight: '1.4em' }}>
        {players.length === 0 ? ' '
          : `${sign.glyph} ${born.length} ${born.length === 1 ? sign.name : `${sign.name}s`} on the roster${born.length > shown.length ? `, the first ${shown.length} shown` : ''}.`}
      </Typography>
    </SectionCard>
  )
}

/** 'MM-DD' as "Sep 23". */
function shortMonthDay(md: string): string {
  return new Date(`2026-${md}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
