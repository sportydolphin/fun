import { describe, it, expect } from 'vitest'
import {
  passwordProblem, passwordChecklist, passwordBytes, PASSWORD_MIN, PASSWORD_MAX,
} from '../lib/passwordPolicy'

// The policy is deliberately not the familiar one, so these pin BOTH directions: what it
// refuses, and what it must keep accepting. The second half matters more. A rule that rejects
// a good passphrase is a rule people work around, and working around it is how everyone ends
// up with the same handful of shapes.

describe('length', () => {
  it('refuses anything under the minimum', () => {
    expect(passwordProblem('short1')).toMatch(/at least 8/)
    expect(passwordProblem('a'.repeat(PASSWORD_MIN - 1))).toBeTruthy()
  })

  // bcrypt reads 72 bytes and no more. Past that a password is silently its own prefix, so the
  // limit is stated rather than discovered.
  it('refuses what bcrypt would quietly truncate', () => {
    // Not a repeated character, which would trip the straight-run rule before the length one.
    const long = 'a quiet tuesday in april with the windows open and nothing much happening yet'
    expect(passwordProblem(long.slice(0, PASSWORD_MAX))).toBeNull()
    expect(passwordProblem(long.slice(0, PASSWORD_MAX + 1))).toMatch(/too long/)
  })

  it('counts the limit in bytes, because that is what bcrypt counts', () => {
    expect(passwordBytes('é')).toBe(2)
    expect(passwordBytes('🐬')).toBe(4)
    // 20 dolphins is 80 bytes and only 20 characters.
    expect(passwordProblem('🐬'.repeat(20))).toMatch(/too long/)
  })
})

describe('what it refuses', () => {
  it('refuses the passwords guessed first', () => {
    for (const pw of ['password', 'baseball', 'iloveyou', 'qwertyuiop', 'sportydolphin']) {
      expect(passwordProblem(pw.padEnd(PASSWORD_MIN, 'x'))).toBeTruthy()
    }
  })

  // The whole point of the blocklist. These are exactly what composition rules produce, they
  // satisfy every classic rule, and every cracking tool generates them from a plain wordlist.
  it('sees through the decoration that composition rules train people to add', () => {
    expect(passwordProblem('Password1!')).toMatch(/commonly used/)
    expect(passwordProblem('p@ssw0rd')).toMatch(/commonly used/)
    expect(passwordProblem('Baseball2026')).toMatch(/commonly used/)
    expect(passwordProblem('LetMeIn123')).toMatch(/commonly used/)
  })

  it('refuses a straight run of characters', () => {
    expect(passwordProblem('aaaaaaaaaa')).toMatch(/straight run/)
    expect(passwordProblem('abcdefghij')).toMatch(/straight run/)
    expect(passwordProblem('9876543210')).toMatch(/straight run/)
  })

  // An address and a username are both public, so a password built from one is already half
  // known to anyone who has seen a leaderboard.
  it('refuses a password built from the account it protects', () => {
    const ctx = { email: 'jo.smith@example.com', username: 'slugger42' }
    expect(passwordProblem('smith-in-the-park', ctx)).toMatch(/email address or username/)
    expect(passwordProblem('my-slugger42-pw', ctx)).toMatch(/email address or username/)
    // The domain too: `example` is not a secret to anyone who knows the address.
    expect(passwordProblem('example-things-here', ctx)).toMatch(/email address or username/)
  })

  it('ignores context fragments too short to mean anything', () => {
    // `jo` appears inside plenty of good passwords by chance, so a two-letter local part must
    // not blocklist a syllable.
    expect(passwordProblem('enjoying the quiet', { email: 'jo@example.org' })).toBeNull()
  })
})

describe('what it must keep accepting', () => {
  // The canonical example of a strong password that classic composition rules reject outright:
  // no capital, no digit, no symbol, and vastly stronger than anything that satisfies them.
  it('accepts a passphrase with no capital, digit or symbol', () => {
    expect(passwordProblem('correct horse battery staple')).toBeNull()
  })

  it('accepts spaces, unicode and emoji', () => {
    expect(passwordProblem('a quiet tuesday in april')).toBeNull()
    expect(passwordProblem('mañana por la mañana')).toBeNull()
    expect(passwordProblem('🐬 swims at dawn')).toBeNull()
  })

  it('accepts a common word that is only part of a longer password', () => {
    // The blocklist is about a password BEING one of these, not containing one. Otherwise
    // every phrase with an ordinary word in it gets refused.
    expect(passwordProblem('the password thief cometh')).toBeNull()
  })
})

describe('the checklist under the field', () => {
  it('reads as instructions before anything is typed', () => {
    const list = passwordChecklist('')
    expect(list.every(c => !c.ok)).toBe(true)
    expect(list[0].label).toMatch(/8 characters/)
  })

  it('only mentions email and username when there are some', () => {
    expect(passwordChecklist('a quiet tuesday')).toHaveLength(2)
    expect(passwordChecklist('a quiet tuesday', { email: 'jo.smith@example.com' })).toHaveLength(3)
  })

  it('turns every item true for an acceptable password', () => {
    const list = passwordChecklist('a quiet tuesday in april', { email: 'jo.smith@example.com', username: 'slugger42' })
    expect(list.every(c => c.ok)).toBe(true)
  })

  // The list and the submit-time message have to agree, or the button refuses while every line
  // above it shows a tick.
  it('agrees with passwordProblem', () => {
    const ctx = { email: 'jo.smith@example.com', username: 'slugger42' }
    for (const pw of ['', 'short', 'Password1!', 'abcdefghij', 'smith-in-the-park', 'a quiet tuesday in april']) {
      const listOk = passwordChecklist(pw, ctx).every(c => c.ok)
      expect(listOk).toBe(passwordProblem(pw, ctx) === null)
    }
  })
})
