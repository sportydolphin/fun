import { describe, it, expect } from 'vitest'
import type { WpblPlayer } from '../types'
import { awardManagerWinner, awardWinner, homeLeaderRows, playerOfTheDay, sunSign, signSeason } from '../derive/homePlayers'

describe('awardWinner', () => {
  const roster = [playerAt('a'), playerAt('b')]
  function playerAt(id: string) { return { id, name: id } as WpblPlayer }

  it('takes the most votes, and the key on a tie, as the results sheet ranks them', () => {
    expect(awardWinner({ mvp: { a: 3, b: 5 } }, 'mvp', roster)?.id).toBe('b')
    expect(awardWinner({ mvp: { b: 4, a: 4 } }, 'mvp', roster)?.id).toBe('a')
  })

  it('skips a key that names nobody on the roster, and names no one with no votes', () => {
    expect(awardWinner({ mvp: { 'name:gone': 9, a: 1 } }, 'mvp', roster)?.id).toBe('a')
    expect(awardWinner({ mvp: { a: 0 } }, 'mvp', roster)).toBeNull()
    expect(awardWinner({}, 'mvp', roster)).toBeNull()
  })
})

describe('awardManagerWinner', () => {
  it('names the manager from their key, and skips a key that is no manager', () => {
    expect(awardManagerWinner({ manager: { 'mgr:matt-williams': 5, 'mgr:jemile-weeks': 3 } }, 'manager')?.name).toBe('Matt Williams')
    expect(awardManagerWinner({ manager: { 'mgr:gone': 9 } }, 'manager')).toBeNull()
  })
})

describe('homeLeaderRows', () => {
  const a = { id: 'a', name: 'A' } as WpblPlayer, b = { id: 'b', name: 'B' } as WpblPlayer, c = { id: 'c', name: 'C' } as WpblPlayer
  const solo = (stat: string, p: WpblPlayer) => ({ stat, leaders: [{ player: p, text: stat, rank: 1 }, { player: c, text: '0', rank: 2 }] })

  it('merges the stats of a sole leader onto one row, up to two, and moves on to other leaders', () => {
    const rows = homeLeaderRows([solo('war', a), solo('avg', a), solo('rbi', a), solo('era', b)], 2)
    expect(rows.map(r => [r.players.map(p => p.id), r.stats.map(s => s.stat)])).toEqual([
      [['a'], ['war', 'avg']],
      [['b'], ['era']],
    ])
  })

  it('names everyone tied for first in a row of its own, never merged', () => {
    const tied = { stat: 'hr', leaders: [{ player: a, text: '11', rank: 1 }, { player: b, text: '11', rank: 1 }, { player: c, text: '5', rank: 3 }] }
    const rows = homeLeaderRows([solo('avg', a), tied, solo('rbi', a)], 5)
    expect(rows.map(r => r.players.map(p => p.id))).toEqual([['a'], ['a', 'b']])
    expect(rows[0].stats.map(s => s.stat)).toEqual(['avg', 'rbi'])
  })

  it('stops at the row count, and skips a stat nobody leads', () => {
    expect(homeLeaderRows([{ stat: 'sv', leaders: [] }, solo('avg', a), solo('era', b)], 1).map(r => r.stats[0].stat)).toEqual(['avg'])
  })
})

function player(id: string, over: Partial<WpblPlayer> = {}): WpblPlayer {
  return {
    id, team_id: 'SF', name: `Player ${id}`, position: 'SS', bats: 'R', throws: 'R', jersey_number: '1',
    age: 24, hometown: 'Vancouver, British Columbia, Canada', status: 'Signed', draft_round: 1, draft_pick: 1,
    bio: null, birth_date: '2002-03-01', birth_date_source: 'doc', zodiac_sign: 'Pisces', active: true,
    api_id: `f-${id}`, api_ids: [`f-${id}`], team_as_of: null, created_at: '2026-01-01', ...over,
  }
}

