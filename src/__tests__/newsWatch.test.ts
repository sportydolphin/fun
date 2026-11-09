import { describe, expect, it } from 'vitest'
import {
  chunkLines, decodeEntities, diffSource, isLoud, isNextSeasonDate, pushSummary,
} from '../../shared/newsWatch.js'

const item = (key: string, fingerprint = key, extra = {}) => ({ key, fingerprint, title: `T${key}`, ...extra })

describe('diffSource', () => {
  it('seeds a source it has never read, reporting nothing', () => {
    const r = diffSource(new Map(), [item('1'), item('2')], { seeded: false })
    expect(r).toEqual({ added: [], changed: [], seeding: true })
  })

  it('reports a new key as added and a moved fingerprint as changed, with what it was', () => {
    const prev = new Map([['1', 'a'], ['2', 'b']])
    const r = diffSource(prev, [item('1', 'a'), item('2', 'c'), item('3')], { seeded: true })
    expect(r.added.map(i => i.key)).toEqual(['3'])
    expect(r.changed).toEqual([{ ...item('2', 'c'), before: 'b' }])
  })

  it('treats a seeded source that read empty, then gained a row, as news', () => {
    // wpbl-transactions held nothing when the watch started; its first row is a signing.
    expect(diffSource(new Map(), [item('9')], { seeded: true }).added).toHaveLength(1)
  })

  it('says nothing about a row that disappeared', () => {
    expect(diffSource(new Map([['1', 'a']]), [], { seeded: true })).toEqual({ added: [], changed: [], seeding: false })
  })
})

describe('isLoud', () => {
  it('pushes the feed and the league club and venue records', () => {
    for (const s of ['feed-season', 'feed-team', 'feed-game', 'site-team', 'site-venue']) {
      expect(isLoud(s, item('1'))).toBe(true)
    }
  })

  it('keeps posts, pages, players and press quiet unless an item says otherwise', () => {
    for (const s of ['site-post', 'site-page', 'site-player', 'news', 'youtube']) {
      expect(isLoud(s, item('1'))).toBe(false)
    }
    expect(isLoud('site-calendar', item('1', '1', { loud: true }))).toBe(true)
  })
})

describe('isNextSeasonDate', () => {
  it('is true only past the season held, in UTC', () => {
    expect(isNextSeasonDate('2027-05-01T22:00:00Z', 2026)).toBe(true)
    expect(isNextSeasonDate('2026-12-31T23:59:59Z', 2026)).toBe(false)
    expect(isNextSeasonDate('', 2026)).toBe(false)
    expect(isNextSeasonDate(undefined, 2026)).toBe(false)
  })
})

describe('decodeEntities', () => {
  it('decodes what WordPress puts in titles', () => {
    expect(decodeEntities('The WPBL&#8217;s Season &amp; More')).toBe('The WPBL’s Season & More')
    expect(decodeEntities('Mo&#x27;ne')).toBe("Mo'ne")
  })
})

describe('chunkLines', () => {
  it('splits under the cap without breaking a line, repeating the header', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i} ${'x'.repeat(90)}`)
    const out = chunkLines('H', lines, 500)
    expect(out.length).toBeGreaterThan(1)
    for (const m of out) {
      expect(m.length).toBeLessThanOrEqual(500)
      expect(m.startsWith('H\n')).toBe(true)
    }
    expect(out.join('\n').match(/line \d+/g)).toHaveLength(30)
  })

  it('cuts a single line longer than the cap rather than sending one Discord would refuse', () => {
    const [m] = chunkLines('H', ['y'.repeat(5000)], 500)
    expect(m.length).toBeLessThanOrEqual(500)
  })

  it('sends nothing for nothing', () => {
    expect(chunkLines('H', [])).toEqual([])
  })
})

describe('pushSummary', () => {
  const r = (title: string) => ({ source: 'feed-game', kind: 'added', item: { title } })

  it('is one push however many items, naming the first few', () => {
    const s = pushSummary(Array.from({ length: 6 }, (_, i) => r(`G${i}`)))!
    expect(s.title).toBe('WPBL: 6 new league data items')
    expect(s.body).toBe('G0 · G1 · G2 · G3 and 2 more')
  })

  it('names the kind for a single item, and is nothing for none', () => {
    expect(pushSummary([{ source: 'feed-season', kind: 'added', item: { title: 'WPBL 2027' } }])!.title)
      .toBe('WPBL: new feed season')
    expect(pushSummary([])).toBeNull()
  })
})
