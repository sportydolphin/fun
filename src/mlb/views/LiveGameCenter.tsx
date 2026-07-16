import React, { useState, useEffect, useCallback } from 'react'
import { Box, Typography } from '@mui/material'
import { TEAM_BG, TEAM_ABBR, HEADSHOT } from '../constants'
import { useIsDark, accentColor, borderAlpha, photoBorderAlpha } from '../colorUtils'
import {
  FinalGameSummary, BoxScore, parseBoxScoreData,
  LogoBubble, LiveDot, SectionLabel, LineScoreTable, TeamBoxSection,
} from './FinalGames'

// ─── Types ────────────────────────────────────────────────────────────────────

interface GcTeam {
  teamId: number
  abbr:   string
  name:   string
  runs:   number
  hits:   number
  errors: number
}

interface GcMatchupPlayer {
  id:    number
  name:  string
  line1: string   // today's line: "2-3 today" / "5.1 IP · 6 K"
  line2: string   // season context: "AVG .312 · OPS .901" / "72 pitches · ERA 3.21"
}

interface GcSituation {
  batter:        GcMatchupPlayer | null
  pitcher:       GcMatchupPlayer | null
  onFirst:       boolean
  onSecond:      boolean
  onThird:       boolean
  balls:          number
  strikes:        number
  outs:           number
  battingTeamId:  number
  fieldingTeamId: number
}

interface GcPlay {
  atBatIndex:    number
  inning:        number
  half:          'top' | 'bottom'
  isScoring:     boolean
  event:         string
  description:   string
  awayScore:     number
  homeScore:     number
  battingTeamId: number
}

interface GameCenterData {
  state:      'preview' | 'live' | 'final'
  statusText: string
  away:       GcTeam
  home:       GcTeam
  situation:  GcSituation | null   // only while live
  plays:      GcPlay[]             // chronological
  box:        BoxScore
}

interface WpPoint {
  wp:     number   // home team win probability, 0–100
  inning: number
}

// ─── API ──────────────────────────────────────────────────────────────────────

