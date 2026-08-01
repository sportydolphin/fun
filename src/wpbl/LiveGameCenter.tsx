import { useEffect, useMemo, useState } from 'react'
import { Box, Typography } from '@mui/material'
import { fetchWpblRoster } from './api'
import { wpblAccent, wpblFullName, outsToIp } from './constants'
import { ModalShell, TeamBadge, useWpblDark } from './ui'
import type { WpblTeam, WpblGame, WpblPlayer, WpblHalf } from './types'
import { OUTCOMES, shortName, useWpblLiveGame, type LiveBundle, type Outcome } from './live'

// Public live views (Phase 3): the home-page LIVE hero and the full Live Game Center.
// Both read the realtime bundle (score, situation, box, play-by-play) so anyone watching
// sees the owner's scoring update within a second. Read-only — no writes here.

const LIVE_RED = '#ef4444'

// ─── Shared derivations ───────────────────────────────────────────────────────────

function useRosterNames(away: WpblTeam, home: WpblTeam) {
  const [names, setNames] = useState<Map<string, WpblPlayer>>(new Map())
  useEffect(() => {
    let cancelled = false
    Promise.all([fetchWpblRoster(away.id), fetchWpblRoster(home.id)]).then(([a, h]) => {
      if (!cancelled) setNames(new Map([...a, ...h].map(p => [p.id, p])))
    })
    return () => { cancelled = true }
  }, [away.id, home.id])
  return names
}

interface Situation {
  half: WpblHalf; inning: number; outs: number; balls: number; strikes: number
  battingTeam: WpblTeam; batterName: string | null; pitcherName: string | null
  first: string | null; second: string | null; third: string | null
}

function deriveSituation(bundle: LiveBundle, away: WpblTeam, home: WpblTeam, names: Map<string, WpblPlayer>): Situation | null {
  const g = bundle.game
  if (!g) return null
  const half = g.live_half ?? 'top'
  const battingTeam = half === 'top' ? away : home
  const order = half === 'top' ? (g.away_batting_order ?? 1) : (g.home_batting_order ?? 1)
  const active = bundle.batting.filter(b => b.team_id === battingTeam.id && !b.sub_out).sort((a, b) => (a.batting_order ?? 0) - (b.batting_order ?? 0))
  const batter = active.find(r => r.batting_order === order) ?? active[0]
  const pitcherId = half === 'top' ? g.home_pitcher_id : g.away_pitcher_id
  return {
    half, inning: g.live_inning ?? 1, outs: g.live_outs ?? 0, balls: g.live_balls ?? 0, strikes: g.live_strikes ?? 0,
    battingTeam, batterName: batter ? names.get(batter.player_id)?.name ?? null : null,
    pitcherName: pitcherId ? names.get(pitcherId)?.name ?? null : null,
    first: g.runner_first ?? null, second: g.runner_second ?? null, third: g.runner_third ?? null,
  }
}

// Small bases diamond (occupied bases filled with the section accent).
function MiniDiamond({ first, second, third, size = 34 }: { first: boolean; second: boolean; third: boolean; size?: number }) {
  const sq = (occ: boolean, pos: any) => (
    <Box sx={{ position: 'absolute', ...pos, width: size * 0.3, height: size * 0.3, transform: 'translate(-50%,-50%) rotate(45deg)', bgcolor: occ ? '#60a5fa' : 'transparent', border: '1.5px solid', borderColor: occ ? '#60a5fa' : 'text.disabled', borderRadius: '1px' }} />
  )
  return (
    <Box sx={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      {sq(second, { left: '50%', top: '22%' })}
      {sq(third, { left: '22%', top: '50%' })}
      {sq(first, { left: '78%', top: '50%' })}
    </Box>
  )
}

// The compact situation line shared by hero + center: inning arrow, diamond, outs, count.
function SituationStrip({ s }: { s: Situation }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4 }}>
        <Typography sx={{ fontSize: '0.7rem', fontWeight: 900 }}>{s.half === 'top' ? '▲' : '▼'}</Typography>
        <Typography sx={{ fontSize: '0.8rem', fontWeight: 800 }}>{s.inning}</Typography>
      </Box>
      <MiniDiamond first={!!s.first} second={!!s.second} third={!!s.third} />
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.2 }}>
        <Typography sx={{ fontSize: '0.68rem', color: 'text.secondary', lineHeight: 1 }}>{s.outs} out{s.outs !== 1 ? 's' : ''}</Typography>
        <Box sx={{ px: 0.7, py: '2px', borderRadius: 0.5, bgcolor: 'action.hover' }}>
          <Typography sx={{ fontSize: '0.66rem', fontWeight: 700, lineHeight: 1 }}>{s.balls}–{s.strikes}</Typography>
        </Box>
      </Box>
    </Box>
  )
}

