import { describe, it, expect, vi } from 'vitest'

// `fetchWpblPlayerMatchupPlays` filters the mirror on the player's ids, and the corrections
// overlay can move an at-bat onto or off her AFTER that filter has run. Both directions are
// pinned here against a fake PostgREST that answers the three query shapes the read makes.

interface Row {
  game_id: string; sequence: number
  batter_id: string | null; batter_name: string | null
  pitcher_id: string | null; pitcher_name: string | null
  event_type: string | null; narrative: string | null
}

// Stand-ins for the uuids the play columns hold. The fake below rejects anything else in the
// filter exactly as Postgres does, because that rejection is how this read first shipped broken.
const HER = '00000000-0000-4000-8000-000000000001'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const row = (sequence: number, batter_id: string, pitcher_id: string, event_type = 'single'): Row => ({
  game_id: 'g1', sequence, batter_id, batter_name: batter_id, pitcher_id, pitcher_name: pitcher_id,
  event_type, narrative: null,
})

const db: { plays: Row[]; corrections: { game_id: string; sequence: number; field: string; new_value: string | null; source: null }[] } = {
  plays: [],
  corrections: [],
}
const queries: string[] = []

function builder(table: string) {
  const q: { or?: string; eq?: [string, string]; in?: [string, number[]]; range?: [number, number] } = {}
  const run = () => {
    if (table === 'wpbl_play_corrections') return db.corrections
    if (q.or) {
      queries.push(`or:${q.or}`)
      const ids = new Set(/batter_id\.in\.\(([^)]*)\)/.exec(q.or)![1].split(','))
      if ([...ids].some(id => !UUID.test(id))) throw new Error('22P02: invalid input syntax for type uuid')
      const hit = db.plays.filter(p => ids.has(p.batter_id ?? '') || ids.has(p.pitcher_id ?? ''))
      return q.range ? hit.slice(q.range[0], q.range[1] + 1) : hit
    }
    queries.push(`eq:${q.eq![1]}:${q.in![1].join(',')}`)
    return db.plays.filter(p => p.game_id === q.eq![1] && q.in![1].includes(p.sequence))
  }
  const b = {
    select: () => b,
    order: () => b,
    or: (f: string) => { q.or = f; return b },
    eq: (c: string, v: string) => { q.eq = [c, v]; return b },
    in: (c: string, v: number[]) => { q.in = [c, v]; return b },
    range: (from: number, to: number) => { q.range = [from, to]; return b },
    then: (res: (v: { data: unknown; error: null }) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve({ data: run(), error: null }).then(res, rej),
  }
  return b
}

vi.mock('../../lib/supabase', () => ({ supabase: { from: (t: string) => builder(t) } }))

const { fetchWpblPlayerMatchupPlays } = await import('../api')

describe('fetchWpblPlayerMatchupPlays', () => {
  it('pulls in an at-bat a correction moved onto her, and drops one it moved off', async () => {
    db.plays = [
      row(1, HER, 'p1'),
      row(2, HER, 'p1', 'home_run'), // corrected to somebody else
      row(3, 'x', 'p1', 'double'),     // corrected to her
      row(4, 'x', 'p1'),               // never hers
    ]
    db.corrections = [
      { game_id: 'g1', sequence: 2, field: 'batter_id', new_value: 'y', source: null },
      { game_id: 'g1', sequence: 3, field: 'batter_id', new_value: HER, source: null },
    ]
    queries.length = 0
    const got = await fetchWpblPlayerMatchupPlays({ id: HER, api_id: null, api_ids: [] })
    expect(got.map(p => [p.sequence, p.batter_id, p.event_type])).toEqual([
      [1, HER, 'single'],
      [3, HER, 'double'],
    ])
    // The moved-on play is fetched by its key, not by a second league-wide read.
    expect(queries).toContain('eq:g1:3')
  })

  // Every player carries feed ids beside her uuid. Sending them made Postgres refuse the whole
  // query, and the tables drew nothing for anybody.
  it('sends only her uuid to the database, whatever feed ids she has held', async () => {
    const TRADED = '00000000-0000-4000-8000-000000000002'
    db.plays = [row(1, TRADED, 'p1'), row(2, 'someone', 'p1')]
    db.corrections = []
    queries.length = 0
    const got = await fetchWpblPlayerMatchupPlays({ id: TRADED, api_id: 'new-feed-id', api_ids: ['old-feed-id', 'new-feed-id'] })
    expect(got.map(p => p.sequence)).toEqual([1])
    expect(queries[0]).toBe(`or:batter_id.in.(${TRADED}),pitcher_id.in.(${TRADED})`)
  })
})
