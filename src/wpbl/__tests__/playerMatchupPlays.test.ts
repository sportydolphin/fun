import { describe, it, expect, vi } from 'vitest'

// `fetchWpblPlayerMatchupPlays` filters the mirror on the player's ids, and the corrections
// overlay can move an at-bat onto or off her AFTER that filter has run. Both directions are
// pinned here against a fake PostgREST that answers the query shapes the reads make. The league
// boards read one play log (fetchWpblPlayLog) and filter it in memory, pinned below too.

interface Row {
  game_id: string; sequence: number
  batter_id: string | null; batter_name: string | null
  pitcher_id: string | null; pitcher_name: string | null
  event_type: string | null; narrative: string | null
  pitch_sequence?: string | null; date?: string
}

// Stand-ins for the uuids the play columns hold. The fake below rejects anything else in the
// filter exactly as Postgres does, because that rejection is how this read first shipped broken.
const HER = '00000000-0000-4000-8000-000000000001'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const row = (sequence: number, batter_id: string, pitcher_id: string, event_type = 'single'): Row => ({
  game_id: 'g1', sequence, batter_id, batter_name: batter_id, pitcher_id, pitcher_name: pitcher_id,
  event_type, narrative: null,
})

const db: { games: unknown[]; plays: Row[]; corrections: { game_id: string; sequence: number; field: string; new_value: string | null; source: null }[] } = {
  games: [],
  plays: [],
  corrections: [],
}
const queries: string[] = []

function builder(table: string) {
  const q: {
    select?: string; or?: string; eq?: [string, string]; in?: [string, (string | number)[]]
    gte?: [string, string]; lt?: [string, string]; range?: [number, number]
  } = {}
  const run = () => {
    if (table === 'wpbl_play_corrections') return db.corrections
    if (table === 'wpbl_games') return db.games
    if (q.or) {
      queries.push(`or:${q.or}`)
      const ids = new Set(/batter_id\.in\.\(([^)]*)\)/.exec(q.or)![1].split(','))
      if ([...ids].some(id => !UUID.test(id))) throw new Error('22P02: invalid input syntax for type uuid')
      const hit = db.plays.filter(p => ids.has(p.batter_id ?? '') || ids.has(p.pitcher_id ?? ''))
      return q.range ? hit.slice(q.range[0], q.range[1] + 1) : hit
    }
    // The league play log: every row, or one season's through the embedded join on the games.
    if (!q.eq) {
      const scoped = !!q.gte
      // Once per READ, on its first page: the pages after it are the same read.
      if (!q.range || q.range[0] === 0) {
        queries.push(scoped ? `log:${q.gte![1]}..${q.lt![1]}:${q.select!.includes('wpbl_games!inner()')}` : 'log:all')
      }
      const hit = db.plays.filter(p => !scoped || ((p.date ?? '2026-06-01') >= q.gte![1] && (p.date ?? '2026-06-01') < q.lt![1]))
      return q.range ? hit.slice(q.range[0], q.range[1] + 1) : hit
    }
    queries.push(`eq:${q.eq![1]}:${q.in![1].join(',')}`)
    return db.plays.filter(p => p.game_id === q.eq![1] && q.in![1].includes(p.sequence))
  }
  const b = {
    select: (cols: string) => { q.select = cols; return b },
    gte: (c: string, v: string) => { q.gte = [c, v]; return b },
    lt: (c: string, v: string) => { q.lt = [c, v]; return b },
    order: () => b,
    or: (f: string) => { q.or = f; return b },
    eq: (c: string, v: string) => { q.eq = [c, v]; return b },
    in: (c: string, v: (string | number)[]) => { q.in = [c, v]; return b },
    range: (from: number, to: number) => { q.range = [from, to]; return b },
    then: (res: (v: { data: unknown; error: null }) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve({ data: run(), error: null }).then(res, rej),
  }
  return b
}

vi.mock('../../lib/supabase', () => ({ supabase: { from: (t: string) => builder(t) } }))

const {
  fetchWpblPlayerMatchupPlays, fetchWpblAllMatchupPlays, fetchWpblAllPitchPlays, fetchWpblBattedBalls,
  fetchWpblPlayLog, fetchWpblSchedule,
} = await import('../api')

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

