import { describe, it, expect, vi } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

// Every play and every TrackMan row leaves the api in the roster's spelling (`inRosterSpelling` in
// feedNames.ts), so no surface has to correct a name itself. Until Oct 21, 2026 each one did, and
// two sweeps in one day found five that forgot. Two halves pin it: the reads really do spell
// (against a fake PostgREST holding the feed's spellings), and nothing reads those tables, or
// patches a name on screen, anywhere the reads cannot reach.

const ROSTER = [
  { id: 'saiki', name: 'Emi Saiki' },
  { id: 'villarreal', name: 'Isabella Villarreal' },
  { id: 'foxx', name: 'Maggie Foxx' },
  { id: 'leblanc', name: 'Andréanne Leblanc' },
]
/** The feed's spellings of the four above. None may reach a surface. */
const FEED = /\bEmi Saki\b|\bSaki, Emi\b|Villareal|\bMaggie Fox\b|\bFox, Maggie\b|Andreanne/

const HER = '00000000-0000-4000-8000-000000000001'
const PLAY = {
  game_id: 'g1', sequence: 1, inning: 1, half: 'top', team_id: 't1', outs: 0,
  batter_id: HER, batter_name: 'Emi Saki', pitcher_id: 'foxx', pitcher_name: 'Maggie Fox',
  first_base: 'Isabella Villareal', second_base: '', third_base: '', event_type: 'single', runs_scored: 0,
  is_hit: true, pitch_sequence: 'BX',
  narrative: 'Emi Saki singled to left field (1-0); Isabella Villareal advanced to second.',
}
// A capitalized word in front of the name hides it from the pass over capitalized runs; the
// fields the row carries are what catch it.
const SUB = {
  ...PLAY, sequence: 2, event_type: 'substitution', first_base: '',
  narrative: 'Pinch-hitter Emi Saki replaces Andreanne Leblanc.',
}
const TRACK = {
  activity_id: 'a1', game_id: 'g1', kind: 'pitch', release_speed: 70, spin_rate_rpm: 2000, play_id: 'p1',
  sequence: 1, occurred_at: '2026-07-01T00:00:00Z',
  pitcher_id: 'feed-1', pitcher_name: 'Saki, Emi', batter_id: 'feed-2', batter_name: 'Fox, Maggie',
  raw: { pitcher_name: 'Saki, Emi', batter_name: 'Fox, Maggie', pitcher_id: 'feed-1' },
}
// Somebody the roster has never heard of keeps the feed's own spelling and shape.
const STRANGER = { ...TRACK, activity_id: 'a2', pitcher_name: 'Doe, Jane', raw: { ...TRACK.raw, pitcher_name: 'Doe, Jane' } }

const tables: Record<string, unknown[]> = {
  wpbl_players: ROSTER,
  wpbl_game_plays: [PLAY, SUB],
  wpbl_play_corrections: [],
  wpbl_games: [],
  wpbl_pitch_tracking: [TRACK, STRANGER],
}
// TrackMan's names live in `raw`; the league-wide read projects them to the top (`raw->>`), and a
// game's read takes the row whole.
const asRead = (table: string, select: string) => (row: unknown) => {
  if (table !== 'wpbl_pitch_tracking') return row
  const { raw, pitcher_name, batter_name, ...rest } = row as typeof TRACK
  return select === '*' ? { ...rest, raw } : { ...rest, pitcher_name, batter_name }
}
function builder(table: string) {
  let range: [number, number] | null = null
  let select = '*'
  const b: Record<string, unknown> = {}
  for (const m of ['eq', 'in', 'or', 'gte', 'lt', 'order', 'limit']) b[m] = () => b
  b.select = (cols: string) => { select = cols; return b }
  b.range = (from: number, to: number) => { range = [from, to]; return b }
  b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
    const rows = (tables[table] ?? []).map(asRead(table, select))
    return Promise.resolve({ data: range ? rows.slice(range[0], range[1] + 1) : rows, error: null }).then(res, rej)
  }
  return b
}
vi.mock('../../lib/supabase', () => ({ supabase: { from: (t: string) => builder(t) } }))

const api = await import('../api')

/** Every read that hands a surface a name. A new one goes here, or the static check below fails
 *  it for not spelling. */
