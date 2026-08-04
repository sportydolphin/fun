import { useCallback, useEffect, useMemo, useState } from 'react'
import { Box, Typography, CircularProgress } from '@mui/material'
import { supabase } from '../lib/supabase'
import { fetchWpblRoster, fetchWpblGameLines, fetchWpblGamePlays, fetchWpblGameTracking } from './api'
import { wpblAccent, wpblFullName, outsToIp, formatGameTime } from './constants'
import { LiveBanner, useLiveGame } from './Live'
import { ModalShell, SegNav, TeamBadge, useWpblDark } from './ui'
import type {
  WpblTeam, WpblGame, WpblPlayer, WpblBattingLine, WpblPitchingLine,
  WpblGamePlay, WpblPitchTracking,
} from './types'

// Read-only game center. Fed entirely by the official-feed mirror (see wpbl-ingest):
// line score, a tabbed box score (batting / pitching, one team at a time), the
// play-by-play, and TrackMan pitch tracking. Player names open the player page. For an
// unplayed game it shows the matchup + first-pitch time.

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

// ─── Table primitives (real <table> = auto-aligned columns that fill the width) ──
// Stat columns carry no fixed width, so with a shrink-to-fit name column they split
// the remaining width evenly and spread across the middle instead of hugging the edge.
function StatHead({ children, w = 30 }: { children: React.ReactNode; w?: number }) {
  return (
    <Box component="th" sx={{
      fontSize: '0.64rem', fontWeight: 700, color: 'text.disabled',
      textTransform: 'uppercase', letterSpacing: 0.4,
      textAlign: 'center', px: 0.4, py: 0.5, minWidth: w,
    }}>
      {children}
    </Box>
  )
}
function StatCell({ children, bold = false }: { children: React.ReactNode; bold?: boolean }) {
  return (
    <Box component="td" sx={{
      fontSize: '0.9rem', fontWeight: bold ? 800 : 600, color: 'text.primary',
      textAlign: 'center', px: 0.4, py: 0.5, lineHeight: 1.2, fontVariantNumeric: 'tabular-nums',
    }}>
      {children}
    </Box>
  )
}

