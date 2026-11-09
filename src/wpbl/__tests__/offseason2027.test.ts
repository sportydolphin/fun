import { describe, it, expect } from 'vitest'
import {
  ROSTERS_2026, DRAFT_ORDER_2027, RESIGN_WINDOW, rosterBoards, rosterStatus, resignPhase, club2026,
} from '../offseason2027'
import { rosterFact } from '../useRosterMoves'
import type { WpblRosterMove } from '../types'

const KELSIE = '4e6a118d-d3ab-485c-bedf-20c6446d7aa6'   // SF
const DIANA = '7254031e-8d7b-4383-abac-38b93d9367db'    // LA, traded from NY mid-2026
const OPEN = Date.parse('2026-11-12T18:00:00Z')

let nextId = 1
function move(over: Partial<WpblRosterMove>): WpblRosterMove {
  return {
    id: nextId++, season: 2027, kind: 're-signed', player_id: KELSIE, player_name: null, team_id: 'SF',
    draft_round: null, draft_pick: null, announced_on: '2026-11-12', source_url: 'https://example.com/a', ...over,
  }
}

describe('the 2026 rosters the league published', () => {
  it('lists 70 players: 18, 17, 18 and 17, with nobody on two clubs', () => {
    expect(Object.fromEntries(Object.entries(ROSTERS_2026).map(([k, v]) => [k, v.length])))
      .toEqual({ BOS: 18, NY: 17, LA: 18, SF: 17 })
    const all = Object.values(ROSTERS_2026).flat()
    expect(new Set(all).size).toBe(70)
  })

  it('keys every club in the draft order', () => {
    expect([...DRAFT_ORDER_2027].sort()).toEqual(Object.keys(ROSTERS_2026).sort())
  })

  it('puts a traded player on the club the league listed, not the one the season started on', () => {
    expect(club2026(DIANA)).toBe('LA')
  })
})

describe('the re-signing window', () => {
  it('opens Nov 9 at 9 a.m. ET and closes Nov 20 at 11:59 p.m. ET', () => {
    expect(resignPhase(Date.parse('2026-11-09T13:59:00Z'))).toBe('before')
    expect(resignPhase(RESIGN_WINDOW.opens)).toBe('open')
    expect(resignPhase(Date.parse('2026-11-21T04:59:00Z'))).toBe('open')
    expect(resignPhase(Date.parse('2026-11-21T05:00:00Z'))).toBe('closed')
  })
})

describe('rosterBoards', () => {
  it('splits each club into re-signed and the rest, in the league\'s order', () => {
    const boards = rosterBoards([move({})])
    const sf = boards.find(b => b.teamId === 'SF')!
    expect(sf.resigned.map(r => r.playerId)).toEqual([KELSIE])
    expect(sf.unsigned).toHaveLength(16)
    expect(sf.unsigned).not.toContain(KELSIE)
    expect(boards.map(b => b.teamId)).toEqual(['BOS', 'NY', 'SF', 'LA'])
  })

  it('ignores a re-signing by a club the player was not on, and other seasons and kinds', () => {
    const boards = rosterBoards([
      move({ team_id: 'BOS' }),
      move({ season: 2028 }),
      move({ kind: 'drafted' }),
    ])
    expect(boards.every(b => b.resigned.length === 0)).toBe(true)
  })
})

describe('the player card line', () => {
  it('waits on the read with a dash, so the line is there from the first paint', () => {
    expect(rosterFact(KELSIE, null, OPEN)).toEqual({ label: '2027', value: '—', inline: '2027: …' })
  })

  it('says re-signed, not yet, or draft eligible once the window closes', () => {
    expect(rosterFact(KELSIE, [move({})], OPEN)?.value).toBe('Re-signed')
    expect(rosterFact(KELSIE, [], OPEN)?.value).toBe('Not yet re-signed')
    expect(rosterFact(KELSIE, [], Date.parse('2026-11-22T00:00:00Z'))?.value).toBe('Draft eligible')
    expect(rosterStatus(KELSIE, [move({})], Date.parse('2026-11-22T00:00:00Z'))?.kind).toBe('re-signed')
  })

  it('says nothing for a player the league did not list', () => {
    expect(rosterFact('00000000-0000-0000-0000-000000000000', [], OPEN)).toBeNull()
  })
})
