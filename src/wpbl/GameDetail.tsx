import { useCallback, useEffect, useMemo, useState } from 'react'
import { Box, Typography, CircularProgress } from '@mui/material'
import { supabase } from '../lib/supabase'
import { fetchWpblRoster, fetchWpblGameLines, fetchWpblGamePlays, fetchWpblGameTracking } from './api'
import { wpblAccent, wpblFullName, outsToIp, formatGameTime } from './constants'
import { LiveBanner, useLiveGame } from './Live'
import { ModalShell, SegNav, TeamBadge, useWpblDark } from './ui'
import type {
  WpblTeam, WpblGame, WpblPlayer, WpblBattingLine, WpblPitchingLine, WpblFieldingLine,
  WpblGamePlay, WpblPitchTracking,
} from './types'

// Read-only game center. Fed entirely by the official-feed mirror (see wpbl-ingest):
// line score, a tabbed box score (batting / pitching / fielding), the play-by-play, and
// TrackMan pitch tracking. Player names open the player page. For an unplayed game it
// shows the matchup + first-pitch time.

type Tab = 'box' | 'plays' | 'pitch'

// ─── Box-score column sets ─────────────────────────────────────────────────────
const BAT_COLS: { key: keyof WpblBattingLine; label: string }[] = [
  { key: 'ab', label: 'AB' }, { key: 'r', label: 'R' }, { key: 'h', label: 'H' },
  { key: 'doubles', label: '2B' }, { key: 'hr', label: 'HR' }, { key: 'rbi', label: 'RBI' },
  { key: 'bb', label: 'BB' }, { key: 'so', label: 'SO' }, { key: 'sb', label: 'SB' },
]
const PIT_COLS: { key: keyof WpblPitchingLine; label: string }[] = [
  { key: 'h', label: 'H' }, { key: 'r', label: 'R' }, { key: 'er', label: 'ER' },
  { key: 'bb', label: 'BB' }, { key: 'so', label: 'SO' }, { key: 'hr', label: 'HR' },
  { key: 'pitches', label: 'P' },
]
const FLD_COLS: { key: keyof WpblFieldingLine; label: string }[] = [
  { key: 'po', label: 'PO' }, { key: 'a', label: 'A' }, { key: 'e', label: 'E' },
  { key: 'dp', label: 'DP' }, { key: 'pb', label: 'PB' },
]

