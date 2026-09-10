import { describe, it, expect } from 'vitest'
import { userLeague, userIsReachable } from '../lib/adminUsers'
import type { AdminUser } from '../lib/adminUsers'
import { sortUsers, SORT_CHOICES } from '../AdminUsers'
import { prettyPick } from '../AdminUserDetail'
import { makeFakeUsers, makeFakeDetail } from '../dev/fakeUsers'

// The Users panel's derived values, which are the whole reason a roster of 150 rows can be
// read at all: they decide which section an account belongs to, whether anything we send
// reaches it, and what order the table is in. All three are wrong in ways that keep
// rendering perfectly, so they are pure and tested here rather than inline in the JSX.

const user = (o: Partial<AdminUser> = {}): AdminUser => ({
  user_id: 'u1', username: 'someone', created_at: '2026-08-01T00:00:00Z',
  is_deleted: false, deleted_at: null,
  email: 'a@b.dev', provider: 'email', confirmed: true, last_sign_in: null,
  events: 0, active_days: 0, wpbl_events: 0, mlb_events: 0, last_seen: null,
  favorite_team: null, notify_wpbl_all: false, notify_game_start: false, notify_picks: false,
  push_devices: 0, game_reminders: 0, series_picks: 0, feedback: 0,
  roles: [], predictions: null, correct: null, accuracy: null,
  ...o,
})

describe('which section an account reads', () => {
  it('says none when nothing was measured', () => {
    expect(userLeague(user())).toBe('none')
  })

  it('is one-sided when the other side is empty', () => {
    expect(userLeague(user({ wpbl_events: 40 }))).toBe('wpbl')
    expect(userLeague(user({ mlb_events: 40 }))).toBe('mlb')
  })

  // THE REASON THE THRESHOLD EXISTS. /wpbl is the default route, so an MLB reader lands
  // there on the way in every single visit and picks up a handful of WPBL rows they never
  // asked for. Counting any crossover as "both" would report a site where almost nobody is
  // one-sided, which is the opposite of the truth.
  it('does not call a stray few events on the other side a split', () => {
    expect(userLeague(user({ wpbl_events: 3, mlb_events: 97 }))).toBe('mlb')
    expect(userLeague(user({ wpbl_events: 97, mlb_events: 3 }))).toBe('wpbl')
  })

  it('calls a real split both', () => {
    expect(userLeague(user({ wpbl_events: 60, mlb_events: 40 }))).toBe('both')
    expect(userLeague(user({ wpbl_events: 80, mlb_events: 20 }))).toBe('both')
  })
})

describe('who we can actually reach', () => {
  // A SUBSCRIPTION IS NOT CONSENT, which the pick-reminder backfill established in SQL and
  // this repeats in the panel: a device with every toggle off receives nothing, and counting
  // it as reachable would overstate the audience for every push feature on the site.
  it('will not count a subscribed device with every toggle off', () => {
    expect(userIsReachable(user({ push_devices: 2 }))).toBe(false)
  })

  it('will not count a toggle with no device to send to', () => {
    expect(userIsReachable(user({ notify_wpbl_all: true }))).toBe(false)
  })

  it('counts a device with something switched on', () => {
    expect(userIsReachable(user({ push_devices: 1, notify_game_start: true }))).toBe(true)
    expect(userIsReachable(user({ push_devices: 1, game_reminders: 3 }))).toBe(true)
  })
})

describe('sorting the roster', () => {
  const rows = [
    user({ user_id: 'a', username: 'zoe',   events: 5,   last_seen: '2026-09-01T00:00:00Z' }),
    user({ user_id: 'b', username: 'aaron', events: 100, last_seen: '2026-09-08T00:00:00Z' }),
    user({ user_id: 'c', username: 'mira',  events: 0,   last_seen: null }),
  ]

  it('puts the most recent first by default', () => {
    expect(sortUsers(rows, 'last_seen').map(u => u.user_id)).toEqual(['b', 'a', 'c'])
  })

  it('puts the busiest first on activity', () => {
    expect(sortUsers(rows, 'events').map(u => u.user_id)).toEqual(['b', 'a', 'c'])
  })

  // An account that has never fired an event has no last_seen, and a sort that dropped it
  // would silently shorten the roster rather than showing an empty cell.
  it('keeps a never-seen account in the list', () => {
    expect(sortUsers(rows, 'last_seen')).toHaveLength(3)
  })

  it('sorts names alphabetically whichever way the arrow points', () => {
    expect(sortUsers(rows, 'username').map(u => u.username)).toEqual(['aaron', 'mira', 'zoe'])
  })

  it('does not mutate its input', () => {
    const before = rows.map(u => u.user_id)
    sortUsers(rows, 'events')
    expect(rows.map(u => u.user_id)).toEqual(before)
  })
})

