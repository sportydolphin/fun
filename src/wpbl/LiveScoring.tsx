import { useEffect, useMemo, useState } from 'react'
import { Box, Typography, Button, CircularProgress, Alert } from '@mui/material'
import { fetchWpblRoster } from './api'
import { wpblAccent, wpblFullName } from './constants'
import { ModalShell, TeamBadge, useWpblDark } from './ui'
import type { WpblTeam, WpblGame, WpblPlayer, WpblBattingLine, WpblHalf } from './types'
import {
  OUTCOMES, HIT_OUTCOMES, REACH_OUTCOMES, OUT_OUTCOMES, type Outcome, type OutcomeMeta,
  liveStateOf, proposeEffect, proposeBaserun, commit, describePlay, shortName,
  saveLineup, startLive, logPlay, undoLastPlay, patchLive, changePitcher, subBatter, finishLive,
  editPitcher, upsertBattingSlot,
  fetchLiveBundle, useWpblLiveGame, type NewPlay, type LineupEntry,
} from './live'

// Owner-only live scoring console (Phase 3). Two modes:
//   • Setup — pick each team's 9-deep batting order + starting pitcher, then "Start game".
//   • Console — the at-bat-by-at-bat scorer: situation, big outcome buttons, count, undo.
// Every action writes to Supabase (owner RLS) and recomputes the box score from the play
// log, so viewers watching the live hero / game center see it within a second.

const POSITIONS = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH']

// ─── Small inputs ───────────────────────────────────────────────────────────────

const fieldSx = {
  fontSize: '0.82rem', p: '5px 6px', fontFamily: 'inherit', borderRadius: 1,
  border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', color: 'text.primary',
} as const

function Stepper({ value, onChange, min = 0, max = 20 }: { value: number; onChange: (n: number) => void; min?: number; max?: number }) {
  const btn = { width: 30, height: 30, borderRadius: 1, border: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', userSelect: 'none', fontWeight: 800, fontSize: '1rem', lineHeight: 1, '&:hover': { bgcolor: 'action.hover' } } as const
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
      <Box sx={btn} onClick={() => onChange(Math.max(min, value - 1))}>−</Box>
      <Typography sx={{ minWidth: 20, textAlign: 'center', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{value}</Typography>
      <Box sx={btn} onClick={() => onChange(Math.min(max, value + 1))}>+</Box>
    </Box>
  )
}

// ─── Setup ──────────────────────────────────────────────────────────────────────

interface SlotState { player_id: string; position: string }
const emptySlots = (): SlotState[] => Array.from({ length: 9 }, () => ({ player_id: '', position: '' }))

function LineupEditor({ team, roster, slots, pitcherId, onSlots, onPitcher }: {
  team: WpblTeam; roster: WpblPlayer[]
  slots: SlotState[]; pitcherId: string
  onSlots: (s: SlotState[]) => void; onPitcher: (id: string) => void
}) {
  const used = new Set(slots.map(s => s.player_id).filter(Boolean))
  const autofill = () => {
    const order = [...roster].filter(p => (p.position ?? '') !== 'P').slice(0, 9)
    onSlots(Array.from({ length: 9 }, (_, i) => ({ player_id: order[i]?.id ?? '', position: order[i]?.position ?? '' })))
    const p = roster.find(r => (r.position ?? '') === 'P')
    if (p && !pitcherId) onPitcher(p.id)
  }
  return (
    <Box sx={{ mb: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <TeamBadge team={team} size={26} />
        <Typography sx={{ fontSize: '0.95rem', fontWeight: 800, flex: 1 }}>{wpblFullName(team)}</Typography>
        <Button size="small" onClick={autofill} sx={{ textTransform: 'none', fontSize: '0.72rem' }}>Fill from roster</Button>
      </Box>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        {slots.map((s, i) => (
          <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Typography sx={{ width: 18, textAlign: 'right', fontSize: '0.78rem', fontWeight: 800, color: 'text.disabled' }}>{i + 1}</Typography>
            <Box component="select" value={s.player_id}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onSlots(slots.map((x, j) => j === i ? { ...x, player_id: e.target.value, position: x.position || roster.find(r => r.id === e.target.value)?.position || '' } : x))}
              sx={{ ...fieldSx, flex: 1, minWidth: 0 }}>
              <option value="">Select batter…</option>
              {roster.map(p => <option key={p.id} value={p.id} disabled={used.has(p.id) && p.id !== s.player_id}>{p.name}</option>)}
            </Box>
            <Box component="select" value={s.position}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onSlots(slots.map((x, j) => j === i ? { ...x, position: e.target.value } : x))}
              sx={{ ...fieldSx, width: 66 }}>
              <option value="">Pos</option>
              {POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
            </Box>
          </Box>
        ))}
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
        <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5, color: 'text.disabled' }}>Starting pitcher</Typography>
        <Box component="select" value={pitcherId} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onPitcher(e.target.value)} sx={{ ...fieldSx, flex: 1, minWidth: 0 }}>
          <option value="">Select pitcher…</option>
          {roster.map(p => <option key={p.id} value={p.id}>{p.name}{p.position ? ` (${p.position})` : ''}</option>)}
        </Box>
      </Box>
    </Box>
  )
}

