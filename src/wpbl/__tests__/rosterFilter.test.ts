import { describe, it, expect } from 'vitest'
import {
  ROSTERS_2026, RESIGN_WINDOW, matchesRosterFilter, parseRosterFilter, rosterFilterChoices, rosterFilterOffered,
  rosterFilterParam, rosterStatus, rosterStatuses, type RosterFilter,
} from '../offseason2027'
import { parseRosterAsk, resolveRosterAsk } from '../searchRoster'
import type { WpblRosterMove } from '../types'

const KELSIE = '4e6a118d-d3ab-485c-bedf-20c6446d7aa6'   // SF
const ZETT = 'ff1f001e-32ac-442d-b3aa-6bde77fec86c'     // NY, traded to BOS Nov 21, 2026
const LAHNERS = '183f0df8-1a02-46a4-84c5-90f54638cab8'  // NY
const SATO = '4d34311c-b7d6-44da-9614-b5ad954ddc59'     // LA
// After the window and its announcements: every unplaced 2026 player is draft eligible.
const AFTER = Date.parse('2026-12-05T18:00:00Z')

let nextId = 1
function move(over: Partial<WpblRosterMove>): WpblRosterMove {
  return {
    id: nextId++, season: 2027, kind: 're-signed', player_id: KELSIE, player_name: null, team_id: 'SF', from_team_id: null, trade_id: null, pick_team_id: null,
    draft_round: null, draft_pick: null, announced_on: '2026-11-12', source_url: 'https://example.com/a', ...over,
  }
}

const MOVES = [
  move({}),
  move({ player_id: ZETT, team_id: 'NY' }),
  move({ kind: 'traded', player_id: ZETT, team_id: 'BOS', from_team_id: 'NY', trade_id: 't1', announced_on: '2026-11-21' }),
  move({ player_id: LAHNERS, team_id: 'NY' }),
]

describe('the 2027 roster filter', () => {
  it('reads and writes every kind of choice through the address', () => {
    for (const f of [{ kind: 'any' }, { kind: 'club', teamId: 'BOS' }, { kind: 'status', status: 'draft-eligible' },
      { kind: 'status', status: 're-signed' }] as RosterFilter[]) {
      expect(parseRosterFilter(rosterFilterParam(f))).toEqual(f)
    }
    expect(rosterFilterParam({ kind: 'club', teamId: 'BOS' })).toBe('bos')
    expect(parseRosterFilter('nonsense-word')).toBeNull()
    expect(parseRosterFilter('')).toBeNull()
  })

  it('gives every player the status the player card gives them, in one pass', () => {
    const all = rosterStatuses(MOVES, AFTER)
    for (const id of Object.values(ROSTERS_2026).flat()) expect(all.get(id) ?? null).toEqual(rosterStatus(id, MOVES, AFTER))
  })

  it('puts a traded player on the club that got them, and never a 2026 club on its unsigned players', () => {
    const all = rosterStatuses(MOVES, AFTER)
    const bos = { kind: 'club', teamId: 'BOS' } as const
    const ny = { kind: 'club', teamId: 'NY' } as const
    expect(matchesRosterFilter(bos, all.get(ZETT))).toBe(true)
    expect(matchesRosterFilter(ny, all.get(ZETT))).toBe(false)
    expect(matchesRosterFilter(ny, all.get(LAHNERS))).toBe(true)
    // Sato is unplaced: her status carries LA, the 2026 club, and LA's 2027 roster must not list her.
    expect(all.get(SATO)?.kind).toBe('draft-eligible')
    expect(matchesRosterFilter({ kind: 'club', teamId: 'LA' }, all.get(SATO))).toBe(false)
    expect(matchesRosterFilter({ kind: 'any' }, all.get(SATO))).toBe(false)
    expect(matchesRosterFilter({ kind: 'status', status: 'draft-eligible' }, all.get(SATO))).toBe(true)
    expect(matchesRosterFilter({ kind: 'any' }, undefined)).toBe(false)
  })

  it('offers only the clubs and statuses some listed player has', () => {
    const all = rosterStatuses(MOVES, AFTER)
    const c = rosterFilterChoices(all, [KELSIE, ZETT, LAHNERS, SATO])
    expect(c).toEqual({ any: true, clubs: ['BOS', 'NY', 'SF'], kinds: ['re-signed', 'traded', 'draft-eligible'] })
    // A draft adds "Drafted" the day its first pick is entered, with nothing else to change.
    const drafted = [...MOVES, move({ kind: 'drafted', player_id: SATO, team_id: 'SF', draft_round: 1, draft_pick: 3, announced_on: '2027-02-10' })]
    expect(rosterFilterChoices(rosterStatuses(drafted, AFTER), [SATO]).kinds).toEqual(['drafted'])
    expect(rosterFilterChoices(new Map(), [SATO])).toEqual({ any: false, clubs: [], kinds: [] })
  })

  it('is offered on the 2026 board from the window opening until 2027 has a final', () => {
    expect(rosterFilterOffered(2026, 2026, AFTER)).toBe(true)
    expect(rosterFilterOffered(2026, 2026, RESIGN_WINDOW.opens - 1)).toBe(false)
    expect(rosterFilterOffered(2026, 2027, AFTER)).toBe(false)
    expect(rosterFilterOffered(2025, 2026, AFTER)).toBe(false)
    expect(rosterFilterOffered(null, 2026, AFTER)).toBe(false)
  })
})

describe('the 2027 roster questions in search', () => {
  it('reads a status, with or without a side and a stat', () => {
    expect(parseRosterAsk('draft eligible hitters')).toMatchObject({ filter: { kind: 'unplaced' }, side: 'hitting', sort: null })
    expect(parseRosterAsk('draft pool')).toMatchObject({ filter: { kind: 'unplaced' }, side: null })
    expect(parseRosterAsk('unsigned players')).toMatchObject({ filter: { kind: 'unplaced' } })
    expect(parseRosterAsk('re-signed pitchers')).toMatchObject({ filter: { kind: 'status', status: 're-signed' }, side: 'pitching' })
    expect(parseRosterAsk('most hr draft eligible')).toMatchObject({ filter: { kind: 'unplaced' }, side: 'hitting', sort: 'hr' })
  })

  it('reads a club only with the season beside it', () => {
    expect(parseRosterAsk('Boston 2027 roster')).toMatchObject({ filter: { kind: 'club', teamId: 'BOS' } })
    expect(parseRosterAsk('hunters next season')).toMatchObject({ filter: { kind: 'club', teamId: 'BOS' } })
    expect(parseRosterAsk('2027 rosters')).toMatchObject({ filter: { kind: 'any' } })
    expect(parseRosterAsk('Boston roster')).toBeNull()
  })

  it('leaves other questions alone', () => {
    expect(parseRosterAsk('most hr')).toBeNull()
    expect(parseRosterAsk('re-signed whitmore')).toBeNull()
    expect(parseRosterAsk('drafted')).toMatchObject({ filter: { kind: 'status', status: 'drafted' } })
  })

  it('turns "unsigned" into whatever the unplaced players are now', () => {
    const ask = parseRosterAsk('draft eligible')!
    expect(resolveRosterAsk(ask, rosterStatuses(MOVES, AFTER))).toEqual({ kind: 'status', status: 'draft-eligible' })
    const open = Date.parse('2026-11-12T18:00:00Z')
    expect(resolveRosterAsk(ask, rosterStatuses(MOVES, open))).toEqual({ kind: 'status', status: 'unsigned' })
  })
})
