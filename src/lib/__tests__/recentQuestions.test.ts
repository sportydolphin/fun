// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { clearRecentQuestions, getRecentQuestions, getRowPicks, mergeRecent, recordRecentQuestion, recordRowPick } from '../recentQuestions'

const q = (title: string, href: string) => ({ kind: 'leader' as const, title, href })

describe('recent questions', () => {
  beforeEach(() => localStorage.clear())

  it('keeps each question once, newest first, per section', () => {
    recordRecentQuestion('wpbl', q('Most home runs', '/a'), 1)
    recordRecentQuestion('wpbl', q('Lowest ERA', '/b'), 2)
    recordRecentQuestion('wpbl', q('Most home runs', '/a'), 3)
    expect(getRecentQuestions('wpbl').map(x => x.href)).toEqual(['/a', '/b'])
    expect(getRecentQuestions('mlb')).toEqual([])
  })

  it('tells two glossary terms on one page apart by their scroll', () => {
    recordRecentQuestion('mlb', { kind: 'definition', title: 'ERA', href: '/mlb/glossary', scrollTo: 'term-ERA' }, 1)
    recordRecentQuestion('mlb', { kind: 'definition', title: 'FIP', href: '/mlb/glossary', scrollTo: 'term-FIP' }, 2)
    expect(getRecentQuestions('mlb')).toHaveLength(2)
  })

  it('clears the questions and the pick times together', () => {
    recordRecentQuestion('wpbl', q('Most home runs', '/a'))
    recordRowPick('wpbl', 'player-1')
    clearRecentQuestions('wpbl')
    expect(getRecentQuestions('wpbl')).toEqual([])
    expect(getRowPicks('wpbl')).toEqual({})
  })
})

describe('mergeRecent', () => {
  const rows = [{ key: 'player-1' }, { key: 'team-SF' }, { key: 'player-2' }]

  it('places rows by when they were opened and questions by when they were asked', () => {
    const out = mergeRecent(rows, [{ ...q('Q', '/q'), at: 20 }], { 'player-1': 30, 'team-SF': 10 }, 3)
    expect(out.map(e => ('row' in e ? e.row.key : e.question.title))).toEqual(['player-1', 'Q', 'team-SF'])
  })

  it('puts a row with no known time after every timed entry, keeping the section order among them', () => {
    const out = mergeRecent(rows, [{ ...q('Q', '/q'), at: 5 }], {}, 4)
    expect(out.map(e => ('row' in e ? e.row.key : e.question.title))).toEqual(['Q', 'player-1', 'team-SF', 'player-2'])
  })
})