// ─── Diamond (with runner names) ──────────────────────────────────────────────────

function Diamond({ first, second, third, names, size = 96 }: {
  first: string | null; second: string | null; third: string | null
  names: Map<string, WpblPlayer>; size?: number
}) {
  const isDark = useWpblDark()
  const accent = '#60a5fa'
  const base = (occ: string | null, x: number, y: number, label: string) => (
    <Box sx={{ position: 'absolute', left: x, top: y, transform: 'translate(-50%,-50%)', textAlign: 'center' }}>
      <Box sx={{
        width: 22, height: 22, transform: 'rotate(45deg)', mx: 'auto',
        bgcolor: occ ? accent : 'transparent', border: '2px solid', borderColor: occ ? accent : 'text.disabled', borderRadius: '2px',
      }} />
      {occ && <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, mt: 0.3, whiteSpace: 'nowrap', color: isDark ? '#cfe4ff' : '#1e3a5f' }}>{shortName(names.get(occ)?.name ?? '')}</Typography>}
      {!occ && <Typography sx={{ fontSize: '0.55rem', color: 'text.disabled', mt: 0.3 }}>{label}</Typography>}
    </Box>
  )
  return (
    <Box sx={{ position: 'relative', width: size, height: size, mx: 'auto' }}>
      {base(second, size / 2, size * 0.18, '2nd')}
      {base(third, size * 0.16, size / 2, '3rd')}
      {base(first, size * 0.84, size / 2, '1st')}
      <Box sx={{ position: 'absolute', left: size / 2, top: size * 0.82, transform: 'translate(-50%,-50%) rotate(45deg)', width: 12, height: 12, border: '2px solid', borderColor: 'text.disabled', borderRadius: '2px' }} />
    </Box>
  )
}

// ─── Console ──────────────────────────────────────────────────────────────────────

interface ActiveLineup { rows: WpblBattingLine[] } // sub_out=false rows, sorted by order

