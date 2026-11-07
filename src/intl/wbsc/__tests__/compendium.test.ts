import { describe, it, expect } from 'vitest'
import { checkCompendium, compendiumGames, compendiumUrl, compendiumYearOf, type CompendiumEdition, type CompendiumGame } from '../compendium'
import { buildWorldCupSite, type EditionDef } from '../editions'

// Synthetic rows only, as everywhere in these tests: real teams' codes, made-up games. A first
// round of two pools, a second round of two pools where rain took two games (as in 2008), so one
// pool falls apart by its games alone, then a final and a bronze game.

const g = (n: number, round: string, away: string, home: string, as: number, hs: number): CompendiumGame => ({
  n, date: `2008-08-${String(10 + n).padStart(2, '0')}`, time: '12:30', venue: 'Park', round, away, home, away_score: as, home_score: hs,
})

function edition(): CompendiumEdition {
  return {
    year: 2008, city: 'Here', timezone: 'Asia/Tokyo', canceled: [7, 8],
    games: [
      g(1, 'Opening Round', 'AUS', 'USA', 1, 5), g(2, 'Opening Round', 'TPE', 'IND', 4, 0),
      g(3, 'Opening Round', 'CAN', 'JPN', 2, 6), g(4, 'Opening Round', 'KOR', 'HKG', 9, 3),
      // Pool 1 of round 2 is TPE, IND, KOR, HKG; rain took 7 (KOR v TPE) and 8 (HKG v IND).
      g(5, 'Round 2', 'HKG', 'TPE', 1, 8), g(6, 'Round 2', 'IND', 'KOR', 2, 3),
      g(9, 'Round 2', 'USA', 'JPN', 3, 4), g(10, 'Round 2', 'CAN', 'AUS', 5, 2),
      g(11, 'Bronze', 'CAN', 'USA', 1, 2), g(12, 'Gold', 'AUS', 'JPN', 0, 3),
    ],
    standings: [
      { round: 'Opening Round', group: 'A', rows: [['USA', 1, 0, 5, 1], ['TPE', 1, 0, 4, 0], ['AUS', 0, 1, 1, 5], ['IND', 0, 1, 0, 4]] },
      { round: 'Opening Round', group: 'B', rows: [['JPN', 1, 0, 6, 2], ['KOR', 1, 0, 9, 3], ['CAN', 0, 1, 2, 6], ['HKG', 0, 1, 3, 9]] },
      // The first round's TPE v IND and KOR v HKG carry over.
      { round: 'Round 2', group: '1', rows: [['TPE', 2, 0, 12, 1], ['KOR', 2, 0, 12, 5], ['IND', 0, 2, 2, 7], ['HKG', 0, 2, 4, 17]] },
      { round: 'Round 2', group: '2', rows: [['JPN', 2, 0, 10, 5], ['USA', 1, 1, 8, 5], ['CAN', 1, 1, 7, 8], ['AUS', 0, 2, 3, 10]] },
    ],
  }
}

const DEF: EditionDef = {
  slug: '2008', ordinal: null, years: [2008], hosts: ['Here'], events: [{ key: '2008-womens-baseball-world-cup', label: null }],
  groupLetters: { A: ['AUS', 'IND', 'TPE', 'USA'], B: ['CAN', 'HKG', 'JPN', 'KOR'], 1: ['HKG', 'IND', 'KOR', 'TPE'], 2: ['AUS', 'CAN', 'JPN', 'USA'] },
  placings: ['JPN', 'AUS', 'USA', 'CAN', 'TPE', 'KOR', 'IND', 'HKG'],
}

const site = (ed: CompendiumEdition, def = DEF) => buildWorldCupSite([{
  key: '2008-womens-baseball-world-cup', source: compendiumUrl(2008), games: compendiumGames(ed), batting: [], pitching: [], results_only: true,
}], { editions: [def] })

describe('the 2004 to 2008 compendium', () => {
  it('passes a transcription whose games add up to its tables', () => {
    expect(checkCompendium(edition())).toEqual([])
  })

  it('fails a mistyped score, in both rows it breaks', () => {
    const ed = edition()
    ed.games[0] = { ...ed.games[0], home_score: 6 }
    const problems = checkCompendium(ed)
    expect(problems.some(p => p.includes('USA is 1-0-5-1'))).toBe(true)
    expect(problems.some(p => p.includes('AUS is 0-1-1-5'))).toBe(true)
  })

  it('fails a game number missing from both the games and the rainouts', () => {
    const ed = { ...edition(), canceled: [7] }
    expect(checkCompendium(ed)).toContain('2008: game numbers are not 1 to 11, each once')
  })

  it('links each edition to its own page of the PDF, and reads the year back', () => {
    expect(compendiumYearOf(compendiumUrl(2006))).toBe(2006)
    expect(compendiumYearOf('https://www.wbsc.org/en/events/x')).toBeNull()
  })

  it('builds a results-only edition: no game pages, no innings, a pool the rain split put back together', () => {
    const { editions, errors } = site(edition())
    expect(errors).toEqual([])
    const [, round2] = editions[0].stages
    expect(round2.groups.map(x => x.label)).toEqual(['Group 1', 'Group 2'])
    // TPE and KOR never met: the final standings break the tie, as the compendium's table does.
    expect(round2.groups[0].standings.map(r => r.team)).toEqual(['TPE', 'KOR', 'IND', 'HKG'])
    const all = editions[0].stages.flatMap(s => s.groups.flatMap(x => x.games))
    expect(all.every(x => !x.page && !x.forfeit && x.innings === null && x.url === compendiumUrl(2008))).toBe(true)
    expect(editions[0].medals).toEqual({ gold: 'JPN', silver: 'AUS', bronze: 'USA' })
  })

  it('takes the medals from the final standings when no game decided them (2006)', () => {
    const ed = edition()
    ed.games = ed.games.filter(x => x.round === 'Opening Round')
    const def: EditionDef = { ...DEF, groupLetters: { A: DEF.groupLetters!.A, B: DEF.groupLetters!.B } }
    expect(site(ed, def).editions[0].medals).toEqual({ gold: 'JPN', silver: 'AUS', bronze: 'USA' })
  })
})