// ─── Home-page LIVE hero ──────────────────────────────────────────────────────────

export function LiveHero({ game, teams, onOpenCenter }: {
  game: WpblGame; teams: WpblTeam[]; onOpenCenter: () => void
}) {
  const isDark = useWpblDark()
  const byId = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])
  const away = byId.get(game.away_team_id)!
  const home = byId.get(game.home_team_id)!
  const bundle = useWpblLiveGame(game.id)
  const names = useRosterNames(away, home)
  const g = bundle.game ?? game
  const s = deriveSituation(bundle.game ? bundle : { ...bundle, game: g }, away, home, names)

  const awayRuns = g.away_score ?? 0
  const homeRuns = g.home_score ?? 0

  const scoreRow = (t: WpblTeam, runs: number, batting: boolean) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <TeamBadge team={t} size={26} />
      <Typography sx={{ flex: 1, fontSize: '0.92rem', fontWeight: 700 }}>{wpblFullName(t)}</Typography>
      {batting && <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: LIVE_RED, mr: 0.5, animation: 'wpblpulse 1.5s ease-in-out infinite' }} />}
      <Typography sx={{ fontSize: '1.4rem', fontWeight: 900, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{runs}</Typography>
    </Box>
  )

  return (
    <Box sx={{
      mb: 2, borderRadius: 3, overflow: 'hidden', position: 'relative',
      border: '1.5px solid', borderColor: `${LIVE_RED}66`, bgcolor: 'background.paper',
      boxShadow: `0 0 0 1px ${LIVE_RED}18`,
      '@keyframes wpblpulse': { '0%': { opacity: 1 }, '50%': { opacity: 0.3 }, '100%': { opacity: 1 } },
    }}>
      {/* LIVE ribbon */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 2, py: 0.75, bgcolor: `${LIVE_RED}14`, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: LIVE_RED, animation: 'wpblpulse 1.5s ease-in-out infinite' }} />
        <Typography sx={{ fontSize: '0.66rem', fontWeight: 900, letterSpacing: 1, color: LIVE_RED, textTransform: 'uppercase' }}>Live Now</Typography>
        <Box sx={{ flex: 1 }} />
        <Box onClick={onOpenCenter} sx={{
          display: 'inline-flex', alignItems: 'center', gap: 0.4, cursor: 'pointer',
          fontSize: '0.66rem', fontWeight: 800, color: '#fff', px: 1.1, py: 0.35, borderRadius: 999, bgcolor: LIVE_RED,
          '&:hover': { bgcolor: '#dc2626' },
        }}>Game Center →</Box>
      </Box>

      <Box sx={{ p: 2, display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 1.5, alignItems: { sm: 'center' } }}>
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 0.75, minWidth: 0 }}>
          {scoreRow(away, awayRuns, s?.battingTeam.id === away.id)}
          {scoreRow(home, homeRuns, s?.battingTeam.id === home.id)}
        </Box>
        {s && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, alignItems: { xs: 'flex-start', sm: 'flex-end' }, pl: { sm: 2 }, borderLeft: { sm: '1px solid' }, borderColor: { sm: 'divider' } }}>
            <SituationStrip s={s} />
            <Box sx={{ textAlign: { sm: 'right' } }}>
              {s.batterName && <Typography sx={{ fontSize: '0.74rem' }}><Box component="span" sx={{ color: 'text.disabled', fontWeight: 700 }}>AB </Box><Box component="span" sx={{ fontWeight: 700, color: wpblAccent(s.battingTeam.id, isDark) }}>{shortName(s.batterName)}</Box></Typography>}
              {s.pitcherName && <Typography sx={{ fontSize: '0.74rem' }}><Box component="span" sx={{ color: 'text.disabled', fontWeight: 700 }}>P </Box><Box component="span" sx={{ fontWeight: 700 }}>{shortName(s.pitcherName)}</Box></Typography>}
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  )
}

