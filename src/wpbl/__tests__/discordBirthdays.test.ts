import { describe, it, expect } from 'vitest'
import { birthdaysOn, ageOn, statedAge, buildBirthdayMessage } from '../derive/discordBirthdays'
import type { BirthdayPlayer } from '../derive/discordBirthdays'
import type { WpblTeam } from '../types'

// What the birthday job says in a public channel, and who it says it about. Both are worth
// pinning: a wrong day greets someone on the wrong date, a wrong age is a fan channel
// telling a player how old they are and getting it wrong, and a message built on an empty
// day would post "nobody" every morning.

const team = (id: string, city: string, name: string): WpblTeam => ({
  id, city, name, abbr: id, color: null, color_secondary: null, logo_url: null,
  sort_order: 0, api_id: null, created_at: '2026-07-01T00:00:00Z',
})
const TEAMS = new Map([
  ['LA', team('LA', 'Los Angeles', 'Queens')],
  ['SF', team('SF', 'San Francisco', 'Firebells')],
])

const player = (o: Partial<BirthdayPlayer> = {}): BirthdayPlayer => ({
  id: 'p1', name: 'Sarah Edwards', team_id: 'LA', position: '1B',
  birth_date: '1996-06-26', birth_date_source: 'sheet', age: 29, active: true,
  ...o,
})

describe('birthdaysOn', () => {
  it('matches on month and day, not on year', () => {
    const roster = [player(), player({ id: 'p2', name: 'Other', birth_date: '1996-06-25' })]
    expect(birthdaysOn(roster, '2026-06-26').map(p => p.id)).toEqual(['p1'])
  })

  it('skips a date the sheet contradicted itself about', () => {
    const roster = [player({ birth_date_source: 'sheet-conflict' })]
    expect(birthdaysOn(roster, '2026-06-26')).toEqual([])
  })

  it('skips players who are no longer on a roster', () => {
    expect(birthdaysOn([player({ active: false })], '2026-06-26')).toEqual([])
  })

  it('reads a postgres timestamp as well as a plain date', () => {
    const roster = [player({ birth_date: '1996-06-26T07:00:00.000Z' })]
    expect(birthdaysOn(roster, '2026-06-26').map(p => p.id)).toEqual(['p1'])
  })

  it('returns everyone sharing the day, by name', () => {
    const roster = [
      player({ id: 'p2', name: 'Zoe Last', birth_date: '1998-06-26' }),
      player({ id: 'p1', name: 'Amy First', birth_date: '1996-06-26' }),
    ]
    expect(birthdaysOn(roster, '2026-06-26').map(p => p.name)).toEqual(['Amy First', 'Zoe Last'])
  })
})

describe('statedAge', () => {
  it('states the age when the feed agrees the player just turned it', () => {
    expect(ageOn('1996-06-26', '2026-06-26')).toBe(30)
    expect(statedAge(player({ age: 29 }), '2026-06-26')).toBe(30)
  })

  it('states it when the feed has already ticked over', () => {
    expect(statedAge(player({ age: 30 }), '2026-06-26')).toBe(30)
  })

  it('stays quiet when the sheet year and the feed disagree', () => {
    // Edith De Leija, the real case: the sheet says 2002 and the feed says 22.
    expect(statedAge(player({ birth_date: '2002-04-13', age: 22 }), '2026-04-13')).toBeNull()
  })

  it('states an age the feed has no opinion on', () => {
    expect(statedAge(player({ age: null }), '2026-06-26')).toBe(30)
  })
})

describe('buildBirthdayMessage', () => {
  it('says nothing when nobody has a birthday', () => {
    expect(buildBirthdayMessage([player()], TEAMS, '2026-06-25')).toBeNull()
    expect(buildBirthdayMessage([], TEAMS, '2026-06-26')).toBeNull()
  })

  it('greets one player on a line', () => {
    const msg = buildBirthdayMessage([player()], TEAMS, '2026-06-26')
    expect(msg?.content).toBe(
      '🎂 Happy birthday to [Sarah Edwards](<https://sportydolphin.fun/wpbl?player=p1>), Los Angeles Queens 1B, 30 today.',
    )
  })

  it('leaves the age out rather than printing one it does not trust', () => {
    const msg = buildBirthdayMessage([player({ birth_date: '2002-04-13', age: 22 })], TEAMS, '2026-04-13')
    expect(msg?.content).toContain('Los Angeles Queens 1B.')
    expect(msg?.content).not.toMatch(/\d+ today/)
  })

  it('puts everyone in one message when a day is shared', () => {
    const roster = [
      player(),
      player({ id: 'p2', name: 'Hinano Beppu', team_id: 'SF', position: '2B', birth_date: '1996-06-26', age: 29 }),
    ]
    const msg = buildBirthdayMessage(roster, TEAMS, '2026-06-26')
    expect(msg?.content).toBe([
      '🎂 Birthdays today:',
      '• [Hinano Beppu](<https://sportydolphin.fun/wpbl?player=p2>), San Francisco Firebells 2B, 30',
      '• [Sarah Edwards](<https://sportydolphin.fun/wpbl?player=p1>), Los Angeles Queens 1B, 30',
    ].join('\n'))
  })

  it('copes with a player who has no team or position', () => {
    const msg = buildBirthdayMessage([player({ team_id: null, position: null })], TEAMS, '2026-06-26')
    expect(msg?.content).toBe(
      '🎂 Happy birthday to [Sarah Edwards](<https://sportydolphin.fun/wpbl?player=p1>), 30 today.',
    )
  })

  it('never pings the channel', () => {
    expect(buildBirthdayMessage([player()], TEAMS, '2026-06-26')?.allowed_mentions).toEqual({ parse: [] })
  })
})
