import { describe, it, expect } from 'vitest'
import { containsProfanity, normalizeForProfanity } from '../lib/profanity'
import { usernameValidationMsg } from '../lib/usernames'

// The filter is a client-side courtesy on public display names, not a security boundary (see
// lib/profanity.ts). What is worth pinning is the two ways it fails in practice: letting an obvious
// evasion through, and rejecting an innocent name for containing a fragment (the Scunthorpe trap).

describe('the profanity filter', () => {
  it('catches a plain banned word anywhere in the string', () => {
    expect(containsProfanity('shithead22')).toBe(true)
    expect(containsProfanity('xXfaggotXx')).toBe(true)
  })

  it('folds the usual evasions: leet, separators, and stretched letters', () => {
    expect(containsProfanity('sh1t')).toBe(true)
    expect(containsProfanity('f_u_c_k')).toBe(true)
    expect(containsProfanity('b!tch')).toBe(true)
    expect(containsProfanity('fuuuuck')).toBe(true)
    expect(normalizeForProfanity('F.U.C.K')).toBe('fuck')
  })

  it('does not reject innocent names that merely contain a short fragment', () => {
    // The words the list deliberately does NOT ban a fragment of.
    for (const ok of ['classic', 'bassist', 'assassin', 'raccoon', 'tycoon', 'peacock', 'hancock']) {
      expect(containsProfanity(ok), ok).toBe(false)
    }
  })

  // Letting each letter repeat must not fold a doubled letter away: a slur's double is what keeps
  // an innocent single-letter word clear.
  it('keeps a benign word that differs from a slur only by a doubled letter', () => {
    expect(containsProfanity('nigeria')).toBe(false)   // vs the double-g slur
    expect(containsProfanity('faggot')).toBe(true)     // the slur itself still caught
  })

  it('passes a clean username and blocks a profane one, with a neutral message', () => {
    expect(usernameValidationMsg('SluggerRocket482')).toBeNull()
    expect(usernameValidationMsg('sh1t_lord')).toBe('Please choose a different name')
  })
})