// ─── Line score ────────────────────────────────────────────────────────────────
function LineScore({ away, home, game }: { away: WpblTeam; home: WpblTeam; game: WpblGame }) {
  const innings = Math.max(game.away_line?.length ?? 0, game.home_line?.length ?? 0, 7)
  const cols = Array.from({ length: innings }, (_, i) => i + 1)
  const runsByInning = (line: WpblGame['away_line'], n: number) =>
    line?.find(c => c.inning === n)?.runs
  const row = (team: WpblTeam, line: WpblGame['away_line'], runs: number | null, hits: number | null | undefined, errs: number | null | undefined, won: boolean) => (
    <Box component="tr" sx={{ borderTop: '1px solid', borderColor: 'divider' }}>
      <Box component="td" sx={{ py: 0.45 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
          <TeamBadge team={team} size={18} />
          <Typography sx={{ fontSize: '0.72rem', fontWeight: won ? 800 : 600, lineHeight: 1 }}>{team.abbr}</Typography>
        </Box>
      </Box>
      {cols.map(n => { const r = runsByInning(line, n); return <StatCell key={n}>{r == null ? '' : r}</StatCell> })}
      <Box component="td" sx={{ width: 8 }} />
      <StatCell bold>{runs ?? 0}</StatCell>
      <StatCell>{hits ?? 0}</StatCell>
      <StatCell>{errs ?? 0}</StatCell>
    </Box>
  )
  const awayWon = (game.away_score ?? 0) > (game.home_score ?? 0)
  const homeWon = (game.home_score ?? 0) > (game.away_score ?? 0)
  return (
    <Box sx={{ overflowX: 'auto', px: 2, pb: 1.5 }}>
      <Box component="table" sx={lineTableSx}>
        <Box component="thead">
          <Box component="tr">
            <Box component="th" sx={{ minWidth: 44 }} />
            {cols.map(n => <StatHead key={n} w={18}>{n}</StatHead>)}
            <Box component="th" sx={{ width: 8 }} />
            <StatHead w={22}>R</StatHead>
            <StatHead w={22}>H</StatHead>
            <StatHead w={22}>E</StatHead>
          </Box>
        </Box>
        <Box component="tbody">
          {row(away, game.away_line, game.away_score, game.away_hits, game.away_errors, awayWon)}
          {row(home, game.home_line, game.home_score, game.home_hits, game.home_errors, homeWon)}
        </Box>
      </Box>
    </Box>
  )
}

// ─── One team's box score (batting + pitching) ─────────────────────────────────
function TeamBox({ team, batting, pitching, names, onOpenPlayer }: {
  team: WpblTeam
  batting: WpblBattingLine[]
  pitching: WpblPitchingLine[]
  names: Map<string, WpblPlayer>
  onOpenPlayer?: (p: WpblPlayer) => void
}) {
  const isDark = useWpblDark()
  const color = wpblAccent(team.id, isDark)
  const nameCell = (playerId: string, suffix?: React.ReactNode) => {
    const p = names.get(playerId)
    const clickable = p && onOpenPlayer
    return (
      <Box component="td" sx={nameCellSx}>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5, overflow: 'hidden' }}>
          <Typography
            component="span"
            onClick={clickable ? () => onOpenPlayer!(p!) : undefined}
            sx={{ fontSize: '0.86rem', fontWeight: 600, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', ...(clickable ? { cursor: 'pointer', '&:hover': { color } } : {}) }}
          >
            {p?.name ?? '—'}
          </Typography>
          {suffix}
        </Box>
      </Box>
    )
  }
  const batTotals = batting.reduce((t, b) => {
    for (const c of BAT_COLS) (t as any)[c.key] = ((t as any)[c.key] ?? 0) + (Number(b[c.key]) || 0)
    return t
  }, {} as Record<string, number>)

  if (batting.length === 0 && pitching.length === 0) return null

  return (
    <Box>
      {batting.length > 0 && (
        <Box sx={{ overflowX: 'auto', mb: 1.5 }}>
          <Box component="table" sx={tableSx}>
            <Box component="thead">
              <Box component="tr">
                <Box component="th" sx={nameHeadSx}>Batting</Box>
                {BAT_COLS.map(c => <StatHead key={c.key as string}>{c.label}</StatHead>)}
              </Box>
            </Box>
            <Box component="tbody">
              {batting.map(b => (
                <Box component="tr" key={b.id} sx={{ borderTop: '1px solid', borderColor: 'divider' }}>
                  {nameCell(b.player_id, b.position ? <Typography component="span" sx={posSx}>{b.position}</Typography> : null)}
                  {BAT_COLS.map(c => <StatCell key={c.key as string} bold={c.key === 'h'}>{Number(b[c.key]) || 0}</StatCell>)}
                </Box>
              ))}
              <Box component="tr" sx={{ borderTop: '2px solid', borderColor: color }}>
                <Box component="td" sx={{ ...nameHeadSx, color: 'text.secondary', fontSize: '0.8rem', fontWeight: 800, textTransform: 'none', letterSpacing: 0 }}>Totals</Box>
                {BAT_COLS.map(c => <StatCell key={c.key as string} bold>{batTotals[c.key as string] ?? 0}</StatCell>)}
              </Box>
            </Box>
          </Box>
        </Box>
      )}

      {pitching.length > 0 && (
        <Box sx={{ overflowX: 'auto' }}>
          <Box component="table" sx={tableSx}>
            <Box component="thead">
              <Box component="tr">
                <Box component="th" sx={nameHeadSx}>Pitching</Box>
                <StatHead w={32}>IP</StatHead>
                {PIT_COLS.map(c => <StatHead key={c.key as string}>{c.label}</StatHead>)}
              </Box>
            </Box>
            <Box component="tbody">
              {pitching.map(p => (
                <Box component="tr" key={p.id} sx={{ borderTop: '1px solid', borderColor: 'divider' }}>
                  {nameCell(p.player_id, p.decision ? <Typography component="span" sx={{ fontSize: '0.56rem', fontWeight: 800, color, lineHeight: 1 }}>({p.decision})</Typography> : null)}
                  <StatCell bold>{outsToIp(p.outs)}</StatCell>
                  {PIT_COLS.map(c => <StatCell key={c.key as string}>{p[c.key] == null ? '—' : Number(p[c.key])}</StatCell>)}
                </Box>
              ))}
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  )
}

// ─── Play-by-play ──────────────────────────────────────────────────────────────
function PlayByPlay({ plays, teams }: { plays: WpblGamePlay[]; teams: Map<string, WpblTeam> }) {
  // Group consecutive plays into half-innings, in order.
  const groups = useMemo(() => {
    const gs: { key: string; label: string; teamId: string | null; runs: number; plays: WpblGamePlay[] }[] = []
    for (const p of plays) {
      const key = `${p.inning}-${p.half}`
      const last = gs[gs.length - 1]
      if (!last || last.key !== key) {
        const half = p.half === 'top' ? 'Top' : 'Bottom'
        const ord = p.inning === 1 ? '1st' : p.inning === 2 ? '2nd' : p.inning === 3 ? '3rd' : `${p.inning}th`
        gs.push({ key, label: `${half} ${ord}`, teamId: p.team_id, runs: p.runs_scored, plays: [p] })
      } else { last.plays.push(p); last.runs += p.runs_scored }
    }
    return gs
  }, [plays])

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const toggle = (key: string) => setCollapsed(prev => {
    const next = new Set(prev)
    next.has(key) ? next.delete(key) : next.add(key)
    return next
  })

  if (plays.length === 0) {
    return <EmptyBody title="No play-by-play yet" hint="The feed's play log appears here once the game begins." />
  }
  return (
    <Box sx={{ p: 2 }}>
      {groups.map(g => {
        const team = g.teamId ? teams.get(g.teamId) : undefined
        const open = !collapsed.has(g.key)
        return (
          <Box key={g.key} sx={{ mb: 1.25 }}>
            <Box
              onClick={() => toggle(g.key)}
              sx={{
                display: 'flex', alignItems: 'center', gap: 0.75, cursor: 'pointer',
                position: 'sticky', top: 0, bgcolor: 'background.paper', py: 0.5, zIndex: 1,
                borderBottom: '1px solid', borderColor: 'divider',
                '&:hover .pbpChevron': { color: 'text.secondary' },
              }}
            >
              <Box className="pbpChevron" sx={{
                fontSize: '0.6rem', color: 'text.disabled', width: 12, flexShrink: 0,
                transition: 'transform 0.15s', transform: open ? 'rotate(90deg)' : 'none',
              }}>▶</Box>
              {team && <TeamBadge team={team} size={18} />}
              <Typography sx={{ fontSize: '0.68rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: 'text.secondary' }}>
                {g.label}{team ? ` · ${team.abbr} batting` : ''}
              </Typography>
              {g.runs > 0 && (
                <Box component="span" sx={{ ml: 'auto', fontSize: '0.62rem', fontWeight: 800, color: '#16a34a' }}>
                  {g.runs} {g.runs === 1 ? 'run' : 'runs'}
                </Box>
              )}
            </Box>
            {open && (
              <Box sx={{ mt: 0.75 }}>
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
            )}
          </Box>
        )
      })}
    </Box>
  )
}

// ─── Pitch data (TrackMan) ─────────────────────────────────────────────────────
type BoxPitcher = { name: string; teamAbbr: string; outs: number; pitches: number | null }
const normName = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()

function PitchData({ tracking, boxPitchers }: { tracking: WpblPitchTracking[]; boxPitchers: BoxPitcher[] }) {
  const pitches = useMemo(
    () => tracking.filter(t => t.release_speed != null && (t.kind == null || t.kind === 'pitch')),
    [tracking],
  )
  // Attribution: the tracking `play_id` is the FEED's play id (not our plays row), so we
  // can't join to wpbl_game_plays. The pitcher name lives in each event's raw payload
  // ("Last, First"); reconciliation events omit it, so fill from a sibling of the same
  // play_id. The remaining nameless pitches are almost always the starters the feed never
  // named (their whole outing is unnamed) — see the single-candidate rescue below.
  const pitcherFor = useMemo(() => {
    const fmt = (n: string) => {
      const [last, first] = n.split(',').map(s => s.trim())
      return first ? `${first} ${last}` : n
    }
    const rawName = (t: WpblPitchTracking) => {
      const nm = (t.raw as { pitcher_name?: string | null } | null)?.pitcher_name
      return nm ? fmt(nm) : null
    }
    const byPlay = new Map<string, string>()
    for (const t of tracking) {
      const nm = rawName(t)
      if (t.play_id && nm && !byPlay.has(t.play_id)) byPlay.set(t.play_id, nm)
    }
    return (t: WpblPitchTracking) => rawName(t) ?? (t.play_id ? byPlay.get(t.play_id) : null) ?? null
  }, [tracking])

  const avg = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null)
  const unit = pitches.find(p => p.speed_unit)?.speed_unit ?? 'mph'

  // Aggregate TrackMan velo/spin by attributed name, plus an "unattributed" bucket.
  // Then merge onto the box-score pitcher list (the authoritative who-pitched, with real
  // names + IP/P). If EXACTLY ONE box pitcher has no tracking, the whole unattributed
  // bucket must be theirs — attribute it (reliable). Otherwise leave it as a footnote.
  const { rows, resolvedName, unattributed, fastest } = useMemo(() => {
    type Agg = { count: number; speeds: number[]; spins: number[] }
    const blank = (): Agg => ({ count: 0, speeds: [], spins: [] })
    const add = (a: Agg, p: WpblPitchTracking) => {
      a.count++
      if (p.release_speed != null && p.release_speed > 0) a.speeds.push(p.release_speed)
      if (p.spin_rate_rpm != null && p.spin_rate_rpm > 0) a.spins.push(p.spin_rate_rpm)
    }
    const byName = new Map<string, Agg>()
    const unatt = blank()
    for (const p of pitches) {
      const nm = pitcherFor(p)
      if (nm) { const k = normName(nm); const e = byName.get(k) ?? blank(); add(e, p); byName.set(k, e) }
      else add(unatt, p)
    }
    const missing = boxPitchers.filter(bp => !byName.has(normName(bp.name)))
    const resolved = missing.length === 1 && unatt.count > 0 ? missing[0].name : null

    const rws = boxPitchers.map(bp => {
      const agg = byName.get(normName(bp.name)) ?? (resolved && bp.name === resolved ? unatt : null)
      return { ...bp, agg }
    }).sort((a, b) => a.teamAbbr === b.teamAbbr ? b.outs - a.outs : a.teamAbbr.localeCompare(b.teamAbbr))

    const fast = [...pitches].sort((a, b) => (b.release_speed ?? 0) - (a.release_speed ?? 0)).slice(0, 8)
    return { rows: rws, resolvedName: resolved, unattributed: resolved ? 0 : unatt.count, fastest: fast }
  }, [pitches, pitcherFor, boxPitchers])

  const labelFor = (t: WpblPitchTracking) => pitcherFor(t) ?? resolvedName ?? 'Unattributed'

  if (pitches.length === 0) {
    return <EmptyBody title="No pitch tracking" hint="TrackMan velocity & spin data appears here when available." />
  }
  const speeds = pitches.map(p => p.release_speed!).filter(v => v > 0)
  const spins = pitches.map(p => p.spin_rate_rpm).filter((v): v is number => v != null && v > 0)
  const tile = (label: string, value: string) => (
    <Box sx={{ textAlign: 'center', flex: 1, minWidth: 68 }}>
      <Typography sx={{ fontSize: '1.15rem', fontWeight: 800, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>{value}</Typography>
      <Typography sx={{ fontSize: '0.58rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'text.disabled' }}>{label}</Typography>
    </Box>
  )
  const sectionLabel = (t: string) => (
    <Typography sx={{ fontSize: '0.68rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: 'text.secondary', mb: 1 }}>{t}</Typography>
  )
  return (
    <Box sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', gap: 1.5, mb: 2.5, flexWrap: 'wrap' }}>
        {tile('Pitches', String(pitches.length))}
        {tile(`Avg ${unit}`, avg(speeds) != null ? avg(speeds)!.toFixed(1) : '—')}
        {tile(`Top ${unit}`, speeds.length ? Math.max(...speeds).toFixed(1) : '—')}
        {tile('Avg spin', avg(spins) != null ? `${Math.round(avg(spins)!)}` : '—')}
      </Box>

      {rows.length > 0 && (
        <>
          {sectionLabel('By pitcher')}
          <Box component="table" sx={{ ...tableSx, mb: unattributed > 0 ? 1 : 2.5 }}>
            <Box component="thead">
              <Box component="tr">
                <Box component="th" sx={nameHeadSx}>Pitcher</Box>
                <StatHead w={36}>IP</StatHead>
                <StatHead w={30}>P</StatHead>
                <StatHead w={40}>Avg</StatHead>
                <StatHead w={40}>Top</StatHead>
                <StatHead w={44}>Spin</StatHead>
              </Box>
            </Box>
            <Box component="tbody">
              {rows.map(r => {
                const a = r.agg
                return (
                  <Box component="tr" key={`${r.teamAbbr}-${r.name}`} sx={{ borderTop: '1px solid', borderColor: 'divider' }}>
                    <Box component="td" sx={{ ...nameCellSx, overflow: 'hidden' }}>
                      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5, overflow: 'hidden' }}>
                        <Typography component="span" sx={{ fontSize: '0.86rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</Typography>
                        <Typography component="span" sx={{ ...posSx, textTransform: 'uppercase' }}>{r.teamAbbr}</Typography>
                      </Box>
                    </Box>
                    <StatCell>{outsToIp(r.outs)}</StatCell>
                    <StatCell>{r.pitches ?? '—'}</StatCell>
                    <StatCell>{a && avg(a.speeds) != null ? avg(a.speeds)!.toFixed(1) : '—'}</StatCell>
                    <StatCell bold>{a && a.speeds.length ? Math.max(...a.speeds).toFixed(1) : '—'}</StatCell>
                    <StatCell>{a && avg(a.spins) != null ? Math.round(avg(a.spins)!) : '—'}</StatCell>
                  </Box>
                )
              })}
            </Box>
          </Box>
          {unattributed > 0 && (
            <Typography sx={{ fontSize: '0.66rem', color: 'text.disabled', mb: 2.5 }}>
              Avg / Top / Spin come from TrackMan. {unattributed} tracked pitches (the feed left them unnamed — usually a starter) couldn't be matched to a pitcher.
            </Typography>
          )}
        </>
      )}

      {sectionLabel(`Hardest thrown (${unit})`)}
      <Box sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {fastest.map((p, i) => (
          <Box key={p.activity_id} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 0.55, borderTop: i === 0 ? 'none' : '1px solid', borderColor: 'divider', fontSize: '0.82rem' }}>
            <Box sx={{ width: 18, color: 'text.disabled', fontSize: '0.72rem', flexShrink: 0 }}>{i + 1}</Box>
            <Box sx={{ width: 52, fontWeight: 800, flexShrink: 0 }}>{p.release_speed!.toFixed(1)}</Box>
            <Box sx={{ flex: 1, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{labelFor(p)}</Box>
            <Box sx={{ color: 'text.secondary', fontSize: '0.75rem', flexShrink: 0 }}>{p.spin_rate_rpm != null ? `${Math.round(p.spin_rate_rpm)} rpm` : ''}</Box>
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

// ─── Team switch (underline tabs — deliberately distinct from the pill SegNav) ──
function TeamSwitch({ away, home, value, onChange }: {
  away: WpblTeam; home: WpblTeam
  value: 'away' | 'home'; onChange: (v: 'away' | 'home') => void
}) {
  const isDark = useWpblDark()
  const tab = (side: 'away' | 'home', team: WpblTeam) => {
    const active = value === side
    const color = wpblAccent(team.id, isDark)
    return (
      <Box
        onClick={() => onChange(side)}
        sx={{
          display: 'flex', alignItems: 'center', gap: 0.75, cursor: 'pointer',
          px: 0.25, pb: 1, mb: '-1px', borderBottom: '2px solid',
          borderColor: active ? color : 'transparent',
          opacity: active ? 1 : 0.5, transition: 'opacity 0.15s',
          '&:hover': { opacity: active ? 1 : 0.8 },
        }}
      >
        <TeamBadge team={team} size={26} />
        <Typography sx={{ fontSize: '1rem', fontWeight: active ? 800 : 600 }}>{wpblFullName(team)}</Typography>
      </Box>
    )
  }
  return (
    <Box sx={{ display: 'flex', gap: 3, borderBottom: '1px solid', borderColor: 'divider', mb: 1.5 }}>
      {tab('away', away)}
      {tab('home', home)}
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
  const [boxTeam, setBoxTeam] = useState<'away' | 'home'>('away')
  const [lines, setLines] = useState<{ batting: WpblBattingLine[]; pitching: WpblPitchingLine[] }>({ batting: [], pitching: [] })
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
      setLines({ batting: l.batting, pitching: l.pitching }); setPlays(pl); setTracking(tr)
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

  // The authoritative pitcher list (real names + IP/P) that the Pitch Data tab merges
  // TrackMan velo/spin onto — see PitchData.
  const boxPitchers = useMemo(() => lines.pitching.map(p => ({
    name: names.get(p.player_id)?.name ?? '—',
    teamAbbr: byId.get(p.team_id)?.abbr ?? '',
    outs: p.outs,
    pitches: p.pitches,
  })), [lines.pitching, names, byId])

  return (
    <ModalShell
      eyebrow={final ? `Final${game.innings && game.innings !== 7 ? ` / ${game.innings}` : ''}` : live ? '● Live' : `${dateLabel}${game.start_time ? ` · ${formatGameTime(game.game_date, game.start_time)}` : ''}`}
      onClose={onClose}
      maxWidth={720}
      fillHeight={showScore}
    >
      {/* Full-height flex column: everything above the panel is fixed; only the tab
          panel scrolls, so the modal height stays constant when switching tabs. */}
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
        {/* Score block */}
        <Box sx={{ flexShrink: 0, p: 2, pb: showScore ? 1.5 : 2, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
            {scoreLine(away, game.away_score, awayWon)}
            {scoreLine(home, game.home_score, homeWon)}
          </Box>
          {game.venue && <Typography sx={{ fontSize: '0.72rem', color: 'text.disabled', mt: 1 }}>{game.venue}</Typography>}
        </Box>

        {/* Live situation banner (inning / count / bases / matchup) */}
        {live && game.live_state && away && home && (
          <Box sx={{ flexShrink: 0 }}><LiveBanner state={game.live_state} away={away} home={home} /></Box>
        )}

        {loading ? (
          <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><CircularProgress /></Box>
        ) : hasLines ? (
          <>
            {/* Line score always shows above the tabs for a played game. */}
            {showScore && away && home && (
              <Box sx={{ flexShrink: 0, borderBottom: '1px solid', borderColor: 'divider', pt: 1.5 }}>
                <LineScore away={away} home={home} game={game} />
              </Box>
            )}

            <Box sx={{ flexShrink: 0, pt: 1.25 }}>
              <SegNav options={tabs} value={tab} onChange={v => setTab(v as Tab)} />
            </Box>

            {/* Scroll region — fixed height, one per tab. */}
            <Box sx={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
              {tab === 'box' && away && home && (() => {
                const shown = boxTeam === 'home' ? home : away
                return (
                  <Box sx={{ px: 2, pb: 2, pt: 1.25 }}>
                    <TeamSwitch away={away} home={home} value={boxTeam} onChange={setBoxTeam} />
                    <TeamBox
                      team={shown}
                      batting={lines.batting.filter(b => b.team_id === shown.id)}
                      pitching={lines.pitching.filter(p => p.team_id === shown.id)}
                      names={names}
                      onOpenPlayer={onOpenPlayer}
                    />
                  </Box>
                )
              })()}
              {tab === 'plays' && <PlayByPlay plays={plays} teams={byId} />}
              {tab === 'pitch' && <PitchData tracking={tracking} boxPitchers={boxPitchers} />}
            </Box>
          </>
        ) : (
          <Box sx={{ flex: 1, p: 2 }}>
            <EmptyBody
              title={final ? 'Box score not available yet' : 'This game has not been played yet'}
              hint={final ? 'The feed has not posted a box score for this game.' : 'Check back after first pitch.'}
            />
          </Box>
        )}
      </Box>
    </ModalShell>
  )
}

// ─── styles ────────────────────────────────────────────────────────────────────
// Box tables (batting / pitching / by-pitcher): table-layout:fixed so the name column
// takes a set width and the width-less stat columns divide the rest EVENLY — fills the
// modal with no dead gap. minWidth (px) lets the wrapper scroll on narrow phones.
// (Don't mix `min-width:max-content` with %/fixed cell widths — it blows the table up.)
const tableSx = { tableLayout: 'fixed', borderCollapse: 'collapse', width: '100%', minWidth: 480, fontVariantNumeric: 'tabular-nums' } as const
const NAME_W = 150
const nameHeadSx = { width: NAME_W, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.6rem', fontWeight: 700, color: 'text.disabled', textTransform: 'uppercase', letterSpacing: 0.4, px: 0.4, py: 0.5 } as const
const nameCellSx = { width: NAME_W, maxWidth: NAME_W, textAlign: 'left', px: 0.4, py: 0.5 } as const
const posSx = { fontSize: '0.6rem', color: 'text.disabled', lineHeight: 1, flexShrink: 0 } as const
// Line score keeps MLB's auto layout (team column absorbs slack; R/H/E hug the right).
const lineTableSx = { borderCollapse: 'collapse', width: '100%', minWidth: 'max-content', fontVariantNumeric: 'tabular-nums' } as const
