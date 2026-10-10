// Shared box-score UI + parsing: the line score and batting/pitching tables,
// plus the team-logo bubble and live dot. Rendered by both the Scores scoreboard
// (FinalGames) and the Game Center (LiveGameCenter); parseBoxScoreData turns a raw
// StatsAPI linescore + boxscore into the typed BoxScore these components take.
// Extracted from FinalGames.tsx.

import React from 'react'
import { Box, Typography } from '@mui/material'
import { TEAM_ABBR, TEAM_BG } from '../constants'
import { useIsDark, ringColor, teamLogoBg, teamLogoSrc, teamLogoCrop, accentColor } from '../lib/colorUtils'
import { BoxTable, BOX_POS_SX } from '../../ui/gameCenter'
import { usePhoneLayout } from '../../ui/ModalShell'
import { chromePx, typePx } from '../../ui/scale'
import { playerLink } from '../lib/links'

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
  hr:    number
  doubles: number
  sb:    number
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
  hr:      number
  outs:    number           // for the totals row: IP summed as outs, never as printed decimals
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
        hr:    b.homeRuns   ?? 0,
        doubles: b.doubles  ?? 0,
        sb:    b.stolenBases ?? 0,
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
        hr:      pt.homeRuns    ?? 0,
        outs:    pt.outs        ?? 0,
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
      width: chromePx(size), height: chromePx(size), borderRadius: '50%', bgcolor: teamLogoBg(teamId, isDark),
      border: `${ring}px solid ${col}`, flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    }}>
      <Box
        component="img"
        src={teamLogoSrc(teamId, isDark)}
        alt={abbr}
        sx={{ width: chromePx(size * 0.72), height: chromePx(size * 0.72), objectFit: 'contain', transform: teamLogoCrop(teamId, isDark), transformOrigin: 'center' }}
      />
    </Box>
  )
}

// ─── Pulsing live dot ─────────────────────────────────────────────────────────

export function LiveDot({ size = 6 }: { size?: number }) {
  return (
    // A span, since it sits inside text (Game Center's eyebrow is a <p>), where a div is invalid
    // markup and React warns on every live game.
    <Box component="span" sx={{ display: 'inline-block',
      width: chromePx(size), height: chromePx(size), borderRadius: '50%', bgcolor: '#ef4444', flexShrink: 0,
      animation: 'scoreLivePulse 1.6s ease-in-out infinite',
      '@keyframes scoreLivePulse': { '0%,100%': { opacity: 1, transform: 'scale(1)' }, '50%': { opacity: 0.45, transform: 'scale(0.8)' } },
    }} />
  )
}

// ─── Box-score modal ──────────────────────────────────────────────────────────

function StatHead({ children, w = 26 }: { children: React.ReactNode; w?: number }) {
  return (
    <Box component="th" sx={{
      fontSize: '0.62rem', fontWeight: 700, color: 'text.secondary',
      textTransform: 'uppercase', letterSpacing: typePx(0.4),
      textAlign: 'right', px: 0.4, py: 0.5, minWidth: chromePx(w),
    }}>
      {children}
    </Box>
  )
}

