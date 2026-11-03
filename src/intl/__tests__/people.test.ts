import { describe, it, expect } from 'vitest'
import type { Crosswalk, Link } from '../wbsc/crosswalk'
import { buildPeople, type PeopleWbscPlayer, type PeopleWpblPlayer } from '../people'

// Synthetic people only. The stage 1 bar (ROADMAP-WOMENS-BASEBALL.md): every crosswalk row resolves
// to one person, and no person holds two WPBL players.

const ROSTER: PeopleWpblPlayer[] = [{ id: 'w1', name: 'Dana Quill' }, { id: 'w2', name: 'Nell Odare' }, { id: 'w3', name: 'Pia Rowan' }]
const wbsc = (t: number, n: number, name: string, team = 'AAA'): PeopleWbscPlayer =>
  ({ id: `wbsc:p:${t}:${n}`, event_key: `ev-${t}`, name, full_name: name, team_id: team })
const WBSC = [
  wbsc(10, 1, 'Dana Lee-Ann Quill'), wbsc(20, 7, 'Dana Quill', 'BBB'), wbsc(10, 2, 'Nell Odare'),
  wbsc(10, 3, 'Uma Vance'), wbsc(20, 3, 'Uma Vance'),
]
const link = (wbscId: string, wpbl: string): Link => ({
  wbsc_id: wbscId, event_key: `ev-${wbscId.split(':')[2]}`, wbsc_name: 'x', wpbl_id: wpbl,
  wpbl_name: ROSTER.find(r => r.id === wpbl)?.name ?? wpbl, checked_by: 'test', checked_at: '2026-11-02',
})
const cw = (links: Link[]): Crosswalk => ({ links, rejected: [] })
const LINKS = [link('wbsc:p:20:7', 'w1'), link('wbsc:p:10:1', 'w1'), link('wbsc:p:10:2', 'w2')]

describe('people.json', () => {
  it('joins every crosswalk row to exactly one person, and no person holds two WPBL players', () => {
    const { people, errors } = buildPeople(ROSTER, WBSC, cw(LINKS))
    expect(errors).toEqual([])
    for (const l of LINKS) {
      const holders = people.filter(p => p.wbsc.some(w => w.wbsc_id === l.wbsc_id))
      expect(holders).toHaveLength(1)
      expect(holders[0].wpbl_id).toBe(l.wpbl_id)
    }
    const wpblIds = people.map(p => p.wpbl_id).filter(Boolean)
    expect(new Set(wpblIds).size).toBe(wpblIds.length)
    // Every WBSC row is somebody, once.
    const all = people.flatMap(p => p.wbsc.map(w => w.wbsc_id))
    expect(all.sort()).toEqual(WBSC.map(w => w.id).sort())
  })

  it('names a WPBL player as the roster does, with their tournaments oldest first and their latest flag', () => {
    const dana = buildPeople(ROSTER, WBSC, cw(LINKS)).people.find(p => p.wpbl_id === 'w1')!
    expect(dana).toMatchObject({ id: 'person:wpbl:w1', name: 'Dana Quill', country: 'BBB' })
    expect(dana.wbsc.map(w => w.wbsc_id)).toEqual(['wbsc:p:10:1', 'wbsc:p:20:7'])
  })

  it('keeps a WPBL player with no World Cup, and never joins two WBSC players by name', () => {
    const { people } = buildPeople(ROSTER, WBSC, cw(LINKS))
    expect(people.find(p => p.wpbl_id === 'w3')).toMatchObject({ country: null, wbsc: [] })
    // Same name, same flag, two events: two people until someone links them.
    const umas = people.filter(p => p.name === 'Uma Vance')
    expect(umas.map(p => p.id)).toEqual(['person:wbsc:10:3', 'person:wbsc:20:3'])
  })

  it('builds nothing when a link would not resolve or would split or merge people', () => {
    const cases: [Link[], RegExp][] = [
      [[link('wbsc:p:99:1', 'w1')], /in no imported event/],
      [[link('wbsc:p:10:3', 'nobody')], /not on the WPBL roster/],
      [[link('wbsc:p:10:1', 'w1'), link('wbsc:p:10:1', 'w2')], /also linked to Dana Quill/],
      [[link('wbsc:p:10:1', 'w1'), link('wbsc:p:10:3', 'w1')], /already .* in that event/],
    ]
    for (const [links, why] of cases) {
      const { people, errors } = buildPeople(ROSTER, WBSC, cw(links))
      expect(people).toEqual([])
      expect(errors.join('\n')).toMatch(why)
    }
  })

  it('is the same bytes whatever order its inputs come in', () => {
    const a = buildPeople(ROSTER, WBSC, cw(LINKS)).people
    const b = buildPeople([...ROSTER].reverse(), [...WBSC].reverse(), cw([...LINKS].reverse())).people
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})
