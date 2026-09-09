import { describe, it, expect } from 'vitest'
// The job imported rather than reimplemented, the rule the other two script tests follow.
import { pollMessage, resolveVotes } from '../../scripts/sync-wpbl-discord-awards'
import { awardById } from '../wpbl/awards'
import type { AwardCandidate } from '../wpbl/derive/awards'

const options = [
  { emoji: '1️⃣', key: 'p-whitmore', name: 'Kelsie Whitmore', team: 'SF' },
  { emoji: '2️⃣', key: 'p-benites', name: 'Denae Benites', team: 'NY' },
]

describe('the message', () => {
  const candidates = [
    {
      key: 'p-whitmore', name: 'Kelsie Whitmore', teamId: 'SF', playerId: 'p-whitmore', line: '',
      stats: [{ label: 'AVG', value: '.451' }, { label: 'HR', value: '11' }, { label: 'OPS', value: '1.669' }],
    },
    { key: 'p-benites', name: 'Denae Benites', teamId: 'NY', playerId: 'p-benites', line: '', stats: [] },
  ] as AwardCandidate[]

  it('numbers the names and carries the same figures the tile does', () => {
    const text = pollMessage(awardById('mvp')!, options, candidates)
    expect(text).toContain('1️⃣  **Kelsie Whitmore** (SF) · .451 AVG · 11 HR · 1.669 OPS')
    // A candidate with no figures is still a candidate, and the line must not end in a dangling
    // separator.
    expect(text).toContain('2️⃣  **Denae Benites** (NY)\n')
  })

  it('says the deadline and points at the site', () => {
    const text = pollMessage(awardById('mvp')!, options, candidates)
    expect(text).toContain('Sep 16')
    expect(text).toContain('/wpbl/awards')
  })

  // House rule, and this is copy a reader sees.
  it('writes no em dashes', () => {
    expect(pollMessage(awardById('mvp')!, options, candidates)).not.toMatch(/—/)
  })
})

describe('what the reactions mean', () => {
  const recorded = new Map<string, string>()

  it('casts a single reaction, and only when it differs from what is recorded', () => {
    const out = resolveVotes({
      options,
      reactions: new Map([['1️⃣', ['u1', 'u2']], ['2️⃣', ['u3']]]),
      recorded: new Map([['discord:u2', 'p-whitmore']]),
    })
    expect(out.cast).toEqual([
      { voterKey: 'discord:u1', choice: 'p-whitmore' },
      { voterKey: 'discord:u3', choice: 'p-benites' },
    ])
    // u2 already had that answer stored, so a run over an unchanged channel calls nothing.
    expect(out.cast.some(c => c.voterKey === 'discord:u2')).toBe(false)
  })

  // Discord cannot refuse the second reaction, so the arithmetic has to. Counting either one
  // would be choosing for the reader; counting both would give one person two votes.
  it('counts a reader holding two reactions as nothing, and leaves their old vote alone', () => {
    const out = resolveVotes({
      options,
      reactions: new Map([['1️⃣', ['u1']], ['2️⃣', ['u1']]]),
      recorded: new Map([['discord:u1', 'p-benites']]),
    })
    expect(out.cast).toEqual([])
    expect(out.clear).toEqual([])
    expect(out.ambiguous).toBe(1)
  })

  it('withdraws the vote of somebody who took every reaction off', () => {
    const out = resolveVotes({
      options,
      reactions: new Map([['1️⃣', []], ['2️⃣', []]]),
      recorded: new Map([['discord:u9', 'p-whitmore']]),
    })
    expect(out.clear).toEqual(['discord:u9'])
    expect(out.cast).toEqual([])
  })

  it('keys the voter on the Discord id, which is what stops a second site vote overwriting it', () => {
    const out = resolveVotes({ options, reactions: new Map([['1️⃣', ['123']]]), recorded })
    expect(out.cast[0].voterKey).toBe('discord:123')
  })
})
