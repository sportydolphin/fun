import { describe, it, expect } from 'vitest'
import type { Crosswalk } from '../crosswalk'
import { EMPTY_SAME_PERSON, proposeSamePerson, type SamePersonPlayer } from '../samePerson'
import { buildPeople } from '../../people'

// Synthetic names in the shapes WBSC writes, one per rule. Tournament ids rise with the year, as
// WBSC's do: 10 is 2016, 20 is 2018, 30 is 2023, 40 is 2024.

const EVENT: Record<number, string> = { 10: '2016-ev', 20: '2018-ev', 30: '2023-ev', 31: '2023-ev-b', 40: '2024-ev' }
const p = (t: number, n: number, first: string, last: string, team = 'AAA'): SamePersonPlayer & { full_name: string } =>
  ({ id: `wbsc:p:${t}:${n}`, event_key: EVENT[t], name: `${first} ${last}`, full_name: `${first} ${last}`, first_name: first, last_name: last, team_id: team })
const NONE: Crosswalk = { links: [], rejected: [] }
const run = (players: SamePersonPlayer[], crosswalk = NONE) => proposeSamePerson(players, crosswalk, EMPTY_SAME_PERSON, '2026-11-02')
const rules = (players: SamePersonPlayer[], crosswalk = NONE) =>
  run(players, crosswalk).decided.map(d => `${d.a_name} | ${d.b_name}: ${d.same ? 'yes' : 'no'} ${d.decided_by}`)
const asked = (players: SamePersonPlayer[], crosswalk = NONE) => run(players, crosswalk).review.map(q => `${q.a_name} | ${q.b_name}: ${q.reason}`)

describe('the same player across World Cups', () => {
  it('joins a full name, a middle name added, and a hyphen or a space, for the same country', () => {
    expect(rules([p(10, 1, 'Dana', 'Quill'), p(20, 1, 'Dana Lee', 'Quill')])).toEqual(['Dana Quill | Dana Lee Quill: yes rule:same-name-same-team'])
    expect(rules([p(10, 1, 'Bit na', 'Ro'), p(20, 1, 'Bitna', 'Ro')])).toEqual(['Bit na Ro | Bitna Ro: yes rule:same-name-same-team'])
    expect(rules([p(10, 1, 'Yu Ying', 'Hsu'), p(20, 1, 'Yu-Ying', 'Hsu')])).toEqual(['Yu Ying Hsu | Yu-Ying Hsu: yes rule:same-name-same-team'])
  })

  it('joins a nickname, a middle name gone by, and a long name one letter off', () => {
    expect(rules([p(10, 1, 'Kate', 'Psoro'), p(20, 1, 'Katherine Anne', 'Psoro')])).toEqual(['Kate Psoro | Katherine Anne Psoro: yes rule:nickname-same-team'])
    expect(rules([p(10, 1, 'Wai Yee Vina', 'Cheo'), p(20, 1, 'Vina', 'Cheo')])).toEqual(['Wai Yee Vina Cheo | Vina Cheo: yes rule:middle-name-same-team'])
    expect(rules([p(10, 1, 'Mirela De La Cruz', 'Garcia Garcia'), p(20, 1, 'Mirala De La Cruz', 'Garcia Garcia')]))
      .toEqual(['Mirela De La Cruz Garcia Garcia | Mirala De La Cruz Garcia Garcia: yes rule:spelling-same-team'])
  })

  it('rules out given names that are simply two names', () => {
    expect(rules([p(10, 1, 'Jia', 'Lee'), p(20, 1, 'Ji Eun', 'Lee')])).toEqual(['Jia Lee | Ji Eun Lee: no rule:different-given-name'])
    expect(rules([p(10, 1, 'Hyeli', 'Kim'), p(20, 1, 'Heejin', 'Kim')])).toEqual(['Hyeli Kim | Heejin Kim: no rule:different-given-name'])
  })

  it('asks about initials, a name cut short, one letter off in a short name, a close name and half a hyphenated name', () => {
    expect(asked([p(10, 1, 'Aj', 'Hamm'), p(20, 1, 'Alice Jane', 'Hamm')])).toEqual(['Aj Hamm | Alice Jane Hamm: initials'])
    expect(asked([p(10, 1, 'Yuki', 'Kawa'), p(20, 1, 'Yukiko', 'Kawa')])).toEqual(['Yuki Kawa | Yukiko Kawa: short-name'])
    expect(asked([p(10, 1, 'Sthefa', 'Suar'), p(20, 1, 'Stefa', 'Suar')])).toEqual(['Sthefa Suar | Stefa Suar: spelling'])
    expect(asked([p(10, 1, 'Marijke', 'Veenstra'), p(20, 1, 'Maria Cato', 'Veenstra')])).toEqual(['Marijke Veenstra | Maria Cato Veenstra: similar-name'])
    expect(asked([p(10, 1, 'Li-Ching', 'Hwa'), p(20, 1, 'Ching', 'Hwa')])).toEqual(['Li-Ching Hwa | Ching Hwa: middle-name'])
  })

  it('asks about the same name for another country, or with a rival in the same event', () => {
    expect(asked([p(10, 1, 'Dana', 'Quill', 'AAA'), p(20, 1, 'Dana', 'Quill', 'BBB')])).toEqual(['Dana Quill | Dana Quill: other-team'])
    expect(asked([p(10, 1, 'Dana', 'Quill'), p(20, 1, 'Dana', 'Quill'), p(20, 2, 'Dana Lee', 'Quill')]))
      .toEqual(['Dana Quill | Dana Quill: rival', 'Dana Quill | Dana Lee Quill: rival'])
  })

  it('never pairs two groups of one World Cup, and rules out two people who played the same one', () => {
    expect(run([p(30, 1, 'Dana', 'Quill'), p(31, 1, 'Dana', 'Quill')]).decided).toEqual([])
    // Chi and Chia-Yu were both on the 2023 roster, so the rules' groups can never be one person.
    const out = rules([p(20, 1, 'Chi', 'Lam'), p(30, 1, 'Chi', 'Lam'), p(30, 2, 'Chia-Yu', 'Lam'), p(40, 2, 'Chia-Yu', 'Lam')])
    expect(out.filter(r => r.endsWith('played-together'))).toHaveLength(3)
    expect(asked([p(20, 1, 'Chi', 'Lam'), p(30, 1, 'Chi', 'Lam'), p(30, 2, 'Chia-Yu', 'Lam'), p(40, 2, 'Chia-Yu', 'Lam')])).toEqual([])
  })

  it('asks once per pair of people, covering every pair of entries', () => {
    const r = run([p(10, 1, 'Yuki', 'Kawa'), p(20, 1, 'Yukiko', 'Kawa'), p(30, 1, 'Yukiko', 'Kawa'), p(40, 1, 'Yukiko', 'Kawa')])
    expect(r.review).toHaveLength(1)
    expect(r.review[0].covers).toHaveLength(3)
  })

  it('takes the crosswalk review as given: a ruled-out pair stays out', () => {
    const crosswalk: Crosswalk = {
      links: [{ wbsc_id: 'wbsc:p:20:1', event_key: EVENT[20], wbsc_name: 'Hana Kim', wpbl_id: 'w1', wpbl_name: 'Hana Kim', checked_by: 't', checked_at: '2026-11-02' }],
      rejected: [{ wbsc_id: 'wbsc:p:10:1', wpbl_id: 'w1', checked_by: 't', checked_at: '2026-11-02' }],
    }
    expect(rules([p(10, 1, 'Hana', 'Kim'), p(20, 1, 'Hana', 'Kim')], crosswalk)).toEqual(['Hana Kim | Hana Kim: no rule:crosswalk-rejected'])
  })

  it('asks nothing twice', () => {
    const players = [p(10, 1, 'Dana', 'Quill'), p(20, 1, 'Dana', 'Quill'), p(10, 2, 'Aj', 'Hamm'), p(20, 2, 'Alice Jane', 'Hamm')]
    const first = run(players)
    const again = proposeSamePerson(players, NONE, { decisions: [...first.decided] }, '2026-11-02')
    expect(again.decided).toEqual([])
    expect(again.review).toHaveLength(1)
  })
})

