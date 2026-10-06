import { describe, it, expect } from 'vitest'
import { homeLandingReadsLines } from '../Home'
import { AWARDS_RESULTS_UNTIL } from '../awards'

// The warm-up's guess at whether a Home landing will draw from the season's box-score lines.
// Wrong in the "true" direction costs the ~73KB gzipped read this exists to skip; wrong in the
// "false" direction costs only a head start, since Home fetches for itself from the real schedule.

describe('homeLandingReadsLines', () => {
  it('reads them during the season', () => {
    expect(homeLandingReadsLines(Date.parse('2026-08-15T18:00:00Z'))).toBe(true)
  })

  it('still reads them after the final while the award results are on Home', () => {
    expect(homeLandingReadsLines(Date.parse(AWARDS_RESULTS_UNTIL) - 3600_000)).toBe(true)
  })

  it('skips them once the results come off the offseason Home', () => {
    expect(homeLandingReadsLines(Date.parse(AWARDS_RESULTS_UNTIL) + 3600_000)).toBe(false)
  })
})
