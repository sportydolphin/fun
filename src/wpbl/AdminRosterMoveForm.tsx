import { useState } from 'react'
import { Box, Typography, TextField, Button, MenuItem } from '@mui/material'
import { CARD_BORDER, TYPE_SCALE } from './ui'
import { saveWpblRosterMove, deleteWpblRosterMove } from './api'
import { ROSTER_SEASON, openPicks, heldPlayers, moveKey, moveLabel } from './offseason2027'
import { moveChoices, type Kind } from './rosterMoveChoices'
import type { WpblPlayer, WpblRosterMove } from './types'

// /admin → Rosters: a pick, a signing or a release for the club in the chips. Re-signings and trades
// have their own forms. THE LISTS OFFER ONLY WHAT THE ROSTERS WOULD ACCEPT: rosterBoards ignores a move
// the rules make impossible, so a row saved outside them would be on no page and say nothing about it.

const KINDS: readonly [Kind, string][] = [['drafted', 'Drafted'], ['signed', 'Signed'], ['released', 'Released']]
const UNLISTED = '__unlisted'

export default function AdminRosterMoveForm({ club, clubName, moves, players, source, day }: {
  club: string; clubName: string; moves: readonly WpblRosterMove[]; players: readonly WpblPlayer[]
  /** The link and date above the forms; empty until both are valid. */
  source: string; day: string
}) {
  const [kind, setKind] = useState<Kind>('drafted')
  const [who, setWho] = useState('')
  const [typed, setTyped] = useState('')
  const [slot, setSlot] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const choices = moveChoices(kind, club, moves, players)
  const picks = openPicks(moves, club)
  const pick = picks.find(p => `${p.round}:${p.pick}` === slot)
  // A typed name that is already someone in the list is that player, or they would be two people.
  const typedKey = moveKey({ player_id: null, player_name: typed })
  const chosen = who === UNLISTED
    ? choices.find(c => moveKey({ player_id: null, player_name: c.name }) === typedKey)
    : choices.find(c => c.key === who)
  const taken = who === UNLISTED && !!typedKey && !chosen && (
    heldPlayers(moves).has(typedKey) || players.some(p => moveKey({ player_id: null, player_name: p.name }) === typedKey))
  const named = who === UNLISTED && !!typedKey && !taken
  const ready = !!source && !!day && (!!chosen || named) && (kind !== 'drafted' || !!pick) && !busy

  const save = async () => {
    setBusy(true); setError(null)
    const ok = await saveWpblRosterMove({
      season: ROSTER_SEASON, kind, team_id: club, from_team_id: null, trade_id: null,
      player_id: chosen?.playerId ?? null,
      player_name: chosen?.playerId ? null : chosen?.name ?? typed.trim(),
      draft_round: kind === 'drafted' ? pick!.round : null, draft_pick: kind === 'drafted' ? pick!.pick : null,
      announced_on: day, source_url: source,
    })
    setBusy(false)
    if (ok) { setWho(''); setTyped(''); setSlot('') } else setError('Not saved. The console has the reason.')
  }
  const remove = async (id: number) => {
    setBusy(true); setError(null)
    const ok = await deleteWpblRosterMove(id)
    setBusy(false)
    if (!ok) setError('Not removed. The console has the reason.')
  }

  const nameOf = new Map(players.map(p => [p.id, p.name]))
  const recorded = moves.filter(m => m.season === ROSTER_SEASON && m.team_id === club
    && KINDS.some(([k]) => k === m.kind))

  return (
    <Box sx={{ border: '1px solid', borderColor: CARD_BORDER, borderRadius: 2, p: 1.5, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Typography sx={{ fontSize: TYPE_SCALE.title, fontWeight: 700 }}>{clubName} draft and signings</Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
        <TextField select size="small" label="Move" value={kind} sx={{ minWidth: 140 }}
          onChange={e => { setKind(e.target.value as Kind); setWho(''); setTyped(''); setSlot('') }}>
          {KINDS.map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
        </TextField>
        {kind === 'drafted' && (
          <TextField select size="small" label="Pick" value={pick ? slot : ''} onChange={e => setSlot(e.target.value)} sx={{ minWidth: 190 }}>
            {picks.map(p => (
              <MenuItem key={`${p.round}:${p.pick}`} value={`${p.round}:${p.pick}`}>
                Round {p.round}, pick {p.pick}{p.original === club ? '' : ` (from ${p.original})`}
              </MenuItem>
            ))}
          </TextField>
        )}
        <TextField select size="small" label="Player" sx={{ flex: '1 1 200px' }}
          value={who === UNLISTED || chosen ? who : ''} onChange={e => setWho(e.target.value)}>
          {kind !== 'released' && <MenuItem value={UNLISTED}>Player not listed</MenuItem>}
          {choices.map(c => <MenuItem key={c.key} value={c.key}>{c.label}</MenuItem>)}
        </TextField>
        {who === UNLISTED && (
          <TextField size="small" label="Name" value={typed} onChange={e => setTyped(e.target.value)}
            error={taken} helperText={taken ? 'Already on a roster' : undefined} sx={{ width: 200 }} />
        )}
        <Button variant="outlined" disabled={!ready} onClick={save}>Save move</Button>
      </Box>
      {error && <Typography sx={{ color: 'error.main', fontSize: TYPE_SCALE.body }}>{error}</Typography>}
      {recorded.map(m => (
        <Box key={m.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, borderTop: '1px solid', borderColor: 'divider', pt: 0.75 }}>
          <Typography sx={{ flex: 1, minWidth: 0, fontSize: TYPE_SCALE.body }}>
            {nameOf.get(m.player_id ?? '') ?? m.player_name}: {moveLabel(m)}
          </Typography>
          <Box component="a" href={m.source_url} target="_blank" rel="noopener noreferrer"
            sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary' }}>{m.announced_on}</Box>
          <Button size="small" disabled={busy} onClick={() => remove(m.id)}>Remove</Button>
        </Box>
      ))}
    </Box>
  )
}
