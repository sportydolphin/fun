import { describe, it, expect } from 'vitest'
import {
  ROSTERS_2026, DRAFT_ORDER_2027, RESIGN_WINDOW, rosterBoards, rosterStatus, resignPhase, club2026,
  positionMix, moveLabel, transactions, pickLabel, tradedPicks, isPickRow, openPicks, heldPlayers, unplacedStatus,
  RESIGN_ANNOUNCEMENTS_UNTIL,
} from '../offseason2027'
import { rosterFact } from '../useRosterMoves'
import { moveChoices } from '../rosterMoveChoices'
import type { WpblPlayer, WpblRosterMove } from '../types'

const KELSIE = '4e6a118d-d3ab-485c-bedf-20c6446d7aa6'   // SF
const DIANA = '7254031e-8d7b-4383-abac-38b93d9367db'    // LA, traded from NY mid-2026
const ZETT = 'ff1f001e-32ac-442d-b3aa-6bde77fec86c'   // NY, traded to BOS Nov 21, 2026
const OPEN = Date.parse('2026-11-12T18:00:00Z')

let nextId = 1
function move(over: Partial<WpblRosterMove>): WpblRosterMove {
  return {
    id: nextId++, season: 2027, kind: 're-signed', player_id: KELSIE, player_name: null, team_id: 'SF', from_team_id: null, trade_id: null, pick_team_id: null,
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

describe('positionMix', () => {
  it('folds labels to groups in lineup-card order and drops what it does not know', () => {
    expect(positionMix(['CF', 'RHP', 'SS', 'P', 'C', 'LHP', '1B', ''])).toBe('3 pitchers, 1 catcher, 2 infielders, 1 outfielder')
    expect(positionMix([])).toBe('')
  })
})

describe('rosterBoards', () => {
  it('splits each club into kept and the rest, in the league\'s order', () => {
    const boards = rosterBoards([move({})])
    const sf = boards.find(b => b.teamId === 'SF')!
    expect(sf.kept.map(r => r.playerId)).toEqual([KELSIE])
    expect(sf.unsigned).toHaveLength(16)
    expect(sf.unsigned).not.toContain(KELSIE)
    expect(boards.map(b => b.teamId)).toEqual(['BOS', 'NY', 'SF', 'LA'])
  })

  it('keeps nobody on a re-signing by another club, another season or a pick', () => {
    const boards = rosterBoards([
      move({ team_id: 'BOS' }),
      move({ season: 2028 }),
      move({ kind: 'drafted' }),
    ])
    expect(boards.every(b => b.kept.length === 0)).toBe(true)
  })
})

describe('trades', () => {
  // The real one: New York re-signed Zettlemoyer, then traded Zettlemoyer to Boston for a 6th-round pick.
  const resign = () => move({ player_id: ZETT, team_id: 'NY', announced_on: '2026-11-20' })
  // One asset per row: the player New York to Boston, and Boston's 6th-round pick back.
  const trade = () => move({ kind: 'traded', player_id: ZETT, team_id: 'BOS', from_team_id: 'NY', trade_id: 't1', announced_on: '2026-11-21' })
  const pick = () => move({ kind: 'traded', player_id: null, team_id: 'NY', from_team_id: 'BOS', trade_id: 't1', draft_round: 6, announced_on: '2026-11-21' })

  it('moves a re-signed player to the club that got them, counted there and off the board of the club they left', () => {
    const boards = rosterBoards([resign(), trade()])
    const ny = boards.find(b => b.teamId === 'NY')!, bos = boards.find(b => b.teamId === 'BOS')!
    expect(ny.kept).toHaveLength(0)
    expect(ny.unsigned).not.toContain(ZETT)
    expect(bos.kept.map(r => [r.playerId, r.from])).toEqual([[ZETT, 'NY']])
  })

  it('places a traded player nobody re-signed, and ignores a trade from a club that does not hold them', () => {
    expect(rosterBoards([trade()]).find(b => b.teamId === 'BOS')!.kept).toHaveLength(1)
    const stray = move({ kind: 'traded', player_id: ZETT, team_id: 'LA', from_team_id: 'SF' })
    expect(rosterBoards([resign(), stray]).find(b => b.teamId === 'NY')!.kept.map(r => r.playerId)).toEqual([ZETT])
  })

  it('applies trades in the order announced', () => {
    const on = move({ kind: 'traded', player_id: ZETT, team_id: 'LA', from_team_id: 'BOS', announced_on: '2026-11-25' })
    const boards = rosterBoards([on, resign(), trade()])
    expect(boards.find(b => b.teamId === 'LA')!.kept.map(r => r.from)).toEqual(['BOS'])
    expect(boards.find(b => b.teamId === 'BOS')!.kept).toHaveLength(0)
  })

  it('says so on the player card and in the transactions list', () => {
    expect(rosterFact(ZETT, [resign(), trade()], OPEN)?.value).toBe('Traded to Boston')
    expect(moveLabel(trade())).toBe('Traded from New York')
    expect(moveLabel(move({ kind: 'drafted', draft_round: 2, draft_pick: 1 }))).toBe('Drafted, 2nd round, 1st pick')
    expect(moveLabel(move({ kind: 'drafted', draft_round: 11 }))).toBe('Drafted, 11th round')
    expect(pickLabel(6)).toBe('6th-round pick')
  })

  it('makes a trade one announcement, each thing that changed hands a leg under the club that got it', () => {
    const r = resign()
    const list = transactions([pick(), r, trade(), move({ season: 2028 })])
    expect(list.map(x => x.trade)).toEqual([true, false])
    expect(list[0].legs.map(l => l.kind === 'pick' ? ['pick', l.to, l.from, l.round] : ['player', l.move.team_id]))
      .toEqual([['player', 'BOS'], ['pick', 'NY', 'BOS', 6]])
  })

  it('moves picks through the draft, and ignores a pick the giver could not hold', () => {
    expect(tradedPicks([trade(), pick()])).toEqual([{ round: 6, original: 'BOS', holder: 'NY' }])
    // New York trades a 6th to Los Angeles, then another to San Francisco. A club holding two picks
    // in a round gives its own first; the post rarely says which, and the order is what matters.
    const flip = move({ kind: 'traded', player_id: null, team_id: 'LA', from_team_id: 'NY', trade_id: 't9', draft_round: 6, announced_on: '2026-11-25' })
    const own = move({ kind: 'traded', player_id: null, team_id: 'SF', from_team_id: 'NY', trade_id: 't9', draft_round: 6, announced_on: '2026-11-26' })
    expect(tradedPicks([pick(), flip, own])).toEqual([
      { round: 6, original: 'BOS', holder: 'SF' }, { round: 6, original: 'NY', holder: 'LA' },
    ])
    const impossible = move({ kind: 'traded', player_id: null, team_id: 'SF', from_team_id: 'BOS', trade_id: 't8', draft_round: 6, announced_on: '2026-11-30' })
    expect(tradedPicks([pick(), impossible])).toEqual([{ round: 6, original: 'BOS', holder: 'NY' }])
  })

  it('moves the pick a row names, not whichever the giver holds first', () => {
    // New York holds its own 6th and Boston's. It passes Boston's on to Los Angeles: the guess would
    // have sent New York's own, and the draft board would show the wrong club picking.
    const onward = move({ kind: 'traded', player_id: null, team_id: 'LA', from_team_id: 'NY', trade_id: 't9', draft_round: 6, pick_team_id: 'BOS', announced_on: '2026-11-25' })
    expect(tradedPicks([pick(), onward])).toEqual([{ round: 6, original: 'BOS', holder: 'LA' }])
    expect(openPicks([pick(), onward], 'NY').filter(p => p.round === 6).map(p => p.original)).toEqual(['NY'])
    // A row naming a pick the giver does not hold moves nothing.
    const notHeld = move({ kind: 'traded', player_id: null, team_id: 'SF', from_team_id: 'NY', trade_id: 't8', draft_round: 6, pick_team_id: 'LA', announced_on: '2026-11-26' })
    expect(tradedPicks([pick(), notHeld])).toEqual([{ round: 6, original: 'BOS', holder: 'NY' }])
  })

  it('draws a player not yet in the database by name, and leaves the rosters alone', () => {
    const named = move({ kind: 'traded', player_id: null, player_name: 'New Draftee', team_id: 'SF', from_team_id: 'LA', trade_id: 't7' })
    expect(isPickRow(named)).toBe(false)
    expect(transactions([named])[0].legs[0].kind).toBe('player')
    expect(rosterBoards([named]).every(b => b.kept.length === 0)).toBe(true)
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

  it('says re-signed, not yet, not announced, then draft eligible once announcements end', () => {
    expect(rosterFact(KELSIE, [move({})], OPEN)?.value).toBe('Re-signed')
    expect(rosterFact(KELSIE, [], OPEN)?.value).toBe('Not yet re-signed')
    expect(rosterFact(KELSIE, [], Date.parse('2026-11-22T00:00:00Z'))?.value).toBe('Not announced')
    expect(rosterFact(KELSIE, [], RESIGN_ANNOUNCEMENTS_UNTIL + 1)?.value).toBe('Draft eligible')
    expect(rosterStatus(KELSIE, [move({})], Date.parse('2026-11-22T00:00:00Z'))?.kind).toBe('re-signed')
  })

  it('says nothing for a player the league did not list', () => {
    expect(rosterFact('00000000-0000-0000-0000-000000000000', [], OPEN)).toBeNull()
  })
})

describe('a player no move has placed, after the window', () => {
  const REVEALS = Date.parse('2026-11-22T00:00:00Z')

  it('is not announced while the club is short of 10, and eligible once it has 10', () => {
    expect(unplacedStatus(7, REVEALS)).toBe('not-announced')
    expect(unplacedStatus(10, REVEALS)).toBe('draft-eligible')
    expect(unplacedStatus(7, RESIGN_ANNOUNCEMENTS_UNTIL)).toBe('not-announced')
    expect(unplacedStatus(7, RESIGN_ANNOUNCEMENTS_UNTIL + 1)).toBe('draft-eligible')
    expect(unplacedStatus(10, OPEN)).toBe('unsigned')
  })

  it('reads eligible on the player card of a club with its 10', () => {
    const ten = ROSTERS_2026.SF.filter(id => id !== KELSIE).slice(0, 10).map(id => move({ player_id: id }))
    expect(rosterFact(KELSIE, ten, REVEALS)?.value).toBe('Draft eligible')
    expect(rosterFact(KELSIE, ten.slice(1), REVEALS)?.value).toBe('Not announced')
  })
})

describe('the draft, signings and releases', () => {
  const AFTER = Date.parse('2027-03-20T00:00:00Z')
  const NEW = '00000000-0000-0000-0000-0000000000aa'   // not on a 2026 roster
  const on = (day: number) => `2027-03-${String(day).padStart(2, '0')}`
  const board = (id: string, moves: WpblRosterMove[]) => rosterBoards(moves).find(b => b.teamId === id)!
  const drafted = (over: Partial<WpblRosterMove> = {}) =>
    move({ kind: 'drafted', player_id: DIANA, team_id: 'BOS', draft_round: 1, draft_pick: 1, announced_on: on(1), ...over })
  const signed = (over: Partial<WpblRosterMove> = {}) =>
    move({ kind: 'signed', player_id: DIANA, team_id: 'BOS', announced_on: on(10), ...over })

  it('takes a drafted 2026 player off the old club and holds them unsigned on the new one', () => {
    const moves = [drafted()]
    expect(board('BOS', moves).drafted.map(p => p.key)).toEqual([DIANA])
    expect(board('BOS', moves).kept).toEqual([])
    expect(board('LA', moves).unsigned).not.toContain(DIANA)
    expect(rosterFact(DIANA, moves, AFTER)?.value).toBe('Drafted by Boston')
  })

  it('moves a pick to signed at signing, whatever order the rows arrive in', () => {
    const pick = drafted(), sign = signed()
    expect(board('BOS', [sign, pick]).drafted).toEqual([])
    expect(board('BOS', [sign, pick]).signed.map(p => p.key)).toEqual([DIANA])
    expect(rosterFact(DIANA, [pick, sign], AFTER)?.value).toBe('Signed with Boston')
  })

  it('lets a pick who did not sign go to another club', () => {
    const moves = [drafted(), signed({ team_id: 'SF', announced_on: on(20) })]
    expect(board('BOS', moves).drafted).toEqual([])
    expect(board('SF', moves).signed.map(p => p.key)).toEqual([DIANA])
  })

  it('takes a released player off the roster, and lets any club sign them', () => {
    const kept = move({}), out = move({ kind: 'released', announced_on: on(5) })
    expect(board('SF', [kept, out]).kept).toEqual([])
    expect(board('SF', [kept, out]).released.map(p => p.key)).toEqual([KELSIE])
    expect(board('SF', [kept, out]).unsigned).not.toContain(KELSIE)
    expect(rosterFact(KELSIE, [kept, out], AFTER)?.value).toBe('Released by San Francisco')
    const back = signed({ player_id: KELSIE, team_id: 'NY' })
    expect(board('NY', [kept, out, back]).signed.map(p => p.key)).toEqual([KELSIE])
    expect(board('SF', [kept, out, back]).released).toEqual([])
  })

  it('ignores a move of a player another club has under contract, and a release by a club without them', () => {
    const kept = move({})
    for (const kind of ['drafted', 'signed', 'released'] as const) {
      const moves = [kept, move({ kind, team_id: 'LA', announced_on: on(5) })]
      expect(board('SF', moves).kept.map(p => p.key)).toEqual([KELSIE])
      expect(heldPlayers(moves).get(KELSIE)).toBe('SF')
    }
  })

  it('does not let the 2026 club trade a player it released', () => {
    const moves = [move({}), move({ kind: 'released', announced_on: on(2) }),
      move({ kind: 'traded', team_id: 'LA', from_team_id: 'SF', trade_id: 't5', announced_on: on(3) })]
    expect(board('LA', moves).kept).toEqual([])
  })

  it('keeps a traded pick unsigned on the club that got them', () => {
    const moves = [drafted(), move({ kind: 'traded', player_id: DIANA, team_id: 'NY', from_team_id: 'BOS', trade_id: 't6', announced_on: on(3) })]
    expect(board('NY', moves).drafted.map(p => [p.key, p.from])).toEqual([[DIANA, 'BOS']])
    expect(board('NY', moves).kept).toEqual([])
  })

  it('follows a newcomer with no row by name, through spacing and case', () => {
    const pick = drafted({ player_id: null, player_name: 'New Draftee' })
    const sign = signed({ player_id: null, player_name: ' new  draftee' })
    expect(board('BOS', [pick]).drafted.map(p => [p.playerId, p.name])).toEqual([[null, 'New Draftee']])
    expect(board('BOS', [pick, sign]).drafted).toEqual([])
    expect(board('BOS', [pick, sign]).signed).toHaveLength(1)
  })

  it('gives a player off the 2026 rosters a card line once a move names them', () => {
    const moves = [drafted({ player_id: NEW })]
    expect(rosterFact(NEW, moves, AFTER)?.value).toBe('Drafted by Boston')
    expect(rosterFact(NEW, null, AFTER, moves)?.value).toBe('—')
    expect(rosterFact(NEW, null, AFTER)).toBeNull()
  })

  it('counts only re-signed and traded-for players toward the 10', () => {
    const moves = [move({}), drafted({ team_id: 'SF' }), signed({ player_id: NEW, team_id: 'SF' })]
    expect(board('SF', moves).kept).toHaveLength(1)
    expect([...heldPlayers(moves).values()]).toEqual(['SF', 'SF', 'SF'])
  })

  it('names a club\'s newest addition of any kind', () => {
    const kept = move({}), pick = drafted({ team_id: 'SF' })
    expect(board('SF', [kept, pick]).newest?.key).toBe(DIANA)
  })

  it('offers each club the picks it holds and has not used', () => {
    const traded = move({ kind: 'traded', player_id: null, team_id: 'NY', from_team_id: 'BOS', trade_id: 't1', draft_round: 6 })
    expect(openPicks([traded], 'BOS')).toHaveLength(9)
    expect(openPicks([traded], 'NY').filter(p => p.round === 6))
      .toEqual([{ round: 6, pick: 1, original: 'BOS' }, { round: 6, pick: 2, original: 'NY' }])
    const used = drafted({ team_id: 'NY', draft_round: 6, draft_pick: 1 })
    expect(openPicks([traded, used], 'NY')).toHaveLength(10)
  })

  it('offers the admin form only moves the rosters would accept', () => {
    const players = [[KELSIE, 'Kelsie Whitmore'], [DIANA, 'Diana Ibarra'], [NEW, 'Ana New']].map(([id, name]) => ({ id, name }) as WpblPlayer)
    const named = drafted({ player_id: null, player_name: 'Zoe Typed', team_id: 'LA', draft_pick: 4 })
    const moves = [move({}), drafted(), named]
    const names = (kind: 'drafted' | 'signed' | 'released', club: string) => moveChoices(kind, club, moves, players).map(c => c.name)
    expect(names('drafted', 'NY')).toEqual(['Ana New'])
    expect(names('signed', 'LA')).toEqual(['Zoe Typed', 'Ana New', 'Diana Ibarra'])
    expect(names('released', 'SF')).toEqual(['Kelsie Whitmore'])
  })
})