export default function LiveScoring({ game, teams, onClose, onChanged }: {
  game: WpblGame
  teams: WpblTeam[]
  onClose: () => void
  onChanged: () => void
}) {
  const isDark = useWpblDark()
  const byId = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])
  const away = byId.get(game.away_team_id)!
  const home = byId.get(game.home_team_id)!

  const live = useWpblLiveGame(game.id)
  const [rosters, setRosters] = useState<{ away: WpblPlayer[]; home: WpblPlayer[] }>({ away: [], home: [] })
  const names = useMemo(() => new Map([...rosters.away, ...rosters.home].map(p => [p.id, p])), [rosters])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Local optimistic working copy of the game situation for instant UI.
  const [g, setG] = useState<WpblGame>(game)
  const [seeded, setSeeded] = useState(false)
  useEffect(() => {
    if (live.game && !seeded) { setG(live.game); setSeeded(true) }
  }, [live.game, seeded])

  useEffect(() => {
    Promise.all([fetchWpblRoster(away.id), fetchWpblRoster(home.id)]).then(([a, h]) => setRosters({ away: a, home: h }))
  }, [away.id, home.id])

  const isLive = g.status === 'live'

  // ── Setup state ──
  const [awaySlots, setAwaySlots] = useState<SlotState[]>(emptySlots)
  const [homeSlots, setHomeSlots] = useState<SlotState[]>(emptySlots)
  const [awayP, setAwayP] = useState('')
  const [homeP, setHomeP] = useState('')

  async function handleStart() {
    setError(null)
    const mk = (slots: SlotState[]): LineupEntry[] => slots.filter(s => s.player_id).map((s, i) => ({ player_id: s.player_id, batting_order: i + 1, position: s.position || null }))
    const aLine = mk(awaySlots), hLine = mk(homeSlots)
    if (aLine.length < 9 || hLine.length < 9) { setError('Set all 9 batters for both teams.'); return }
    if (!awayP || !homeP) { setError('Pick a starting pitcher for both teams.'); return }
    setSaving(true)
    const r1 = await saveLineup(game.id, away.id, 'away', aLine, awayP)
    const r2 = r1.ok ? await saveLineup(game.id, home.id, 'home', hLine, homeP) : r1
    const r3 = r2.ok ? await startLive(game.id) : r2
    setSaving(false)
    if (!r3.ok) { setError(r3.error ?? 'Could not start the game.'); return }
    setG(gg => ({ ...gg, status: 'live', away_score: 0, home_score: 0, live_inning: 1, live_half: 'top', live_outs: 0, live_balls: 0, live_strikes: 0, runner_first: null, runner_second: null, runner_third: null, away_batting_order: 1, home_batting_order: 1, away_pitcher_id: awayP, home_pitcher_id: homeP }))
    live.refresh(); onChanged()
  }

  // ── Derived situation ──
  const half: WpblHalf = g.live_half ?? 'top'
  const battingSide: 'away' | 'home' = half === 'top' ? 'away' : 'home'
  const battingTeam = battingSide === 'away' ? away : home
  const fieldingPitcherId = half === 'top' ? g.home_pitcher_id : g.away_pitcher_id
  const battingOrder = battingSide === 'away' ? (g.away_batting_order ?? 1) : (g.home_batting_order ?? 1)

  const activeLineup: ActiveLineup = useMemo(() => {
    const rows = live.batting.filter(b => b.team_id === battingTeam.id && !b.sub_out).sort((a, b2) => (a.batting_order ?? 0) - (b2.batting_order ?? 0))
    return { rows }
  }, [live.batting, battingTeam.id])
  const currentBatterLine = activeLineup.rows.find(r => r.batting_order === battingOrder) ?? activeLineup.rows[0]
  const currentBatter = currentBatterLine ? names.get(currentBatterLine.player_id) : undefined
  const currentPitcher = fieldingPitcherId ? names.get(fieldingPitcherId) : undefined

  const balls = g.live_balls ?? 0
  const strikes = g.live_strikes ?? 0
  const outs = g.live_outs ?? 0

  // ── Pending confirm (batter outcome) ──
  const [pending, setPending] = useState<{ meta: OutcomeMeta; runs: number; rbi: number } | null>(null)
  const [baserunMode, setBaserunMode] = useState<'SB' | 'CS' | null>(null)
  const [subMode, setSubMode] = useState(false)
  const [pitcherMode, setPitcherMode] = useState(false)
  const [editMode, setEditMode] = useState(false)

  function beginOutcome(code: Outcome) {
    if (!currentBatter) { setError('No batter is up — check the lineup.'); return }
    const meta = OUTCOMES[code]
    const eff = proposeEffect(liveStateOf(g), code, currentBatterLine!.player_id)
    const runs = eff.scored.length
    const noRbi = code === 'E' || code === 'FC' || code === 'DP'
    setPending({ meta, runs, rbi: noRbi ? 0 : runs })
  }

  async function confirmOutcome() {
    if (!pending || !currentBatterLine) return
    const { meta, runs, rbi } = pending
    const prev = liveStateOf(g)
    // Re-derive the base layout from the engine, then honor the scorer's run count by
    // scoring extra lead runners (or leaving them on) to match.
    const eff = proposeEffect(prev, meta.code, currentBatterLine.player_id)
    const committed = commit(prev, meta, eff, runs)
    const desc = describePlay(meta, currentBatter?.name ?? '', runs)
    const play: NewPlay = {
      game_id: g.id, inning: g.live_inning ?? 1, half,
      batting_team_id: battingTeam.id, batter_id: currentBatterLine.player_id,
      pitcher_id: fieldingPitcherId ?? null, runner_id: null,
      outcome: meta.code, rbi, runs, outs_recorded: eff.outsAdded, scored_ids: eff.scored,
      description: desc,
      away_score_after: committed.state.away_score, home_score_after: committed.state.home_score,
      inning_after: committed.state.live_inning, half_after: committed.state.live_half, outs_after: committed.state.live_outs,
      runner_first_after: committed.state.runner_first, runner_second_after: committed.state.runner_second, runner_third_after: committed.state.runner_third,
      away_order_after: committed.state.away_batting_order, home_order_after: committed.state.home_batting_order,
    }
    const patch: Partial<WpblGame> = {
      away_score: committed.state.away_score, home_score: committed.state.home_score,
      live_inning: committed.state.live_inning, live_half: committed.state.live_half, live_outs: committed.state.live_outs,
      live_balls: 0, live_strikes: 0,
      runner_first: committed.state.runner_first, runner_second: committed.state.runner_second, runner_third: committed.state.runner_third,
      away_batting_order: committed.state.away_batting_order, home_batting_order: committed.state.home_batting_order,
    }
    setG(gg => ({ ...gg, ...patch }))
    setPending(null)
    setSaving(true)
    const res = await logPlay(play, patch)
    setSaving(false)
    if (!res.ok) setError(res.error ?? 'Could not save the play.')
    live.refresh(); onChanged()
  }

  async function doBaserun(fromBase: 1 | 2 | 3, runnerId: string) {
    if (!baserunMode) return
    const code = baserunMode
    const meta = OUTCOMES[code]
    const prev = liveStateOf(g)
    const eff = proposeBaserun(prev, code, fromBase)
    const committed = commit(prev, meta, eff, eff.scored.length)
    const play: NewPlay = {
      game_id: g.id, inning: g.live_inning ?? 1, half,
      batting_team_id: battingTeam.id, batter_id: null,
      pitcher_id: fieldingPitcherId ?? null, runner_id: runnerId,
      outcome: code, rbi: 0, runs: eff.scored.length, outs_recorded: eff.outsAdded, scored_ids: eff.scored,
      description: describePlay(meta, '', eff.scored.length, shortName(names.get(runnerId)?.name ?? '')),
      away_score_after: committed.state.away_score, home_score_after: committed.state.home_score,
      inning_after: committed.state.live_inning, half_after: committed.state.live_half, outs_after: committed.state.live_outs,
      runner_first_after: committed.state.runner_first, runner_second_after: committed.state.runner_second, runner_third_after: committed.state.runner_third,
      away_order_after: committed.state.away_batting_order, home_order_after: committed.state.home_batting_order,
    }
    const patch: Partial<WpblGame> = {
      away_score: committed.state.away_score, home_score: committed.state.home_score,
      live_inning: committed.state.live_inning, live_half: committed.state.live_half, live_outs: committed.state.live_outs,
      runner_first: committed.state.runner_first, runner_second: committed.state.runner_second, runner_third: committed.state.runner_third,
    }
    setG(gg => ({ ...gg, ...patch }))
    setBaserunMode(null)
    setSaving(true)
    const res = await logPlay(play, patch)
    setSaving(false)
    if (!res.ok) setError(res.error ?? 'Could not save the play.')
    live.refresh(); onChanged()
  }

  // Balls/strikes — auto-log a walk/strikeout at 4/3.
  async function addBall() {
    if (balls + 1 >= 4) { beginOutcomeAuto('BB'); return }
    setG(gg => ({ ...gg, live_balls: balls + 1 }))
    await patchLive(g.id, { live_balls: balls + 1 })
  }
  async function addStrike(foul = false) {
    if (!foul && strikes + 1 >= 3) { beginOutcomeAuto('K'); return }
    const ns = foul ? Math.min(2, strikes + 1) : strikes + 1
    setG(gg => ({ ...gg, live_strikes: ns }))
    await patchLive(g.id, { live_strikes: ns })
  }
  // Auto outcomes (walk/K from the count) commit immediately with their defaults.
  function beginOutcomeAuto(code: Outcome) {
    if (!currentBatterLine) return
    const meta = OUTCOMES[code]
    const eff = proposeEffect(liveStateOf(g), code, currentBatterLine.player_id)
    setPending({ meta, runs: eff.scored.length, rbi: code === 'BB' ? eff.scored.length : 0 })
  }

  async function handleUndo() {
    setSaving(true)
    const res = await undoLastPlay(g.id)
    setSaving(false)
    if (!res.ok) { setError(res.error ?? 'Undo failed.'); return }
    // Pull authoritative state back after undo.
    const b = await fetchLiveBundle(g.id)
    if (b.game) setG(b.game)
    live.refresh(); onChanged()
  }

  async function handleFinish() {
    if (!window.confirm('End the game and mark it Final?')) return
    setSaving(true)
    const res = await finishLive(g.id, g.away_score ?? 0, g.home_score ?? 0, Math.max(7, g.live_inning ?? 7))
    setSaving(false)
    if (!res.ok) { setError(res.error ?? 'Could not finish.'); return }
    setG(gg => ({ ...gg, status: 'final' }))
    live.refresh(); onChanged()
    onClose()
  }

  // Bench players available to sub (roster minus anyone already with a line).
  const usedIds = new Set(live.batting.map(b => b.player_id))
  const bench = (battingSide === 'away' ? rosters.away : rosters.home).filter(p => !usedIds.has(p.id))
  const bullpen = (half === 'top' ? rosters.home : rosters.away) // fielding side's roster

  async function doSub(inPlayerId: string) {
    if (!currentBatterLine) return
    setSubMode(false); setSaving(true)
    const res = await subBatter(g.id, battingTeam.id, currentBatterLine.id, inPlayerId, currentBatterLine.batting_order ?? battingOrder, currentBatterLine.position)
    setSaving(false)
    if (!res.ok) { setError(res.error ?? 'Sub failed.'); return }
    live.refresh(); onChanged()
  }
  async function doPitcherChange(inPlayerId: string) {
    setPitcherMode(false); setSaving(true)
    const fieldingSide: 'away' | 'home' = half === 'top' ? 'home' : 'away'
    const fieldingTeam = fieldingSide === 'away' ? away : home
    const res = await changePitcher(g.id, fieldingTeam.id, fieldingSide, inPlayerId)
    setSaving(false)
    if (!res.ok) { setError(res.error ?? 'Pitching change failed.'); return }
    setG(gg => fieldingSide === 'away' ? { ...gg, away_pitcher_id: inPlayerId } : { ...gg, home_pitcher_id: inPlayerId })
    live.refresh(); onChanged()
  }

  // Set a lineup slot: edits in place if it exists, inserts if the slot was empty.
  async function doEditSlot(teamId: string, order: number, playerId: string, position: string | null, lineId: string | null) {
    setSaving(true)
    const res = await upsertBattingSlot(g.id, teamId, order, playerId, position, lineId)
    setSaving(false)
    if (!res.ok) { setError(res.error ?? 'Could not update the lineup.'); return }
    live.refresh(); onChanged()
  }
  // Correct who is pitching for a side in place (preserves that pitcher's stats).
  async function doEditPitcher(side: 'away' | 'home', teamId: string, playerId: string) {
    const curLineId = live.pitching.find(p => p.team_id === teamId && p.player_id === (side === 'away' ? g.away_pitcher_id : g.home_pitcher_id))?.id ?? null
    setSaving(true)
    const res = await editPitcher(g.id, side, curLineId, playerId)
    setSaving(false)
    if (!res.ok) { setError(res.error ?? 'Could not update the pitcher.'); return }
    setG(gg => side === 'away' ? { ...gg, away_pitcher_id: playerId } : { ...gg, home_pitcher_id: playerId })
    live.refresh(); onChanged()
  }

  const battingColor = wpblAccent(battingTeam.id, isDark)
  const inningLabel = `${half === 'top' ? 'Top' : 'Bot'} ${g.live_inning ?? 1}`

  // ─── Render ─────────────────────────────────────────────────────────────────

  const eyebrow = `${away.abbr} @ ${home.abbr} · ${isLive ? 'Live scoring' : 'Set lineups'}`

  return (
    <ModalShell eyebrow={eyebrow} onClose={onClose} maxWidth={640} zIndex={1600}>
      {error && <Alert severity="error" onClose={() => setError(null)} sx={{ m: 2, mb: 0 }}>{error}</Alert>}

      {live.loading && !seeded ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>
      ) : !isLive ? (
        // ── SETUP ──
        <Box sx={{ p: 2 }}>
          <Typography sx={{ fontSize: '0.82rem', color: 'text.secondary', mb: 2 }}>
            Set both batting orders and starting pitchers, then start the game. You can pinch-hit and change pitchers once it is underway.
          </Typography>
          <LineupEditor team={away} roster={rosters.away} slots={awaySlots} pitcherId={awayP} onSlots={setAwaySlots} onPitcher={setAwayP} />
          <LineupEditor team={home} roster={rosters.home} slots={homeSlots} pitcherId={homeP} onSlots={setHomeSlots} onPitcher={setHomeP} />
          <Button fullWidth variant="contained" onClick={handleStart} disabled={saving} sx={{ textTransform: 'none', fontWeight: 800, py: 1.2 }}>
            {saving ? <CircularProgress size={20} color="inherit" /> : '▶ Start game'}
          </Button>
        </Box>
      ) : (
        // ── CONSOLE ──
        <Box sx={{ p: 2 }}>
          {/* Scoreboard */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
            {[away, home].map((t, i) => {
              const score = i === 0 ? (g.away_score ?? 0) : (g.home_score ?? 0)
              const batting = t.id === battingTeam.id
              return (
                <Box key={t.id} sx={{ flex: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <TeamBadge team={t} size={30} />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, color: 'text.secondary' }}>{t.abbr}{batting && <Box component="span" sx={{ color: '#ef4444', ml: 0.5 }}>●</Box>}</Typography>
                    <Typography sx={{ fontSize: '1.6rem', fontWeight: 900, lineHeight: 1 }}>{score}</Typography>
                  </Box>
                </Box>
              )
            })}
            <Box sx={{ textAlign: 'center' }}>
              <Typography sx={{ fontSize: '0.9rem', fontWeight: 800, color: '#ef4444' }}>{inningLabel}</Typography>
              <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary' }}>{outs} out{outs !== 1 ? 's' : ''}</Typography>
            </Box>
          </Box>

          {/* Diamond + count */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1.5, p: 1.5, borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
            <Diamond first={g.runner_first ?? null} second={g.runner_second ?? null} third={g.runner_third ?? null} names={names} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ fontSize: '0.58rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6, color: 'text.disabled' }}>At bat · {battingTeam.abbr} #{battingOrder}</Typography>
              <Typography sx={{ fontSize: '0.95rem', fontWeight: 800, lineHeight: 1.2, color: battingColor }}>{currentBatter?.name ?? '—'}</Typography>
              {currentBatterLine && <Typography sx={{ fontSize: '0.68rem', color: 'text.secondary' }}>{currentBatterLine.h}-for-{currentBatterLine.ab}{currentBatterLine.rbi ? `, ${currentBatterLine.rbi} RBI` : ''}</Typography>}
              <Typography sx={{ fontSize: '0.58rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6, color: 'text.disabled', mt: 0.75 }}>Pitching</Typography>
              <Typography sx={{ fontSize: '0.82rem', fontWeight: 700 }}>{currentPitcher?.name ?? '—'}</Typography>
              {/* Count */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.75 }}>
                <Typography sx={{ fontSize: '0.9rem', fontWeight: 900, fontVariantNumeric: 'tabular-nums' }}>{balls}<Box component="span" sx={{ color: 'text.disabled' }}>–</Box>{strikes}</Typography>
                <Button size="small" onClick={addBall} sx={pillBtnSx}>Ball</Button>
                <Button size="small" onClick={() => addStrike(false)} sx={pillBtnSx}>Strike</Button>
                <Button size="small" onClick={() => addStrike(true)} sx={pillBtnSx}>Foul</Button>
              </Box>
            </Box>
          </Box>

          {/* Pending confirm bar */}
          {pending ? (
            <Box sx={{ p: 1.5, mb: 1.5, borderRadius: 2, border: '1px solid', borderColor: battingColor, bgcolor: `${battingColor}12` }}>
              <Typography sx={{ fontSize: '0.9rem', fontWeight: 800, mb: 1 }}>{pending.meta.label} — {shortName(currentBatter?.name ?? '')}</Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2, mb: 1.5 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', color: 'text.disabled' }}>Runs</Typography>
                  <Stepper value={pending.runs} onChange={n => setPending(p => p && { ...p, runs: n, rbi: Math.min(p.rbi, n) })} max={4} />
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', color: 'text.disabled' }}>RBI</Typography>
                  <Stepper value={pending.rbi} onChange={n => setPending(p => p && { ...p, rbi: n })} max={4} />
                </Box>
              </Box>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button onClick={() => setPending(null)} sx={{ textTransform: 'none', flex: 1 }}>Cancel</Button>
                <Button variant="contained" onClick={confirmOutcome} disabled={saving} sx={{ textTransform: 'none', flex: 2, fontWeight: 800 }}>Confirm play</Button>
              </Box>
            </Box>
          ) : baserunMode ? (
            <Box sx={{ p: 1.5, mb: 1.5, borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
              <Typography sx={{ fontSize: '0.82rem', fontWeight: 800, mb: 1 }}>{baserunMode === 'SB' ? 'Stolen base' : 'Caught stealing'} — pick the runner</Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {([[1, g.runner_first], [2, g.runner_second], [3, g.runner_third]] as [1 | 2 | 3, string | null | undefined][])
                  .filter(([, id]) => id)
                  .map(([b, id]) => (
                    <Button key={b} variant="outlined" onClick={() => doBaserun(b, id!)} sx={{ textTransform: 'none' }}>
                      {shortName(names.get(id!)?.name ?? '')} ({b === 1 ? '1st' : b === 2 ? '2nd' : '3rd'})
                    </Button>
                  ))}
                {!g.runner_first && !g.runner_second && !g.runner_third && <Typography sx={{ fontSize: '0.8rem', color: 'text.disabled' }}>No runners on base.</Typography>}
              </Box>
              <Button onClick={() => setBaserunMode(null)} sx={{ textTransform: 'none', mt: 1 }}>Cancel</Button>
            </Box>
          ) : subMode ? (
            <PickPlayer title="Pinch hitter" players={bench} onPick={doSub} onCancel={() => setSubMode(false)} />
          ) : pitcherMode ? (
            <PickPlayer title="New pitcher" players={bullpen} onPick={doPitcherChange} onCancel={() => setPitcherMode(false)} />
          ) : editMode ? (
            <EditLineups
              teams={[away, home]}
              rosters={rosters}
              batting={live.batting}
              pitcherIds={{ away: g.away_pitcher_id ?? '', home: g.home_pitcher_id ?? '' }}
              disabled={saving}
              onEditSlot={doEditSlot}
              onEditPitcher={doEditPitcher}
              onDone={() => setEditMode(false)}
            />
          ) : (
            <>
              {/* Outcome buttons */}
              <OutcomeRow label="Hit" codes={HIT_OUTCOMES} onPick={beginOutcome} color={battingColor} filled />
              <OutcomeRow label="Reached" codes={REACH_OUTCOMES} onPick={beginOutcome} color={battingColor} />
              <OutcomeRow label="Out" codes={OUT_OUTCOMES} onPick={beginOutcome} color="#64748b" />

              {/* Baserunning + management */}
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 1.5 }}>
                <Button size="small" variant="outlined" onClick={() => setBaserunMode('SB')} sx={miniSx}>Stolen base</Button>
                <Button size="small" variant="outlined" onClick={() => setBaserunMode('CS')} sx={miniSx}>Caught stealing</Button>
                <Button size="small" variant="outlined" onClick={() => setSubMode(true)} sx={miniSx}>Pinch hit</Button>
                <Button size="small" variant="outlined" onClick={() => setPitcherMode(true)} sx={miniSx}>Change pitcher</Button>
                <Button size="small" variant="outlined" onClick={() => setEditMode(true)} sx={miniSx}>Edit lineups</Button>
              </Box>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 0.75, alignItems: 'center' }}>
                <Button size="small" onClick={handleUndo} disabled={saving || live.plays.length === 0} sx={miniSx}>↶ Undo</Button>
                <Box sx={{ flex: 1 }} />
                <Button size="small" color="error" onClick={handleFinish} disabled={saving} sx={miniSx}>End game</Button>
              </Box>
            </>
          )}

          {/* Play feed */}
          {live.plays.length > 0 && (
            <Box sx={{ mt: 2 }}>
              <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.8, color: 'text.disabled', mb: 0.5 }}>Play-by-play</Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, maxHeight: 160, overflowY: 'auto' }}>
                {[...live.plays].reverse().map(p => (
                  <Box key={p.id} sx={{ display: 'flex', gap: 1, py: 0.35, borderBottom: '1px solid', borderColor: 'divider' }}>
                    <Typography sx={{ fontSize: '0.62rem', fontWeight: 800, color: 'text.disabled', minWidth: 40, flexShrink: 0 }}>{p.half === 'top' ? 'T' : 'B'}{p.inning}</Typography>
                    <Typography sx={{ fontSize: '0.78rem', flex: 1 }}>{p.description}</Typography>
                  </Box>
                ))}
              </Box>
            </Box>
          )}
        </Box>
      )}
    </ModalShell>
  )
}