describe('people.json with the same player across World Cups', () => {
  const players = [p(10, 1, 'Dana', 'Quill'), p(20, 1, 'Dana Lee', 'Quill'), p(40, 1, 'Dana', 'Quill', 'BBB')]
  const yes = (a: SamePersonPlayer, b: SamePersonPlayer) => ({
    a: a.id, b: b.id, a_name: a.name, b_name: b.name, a_event: a.event_key, b_event: b.event_key, a_team: a.team_id, b_team: b.team_id,
    same: true, decided_by: 'test', decided_at: '2026-11-02',
  })

  it('makes one person of a career, under the id of their first World Cup and the flag of their latest', () => {
    const { people, errors } = buildPeople([], players, NONE, { decisions: [yes(players[0], players[1]), yes(players[1], players[2])] })
    expect(errors).toEqual([])
    expect(people).toHaveLength(1)
    expect(people[0]).toMatchObject({ id: 'person:wbsc:10:1', country: 'BBB', wpbl_id: null })
    expect(people[0].wbsc.map(w => w.wbsc_id)).toEqual(players.map(x => x.id))
  })

  it('builds nothing that would put one person in both groups of a World Cup, or make two WPBL players one', () => {
    const groups = [p(30, 1, 'Dana', 'Quill'), p(31, 1, 'Dana', 'Quill')]
    expect(buildPeople([], groups, NONE, { decisions: [yes(groups[0], groups[1])] }).errors.join()).toMatch(/two events in one year/)
    const crosswalk: Crosswalk = {
      links: [
        { wbsc_id: players[0].id, event_key: EVENT[10], wbsc_name: 'x', wpbl_id: 'w1', wpbl_name: 'One', checked_by: 't', checked_at: '2026-11-02' },
        { wbsc_id: players[1].id, event_key: EVENT[20], wbsc_name: 'x', wpbl_id: 'w2', wpbl_name: 'Two', checked_by: 't', checked_at: '2026-11-02' },
      ],
      rejected: [],
    }
    const roster = [{ id: 'w1', name: 'One' }, { id: 'w2', name: 'Two' }]
    expect(buildPeople(roster, players, crosswalk, { decisions: [yes(players[0], players[1])] }).errors.join()).toMatch(/2 WPBL players/)
  })
})
