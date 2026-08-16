import { describe, it, expect } from 'vitest'
import { normName, isDamaged, replacementMatch, editDistance } from '../../../supabase/functions/wpbl-ingest/names'

// Player-name reconciliation for the WPBL ingest. The module under test lives with the
// Supabase edge function (which only Deno can load, so it can't be imported here), but the
// matching rules themselves are plain string logic — and they have already cost real data:
// in August 2026 a bad decode upstream forked duplicate roster rows for the two players
// whose names carry an accent.

// What a UTF-8 decoder produces from the feed when the bytes for one accented letter
// arrive damaged: one replacement character per unreadable byte, so two for "ï".
const damage = (name: string, letter: string) => name.replace(letter, '��')

describe('normName', () => {
  it('strips accents and case so the feed spelling matches the roster', () => {
    expect(normName('Maïka Dumais')).toBe('maika dumais')
    expect(normName('Ela Day-Bédard')).toBe('ela day-bedard')
  })

  it('collapses a run of replacement characters to one, however many bytes were lost', () => {
    expect(normName(damage('Maïka Dumais', 'ï'))).toBe('ma�ka dumais')
    expect(normName('Ma���ka Dumais')).toBe('ma�ka dumais')
  })

  it('reports damage only when the name actually carries it', () => {
    expect(isDamaged(normName('Maïka Dumais'))).toBe(false)
    expect(isDamaged(normName(damage('Maïka Dumais', 'ï')))).toBe(true)
  })
})

describe('replacementMatch', () => {
  it('recovers the roster player behind a damaged name', () => {
    expect(replacementMatch(normName(damage('Maïka Dumais', 'ï')), normName('Maïka Dumais'))).toBe(true)
    expect(replacementMatch(normName(damage('Ela Day-Bédard', 'é')), normName('Ela Day-Bédard'))).toBe(true)
  })

  it('will not match two different players', () => {
    // Same team, same first letter, one damaged character — still clearly not them.
    expect(replacementMatch(normName(damage('Maïka Dumais', 'ï')), normName('Maika Dumont'))).toBe(false)
    expect(replacementMatch('ka�e blunt', 'kate bluntson')).toBe(false)
  })

  it('will not match when the damage hid a different number of letters', () => {
    // Length has to line up: one damaged letter, one surviving character on the other side.
    expect(replacementMatch('ma�ka dumais', 'maiika dumais')).toBe(false)
  })

  it('leaves undamaged names to plain equality', () => {
    expect(replacementMatch('maika dumais', 'maika dumais')).toBe(false)
  })
})

describe('editDistance', () => {
  it('still resolves the feed spelling variants it was added for', () => {
    expect(editDistance('villareal', 'villarreal')).toBe(1)
    expect(editDistance('gabriella haas', 'gabrielle haas')).toBe(1)
  })

  it('gives up past the cap instead of merging distant names', () => {
    expect(editDistance('kate blunt', 'katherine blunt')).toBeGreaterThan(1)
  })
})
