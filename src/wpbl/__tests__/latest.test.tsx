import { describe, it, expect } from 'vitest'
import { latestItems, latestWhen, headlineText, LATEST_COUNT } from '../home/LatestCard'
import type { WpblArticle, WpblGameRecap, WpblVideo } from '../types'

const NOW = new Date(2026, 10, 4, 15, 0).getTime()
const iso = (daysAgo: number, hour = 12) => new Date(2026, 10, 4 - daysAgo, hour).toISOString()

const video = (id: string, daysAgo: number, short = false): WpblVideo => ({
  video_id: id.padEnd(11, 'x'), channel_id: 'league', title: `Video ${id} 😂`, published_at: iso(daysAgo),
  thumbnail_url: null, kind: 'compilation', game_id: null, is_short: short,
})
const article = (id: number, daysAgo: number): WpblArticle => ({
  post_id: id, source: 'towards', slug: `p${id}`, url: `https://example.com/${id}`, title: `Post ${id}`,
  subtitle: null, cover_url: null, published_at: iso(daysAgo), word_count: 1000, video_count: 0,
  game_id: null, team_ids: [], player_ids: [],
})
const recap = (id: string, daysAgo: number): WpblGameRecap => ({
  game_id: id, url: `https://example.com/r/${id}`, title: `Recap ${id}`, cover_url: null,
  published_at: iso(daysAgo), matched_by: 'date',
} as WpblGameRecap)

describe('latestItems', () => {
  it('merges the three reads newest first and stops at the count', () => {
    const items = latestItems([article(1, 3), article(2, 9)], [video('a', 1), video('b', 5)], [recap('g', 2)], NOW)
    expect(items.map(i => i.key)).toEqual(['v:axxxxxxxxxx', 'r:g', 'a:1', 'v:bxxxxxxxxxx'].slice(0, LATEST_COUNT))
  })

  it('keeps one kind from filling the list', () => {
    const videos = ['a', 'b', 'c', 'd', 'e'].map((id, i) => video(id, i))
    const items = latestItems([article(1, 20)], videos, [], NOW)
    expect(items.filter(i => i.kind === 'video')).toHaveLength(3)
    expect(items.some(i => i.kind === 'reading')).toBe(true)
  })

  it("folds the week's clips into one row and drops older ones", () => {
    const items = latestItems([], [video('s1', 0, true), video('s2', 2, true), video('s3', 10, true)], [], NOW)
    expect(items).toEqual([expect.objectContaining({
      kind: 'clips', title: 'Video s1', label: 'Clip · 2 this week', href: '/wpbl/watch/s1xxxxxxxxx',
    })])
  })

  it('opens a video on its own page and a post or recap in a new tab', () => {
    const [v, a] = latestItems([article(1, 2)], [video('a', 1)], [], NOW)
    expect(v).toMatchObject({ href: '/wpbl/watch/axxxxxxxxxx', external: false, title: 'Video a' })
    expect(a).toMatchObject({ href: 'https://example.com/1', external: true })
  })
})

describe('latestWhen', () => {
  it('says today and yesterday, then the short date', () => {
    expect(latestWhen(iso(0, 9), NOW)).toBe('Today')
    expect(latestWhen(iso(1, 23), NOW)).toBe('Yesterday')
    expect(latestWhen(iso(5), NOW)).toBe('Oct 30')
    expect(latestWhen(new Date(2025, 8, 1).toISOString(), NOW)).toBe('Sep 1, 2025')
  })
})

describe('headlineText', () => {
  it('takes emoji out and keeps the words', () => {
    expect(headlineText('What does a Queen sound like? 👑👀')).toBe('What does a Queen sound like?')
    expect(headlineText('🫶')).toBe('')
  })
})
