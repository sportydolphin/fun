import { useEffect, useMemo, useRef, useState } from 'react'
import { Box, Typography, CircularProgress } from '@mui/material'
import { fetchWpblAllPlayers, fetchWpblAllLines, fetchWpblAllPlays, fetchWpblAllTracking, computeStandings } from './api'
import { WPBL_ACCENT, wpblColor, wpblAccent, wpblFullName, formatGameTime, gameStartMs } from './constants'
import { SectionCard, SectionLabel, TeamBadge, PlayerPortrait, ModalShell, useWpblDark, useWpblName, CARD_BORDER } from './ui'
import { LiveHero } from './Live'
import {
  aggregateBatting, aggregatePitching, qualifiersActive, fmtRate, fmtTwo,
  type WpblBatSeason, type WpblPitSeason, type WpblBattingTotals, type WpblPitchingTotals,
} from './stats'
import { aggregateTracking, type TrackingBoard } from './tracking'
import { useUnits } from '../UnitsContext'
import { fmtSpeed, fmtDistance, speedUnit, distanceUnit } from '../lib/units'
import { computeFirsts, type WpblFirst } from './firsts'
import type { WpblTeam, WpblPlayer, WpblGame, WpblGamePlay, WpblBattingLine, WpblPitchingLine, WpblTrackRow } from './types'

// WPBL home dashboard (Phase 2). Mirrors the MLB home: a full-width scoreboard strip
// on top, then a two-column card feed (The League / Around the League) that stacks on
// mobile. All content is built from existing WPBL data — schedule, standings, and
// season totals aggregated from box-score lines.

// Qualifiers for rate leaders early in a short (~6 week) season.
const MIN_AB = 5
const MIN_OUTS = 9 // 3 IP

// ─── Scoreboard ─────────────────────────────────────────────────────────────────

