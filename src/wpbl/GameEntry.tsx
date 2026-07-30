import { useEffect, useMemo, useState } from 'react'
import { Box, Typography, Button, CircularProgress, Alert } from '@mui/material'
import { fetchWpblRoster, fetchWpblGameLines, saveWpblGameResult, clearWpblGameResult } from './api'
import { wpblAccent, wpblFullName, outsToIp, ipToOuts } from './constants'
import { ModalShell, useWpblDark } from './ui'
import type { WpblTeam, WpblGame, WpblPlayer, WpblGameStatus, WpblBattingInput, WpblPitchingInput } from './types'

// Owner-only box-score entry modal (Phase 1a). Enter a game's status, final score, and
// per-player batting/pitching lines for both teams; save writes to Supabase (owner RLS
// gates it). Wide stat tables scroll horizontally so the modal stays mobile-friendly.

type Side = 'away' | 'home'

type BatStat = 'ab' | 'r' | 'h' | 'doubles' | 'triples' | 'hr' | 'rbi' | 'bb' | 'so' | 'sb' | 'hbp' | 'cs'
const BAT_FIELDS: { key: BatStat; label: string }[] = [
  { key: 'ab', label: 'AB' }, { key: 'r', label: 'R' }, { key: 'h', label: 'H' },
  { key: 'doubles', label: '2B' }, { key: 'triples', label: '3B' }, { key: 'hr', label: 'HR' },
  { key: 'rbi', label: 'RBI' }, { key: 'bb', label: 'BB' }, { key: 'so', label: 'SO' },
  { key: 'sb', label: 'SB' }, { key: 'hbp', label: 'HBP' }, { key: 'cs', label: 'CS' },
]
type BatRow = { uid: string; side: Side; player_id: string } & Record<BatStat, number>

type PitStat = 'h' | 'r' | 'er' | 'bb' | 'so' | 'hr'
const PIT_FIELDS: { key: PitStat; label: string }[] = [
  { key: 'h', label: 'H' }, { key: 'r', label: 'R' }, { key: 'er', label: 'ER' },
  { key: 'bb', label: 'BB' }, { key: 'so', label: 'SO' }, { key: 'hr', label: 'HR' },
]
type PitRow = {
  uid: string; side: Side; player_id: string; ip: string; bf: string; pitches: string
  decision: '' | 'W' | 'L' | 'S' | 'H'
} & Record<PitStat, number>

let uidSeq = 0
const nextUid = () => `r${++uidSeq}`

const emptyBat = (side: Side): BatRow => ({
  uid: nextUid(), side, player_id: '',
  ab: 0, r: 0, h: 0, doubles: 0, triples: 0, hr: 0, rbi: 0, bb: 0, so: 0, sb: 0, hbp: 0, cs: 0,
})
const emptyPit = (side: Side): PitRow => ({
  uid: nextUid(), side, player_id: '', ip: '', bf: '', pitches: '', decision: '',
  h: 0, r: 0, er: 0, bb: 0, so: 0, hr: 0,
})

const intOrNull = (s: string): number | null => {
  const t = s.trim()
  if (!t) return null
  const n = parseInt(t, 10)
  return Number.isFinite(n) ? n : null
}

// ─── Small inputs ───────────────────────────────────────────────────────────────

function NumCell({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <Box
      component="input" type="number" inputMode="numeric" min={0} value={value}
      onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(Math.max(0, parseInt(e.target.value, 10) || 0))}
      sx={{
        width: 40, textAlign: 'center', fontSize: '0.8rem', p: '4px 2px', fontFamily: 'inherit',
        borderRadius: 1, border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', color: 'text.primary',
      }}
    />
  )
}

function TextCell({ value, onChange, w = 48, placeholder }: { value: string; onChange: (s: string) => void; w?: number; placeholder?: string }) {
  return (
    <Box
      component="input" value={value} placeholder={placeholder}
      onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
      sx={{
        width: w, textAlign: 'center', fontSize: '0.8rem', p: '4px 2px', fontFamily: 'inherit',
        borderRadius: 1, border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', color: 'text.primary',
      }}
    />
  )
}

function PlayerSelect({ roster, value, used, onChange }: {
  roster: WpblPlayer[]; value: string; used: Set<string>; onChange: (id: string) => void
}) {
  return (
    <Box
      component="select" value={value}
      onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onChange(e.target.value)}
      sx={{
        minWidth: 140, maxWidth: 180, fontSize: '0.8rem', p: '4px 6px', fontFamily: 'inherit',
        borderRadius: 1, border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', color: 'text.primary',
      }}
    >
      <option value="">Select player…</option>
      {roster.map(p => (
        <option key={p.id} value={p.id} disabled={used.has(p.id) && p.id !== value}>
          {p.name}{p.position ? ` (${p.position})` : ''}
        </option>
      ))}
    </Box>
  )
}

