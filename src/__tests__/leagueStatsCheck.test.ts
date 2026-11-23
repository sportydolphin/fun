import { describe, it, expect } from 'vitest'
// The script imported rather than reimplemented: its reading of the league's page IS the check.
import { BATTING_COLS, FIELDING_COLS, PITCHING_COLS, compareTable, emptyNotice, ipToOuts, pageName, parseSeasonTables, slugOf, tradedIn } from '../../scripts/check-wpbl-league-stats'

// The markup of a league player page as served Nov 23, 2026, cut to the parts the check reads.
const th = (abbr: string) => `<th scope="col"><abbr title="x">${abbr}</abbr></th>`
const table = (h3: string, cols: string[], rows: string[][]) => `
  <h3>${h3}</h3>
  <div class="wpbl-player-stats__scroll"><table class="wpbl-player-stats__table">
    <thead><tr><th scope="col">Split</th>${cols.map(th).join('')}</tr></thead>
    <tbody>${rows.map(([label, ...cells]) => `<tr><th scope="row">${label}</th>${cells.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>`
const BAT = ['G', 'AB', 'R', 'H', '2B', '3B', 'HR', 'RBI', 'BB', 'SO', 'SB', 'AVG', 'OBP', 'SLG', 'OPS']
const PIT = ['G', 'GS', 'W', 'L', 'ERA', 'IP', 'H', 'R', 'ER', 'BB', 'SO', 'HR', 'SV']
const PAGE = `
  <h1 class="wpbl-player-bio__name">Kelsie Whitmore</h1>
  <h2>Season Statistics</h2>
  ${table('Batting', BAT, [['2026 · San Francisco Firebells', '15', '51', '21', '23', '2', '0', '11', '31', '10', '5', '1', '.451', '.531', '1.137', '1.669']])}
  ${table('Pitching', PIT, [['2026 · San Francisco Firebells', '6', '6', '3', '1', '5.25', '24.0', '33', '19', '18', '13', '15', '4', '0']])}
  <h2>Game Log</h2>
  ${table('Ignored', ['AB'], [['Sep 4', '4']])}`

const ourBatting = { g: 15, ab: 51, r: 21, h: 23, doubles: 2, triples: 0, hr: 11, rbi: 31, bb: 10, so: 5, sb: 1,
  avg: 23 / 51, obp: 34 / 64, slg: 58 / 51, ops: 34 / 64 + 58 / 51 }
// 18 ER in 72 outs on the 7-inning basis is 5.25; the old 9-inning basis would be 6.75.
const ourPitching = { g: 6, gs: 6, w: 3, l: 1, era: 5.25, outs: 72, h: 33, r: 19, er: 18, bb: 13, so: 15, hr: 4, s: 0 }
const who = (group: string) => ({ player: 'Kelsie Whitmore', scope: 'regular', group })

describe('parseSeasonTables', () => {
  it('reads each season table by its heading and stops at the game log', () => {
    const t = parseSeasonTables(PAGE)
    expect([...t.keys()]).toEqual(['batting', 'pitching'])
    expect(t.get('batting')!.header).toEqual(BAT)
    expect(t.get('pitching')!.rows[0]).toEqual({ label: '2026 · San Francisco Firebells', cells: ['6', '6', '3', '1', '5.25', '24.0', '33', '19', '18', '13', '15', '4', '0'] })
  })
  it('finds nothing on a page without the section', () => {
    expect(parseSeasonTables('<h1>Not found</h1>').size).toBe(0)
  })
})

describe('compareTable', () => {
  const t = parseSeasonTables(PAGE)
  const cols = (keys: string[], rates: string[] = []) => Object.fromEntries(keys.map(k => [k, { ours: k.toLowerCase(), kind: rates.includes(k) ? 'rate3' as const : 'count' as const }]))

  it('passes a line that matches', () => {
    expect(compareTable(t.get('batting'), BATTING_COLS, ourBatting, 2026, who('batting'))).toEqual({ gaps: [], error: null })
  })

  it('catches the ERA basis', () => {
    const r = compareTable(t.get('pitching'), PITCHING_COLS, { ...ourPitching, era: 6.75 }, 2026, who('pitching'))
    expect(r.gaps).toEqual([{ ...who('pitching'), stat: 'ERA', league: '5.25', ours: '6.75' }])
  })

  it('compares innings as outs', () => {
    const r = compareTable(t.get('pitching'), PITCHING_COLS, { ...ourPitching, outs: 71 }, 2026, who('pitching'))
    expect(r.gaps).toEqual([{ ...who('pitching'), stat: 'IP', league: '24.0', ours: '23.2' }])
  })

  it('reports a line only one side has', () => {
    expect(compareTable(undefined, cols(['G']), { g: 3 }, 2026, who('fielding')).gaps[0]).toMatchObject({ stat: 'line', league: 'none' })
    expect(compareTable(t.get('batting'), cols(['G']), null, 2026, who('batting')).gaps[0]).toMatchObject({ stat: 'line', ours: 'none' })
  })

  it('calls a missing column a layout change, not a pass', () => {
    expect(compareTable(t.get('batting'), cols(['G', 'WAR']), { g: 15 }, 2026, who('batting')).error).toMatch(/WAR/)
  })

  it('sums the counts of two club rows and leaves the rates alone', () => {
    const split = parseSeasonTables(`<h2>Season Statistics</h2>${table('Batting', ['G', 'AB', 'AVG'], [
      ['2026 · Boston Hunters', '5', '20', '.250'], ['2026 · Los Angeles Queens', '7', '25', '.400']])}`)
    expect(compareTable(split.get('batting'), cols(['G', 'AB', 'AVG'], ['AVG']), { g: 12, ab: 45, avg: 0.1 }, 2026, who('batting')).gaps).toEqual([])
  })

  it('reads a rate to the printed precision', () => {
    const r = compareTable(t.get('batting'), cols(['OBP'], ['OBP']), { obp: 0.5314 }, 2026, who('batting'))
    expect(r.gaps).toEqual([])
    expect(compareTable(t.get('batting'), cols(['OBP'], ['OBP']), { obp: 0.5325 }, 2026, who('batting')).gaps).toHaveLength(1)
  })
})

describe('names and innings', () => {
  it('turns printed innings into outs', () => {
    expect([ipToOuts('24.0'), ipToOuts('6.2'), ipToOuts('0.1')]).toEqual([72, 20, 1])
  })
  it('makes the site slug from a name', () => {
    expect(slugOf("Mo'ne Davis")).toBe('mone-davis')
    expect(slugOf('Maïka Dumais')).toBe('maika-dumais')
    expect(slugOf('Maria Jose Valenzuela')).toBe('maria-jose-valenzuela')
  })
  it('reads the name from the page heading', () => {
    expect(pageName(PAGE)).toBe('kelsie whitmore')
  })
})

describe('what the league leaves out', () => {
  it('treats a no-chance fielding row and no fielding line as the same thing', () => {
    const dh = parseSeasonTables(`<h2>Season Statistics</h2>${table('Fielding', ['G', 'GS', 'PO', 'A', 'E', 'TC', 'DP', 'FPCT'], [['2026 · Boston Hunters', '1', '0', '0', '0', '0', '0', '0', '—']])}`)
    expect(compareTable(dh.get('fielding'), FIELDING_COLS, null, 2026, who('fielding')).gaps).toEqual([])
  })
  it('does not compare the saves and double plays the league never fills', () => {
    expect(Object.keys(PITCHING_COLS)).not.toContain('SV')
    expect(Object.keys(FIELDING_COLS)).not.toContain('DP')
  })
  it('reads the page saying it has no line', () => {
    expect(emptyNotice('<p>No statistics available for 2026 · Postseason.</p>')).toBe('No statistics available for 2026 · Postseason.')
    expect(emptyNotice('<p>Statistics are temporarily unavailable.</p>')).toBe('Statistics are temporarily unavailable.')
    expect(emptyNotice(PAGE)).toBeNull()
  })
  it('finds a trade in the season, and only that season', () => {
    const tx = '<table class="wpbl-transactions__table"><tr><td>Aug 21, 2026</td><td>Traded from New York to Los Angeles</td></tr></table>'
    expect(tradedIn(tx, 2026)).toBe(true)
    expect(tradedIn(tx, 2027)).toBe(false)
    expect(tradedIn(PAGE, 2026)).toBe(false)
  })
})