// ─── Line score ────────────────────────────────────────────────────────────────
function LineScore({ away, home, game }: { away: WpblTeam; home: WpblTeam; game: WpblGame }) {
  const innings = Math.max(game.away_line?.length ?? 0, game.home_line?.length ?? 0, 7)
  const runsByInning = (line: WpblGame['away_line'], i: number) =>
    line?.find(c => c.inning === i + 1)?.runs
  const row = (team: WpblTeam, line: WpblGame['away_line'], runs: number | null, hits: number | null | undefined, errs: number | null | undefined, won: boolean) => (
    <Box sx={{ display: 'flex', alignItems: 'center', ...lsRowSx }}>
      <Box sx={{ ...lsTeamSx, fontWeight: won ? 800 : 600 }}>
        <TeamBadge team={team} size={20} />
        <Box component="span" sx={{ ml: 0.75 }}>{team.abbr}</Box>
      </Box>
      {Array.from({ length: innings }, (_, i) => {
        const r = runsByInning(line, i)
        return <Box key={i} sx={lsCellSx}>{r == null ? '' : r}</Box>
      })}
      <Box sx={{ ...lsTotSx, fontWeight: 800 }}>{runs ?? 0}</Box>
      <Box sx={lsTotSx}>{hits ?? 0}</Box>
      <Box sx={lsTotSx}>{errs ?? 0}</Box>
    </Box>
  )
  const awayWon = (game.away_score ?? 0) > (game.home_score ?? 0)
  const homeWon = (game.home_score ?? 0) > (game.away_score ?? 0)
  return (
    <Box sx={{ overflowX: 'auto', px: 2, pb: 1.5 }}>
      <Box sx={{ minWidth: 'max-content', fontVariantNumeric: 'tabular-nums' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', ...lsRowSx, ...lsHeadSx }}>
          <Box sx={lsTeamSx} />
          {Array.from({ length: innings }, (_, i) => <Box key={i} sx={lsCellSx}>{i + 1}</Box>)}
          <Box sx={lsTotSx}>R</Box>
          <Box sx={lsTotSx}>H</Box>
          <Box sx={lsTotSx}>E</Box>
        </Box>
        {row(away, game.away_line, game.away_score, game.away_hits, game.away_errors, awayWon)}
        {row(home, game.home_line, game.home_score, game.home_hits, game.home_errors, homeWon)}
      </Box>
    </Box>
  )
}

// ─── One team's box score (batting + pitching + fielding) ──────────────────────
function TeamBox({ team, batting, pitching, fielding, names, onOpenPlayer }: {
  team: WpblTeam
  batting: WpblBattingLine[]
  pitching: WpblPitchingLine[]
  fielding: WpblFieldingLine[]
  names: Map<string, WpblPlayer>
  onOpenPlayer?: (p: WpblPlayer) => void
}) {
  const isDark = useWpblDark()
  const color = wpblAccent(team.id, isDark)
  const nameCell = (playerId: string, suffix?: React.ReactNode) => {
    const p = names.get(playerId)
    const clickable = p && onOpenPlayer
    return (
      <Box
        onClick={clickable ? () => onOpenPlayer!(p!) : undefined}
        sx={{ ...nameColSx, fontWeight: 600, ...(clickable ? { cursor: 'pointer', '&:hover': { color } } : {}) }}
      >
        {p?.name ?? '—'}{suffix}
      </Box>
    )
  }
  const batTotals = batting.reduce((t, b) => {
    for (const c of BAT_COLS) (t as any)[c.key] = ((t as any)[c.key] ?? 0) + (Number(b[c.key]) || 0)
    return t
  }, {} as Record<string, number>)

  if (batting.length === 0 && pitching.length === 0) return null

  return (
    <Box sx={{ mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <TeamBadge team={team} size={24} />
        <Typography sx={{ fontSize: '0.95rem', fontWeight: 800 }}>{wpblFullName(team)}</Typography>
      </Box>

      {batting.length > 0 && (
        <Box sx={{ overflowX: 'auto', mb: 1.5 }}>
          <Box sx={{ minWidth: 'max-content', fontVariantNumeric: 'tabular-nums' }}>
            <Box sx={{ display: 'flex', ...rowSx, ...headSx }}>
              <Box sx={nameColSx}>Batting</Box>
              {BAT_COLS.map(c => <Box key={c.key as string} sx={statColSx}>{c.label}</Box>)}
            </Box>
            {batting.map(b => (
              <Box key={b.id} sx={{ display: 'flex', ...rowSx, borderTop: '1px solid', borderColor: 'divider' }}>
                {nameCell(b.player_id, b.position ? <Box component="span" sx={{ color: 'text.disabled', fontWeight: 500 }}> {b.position}</Box> : null)}
                {BAT_COLS.map(c => <Box key={c.key as string} sx={statColSx}>{Number(b[c.key]) || 0}</Box>)}
              </Box>
            ))}
            <Box sx={{ display: 'flex', ...rowSx, borderTop: '2px solid', borderColor: color, fontWeight: 800 }}>
              <Box sx={{ ...nameColSx, color: 'text.secondary' }}>Totals</Box>
              {BAT_COLS.map(c => <Box key={c.key as string} sx={statColSx}>{batTotals[c.key as string] ?? 0}</Box>)}
            </Box>
          </Box>
        </Box>
      )}

      {pitching.length > 0 && (
        <Box sx={{ overflowX: 'auto', mb: fielding.length > 0 ? 1.5 : 0 }}>
          <Box sx={{ minWidth: 'max-content', fontVariantNumeric: 'tabular-nums' }}>
            <Box sx={{ display: 'flex', ...rowSx, ...headSx }}>
              <Box sx={nameColSx}>Pitching</Box>
              <Box sx={statColSx}>IP</Box>
              {PIT_COLS.map(c => <Box key={c.key as string} sx={statColSx}>{c.label}</Box>)}
            </Box>
            {pitching.map(p => (
              <Box key={p.id} sx={{ display: 'flex', ...rowSx, borderTop: '1px solid', borderColor: 'divider' }}>
                {nameCell(p.player_id, p.decision ? <Box component="span" sx={{ color, fontWeight: 800 }}> ({p.decision})</Box> : null)}
                <Box sx={statColSx}>{outsToIp(p.outs)}</Box>
                {PIT_COLS.map(c => <Box key={c.key as string} sx={statColSx}>{p[c.key] == null ? '—' : Number(p[c.key])}</Box>)}
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {fielding.length > 0 && (
        <Box sx={{ overflowX: 'auto' }}>
          <Box sx={{ minWidth: 'max-content', fontVariantNumeric: 'tabular-nums' }}>
            <Box sx={{ display: 'flex', ...rowSx, ...headSx }}>
              <Box sx={nameColSx}>Fielding</Box>
              {FLD_COLS.map(c => <Box key={c.key as string} sx={statColSx}>{c.label}</Box>)}
            </Box>
            {fielding.map(f => (
              <Box key={f.id} sx={{ display: 'flex', ...rowSx, borderTop: '1px solid', borderColor: 'divider' }}>
                {nameCell(f.player_id)}
                {FLD_COLS.map(c => <Box key={c.key as string} sx={statColSx}>{Number(f[c.key]) || 0}</Box>)}
              </Box>
            ))}
          </Box>
        </Box>
      )}
    </Box>
  )
}

// ─── Play-by-play ──────────────────────────────────────────────────────────────
function PlayByPlay({ plays, teams }: { plays: WpblGamePlay[]; teams: Map<string, WpblTeam> }) {
  if (plays.length === 0) {
    return <EmptyBody title="No play-by-play yet" hint="The feed's play log appears here once the game begins." />
  }
  // Group consecutive plays into half-innings, in order.
  const groups: { key: string; label: string; teamId: string | null; plays: WpblGamePlay[] }[] = []
  for (const p of plays) {
    const key = `${p.inning}-${p.half}`
    const last = groups[groups.length - 1]
    if (!last || last.key !== key) {
      const half = p.half === 'top' ? 'Top' : 'Bottom'
      const ord = p.inning === 1 ? '1st' : p.inning === 2 ? '2nd' : p.inning === 3 ? '3rd' : `${p.inning}th`
      groups.push({ key, label: `${half} ${ord}`, teamId: p.team_id, plays: [p] })
    } else last.plays.push(p)
  }
  return (
    <Box sx={{ p: 2 }}>
      {groups.map(g => {
        const team = g.teamId ? teams.get(g.teamId) : undefined
        return (
          <Box key={g.key} sx={{ mb: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.75, position: 'sticky', top: 0, bgcolor: 'background.paper', py: 0.5, zIndex: 1 }}>
              {team && <TeamBadge team={team} size={18} />}
              <Typography sx={{ fontSize: '0.68rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: 'text.secondary' }}>
                {g.label}{team ? ` · ${team.abbr} batting` : ''}
              </Typography>
            </Box>
            {g.plays.map((p, i) => (
              <Box key={i} sx={{
                display: 'flex', gap: 1, py: 0.5, pl: 1, borderLeft: '2px solid',
                borderColor: p.is_scoring_play ? '#22c55e' : 'divider',
                bgcolor: p.is_scoring_play ? 'rgba(34,197,94,0.06)' : 'transparent',
              }}>
                <Typography sx={{ flex: 1, fontSize: '0.82rem', lineHeight: 1.35 }}>
                  {p.narrative}
                  {p.runs_scored > 0 && (
                    <Box component="span" sx={{ ml: 0.5, fontSize: '0.66rem', fontWeight: 800, color: '#16a34a' }}>
                      +{p.runs_scored}
                    </Box>
                  )}
                </Typography>
                {p.pitch_sequence && (
                  <Typography sx={{ fontSize: '0.66rem', color: 'text.disabled', fontFamily: 'monospace', flexShrink: 0, mt: '2px' }}>
                    {p.pitch_sequence}
                  </Typography>
                )}
              </Box>
            ))}
          </Box>
        )
      })}
    </Box>
  )
}

// ─── Pitch data (TrackMan) ─────────────────────────────────────────────────────
function PitchData({ tracking }: { tracking: WpblPitchTracking[] }) {
  const pitches = useMemo(
    () => tracking.filter(t => t.release_speed != null && (t.kind == null || t.kind === 'pitch')),
    [tracking],
  )
  if (pitches.length === 0) {
    return <EmptyBody title="No pitch tracking" hint="TrackMan velocity & spin data appears here when available." />
  }
  const speeds = pitches.map(p => p.release_speed!).filter(v => v > 0)
  const spins = pitches.map(p => p.spin_rate_rpm).filter((v): v is number => v != null && v > 0)
  const avg = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null)
  const unit = pitches.find(p => p.speed_unit)?.speed_unit ?? 'mph'
  const fastest = [...pitches].sort((a, b) => (b.release_speed ?? 0) - (a.release_speed ?? 0)).slice(0, 8)
  const tile = (label: string, value: string) => (
    <Box sx={{ textAlign: 'center', flex: 1, minWidth: 68 }}>
      <Typography sx={{ fontSize: '1.15rem', fontWeight: 800, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>{value}</Typography>
      <Typography sx={{ fontSize: '0.58rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'text.disabled' }}>{label}</Typography>
    </Box>
  )
  return (
    <Box sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', gap: 1.5, mb: 2.5, flexWrap: 'wrap' }}>
        {tile('Pitches', String(pitches.length))}
        {tile(`Avg ${unit}`, avg(speeds) != null ? avg(speeds)!.toFixed(1) : '—')}
        {tile(`Top ${unit}`, speeds.length ? Math.max(...speeds).toFixed(1) : '—')}
        {tile('Avg spin', avg(spins) != null ? `${Math.round(avg(spins)!)}` : '—')}
      </Box>
      <Typography sx={{ fontSize: '0.68rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: 'text.secondary', mb: 1 }}>
        Hardest thrown
      </Typography>
      <Box sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {fastest.map((p, i) => (
          <Box key={p.activity_id} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 0.55, borderTop: i === 0 ? 'none' : '1px solid', borderColor: 'divider', fontSize: '0.82rem' }}>
            <Box sx={{ width: 18, color: 'text.disabled', fontSize: '0.72rem' }}>{i + 1}</Box>
            <Box sx={{ flex: 1, fontWeight: 700 }}>{p.release_speed!.toFixed(1)} <Box component="span" sx={{ fontSize: '0.66rem', color: 'text.disabled', fontWeight: 600 }}>{unit}</Box></Box>
            <Box sx={{ color: 'text.secondary', fontSize: '0.75rem' }}>{p.spin_rate_rpm != null ? `${Math.round(p.spin_rate_rpm)} rpm` : ''}</Box>
          </Box>
        ))}
      </Box>
      <Typography sx={{ fontSize: '0.66rem', color: 'text.disabled', mt: 2 }}>
        {tracking.length} tracked events · TrackMan
      </Typography>
    </Box>
  )
}

function EmptyBody({ title, hint }: { title: string; hint: string }) {
  return (
    <Box sx={{ textAlign: 'center', py: 5, px: 2, color: 'text.secondary' }}>
      <Typography sx={{ fontSize: '0.95rem', fontWeight: 700, mb: 0.5 }}>{title}</Typography>
      <Typography sx={{ fontSize: '0.82rem', color: 'text.disabled' }}>{hint}</Typography>
    </Box>
  )
}

// ─── Modal root ────────────────────────────────────────────────────────────────
export default function GameDetailModal({ game: seed, teams, onClose, onOpenPlayer }: {
  game: WpblGame
  teams: WpblTeam[]
  onClose: () => void
  onOpenPlayer?: (p: WpblPlayer) => void
}) {
  const game = useLiveGame(seed)  // fresh score + live_state while the game is live
  const byId = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])
  const home = byId.get(game.home_team_id)
  const away = byId.get(game.away_team_id)

  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('box')
  const [lines, setLines] = useState<{ batting: WpblBattingLine[]; pitching: WpblPitchingLine[]; fielding: WpblFieldingLine[] }>({ batting: [], pitching: [], fielding: [] })
  const [plays, setPlays] = useState<WpblGamePlay[]>([])
  const [tracking, setTracking] = useState<WpblPitchTracking[]>([])
  const [names, setNames] = useState<Map<string, WpblPlayer>>(new Map())

  const reload = useCallback((withSpinner = false) => {
    if (withSpinner) setLoading(true)
    let cancelled = false
    Promise.all([
      away ? fetchWpblRoster(away.id) : Promise.resolve([]),
      home ? fetchWpblRoster(home.id) : Promise.resolve([]),
      fetchWpblGameLines(seed.id),
      fetchWpblGamePlays(seed.id),
      fetchWpblGameTracking(seed.id),
    ]).then(([a, h, l, pl, tr]) => {
      if (cancelled) return
      setNames(new Map([...a, ...h].map(p => [p.id, p])))
      setLines(l); setPlays(pl); setTracking(tr)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [seed.id, away?.id, home?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => reload(true), [reload])

  // While the game is live, keep the box score + play-by-play fresh (poll + realtime).
  useEffect(() => {
    if (game.status !== 'live') return
    const poll = setInterval(() => reload(false), 5000)
    const ch = supabase.channel(`wpbl-gc-${seed.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wpbl_game_plays', filter: `game_id=eq.${seed.id}` }, () => reload(false))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wpbl_batting_lines', filter: `game_id=eq.${seed.id}` }, () => reload(false))
      .subscribe()
    return () => { clearInterval(poll); supabase.removeChannel(ch) }
  }, [game.status, seed.id, reload])

  const final = game.status === 'final' && game.home_score != null && game.away_score != null
  const live = game.status === 'live'
  const hasLines = lines.batting.length > 0 || lines.pitching.length > 0
  const awayWon = final && (game.away_score ?? 0) > (game.home_score ?? 0)
  const homeWon = final && (game.home_score ?? 0) > (game.away_score ?? 0)
  const dateLabel = new Date(`${game.game_date}T00:00:00`).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
  const showScore = final || live

  const scoreLine = (team: WpblTeam | undefined, score: number | null, won: boolean) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      {team && <TeamBadge team={team} size={30} />}
      <Typography sx={{ flex: 1, fontSize: '1rem', fontWeight: won ? 800 : 600 }}>{team ? wpblFullName(team) : ''}</Typography>
      {showScore && <Typography sx={{ fontSize: '1.25rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: won ? 'text.primary' : 'text.secondary' }}>{score ?? 0}</Typography>}
    </Box>
  )

  const tabs = [
    { value: 'box' as Tab, label: 'Box Score' },
    { value: 'plays' as Tab, label: 'Play-by-Play' },
    ...(tracking.length > 0 ? [{ value: 'pitch' as Tab, label: 'Pitch Data' }] : []),
  ]

  return (
    <ModalShell
      eyebrow={final ? `Final${game.innings && game.innings !== 7 ? ` / ${game.innings}` : ''}` : live ? '● Live' : `${dateLabel}${game.start_time ? ` · ${formatGameTime(game.game_date, game.start_time)}` : ''}`}
      onClose={onClose}
      maxWidth={720}
    >
      {/* Score block */}
      <Box sx={{ p: 2, pb: showScore ? 1.5 : 2, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          {scoreLine(away, game.away_score, awayWon)}
          {scoreLine(home, game.home_score, homeWon)}
        </Box>
        {game.venue && <Typography sx={{ fontSize: '0.72rem', color: 'text.disabled', mt: 1 }}>{game.venue}</Typography>}
      </Box>

      {/* Live situation banner (inning / count / bases / matchup) */}
      {live && game.live_state && away && home && <LiveBanner state={game.live_state} away={away} home={home} />}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
      ) : hasLines ? (
        <>
          {/* Line score always shows above the tabs for a played game. */}
          {showScore && away && home && (
            <Box sx={{ borderBottom: '1px solid', borderColor: 'divider', pt: 1.5 }}>
              <LineScore away={away} home={home} game={game} />
            </Box>
          )}

          <Box sx={{ pt: 2 }}>
            <SegNav options={tabs} value={tab} onChange={v => setTab(v as Tab)} />
          </Box>

          {tab === 'box' && (
            <Box sx={{ px: 2, pb: 2 }}>
              {away && <TeamBox team={away} batting={lines.batting.filter(b => b.team_id === away.id)} pitching={lines.pitching.filter(p => p.team_id === away.id)} fielding={lines.fielding.filter(f => f.team_id === away.id)} names={names} onOpenPlayer={onOpenPlayer} />}
              {home && <TeamBox team={home} batting={lines.batting.filter(b => b.team_id === home.id)} pitching={lines.pitching.filter(p => p.team_id === home.id)} fielding={lines.fielding.filter(f => f.team_id === home.id)} names={names} onOpenPlayer={onOpenPlayer} />}
            </Box>
          )}
          {tab === 'plays' && <PlayByPlay plays={plays} teams={byId} />}
          {tab === 'pitch' && <PitchData tracking={tracking} />}
        </>
      ) : (
        <Box sx={{ p: 2 }}>
          <EmptyBody
            title={final ? 'Box score not available yet' : 'This game has not been played yet'}
            hint={final ? 'The feed has not posted a box score for this game.' : 'Check back after first pitch.'}
          />
        </Box>
      )}
    </ModalShell>
  )
}

// ─── styles ────────────────────────────────────────────────────────────────────
const rowSx = { alignItems: 'center', px: 0.5, py: 0.6 } as const
const headSx = { fontSize: '0.62rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.3, color: 'text.disabled' } as const
const nameColSx = { minWidth: 150, maxWidth: 200, fontSize: '0.82rem', pr: 1 } as const
const statColSx = { width: 40, textAlign: 'center', fontSize: '0.82rem', flexShrink: 0 } as const

const lsRowSx = { px: 0.5, py: 0.4 } as const
const lsHeadSx = { fontSize: '0.62rem', fontWeight: 800, color: 'text.disabled' } as const
const lsTeamSx = { width: 64, display: 'flex', alignItems: 'center', fontSize: '0.8rem', flexShrink: 0 } as const
const lsCellSx = { width: 24, textAlign: 'center', fontSize: '0.8rem', flexShrink: 0, color: 'text.secondary' } as const
const lsTotSx = { width: 28, textAlign: 'center', fontSize: '0.8rem', flexShrink: 0 } as const
