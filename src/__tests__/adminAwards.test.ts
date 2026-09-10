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
  it('counts people, not answers', () => {
    const report = buildAdminAwardReport([
      vote({ voter: 'a', category: 'mvp' }),
      vote({ voter: 'a', category: 'pitcher' }),
      vote({ voter: 'b', category: 'mvp' }),
    ])
    expect(report.votes).toBe(3)
    expect(report.voters).toBe(2)
  })

  it('sorts the five on the card first, in the order the card asks them', () => {
    const report = buildAdminAwardReport([
      vote({ category: 'pickem:2026:championship', voter: 'a' }),
      vote({ category: 'aura', voter: 'b' }),
      vote({ category: 'mvp', voter: 'c' }),
    ])
    expect(report.categories.map(c => c.category)).toEqual(['mvp', 'aura', 'pickem:2026:championship'])
    expect(report.categories.map(c => c.onTheCard)).toEqual([true, true, false])
  })

  it('counts a finished sheet as all five of the card, and only the card', () => {
    const five = ['mvp', 'pitcher', 'manager', 'glove', 'aura']
      .map(category => vote({ category, voter: 'a' }))
    const report = buildAdminAwardReport([...five, vote({ category: 'wheels', voter: 'b' })])
    expect(report.completed).toBe(1)
    expect(report.byAnswered[5]).toBe(1)
    // The second voter answered a category that is not on the card, so they have finished none
    // of it and must not appear in the distribution at all.
    expect(report.byAnswered.slice(1).reduce((a, b) => a + b, 0)).toBe(1)
  })

  it('takes the latest vote as the newest timestamp, however the rows arrive', () => {
    const report = buildAdminAwardReport([
      vote({ voted_at: '2026-09-09T10:00:00Z' }),
      vote({ voter: 'b', voted_at: '2026-09-11T10:00:00Z' }),
      vote({ voter: 'c', voted_at: '2026-09-10T10:00:00Z' }),
    ])
    expect(report.latest).toBe('2026-09-11T10:00:00Z')
  })
})