async function fetchGameCenter(gamePk: number): Promise<GameCenterData | null> {
  try {
    const r  = await fetch(`https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`)
    const d  = await r.json()
    const gd = d.gameData ?? {}
    const ld = d.liveData ?? {}
    const ls = ld.linescore ?? {}

    const abs = gd.status?.abstractGameState
    // Warmup reports "Live" ~20 min before first pitch — treat as preview.
    const state: GameCenterData['state'] =
      abs === 'Final' ? 'final'
      : abs === 'Live' && gd.status?.detailedState !== 'Warmup' ? 'live'
      : 'preview'

    const mkTeam = (side: 'home' | 'away'): GcTeam => {
      const t   = gd.teams?.[side] ?? {}
      const lst = ls.teams?.[side] ?? {}
      const id  = Number(t.id ?? 0)
      return {
        teamId: id,
        abbr:   TEAM_ABBR[id] ?? t.abbreviation ?? '???',
        name:   t.name ?? '',
        runs:   lst.runs   ?? 0,
        hits:   lst.hits   ?? 0,
        errors: lst.errors ?? 0,
      }
    }
    const away = mkTeam('away')
    const home = mkTeam('home')

    let statusText: string
    const ord = ls.currentInningOrdinal
    if (state === 'final') {
      const scheduled = ls.scheduledInnings ?? 9
      const played    = ls.currentInning ?? scheduled
      statusText = played > scheduled ? `Final/${played}` : 'Final'
    } else if (state === 'live' && ord) {
      const st = ls.inningState
      statusText =
        st === 'Middle' ? `Mid ${ord}` :
        st === 'End'    ? `End ${ord}` :
        `${ls.isTopInning ? '▲' : '▼'} ${ord}`
    } else {
      statusText = gd.status?.detailedState ?? '—'
    }

    let situation: GcSituation | null = null
    if (state === 'live') {
      const off     = ls.offense ?? {}
      const def     = ls.defense ?? {}
      const isTop   = Boolean(ls.isTopInning)
      const batSide = isTop ? 'away' : 'home'
      const pitSide = isTop ? 'home' : 'away'
      const batPlayers = ld.boxscore?.teams?.[batSide]?.players ?? {}
      const pitPlayers = ld.boxscore?.teams?.[pitSide]?.players ?? {}

      const mkBatter = (raw: any): GcMatchupPlayer | null => {
        if (!raw?.id) return null
        const p = batPlayers[`ID${raw.id}`] ?? {}
        const g = p.stats?.batting ?? {}
        const s = p.seasonStats?.batting ?? {}
        const ab = g.atBats ?? 0
        return {
          id:    Number(raw.id),
          name:  raw.fullName ?? '—',
          line1: ab > 0 ? `${g.hits ?? 0}-${ab} today` : 'First AB',
          line2: `AVG ${s.avg ?? '—'} · OPS ${s.ops ?? '—'}`,
        }
      }

      const mkPitcher = (raw: any): GcMatchupPlayer | null => {
        if (!raw?.id) return null
        const p = pitPlayers[`ID${raw.id}`] ?? {}
        const g = p.stats?.pitching ?? {}
        const s = p.seasonStats?.pitching ?? {}
        const pitches = g.pitchesThrown ?? g.numberOfPitches
        return {
          id:    Number(raw.id),
          name:  raw.fullName ?? '—',
          line1: `${g.inningsPitched ?? '0.0'} IP · ${g.strikeOuts ?? 0} K`,
          line2: `${pitches != null ? `${pitches} pitches · ` : ''}ERA ${s.era ?? '—'}`,
        }
      }

      situation = {
        batter:        mkBatter(off.batter),
        pitcher:       mkPitcher(def.pitcher),
        onFirst:       Boolean(off.first),
        onSecond:      Boolean(off.second),
        onThird:       Boolean(off.third),
        balls:          ls.balls   ?? 0,
        strikes:        ls.strikes ?? 0,
        outs:           ls.outs    ?? 0,
        battingTeamId:  isTop ? away.teamId : home.teamId,
        fieldingTeamId: isTop ? home.teamId : away.teamId,
      }
    }

    const plays: GcPlay[] = (ld.plays?.allPlays ?? [])
      .filter((p: any) => p.result?.description)
      .map((p: any) => ({
        atBatIndex:    p.about?.atBatIndex ?? 0,
        inning:        p.about?.inning ?? 0,
        half:          p.about?.halfInning === 'bottom' ? 'bottom' as const : 'top' as const,
        isScoring:     Boolean(p.about?.isScoringPlay),
        event:         p.result?.event ?? '',
        description:   p.result?.description ?? '',
        awayScore:     p.result?.awayScore ?? 0,
        homeScore:     p.result?.homeScore ?? 0,
        battingTeamId: p.about?.halfInning === 'bottom' ? home.teamId : away.teamId,
      }))

    const box = parseBoxScoreData(ls, ld.boxscore ?? {})
    return { state, statusText, away, home, situation, plays, box }
  } catch { return null }
}

async function fetchWinProb(gamePk: number): Promise<WpPoint[]> {
  try {
    const r = await fetch(
      `https://statsapi.mlb.com/api/v1/game/${gamePk}/winProbability` +
      `?fields=atBatIndex,homeTeamWinProbability,about,inning`
    )
    const d = await r.json()
    if (!Array.isArray(d)) return []
    return d
      .filter((p: any) => typeof p.homeTeamWinProbability === 'number')
      .map((p: any) => ({ wp: p.homeTeamWinProbability, inning: p.about?.inning ?? 0 }))
  } catch { return [] }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0])
}

// ─── Bases diamond + outs ─────────────────────────────────────────────────────

function BasesDiamond({ onFirst, onSecond, onThird, color, size = 22 }: {
  onFirst: boolean; onSecond: boolean; onThird: boolean; color: string; size?: number
}) {
  const gap = Math.round(size * 0.08)
  const sq = (occupied: boolean) => (
    <Box sx={{
      width: size, height: size,
      transform: 'rotate(45deg)',
      bgcolor: occupied ? color : 'transparent',
      border: `${size >= 12 ? 2 : 1.5}px solid`,
      borderColor: occupied ? color : 'text.disabled',
      borderRadius: '1px',
      transition: 'background-color 0.2s, border-color 0.2s',
    }} />
  )
  return (
    <Box sx={{
      display: 'grid',
      gridTemplateColumns: `repeat(3, ${size}px)`,
      gridTemplateRows: `repeat(2, ${size}px)`,
      gap: `${gap}px`,
      flexShrink: 0,
    }}>
      <Box />{sq(onSecond)}<Box />
      {sq(onThird)}<Box />{sq(onFirst)}
    </Box>
  )
}