function GameChip({ game, teams, onOpen }: { game: WpblGame; teams: Map<string, WpblTeam>; onOpen: () => void }) {
  const away = teams.get(game.away_team_id)
  const home = teams.get(game.home_team_id)
  const final = game.status === 'final' && game.home_score != null && game.away_score != null
  const live = game.status === 'live'
  const awayWon = final && (game.away_score ?? 0) > (game.home_score ?? 0)
  const homeWon = final && (game.home_score ?? 0) > (game.away_score ?? 0)

  const now = new Date()
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const dateText = game.game_date === todayStr
    ? 'Today'
    : new Date(`${game.game_date}T00:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' })
  const timeText = formatGameTime(game.game_date, game.start_time)
  const statusText = final
    ? `Final${game.innings && game.innings !== 7 ? `/${game.innings}` : ''}`
    : live ? 'Live'
    : timeText ? `${dateText} · ${timeText}` : dateText

  const row = (t: WpblTeam | undefined, score: number | null, won: boolean) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
      {t && <TeamBadge team={t} size={20} />}
      <Typography sx={{ flex: 1, fontSize: '0.8rem', fontWeight: won ? 800 : 600 }}>{t?.abbr ?? '?'}</Typography>
      {(final || live) && (
        <Typography sx={{ fontSize: '0.85rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: won ? 'text.primary' : 'text.secondary' }}>
          {score ?? '—'}
        </Typography>
      )}
    </Box>
  )

  return (
    <Box onClick={onOpen} sx={{
      flexShrink: 0, width: 132, cursor: 'pointer', scrollSnapAlign: 'start',
      borderRadius: 2, border: '1px solid', borderColor: CARD_BORDER, bgcolor: 'background.paper',
      p: 1, display: 'flex', flexDirection: 'column', gap: 0.6,
      transition: 'border-color 0.15s', '&:hover': { borderColor: 'text.disabled' },
    }}>
      <Typography sx={{ fontSize: '0.62rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5, color: live ? '#ef4444' : 'text.secondary' }}>
        {statusText}
      </Typography>
      {row(away, game.away_score, awayWon)}
      {row(home, game.home_score, homeWon)}
    </Box>
  )
}

function Scoreboard({ games, teams, onOpenGame }: {
  games: WpblGame[]; teams: Map<string, WpblTeam>; onOpenGame: (g: WpblGame) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  // Keep the strip relevant: the last few finals, then everything still to come. Anchor on
  // the most recent final so the strip opens scrolled to the "now" boundary — previous game
  // at the left edge, the next/live game right beside it — rather than the oldest final.
  const { strip, anchorIndex } = useMemo(() => {
    const played = games.filter(g => g.status === 'final')
    const rest = games.filter(g => g.status !== 'final')
    const head = played.slice(-3)
    return { strip: [...head, ...rest.slice(0, 7)], anchorIndex: head.length > 0 ? head.length - 1 : 0 }
  }, [games])

  // Position the anchor chip at the container's left edge. Measures the real DOM node
  // (robust to chip width / gap changes) and moves only the strip's own scroll, not the page.
  useEffect(() => {
    const c = scrollRef.current
    const anchor = c?.children[anchorIndex] as HTMLElement | undefined
    if (!c || !anchor) return
    c.scrollLeft += anchor.getBoundingClientRect().left - c.getBoundingClientRect().left
  }, [strip, anchorIndex])

  if (strip.length === 0) return null
  return (
    <Box sx={{ mb: 2 }}>
      <SectionLabel>Scoreboard</SectionLabel>
      <Box ref={scrollRef} sx={{
        display: 'flex', gap: 1, overflowX: 'auto', pb: 0.5,
        scrollSnapType: 'x proximity',
        '&::-webkit-scrollbar': { display: 'none' },
        msOverflowStyle: 'none', scrollbarWidth: 'none',
      }} data-swipe-ignore="true">
        {strip.map(g => <GameChip key={g.id} game={g} teams={teams} onOpen={() => onOpenGame(g)} />)}
      </Box>
    </Box>
  )
}

// ─── Next game + countdown ───────────────────────────────────────────────────────

function Countdown({ target }: { target: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const diff = target - now
  if (diff <= 0) {
    return <Typography sx={{ textAlign: 'center', fontSize: '0.9rem', fontWeight: 800, color: WPBL_ACCENT, mt: 1.25 }}>Starting soon</Typography>
  }
  const d = Math.floor(diff / 86400000)
  const h = Math.floor((diff % 86400000) / 3600000)
  const m = Math.floor((diff % 3600000) / 60000)
  const s = Math.floor((diff % 60000) / 1000)
  // Days-scale hides seconds (pointless that far out); inside a day, show the seconds tick.
  const units: [string, number][] = d > 0 ? [['Days', d], ['Hrs', h], ['Min', m]] : [['Hrs', h], ['Min', m], ['Sec', s]]
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', gap: 1, mt: 1.25 }}>
      {units.map(([label, val]) => (
        <Box key={label} sx={{ textAlign: 'center', minWidth: 54, px: 1, py: 0.75, borderRadius: 1.5, bgcolor: 'action.hover' }}>
          <Typography sx={{ fontSize: '1.35rem', fontWeight: 800, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{String(val).padStart(2, '0')}</Typography>
          <Typography sx={{ fontSize: '0.55rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'text.secondary', mt: 0.3 }}>{label}</Typography>
        </Box>
      ))}
    </Box>
  )
}

function NextGameCard({ games, teams, onOpenGame }: {
  games: WpblGame[]; teams: Map<string, WpblTeam>; onOpenGame: (g: WpblGame) => void
}) {
  const next = useMemo(() => {
    const now = Date.now()
    const upcoming = games
      .filter(g => g.status !== 'final' && g.status !== 'live')
      .map(g => ({ g, ms: gameStartMs(g.game_date, g.start_time) }))
      .filter((x): x is { g: WpblGame; ms: number } => x.ms != null)
      .sort((a, b) => a.ms - b.ms)
    // The soonest game still ahead (small grace window), else the earliest upcoming.
    return upcoming.find(x => x.ms >= now - 3 * 3600000) ?? upcoming[0] ?? null
  }, [games])

  if (!next) return null
  const g = next.g
  const away = teams.get(g.away_team_id)
  const home = teams.get(g.home_team_id)
  const dateLabel = new Date(`${g.game_date}T00:00:00`).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
  const timeLabel = formatGameTime(g.game_date, g.start_time)

  const teamRow = (t: WpblTeam | undefined, side: string) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      {t && <TeamBadge team={t} size={26} />}
      <Typography sx={{ flex: 1, fontSize: '0.9rem', fontWeight: 600 }}>{t ? wpblFullName(t) : '?'}</Typography>
      <Typography sx={{ fontSize: '0.62rem', fontWeight: 700, color: 'text.secondary' }}>{side}</Typography>
    </Box>
  )

  return (
    <SectionCard title="Next game" subtitle={`${dateLabel}${timeLabel ? ` · ${timeLabel}` : ''}`}>
      <Box onClick={() => onOpenGame(g)} sx={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 0.75, borderRadius: 1, p: 0.5, mx: -0.5, '&:hover': { bgcolor: 'action.hover' } }}>
        {teamRow(away, 'AWAY')}
        {teamRow(home, 'HOME')}
      </Box>
      <Countdown target={next.ms} />
    </SectionCard>
  )
}

// ─── Standings card ─────────────────────────────────────────────────────────────

function StandingsCard({ teams, games, onOpenTeam }: {
  teams: WpblTeam[]; games: WpblGame[]; onOpenTeam: (t: WpblTeam) => void
}) {
  const rows = useMemo(() => computeStandings(teams, games), [teams, games])
  return (
    <SectionCard title="Standings">
      <Box sx={{ display: 'flex', px: 0.5, pb: 0.5, fontSize: '0.62rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5, color: 'text.secondary' }}>
        <Box sx={{ flex: 1 }}>Team</Box>
        <Box sx={{ width: 32, textAlign: 'right' }}>W</Box>
        <Box sx={{ width: 32, textAlign: 'right' }}>L</Box>
        <Box sx={{ width: 48, textAlign: 'right' }}>Diff</Box>
      </Box>
      {rows.map(r => {
        const diff = r.runsFor - r.runsAgainst
        return (
          <Box key={r.team.id} onClick={() => onOpenTeam(r.team)} sx={{
            display: 'flex', alignItems: 'center', px: 0.5, py: 0.85, cursor: 'pointer',
            borderTop: '1px solid', borderColor: 'divider', fontVariantNumeric: 'tabular-nums',
            borderRadius: 1, '&:hover': { bgcolor: 'action.hover' },
          }}>
            <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
              <TeamBadge team={r.team} size={24} />
              <Typography sx={{ fontSize: '0.85rem', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{wpblFullName(r.team)}</Typography>
            </Box>
            <Box sx={{ width: 32, textAlign: 'right', fontWeight: 700, fontSize: '0.85rem' }}>{r.wins}</Box>
            <Box sx={{ width: 32, textAlign: 'right', fontWeight: 700, fontSize: '0.85rem' }}>{r.losses}</Box>
            <Box sx={{ width: 48, textAlign: 'right', fontSize: '0.85rem', color: diff > 0 ? 'success.main' : diff < 0 ? 'error.main' : 'text.secondary' }}>
              {diff > 0 ? `+${diff}` : diff}
            </Box>
          </Box>
        )
      })}
    </SectionCard>
  )
}

// ─── Teams card ─────────────────────────────────────────────────────────────────

function TeamsCard({ teams, onOpenTeam }: { teams: WpblTeam[]; onOpenTeam: (t: WpblTeam) => void }) {
  return (
    <SectionCard title="Teams" subtitle="The four founding clubs">
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
        {teams.map(t => (
          <Box key={t.id} onClick={() => onOpenTeam(t)} sx={{
            display: 'flex', alignItems: 'center', gap: 1, p: 1, cursor: 'pointer',
            borderRadius: 2, border: '1px solid', borderColor: CARD_BORDER,
            transition: 'border-color 0.15s', '&:hover': { borderColor: wpblColor(t.id) },
          }}>
            <TeamBadge team={t} size={30} />
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}</Typography>
              <Typography sx={{ fontSize: '0.68rem', color: 'text.secondary' }}>{t.city}</Typography>
            </Box>
          </Box>
        ))}
      </Box>
    </SectionCard>
  )
}

// ─── Leaders ────────────────────────────────────────────────────────────────────

interface LeaderRow { player: WpblPlayer; display: string }

function StatBlock({ label, rows, teamById, onOpenPlayer }: {
  label: string; rows: LeaderRow[]; teamById: Map<string, WpblTeam>; onOpenPlayer: (p: WpblPlayer) => void
}) {
  const isDark = useWpblDark()
  const shortName = useWpblName()
  if (rows.length === 0) return null
  return (
    <Box sx={{ mb: 1.25, '&:last-of-type': { mb: 0 } }}>
      <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.8, color: 'text.secondary', mb: 0.4 }}>{label}</Typography>
      {rows.map((r, i) => {
        const team = teamById.get(r.player.team_id)
        return (
          <Box key={r.player.id} onClick={() => onOpenPlayer(r.player)} sx={{
            display: 'flex', alignItems: 'center', gap: 0.75, py: 0.4, cursor: 'pointer',
            borderRadius: 1, '&:hover': { bgcolor: 'action.hover' },
          }}>
            <Typography sx={{ width: 14, fontSize: '0.7rem', fontWeight: 800, color: i === 0 ? wpblAccent(r.player.team_id, isDark) : 'text.disabled' }}>{i + 1}</Typography>
            {team && <TeamBadge team={team} size={18} />}
            <Typography sx={{ flex: 1, fontSize: '0.82rem', fontWeight: i === 0 ? 700 : 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{shortName(r.player.name)}</Typography>
            <Typography sx={{ fontSize: '0.82rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums', minWidth: 40, textAlign: 'right' }}>{r.display}</Typography>
          </Box>
        )
      })}
    </Box>
  )
}

// Pick the top `n` by `value` (higher is better; negate inside for ascending stats),
// after an optional qualifier filter.
function topBat(list: WpblBatSeason[], value: (t: WpblBattingTotals) => number | null, display: (t: WpblBattingTotals) => string, qualify?: (t: WpblBattingTotals) => boolean, n = 3): LeaderRow[] {
  return list
    .filter(x => (qualify ? qualify(x.totals) : true) && value(x.totals) != null)
    // Ties break toward the bigger sample (more at-bats).
    .sort((a, b) => (value(b.totals) as number) - (value(a.totals) as number) || b.totals.ab - a.totals.ab)
    .slice(0, n)
    .map(x => ({ player: x.player, display: display(x.totals) }))
}
function topPit(list: WpblPitSeason[], value: (t: WpblPitchingTotals) => number | null, display: (t: WpblPitchingTotals) => string, qualify?: (t: WpblPitchingTotals) => boolean, n = 3): LeaderRow[] {
  return list
    .filter(x => (qualify ? qualify(x.totals) : true) && value(x.totals) != null)
    // Ties (e.g. equal ERA) break toward more innings pitched.
    .sort((a, b) => (value(b.totals) as number) - (value(a.totals) as number) || b.totals.outs - a.totals.outs)
    .slice(0, n)
    .map(x => ({ player: x.player, display: display(x.totals) }))
}

function LeadersCard({ title, blocks, loading, hasData, teamById, onOpenPlayer, onViewAll }: {
  title: string; blocks: { label: string; rows: LeaderRow[] }[]
  loading: boolean; hasData: boolean; teamById: Map<string, WpblTeam>
  onOpenPlayer: (p: WpblPlayer) => void; onViewAll: () => void
}) {
  const anyRows = blocks.some(b => b.rows.length > 0)
  return (
    <SectionCard
      title={title}
      action={anyRows ? (
        <Typography onClick={onViewAll} sx={{ fontSize: '0.72rem', fontWeight: 700, color: WPBL_ACCENT, cursor: 'pointer', flexShrink: 0, '&:hover': { textDecoration: 'underline' } }}>
          View all
        </Typography>
      ) : undefined}
    >
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}><CircularProgress size={20} /></Box>
      ) : !hasData || !anyRows ? (
        <Typography sx={{ fontSize: '0.8rem', color: 'text.secondary', py: 1 }}>
          Leaders appear once games are played.
        </Typography>
      ) : (
        blocks.map(b => <StatBlock key={b.label} label={b.label} rows={b.rows} teamById={teamById} onOpenPlayer={onOpenPlayer} />)
      )}
    </SectionCard>
  )
}

// ─── Tracking teaser ──────────────────────────────────────────────────────────────
// A three-stat teaser for the Tracking tab: the season's fastest pitch, hardest-hit
// ball, and longest tracked hit. Radar coverage is partial, so these are "bests we
// measured," not absolutes (the full tab carries that caveat). A stat gets a "New" pill
// when its record was set on the most recent game day.

interface TeaserTile {
  icon: string; label: string; value: string; unit: string
  name: string; player: WpblPlayer | null; teamId: string | null; isNew: boolean
}

function TrackingTeaserCard({ board, latestGameIds, loading, teamById, onOpenPlayer, onViewAll }: {
  board: TrackingBoard; latestGameIds: Set<string>; loading: boolean
  teamById: Map<string, WpblTeam>; onOpenPlayer: (p: WpblPlayer) => void; onViewAll: () => void
}) {
  const isDark = useWpblDark()
  const { units } = useUnits()
  const shortName = useWpblName()
  const fp = board.fastestPitches[0]
  const hh = board.hardestHits[0]
  const lh = board.longestHits[0]
  const tiles: TeaserTile[] = []
  if (fp) tiles.push({ icon: '🔥', label: 'Fastest pitch', value: fmtSpeed(fp.velo, units), unit: speedUnit(units), name: fp.name, player: fp.player, teamId: fp.teamId, isNew: latestGameIds.has(fp.gameId) })
  if (hh && hh.exit != null) tiles.push({ icon: '💥', label: 'Hardest hit', value: fmtSpeed(hh.exit, units), unit: speedUnit(units), name: hh.name, player: hh.player, teamId: hh.teamId, isNew: latestGameIds.has(hh.gameId) })
  if (lh && lh.distance != null) tiles.push({ icon: '🚀', label: 'Longest hit', value: fmtDistance(lh.distance, units), unit: distanceUnit(units), name: lh.name, player: lh.player, teamId: lh.teamId, isNew: latestGameIds.has(lh.gameId) })

  return (
    <SectionCard
      title="Ballpark tracking"
      subtitle="Season bests, measured by in-park radar"
      action={tiles.length > 0 ? (
        <Typography onClick={onViewAll} sx={{ fontSize: '0.72rem', fontWeight: 700, color: WPBL_ACCENT, cursor: 'pointer', flexShrink: 0, '&:hover': { textDecoration: 'underline' } }}>
          View all
        </Typography>
      ) : undefined}
    >
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}><CircularProgress size={20} /></Box>
      ) : tiles.length === 0 ? (
        <Typography sx={{ fontSize: '0.8rem', color: 'text.secondary', py: 1 }}>
          Tracking data appears once games are played.
        </Typography>
      ) : (
        tiles.map(t => {
          const team = t.teamId ? teamById.get(t.teamId) : undefined
          const clickable = !!t.player
          return (
            <Box
              key={t.label}
              onClick={clickable ? () => onOpenPlayer(t.player!) : undefined}
              sx={{
                display: 'flex', alignItems: 'center', gap: 1.25, py: 0.7,
                borderTop: '1px solid', borderColor: 'divider',
                borderRadius: 1, ...(clickable ? { cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } } : {}),
              }}
            >
              <Box sx={{ fontSize: '1.05rem', width: 24, textAlign: 'center', flexShrink: 0 }}>{t.icon}</Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5, color: 'text.secondary' }}>{t.label}</Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, minWidth: 0 }}>
                  {team && <TeamBadge team={team} size={18} />}
                  <Typography sx={{ fontSize: '0.85rem', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{shortName(t.name)}</Typography>
                  {t.isNew && (
                    <Box sx={{ flexShrink: 0, px: 0.6, py: 0.1, borderRadius: 1, bgcolor: wpblAccent(t.teamId ?? '', isDark), color: '#fff', fontSize: '0.55rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5 }}>New</Box>
                  )}
                </Box>
              </Box>
              <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
                <Typography component="span" sx={{ fontSize: '1rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{t.value}</Typography>
                <Typography component="span" sx={{ fontSize: '0.66rem', fontWeight: 700, color: 'text.secondary', ml: 0.4 }}>{t.unit}</Typography>
              </Box>
            </Box>
          )
        })
      )}
    </SectionCard>
  )
}

// ─── Hall of Firsts ───────────────────────────────────────────────────────────────

function FirstRow({ f, teamById, onOpenPlayer, showDetail }: {
  f: WpblFirst; teamById: Map<string, WpblTeam>; onOpenPlayer: (p: WpblPlayer) => void; showDetail?: boolean
}) {
  const team = f.teamId ? teamById.get(f.teamId) : undefined
  const dateLabel = new Date(`${f.date}T00:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' })
  const clickable = !!f.player
  const shortName = useWpblName()
  return (
    <Box
      onClick={clickable ? () => onOpenPlayer(f.player!) : undefined}
      sx={{
        display: 'flex', alignItems: 'center', gap: 1.25, py: 0.85,
        borderTop: '1px solid', borderColor: 'divider',
        borderRadius: 1, ...(clickable ? { cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } } : {}),
      }}
    >
      <PlayerPortrait name={f.name} teamId={f.teamId ?? ''} size={42} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5, color: 'text.secondary' }}>
          {f.icon} {f.label}
        </Typography>
        <Typography sx={{ fontSize: '0.9rem', fontWeight: 700, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{shortName(f.name)}</Typography>
        {showDetail && f.detail && (
          <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.detail}</Typography>
        )}
      </Box>
      <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
        {team && <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, color: 'text.secondary' }}>{team.abbr}</Typography>}
        <Typography sx={{ fontSize: '0.66rem', color: 'text.secondary' }}>{dateLabel}</Typography>
      </Box>
    </Box>
  )
}

