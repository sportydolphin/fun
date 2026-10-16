import { describe, it, expect } from 'vitest'
import {
  applyDecisions, EMPTY_CROSSWALK, matchKind, nameWords, propose,
  type Crosswalk, type CrosswalkWbscPlayer, type CrosswalkWpblPlayer, type Review,
} from '../crosswalk'

// Synthetic names only, shaped the way each side writes them: WBSC with every given name and
// both surnames, the WPBL roster with what a fan would call the player.

const wbsc = (id: string, first: string, last: string, team = 'AAA', event = 'ev-1'): CrosswalkWbscPlayer =>
  ({ id, event_key: event, name: `${first} ${last}`, first_name: first, last_name: last, team_id: team })
const wpbl = (id: string, name: string, hometown: string | null = null): CrosswalkWpblPlayer => ({ id, name, hometown })

describe('names', () => {
  it('folds accents, case, apostrophes and hyphens', () => {
    expect(nameWords("Zoë O'Brien-Lefèvre")).toEqual(['zoe', 'obrien', 'lefevre'])
    expect(nameWords('  MARÍA   josé ')).toEqual(['maria', 'jose'])
    // A scorer's backtick between spaces is still an apostrophe.
    expect(nameWords('O ` BRIEN')).toEqual(['obrien'])
  })

  it('matches a WPBL name inside WBSC\'s fuller one', () => {
    // Middle names WBSC writes and the roster does not.
    expect(matchKind({ first_name: 'Dana Lee-Ann', last_name: 'QUILL' }, 'Dana Quill')).toBe('name')
    // A surname that is a run inside WBSC's two.
    expect(matchKind({ first_name: 'Inés Clara', last_name: 'DE LA PEÑA ROSALES' }, 'Ines de la Pena')).toBe('name')
    // A roster name that keeps the second given name too.
    expect(matchKind({ first_name: 'Ana Sofia', last_name: 'VELA MORA' }, 'Ana Sofia Vela Mora')).toBe('name')
    // The apostrophe and the accent both fold.
    expect(matchKind({ first_name: 'Nell', last_name: "O'DARE" }, "Nell O'Dare")).toBe('name')
  })

  it('offers a nickname on the surname and an initial, for a person to judge', () => {
    expect(matchKind({ first_name: 'Teresa Paz', last_name: 'DEL RIO SOTO' }, 'Tere del Rio')).toBe('initial')
  })

  it('does not match a different given name, or a surname that is only a middle name', () => {
    expect(matchKind({ first_name: 'Paula', last_name: 'QUILL' }, 'Dana Quill')).toBeNull()
    expect(matchKind({ first_name: 'Dana Quill', last_name: 'MARSH' }, 'Dana Quill')).toBeNull()
    expect(matchKind({ first_name: 'Dana', last_name: 'QUILLEN' }, 'Dana Quill')).toBeNull()
  })
})

describe('propose', () => {
  const players = [
    wbsc('wbsc:p:1:1', 'Dana Lee', 'QUILL'),
    wbsc('wbsc:p:1:2', 'Teresa Paz', 'DEL RIO SOTO', 'BBB'),
    wbsc('wbsc:p:1:3', 'Mina', 'SOL'),
    wbsc('wbsc:p:1:4', 'Mina Jo', 'SOL'),
    wbsc('wbsc:p:2:9', 'Dana Lee', 'QUILL', 'AAA', 'ev-2'),
  ]
  const roster = [
    wpbl('u-dana', 'Dana Quill', 'Somewhere, Aland'),
    wpbl('u-tere', 'Tere del Rio'),
    wpbl('u-mina', 'Mina Sol'),
    wpbl('u-none', 'Nobody Here'),
  ]

  it('lists every plausible pair, once per event, in a stable order', () => {
    const c = propose(players, roster, EMPTY_CROSSWALK)
    expect(c.map(x => `${x.event_key} ${x.wbsc_id} ${x.wpbl_id} ${x.match}`)).toEqual([
      'ev-1 wbsc:p:1:1 u-dana name',
      'ev-1 wbsc:p:1:4 u-mina name',
      'ev-1 wbsc:p:1:3 u-mina name',
      'ev-1 wbsc:p:1:2 u-tere initial',
      'ev-2 wbsc:p:2:9 u-dana name',
    ])
    expect(c[0]).toMatchObject({ wpbl_hometown: 'Somewhere, Aland', wbsc_team: 'AAA', decision: '' })
  })

  it('flags two candidates that cannot both be right', () => {
    const c = propose(players, roster, EMPTY_CROSSWALK)
    expect(c.filter(x => x.ambiguous).map(x => x.wbsc_id)).toEqual(['wbsc:p:1:4', 'wbsc:p:1:3'])
  })

  it('leaves out what is already linked or ruled out', () => {
    const crosswalk: Crosswalk = {
      links: [{ wbsc_id: 'wbsc:p:1:1', event_key: 'ev-1', wbsc_name: 'x', wpbl_id: 'u-dana', wpbl_name: 'x', checked_by: 'R', checked_at: '2026-10-16' }],
      rejected: [{ wbsc_id: 'wbsc:p:1:2', wpbl_id: 'u-tere', checked_by: 'R', checked_at: '2026-10-16' }],
    }
    const ids = propose(players, roster, crosswalk).map(x => x.wbsc_id)
    expect(ids).not.toContain('wbsc:p:1:1')
    expect(ids).not.toContain('wbsc:p:1:2')
    // The same player in another event is still proposed: a link is per tournament.
    expect(ids).toContain('wbsc:p:2:9')
  })
})