// ─── Bits ───────────────────────────────────────────────────────────────────────

const pillBtnSx = { textTransform: 'none', fontSize: '0.7rem', minWidth: 0, px: 1, py: 0.25, borderRadius: 999, border: '1px solid', borderColor: 'divider' } as const
const miniSx = { textTransform: 'none', fontSize: '0.72rem' } as const

function OutcomeRow({ label, codes, onPick, color, filled }: {
  label: string; codes: Outcome[]; onPick: (c: Outcome) => void; color: string; filled?: boolean
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.75 }}>
      <Typography sx={{ width: 52, fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5, color: 'text.disabled', flexShrink: 0 }}>{label}</Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, flex: 1 }}>
        {codes.map(c => (
          <Box key={c} onClick={() => onPick(c)} sx={{
            px: 1.25, py: 0.6, borderRadius: 1.5, cursor: 'pointer', userSelect: 'none',
            fontSize: '0.82rem', fontWeight: 800, minWidth: 40, textAlign: 'center',
            border: '1.5px solid', borderColor: color,
            bgcolor: filled ? color : 'transparent', color: filled ? '#fff' : color,
            transition: 'transform 0.1s, opacity 0.1s', '&:hover': { opacity: 0.85, transform: 'translateY(-1px)' },
          }}>
            {OUTCOMES[c].label}
          </Box>
        ))}
      </Box>
    </Box>
  )
}

