import React, { useState, useEffect, useRef } from 'react'
import { Box, Typography } from '@mui/material'
import { TEAM_BG, TEAM_ABBR } from '../constants'

// ─── Types ────────────────────────────────────────────────────────────────────

interface FinalTeam {
  teamId:   number
  abbr:     string
  name:     string
  runs:     number
  hits:     number
  errors:   number
  isWinner: boolean
}

interface FinalGameSummary {
  gamePk:     number
  statusText: string                 // "Final" or "Final/10" for extras
  home:       FinalTeam
  away:       FinalTeam
  winPitcher:  string | null
  losePitcher: string | null
  savePitcher: string | null
}

// Per-inning + R/H/E line score plus full batting / pitching tables.
interface InningLine { num: number; away: number | null; home: number | null }

interface BatterLine {
  id:    number
  name:  string
  pos:   string
  ab:    number
  r:     number
  h:     number
  rbi:   number
  bb:    number
  k:     number
  avg:   string
  isSub: boolean
}

interface PitcherLine {
  id:   number
  name: string
  note: string | null   // "(W, 10-6)", "(S, 28)", etc.
  ip:   string
  h:    number
  r:    number
  er:   number
  bb:   number
  k:    number
  era:  string | null    // season ERA when available
}

interface TeamBox {
  teamId:   number
  abbr:     string
  name:     string
  runs:     number
  hits:     number
  errors:   number
  batters:  BatterLine[]
  pitchers: PitcherLine[]
}

interface BoxScore {
  innings: InningLine[]
  away:    TeamBox
  home:    TeamBox
}

// ─── Date helpers (local, not UTC — avoids evening off-by-one) ──────────────────

