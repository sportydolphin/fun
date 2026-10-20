import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { checkBoxscore, checkGameList } from '../../../supabase/functions/wpbl-ingest/feed-contract'

// The feed contract against the 2026 feed as the league left it (fetched Oct 17, 2026, after the
// season ended; `presto_data.teams` and `.ranks` are trimmed from the list, a 2 KB season blob
// per row that nothing reads). Both directions matter: a contract the real feed fails pages the
// owner every two minutes all season, and one that waves a rename through is decoration.
// The whole 2026 feed (the list and all 71 box scores) passed when this was written; the four
// box scores kept here are one of each shape the ingest meets.

const FIXTURES = 'src/wpbl/__tests__/fixtures/feed-2026'
const load = (name: string) => JSON.parse(readFileSync(`${FIXTURES}/${name}.json`, 'utf8'))
const BOXES = ['box-regular-final-8-innings', 'box-postseason-final', 'box-not-started', 'box-bracket-tbd']

describe('the 2026 feed meets the contract', () => {
  it('the /games list', () => {
    const list = checkGameList(load('games'))
    expect(list.fatal).toBeNull()
    expect(list.breaks).toEqual([])
    expect(list.games).toHaveLength(list.count)
  })

  it.each(BOXES)('%s', name => {
    expect(checkBoxscore(load(name), name)).toEqual([])
  })
})

describe('the contract catches what the ingest would mirror quietly', () => {
  it('a renamed game_type, reported once with a count rather than once per row', () => {
    const body = load('games')
    for (const g of body.games) if (g.game_type === 'postSeason') g.game_type = 'playoffs'
    const { breaks, fatal, games } = checkGameList(body)
    expect(fatal).toBeNull()
    expect(breaks).toHaveLength(1)
    expect(breaks[0]).toMatch(/^contract \/games game_type: .*"playoffs".*\(10 rows, e\.g\. /)
    // Reported, not dropped: blanking the bracket would be worse than mislabeling it.
    expect(games).toHaveLength(body.games.length)
  })

  it('a final with no completed_at, the field that does not go backwards', () => {
    const body = load('games')
    for (const g of body.games) delete g.completed_at
    const { breaks } = checkGameList(body)
    expect(breaks.join('\n')).toMatch(/a final without completed_at \(40 rows/)
  })

  it('a list with no count, which would switch the truncation guard off: fatal', () => {
    const body = load('games')
    delete body.count
    const { fatal, games } = checkGameList(body)
    expect(fatal).toMatch(/^contract \/games count: /)
    expect(games).toEqual([])
  })

  it('a list that is not a list: fatal', () => {
    expect(checkGameList({ count: 3, data: [] }).fatal).toMatch(/games/)
    expect(checkGameList(null).fatal).not.toBeNull()
  })

  it('a box score that lost its completion flag or a side', () => {
    const body = load('box-postseason-final')
    delete body.boxscore.status.complete
    body.boxscore.teams[1].side = 'visitor'
    const breaks = checkBoxscore(body, 'g1')
    expect(breaks.some(b => b.startsWith('contract boxscore g1 boxscore.status.complete:'))).toBe(true)
    expect(breaks.some(b => b.includes('boxscore.teams.1.side'))).toBe(true)
  })

  it('a renamed runs_scored, and a repeated play sequence (the upsert key)', () => {
    const body = load('box-regular-final-8-innings')
    body.boxscore.plays[3].runs = body.boxscore.plays[3].runs_scored
    delete body.boxscore.plays[3].runs_scored
    expect(checkBoxscore(body, 'g1').join('\n')).toMatch(/plays\.3\.runs_scored/)

    const dup = load('box-regular-final-8-innings')
    dup.boxscore.plays[5].sequence = dup.boxscore.plays[4].sequence
    expect(checkBoxscore(dup, 'g1').join('\n')).toMatch(/repeated play sequence/)
  })

  it('a box score response without its envelope', () => {
    expect(checkBoxscore({ game_status: 'Final' }, 'g1')).toEqual([expect.stringMatching(/^contract boxscore g1 boxscore: /)])
  })
})

describe('Deno runs the version the tests ran', () => {
  it('deno.json pins valibot to the exact version in package.json', () => {
    // The contract is imported as a bare 'valibot': node_modules under Vitest and tsc, the import
    // map under Deno. Two versions would mean these tests vouch for code that is not deployed.
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
    const deno = JSON.parse(readFileSync('supabase/functions/wpbl-ingest/deno.json', 'utf8'))
    const pinned = pkg.devDependencies?.valibot ?? pkg.dependencies?.valibot
    expect(pinned).toMatch(/^\d+\.\d+\.\d+$/)
    expect(deno.imports.valibot).toBe(`npm:valibot@${pinned}`)
  })
})