describe('applyDecisions', () => {
  const known = { wbsc: new Set(['wbsc:p:1:1', 'wbsc:p:1:2', 'wbsc:p:1:3']), wpbl: new Set(['u-dana', 'u-tere', 'u-mina']) }
  const review = (checked_by: string, decisions: Record<string, '' | 'yes' | 'no'>): Review => ({
    checked_by,
    candidates: propose(
      [wbsc('wbsc:p:1:1', 'Dana Lee', 'QUILL'), wbsc('wbsc:p:1:2', 'Teresa Paz', 'DEL RIO SOTO'), wbsc('wbsc:p:1:3', 'Mina', 'SOL')],
      [wpbl('u-dana', 'Dana Quill'), wpbl('u-tere', 'Tere del Rio'), wpbl('u-mina', 'Mina Sol')],
      EMPTY_CROSSWALK,
    ).map(c => ({ ...c, decision: decisions[c.wbsc_id] ?? '' })),
  })

  it('turns a yes into a link and a no into a rejection, and keeps the undecided', () => {
    const r = applyDecisions(EMPTY_CROSSWALK, review('Reviewer', { 'wbsc:p:1:1': 'yes', 'wbsc:p:1:2': 'no' }), known, '2026-10-16')
    expect(r.errors).toEqual([])
    expect(r.crosswalk.links).toEqual([{
      wbsc_id: 'wbsc:p:1:1', event_key: 'ev-1', wbsc_name: 'Dana Lee QUILL', wpbl_id: 'u-dana', wpbl_name: 'Dana Quill',
      checked_by: 'Reviewer', checked_at: '2026-10-16',
    }])
    expect(r.crosswalk.rejected).toEqual([{ wbsc_id: 'wbsc:p:1:2', wpbl_id: 'u-tere', checked_by: 'Reviewer', checked_at: '2026-10-16' }])
    expect(r.remaining.map(c => c.wbsc_id)).toEqual(['wbsc:p:1:3'])
  })

  it('applies nothing without a reviewer', () => {
    const r = applyDecisions(EMPTY_CROSSWALK, review(' ', { 'wbsc:p:1:1': 'yes' }), known, '2026-10-16')
    expect(r.errors[0]).toMatch(/checked_by is empty/)
    expect(r.crosswalk).toBe(EMPTY_CROSSWALK)
  })

  it('applies nothing when one decision is bad, however many are good', () => {
    const bad = review('Reviewer', { 'wbsc:p:1:1': 'yes' })
    bad.candidates[1].decision = 'maybe' as never
    const r = applyDecisions(EMPTY_CROSSWALK, bad, known, '2026-10-16')
    expect(r.errors.join('\n')).toMatch(/"maybe" is not yes, no or empty/)
    expect(r.crosswalk.links).toEqual([])
  })

  it('refuses a player who is not on the roster, and a second link for one WBSC player', () => {
    const r1 = applyDecisions(EMPTY_CROSSWALK, review('Reviewer', { 'wbsc:p:1:1': 'yes' }), { ...known, wpbl: new Set() }, '2026-10-16')
    expect(r1.errors.join('\n')).toMatch(/u-dana is not on the WPBL roster/)

    const once = applyDecisions(EMPTY_CROSSWALK, review('Reviewer', { 'wbsc:p:1:1': 'yes' }), known, '2026-10-16').crosswalk
    const again = review('Reviewer', {})
    again.candidates = [{ ...again.candidates.find(c => c.wbsc_id === 'wbsc:p:1:1')!, decision: 'yes' }]
    expect(applyDecisions(once, again, known, '2026-10-17').errors.join('\n')).toMatch(/already linked to Dana Quill/)
  })
})