// ─── Modal ────────────────────────────────────────────────────────────────────

export default function GameEntryModal({ game, teams, onClose, onSaved }: {
  game: WpblGame
  teams: WpblTeam[]
  onClose: () => void
  onSaved: () => void
}) {
  const isDark = useWpblDark()
  const byId = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])
  const home = byId.get(game.home_team_id)
  const away = byId.get(game.away_team_id)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [status, setStatus] = useState<WpblGameStatus>(game.status)
  const [awayScore, setAwayScore] = useState(game.away_score?.toString() ?? '')
  const [homeScore, setHomeScore] = useState(game.home_score?.toString() ?? '')
  const [innings, setInnings] = useState(game.innings?.toString() ?? '')

  const [rosters, setRosters] = useState<{ away: WpblPlayer[]; home: WpblPlayer[] }>({ away: [], home: [] })
  const [bat, setBat] = useState<BatRow[]>([])
  const [pit, setPit] = useState<PitRow[]>([])

  useEffect(() => {
    let cancelled = false
    Promise.all([
      away ? fetchWpblRoster(away.id) : Promise.resolve([]),
      home ? fetchWpblRoster(home.id) : Promise.resolve([]),
      fetchWpblGameLines(game.id),
    ]).then(([aRoster, hRoster, lines]) => {
      if (cancelled) return
      setRosters({ away: aRoster, home: hRoster })
      const sideOf = (teamId: string | null): Side => (teamId === game.home_team_id ? 'home' : 'away')
      setBat(lines.batting.map(b => ({
        uid: nextUid(), side: sideOf(b.team_id), player_id: b.player_id,
        ab: b.ab, r: b.r, h: b.h, doubles: b.doubles, triples: b.triples, hr: b.hr,
        rbi: b.rbi, bb: b.bb, so: b.so, sb: b.sb, hbp: b.hbp, cs: b.cs,
      })))
      setPit(lines.pitching.map(p => ({
        uid: nextUid(), side: sideOf(p.team_id), player_id: p.player_id,
        ip: outsToIp(p.outs), bf: p.bf?.toString() ?? '', pitches: p.pitches?.toString() ?? '',
        decision: p.decision ?? '', h: p.h, r: p.r, er: p.er, bb: p.bb, so: p.so, hr: p.hr,
      })))
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [game.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const rosterFor = (side: Side) => (side === 'home' ? rosters.home : rosters.away)
  const teamIdFor = (side: Side) => (side === 'home' ? game.home_team_id : game.away_team_id)

  const setBatField = (uid: string, key: BatStat, val: number) =>
    setBat(rows => rows.map(r => (r.uid === uid ? { ...r, [key]: val } : r)))
  const setPitNum = (uid: string, key: PitStat, val: number) =>
    setPit(rows => rows.map(r => (r.uid === uid ? { ...r, [key]: val } : r)))
  const setPitText = (uid: string, key: 'ip' | 'bf' | 'pitches', val: string) =>
    setPit(rows => rows.map(r => (r.uid === uid ? { ...r, [key]: val } : r)))

  async function handleSave() {
    setError(null)
    if (status === 'final' && (intOrNull(awayScore) == null || intOrNull(homeScore) == null)) {
      setError('Enter both final scores.')
      return
    }
    const battingInputs: WpblBattingInput[] = bat.filter(r => r.player_id).map((r, i) => ({
      player_id: r.player_id, team_id: teamIdFor(r.side), batting_order: i + 1,
      position: rosterFor(r.side).find(p => p.id === r.player_id)?.position ?? null,
      ab: r.ab, r: r.r, h: r.h, doubles: r.doubles, triples: r.triples, hr: r.hr,
      rbi: r.rbi, bb: r.bb, so: r.so, hbp: r.hbp, sb: r.sb, cs: r.cs,
    }))
    const pitchingInputs: WpblPitchingInput[] = pit.filter(r => r.player_id).map(r => ({
      player_id: r.player_id, team_id: teamIdFor(r.side), outs: ipToOuts(r.ip),
      bf: intOrNull(r.bf), h: r.h, r: r.r, er: r.er, bb: r.bb, so: r.so, hr: r.hr,
      pitches: intOrNull(r.pitches), decision: r.decision || null,
    }))
    setSaving(true)
    const res = await saveWpblGameResult(
      game.id,
      { status, home_score: intOrNull(homeScore), away_score: intOrNull(awayScore), innings: intOrNull(innings) },
      battingInputs, pitchingInputs,
    )
    setSaving(false)
    if (res.ok) onSaved()
    else setError(res.error ?? 'Save failed.')
  }

  async function handleClear() {
    if (!window.confirm('Clear this result? This deletes all entered lines and resets the game to Scheduled.')) return
    setError(null)
    setClearing(true)
    const res = await clearWpblGameResult(game.id)
    setClearing(false)
    if (res.ok) onSaved()
    else setError(res.error ?? 'Clear failed.')
  }

  const hasData = game.status !== 'scheduled' || bat.length > 0 || pit.length > 0

  const dateLabel = new Date(`${game.game_date}T00:00:00`).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })

  return (
    <ModalShell
      eyebrow={`${dateLabel}${game.start_time ? ` · ${game.start_time}` : ''} · Enter result`}
      onClose={onClose}
      maxWidth={860}
      footer={
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {hasData && !loading && (
            <Button onClick={handleClear} disabled={clearing || saving} color="error" sx={{ textTransform: 'none' }}>
              {clearing ? <CircularProgress size={18} color="inherit" /> : 'Clear result'}
            </Button>
          )}
          <Box sx={{ flex: 1 }} />
          <Button onClick={onClose} sx={{ textTransform: 'none' }}>Cancel</Button>
          <Button variant="contained" onClick={handleSave} disabled={saving || clearing || loading} sx={{ textTransform: 'none', minWidth: 96 }}>
            {saving ? <CircularProgress size={18} color="inherit" /> : 'Save result'}
          </Button>
        </Box>
      }
    >
      {/* Matchup title */}
      <Box sx={{ px: 2, pt: 2, pb: 0.5 }}>
        <Typography sx={{ fontSize: '1rem', fontWeight: 800, lineHeight: 1.2 }}>
          {away ? wpblFullName(away) : game.away_team_id} @ {home ? wpblFullName(home) : game.home_team_id}
        </Typography>
      </Box>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>
      ) : (
        <Box sx={{ p: 2, pt: 1 }}>
            {/* Result summary */}
            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 2, mb: 3 }}>
              <Box>
                <Typography sx={labelSx}>Status</Typography>
                <Box component="select" value={status} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setStatus(e.target.value as WpblGameStatus)} sx={selectSx}>
                  <option value="scheduled">Scheduled</option>
                  <option value="live">Live</option>
                  <option value="final">Final</option>
                </Box>
              </Box>
              <Box>
                <Typography sx={labelSx}>{away?.abbr ?? 'Away'} runs</Typography>
                <TextCell value={awayScore} onChange={setAwayScore} w={64} placeholder="—" />
              </Box>
              <Box>
                <Typography sx={labelSx}>{home?.abbr ?? 'Home'} runs</Typography>
                <TextCell value={homeScore} onChange={setHomeScore} w={64} placeholder="—" />
              </Box>
              <Box>
                <Typography sx={labelSx}>Innings</Typography>
                <TextCell value={innings} onChange={setInnings} w={64} placeholder="7" />
              </Box>
            </Box>

            {(['away', 'home'] as Side[]).map(side => {
              const team = side === 'home' ? home : away
              const color = team ? wpblAccent(team.id, isDark) : '#888'
              const batRows = bat.filter(r => r.side === side)
              const pitRows = pit.filter(r => r.side === side)
              const usedBat = new Set(batRows.map(r => r.player_id).filter(Boolean))
              const usedPit = new Set(pitRows.map(r => r.player_id).filter(Boolean))
              return (
                <Box key={side} sx={{ mb: 3 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                    <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: color }} />
                    <Typography sx={{ fontSize: '0.95rem', fontWeight: 800 }}>{team ? wpblFullName(team) : side}</Typography>
                    <Typography sx={{ fontSize: '0.72rem', color: 'text.disabled', fontWeight: 700, textTransform: 'uppercase' }}>{side === 'home' ? 'Home' : 'Away'}</Typography>
                  </Box>

                  {/* Batting */}
                  <Typography sx={sectionSx}>Batting</Typography>
                  <Box sx={{ overflowX: 'auto', mb: 1 }}>
                    <Box sx={{ minWidth: 'max-content' }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                        <Box sx={{ minWidth: 140, maxWidth: 180, ...headSx }}>Player</Box>
                        {BAT_FIELDS.map(f => <Box key={f.key} sx={{ width: 40, textAlign: 'center', ...headSx }}>{f.label}</Box>)}
                        <Box sx={{ width: 28 }} />
                      </Box>
                      {batRows.map(r => (
                        <Box key={r.uid} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                          <PlayerSelect roster={rosterFor(side)} value={r.player_id} used={usedBat} onChange={id => setBat(rows => rows.map(x => x.uid === r.uid ? { ...x, player_id: id } : x))} />
                          {BAT_FIELDS.map(f => <NumCell key={f.key} value={r[f.key]} onChange={v => setBatField(r.uid, f.key, v)} />)}
                          <Box onClick={() => setBat(rows => rows.filter(x => x.uid !== r.uid))} sx={removeSx}>×</Box>
                        </Box>
                      ))}
                    </Box>
                  </Box>
                  <Button size="small" onClick={() => setBat(rows => [...rows, emptyBat(side)])} sx={{ textTransform: 'none', fontSize: '0.78rem', mb: 1 }}>+ Add batter</Button>

                  {/* Pitching */}
                  <Typography sx={sectionSx}>Pitching</Typography>
                  <Box sx={{ overflowX: 'auto', mb: 1 }}>
                    <Box sx={{ minWidth: 'max-content' }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                        <Box sx={{ minWidth: 140, maxWidth: 180, ...headSx }}>Pitcher</Box>
                        <Box sx={{ width: 48, textAlign: 'center', ...headSx }}>IP</Box>
                        {PIT_FIELDS.map(f => <Box key={f.key} sx={{ width: 40, textAlign: 'center', ...headSx }}>{f.label}</Box>)}
                        <Box sx={{ width: 48, textAlign: 'center', ...headSx }}>BF</Box>
                        <Box sx={{ width: 48, textAlign: 'center', ...headSx }}>P</Box>
                        <Box sx={{ width: 56, textAlign: 'center', ...headSx }}>Dec</Box>
                        <Box sx={{ width: 28 }} />
                      </Box>
                      {pitRows.map(r => (
                        <Box key={r.uid} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                          <PlayerSelect roster={rosterFor(side)} value={r.player_id} used={usedPit} onChange={id => setPit(rows => rows.map(x => x.uid === r.uid ? { ...x, player_id: id } : x))} />
                          <TextCell value={r.ip} onChange={v => setPitText(r.uid, 'ip', v)} placeholder="0.0" />
                          {PIT_FIELDS.map(f => <NumCell key={f.key} value={r[f.key]} onChange={v => setPitNum(r.uid, f.key, v)} />)}
                          <TextCell value={r.bf} onChange={v => setPitText(r.uid, 'bf', v)} placeholder="—" />
                          <TextCell value={r.pitches} onChange={v => setPitText(r.uid, 'pitches', v)} placeholder="—" />
                          <Box component="select" value={r.decision} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setPit(rows => rows.map(x => x.uid === r.uid ? { ...x, decision: e.target.value as PitRow['decision'] } : x))} sx={{ width: 56, fontSize: '0.8rem', p: '4px 2px', fontFamily: 'inherit', borderRadius: 1, border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', color: 'text.primary' }}>
                            <option value="">—</option>
                            <option value="W">W</option>
                            <option value="L">L</option>
                            <option value="S">S</option>
                            <option value="H">H</option>
                          </Box>
                          <Box onClick={() => setPit(rows => rows.filter(x => x.uid !== r.uid))} sx={removeSx}>×</Box>
                        </Box>
                      ))}
                    </Box>
                  </Box>
                  <Button size="small" onClick={() => setPit(rows => [...rows, emptyPit(side)])} sx={{ textTransform: 'none', fontSize: '0.78rem' }}>+ Add pitcher</Button>
                </Box>
              )
            })}

            {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          </Box>
        )}
    </ModalShell>
  )
}

const labelSx = { fontSize: '0.66rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5, color: 'text.disabled', mb: 0.5 } as const
const headSx = { fontSize: '0.64rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.3, color: 'text.disabled' } as const
const sectionSx = { fontSize: '0.75rem', fontWeight: 800, color: 'text.secondary', mb: 0.75 } as const
const selectSx = { fontSize: '0.85rem', p: '5px 8px', fontFamily: 'inherit', borderRadius: 1, border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', color: 'text.primary' } as const
const removeSx = { width: 28, textAlign: 'center', cursor: 'pointer', color: 'text.disabled', fontSize: '1.1rem', lineHeight: 1, flexShrink: 0, '&:hover': { color: 'error.main' } } as const