function HallOfFirstsCard({ firsts, teamById, loading, onOpenPlayer, onViewAll }: {
  firsts: WpblFirst[]; teamById: Map<string, WpblTeam>; loading: boolean
  onOpenPlayer: (p: WpblPlayer) => void; onViewAll: () => void
}) {
  const featured = firsts.filter(f => f.featured).slice(0, 4)
  return (
    <SectionCard
      title="Hall of Firsts"
      action={firsts.length > 0 ? (
        <Typography onClick={onViewAll} sx={{ fontSize: '0.72rem', fontWeight: 700, color: WPBL_ACCENT, cursor: 'pointer', flexShrink: 0, '&:hover': { textDecoration: 'underline' } }}>
          View all
        </Typography>
      ) : undefined}
    >
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}><CircularProgress size={20} /></Box>
      ) : featured.length === 0 ? (
        <Typography sx={{ fontSize: '0.8rem', color: 'text.secondary', py: 1 }}>
          Milestones appear as the season's firsts happen.
        </Typography>
      ) : (
        featured.map(f => <FirstRow key={f.key} f={f} teamById={teamById} onOpenPlayer={onOpenPlayer} />)
      )}
    </SectionCard>
  )
}

function FirstsModal({ firsts, teamById, onClose, onOpenPlayer }: {
  firsts: WpblFirst[]; teamById: Map<string, WpblTeam>; onClose: () => void; onOpenPlayer: (p: WpblPlayer) => void
}) {
  return (
    <ModalShell eyebrow="Hall of Firsts" onClose={onClose} maxWidth={520}>
      <Box sx={{ px: 2, py: 1 }}>
        {firsts.length === 0 ? (
          <Typography sx={{ fontSize: '0.85rem', color: 'text.secondary', py: 3, textAlign: 'center' }}>
            No milestones yet. They appear as the season's firsts happen.
          </Typography>
        ) : (
          firsts.map(f => <FirstRow key={f.key} f={f} teamById={teamById} onOpenPlayer={onOpenPlayer} showDetail />)
        )}
      </Box>
    </ModalShell>
  )
}

