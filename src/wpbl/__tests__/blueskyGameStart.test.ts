import { describe, it, expect } from 'vitest'
import { buildGameStartPost, POST_LIMIT } from '../derive/blueskyGameStart'
import { graphemes, linkFacets } from '../derive/blueskyRecap'

// A pre-game reminder is public and permanent (Bluesky has no edit), and it is read long after
// it is posted, so the two things that must never be wrong are what game it points at and that
// it cannot become a countdown that expires. These are the parts that decide what is published.

const URL = 'sportydolphin.fun/wpbl/games/2026-09-16-queens-at-hunters'

describe('an ordinary game', () => {
  it('carries the matchup, the wall-clock start and the link', () => {
    const post = buildGameStartPost({
      away: 'Los Angeles Queens', home: 'Boston Hunters', startTime: '6:00 PM', url: URL,
    })
    expect(graphemes(post.text)).toBeLessThanOrEqual(POST_LIMIT)
    expect(post.text).toContain('Los Angeles Queens at Boston Hunters')
    expect(post.text).toContain('First pitch 6:00 PM CT')
    expect(post.text).toContain(URL)
  })

  it('carries no countdown, because the post outlives the minute it was written', () => {
    const post = buildGameStartPost({
      away: 'Los Angeles Queens', home: 'Boston Hunters', startTime: '6:00 PM', url: URL,
    })
    expect(post.text).not.toMatch(/\bmin\b/)
    expect(post.text).not.toMatch(/in \d/)
  })
})

describe('a postseason game', () => {
  it('names the round and where the series stands', () => {
    const post = buildGameStartPost({
      away: 'Los Angeles Queens', home: 'Boston Hunters', startTime: '6:00 PM', url: URL,
      series: { label: 'Semifinal', gameNumber: 2, line: 'Hunters lead 1-0', stakes: null },
    })
    expect(post.text).toContain('Semifinal Game 2')
    expect(post.text).toContain('Hunters lead 1-0')
  })

  it('leads with what is at stake over the plain record', () => {
    // Before a decider, "can clinch" is the more compelling of the two and the record is implied
    // by it, so the stakes win the shared line.
    const post = buildGameStartPost({
      away: 'Los Angeles Queens', home: 'Boston Hunters', startTime: '7:30 PM', url: URL,
      series: { label: 'Championship', gameNumber: 5, line: 'Series tied 2-2', stakes: 'Winner takes the championship' },
    })
    expect(post.text).toContain('Championship Game 5')
    expect(post.text).toContain('Winner takes the championship')
  })
})

describe('the link is clickable', () => {
  it('gets a facet indexed by UTF-8 byte, with the scheme put back on the target', () => {
    // The same trap as the recap post: the emoji earlier in the text is one JS character and
    // four UTF-8 bytes, so a facet indexed by string position underlines the wrong span.
    const post = buildGameStartPost({
      away: 'Los Angeles Queens', home: 'Boston Hunters', startTime: '6:00 PM', url: URL,
    })
    const [facet] = linkFacets(post.text, URL) as any[]
    const enc = new TextEncoder()
    expect(facet.index.byteStart).toBe(enc.encode(post.text.slice(0, post.text.indexOf(URL))).length)
    expect(facet.features[0].uri).toBe(`https://${URL}`)
  })
})

describe('it always fits', () => {
  it('publishes a runaway matchup trimmed rather than overrunning the cap', () => {
    const post = buildGameStartPost({
      away: 'A'.repeat(400), home: 'Boston Hunters', startTime: '6:00 PM', url: URL,
    })
    expect(graphemes(post.text)).toBeLessThanOrEqual(POST_LIMIT)
    expect(post.text).toContain(URL)
  })
})