function OutsDots({ outs }: { outs: number }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      {[0, 1, 2].map(i => (
        <Box key={i} sx={{
          width: 8, height: 8, borderRadius: '50%',
          bgcolor: i < outs ? '#ef4444' : 'transparent',
          border: '1.5px solid', borderColor: i < outs ? '#ef4444' : 'text.disabled',
        }} />
      ))}
      <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, color: 'text.secondary', ml: 0.25, lineHeight: 1 }}>
        {outs === 1 ? 'OUT' : 'OUTS'}
      </Typography>
    </Box>
  )
}

// ─── Live situation panel ─────────────────────────────────────────────────────

function MatchupCard({ label, player, teamId, onSelect }: {
  label:    string
  player:   GcMatchupPlayer | null
  teamId:   number
  onSelect?: (id: number) => void
}) {
  const isDark = useIsDark()
  const col    = TEAM_BG[teamId] ?? '#444'
  const accent = accentColor(col, isDark)
  return (
    <Box
      onClick={player && onSelect ? () => onSelect(player.id) : undefined}
      sx={{
        flex: 1, minWidth: 0, p: 1.25, borderRadius: 2,
        bgcolor: `${col}10`,
        border: '1px solid', borderColor: borderAlpha(col, isDark),
        display: 'flex', alignItems: 'center', gap: 1,
        cursor: player && onSelect ? 'pointer' : 'default',
        transition: 'border-color 0.15s',
        ...(player && onSelect ? { '&:hover': { borderColor: `${col}60` } } : {}),
      }}
    >
      <Box sx={{
        width: 40, height: 50, borderRadius: 1.5, overflow: 'hidden', flexShrink: 0,
        border: `2px solid ${photoBorderAlpha(col, isDark)}`, bgcolor: 'action.hover',
      }}>
        {player && (
          <Box component="img"
            src={HEADSHOT(player.id)} alt={player.name}
            sx={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 20%', display: 'block' }}
          />
        )}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontSize: '0.54rem', fontWeight: 800, color: accent, textTransform: 'uppercase', letterSpacing: 0.8, lineHeight: 1 }}>
          {label}
        </Typography>
        <Typography sx={{ fontSize: '0.76rem', fontWeight: 800, lineHeight: 1.2, mt: 0.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {player?.name ?? 'TBD'}
        </Typography>
        {player && (
          <>
            <Typography sx={{ fontSize: '0.64rem', fontWeight: 700, color: 'text.primary', lineHeight: 1.2, mt: 0.2 }}>
              {player.line1}
            </Typography>
            <Typography sx={{ fontSize: '0.6rem', color: 'text.secondary', lineHeight: 1.2 }}>
              {player.line2}
            </Typography>
          </>
        )}
      </Box>
    </Box>
  )
}

function SituationPanel({ sit, onPlayerClick }: {
  sit: GcSituation
  onPlayerClick?: (id: number) => void
}) {
  const isDark  = useIsDark()
  const batCol  = accentColor(TEAM_BG[sit.battingTeamId] ?? '#888', isDark)
  return (
    <Box sx={{ px: 2, py: 1.5, borderTop: '1px solid', borderColor: 'divider' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <BasesDiamond onFirst={sit.onFirst} onSecond={sit.onSecond} onThird={sit.onThird} color={batCol} />
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          <Typography sx={{ fontSize: '1rem', fontWeight: 900, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
            {sit.balls}-{sit.strikes}
            <Typography component="span" sx={{ fontSize: '0.6rem', fontWeight: 700, color: 'text.secondary', ml: 0.5 }}>
              COUNT
            </Typography>
          </Typography>
          <OutsDots outs={sit.outs} />
        </Box>
        <Box sx={{ flex: 1 }} />
      </Box>
      <Box sx={{ display: 'flex', gap: 1, mt: 1.25 }}>
        <MatchupCard label="At Bat"   player={sit.batter}  teamId={sit.battingTeamId}  onSelect={onPlayerClick} />
        <MatchupCard label="Pitching" player={sit.pitcher} teamId={sit.fieldingTeamId} onSelect={onPlayerClick} />
      </Box>
    </Box>
  )
}

// ─── Win probability chart ────────────────────────────────────────────────────

function WinProbChart({ pts, away, home }: { pts: WpPoint[]; away: GcTeam; home: GcTeam }) {
  const isDark = useIsDark()
  if (pts.length < 2) return null

  const W = 340, H = 108, PT = 6, PB = 14
  const n = pts.length
  const x = (i: number) => (i / (n - 1)) * W
  const y = (wp: number) => PT + (1 - wp / 100) * (H - PT - PB)
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(p.wp).toFixed(1)}`).join(' ')
  const mid  = y(50)

  const homeCol = accentColor(TEAM_BG[home.teamId] ?? '#888', isDark)
  const awayCol = accentColor(TEAM_BG[away.teamId] ?? '#888', isDark)
  const grid    = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.10)'
  const txt     = isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.4)'

  // First play of each inning → gridline + label
  const inningStarts: Array<{ i: number; inning: number }> = []
  let prev = 0
  pts.forEach((p, i) => {
    if (p.inning !== prev) { inningStarts.push({ i, inning: p.inning }); prev = p.inning }
  })

  const last    = pts[n - 1]
  const leader  = last.wp >= 50 ? home : away
  const leadCol = last.wp >= 50 ? homeCol : awayCol
  const leadPct = Math.round(last.wp >= 50 ? last.wp : 100 - last.wp)

  return (
    <Box sx={{ px: 2, py: 1.5, borderTop: '1px solid', borderColor: 'divider' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
        <SectionLabel>Win Probability</SectionLabel>
        <Typography sx={{ ml: 'auto', fontSize: '0.68rem', fontWeight: 900, color: leadCol, lineHeight: 1 }}>
          {leader.abbr} {leadPct}%
        </Typography>
      </Box>
      <Box component="svg" viewBox={`0 0 ${W} ${H}`} sx={{ width: '100%', height: 'auto', display: 'block' }}>
        <defs>
          <clipPath id="gcWpTop"><rect x={0} y={0} width={W} height={mid} /></clipPath>
          <clipPath id="gcWpBot"><rect x={0} y={mid} width={W} height={H - mid} /></clipPath>
        </defs>
        {inningStarts.map(s => (
          <g key={s.inning}>
            {s.i > 0 && <line x1={x(s.i)} x2={x(s.i)} y1={PT} y2={H - PB} stroke={grid} strokeWidth={1} />}
            <text x={x(s.i) + 2.5} y={H - 3.5} fontSize={7.5} fill={txt}>{s.inning}</text>
          </g>
        ))}
        <line x1={0} x2={W} y1={mid} y2={mid} stroke={grid} strokeWidth={1} strokeDasharray="3 3" />
        <path d={path} fill="none" stroke={homeCol} strokeWidth={2} strokeLinejoin="round" clipPath="url(#gcWpTop)" />
        <path d={path} fill="none" stroke={awayCol} strokeWidth={2} strokeLinejoin="round" clipPath="url(#gcWpBot)" />
        <text x={3} y={PT + 9}      fontSize={8.5} fontWeight={800} fill={homeCol}>{home.abbr}</text>
        <text x={3} y={H - PB - 4} fontSize={8.5} fontWeight={800} fill={awayCol}>{away.abbr}</text>
      </Box>
    </Box>
  )
}

// ─── Play-by-play list ────────────────────────────────────────────────────────

function PlaysList({ plays, away, home, scoringOnly }: {
  plays: GcPlay[]; away: GcTeam; home: GcTeam; scoringOnly: boolean
}) {
  const shown = scoringOnly ? plays.filter(p => p.isScoring) : plays
  if (shown.length === 0) {
    return (
      <Box sx={{ py: 3, textAlign: 'center' }}>
        <Typography sx={{ fontSize: '0.72rem', color: 'text.disabled' }}>
          {scoringOnly ? 'No scoring plays yet' : 'No plays yet'}
        </Typography>
      </Box>
    )
  }

  // Latest first, with a header row whenever the half-inning changes
  const rev = [...shown].reverse()
  let lastKey = ''
  return (
    <Box>
      {rev.map(p => {
        const key = `${p.half}${p.inning}`
        const showHeader = key !== lastKey
        lastKey = key
        const col = TEAM_BG[p.battingTeamId] ?? '#888'
        return (
          <React.Fragment key={p.atBatIndex}>
            {showHeader && (
              <Typography sx={{
                px: 2, pt: 1.25, pb: 0.5,
                fontSize: '0.58rem', fontWeight: 800, color: 'text.disabled',
                textTransform: 'uppercase', letterSpacing: 0.8, lineHeight: 1,
              }}>
                {p.half === 'top' ? '▲' : '▼'} {ordinal(p.inning)} · {TEAM_ABBR[p.battingTeamId] ?? ''} batting
              </Typography>
            )}
            <Box sx={{
              mx: 2, mb: 0.75, px: 1.25, py: 0.75, borderRadius: 1.5,
              borderLeft: '3px solid',
              borderLeftColor: p.isScoring ? col : 'divider',
              bgcolor: p.isScoring ? `${col}0d` : 'transparent',
            }}>
              <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
                <Typography sx={{ fontSize: '0.68rem', fontWeight: 800, lineHeight: 1.2 }}>
                  {p.event}
                </Typography>
                {p.isScoring && (
                  <Typography sx={{ ml: 'auto', fontSize: '0.62rem', fontWeight: 800, color: 'text.secondary', lineHeight: 1.2, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                    {away.abbr} {p.awayScore} · {home.abbr} {p.homeScore}
                  </Typography>
                )}
              </Box>
              <Typography sx={{ fontSize: '0.66rem', color: 'text.secondary', lineHeight: 1.35, mt: 0.2 }}>
                {p.description}
              </Typography>
            </Box>
          </React.Fragment>
        )
      })}
    </Box>
  )
}

// ─── Full box score — side-by-side columns on desktop, team toggle on mobile ──

function TeamBoxColumns({ box, onPlayerClick }: {
  box: BoxScore
  onPlayerClick?: (id: number) => void
}) {
  const [side, setSide] = useState<'away' | 'home'>('away')

  const teamChip = (value: 'away' | 'home', team: BoxScore['away']) => (
    <Box
      onClick={() => setSide(value)}
      sx={{
        display: 'flex', alignItems: 'center', gap: 0.6,
        px: 1.5, py: 0.6, borderRadius: 99, cursor: 'pointer', userSelect: 'none',
        fontSize: '0.66rem', fontWeight: 800, lineHeight: 1,
        color: side === value ? 'background.paper' : 'text.secondary',
        bgcolor: side === value ? 'text.primary' : 'action.hover',
        transition: 'all 0.15s',
      }}
    >
      <LogoBubble teamId={team.teamId} abbr={team.abbr} size={16} ring={1} />
      {team.abbr}
    </Box>
  )

  return (
    <>
      {/* Desktop: both teams side by side */}
      <Box sx={{
        display: { xs: 'none', md: 'grid' }, gridTemplateColumns: '1fr 1fr',
        borderTop: '1px solid', borderColor: 'divider',
      }}>
        <Box sx={{ minWidth: 0, borderRight: '1px solid', borderColor: 'divider' }}>
          <TeamBoxSection team={box.away} onPlayerClick={onPlayerClick} />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <TeamBoxSection team={box.home} onPlayerClick={onPlayerClick} />
        </Box>
      </Box>

      {/* Mobile: one team at a time with a toggle */}
      <Box sx={{ display: { xs: 'block', md: 'none' } }}>
        <Box sx={{
          px: 2, py: 1.25, borderTop: '1px solid', borderColor: 'divider',
          display: 'flex', gap: 0.75, justifyContent: 'center',
        }}>
          {teamChip('away', box.away)}
          {teamChip('home', box.home)}
        </Box>
        <Box sx={{ borderTop: '1px solid', borderColor: 'divider' }}>
          <TeamBoxSection team={side === 'away' ? box.away : box.home} onPlayerClick={onPlayerClick} />
        </Box>
      </Box>
    </>
  )
}

// ─── Game Center modal ────────────────────────────────────────────────────────

export function GameCenterModal({ game, onClose, onPlayerClick, onTeamClick, initialTab }: {
  game: FinalGameSummary
  onClose: () => void
  onPlayerClick?: (id: number) => void
  onTeamClick?:   (id: number) => void
  initialTab?:    'plays' | 'box'
}) {
  const [data,        setData]        = useState<GameCenterData | null>(null)
  const [wp,          setWp]          = useState<WpPoint[]>([])
  const [loading,     setLoading]     = useState(true)
  const [tab,         setTab]         = useState<'plays' | 'box'>(initialTab ?? 'plays')
  const [scoringOnly, setScoringOnly] = useState(true)

  const load = useCallback(async () => {
    const [d, w] = await Promise.all([fetchGameCenter(game.gamePk), fetchWinProb(game.gamePk)])
    if (d) setData(d)
    setWp(w)
    setLoading(false)
  }, [game.gamePk])

  useEffect(() => { setLoading(true); load() }, [load])

  // Poll while the game is live
  useEffect(() => {
    if (data?.state !== 'live') return
    const id = setInterval(load, 15000)
    return () => clearInterval(id)
  }, [data?.state, load])

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  const isLive     = (data?.state ?? game.state) === 'live'
  const isFinal    = (data?.state ?? game.state) === 'final'
  const statusText = data?.statusText ?? game.statusText
  const away       = data?.away ?? { teamId: game.away.teamId, abbr: game.away.abbr, runs: game.away.runs }
  const home       = data?.home ?? { teamId: game.home.teamId, abbr: game.home.abbr, runs: game.home.runs }
  const hasScoring = Boolean(data?.plays.some(p => p.isScoring))

  const selectPlayer = onPlayerClick ? (id: number) => { onPlayerClick(id); onClose() } : undefined

  const teamHeader = (t: { teamId: number; abbr: string; runs: number }, other: { runs: number }) => {
    const em = isFinal ? t.runs > other.runs : isLive
    return (
      <Box
        onClick={onTeamClick ? () => { onTeamClick(t.teamId); onClose() } : undefined}
        sx={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.6, flex: 1, minWidth: 0,
          ...(onTeamClick ? { cursor: 'pointer' } : {}),
        }}
      >
        <LogoBubble teamId={t.teamId} abbr={t.abbr} size={48} ring={2.5} />
        <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: 'text.secondary', lineHeight: 1 }}>{t.abbr}</Typography>
        <Typography sx={{
          fontSize: '2.2rem', fontWeight: em ? 900 : 600, lineHeight: 1,
          color: em ? 'text.primary' : 'text.secondary', fontVariantNumeric: 'tabular-nums',
        }}>
          {t.runs}
        </Typography>
      </Box>
    )
  }

  const decisions = [
    game.winPitcher  && { label: 'W',  name: game.winPitcher },
    game.losePitcher && { label: 'L',  name: game.losePitcher },
    game.savePitcher && { label: 'SV', name: game.savePitcher },
  ].filter(Boolean) as Array<{ label: string; name: string }>

  const tabChip = (value: 'plays' | 'box', label: string) => (
    <Box
      onClick={() => setTab(value)}
      sx={{
        px: 1.5, py: 0.6, borderRadius: 99, cursor: 'pointer', userSelect: 'none',
        fontSize: '0.66rem', fontWeight: 800, lineHeight: 1,
        color: tab === value ? 'background.paper' : 'text.secondary',
        bgcolor: tab === value ? 'text.primary' : 'action.hover',
        transition: 'all 0.15s',
      }}
    >
      {label}
    </Box>
  )

  const filterChip = (value: boolean, label: string) => (
    <Box
      onClick={() => setScoringOnly(value)}
      sx={{
        px: 1.1, py: 0.45, borderRadius: 99, cursor: 'pointer', userSelect: 'none',
        fontSize: '0.6rem', fontWeight: 700, lineHeight: 1,
        color: scoringOnly === value ? 'text.primary' : 'text.disabled',
        border: '1px solid', borderColor: scoringOnly === value ? 'text.secondary' : 'divider',
        transition: 'all 0.15s',
      }}
    >
      {label}
    </Box>
  )

  return (
    <Box
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      sx={{
        position: 'fixed', inset: 0, zIndex: 1500,
        bgcolor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        p: { xs: 1, sm: 2 },
      }}
    >
      <Box sx={{
        bgcolor: 'background.paper', borderRadius: 3,
        border: '1px solid', borderColor: 'divider',
        // Wider on desktop while the side-by-side box score is showing
        width: '100%', maxWidth: tab === 'box' ? { xs: 560, md: 1100 } : 560,
        // `100%` (of the padded fixed overlay), not `vh`: under the desktop `zoom`
        // wrapper viewport units don't shrink, so `90vh` would overflow the screen.
        maxHeight: '100%', overflowY: 'auto',
        boxShadow: '0 24px 64px rgba(0,0,0,0.55)',
        '&::-webkit-scrollbar': { width: 4 },
        '&::-webkit-scrollbar-thumb': { bgcolor: 'divider', borderRadius: 2 },
      }}>

        {/* Header */}
        <Box sx={{
          px: 2, py: 1.25, borderBottom: '1px solid', borderColor: 'divider',
          display: 'flex', alignItems: 'center', gap: 0.75,
          position: 'sticky', top: 0, bgcolor: 'background.paper', zIndex: 1,
        }}>
          {isLive && <LiveDot size={6} />}
          <Typography sx={{
            flex: 1, fontWeight: 800, fontSize: '0.72rem',
            color: isLive ? '#ef4444' : 'text.secondary',
            textTransform: 'uppercase', letterSpacing: 1, lineHeight: 1,
          }}>
            {statusText}
          </Typography>
          <Box
            onClick={onClose}
            sx={{
              flexShrink: 0, width: 26, height: 26, borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', color: 'text.disabled',
              '&:hover': { bgcolor: 'action.hover', color: 'text.primary' },
            }}
          >
            <Typography sx={{ fontSize: '0.75rem', lineHeight: 1 }}>✕</Typography>
          </Box>
        </Box>

        {/* Score summary */}
        <Box sx={{ px: 2, pt: 2.5, pb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
          {teamHeader(away, home)}
          <Typography sx={{ fontSize: '0.8rem', color: 'text.disabled', px: 1 }}>@</Typography>
          {teamHeader(home, away)}
        </Box>

        {/* W/L/SV decisions (finals) */}
        {isFinal && decisions.length > 0 && (
          <Box sx={{ px: 2, pb: 1.5, display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 1.5 }}>
            {decisions.map(d => (
              <Box key={d.label} sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5 }}>
                <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, color: 'primary.main', lineHeight: 1 }}>{d.label}</Typography>
                <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary', lineHeight: 1 }}>{d.name}</Typography>
              </Box>
            ))}
          </Box>
        )}

        {loading && !data && (
          <Box sx={{ py: 4, textAlign: 'center' }}>
            <Typography sx={{ fontSize: '0.78rem', color: 'text.disabled' }}>Loading game…</Typography>
          </Box>
        )}

        {data && (
          <>
            {/* Live situation */}
            {isLive && data.situation && (
              <SituationPanel sit={data.situation} onPlayerClick={selectPlayer} />
            )}

            {/* Line score — always shown in the regular view */}
            <Box sx={{ borderTop: '1px solid', borderColor: 'divider', px: 2, py: 1.5 }}>
              <Box sx={{ mb: 1 }}><SectionLabel>Line Score</SectionLabel></Box>
              <LineScoreTable box={data.box} />
            </Box>

            {/* Win probability */}
            <WinProbChart pts={wp} away={data.away} home={data.home} />

            {/* Tabs */}
            <Box sx={{
              px: 2, py: 1.25, borderTop: '1px solid', borderColor: 'divider',
              display: 'flex', alignItems: 'center', gap: 0.75,
              position: 'sticky', top: 43, bgcolor: 'background.paper', zIndex: 1,
            }}>
              {tabChip('plays', 'Plays')}
              {tabChip('box', 'Full Box Score')}
              {tab === 'plays' && (
                <Box sx={{ ml: 'auto', display: 'flex', gap: 0.5 }}>
                  {hasScoring && filterChip(true, 'Scoring')}
                  {filterChip(false, 'All')}
                </Box>
              )}
            </Box>

            {tab === 'plays' ? (
              <Box sx={{ pb: 1.5 }}>
                <PlaysList
                  plays={data.plays}
                  away={data.away} home={data.home}
                  scoringOnly={scoringOnly && hasScoring}
                />
              </Box>
            ) : (
              <TeamBoxColumns box={data.box} onPlayerClick={selectPlayer} />
            )}
          </>
        )}
      </Box>
    </Box>
  )
}
