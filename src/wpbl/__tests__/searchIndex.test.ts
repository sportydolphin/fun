// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { EMPTY_SEARCH_INDEX, readSearchIndex, saveSearchIndex, type WpblSearchIndex } from '../searchIndex'
import type { WpblPlayer, WpblTeam } from '../types'

const player = { id: 'p1', name: 'Andréanne Ouellet', team_id: 'BOS' } as WpblPlayer
const team = { id: 'BOS', city: 'Boston', name: 'Hunters', abbr: 'BOS' } as WpblTeam
const index: WpblSearchIndex = {
  players: [player],
  teams: [team],
  positions: [['p1', { position: 'ss', games: 9, fielded: 10 }]],
  leaders: ['p1'],
}

describe('search index', () => {
  afterEach(() => localStorage.clear())

  it('hands back what the last visit kept', () => {
    saveSearchIndex(index)
    expect(readSearchIndex()).toEqual(index)
  })

  // A failed roster read lands as an empty list, and keeping that would erase the copy that
  // covers the next visit's wait.
  it('never keeps an empty roster over a full one', () => {
    saveSearchIndex(index)
    saveSearchIndex({ ...index, players: [] })
    saveSearchIndex({ ...index, teams: [] })
    expect(readSearchIndex()).toEqual(index)
  })

  it('keeps a copy written before the leaders were', () => {
    localStorage.setItem('sd:wpblSearchIndex:v1', JSON.stringify({ players: [player], teams: [team], positions: [] }))
    expect(readSearchIndex()).toEqual({ players: [player], teams: [team], positions: [], leaders: [] })
  })

  it('reads nothing from a copy it cannot trust', () => {
    expect(readSearchIndex()).toBe(EMPTY_SEARCH_INDEX)
    localStorage.setItem('sd:wpblSearchIndex:v1', '{not json')
    expect(readSearchIndex()).toBe(EMPTY_SEARCH_INDEX)
    localStorage.setItem('sd:wpblSearchIndex:v1', JSON.stringify({ players: [player] }))
    expect(readSearchIndex()).toBe(EMPTY_SEARCH_INDEX)
  })
})
