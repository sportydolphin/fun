import { useEffect, useMemo, useState } from 'react'
import { Box, Typography, CircularProgress } from '@mui/material'
import { fetchWpblAllPlayers, fetchWpblAllLines, computeStandings } from './api'
import { WPBL_ACCENT, wpblColor, wpblAccent, wpblFullName, formatGameTime } from './constants'
import { SectionCard, SectionLabel, TeamBadge, useWpblDark, CARD_BORDER } from './ui'
import {
  aggregateBatting, aggregatePitching, fmtRate, fmtTwo,
  type WpblBatSeason, type WpblPitSeason, type WpblBattingTotals, type WpblPitchingTotals,
} from './stats'
import type { WpblTeam, WpblPlayer, WpblGame, WpblBattingLine, WpblPitchingLine } from './types'

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

  const statusText = final
    ? `Final${game.innings && game.innings !== 7 ? `/${game.innings}` : ''}`
    : live ? 'Live'
    : new Date(`${game.game_date}T00:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' })

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
      flexShrink: 0, width: 132, cursor: 'pointer',
      borderRadius: 2, border: '1px solid', borderColor: CARD_BORDER, bgcolor: 'background.paper',
      p: 1, display: 'flex', flexDirection: 'column', gap: 0.6,
      transition: 'border-color 0.15s', '&:hover': { borderColor: 'text.disabled' },
    }}>
      <Typography sx={{ fontSize: '0.62rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5, color: live ? '#ef4444' : 'text.disabled' }}>
        {statusText}
      </Typography>
      {row(away, game.away_score, awayWon)}
      {row(home, game.home_score, homeWon)}
      {!final && !live && game.start_time && (
        <Typography sx={{ fontSize: '0.62rem', fontWeight: 700, color: 'text.secondary', letterSpacing: 0.2 }}>
          {formatGameTime(game.game_date, game.start_time)}
        </Typography>
      )}
    </Box>
  )
}

function Scoreboard({ games, teams, onOpenGame }: {
  games: WpblGame[]; teams: Map<string, WpblTeam>; onOpenGame: (g: WpblGame) => void
}) {
  // Keep the strip relevant: the last few finals, then everything still to come.
  const strip = useMemo(() => {
    const played = games.filter(g => g.status === 'final')
    const rest = games.filter(g => g.status !== 'final')
    return [...played.slice(-3), ...rest.slice(0, 7)]
  }, [games])

  if (strip.length === 0) return null
  return (
    <Box sx={{ mb: 2 }}>
      <SectionLabel>Scoreboard</SectionLabel>
      <Box sx={{
        display: 'flex', gap: 1, overflowX: 'auto', pb: 0.5,
        '&::-webkit-scrollbar': { display: 'none' },
        msOverflowStyle: 'none', scrollbarWidth: 'none',
      }} data-swipe-ignore="true">
        {strip.map(g => <GameChip key={g.id} game={g} teams={teams} onOpen={() => onOpenGame(g)} />)}
      </Box>
    </Box>
  )
}

// ─── Standings card ─────────────────────────────────────────────────────────────

function StandingsCard({ teams, games, onOpenTeam }: {
  teams: WpblTeam[]; games: WpblGame[]; onOpenTeam: (t: WpblTeam) => void
}) {
  const rows = useMemo(() => computeStandings(teams, games), [teams, games])
  const played = games.some(g => g.status === 'final')
  return (
    <SectionCard title="Standings" subtitle={played ? 'Inaugural season' : 'Season opens August 1'}>
      <Box sx={{ display: 'flex', px: 0.5, pb: 0.5, fontSize: '0.62rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5, color: 'text.disabled' }}>
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

function StatBlock({ label, rows, onOpenPlayer }: {
  label: string; rows: LeaderRow[]; onOpenPlayer: (p: WpblPlayer) => void
}) {
  const isDark = useWpblDark()
  if (rows.length === 0) return null
  return (
    <Box sx={{ mb: 1.25, '&:last-of-type': { mb: 0 } }}>
      <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.8, color: 'text.disabled', mb: 0.4 }}>{label}</Typography>
      {rows.map((r, i) => (
        <Box key={r.player.id} onClick={() => onOpenPlayer(r.player)} sx={{
          display: 'flex', alignItems: 'center', gap: 0.75, py: 0.4, cursor: 'pointer',
          borderRadius: 1, '&:hover': { bgcolor: 'action.hover' },
        }}>
          <Typography sx={{ width: 14, fontSize: '0.7rem', fontWeight: 800, color: i === 0 ? wpblAccent(r.player.team_id, isDark) : 'text.disabled' }}>{i + 1}</Typography>
          <Typography sx={{ flex: 1, fontSize: '0.82rem', fontWeight: i === 0 ? 700 : 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.player.name}</Typography>
          <Typography sx={{ fontSize: '0.82rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{r.display}</Typography>
        </Box>
      ))}
    </Box>
  )
}

// Pick the top `n` by `value` (higher is better; negate inside for ascending stats),
// after an optional qualifier filter.
function topBat(list: WpblBatSeason[], value: (t: WpblBattingTotals) => number | null, display: (t: WpblBattingTotals) => string, qualify?: (t: WpblBattingTotals) => boolean, n = 3): LeaderRow[] {
  return list
    .filter(x => (qualify ? qualify(x.totals) : true) && value(x.totals) != null)
    .sort((a, b) => (value(b.totals) as number) - (value(a.totals) as number))
    .slice(0, n)
    .map(x => ({ player: x.player, display: display(x.totals) }))
}
function topPit(list: WpblPitSeason[], value: (t: WpblPitchingTotals) => number | null, display: (t: WpblPitchingTotals) => string, qualify?: (t: WpblPitchingTotals) => boolean, n = 3): LeaderRow[] {
  return list
    .filter(x => (qualify ? qualify(x.totals) : true) && value(x.totals) != null)
    .sort((a, b) => (value(b.totals) as number) - (value(a.totals) as number))
    .slice(0, n)
    .map(x => ({ player: x.player, display: display(x.totals) }))
}

function LeadersCard({ title, blocks, loading, hasData, onOpenPlayer }: {
  title: string; blocks: { label: string; rows: LeaderRow[] }[]
  loading: boolean; hasData: boolean; onOpenPlayer: (p: WpblPlayer) => void
}) {
  const anyRows = blocks.some(b => b.rows.length > 0)
  return (
    <SectionCard title={title} subtitle="Season leaders">
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}><CircularProgress size={20} /></Box>
      ) : !hasData || !anyRows ? (
        <Typography sx={{ fontSize: '0.8rem', color: 'text.disabled', py: 1 }}>
          Leaders appear once games are played.
        </Typography>
      ) : (
        blocks.map(b => <StatBlock key={b.label} label={b.label} rows={b.rows} onOpenPlayer={onOpenPlayer} />)
      )}
    </SectionCard>
  )
}

// ─── Home ───────────────────────────────────────────────────────────────────────

export default function WpblHome({ teams, games, onOpenGame, onOpenPlayer, onOpenTeam }: {
  teams: WpblTeam[]
  games: WpblGame[]
  onOpenGame: (g: WpblGame) => void
  onOpenPlayer: (p: WpblPlayer) => void
  onOpenTeam: (t: WpblTeam) => void
}) {
  const teamMap = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])

  // Leaders data — fetched here so only the home view pays for it.
  const [players, setPlayers] = useState<WpblPlayer[]>([])
  const [lines, setLines] = useState<{ batting: WpblBattingLine[]; pitching: WpblPitchingLine[] }>({ batting: [], pitching: [] })
  const [loadingLeaders, setLoadingLeaders] = useState(true)

  useEffect(() => {
    let cancelled = false
    Promise.all([fetchWpblAllPlayers(), fetchWpblAllLines()]).then(([p, l]) => {
      if (cancelled) return
      setPlayers(p); setLines(l); setLoadingLeaders(false)
    })
    return () => { cancelled = true }
  }, [])

  const batSeasons = useMemo(() => aggregateBatting(players, lines.batting), [players, lines.batting])
  const pitSeasons = useMemo(() => aggregatePitching(players, lines.pitching), [players, lines.pitching])

  const battingBlocks = useMemo(() => [
    { label: 'Batting average', rows: topBat(batSeasons, t => t.avg, t => fmtRate(t.avg), t => t.ab >= MIN_AB) },
    { label: 'Home runs',       rows: topBat(batSeasons, t => t.hr,  t => String(t.hr), t => t.hr > 0) },
    { label: 'RBI',             rows: topBat(batSeasons, t => t.rbi, t => String(t.rbi), t => t.rbi > 0) },
  ], [batSeasons])

  const pitchingBlocks = useMemo(() => [
    { label: 'ERA',        rows: topPit(pitSeasons, t => (t.era == null ? null : -t.era), t => fmtTwo(t.era), t => t.outs >= MIN_OUTS) },
    { label: 'Strikeouts', rows: topPit(pitSeasons, t => t.so, t => String(t.so), t => t.so > 0) },
    { label: 'Wins',       rows: topPit(pitSeasons, t => t.w,  t => String(t.w),  t => t.w > 0) },
  ], [pitSeasons])

  const hasLines = lines.batting.length > 0 || lines.pitching.length > 0

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
          <StandingsCard teams={teams} games={games} onOpenTeam={onOpenTeam} />
          <TeamsCard teams={teams} onOpenTeam={onOpenTeam} />
        </Box>

        {/* Around the League */}
        <Box sx={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <LeadersCard title="Batting Leaders" blocks={battingBlocks} loading={loadingLeaders} hasData={hasLines} onOpenPlayer={onOpenPlayer} />
          <LeadersCard title="Pitching Leaders" blocks={pitchingBlocks} loading={loadingLeaders} hasData={hasLines} onOpenPlayer={onOpenPlayer} />
        </Box>
      </Box>
    </Box>
  )
}
