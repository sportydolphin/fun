import { useEffect, useMemo, useState } from 'react'
import { Box, Typography, TextField, Button, MenuItem } from '@mui/material'
import { ChipRow, FilterChip } from '../ui/FilterChip'
import { CARD_BORDER, TYPE_SCALE } from './ui'
import { fetchWpblTeams, fetchWpblAllPlayers, saveWpblRosterMove, saveWpblTrade, deleteWpblRosterMove, type NewRosterMove } from './api'
import { useWpblRosterMoves } from './useRosterMoves'
import { DRAFT_ORDER_2027, ROSTERS_2026, ROSTER_SEASON, MAX_RESIGNED, rosterBoards, isPickRow, openPicks } from './offseason2027'
import AdminRosterMoveForm from './AdminRosterMoveForm'
import { wpblFullName } from './constants'
import type { WpblPlayer, WpblTeam } from './types'

// /admin → Rosters: record each 2027 move as the league or a club announces it. The news watch
// pages the owner when something moves; this is where it becomes a row on /wpbl/rosters.
//
// THE LINK AND DATE ARE SET ONCE, ABOVE THE LIST, because the league tends to announce a club's
// re-signings together: paste the post, then mark each name in it. A move cannot be saved without
// an https link (the table refuses one too), since every row on the public page cites its source.

/** The trade form's two non-player choices in its "Gives" list. */
const PICK = '__pick'
const UNLISTED = '__unlisted'

/** A trade row as the form lists it: the player, or "Round 6 pick (BOS)", the pick's own club. */
function legName(m: NewRosterMove, playerById: Map<string, WpblPlayer>): string {
  if (isPickRow(m)) return `Round ${m.draft_round} pick${m.pick_team_id ? ` (${m.pick_team_id})` : ''}`
  return playerById.get(m.player_id ?? '')?.name ?? m.player_name ?? '?'
}