// ─── New-tracking banner ──────────────────────────────────────────────────────────
// The league publishes TrackMan tracking in batches that land days after a game, often in
// bulk for several games at once (see wpbl-ingest's late-backfill note). When the set of
// games that carry tracking grows beyond what this browser last saw, surface a dismissible
// banner pointing to the Ballpark Tracking section. First-ever visit seeds silently (no
// nag); the "new" state clears once the user views or dismisses it.

const TRACK_SEEN_KEY = 'wpbl:trackingSeenGames'

function readSeen(): string[] {
  try { const v = JSON.parse(localStorage.getItem(TRACK_SEEN_KEY) ?? '[]'); return Array.isArray(v) ? v : [] }
  catch { return [] }
}
function writeSeen(ids: Iterable<string>) {
  try { localStorage.setItem(TRACK_SEEN_KEY, JSON.stringify([...ids])) } catch { /* private mode / quota — non-fatal */ }
}

// Returns how many newly-tracked games appeared since this browser last acknowledged, and
// an ack() that marks the current tracked set as seen. Waits for tracking to load before
// judging (size 0 = not loaded yet), and seeds silently on a first visit.
function useNewTrackingBatch(tracking: WpblTrackRow[]): { newCount: number; ack: () => void } {
  const trackedIds = useMemo(() => {
    const set = new Set<string>()
    for (const t of tracking) if (t.game_id) set.add(t.game_id)
    return set
  }, [tracking])
  const [newCount, setNewCount] = useState(0)

  useEffect(() => {
    if (trackedIds.size === 0) return // tracking not loaded yet — don't seed on an empty set
    const seen = readSeen()
    if (seen.length === 0) { writeSeen(trackedIds); setNewCount(0); return } // first visit: seed, no banner
    const seenSet = new Set(seen)
    let added = 0
    for (const id of trackedIds) if (!seenSet.has(id)) added++
    setNewCount(added)
  }, [trackedIds])

  const ack = () => { writeSeen(trackedIds); setNewCount(0) }
  return { newCount, ack }
}