describe('the league play log', () => {
  // One read, and the corrections run over all of it BEFORE any board filters it, so a correction
  // that turns a non-plate-appearance into one needs no second fetch.
  it('keeps plate appearances, drops the rest, and counts a row a correction makes one', async () => {
    db.plays = [
      row(1, HER, 'p1', 'single'),
      row(2, HER, 'p1', 'stolen_base'),  // corrected to a double
      row(3, HER, 'p1', 'pickoff'),      // stays out
      row(4, HER, 'p1', 'groundout'),
    ]
    db.corrections = [{ game_id: 'g1', sequence: 2, field: 'event_type', new_value: 'double', source: null }]
    queries.length = 0
    const got = await fetchWpblAllMatchupPlays()
    expect(got.map(p => [p.sequence, p.event_type]).sort()).toEqual([
      [1, 'single'], [2, 'double'], [4, 'groundout'],
    ])
    expect(queries).toEqual(['log:all'])  // and nothing fetched by key
  })

  // The whole point of the change: the boards that used to make a read each share one.
  it('serves every league board from a single read', async () => {
    db.plays = [
      { ...row(1, HER, 'p1', 'single'), pitch_sequence: 'BCX', date: '2026-07-01' },
      { ...row(2, HER, 'p1', 'stolen_base'), pitch_sequence: null, date: '2026-07-01' },
      { ...row(3, HER, 'p1', 'flyout'), pitch_sequence: 'X', date: '2026-07-01' },
    ]
    db.corrections = []
    queries.length = 0
    const [pitches, balls, pas] = await Promise.all([
      fetchWpblAllPitchPlays(2026), fetchWpblBattedBalls(2026), fetchWpblAllMatchupPlays(2026),
    ])
    expect(pitches.map(p => p.sequence)).toEqual([1, 3])
    expect(balls.map(p => p.sequence)).toEqual([1, 3])
    expect(pas.map(p => p.sequence)).toEqual([1, 3])
    expect(queries).toEqual(['log:2026-01-01..2027-01-01:true'])
    // And the same array to every caller, so a derivation cached on it keeps hitting.
    expect(await fetchWpblAllPitchPlays(2026)).toBe(pitches)
  })

  // A season read asks the database for that year only, through the join on the game's date.
  it('filters one season at the database', async () => {
    db.plays = [
      { ...row(1, HER, 'p1'), date: '2026-08-01' },
      { ...row(2, HER, 'p1'), date: '2027-05-01' },
    ]
    db.corrections = []
    queries.length = 0
    expect((await fetchWpblPlayLog(2027)).map(p => p.sequence)).toEqual([2])
    expect(queries).toEqual(['log:2027-01-01..2028-01-01:true'])
  })

  // While the league has played one season, "this season" and "every season" are the same rows.
  // Home reads the first and Game Center's win model the second; neither may download them again.
  it('cuts a season out of every season, and puts every season together from its seasons', async () => {
    vi.setSystemTime(Date.now() + 10 * 60_000)  // past every cache above
    db.games = [{
      id: 'g1', game_date: '2031-07-01', status: 'final', start_time: '6:00 PM',
      home_team_id: 'NY', away_team_id: 'LA', api_game_id: 'a1',
    }]
    db.plays = [{ ...row(1, HER, 'p1'), date: '2031-07-01' }, { ...row(2, HER, 'p1', 'flyout'), date: '2031-07-01' }]
    db.corrections = []
    await fetchWpblSchedule()

    queries.length = 0
    const season = await fetchWpblPlayLog(2031)
    const every = await fetchWpblPlayLog(null)
    expect(every).toBe(season)
    expect(queries).toEqual(['log:2031-01-01..2032-01-01:true'])

    vi.setSystemTime(Date.now() + 10 * 60_000)
    queries.length = 0
    const all = await fetchWpblPlayLog(null)
    expect(all.map(p => p.sequence)).toEqual([1, 2])
    expect(queries).toEqual(['log:all'])
    expect(await fetchWpblPlayLog(2031)).toEqual(all)
    expect(queries).toEqual(['log:all'])
    vi.useRealTimers()
  })
})
