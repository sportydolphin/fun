import { describe, it, expect } from 'vitest'
import {
  ROSTERS_2026, DRAFT_ORDER_2027, RESIGN_WINDOW, rosterBoards, rosterStatus, resignPhase, club2026,
  windowCountdown, positionMix, moveLabel, transactions, pickLabel,
} from '../offseason2027'
import { rosterFact } from '../useRosterMoves'
import type { WpblRosterMove } from '../types'

const KELSIE = '4e6a118d-d3ab-485c-bedf-20c6446d7aa6'   // SF
const DIANA = '7254031e-8d7b-4383-abac-38b93d9367db'    // LA, traded from NY mid-2026
const ZETT = 'ff1f001e-32ac-442d-b3aa-6bde77fec86c'   // NY, traded to BOS Nov 21, 2026
const OPEN = Date.parse('2026-11-12T18:00:00Z')

let nextId = 1
function move(over: Partial<WpblRosterMove>): WpblRosterMove {
  return {
    id: nextId++, season: 2027, kind: 're-signed', player_id: KELSIE, player_name: null, team_id: 'SF', from_team_id: null, trade_id: null,
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

  it('counts down in ET calendar days, and says nothing outside the window', () => {
    expect(windowCountdown(Date.parse('2026-11-09T13:59:00Z'))).toBeNull()
    expect(windowCountdown(Date.parse('2026-11-14T17:00:00Z'))).toBe('6 days left')
    // 11 p.m. ET on Nov 19 is already Nov 20 in UTC; the count follows ET.
    expect(windowCountdown(Date.parse('2026-11-20T04:00:00Z'))).toBe('1 day left')
    expect(windowCountdown(Date.parse('2026-11-20T15:00:00Z'))).toBe('Last day')
    expect(windowCountdown(Date.parse('2026-11-21T05:00:00Z'))).toBeNull()
  })
})

describe('positionMix', () => {
  it('folds labels to groups in lineup-card order and drops what it does not know', () => {
    expect(positionMix(['CF', 'RHP', 'SS', 'P', 'C', 'LHP', '1B', ''])).toBe('3 pitchers, 1 catcher, 2 infielders, 1 outfielder')
    expect(positionMix([])).toBe('')
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

describe('trades', () => {
  // The real one: New York re-signed Zettlemoyer, then traded Zettlemoyer to Boston for a 6th-round pick.
  const resign = () => move({ player_id: ZETT, team_id: 'NY', announced_on: '2026-11-20' })
  const trade = () => move({ kind: 'traded', player_id: ZETT, team_id: 'BOS', from_team_id: 'NY', trade_id: 't1', draft_round: 6, announced_on: '2026-11-21' })

  it('moves a re-signed player to the club that got them, counted there and listed as traded at home', () => {
    const boards = rosterBoards([resign(), trade()])
    const ny = boards.find(b => b.teamId === 'NY')!, bos = boards.find(b => b.teamId === 'BOS')!
    expect(ny.resigned).toHaveLength(0)
    expect(ny.unsigned).not.toContain(ZETT)
    expect(ny.tradedAway.map(t => t.playerId)).toEqual([ZETT])
    expect(bos.resigned.map(r => [r.playerId, r.from])).toEqual([[ZETT, 'NY']])
  })

  it('places a traded player nobody re-signed, and ignores a trade from a club that does not hold them', () => {
    expect(rosterBoards([trade()]).find(b => b.teamId === 'BOS')!.resigned).toHaveLength(1)
    const stray = move({ kind: 'traded', player_id: ZETT, team_id: 'LA', from_team_id: 'SF' })
    expect(rosterBoards([resign(), stray]).find(b => b.teamId === 'NY')!.resigned.map(r => r.playerId)).toEqual([ZETT])
  })

  it('applies trades in the order announced', () => {
    const on = move({ kind: 'traded', player_id: ZETT, team_id: 'LA', from_team_id: 'BOS', announced_on: '2026-11-25' })
    const boards = rosterBoards([on, resign(), trade()])
    expect(boards.find(b => b.teamId === 'LA')!.resigned.map(r => r.from)).toEqual(['BOS'])
    expect(boards.find(b => b.teamId === 'BOS')!.resigned).toHaveLength(0)
  })

  it('says so on the player card and in the transactions list', () => {
    expect(rosterFact(ZETT, [resign(), trade()], OPEN)?.value).toBe('Traded to Boston')
    expect(moveLabel(trade())).toBe('Traded from New York')
    expect(moveLabel(move({ kind: 'drafted', draft_round: 2, draft_pick: 1 }))).toBe('Drafted, 2nd round, 1st pick')
    expect(moveLabel(move({ kind: 'drafted', draft_round: 11 }))).toBe('Drafted, 11th round')
    expect(pickLabel(6)).toBe('6th-round pick')
  })

  it('makes a trade one announcement, each thing that changed hands a leg under the club that got it', () => {
    const t = trade(), r = resign()
    const list = transactions([r, t, move({ season: 2028 })])
    expect(list.map(x => x.trade)).toEqual([true, false])
    expect(list[0].legs.map(l => l.kind === 'pick' ? ['pick', l.to, l.from, l.round] : ['player', l.move.team_id]))
      .toEqual([['player', 'BOS'], ['pick', 'NY', 'BOS', 6]])
  })

  it('groups a player-for-player deal by trade_id, one leg each way', () => {
    const a = move({ kind: 'traded', player_id: ZETT, team_id: 'BOS', from_team_id: 'NY', trade_id: 't2', announced_on: '2026-12-01' })
    const b = move({ kind: 'traded', player_id: KELSIE, team_id: 'NY', from_team_id: 'BOS', trade_id: 't2', announced_on: '2026-12-01' })
    const other = move({ kind: 'traded', player_id: DIANA, team_id: 'SF', from_team_id: 'LA', trade_id: 't3', announced_on: '2026-11-30' })
    const list = transactions([other, b, a])
    expect(list.map(x => x.legs.map(l => l.move.team_id))).toEqual([['BOS', 'NY'], ['SF']])
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