// In-place lineup/pitcher corrections while a game is live. Each change persists
// immediately (preserving the slot's or pitcher's accumulated stats).
function EditLineups({ teams, rosters, batting, pitcherIds, disabled, onEditSlot, onEditPitcher, onDone }: {
  teams: [WpblTeam, WpblTeam]
  rosters: { away: WpblPlayer[]; home: WpblPlayer[] }
  batting: WpblBattingLine[]
  pitcherIds: { away: string; home: string }
  disabled: boolean
  onEditSlot: (teamId: string, order: number, playerId: string, position: string | null, lineId: string | null) => void
  onEditPitcher: (side: 'away' | 'home', teamId: string, playerId: string) => void
  onDone: () => void
}) {
  return (
    <Box sx={{ p: 1.5, mb: 1.5, borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
      <Typography sx={{ fontSize: '0.82rem', fontWeight: 800, mb: 0.5 }}>Edit lineups &amp; pitchers</Typography>
      <Typography sx={{ fontSize: '0.7rem', color: 'text.secondary', mb: 1.5 }}>Fix a wrong player, position, or pitcher. Stats already recorded stay with the slot.</Typography>
      {teams.map((team, i) => {
        const side: 'away' | 'home' = i === 0 ? 'away' : 'home'
        const roster = side === 'away' ? rosters.away : rosters.home
        const rows = batting.filter(b => b.team_id === team.id && !b.sub_out).sort((a, b) => (a.batting_order ?? 0) - (b.batting_order ?? 0))
        const slots = Array.from({ length: 9 }, (_, k) => rows.find(r => r.batting_order === k + 1) ?? null)
        const used = new Set(rows.map(r => r.player_id))
        return (
          <Box key={team.id} sx={{ mb: 1.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
              <TeamBadge team={team} size={22} />
              <Typography sx={{ fontSize: '0.85rem', fontWeight: 800, flex: 1 }}>{wpblFullName(team)}</Typography>
            </Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              {slots.map((line, k) => {
                const order = k + 1
                return (
                  <Box key={order} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                    <Typography sx={{ width: 18, textAlign: 'right', fontSize: '0.78rem', fontWeight: 800, color: 'text.disabled' }}>{order}</Typography>
                    <Box component="select" value={line?.player_id ?? ''} disabled={disabled}
                      onChange={(e: React.ChangeEvent<HTMLSelectElement>) => e.target.value && onEditSlot(team.id, order, e.target.value, line?.position ?? roster.find(r => r.id === e.target.value)?.position ?? null, line?.id ?? null)}
                      sx={{ ...fieldSx, flex: 1, minWidth: 0 }}>
                      <option value="">Select batter…</option>
                      {roster.map(p => <option key={p.id} value={p.id} disabled={used.has(p.id) && p.id !== line?.player_id}>{p.name}</option>)}
                    </Box>
                    <Box component="select" value={line?.position ?? ''} disabled={disabled || !line}
                      onChange={(e: React.ChangeEvent<HTMLSelectElement>) => line && onEditSlot(team.id, order, line.player_id, e.target.value || null, line.id)}
                      sx={{ ...fieldSx, width: 66 }}>
                      <option value="">Pos</option>
                      {POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
                    </Box>
                  </Box>
                )
              })}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 0.25 }}>
                <Typography sx={{ width: 18, textAlign: 'right', fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase', color: 'text.disabled' }}>P</Typography>
                <Box component="select" value={pitcherIds[side]} disabled={disabled}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onEditPitcher(side, team.id, e.target.value)}
                  sx={{ ...fieldSx, flex: 1, minWidth: 0 }}>
                  <option value="">Select pitcher…</option>
                  {roster.map(p => <option key={p.id} value={p.id}>{p.name}{p.position ? ` (${p.position})` : ''}</option>)}
                </Box>
              </Box>
            </Box>
          </Box>
        )
      })}
      <Button fullWidth variant="contained" onClick={onDone} sx={{ textTransform: 'none', fontWeight: 800, mt: 0.5 }}>Done</Button>
    </Box>
  )
}

function PickPlayer({ title, players, onPick, onCancel }: {
  title: string; players: WpblPlayer[]; onPick: (id: string) => void; onCancel: () => void
}) {
  const [sel, setSel] = useState('')
  return (
    <Box sx={{ p: 1.5, mb: 1.5, borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
      <Typography sx={{ fontSize: '0.82rem', fontWeight: 800, mb: 1 }}>{title}</Typography>
      <Box component="select" value={sel} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSel(e.target.value)} sx={{ ...fieldSx, width: '100%', mb: 1 }}>
        <option value="">Select player…</option>
        {players.map(p => <option key={p.id} value={p.id}>{p.name}{p.position ? ` (${p.position})` : ''}</option>)}
      </Box>
      <Box sx={{ display: 'flex', gap: 1 }}>
        <Button onClick={onCancel} sx={{ textTransform: 'none', flex: 1 }}>Cancel</Button>
        <Button variant="contained" disabled={!sel} onClick={() => onPick(sel)} sx={{ textTransform: 'none', flex: 2, fontWeight: 800 }}>Confirm</Button>
      </Box>
    </Box>
  )
}
