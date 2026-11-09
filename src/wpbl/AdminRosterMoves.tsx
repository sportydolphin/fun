import { useEffect, useMemo, useState } from 'react'
import { Box, Typography, TextField, Button } from '@mui/material'
import { ChipRow, FilterChip } from '../ui/FilterChip'
import { CARD_BORDER, TYPE_SCALE } from './ui'
import { fetchWpblTeams, fetchWpblAllPlayers, saveWpblRosterMove, deleteWpblRosterMove } from './api'
import { useWpblRosterMoves } from './useRosterMoves'
import { DRAFT_ORDER_2027, ROSTERS_2026, ROSTER_SEASON, MAX_RESIGNED, rosterBoards } from './offseason2027'
import { wpblFullName } from './constants'
import type { WpblPlayer, WpblTeam } from './types'

// /admin → Rosters: record each 2027 re-signing as the league or a club announces it. The news watch
// pages the owner when something moves; this is where it becomes a row on /wpbl/rosters.
//
// THE LINK AND DATE ARE SET ONCE, ABOVE THE LIST, because the league tends to announce a club's
// re-signings together: paste the post, then mark each name in it. A move cannot be saved without
// an https link (the table refuses one too), since every row on the public page cites its source.

function todayEt(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
}

export default function AdminRosterMoves() {
  const [teams, setTeams] = useState<WpblTeam[]>([])
  const [players, setPlayers] = useState<WpblPlayer[]>([])
  const [club, setClub] = useState<string>(DRAFT_ORDER_2027[0])
  const [source, setSource] = useState('')
  const [day, setDay] = useState(todayEt())
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const moves = useWpblRosterMoves()

  useEffect(() => {
    Promise.all([fetchWpblTeams(), fetchWpblAllPlayers()]).then(([t, p]) => { setTeams(t); setPlayers(p) })
  }, [])

  const teamById = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])
  const playerById = useMemo(() => new Map(players.map(p => [p.id, p])), [players])
  const board = useMemo(() => rosterBoards(moves ?? []).find(b => b.teamId === club), [moves, club])
  const resignedIds = new Map(board?.resigned.map(r => [r.playerId, r.move]) ?? [])
  const sourceOk = /^https:\/\/\S+$/.test(source.trim())
  const full = (board?.resigned.length ?? 0) >= MAX_RESIGNED

  const resign = async (playerId: string) => {
    setBusy(playerId); setError(null)
    const ok = await saveWpblRosterMove({
      season: ROSTER_SEASON, kind: 're-signed', player_id: playerId, player_name: null, team_id: club,
      draft_round: null, draft_pick: null, announced_on: day, source_url: source.trim(),
    })
    setBusy(null)
    if (!ok) setError('Not saved. The console has the reason.')
  }
  const undo = async (id: number, playerId: string) => {
    setBusy(playerId); setError(null)
    const ok = await deleteWpblRosterMove(id)
    setBusy(null)
    if (!ok) setError('Not removed. The console has the reason.')
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <ChipRow mb={0}>
        {DRAFT_ORDER_2027.map(id => {
          const n = rosterBoards(moves ?? []).find(b => b.teamId === id)?.resigned.length ?? 0
          return (
            <FilterChip key={id} active={club === id} onClick={() => setClub(id)}>
              {teamById.get(id)?.name ?? id} {n}/{MAX_RESIGNED}
            </FilterChip>
          )
        })}
      </ChipRow>

      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 1.5 }}>
        <TextField size="small" label="Source link" value={source} onChange={e => setSource(e.target.value)}
          placeholder="https://" sx={{ flex: 1 }} error={source !== '' && !sourceOk} />
        <TextField size="small" label="Announced" type="date" value={day} onChange={e => setDay(e.target.value)}
          slotProps={{ inputLabel: { shrink: true } }} />
      </Box>
      {error && <Typography sx={{ color: 'error.main', fontSize: TYPE_SCALE.body }}>{error}</Typography>}

      <Box sx={{ border: '1px solid', borderColor: CARD_BORDER, borderRadius: 2, p: 1 }}>
        <Typography sx={{ fontSize: TYPE_SCALE.title, fontWeight: 700, px: 0.75, pb: 1 }}>
          {teamById.get(club) ? wpblFullName(teamById.get(club)!) : club} 2026 roster
        </Typography>
        {(ROSTERS_2026[club] ?? []).map(id => {
          const p = playerById.get(id)
          const move = resignedIds.get(id)
          return (
            <Box key={id} sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 0.75, py: 0.5, borderTop: '1px solid', borderColor: 'divider' }}>
              <Typography sx={{ flex: 1, minWidth: 0, fontSize: TYPE_SCALE.body, fontWeight: move ? 700 : 500 }}>
                {p?.name ?? id}
              </Typography>
              {move ? (
                <>
                  <Box component="a" href={move.source_url} target="_blank" rel="noopener noreferrer"
                    sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary' }}>{move.announced_on}</Box>
                  <Button size="small" disabled={busy === id} onClick={() => undo(move.id, id)}>Remove</Button>
                </>
              ) : (
                <Button size="small" variant="outlined" disabled={!sourceOk || !day || full || busy === id}
                  onClick={() => resign(id)}>Re-signed</Button>
              )}
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}