// ─── Line score (derived from the play log) ─────────────────────────────────────

function LineScore({ bundle, away, home }: { bundle: LiveBundle; away: WpblTeam; home: WpblTeam }) {
  const g = bundle.game!
  const innings = Math.max(g.live_inning ?? 1, ...bundle.plays.map(p => p.inning), 1)
  const runsBy: Record<'top' | 'bottom', number[]> = { top: [], bottom: [] }
  const hitsBy: Record<'top' | 'bottom', number> = { top: 0, bottom: 0 }
  for (const p of bundle.plays) {
    runsBy[p.half][p.inning - 1] = (runsBy[p.half][p.inning - 1] ?? 0) + p.runs
    if (OUTCOMES[p.outcome as Outcome]?.h) hitsBy[p.half] += 1
  }
  const cell = { width: 24, textAlign: 'center' as const, fontSize: '0.74rem', fontVariantNumeric: 'tabular-nums' as const, flexShrink: 0 }
  const head = { ...cell, fontWeight: 800, color: 'text.disabled' as const }
  const totCell = { ...cell, width: 28, fontWeight: 900 }
  const nums = Array.from({ length: innings }, (_, i) => i + 1)
  const curInning = g.live_inning ?? 1
  // Has this half-inning started? (past inning, or the current one once its half is reached)
  const reached = (n: number, half: 'top' | 'bottom') =>
    n < curInning || (n === curInning && (half === 'top' || g.live_half === 'bottom'))
  const row = (t: WpblTeam, half: 'top' | 'bottom', total: number) => (
    <Box sx={{ display: 'flex', alignItems: 'center', py: 0.4 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 96, flexShrink: 0 }}>
        <TeamBadge team={t} size={18} /><Typography sx={{ fontSize: '0.78rem', fontWeight: 700 }}>{t.abbr}</Typography>
      </Box>
      {nums.map(n => <Box key={n} sx={cell}>{runsBy[half][n - 1] ?? (reached(n, half) ? 0 : '')}</Box>)}
      <Box sx={{ ...totCell, ml: 0.5 }}>{total}</Box>
      <Box sx={totCell}>{hitsBy[half]}</Box>
    </Box>
  )
  return (
    <Box sx={{ overflowX: 'auto', pb: 0.5 }}>
      <Box sx={{ minWidth: 'max-content' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', py: 0.4, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Box sx={{ minWidth: 96, flexShrink: 0 }} />
          {nums.map(n => <Box key={n} sx={head}>{n}</Box>)}
          <Box sx={{ ...head, width: 28, ml: 0.5, color: 'text.secondary' }}>R</Box>
          <Box sx={{ ...head, width: 28, color: 'text.secondary' }}>H</Box>
        </Box>
        {row(away, 'top', g.away_score ?? 0)}
        {row(home, 'bottom', g.home_score ?? 0)}
      </Box>
    </Box>
  )
}

// ─── Live box score ──────────────────────────────────────────────────────────────

const BOX_BAT: { key: 'ab' | 'r' | 'h' | 'rbi' | 'bb' | 'so'; label: string }[] = [
  { key: 'ab', label: 'AB' }, { key: 'r', label: 'R' }, { key: 'h', label: 'H' }, { key: 'rbi', label: 'RBI' }, { key: 'bb', label: 'BB' }, { key: 'so', label: 'SO' },
]

function LiveBox({ bundle, team, names }: { bundle: LiveBundle; team: WpblTeam; names: Map<string, WpblPlayer> }) {
  const isDark = useWpblDark()
  const color = wpblAccent(team.id, isDark)
  const bat = bundle.batting.filter(b => b.team_id === team.id).sort((a, b) => (a.batting_order ?? 99) - (b.batting_order ?? 99))
  const pit = bundle.pitching.filter(p => p.team_id === team.id)
  if (bat.length === 0 && pit.length === 0) return null
  const nameCol = { minWidth: 130, maxWidth: 170, fontSize: '0.78rem', pr: 1 } as const
  const statCol = { width: 34, textAlign: 'center' as const, fontSize: '0.78rem', flexShrink: 0 }
  const head = { fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase' as const, letterSpacing: 0.3, color: 'text.disabled' as const }
  return (
    <Box sx={{ mb: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
        <TeamBadge team={team} size={22} /><Typography sx={{ fontSize: '0.9rem', fontWeight: 800 }}>{wpblFullName(team)}</Typography>
      </Box>
      <Box sx={{ overflowX: 'auto' }}>
        <Box sx={{ minWidth: 'max-content', fontVariantNumeric: 'tabular-nums' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', py: 0.4 }}>
            <Box sx={{ ...nameCol, ...head }}>Batter</Box>
            {BOX_BAT.map(c => <Box key={c.key} sx={{ ...statCol, ...head }}>{c.label}</Box>)}
          </Box>
          {bat.map(b => (
            <Box key={b.id} sx={{ display: 'flex', alignItems: 'center', py: 0.4, borderTop: '1px solid', borderColor: 'divider', opacity: b.sub_out ? 0.55 : 1 }}>
              <Box sx={{ ...nameCol, fontWeight: 600 }}>
                <Box component="span" sx={{ color: 'text.disabled', mr: 0.5 }}>{b.batting_order}</Box>
                {names.get(b.player_id)?.name ?? '—'}
                {b.position ? <Box component="span" sx={{ color: 'text.disabled', fontWeight: 500 }}> {b.position}</Box> : null}
              </Box>
              {BOX_BAT.map(c => <Box key={c.key} sx={statCol}>{b[c.key]}</Box>)}
            </Box>
          ))}
          {pit.length > 0 && (
            <>
              <Box sx={{ display: 'flex', alignItems: 'center', py: 0.4, mt: 0.5 }}>
                <Box sx={{ ...nameCol, ...head }}>Pitcher</Box>
                <Box sx={{ ...statCol, ...head }}>IP</Box>
                <Box sx={{ ...statCol, ...head }}>H</Box>
                <Box sx={{ ...statCol, ...head }}>R</Box>
                <Box sx={{ ...statCol, ...head }}>BB</Box>
                <Box sx={{ ...statCol, ...head }}>SO</Box>
              </Box>
              {pit.map(p => (
                <Box key={p.id} sx={{ display: 'flex', alignItems: 'center', py: 0.4, borderTop: '1px solid', borderColor: 'divider' }}>
                  <Box sx={{ ...nameCol, fontWeight: 600, color }}>{names.get(p.player_id)?.name ?? '—'}</Box>
                  <Box sx={statCol}>{outsToIp(p.outs)}</Box>
                  <Box sx={statCol}>{p.h}</Box>
                  <Box sx={statCol}>{p.r}</Box>
                  <Box sx={statCol}>{p.bb}</Box>
                  <Box sx={statCol}>{p.so}</Box>
                </Box>
              ))}
            </>
          )}
        </Box>
      </Box>
    </Box>
  )
}

// ─── Live Game Center modal ──────────────────────────────────────────────────────

type Tab = 'plays' | 'box'

export function LiveGameCenter({ game, teams, onClose }: { game: WpblGame; teams: WpblTeam[]; onClose: () => void }) {
  const isDark = useWpblDark()
  const byId = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])
  const away = byId.get(game.away_team_id)!
  const home = byId.get(game.home_team_id)!
  const bundle = useWpblLiveGame(game.id)
  const names = useRosterNames(away, home)
  const [tab, setTab] = useState<Tab>('plays')
  const g = bundle.game ?? game
  const s = bundle.game ? deriveSituation(bundle, away, home, names) : null
  const isFinal = g.status === 'final'

  // Group plays by half-inning for the feed.
  const grouped = useMemo(() => {
    const map = new Map<string, typeof bundle.plays>()
    for (const p of bundle.plays) {
      const k = `${p.inning}-${p.half}`
      const arr = map.get(k) ?? []; arr.push(p); map.set(k, arr)
    }
    return [...map.entries()].sort((a, b) => {
      const [ai, ah] = a[0].split('-'); const [bi, bh] = b[0].split('-')
      if (+ai !== +bi) return +bi - +ai
      return ah === bh ? 0 : ah === 'bottom' ? -1 : 1
    })
  }, [bundle.plays])

  return (
    <ModalShell eyebrow={`${away.abbr} @ ${home.abbr} · ${isFinal ? 'Final' : 'Live'}`} onClose={onClose} maxWidth={720} zIndex={1550}>
      {/* Score header */}
      <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          {!isFinal && <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.3, borderRadius: 999, bgcolor: `${LIVE_RED}18`, '@keyframes wpblpulse2': { '0%': { opacity: 1 }, '50%': { opacity: 0.3 }, '100%': { opacity: 1 } } }}>
            <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: LIVE_RED, animation: 'wpblpulse2 1.5s ease-in-out infinite' }} />
            <Typography sx={{ fontSize: '0.62rem', fontWeight: 900, color: LIVE_RED, letterSpacing: 0.8 }}>LIVE</Typography>
          </Box>}
          <Box sx={{ flex: 1 }} />
          {s && <SituationStrip s={s} />}
        </Box>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mt: 1.5 }}>
          {[away, home].map((t, i) => {
            const runs = i === 0 ? (g.away_score ?? 0) : (g.home_score ?? 0)
            const batting = s?.battingTeam.id === t.id
            return (
              <Box key={t.id} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <TeamBadge team={t} size={28} />
                <Typography sx={{ flex: 1, fontSize: '1rem', fontWeight: 700 }}>{wpblFullName(t)}</Typography>
                {batting && !isFinal && <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: LIVE_RED, mr: 0.5 }} />}
                <Typography sx={{ fontSize: '1.4rem', fontWeight: 900, fontVariantNumeric: 'tabular-nums' }}>{runs}</Typography>
              </Box>
            )
          })}
        </Box>
        {s?.batterName && (
          <Typography sx={{ fontSize: '0.76rem', color: 'text.secondary', mt: 1 }}>
            <Box component="span" sx={{ fontWeight: 700, color: wpblAccent(s.battingTeam.id, isDark) }}>{shortName(s.batterName)}</Box> at bat
            {s.pitcherName && <> · <Box component="span" sx={{ fontWeight: 700 }}>{shortName(s.pitcherName)}</Box> pitching</>}
          </Typography>
        )}
      </Box>

      {/* Line score */}
      {bundle.game && (
        <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
          <LineScore bundle={bundle} away={away} home={home} />
        </Box>
      )}

      {/* Tabs */}
      <Box sx={{ display: 'flex', gap: 1, px: 2, pt: 1.5 }}>
        {(['plays', 'box'] as Tab[]).map(t => (
          <Box key={t} onClick={() => setTab(t)} sx={{
            px: 1.5, py: 0.5, borderRadius: 999, cursor: 'pointer', fontSize: '0.78rem', fontWeight: 700,
            bgcolor: tab === t ? '#60a5fa' : 'action.hover', color: tab === t ? '#fff' : 'text.secondary',
          }}>{t === 'plays' ? 'Play-by-play' : 'Box score'}</Box>
        ))}
      </Box>

      <Box sx={{ p: 2 }}>
        {tab === 'plays' ? (
          bundle.plays.length === 0 ? (
            <Typography sx={{ fontSize: '0.85rem', color: 'text.disabled', textAlign: 'center', py: 4 }}>No plays yet — the feed starts at first pitch.</Typography>
          ) : (
            grouped.map(([key, plays]) => {
              const [inning, half] = key.split('-')
              return (
                <Box key={key} sx={{ mb: 1.5 }}>
                  <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.8, color: 'text.disabled', mb: 0.4 }}>
                    {half === 'top' ? 'Top' : 'Bottom'} {inning}
                  </Typography>
                  {[...plays].reverse().map(p => (
                    <Box key={p.id} sx={{ display: 'flex', gap: 1, py: 0.4, borderTop: '1px solid', borderColor: 'divider' }}>
                      {p.runs > 0 && <Box sx={{ px: 0.6, py: '1px', borderRadius: 0.5, bgcolor: `${LIVE_RED}18`, height: 'fit-content' }}><Typography sx={{ fontSize: '0.62rem', fontWeight: 800, color: LIVE_RED }}>+{p.runs}</Typography></Box>}
                      <Typography sx={{ fontSize: '0.82rem', flex: 1 }}>{p.description}</Typography>
                    </Box>
                  ))}
                </Box>
              )
            })
          )
        ) : (
          <>
            <LiveBox bundle={bundle} team={away} names={names} />
            <LiveBox bundle={bundle} team={home} names={names} />
          </>
        )}
      </Box>
    </ModalShell>
  )
}