function StatCell({ children, bold = false }: { children: React.ReactNode; bold?: boolean }) {
  return (
    <Box component="td" sx={{
      fontSize: '0.76rem', fontWeight: bold ? 800 : 600, color: 'text.primary',
      textAlign: 'right', px: 0.4, py: 0.55, lineHeight: 1.2, fontVariantNumeric: 'tabular-nums',
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
            <Box component="th" sx={{ minWidth: chromePx(44) }} />
            {cols.map(num => (
              <StatHead key={num} w={18}>{num}</StatHead>
            ))}
            <Box component="th" sx={{ width: chromePx(8) }} />
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
              <Box component="td" sx={{ width: chromePx(8) }} />
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

// The club's half of a box score, on WPBL's table (src/ui/gameCenter.tsx): WPBL's columns in WPBL's
// order, then, off a phone, the season AVG and ERA StatsAPI hands over with the line, which WPBL's
// feed has no equivalent for.
const BAT_COLS: { key: keyof BatterLine; label: string }[] = [
  { key: 'ab', label: 'AB' }, { key: 'r', label: 'R' }, { key: 'h', label: 'H' },
  { key: 'rbi', label: 'RBI' }, { key: 'bb', label: 'BB' }, { key: 'k', label: 'SO' },
  { key: 'hr', label: 'HR' }, { key: 'doubles', label: '2B' }, { key: 'sb', label: 'SB' },
]
const PIT_COLS: { key: keyof PitcherLine; label: string }[] = [
  { key: 'h', label: 'H' }, { key: 'r', label: 'R' }, { key: 'er', label: 'ER' },
  { key: 'bb', label: 'BB' }, { key: 'k', label: 'SO' }, { key: 'hr', label: 'HR' },
  { key: 'pitches', label: 'P' },
]
const outsToIp = (outs: number) => `${Math.floor(outs / 3)}.${outs % 3}`
// What the phone's name column holds at the dense size: past it a first name becomes an initial,
// so the surname, the part a reader needs, is the part that survives. WPBL's BOX_NAME_MAX.
const BOX_NAME_MAX = 11
const boxName = (name: string, dense: boolean) => {
  if (!dense || name.length <= BOX_NAME_MAX) return name
  const sp = name.indexOf(' ')
  return sp > 0 ? `${name[0]}. ${name.slice(sp + 1)}` : name
}

export function ClubBox({ team, onPlayerClick }: { team: TeamBox; onPlayerClick?: (id: number) => void }) {
  const isDark = useIsDark()
  const dense = usePhoneLayout()
  const color = accentColor(TEAM_BG[team.teamId] ?? '#888888', isDark)
  // The season AVG and ERA, where there is room. A phone's table is WPBL's nine fitted columns, and
  // a tenth clipped ".188" to ".18" and every ERA with it.
  const season = !dense
  const nameFor = (id: number, name: string) => ({
    name: boxName(name, dense),
    nameProps: onPlayerClick ? playerLink(id, name, onPlayerClick) as Record<string, unknown> : undefined,
  })
  const sum = <T,>(rows: T[], k: keyof T) => rows.reduce((n, r) => n + (Number(r[k]) || 0), 0)
  // One pitch count the feed did not send makes the column unsummable: a dash is a fact, a total
  // that quietly leaves a reliever out is a wrong number.
  const pitTotal = (k: keyof PitcherLine) => (team.pitchers.some(p => p[k] == null) ? null : sum(team.pitchers, k))
  return (
    <Box>
      {team.batters.length > 0 && (
        <Box sx={{ mb: 1.5 }}>
          <BoxTable
            head="Batting" dense={dense} rule={color} hoverColor={color}
            cols={[...BAT_COLS.map(c => ({ key: c.key, label: c.label, bold: c.key === 'h' })), ...(season ? [{ key: 'avg', label: 'AVG', w: 36 }] : [])]}
            rows={team.batters.map(b => ({
              key: b.id, isSub: b.isSub, ...nameFor(b.id, b.name),
              suffix: b.pos ? <Typography component="span" sx={BOX_POS_SX}>{b.pos}</Typography> : null,
              cells: [...BAT_COLS.map(c => Number(b[c.key]) || 0), ...(season ? [b.avg || null] : [])],
            }))}
            totals={[...BAT_COLS.map(c => sum(team.batters, c.key)), ...(season ? [''] : [])]}
          />
        </Box>
      )}
      {team.pitchers.length > 0 && (
        <BoxTable
          head="Pitching" dense={dense} rule={color} hoverColor={color}
          cols={[{ key: 'ip', label: 'IP', bold: true, w: 32 }, ...PIT_COLS.map(c => ({ key: c.key, label: c.label })), ...(season ? [{ key: 'era', label: 'ERA', w: 36 }] : [])]}
          rows={team.pitchers.map(p => ({
            key: p.id, ...nameFor(p.id, p.name),
            // The decision alone on a phone, "(W)" as WPBL prints it: the record after it took the
            // name column down to "E. Sabrow…".
            suffix: p.note ? <Typography component="span" sx={{ fontSize: '0.56rem', fontWeight: 700, color, lineHeight: 1, whiteSpace: 'nowrap' }}>({dense ? p.note.split(',')[0] : p.note})</Typography> : null,
            cells: [p.ip, ...PIT_COLS.map(c => (p[c.key] == null ? null : Number(p[c.key]))), ...(season ? [p.era] : [])],
          }))}
          totals={[outsToIp(sum(team.pitchers, 'outs')), ...PIT_COLS.map(c => pitTotal(c.key)), ...(season ? [''] : [])]}
        />
      )}
    </Box>
  )
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Typography sx={{
      fontSize: '0.62rem', fontWeight: 700, color: 'text.secondary',
      textTransform: 'uppercase', letterSpacing: typePx(0.8), lineHeight: 1,
    }}>
      {children}
    </Typography>
  )
}