/** Whether a leg already on the trade being built is the "Gives" choice `key`. */
function onTrade(m: NewRosterMove, key: string): boolean {
  return m.player_id === key || (isPickRow(m) && `${PICK}:${m.draft_round}:${m.pick_team_id}` === key)
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
  const full = (board?.kept.length ?? 0) >= MAX_RESIGNED

  const resign = async (playerId: string) => {
    setBusy(playerId); setError(null)
    const ok = await saveWpblRosterMove({
      season: ROSTER_SEASON, kind: 're-signed', player_id: playerId, player_name: null, team_id: club, from_team_id: null, trade_id: null, pick_team_id: null,
      draft_round: null, draft_pick: null, announced_on: day, source_url: source.trim(),
    })
    setBusy(null)
    if (!ok) setError('Not saved. The console has the reason.')
  }
  // A TRADE IS BUILT HERE AND SAVED WHOLE. Each leg is one thing moving from the club the chips
  // pick to the club in "To": a player (from the club's list, or a name typed for someone not in
  // wpbl_players yet) or one of the picks it holds. "Add" puts the leg on the trade below; switch
  // the chips for the other club's legs (Zettlemoyer for a 6th is New York's player to Boston, then
  // Boston's 6th-round pick to New York), and "Save trade" writes every leg in one insert. Saving a
  // leg at a time let the hourly push go out with half a trade, and a leg saved without picking its
  // trade again became a trade of its own. "Part of" adds legs to a trade already saved, a
  // correction, which the push leaves alone.
  const [tradePlayer, setTradePlayer] = useState('')
  const [tradeTo, setTradeTo] = useState('')
  const [tradeName, setTradeName] = useState('')
  const [tradeGroup, setTradeGroup] = useState('')
  const [legs, setLegs] = useState<NewRosterMove[]>([])
  // Everyone the club can trade: who it holds, picks and typed names included, and the 2026 players
  // no move has placed, who are still its to trade. Less whatever is already on the trade below.
  const holdable = useMemo(() => {
    if (!board) return []
    return [
      ...[...board.kept, ...board.drafted, ...board.signed],
      ...board.unsigned.map(id => ({ key: id, playerId: id, name: null })),
    ].filter(p => !legs.some(m => m.from_team_id === club && onTrade(m, p.key)))
  }, [board, legs, club])
  // The picks the club holds, its own and any it traded for, named by round and original club.
  const picks = useMemo(() => openPicks(moves ?? [], club)
    .map(p => ({ ...p, key: `${PICK}:${p.round}:${p.original}` }))
    .filter(p => !legs.some(m => m.from_team_id === club && onTrade(m, p.key))), [moves, club, legs])
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
  const given = holdable.find(p => p.key === tradePlayer)
  const pick = picks.find(p => p.key === tradePlayer)
  const legKind = pick ? 'pick' : tradePlayer === UNLISTED ? 'name' : given ? 'player' : null
  const legOk = legKind === 'player' || legKind === 'pick' || (legKind === 'name' && tradeName.trim() !== '')
  const addLeg = () => {
    setLegs(l => [...l, {
      season: ROSTER_SEASON, kind: 'traded',
      player_id: legKind === 'player' ? given?.playerId ?? null : null,
      player_name: legKind === 'name' ? tradeName.trim() : legKind === 'player' ? given?.name ?? null : null,
      team_id: tradeTo, from_team_id: club, trade_id: null, pick_team_id: pick?.original ?? null,
      draft_round: pick?.round ?? null, draft_pick: null, announced_on: day, source_url: '',
    }])
    setTradePlayer(''); setTradeTo(''); setTradeName('')
  }
  const trade = async () => {
    setBusy('trade'); setError(null)
    // The link and date are read at save, so a leg added before the link was pasted still cites it.
    const id = tradeGroup || crypto.randomUUID()
    const ok = await saveWpblTrade(legs.map(m => ({ ...m, trade_id: id, announced_on: day, source_url: source.trim() })))
    setBusy(null)
    if (ok) { setLegs([]); setTradeGroup('') } else setError('Not saved. The console has the reason.')
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
          const n = rosterBoards(moves ?? []).find(b => b.teamId === id)?.kept.length ?? 0
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

      <AdminRosterMoveForm key={club} club={club} moves={moves ?? []} players={players}
        clubName={teamById.get(club) ? wpblFullName(teamById.get(club)!) : club}
        source={sourceOk ? source.trim() : ''} day={day} />

      <Box sx={{ border: '1px solid', borderColor: CARD_BORDER, borderRadius: 2, p: 1.5, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Typography sx={{ fontSize: TYPE_SCALE.title, fontWeight: 700 }}>
          Trade from {teamById.get(club) ? wpblFullName(teamById.get(club)!) : club}
        </Typography>
        <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 1.5 }}>
          <TextField select size="small" label="Gives" value={legKind ? tradePlayer : ''} onChange={e => setTradePlayer(e.target.value)} sx={{ flex: 1 }}>
            {holdable.map(p => <MenuItem key={p.key} value={p.key}>{playerById.get(p.key)?.name ?? p.name ?? p.key}</MenuItem>)}
            <MenuItem value={UNLISTED}>Player not listed</MenuItem>
            {picks.map(p => (
              <MenuItem key={p.key} value={p.key}>Round {p.round} pick{p.original !== club ? ` (${p.original})` : ''}</MenuItem>
            ))}
          </TextField>
          {legKind === 'name' && (
            <TextField size="small" label="Name" value={tradeName} onChange={e => setTradeName(e.target.value)} sx={{ width: 180 }} />
          )}
          <TextField select size="small" label="To" value={tradeTo} onChange={e => setTradeTo(e.target.value)} sx={{ minWidth: 160 }}>
            {DRAFT_ORDER_2027.filter(id => id !== club).map(id => <MenuItem key={id} value={id}>{teamById.get(id)?.name ?? id}</MenuItem>)}
          </TextField>
          <Button variant="outlined" disabled={!legOk || !tradeTo} onClick={addLeg}>Add</Button>
        </Box>
        {legs.map((m, i) => (
          <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1, borderTop: '1px solid', borderColor: 'divider', pt: 0.75 }}>
            <Typography sx={{ flex: 1, minWidth: 0, fontSize: TYPE_SCALE.body, fontWeight: 700 }}>
              {legName(m, playerById)}: {m.from_team_id} to {m.team_id}
            </Typography>
            <Button size="small" onClick={() => setLegs(l => l.filter((_, j) => j !== i))}>Remove</Button>
          </Box>
        ))}
        <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 1.5 }}>
          <TextField select size="small" label="Part of" value={tradeGroup} onChange={e => setTradeGroup(e.target.value)} sx={{ minWidth: 160, flex: 1 }}>
            <MenuItem value="">New trade</MenuItem>
            {tradeGroups.map(([id, names]) => <MenuItem key={id} value={id}>{names.join(', ')}</MenuItem>)}
          </TextField>
          <Button variant="outlined" disabled={!sourceOk || !day || !legs.length || busy === 'trade'}
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
