// Shared box-score UI + parsing — the line score and batting/pitching tables,
// plus the team-logo bubble and live dot. Rendered by both the Scores scoreboard
// (FinalGames) and the Game Center (LiveGameCenter); parseBoxScoreData turns a raw
// StatsAPI linescore + boxscore into the typed BoxScore these components take.
// Extracted from FinalGames.tsx.

import React from 'react'
import { Box, Typography } from '@mui/material'
import { TEAM_ABBR } from '../constants'
import { useIsDark, ringColor, teamLogoBg, teamLogoSrc, teamLogoCrop } from '../lib/colorUtils'

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
  id:      number
  name:    string
  note:    string | null   // "(W, 10-6)", "(S, 28)", etc.
  ip:      string
  h:       number
  r:       number
  er:      number
  bb:      number
  k:       number
  pitches: number | null   // pitch count for the game
  era:     string | null    // season ERA when available
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

export interface BoxScore {
  innings: InningLine[]
  away:    TeamBox
  home:    TeamBox
}

export function parseBoxScoreData(ls: any, box: any): BoxScore {
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
    }).filter((b: BatterLine) => b.pos !== 'P')  // pitchers don't belong in the hitting lineup

    const pitchers: PitcherLine[] = (t.pitchers ?? []).map((pid: number) => {
      const p  = players[`ID${pid}`] ?? {}
      const pt = p.stats?.pitching ?? {}
      const sp = p.seasonStats?.pitching ?? {}
      return {
        id:   Number(p.person?.id ?? pid),
        name: p.person?.fullName ?? '—',
        note:    pt.note ? String(pt.note).replace(/[()]/g, '') : null,
        ip:      pt.inningsPitched ?? '0.0',
        h:       pt.hits        ?? 0,
        r:       pt.runs        ?? 0,
        er:      pt.earnedRuns  ?? 0,
        bb:      pt.baseOnBalls ?? 0,
        k:       pt.strikeOuts  ?? 0,
        pitches: pt.pitchesThrown ?? pt.numberOfPitches ?? null,
        era:     sp.era ?? null,
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
}

// ─── Team logo bubble ───────────────────────────────────────────────────────

export function LogoBubble({ teamId, abbr, size, ring = 1.5 }: {
  teamId: number; abbr: string; size: number; ring?: number
}) {
  const isDark = useIsDark()
  const col = ringColor(teamId, isDark)
  return (
    <Box sx={{
      width: size, height: size, borderRadius: '50%', bgcolor: teamLogoBg(teamId, isDark),
      border: `${ring}px solid ${col}`, flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    }}>
      <Box
        component="img"
        src={teamLogoSrc(teamId, isDark)}
        alt={abbr}
        sx={{ width: size * 0.72, height: size * 0.72, objectFit: 'contain', transform: teamLogoCrop(teamId, isDark), transformOrigin: 'center' }}
      />
    </Box>
  )
}

// ─── Pulsing live dot ─────────────────────────────────────────────────────────

export function LiveDot({ size = 6 }: { size?: number }) {
  return (
    <Box sx={{
      width: size, height: size, borderRadius: '50%', bgcolor: '#ef4444', flexShrink: 0,
      animation: 'scoreLivePulse 1.6s ease-in-out infinite',
      '@keyframes scoreLivePulse': { '0%,100%': { opacity: 1, transform: 'scale(1)' }, '50%': { opacity: 0.45, transform: 'scale(0.8)' } },
    }} />
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
      fontSize: '0.72rem', fontWeight: bold ? 800 : 600, color: 'text.primary',
      textAlign: 'right', px: 0.4, py: 0.45, lineHeight: 1.2, fontVariantNumeric: 'tabular-nums',
    }}>
      {children}
    </Box>
  )
}

export function LineScoreTable({ box }: { box: BoxScore }) {
  const rows: Array<{ side: 'away' | 'home'; t: TeamBox }> = [
    { side: 'away', t: box.away },
    { side: 'home', t: box.home },
  ]
  // Always show a full 9 innings (more only if the game went to extras); innings the
  // game hasn't reached yet render as blank columns.
  const lastNum = box.innings.length ? box.innings[box.innings.length - 1].num : 0
  const byNum   = new Map(box.innings.map(i => [i.num, i] as const))
  const cols    = Array.from({ length: Math.max(9, lastNum) }, (_, k) => k + 1)
  return (
    <Box data-swipe-ignore="true" sx={{ overflowX: 'auto', '&::-webkit-scrollbar': { display: 'none' }, scrollbarWidth: 'none' }}>
      <Box component="table" sx={{ borderCollapse: 'collapse', width: '100%', minWidth: 'max-content' }}>
        <Box component="thead">
          <Box component="tr">
            <Box component="th" sx={{ minWidth: 44 }} />
            {cols.map(num => (
              <StatHead key={num} w={18}>{num}</StatHead>
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
              {cols.map(num => {
                const i = byNum.get(num)
                if (!i) return <StatCell key={num}>{''}</StatCell>   // inning not reached yet
                const v = side === 'away' ? i.away : i.home
                // Home team that didn't bat in its last frame → "x"
                return <StatCell key={num}>{v == null ? (side === 'home' ? 'x' : '-') : v}</StatCell>
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
            <StatHead>P</StatHead>
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
              <StatCell>{p.pitches ?? '—'}</StatCell>
              <StatCell>{p.era ?? '—'}</StatCell>
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  )
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Typography sx={{
      fontSize: '0.58rem', fontWeight: 700, color: 'text.disabled',
      textTransform: 'uppercase', letterSpacing: 0.8, lineHeight: 1,
    }}>
      {children}
    </Typography>
  )
}

export function TeamBoxSection({ team, onPlayerClick }: { team: TeamBox; onPlayerClick?: (id: number) => void }) {
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