// The spoofed roster is what the layout was built against, so it has to keep producing the
// cases the panel exists to show. A generator that quietly drifted to "everyone is busy and
// signed in" would leave the empty and dormant states untested by eye ever again.
describe('the dev roster', () => {
  const users = makeFakeUsers(150)

  it('is the size asked for and stable across calls', () => {
    expect(users).toHaveLength(150)
    expect(makeFakeUsers(150).map(u => u.username)).toEqual(users.map(u => u.username))
  })

  it('carries every state the panel branches on', () => {
    expect(users.some(u => u.is_deleted)).toBe(true)
    expect(users.some(u => u.roles.length > 0)).toBe(true)
    expect(users.some(u => u.events === 0)).toBe(true)
    expect(users.some(u => u.favorite_team === null)).toBe(true)
    expect(users.some(u => userIsReachable(u))).toBe(true)
    expect(users.some(u => userLeague(u) === 'both')).toBe(true)
    expect(users.some(u => u.predictions)).toBe(true)
  })

  it('holds no real address', () => {
    expect(users.every(u => u.email?.endsWith('@example.dev'))).toBe(true)
  })
})

describe("a pick'em id, read back", () => {
  it('names the round and the leg', () => {
    expect(prettyPick('pickem:2026:semifinal:A')).toBe('Semifinal A')
    expect(prettyPick('pickem:2026:championship')).toBe('Championship')
  })

  // The ids are permanent because renaming one orphans every answer stored under it, so this
  // has to survive meeting a shape it was not written for rather than rendering an empty cell.
  it('prints an id it does not recognise rather than nothing', () => {
    expect(prettyPick('nonsense')).toBe('Nonsense')
    expect(prettyPick('')).toBe('')
  })
})

// The spoofed detail is DERIVED from the spoofed roster row, and that is the property worth
// pinning: a generator that invented both halves separately would look completely fine on
// screen while hiding the one bug this data exists to catch, which is the sheet disagreeing
// with the table it was opened from.
describe('the dev detail agrees with the dev row', () => {
  const users = makeFakeUsers(150)
  const busy = users.filter(u => u.events > 50 && !u.is_deleted)

  it('has somebody busy to test with', () => {
    expect(busy.length).toBeGreaterThan(0)
  })

  it("spends exactly the row's events across the row's active days", () => {
    for (const u of busy.slice(0, 20)) {
      const d = makeFakeDetail(u, 30)
      expect(d.events_window).toBe(u.events)
      expect(d.active_days).toBe(u.active_days)
      expect(d.series.reduce((n, s) => n + s.events, 0)).toBe(u.events)
    }
  })

  it('draws one bar per day of the window and no negative days', () => {
    const d = makeFakeDetail(busy[0], 30)
    expect(d.series).toHaveLength(30)
    expect(d.series.every(s => s.events >= 0)).toBe(true)
  })

  it('is stable for the same account', () => {
    const a = makeFakeDetail(busy[0], 30)
    const b = makeFakeDetail(busy[0], 30)
    expect(a.actions.map(x => x.event)).toEqual(b.actions.map(x => x.event))
  })

  it('gives a dormant account an empty sheet rather than invented activity', () => {
    const quiet = users.find(u => u.events === 0)!
    const d = makeFakeDetail(quiet, 30)
    expect(d.events_window).toBe(0)
    expect(d.actions).toHaveLength(0)
    expect(d.series.every(s => s.events === 0)).toBe(true)
  })
})

// The named sorts. Every entry has to name a key sortUsers can actually apply, or the option
// renders, is picked, and silently does nothing.
describe('the named sort choices', () => {
  const rows = [
    user({ user_id: 'a', username: 'zoe',   events: 5,   wpbl_events: 5, series_picks: 0, created_at: '2026-08-01T00:00:00Z', last_seen: '2026-09-01T00:00:00Z' }),
    user({ user_id: 'b', username: 'aaron', events: 100, wpbl_events: 90, series_picks: 3, created_at: '2026-07-01T00:00:00Z', last_seen: '2026-09-08T00:00:00Z' }),
    user({ user_id: 'c', username: 'mira',  events: 0,   wpbl_events: 0, series_picks: 1, created_at: '2026-09-01T00:00:00Z', last_seen: null }),
  ]

  it('all apply, and none leaves the list unsorted or short', () => {
    for (const c of SORT_CHOICES) {
      const out = sortUsers(rows, c.key, c.desc)
      expect(out).toHaveLength(rows.length)
      expect(new Set(out.map(u => u.user_id)).size).toBe(rows.length)
    }
  })

  it('has unique ids and no duplicate orders', () => {
    expect(new Set(SORT_CHOICES.map(c => c.id)).size).toBe(SORT_CHOICES.length)
    expect(new Set(SORT_CHOICES.map(c => `${c.key}:${c.desc}`)).size).toBe(SORT_CHOICES.length)
  })

  it('orders the ones a reader would check by hand', () => {
    const by = (id: string) => {
      const c = SORT_CHOICES.find(x => x.id === id)!
      return sortUsers(rows, c.key, c.desc).map(u => u.user_id)
    }
    expect(by('active')[0]).toBe('b')     // most events
    expect(by('recent')[0]).toBe('b')     // seen most recently
    expect(by('away')[0]).toBe('c')       // never seen at all
    expect(by('newest')[0]).toBe('c')     // joined last
    expect(by('oldest')[0]).toBe('b')     // joined first
    expect(by('wpbl')[0]).toBe('b')
    expect(by('series')[0]).toBe('b')
  })
})
