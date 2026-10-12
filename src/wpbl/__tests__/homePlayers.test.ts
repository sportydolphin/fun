import { describe, it, expect } from 'vitest'
import type { WpblPlayer } from '../types'
import { playerOfTheDay, sunSign, signSeason } from '../derive/homePlayers'

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
    const withBirthday = [...roster, player('bd', { birth_date: '2001-11-05', api_ids: [] })]
    expect(playerOfTheDay(withBirthday, '2026-11-05')).toMatchObject({ player: { id: 'bd' }, reason: 'birthday' })
    const unsettled = [...roster, player('bd', { birth_date: '2001-11-05', birth_date_source: 'doc-unsettled' })]
    expect(playerOfTheDay(unsettled, '2026-11-05')?.reason).toBe('rotation')
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


  it('lists that sign\'s players in birthday order, dated only where the date is settled', () => {
    const roster = [
      player('a', { name: 'Ada', zodiac_sign: 'Libra', birth_date: '2001-10-16', age: 24 }),
      player('b', { name: 'Bea', zodiac_sign: 'Libra', birth_date: '2003-09-25' }),
      player('c', { name: 'Cy', zodiac_sign: 'Libra', birth_date: '2002-10-01', birth_date_source: 'doc-unsettled' }),
      player('d', { name: 'Di', zodiac_sign: 'Leo', birth_date: '2002-08-01' }),
    ]
    const got = signSeason(roster, '2026-10-10').players
    expect(got.map(b => [b.player.name, b.date, b.offset])).toEqual([
      ['Bea', '2026-09-25', -15],
      ['Ada', '2026-10-16', 6],
      ['Cy', null, null],
    ])
    expect(got[1].age).toBe(25)
  })

  it('dates a January Capricorn as next year when the season starts in December', () => {
    const roster = [player('a', { zodiac_sign: 'Capricorn', birth_date: '2001-01-05' })]
    expect(signSeason(roster, '2026-12-28').players[0]).toMatchObject({ date: '2027-01-05', offset: 8 })
  })
})