function toISO(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function fromISO(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function dateLabel(iso: string): string {
  const todayISO = toISO(new Date())
  const yest = new Date(); yest.setDate(yest.getDate() - 1)
  if (iso === todayISO)        return 'Today'
  if (iso === toISO(yest))     return 'Yesterday'
  return fromISO(iso).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
}

// Game types we treat as "real" games on the scoreboard: regular + postseason.
const SCORED_GAME_TYPES = new Set(['R', 'F', 'D', 'L', 'W'])

// ─── API ────────────────────────────────────────────────────────────────────

export async function fetchFinalGames(dateISO: string): Promise<FinalGameSummary[]> {
  try {
    const r = await fetch(
      `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${dateISO}` +
      `&hydrate=linescore,decisions`
    )
    const d = await r.json()
    const out: FinalGameSummary[] = []
    for (const dateObj of d.dates ?? []) {
      for (const game of dateObj.games ?? []) {
        if (game.status?.abstractGameState !== 'Final') continue
        if (!SCORED_GAME_TYPES.has(game.gameType)) continue
        const ls = game.linescore
        if (!ls) continue

        const mkTeam = (side: 'home' | 'away'): FinalTeam => {
          const t   = game.teams?.[side]
          const lst = ls.teams?.[side] ?? {}
          const id  = Number(t?.team?.id ?? 0)
          return {
            teamId:   id,
            abbr:     TEAM_ABBR[id] ?? t?.team?.abbreviation ?? '???',
            name:     t?.team?.name ?? '???',
            runs:     lst.runs   ?? t?.score ?? 0,
            hits:     lst.hits   ?? 0,
            errors:   lst.errors ?? 0,
            isWinner: Boolean(t?.isWinner),
          }
        }

        // Extra innings → "Final/10". scheduledInnings defaults to 9.
        const scheduled = ls.scheduledInnings ?? 9
        const played    = ls.currentInning ?? scheduled
        const statusText = played > scheduled ? `Final/${played}` : 'Final'

        out.push({
          gamePk:     game.gamePk,
          statusText,
          home:       mkTeam('home'),
          away:       mkTeam('away'),
          winPitcher:  game.decisions?.winner?.fullName ?? null,
          losePitcher: game.decisions?.loser?.fullName  ?? null,
          savePitcher: game.decisions?.save?.fullName    ?? null,
        })
      }
    }
    return out
  } catch { return [] }
}

async function fetchBoxScore(gamePk: number): Promise<BoxScore | null> {
  try {
    const [lsRes, boxRes] = await Promise.all([
      fetch(`https://statsapi.mlb.com/api/v1/game/${gamePk}/linescore`),
      fetch(`https://statsapi.mlb.com/api/v1/game/${gamePk}/boxscore`),
    ])
    const ls  = await lsRes.json()
    const box = await boxRes.json()

    const innings: InningLine[] = (ls.innings ?? []).map((i: any) => ({
      num:  i.num,
      away: i.away?.runs ?? null,
      home: i.home?.runs ?? null,
    }))

    const mkTeamBox = (side: 'home' | 'away'): TeamBox => {
      const t       = box.teams?.[side] ?? {}
      const players = t.players ?? {}
      const lst     = ls.teams?.[side] ?? {}

      const batters: BatterLine[] = (t.batters ?? []).map((pid: number) => {
        const p  = players[`ID${pid}`] ?? {}
        const b  = p.stats?.batting ?? {}
        const sb = p.seasonStats?.batting ?? {}
        // battingOrder is "100", "200" for starters; "101", "201" for subs.
        const order = String(p.battingOrder ?? '')
        return {
          id:    Number(p.person?.id ?? pid),
          name:  p.person?.fullName ?? '—',
          pos:   p.position?.abbreviation ?? '',
          ab:    b.atBats     ?? 0,
          r:     b.runs       ?? 0,
          h:     b.hits       ?? 0,
          rbi:   b.rbi        ?? 0,
          bb:    b.baseOnBalls ?? 0,
          k:     b.strikeOuts ?? 0,
          avg:   sb.avg ?? b.avg ?? '',
          isSub: order !== '' && !order.endsWith('00'),
        }
      })

      const pitchers: PitcherLine[] = (t.pitchers ?? []).map((pid: number) => {
        const p  = players[`ID${pid}`] ?? {}
        const pt = p.stats?.pitching ?? {}
        const sp = p.seasonStats?.pitching ?? {}
        return {
          id:   Number(p.person?.id ?? pid),
          name: p.person?.fullName ?? '—',
          note: pt.note ? String(pt.note).replace(/[()]/g, '') : null,
          ip:   pt.inningsPitched ?? '0.0',
          h:    pt.hits        ?? 0,
          r:    pt.runs        ?? 0,
          er:   pt.earnedRuns  ?? 0,
          bb:   pt.baseOnBalls ?? 0,
          k:    pt.strikeOuts  ?? 0,
          era:  sp.era ?? null,
        }
      })

      const id = Number(t.team?.id ?? 0)
      return {
        teamId:   id,
        abbr:     TEAM_ABBR[id] ?? t.team?.abbreviation ?? '???',
        name:     t.team?.name ?? '???',
        runs:     lst.runs   ?? 0,
        hits:     lst.hits   ?? 0,
        errors:   lst.errors ?? 0,
        batters,
        pitchers,
      }
    }

    return { innings, away: mkTeamBox('away'), home: mkTeamBox('home') }
  } catch { return null }
}

// ─── Team logo bubble ───────────────────────────────────────────────────────

function LogoBubble({ teamId, abbr, size, ring = 1.5 }: {
  teamId: number; abbr: string; size: number; ring?: number
}) {
  const col = TEAM_BG[teamId] ?? '#555'
  return (
    <Box sx={{
      width: size, height: size, borderRadius: '50%', bgcolor: '#fff',
      border: `${ring}px solid ${col}`, flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    }}>
      <Box
        component="img"
        src={`https://www.mlbstatic.com/team-logos/${teamId}.svg`}
        alt={abbr}
        sx={{ width: size * 0.72, height: size * 0.72, objectFit: 'contain' }}
      />
    </Box>
  )
}

// ─── Mini final-score card ──────────────────────────────────────────────────

function FinalGameMiniCard({ game, onClick }: { game: FinalGameSummary; onClick: () => void }) {
  const teamRow = (t: FinalTeam) => {
    const won = t.isWinner
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <LogoBubble teamId={t.teamId} abbr={t.abbr} size={20} />
        <Typography sx={{
          flex: 1, fontSize: '0.74rem', fontWeight: won ? 800 : 500, lineHeight: 1,
          color: won ? 'text.primary' : 'text.secondary',
        }}>
          {t.abbr}
        </Typography>
        <Typography sx={{
          fontSize: '0.9rem', fontWeight: won ? 800 : 500, lineHeight: 1,
          color: won ? 'text.primary' : 'text.secondary', minWidth: 16, textAlign: 'right',
        }}>
          {t.runs}
        </Typography>
      </Box>
    )
  }

  return (
    <Box
      onClick={onClick}
      sx={{
        flexShrink: 0, width: 124,
        borderRadius: 2, border: '1px solid', borderColor: 'divider',
        bgcolor: 'background.paper', overflow: 'hidden',
        cursor: 'pointer', userSelect: 'none',
        transition: 'all 0.15s',
        '&:hover': { borderColor: 'text.secondary', transform: 'translateY(-2px)', boxShadow: '0 6px 18px rgba(0,0,0,0.18)' },
      }}
    >
      {/* Status row */}
      <Box sx={{ display: 'flex', alignItems: 'center', px: 1, pt: 0.8, pb: 0.4 }}>
        <Typography sx={{
          fontSize: '0.56rem', fontWeight: 800, color: 'text.disabled',
          letterSpacing: 0.6, textTransform: 'uppercase', lineHeight: 1,
        }}>
          {game.statusText}
        </Typography>
        <Typography sx={{ fontSize: '0.55rem', color: 'text.disabled', ml: 'auto', lineHeight: 1 }}>
          Box →
        </Typography>
      </Box>

      {/* Scores */}
      <Box sx={{ px: 1, pb: 0.8, display: 'flex', flexDirection: 'column', gap: 0.35 }}>
        {teamRow(game.away)}
        {teamRow(game.home)}
      </Box>
    </Box>
  )
}

// ─── Box-score modal ──────────────────────────────────────────────────────────

function StatHead({ children, w = 26 }: { children: React.ReactNode; w?: number }) {
  return (
    <Box component="th" sx={{
      fontSize: '0.56rem', fontWeight: 700, color: 'text.disabled',
      textTransform: 'uppercase', letterSpacing: 0.4,
      textAlign: 'right', px: 0.4, py: 0.5, minWidth: w,
    }}>
      {children}
    </Box>
  )
}

function StatCell({ children, bold = false }: { children: React.ReactNode; bold?: boolean }) {
  return (
    <Box component="td" sx={{
      fontSize: '0.7rem', fontWeight: bold ? 800 : 500, color: bold ? 'text.primary' : 'text.secondary',
      textAlign: 'right', px: 0.4, py: 0.45, lineHeight: 1.2, fontVariantNumeric: 'tabular-nums',
    }}>
      {children}
    </Box>
  )
}

function LineScoreTable({ box }: { box: BoxScore }) {
  const rows: Array<{ side: 'away' | 'home'; t: TeamBox }> = [
    { side: 'away', t: box.away },
    { side: 'home', t: box.home },
  ]
  return (
    <Box data-swipe-ignore="true" sx={{ overflowX: 'auto', '&::-webkit-scrollbar': { display: 'none' }, scrollbarWidth: 'none' }}>
      <Box component="table" sx={{ borderCollapse: 'collapse', width: '100%', minWidth: 'max-content' }}>
        <Box component="thead">
          <Box component="tr">
            <Box component="th" sx={{ minWidth: 44 }} />
            {box.innings.map(i => (
              <StatHead key={i.num} w={18}>{i.num}</StatHead>
            ))}
            <Box component="th" sx={{ width: 8 }} />
            <StatHead w={22}>R</StatHead>
            <StatHead w={22}>H</StatHead>
            <StatHead w={22}>E</StatHead>
          </Box>
        </Box>
        <Box component="tbody">
          {rows.map(({ side, t }) => (
            <Box component="tr" key={side} sx={{ borderTop: '1px solid', borderColor: 'divider' }}>
              <Box component="td" sx={{ py: 0.45 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
                  <LogoBubble teamId={t.teamId} abbr={t.abbr} size={18} ring={1.25} />
                  <Typography sx={{ fontSize: '0.72rem', fontWeight: t.runs > (side === 'away' ? box.home.runs : box.away.runs) ? 800 : 600, lineHeight: 1 }}>
                    {t.abbr}
                  </Typography>
                </Box>
              </Box>
              {box.innings.map(i => {
                const v = side === 'away' ? i.away : i.home
                // Home team that didn't bat in its last frame → "x"
                return <StatCell key={i.num}>{v == null ? (side === 'home' ? 'x' : '-') : v}</StatCell>
              })}
              <Box component="td" sx={{ width: 8 }} />
              <StatCell bold>{t.runs}</StatCell>
              <StatCell>{t.hits}</StatCell>
              <StatCell>{t.errors}</StatCell>
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  )
}

function BattingTable({ team, onPlayerClick }: { team: TeamBox; onPlayerClick?: (id: number) => void }) {
  return (
    <Box data-swipe-ignore="true" sx={{ overflowX: 'auto', '&::-webkit-scrollbar': { display: 'none' }, scrollbarWidth: 'none' }}>
      <Box component="table" sx={{ borderCollapse: 'collapse', width: '100%', minWidth: 'max-content' }}>
        <Box component="thead">
          <Box component="tr">
            <Box component="th" sx={{ minWidth: 132, textAlign: 'left', fontSize: '0.56rem', fontWeight: 700, color: 'text.disabled', textTransform: 'uppercase', letterSpacing: 0.4, px: 0.4, py: 0.5 }}>
              Batters
            </Box>
            <StatHead>AB</StatHead><StatHead>R</StatHead><StatHead>H</StatHead>
            <StatHead>RBI</StatHead><StatHead>BB</StatHead><StatHead>SO</StatHead>
            <StatHead w={36}>AVG</StatHead>
          </Box>
        </Box>
        <Box component="tbody">
          {team.batters.map(b => (
            <Box component="tr" key={b.id} sx={{ borderTop: '1px solid', borderColor: 'divider' }}>
              <Box component="td" sx={{ px: 0.4, py: 0.45 }}>
                <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5 }}>
                  <Typography
                    onClick={onPlayerClick ? () => onPlayerClick(b.id) : undefined}
                    sx={{
                      fontSize: '0.72rem', fontWeight: 600, lineHeight: 1.2,
                      pl: b.isSub ? 1 : 0,
                      ...(onPlayerClick ? { cursor: 'pointer', '&:hover': { color: 'primary.main', textDecoration: 'underline' } } : {}),
                    }}
                  >
                    {b.name}
                  </Typography>
                  <Typography sx={{ fontSize: '0.56rem', color: 'text.disabled', lineHeight: 1 }}>{b.pos}</Typography>
                </Box>
              </Box>
              <StatCell>{b.ab}</StatCell><StatCell>{b.r}</StatCell><StatCell bold>{b.h}</StatCell>
              <StatCell>{b.rbi}</StatCell><StatCell>{b.bb}</StatCell><StatCell>{b.k}</StatCell>
              <StatCell>{b.avg}</StatCell>
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  )
}

function PitchingTable({ team, onPlayerClick }: { team: TeamBox; onPlayerClick?: (id: number) => void }) {
  return (
    <Box data-swipe-ignore="true" sx={{ overflowX: 'auto', '&::-webkit-scrollbar': { display: 'none' }, scrollbarWidth: 'none' }}>
      <Box component="table" sx={{ borderCollapse: 'collapse', width: '100%', minWidth: 'max-content' }}>
        <Box component="thead">
          <Box component="tr">
            <Box component="th" sx={{ minWidth: 132, textAlign: 'left', fontSize: '0.56rem', fontWeight: 700, color: 'text.disabled', textTransform: 'uppercase', letterSpacing: 0.4, px: 0.4, py: 0.5 }}>
              Pitchers
            </Box>
            <StatHead w={32}>IP</StatHead><StatHead>H</StatHead><StatHead>R</StatHead>
            <StatHead>ER</StatHead><StatHead>BB</StatHead><StatHead>SO</StatHead>
            <StatHead w={36}>ERA</StatHead>
          </Box>
        </Box>
        <Box component="tbody">
          {team.pitchers.map(p => (
            <Box component="tr" key={p.id} sx={{ borderTop: '1px solid', borderColor: 'divider' }}>
              <Box component="td" sx={{ px: 0.4, py: 0.45 }}>
                <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5 }}>
                  <Typography
                    onClick={onPlayerClick ? () => onPlayerClick(p.id) : undefined}
                    sx={{
                      fontSize: '0.72rem', fontWeight: 600, lineHeight: 1.2,
                      ...(onPlayerClick ? { cursor: 'pointer', '&:hover': { color: 'primary.main', textDecoration: 'underline' } } : {}),
                    }}
                  >
                    {p.name}
                  </Typography>
                  {p.note && (
                    <Typography sx={{ fontSize: '0.56rem', fontWeight: 800, color: 'primary.main', lineHeight: 1 }}>
                      {p.note}
                    </Typography>
                  )}
                </Box>
              </Box>
              <StatCell bold>{p.ip}</StatCell><StatCell>{p.h}</StatCell><StatCell>{p.r}</StatCell>
              <StatCell>{p.er}</StatCell><StatCell>{p.bb}</StatCell><StatCell>{p.k}</StatCell>
              <StatCell>{p.era ?? '—'}</StatCell>
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Typography sx={{
      fontSize: '0.58rem', fontWeight: 700, color: 'text.disabled',
      textTransform: 'uppercase', letterSpacing: 0.8, lineHeight: 1,
    }}>
      {children}
    </Typography>
  )
}

function TeamBoxSection({ team, onPlayerClick }: { team: TeamBox; onPlayerClick?: (id: number) => void }) {
  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1.25, bgcolor: 'action.hover' }}>
        <LogoBubble teamId={team.teamId} abbr={team.abbr} size={26} />
        <Typography sx={{ fontSize: '0.84rem', fontWeight: 800, lineHeight: 1 }}>{team.name}</Typography>
        <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary', ml: 'auto', lineHeight: 1 }}>
          {team.runs} R · {team.hits} H · {team.errors} E
        </Typography>
      </Box>
      <Box sx={{ px: 2, py: 1.25 }}>
        <BattingTable team={team} onPlayerClick={onPlayerClick} />
      </Box>
      <Box sx={{ px: 2, pb: 1.5, pt: 0.5, borderTop: '1px solid', borderColor: 'divider' }}>
        <PitchingTable team={team} onPlayerClick={onPlayerClick} />
      </Box>
    </Box>
  )
}

function BoxScoreModal({ game, onClose, onPlayerClick, onTeamClick }: {
  game: FinalGameSummary
  onClose: () => void
  onPlayerClick?: (id: number) => void
  onTeamClick?: (id: number) => void
}) {
  const [box,     setBox]     = useState<BoxScore | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetchBoxScore(game.gamePk).then(setBox).finally(() => setLoading(false))
  }, [game.gamePk])

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  const teamHeader = (t: FinalTeam, align: 'flex-start' | 'flex-end') => (
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
        fontSize: '2.2rem', fontWeight: t.isWinner ? 900 : 600, lineHeight: 1,
        color: t.isWinner ? 'text.primary' : 'text.secondary',
      }}>
        {t.runs}
      </Typography>
    </Box>
  )

  const decisions = [
    game.winPitcher  && { label: 'W',  name: game.winPitcher },
    game.losePitcher && { label: 'L',  name: game.losePitcher },
    game.savePitcher && { label: 'SV', name: game.savePitcher },
  ].filter(Boolean) as Array<{ label: string; name: string }>

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
        width: '100%', maxWidth: 540,
        maxHeight: '90vh', overflowY: 'auto',
        boxShadow: '0 24px 64px rgba(0,0,0,0.55)',
        '&::-webkit-scrollbar': { width: 4 },
        '&::-webkit-scrollbar-thumb': { bgcolor: 'divider', borderRadius: 2 },
      }}>

        {/* Header */}
        <Box sx={{
          px: 2, py: 1.25, borderBottom: '1px solid', borderColor: 'divider',
          display: 'flex', alignItems: 'center', gap: 1,
          position: 'sticky', top: 0, bgcolor: 'background.paper', zIndex: 1,
        }}>
          <Typography sx={{
            flex: 1, fontWeight: 800, fontSize: '0.72rem', color: 'text.secondary',
            textTransform: 'uppercase', letterSpacing: 1, lineHeight: 1,
          }}>
            {game.statusText}
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
          {teamHeader(game.away, 'flex-start')}
          <Typography sx={{ fontSize: '0.8rem', color: 'text.disabled', px: 1 }}>@</Typography>
          {teamHeader(game.home, 'flex-end')}
        </Box>

        {/* Decisions */}
        {decisions.length > 0 && (
          <Box sx={{
            px: 2, pb: 1.5, display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 1.5,
          }}>
            {decisions.map(d => (
              <Box key={d.label} sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5 }}>
                <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, color: 'primary.main', lineHeight: 1 }}>{d.label}</Typography>
                <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary', lineHeight: 1 }}>{d.name}</Typography>
              </Box>
            ))}
          </Box>
        )}

        {loading && !box && (
          <Box sx={{ py: 4, textAlign: 'center' }}>
            <Typography sx={{ fontSize: '0.78rem', color: 'text.disabled' }}>Loading box score…</Typography>
          </Box>
        )}

        {box && (
          <>
            {/* Line score */}
            <Box sx={{ borderTop: '1px solid', borderColor: 'divider', px: 2, py: 1.5 }}>
              <Box sx={{ mb: 1 }}><SectionLabel>Line Score</SectionLabel></Box>
              <LineScoreTable box={box} />
            </Box>

            {/* Box score per team */}
            <Box sx={{ borderTop: '1px solid', borderColor: 'divider' }}>
              <TeamBoxSection team={box.away} onPlayerClick={onPlayerClick} />
            </Box>
            <Box sx={{ borderTop: '1px solid', borderColor: 'divider' }}>
              <TeamBoxSection team={box.home} onPlayerClick={onPlayerClick} />
            </Box>
          </>
        )}
      </Box>
    </Box>
  )
}