describe('playerOfTheDay', () => {
  const roster = Array.from({ length: 10 }, (_, i) => player(`p${i}`))

  it('is the same pick all day and walks the whole pool before repeating', () => {
    const seen = new Set<string>()
    for (let d = 1; d <= 10; d++) {
      const day = `2026-11-${String(d).padStart(2, '0')}`
      expect(playerOfTheDay(roster, day)?.player.id).toBe(playerOfTheDay(roster, day)?.player.id)
      seen.add(playerOfTheDay(roster, day)!.player.id)
    }
    expect(seen.size).toBe(10)
  })

  it('draws the rotation only from players with a box-score line', () => {
    const benched = roster.map((p, i) => i === 0 ? p : { ...p, api_ids: [] })
    expect(playerOfTheDay(benched, '2026-11-05')?.player.id).toBe('p0')
  })

  it('lets a settled birthday outrank the rotation, and an unsettled one does not', () => {
    const withBirthday = [...roster, player('bd', { birth_date: '2001-11-05' })]
    expect(playerOfTheDay(withBirthday, '2026-11-05')).toMatchObject({ player: { id: 'bd' }, reason: 'birthday' })
    const unsettled = [...roster, player('bd', { birth_date: '2001-11-05', birth_date_source: 'doc-unsettled' })]
    expect(playerOfTheDay(unsettled, '2026-11-05')?.reason).toBe('rotation')
  })

  it('passes over a birthday with no games, which would lead the page with an empty season line', () => {
    const noGames = [...roster, player('bd', { birth_date: '2001-11-05', api_ids: [] })]
    expect(playerOfTheDay(noGames, '2026-11-05')).toMatchObject({ reason: 'rotation' })
    expect(playerOfTheDay(noGames, '2026-11-05')?.player.id).not.toBe('bd')
  })
})

describe('sunSign', () => {
  it('places the cusps and the sign that wraps the year', () => {
    expect(sunSign('2026-10-10').name).toBe('Libra')
    expect(sunSign('2026-10-23').name).toBe('Scorpio')
    expect(sunSign('2026-12-25').name).toBe('Capricorn')
    expect(sunSign('2027-01-19').name).toBe('Capricorn')
    expect(sunSign('2027-01-20').name).toBe('Aquarius')
  })


  it('lists that sign\'s players, dated only where the date is settled', () => {
    const roster = [
      player('a', { name: 'Ada', zodiac_sign: 'Libra', birth_date: '2001-10-16', age: 24 }),
      player('b', { name: 'Bea', zodiac_sign: 'Libra', birth_date: '2003-09-25' }),
      player('c', { name: 'Cy', zodiac_sign: 'Libra', birth_date: '2002-10-01', birth_date_source: 'doc-unsettled' }),
      player('d', { name: 'Di', zodiac_sign: 'Leo', birth_date: '2002-08-01' }),
    ]
    const got = signSeason(roster, '2026-10-10').players
    expect(got.map(b => [b.player.name, b.date, b.offset])).toEqual([
      ['Ada', '2026-10-16', 6],
      ['Bea', '2026-09-25', -15],
      ['Cy', null, null],
    ])
    expect(got[0].age).toBe(25)
  })

  it('leads with today, then the days ahead, then the most recent past', () => {
    const roster = [
      player('a', { name: 'Ada', zodiac_sign: 'Libra', birth_date: '2001-09-24' }),
      player('b', { name: 'Bea', zodiac_sign: 'Libra', birth_date: '2003-10-05' }),
      player('c', { name: 'Cy', zodiac_sign: 'Libra', birth_date: '2002-10-10' }),
      player('d', { name: 'Di', zodiac_sign: 'Libra', birth_date: '2002-10-20' }),
    ]
    expect(signSeason(roster, '2026-10-10').players.map(b => b.player.name)).toEqual(['Cy', 'Di', 'Bea', 'Ada'])
  })

  it('dates a January Capricorn as next year when the season starts in December', () => {
    const roster = [player('a', { zodiac_sign: 'Capricorn', birth_date: '2001-01-05' })]
    expect(signSeason(roster, '2026-12-28').players[0]).toMatchObject({ date: '2027-01-05', offset: 8 })
  })
})