const READS: Record<string, () => Promise<unknown>> = {
  fetchWpblPlayLog: () => api.fetchWpblPlayLog(),
  fetchWpblPlayerMatchupPlays: () => api.fetchWpblPlayerMatchupPlays({ id: HER, api_id: null, api_ids: [] }),
  fetchWpblGamePlays: () => api.fetchWpblGamePlays('g1'),
  fetchWpblGameRecapPlays: () => api.fetchWpblGameRecapPlays('g1'),
  fetchWpblAllTracking: () => api.fetchWpblAllTracking(),
  fetchWpblGameTracking: () => api.fetchWpblGameTracking('g1'),
}

describe('the reads spell every name the roster way', () => {
  for (const [name, read] of Object.entries(READS)) {
    it(name, async () => {
      const text = JSON.stringify(await read())
      expect(text).not.toMatch(FEED)
      expect(text).toMatch(/Emi Saiki/)
    })
  }

  it('keeps the fields and the prose in step', async () => {
    const [play, sub] = await api.fetchWpblGamePlays('g1')
    expect(play.batter_name).toBe('Emi Saiki')
    expect(play.pitcher_name).toBe('Maggie Foxx')
    expect(play.first_base).toBe('Isabella Villarreal')
    expect(play.narrative).toBe('Emi Saiki singled to left field (1-0); Isabella Villarreal advanced to second.')
    expect(sub.narrative).toBe('Pinch-hitter Emi Saiki replaces Andréanne Leblanc.')
  })

  it('leaves a name the roster does not know exactly as the feed sent it', async () => {
    const rows = await api.fetchWpblGameTracking('g1')
    expect((rows[1].raw as { pitcher_name: string }).pitcher_name).toBe('Doe, Jane')
  })
})

// ─── Static: nothing goes around the reads ─────────────────────────────────────

const ROOT = join(__dirname, '..', '..')
const files = (dir: string): string[] => readdirSync(dir).flatMap(f => {
  const p = join(dir, f)
  if (statSync(p).isDirectory()) return f === '__tests__' ? [] : files(p)
  return /\.(ts|tsx)$/.test(f) ? [p] : []
})
const src = files(ROOT).map(p => ({ path: relative(ROOT, p).replace(/\\/g, '/'), text: readFileSync(p, 'utf8') }))

const NAMED_TABLES = /from\('(wpbl_game_plays|wpbl_pitch_tracking)'\)/

/** Functions in the api that read those tables and hand over no name, or hand it to a caller
 *  that spells it. Each says which. */
const NO_NAMES: Record<string, string> = {
  fetchMatchupPlaysByKey: 'its one caller, fetchWpblPlayerMatchupPlays, spells what it returns',
  fetchWpblTrackedGameIds: 'game ids only',
  readWpblPitcherLocations: 'pitch locations only',
}
/** What spelling looks like inside a read. */
const SPELLED = /inRosterSpelling\(|trackSpeller\(/

describe('no surface goes around the reads', () => {
  it('reads plays and tracking only in the api', () => {
    const outside = src.filter(f => !f.path.startsWith('wpbl/api/') && NAMED_TABLES.test(f.text)).map(f => f.path)
    expect(outside).toEqual([])
  })

  it('spells every api read that hands over a name', () => {
    const unspelled: string[] = []
    for (const f of src.filter(f => f.path.startsWith('wpbl/api/'))) {
      // Top-level declarations, each up to the next one.
      const chunks = f.text.split(/\n(?=(?:export )?(?:async )?function |export const |const |let )/)
      for (const chunk of chunks) {
        if (!NAMED_TABLES.test(chunk)) continue
        const name = /function (\w+)/.exec(chunk)?.[1] ?? chunk.slice(0, 40)
        if (NO_NAMES[name] || SPELLED.test(chunk)) continue
        unspelled.push(`${f.path}: ${name}`)
      }
    }
    expect(unspelled).toEqual([])
  })

  // The one place left that corrects a name on screen is the LIVE SITUATION (`live_state` on the
  // game row: the batter, the pitcher and the runners on base right now), which is not a play.
  it('corrects no play name on screen', () => {
    const LIVE_STATE = new Set(['wpbl/Live.tsx', 'wpbl/LiveGameView.tsx', 'wpbl/discordLiveBox.ts'])
    const patching = src
      .filter(f => f.path.startsWith('wpbl/') && !f.path.startsWith('wpbl/api/') && f.path !== 'wpbl/feedNames.ts')
      .filter(f => /\b(canonicalFeedName|rosterSpellingsIn|inRosterSpelling|rosterSpeller)\b/.test(f.text))
      .filter(f => !LIVE_STATE.has(f.path))
      .map(f => f.path)
    expect(patching).toEqual([])
  })
})
