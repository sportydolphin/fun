import { describe, it, expect } from 'vitest'
import {
  buildAdminAwardReport, awardChoiceLabel, awardCategoryLabel,
} from '../lib/adminAwards'
import type { AdminAwardVote } from '../lib/adminAwards'
import type { WpblPlayer } from '../wpbl/types'

// The labelling is the half that rots: four different key shapes share one column, and a
// mislabelled row here is a number the owner reads as the wrong question.

const players = [{ id: 'p-1', name: 'Kelsie Whitmore', team_id: 'SF' }] as WpblPlayer[]
const vote = (o: Partial<AdminAwardVote>): AdminAwardVote =>
  ({ category: 'mvp', choice: 'p-1', voter: 'v1', voted_at: '2026-09-10T12:00:00Z', ...o })

describe('reading a stored choice', () => {
  it('names a player, a manager and a series pick', () => {
    expect(awardChoiceLabel('p-1', players)).toBe('Kelsie Whitmore')
    expect(awardChoiceLabel('mgr:matt-williams', players)).toBe('Matt Williams')
    expect(awardChoiceLabel('SF:2-1', players)).toBe('Firebells in 3')
  })

  // An answer this build cannot read is still an answer somebody gave, and hiding it would put
  // the panel out of step with its own totals.
  it('prints an unrecognised key rather than dropping it', () => {
    expect(awardChoiceLabel('g-77:412', players)).toBe('g-77:412')
  })

  it('names the categories, including the pick\'em rows sharing the table', () => {
    expect(awardCategoryLabel('mvp')).toBe('Most Valuable Player')
    expect(awardCategoryLabel('pickem:2026:championship')).toBe("Pick'em: the final")
    expect(awardCategoryLabel('who-knows')).toBe('who-knows')
  })
})

describe('the report', () => {
  // THE BUG THIS BLOCK EXISTS FOR. The panel reported 209 votes from 72 voters on a ballot that
  // had been open for an afternoon, because the pick'em has lived in this table since it shipped
  // and outnumbers the awards six to one. Everything in the headline is the five on the card.
  it('keeps the pick\'em out of the ballot\'s numbers', () => {
    const report = buildAdminAwardReport([
      vote({ voter: 'a', category: 'mvp' }),
      vote({ voter: 'b', category: 'pickem:2026:semifinal:A', choice: 'SF:2-0' }),
      vote({ voter: 'c', category: 'pickem:2026:championship', choice: 'NY:3-1' }),
      vote({ voter: 'c', category: 'pickem:2026:semifinal:B', choice: 'NY:2-1' }),
    ])
    expect(report.headline.voters).toBe(1)
    expect(report.headline.votes).toBe(1)
    // And the pick'em is still reported, on its own line, by people rather than answers.
    const pickem = report.groups.find(g => g.key === 'pickem')!
    expect([pickem.voters, pickem.votes]).toEqual([2, 3])
  })

  it('counts people, not answers', () => {
    const report = buildAdminAwardReport([
      vote({ voter: 'a', category: 'mvp' }),
      vote({ voter: 'a', category: 'pitcher' }),
      vote({ voter: 'b', category: 'mvp' }),
    ])
    expect(report.headline.votes).toBe(3)
    expect(report.headline.voters).toBe(2)
  })

  it('groups the ballot first and orders its five as the card asks them', () => {
    const report = buildAdminAwardReport([
      vote({ category: 'pickem:2026:championship', voter: 'a', choice: 'SF:3-0' }),
      vote({ category: 'aura', voter: 'b' }),
      vote({ category: 'mvp', voter: 'c' }),
      vote({ category: 'wheels', voter: 'd' }),
    ])
    expect(report.groups.map(g => g.key)).toEqual(['card', 'pickem', 'other'])
    expect(report.groups[0].categories.map(c => c.category)).toEqual(['mvp', 'aura'])
    expect(report.groups[2].categories.map(c => c.category)).toEqual(['wheels'])
  })

  it('counts a finished sheet as all five of the card, and only the card', () => {
    const five = ['mvp', 'pitcher', 'manager', 'glove', 'aura']
      .map(category => vote({ category, voter: 'a' }))
    const report = buildAdminAwardReport([...five, vote({ category: 'wheels', voter: 'b' })])
    expect(report.headline.completed).toBe(1)
    expect(report.headline.byAnswered[5]).toBe(1)
    // The second voter answered a category that is not on the card, so they have finished none
    // of it and must not appear in the distribution at all.
    expect(report.headline.byAnswered.slice(1).reduce((a, b) => a + b, 0)).toBe(1)
  })

  // A pick'em answer landing after the ballot has gone quiet would otherwise read as the ballot
  // still being live, which is the one thing this figure is looked at for.
  it('takes the last vote from the ballot, not from the table', () => {
    const report = buildAdminAwardReport([
      vote({ voter: 'a', category: 'mvp', voted_at: '2026-09-09T10:00:00Z' }),
      vote({ voter: 'b', category: 'mvp', voted_at: '2026-09-11T10:00:00Z' }),
      vote({ voter: 'c', category: 'pickem:2026:championship', choice: 'SF:3-0', voted_at: '2026-09-12T10:00:00Z' }),
    ])
    expect(report.headline.latest).toBe('2026-09-11T10:00:00Z')
  })
})