function NewTrackingBanner({ count, onView, onDismiss }: { count: number; onView: () => void; onDismiss: () => void }) {
  return (
    <Box
      onClick={onView}
      role="button"
      sx={{
        mb: 2, display: 'flex', alignItems: 'center', gap: 1.5, p: 1.25, cursor: 'pointer',
        borderRadius: 2, border: '1.5px solid', borderColor: WPBL_ACCENT,
        bgcolor: theme => theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.015)',
        transition: 'background-color 0.15s',
        '&:hover': { bgcolor: theme => theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.03)' },
      }}
    >
      <Box sx={{ fontSize: '1.35rem', lineHeight: 1, flexShrink: 0 }}>📡</Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: '0.9rem', fontWeight: 800, lineHeight: 1.2 }}>
          New pitch-tracking data just landed
        </Typography>
        <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary', mt: 0.2 }}>
          Velocity, spin &amp; exit velo for {count} new game{count === 1 ? '' : 's'} — tap to explore Ballpark Tracking.
        </Typography>
      </Box>
      <Typography sx={{ fontSize: '0.75rem', fontWeight: 800, color: WPBL_ACCENT, flexShrink: 0, whiteSpace: 'nowrap' }}>
        View →
      </Typography>
      <Box
        onClick={e => { e.stopPropagation(); onDismiss() }}
        role="button"
        aria-label="Dismiss"
        sx={{
          flexShrink: 0, width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
          borderRadius: '50%', color: 'text.secondary', fontSize: '0.85rem', lineHeight: 1,
          '&:hover': { bgcolor: 'action.hover', color: 'text.primary' },
        }}
      >
        ✕
      </Box>
    </Box>
  )
}

