import { describe, it, expect } from 'vitest'
import type { WpblPlayer } from '../types'
import { playerOfTheDay, upcomingBirthdays, sunSign, signSeason, hometownOfTheDay, regionOf } from '../derive/homePlayers'

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

describe('upcomingBirthdays', () => {
  it('keeps one just past, then today and the next ones in order, across New Year', () => {
    const roster = [
      player('a', { birth_date: '2000-12-29' }),
      player('b', { birth_date: '2000-12-30' }),
      player('c', { birth_date: '2000-12-31' }),
      player('d', { birth_date: '2000-01-02' }),
      player('e', { birth_date: '2000-06-01' }),
    ]
    const got = upcomingBirthdays(roster, '2026-12-31', { limit: 3 })
    expect(got.map(b => [b.player.id, b.offset])).toEqual([['b', -1], ['c', 0], ['d', 2]])
    expect(got[2].date).toBe('2027-01-02')
  })

  it('states an age only when the feed agrees with the year', () => {
    const [ok] = upcomingBirthdays([player('a', { birth_date: '2002-11-10', age: 23 })], '2026-11-09')
    expect(ok.age).toBe(24)
    const [off] = upcomingBirthdays([player('a', { birth_date: '2002-11-10', age: 30 })], '2026-11-09')
    expect(off.age).toBeNull()
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

  it('lists that sign\'s players with the ones who played first', () => {
    const roster = [
      player('z', { name: 'Ada', zodiac_sign: 'Libra', api_ids: [] }),
      player('y', { name: 'Bea', zodiac_sign: 'Libra' }),
      player('x', { name: 'Cy', zodiac_sign: 'Leo' }),
    ]
    expect(signSeason(roster, '2026-10-10').players.map(p => p.name)).toEqual(['Bea', 'Ada'])
  })
})

describe('hometownOfTheDay', () => {
  it('groups by state and country, needs three players, and skips a bare country', () => {
    expect(regionOf('Gatineau, Quebec, Canada')).toBe('Quebec, Canada')
    expect(regionOf('Perth, Australia')).toBe('Perth, Australia')
    const roster = [
      player('a', { hometown: 'Gatineau, Quebec, Canada' }),
      player('b', { hometown: 'Montreal, Quebec, Canada' }),
      player('f', { hometown: 'Laval, Quebec, Canada' }),
      player('c', { hometown: 'Osaka, Japan' }),
      player('g', { hometown: 'Sakai, Osaka, Japan' }),
      player('d', { hometown: 'USA' }),
      player('e', { hometown: 'USA' }),
      player('h', { hometown: 'USA' }),
    ]
    const got = hometownOfTheDay(roster, '2026-10-10')
    expect(got?.region).toBe('Quebec, Canada')
    expect(got?.players.map(p => p.id)).toEqual(['a', 'b', 'f'])
  })
})
