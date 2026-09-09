import { describe, it, expect } from 'vitest'
// The job imported rather than reimplemented, the rule the other two script tests follow.
import { pollMessage, resolveVotes, askableFromQuestion } from '../../scripts/sync-wpbl-discord-awards'
import { WPBL_DISCORD_QUESTIONS } from '../../scripts/wpbl-discord-questions'
import { awardById, AWARDS_CLOSE_AT } from '../wpbl/awards'
import type { AwardCandidate } from '../wpbl/derive/awards'

const mvp = awardById('mvp')!
const options = [
  { emoji: '1️⃣', key: 'p-whitmore', name: 'Kelsie Whitmore', team: 'SF' },
  { emoji: '2️⃣', key: 'p-benites', name: 'Denae Benites', team: 'NY' },
]
/** A seeded question, as the poster assembles one from the ballot. */
const seeded = {
  id: mvp.id, emoji: mvp.emoji, title: mvp.title, blurb: mvp.blurb,
  closesAt: mvp.closesAt, onSite: true, options,
}

describe('the message', () => {
  const candidates = [
    {
      key: 'p-whitmore', name: 'Kelsie Whitmore', teamId: 'SF', playerId: 'p-whitmore', line: '',
      stats: [{ label: 'AVG', value: '.451' }, { label: 'HR', value: '11' }, { label: 'OPS', value: '1.669' }],
    },
    { key: 'p-benites', name: 'Denae Benites', teamId: 'NY', playerId: 'p-benites', line: '', stats: [] },
  ] as AwardCandidate[]

  it('numbers the names and carries the same figures the tile does', () => {
    const text = pollMessage(seeded, candidates)
    expect(text).toContain('1️⃣  **Kelsie Whitmore** (SF) · .451 AVG · 11 HR · 1.669 OPS')
    // A candidate with no figures is still a candidate, and the line must not end in a dangling
    // separator.
    expect(text).toContain('2️⃣  **Denae Benites** (NY)\n')
  })

  it('says the deadline and points at the site', () => {
    const text = pollMessage(seeded, candidates)
    expect(text).toContain('Sep 16')
    expect(text).toContain('/wpbl/awards')
  })

  // House rule, and this is copy a reader sees.
  it('writes no em dashes', () => {
    expect(pollMessage(seeded, candidates)).not.toMatch(/—/)
  })
})

describe('a question that exists only in the Discord', () => {
  const ask = askableFromQuestion({
    id: 'discord:2026:example',
    emoji: '🎉',
    title: 'Best Celebration',
    blurb: 'The dugout moment you are still doing at home.',
    options: [
      { key: 'bell', label: 'Ringing the bell' },
      { key: 'hats', label: 'The hat toss', note: 'since Aug 12' },
    ],
  }, AWARDS_CLOSE_AT)

  it('numbers the written options and keeps their keys', () => {
    expect(ask.options.map(o => [o.emoji, o.key, o.name]))
      .toEqual([['1️⃣', 'bell', 'Ringing the bell'], ['2️⃣', 'hats', 'The hat toss']])
  })

  it('prints the half-line a written option carries, where a seeded one prints its figures', () => {
    expect(pollMessage(ask)).toContain('2️⃣  **The hat toss** · since Aug 12')
  })

  // The footer is the one thing that must differ: sending a reader to a page that has never
  // heard of this question is worse than saying nothing.
  it('does not send the reader to the site for it', () => {
    const text = pollMessage(ask)
    expect(text).not.toContain('/wpbl/awards')
    expect(text).toContain('asked here and nowhere else')
  })

  it('takes the ballot deadline unless the question sets its own', () => {
    expect(ask.closesAt).toBe(AWARDS_CLOSE_AT)
    const own = askableFromQuestion({
      id: 'discord:2026:other', emoji: '🎈', title: 'Other', options: [{ key: 'a', label: 'A' }],
      closesAt: '2026-09-12T22:00:00Z',
    }, AWARDS_CLOSE_AT)
    expect(own.closesAt).toBe('2026-09-12T22:00:00Z')
  })
})

describe('the Discord-only catalog', () => {
  // Both are stored on every vote cast, so a duplicate silently merges two questions and a
  // rename orphans every answer already given. Cheap to pin, expensive to discover.
  it('gives every question a unique, prefixed id and every option a unique key', () => {
    const ids = WPBL_DISCORD_QUESTIONS.map(q => q.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const q of WPBL_DISCORD_QUESTIONS) {
      expect(q.id.startsWith('discord:'), `${q.id} is not prefixed`).toBe(true)
      expect(q.id.length).toBeLessThanOrEqual(64)   // the column's own limit, in wpbl_cast_award_vote
      const keys = q.options.map(o => o.key)
      expect(new Set(keys).size, `${q.id} repeats an option key`).toBe(keys.length)
      expect(q.options.length, `${q.id} offers more options than there are numbers`).toBeLessThanOrEqual(10)
      for (const o of q.options) expect(o.key.length).toBeLessThanOrEqual(128)
    }
  })

  it('writes no em dashes', () => {
    for (const q of WPBL_DISCORD_QUESTIONS) {
      const text = [q.title, q.blurb ?? '', ...q.options.map(o => `${o.label} ${o.note ?? ''}`)].join(' ')
      expect(text).not.toMatch(/—/)
    }
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
