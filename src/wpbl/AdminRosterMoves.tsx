import { useEffect, useMemo, useState } from 'react'
import { Box, Typography, TextField, Button, MenuItem } from '@mui/material'
import { ChipRow, FilterChip } from '../ui/FilterChip'
import { CARD_BORDER, TYPE_SCALE } from './ui'
import { fetchWpblTeams, fetchWpblAllPlayers, saveWpblRosterMove, deleteWpblRosterMove } from './api'
import { useWpblRosterMoves } from './useRosterMoves'
import { DRAFT_ORDER_2027, ROSTERS_2026, ROSTER_SEASON, MAX_RESIGNED, rosterBoards, rosterStatus, isPickRow } from './offseason2027'
import { wpblFullName } from './constants'
import type { WpblPlayer, WpblRosterMove, WpblTeam } from './types'

// /admin → Rosters: record each 2027 re-signing as the league or a club announces it. The news watch
// pages the owner when something moves; this is where it becomes a row on /wpbl/rosters.
//
// THE LINK AND DATE ARE SET ONCE, ABOVE THE LIST, because the league tends to announce a club's
// re-signings together: paste the post, then mark each name in it. A move cannot be saved without
// an https link (the table refuses one too), since every row on the public page cites its source.

/** The trade form's two non-player choices in its "Gives" list. */
const PICK = '__pick'
const UNLISTED = '__unlisted'