// ─── Date navigator ────────────────────────────────────────────────────────────

function DateNav({ dateISO, onChange }: { dateISO: string; onChange: (iso: string) => void }) {
  const todayISO = toISO(new Date())
  const atToday  = dateISO >= todayISO

  const shift = (days: number) => {
    const d = fromISO(dateISO); d.setDate(d.getDate() + days)
    onChange(toISO(d))
  }

  const arrowSx = (disabled: boolean) => ({
    width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: disabled ? 'default' : 'pointer',
    color: disabled ? 'text.disabled' : 'text.secondary',
    opacity: disabled ? 0.4 : 1,
    '&:hover': disabled ? {} : { bgcolor: 'action.hover', color: 'text.primary' },
  })

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <Box onClick={() => shift(-1)} sx={arrowSx(false)}>
        <Typography sx={{ fontSize: '0.9rem', lineHeight: 1 }}>‹</Typography>
      </Box>

      {/* Clickable label with an overlaid native date input for jumping */}
      <Box sx={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <Typography sx={{
          fontSize: '0.7rem', fontWeight: 700, color: 'text.primary',
          minWidth: 88, textAlign: 'center', lineHeight: 1, userSelect: 'none',
        }}>
          {dateLabel(dateISO)}
        </Typography>
        <Box
          component="input"
          type="date"
          value={dateISO}
          max={todayISO}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => { if (e.target.value) onChange(e.target.value) }}
          sx={{
            position: 'absolute', inset: 0, width: '100%', height: '100%',
            opacity: 0, cursor: 'pointer', border: 'none', padding: 0,
          }}
        />
      </Box>

      <Box onClick={() => { if (!atToday) shift(1) }} sx={arrowSx(atToday)}>
        <Typography sx={{ fontSize: '0.9rem', lineHeight: 1 }}>›</Typography>
      </Box>
    </Box>
  )
}

