import { describe, it, expect } from 'vitest'
import { mergeBulkLines } from '../api'
import type { WpblBattingLine, WpblPitchingLine, WpblLinesResult } from '../types'

// The last-good rule for the league-wide box-score read, which holds TWO arrays fetched in
// parallel. Everything here is about one asymmetry: a single-array cache can read "empty means
// the read failed", and a two-array one cannot, because the halves fail independently.
//
// The shipped version asked "cache the pair unless BOTH came back empty", so a run where only
// the batting read came up short cached a league with no batting. Nothing errored. The Team
// stats card said a 13-game club had not played, and the spec chart drew four confident 50s
// beside four correct pitching numbers.

const b = (id: string) => ({ id } as unknown as WpblBattingLine)
const p = (id: string) => ({ id } as unknown as WpblPitchingLine)
const prev: WpblLinesResult = { batting: [b('b1'), b('b2')], pitching: [p('p1')] }
const ids = (r: WpblLinesResult) => ({ batting: r.batting.map(x => x.id), pitching: r.pitching.map(x => x.id) })

describe('mergeBulkLines', () => {
  it('takes a complete fresh read whole', () => {
    const fresh: WpblLinesResult = { batting: [b('b9')], pitching: [p('p9')] }
    const { data, complete } = mergeBulkLines(fresh, prev)
    expect(ids(data)).toEqual({ batting: ['b9'], pitching: ['p9'] })
    expect(complete).toBe(true)
  })

  // The bug. One half failing must not take the other half's good data with it.
  it('keeps last-good for the half that came back empty', () => {
    const { data, complete } = mergeBulkLines({ batting: [], pitching: [p('p9')] }, prev)
    expect(ids(data)).toEqual({ batting: ['b1', 'b2'], pitching: ['p9'] })
    expect(complete).toBe(false)
  })

  it('works the same way round', () => {
    const { data, complete } = mergeBulkLines({ batting: [b('b9')], pitching: [] }, prev)
    expect(ids(data)).toEqual({ batting: ['b9'], pitching: ['p1'] })
    expect(complete).toBe(false)
  })

  it('keeps both halves when the whole read fails', () => {
    const { data, complete } = mergeBulkLines({ batting: [], pitching: [] }, prev)
    expect(ids(data)).toEqual(ids(prev))
    expect(complete).toBe(false)
  })

  // Pre-migration, or a league that has genuinely played nothing. Seeding an empty result is
  // what lets every caller stop spinning; refusing to would hang the section on rows that do
  // not exist yet.
  it('seeds an empty league when there is no cache to protect', () => {
    const empty: WpblLinesResult = { batting: [], pitching: [] }
    const { data, complete } = mergeBulkLines(empty, null)
    expect(ids(data)).toEqual({ batting: [], pitching: [] })
    // Still not "complete": the caller leaves the clock alone only when it has a cache, and
    // with none it seeds regardless. Stated here so the flag's meaning stays "both reads
    // returned rows" rather than drifting into "it is safe to cache".
    expect(complete).toBe(false)
  })

  it('does not mutate the previous result', () => {
    const before = ids(prev)
    mergeBulkLines({ batting: [], pitching: [p('p9')] }, prev)
    expect(ids(prev)).toEqual(before)
  })
})