/** A trade row as the form lists it: the player, or "Round 6 pick". */
function legName(m: WpblRosterMove, playerById: Map<string, WpblPlayer>): string {
  if (isPickRow(m)) return `Round ${m.draft_round} pick`
  return playerById.get(m.player_id ?? '')?.name ?? m.player_name ?? '?'
}

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
  // The club's own re-signing rows, not the board's list: a player re-signed and then traded away
  // still has the row here to remove, and a player traded in is not on this list at all.
  const resignedIds = new Map((moves ?? []).filter(m => m.season === ROSTER_SEASON && m.kind === 're-signed' && m.team_id === club && m.player_id)
    .map(m => [m.player_id!, m]))
  const sourceOk = /^https:\/\/\S+$/.test(source.trim())
  const full = (board?.resigned.length ?? 0) >= MAX_RESIGNED

  const resign = async (playerId: string) => {
    setBusy(playerId); setError(null)
    const ok = await saveWpblRosterMove({
      season: ROSTER_SEASON, kind: 're-signed', player_id: playerId, player_name: null, team_id: club, from_team_id: null, trade_id: null,
      draft_round: null, draft_pick: null, announced_on: day, source_url: source.trim(),
    })
    setBusy(null)
    if (!ok) setError('Not saved. The console has the reason.')
  }
  // A TRADE IS RECORDED ONE THING AT A TIME, FROM THE CLUB THAT GIVES IT UP: the chips above pick
  // that club, and each save is one player (from the club's list, or a name typed for someone not
  // in wpbl_players yet) or one of its picks, to the club in "To". The trade's other legs are more
  // saves with "Part of" set to the first, which may mean switching the chips to the other club:
  // Zettlemoyer for a 6th is New York's player to Boston, then Boston's 6th-round pick to New York.
  const [tradePlayer, setTradePlayer] = useState('')
  const [tradeTo, setTradeTo] = useState('')
  const [tradeRound, setTradeRound] = useState('')
  const [tradeName, setTradeName] = useState('')
  const [tradeGroup, setTradeGroup] = useState('')
  const holdable = useMemo(() => {
    const all = Object.values(ROSTERS_2026).flat()
    return all.filter(id => {
      // Unsigned players report their 2026 club, so this is everyone the club holds now.
      return rosterStatus(id, moves ?? [], Date.now())?.teamId === club
    })
  }, [moves, club])
  const trades = (moves ?? []).filter(m => m.season === ROSTER_SEASON && m.kind === 'traded'
    && (m.team_id === club || m.from_team_id === club))
  const tradeGroups = useMemo(() => {
    const byGroup = new Map<string, string[]>()
    for (const m of moves ?? []) {
      if (m.season !== ROSTER_SEASON || m.kind !== 'traded' || !m.trade_id) continue
      const name = legName(m, playerById)
      byGroup.set(m.trade_id, [...(byGroup.get(m.trade_id) ?? []), `${name} (${m.from_team_id} to ${m.team_id})`])
    }
    return [...byGroup]
  }, [moves, playerById])
  const legKind = tradePlayer === PICK ? 'pick' : tradePlayer === UNLISTED ? 'name' : tradePlayer ? 'player' : null
  const roundOk = /^([1-9]|10)$/.test(tradeRound)
  const legOk = legKind === 'player' || (legKind === 'name' && tradeName.trim() !== '') || (legKind === 'pick' && roundOk)
  const trade = async () => {
    setBusy('trade'); setError(null)
    const ok = await saveWpblRosterMove({
      season: ROSTER_SEASON, kind: 'traded',
      player_id: legKind === 'player' ? tradePlayer : null, player_name: legKind === 'name' ? tradeName.trim() : null,
      team_id: tradeTo, from_team_id: club, trade_id: tradeGroup || crypto.randomUUID(),
      draft_round: legKind === 'pick' ? Number(tradeRound) : null, draft_pick: null,
      announced_on: day, source_url: source.trim(),
    })
    setBusy(null)
    if (ok) { setTradePlayer(''); setTradeTo(''); setTradeRound(''); setTradeName(''); setTradeGroup('') } else setError('Not saved. The console has the reason.')
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

      <Box sx={{ border: '1px solid', borderColor: CARD_BORDER, borderRadius: 2, p: 1.5, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Typography sx={{ fontSize: TYPE_SCALE.title, fontWeight: 700 }}>
          Trade from {teamById.get(club) ? wpblFullName(teamById.get(club)!) : club}
        </Typography>
        <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 1.5 }}>
          <TextField select size="small" label="Gives" value={tradePlayer} onChange={e => setTradePlayer(e.target.value)} sx={{ flex: 1 }}>
            {holdable.map(id => <MenuItem key={id} value={id}>{playerById.get(id)?.name ?? id}</MenuItem>)}
            <MenuItem value={UNLISTED}>Player not listed</MenuItem>
            <MenuItem value={PICK}>Draft pick</MenuItem>
          </TextField>
          {legKind === 'name' && (
            <TextField size="small" label="Name" value={tradeName} onChange={e => setTradeName(e.target.value)} sx={{ width: 180 }} />
          )}
          {legKind === 'pick' && (
            <TextField size="small" label="Round" value={tradeRound} onChange={e => setTradeRound(e.target.value.trim())}
              error={tradeRound !== '' && !roundOk} sx={{ width: 90 }} />
          )}
          <TextField select size="small" label="To" value={tradeTo} onChange={e => setTradeTo(e.target.value)} sx={{ minWidth: 160 }}>
            {DRAFT_ORDER_2027.filter(id => id !== club).map(id => <MenuItem key={id} value={id}>{teamById.get(id)?.name ?? id}</MenuItem>)}
          </TextField>
          <TextField select size="small" label="Part of" value={tradeGroup} onChange={e => setTradeGroup(e.target.value)} sx={{ minWidth: 160 }}>
            <MenuItem value="">New trade</MenuItem>
            {tradeGroups.map(([id, legs]) => <MenuItem key={id} value={id}>{legs.join(', ')}</MenuItem>)}
          </TextField>
          <Button variant="outlined" disabled={!sourceOk || !day || !legOk || !tradeTo || busy === 'trade'}
            onClick={trade}>Save trade</Button>
        </Box>
        {trades.map(t => (
          <Box key={t.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, borderTop: '1px solid', borderColor: 'divider', pt: 0.75 }}>
            <Typography sx={{ flex: 1, minWidth: 0, fontSize: TYPE_SCALE.body }}>
              {legName(t, playerById)}: {t.from_team_id} to {t.team_id}
            </Typography>
            <Box component="a" href={t.source_url} target="_blank" rel="noopener noreferrer"
              sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary' }}>{t.announced_on}</Box>
            <Button size="small" disabled={busy === `t${t.id}`} onClick={() => undo(t.id, `t${t.id}`)}>Remove</Button>
          </Box>
        ))}
      </Box>
    </Box>
  )
}