// ─── FinalGamesSection ─────────────────────────────────────────────────────────

export function FinalGamesSection({ onPlayerClick, onTeamClick }: {
  onPlayerClick?: (id: number) => void
  onTeamClick?:   (id: number) => void
}) {
  const [dateISO,    setDateISO]    = useState(() => toISO(new Date()))
  const [games,      setGames]      = useState<FinalGameSummary[]>([])
  const [loading,    setLoading]    = useState(true)
  const [openGame,   setOpenGame]   = useState<FinalGameSummary | null>(null)

  // Once, on first load: if today has no finals yet, drop back to yesterday.
  const autoFellBackRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchFinalGames(dateISO)
      .then(g => {
        if (cancelled) return
        if (g.length === 0 && dateISO === toISO(new Date()) && !autoFellBackRef.current) {
          autoFellBackRef.current = true
          const y = new Date(); y.setDate(y.getDate() - 1)
          setDateISO(toISO(y))   // re-triggers this effect; stay in loading state
          return
        }
        setGames(g)
        setLoading(false)
      })
      .catch(() => { if (!cancelled) { setGames([]); setLoading(false) } })
    return () => { cancelled = true }
  }, [dateISO])

  return (
    <>
      <Box sx={{
        borderRadius: 3, border: '1px solid', borderColor: 'divider',
        bgcolor: 'background.paper', overflow: 'hidden',
      }}>
        {/* Header with date nav */}
        <Box sx={{
          px: 2, py: 1.1, borderBottom: '1px solid', borderColor: 'divider',
          display: 'flex', alignItems: 'center', gap: 1,
        }}>
          <Typography sx={{
            fontWeight: 800, fontSize: '0.7rem', textTransform: 'uppercase',
            letterSpacing: 1.4, color: 'text.secondary', lineHeight: 1,
          }}>
            Final Scores
          </Typography>
          {!loading && games.length > 0 && (
            <Typography sx={{ fontSize: '0.68rem', color: 'text.disabled', lineHeight: 1 }}>
              · {games.length} {games.length === 1 ? 'game' : 'games'}
            </Typography>
          )}
          <Box sx={{ ml: 'auto' }}>
            <DateNav dateISO={dateISO} onChange={setDateISO} />
          </Box>
        </Box>

        {/* Body */}
        {loading ? (
          <Box sx={{ py: 3, textAlign: 'center' }}>
            <Typography sx={{ fontSize: '0.72rem', color: 'text.disabled' }}>Loading…</Typography>
          </Box>
        ) : games.length === 0 ? (
          <Box sx={{ py: 3, textAlign: 'center' }}>
            <Typography sx={{ fontSize: '0.74rem', color: 'text.disabled' }}>No completed games on this date</Typography>
          </Box>
        ) : (
          <Box data-swipe-ignore="true" sx={{
            display: 'flex', gap: 1, p: 1.25,
            overflowX: 'auto',
            '&::-webkit-scrollbar': { display: 'none' },
            msOverflowStyle: 'none', scrollbarWidth: 'none',
          }}>
            {games.map(game => (
              <FinalGameMiniCard
                key={game.gamePk}
                game={game}
                onClick={() => setOpenGame(game)}
              />
            ))}
          </Box>
        )}
      </Box>

      {openGame && (
        <BoxScoreModal
          game={openGame}
          onClose={() => setOpenGame(null)}
          onPlayerClick={onPlayerClick}
          onTeamClick={onTeamClick}
        />
      )}
    </>
  )
}