// ─── Home ───────────────────────────────────────────────────────────────────────

// ─── Ingest health (admin-only) ──────────────────────────────────────────────────
// The feed-mirror ingest freshness indicator lives in the site Admin panel now
// (consolidated with the payroll/contract freshness) — see AdminPanel's "WPBL Ingest".

export default function WpblHome({ teams, games, liveGame, onOpenGame, onOpenPlayer, onOpenTeam, onViewStats, onViewTracking }: {
  teams: WpblTeam[]
  games: WpblGame[]
  liveGame: WpblGame | null
  onOpenGame: (g: WpblGame) => void
  onOpenPlayer: (p: WpblPlayer) => void
  onOpenTeam: (t: WpblTeam) => void
  onViewStats: (group: 'hitting' | 'pitching') => void
  onViewTracking: () => void
}) {
  const teamMap = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])

  // Leaders + Hall-of-Firsts + tracking data — fetched here so only the home view pays for it.
  const [players, setPlayers] = useState<WpblPlayer[]>([])
  const [lines, setLines] = useState<{ batting: WpblBattingLine[]; pitching: WpblPitchingLine[] }>({ batting: [], pitching: [] })
  const [plays, setPlays] = useState<WpblGamePlay[]>([])
  const [tracking, setTracking] = useState<WpblTrackRow[]>([])
  const [loadingLeaders, setLoadingLeaders] = useState(true)
  const [firstsOpen, setFirstsOpen] = useState(false)

  // Full load once. Players are static for the session; lines/plays/tracking seed the
  // leaders, Hall of Firsts, and tracking teaser.
  useEffect(() => {
    let cancelled = false
    Promise.all([fetchWpblAllPlayers(), fetchWpblAllLines(), fetchWpblAllPlays(), fetchWpblAllTracking()])
      .then(([p, l, pl, tr]) => {
        if (cancelled) return
        setPlayers(p); setLines(l); setPlays(pl); setTracking(tr); setLoadingLeaders(false)
      })
      .catch(() => { if (!cancelled) setLoadingLeaders(false) })
    return () => { cancelled = true }
  }, [])

  // While a game is live, refresh only the box-score lines + play-by-play (what the leaders
  // and Hall of Firsts read), and on a gentle cadence. Deliberately NOT re-pulled on the
  // tick: the full player roster (static) and the whole pitch_tracking table (large) — that
  // repeated full-table scan every 25s was the main load pegging the WPBL database. The
  // tracking teaser shows season bests, which barely move within a single game; it refreshes
  // on the next visit.
  useEffect(() => {
    if (!liveGame) return
    let cancelled = false
    const id = setInterval(() => {
      Promise.all([fetchWpblAllLines(), fetchWpblAllPlays()])
        .then(([l, pl]) => { if (!cancelled) { setLines(l); setPlays(pl) } })
        .catch(() => { /* keep last-good */ })
    }, 60000)
    return () => { cancelled = true; clearInterval(id) }
  }, [liveGame?.id])

  const firsts = useMemo(() => computeFirsts(plays, games, players, lines.pitching), [plays, games, players, lines.pitching])

  const trackingBoard = useMemo(() => aggregateTracking(tracking, players, lines.pitching), [tracking, players, lines.pitching])
  // Game ids from the most recent day that has a final — used to flag a record as "New".
  const latestGameIds = useMemo(() => {
    const finals = games.filter(g => g.status === 'final' && g.game_date)
    if (finals.length === 0) return new Set<string>()
    const maxDate = finals.reduce((m, g) => (g.game_date > m ? g.game_date : m), finals[0].game_date)
    return new Set(finals.filter(g => g.game_date === maxDate).map(g => g.id))
  }, [games])

  const batSeasons = useMemo(() => aggregateBatting(players, lines.batting), [players, lines.batting])
  const pitSeasons = useMemo(() => aggregatePitching(players, lines.pitching), [players, lines.pitching])

  // Only enforce the 5 AB / 3 IP rate qualifier once every team has played 2+ games.
  const qualifyOn = useMemo(() => qualifiersActive(teams, games), [teams, games])

  const battingBlocks = useMemo(() => [
    { label: 'OPS', rows: topBat(batSeasons, t => t.ops, t => fmtRate(t.ops), t => !qualifyOn || t.ab >= MIN_AB) },
    { label: 'Home runs',       rows: topBat(batSeasons, t => t.hr,  t => String(t.hr), t => t.hr > 0) },
    { label: 'RBI',             rows: topBat(batSeasons, t => t.rbi, t => String(t.rbi), t => t.rbi > 0) },
  ], [batSeasons, qualifyOn])

  const pitchingBlocks = useMemo(() => [
    { label: 'ERA',        rows: topPit(pitSeasons, t => (t.era == null ? null : -t.era), t => fmtTwo(t.era), t => !qualifyOn || t.outs >= MIN_OUTS) },
    { label: 'Strikeouts', rows: topPit(pitSeasons, t => t.so, t => String(t.so), t => t.so > 0) },
  ], [pitSeasons, qualifyOn])

  const hasLines = lines.batting.length > 0 || lines.pitching.length > 0

  // New-tracking batch banner: fires when the set of tracked games grows since last seen.
  const { newCount: newTrackingCount, ack: ackTracking } = useNewTrackingBatch(tracking)
  const viewTracking = () => { ackTracking(); onViewTracking() }

  return (
    <Box>
      {/* Slim league header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', mb: 2 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: '1.05rem', fontWeight: 900, letterSpacing: '-0.3px', lineHeight: 1.15 }}>
            Women's Pro Baseball League
          </Typography>
          <Typography sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>Inaugural 2026 season</Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 0.75 }}>
          {teams.map(t => (
            <Box key={t.id} onClick={() => onOpenTeam(t)} sx={{ cursor: 'pointer', transition: 'transform 0.12s', '&:hover': { transform: 'scale(1.08)' } }}>
              <TeamBadge team={t} size={30} />
            </Box>
          ))}
        </Box>
      </Box>

      {/* New pitch-tracking batch just published — point folks to the Tracking section */}
      {newTrackingCount > 0 && (
        <NewTrackingBanner count={newTrackingCount} onView={viewTracking} onDismiss={ackTracking} />
      )}

      {/* Live game hero — the one in-progress game, front and center */}
      {liveGame && <LiveHero game={liveGame} teams={teams} onOpen={() => onOpenGame(liveGame)} />}

      {/* Scoreboard */}
      <Scoreboard games={games} teams={teamMap} onOpenGame={onOpenGame} />

      {/* Two-column feed */}
      <Box sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: '1.4fr 1fr' },
        columnGap: 2.5, rowGap: 2, alignItems: 'start',
      }}>
        {/* The League */}
        <Box sx={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <NextGameCard games={games} teams={teamMap} onOpenGame={onOpenGame} />
          <StandingsCard teams={teams} games={games} onOpenTeam={onOpenTeam} />
          <TeamsCard teams={teams} onOpenTeam={onOpenTeam} />
        </Box>

        {/* Around the League */}
        <Box sx={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <HallOfFirstsCard firsts={firsts} teamById={teamMap} loading={loadingLeaders} onOpenPlayer={onOpenPlayer} onViewAll={() => setFirstsOpen(true)} />
          <TrackingTeaserCard board={trackingBoard} latestGameIds={latestGameIds} loading={loadingLeaders} teamById={teamMap} onOpenPlayer={onOpenPlayer} onViewAll={viewTracking} />
          <LeadersCard title="Batting Leaders" blocks={battingBlocks} loading={loadingLeaders} hasData={hasLines} teamById={teamMap} onOpenPlayer={onOpenPlayer} onViewAll={() => onViewStats('hitting')} />
          <LeadersCard title="Pitching Leaders" blocks={pitchingBlocks} loading={loadingLeaders} hasData={hasLines} teamById={teamMap} onOpenPlayer={onOpenPlayer} onViewAll={() => onViewStats('pitching')} />
        </Box>
      </Box>

      {firstsOpen && (
        <FirstsModal firsts={firsts} teamById={teamMap} onClose={() => setFirstsOpen(false)} onOpenPlayer={onOpenPlayer} />
      )}
    </Box>
  )
}
