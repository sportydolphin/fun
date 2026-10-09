// /mlb/compare: the address rules and the comparison's rules. The failures worth pinning are the
// quiet ones: a tick handed to the side with no number, a pitcher's empty hitting line drawn as a
// season of zeros, the postseason folded into a career record, and a pair URL that resolves to two
// different pages depending on spelling.
import { describe, it, expect } from 'vitest'
import {
  MLB_COMPARE_BASE, MLB_MORE_PAGES, mlbComparePath, mlbCompareCanonicalPath, mlbCompareStartPath,
  mlbCompareTargetFromPath, isMlbComparePage, isMlbPath, isMlbSection, MLB_STATIC_PATHS,
  mlbCompareSeasonFromSearch, withMlbCompareSeason,
} from '../routes'
import {
  buildMlbComparison, duelFromVsPlayer, rankMlbCompareCandidates, canBat, canPitch, mlbPairShape,
  type MlbCompareLines, type MlbCompareRow,
} from '../compare'

const witt = { id: 677951, fullName: 'Bobby Witt Jr.' }
const julio = { id: 677594, fullName: 'Julio Rodríguez' }

describe('compare addresses', () => {
  it('spells a pair in the order it was built, with each half a player slug', () => {
    expect(mlbComparePath(witt, julio)).toBe('/mlb/compare/bobby-witt-jr-677951-vs-julio-rodriguez-677594')
    expect(mlbCompareStartPath(julio)).toBe('/mlb/compare/julio-rodriguez-677594')
  })

  it('declares one canonical for both orders', () => {
    expect(mlbCompareCanonicalPath(witt, julio)).toBe(mlbCompareCanonicalPath(julio, witt))
    expect(mlbCompareCanonicalPath(julio, witt)).toBe(mlbComparePath(witt, julio))
  })

  it('reads the three states back, names or none', () => {
    expect(mlbCompareTargetFromPath(MLB_COMPARE_BASE)).toEqual({ kind: 'picker' })
    expect(mlbCompareTargetFromPath(`${MLB_COMPARE_BASE}/`)).toEqual({ kind: 'picker' })
    expect(mlbCompareTargetFromPath(mlbCompareStartPath(julio))).toEqual({ kind: 'single', id: 677594 })
    expect(mlbCompareTargetFromPath(mlbComparePath(witt, julio))).toEqual({ kind: 'pair', a: 677951, b: 677594 })
    expect(mlbCompareTargetFromPath('/mlb/compare/677951-vs-677594')).toEqual({ kind: 'pair', a: 677951, b: 677594 })
    // A name with digits in it still resolves on the id at its end.
    expect(mlbCompareTargetFromPath('/mlb/compare/a-2-b-12-vs-c-34')).toEqual({ kind: 'pair', a: 12, b: 34 })
  })

  it('refuses what names no page', () => {
    for (const p of ['/mlb/compare/nobody', '/mlb/compare/a/b', '/mlb/compare/677951-vs-677951', '/mlb/comparex']) {
      expect(mlbCompareTargetFromPath(p), p).toBeNull()
    }
  })

  // A past season rides in the query, and the current one is never written, so today's links do
  // not pin today's year.
  it('carries a season other than the current one, and only a real one', () => {
    const pair = mlbComparePath(witt, julio)
    expect(withMlbCompareSeason(pair, 2026, 2026)).toBe(pair)
    expect(withMlbCompareSeason(pair, 2023, 2026)).toBe(`${pair}?season=2023`)
    expect(mlbCompareSeasonFromSearch('?season=2023', 2026)).toBe(2023)
    for (const q of ['', '?season=2027', '?season=1850', '?season=23', '?season=abcd', '?season=2023.5']) {
      expect(mlbCompareSeasonFromSearch(q, 2026), q).toBe(2026)
    }
  })

  // Standalone like the glossary: the section is not mounted under it, but the shell is in MLB.
  it('is an MLB page the section does not render, in the More menu and the static list', () => {
    expect(isMlbComparePage(mlbComparePath(witt, julio))).toBe(true)
    expect(isMlbPath(MLB_COMPARE_BASE)).toBe(false)
    expect(isMlbSection(mlbComparePath(witt, julio))).toBe(true)
    expect(MLB_MORE_PAGES.map(p => p.href)).toContain(MLB_COMPARE_BASE)
    expect(MLB_STATIC_PATHS).toContain(MLB_COMPARE_BASE)
  })
})

const none = { hitting: null, pitching: null }
const lines = (l: Partial<MlbCompareLines>): MlbCompareLines => ({ hitting: null, pitching: null, saber: none, ...l })
const rowOf = (rows: MlbCompareRow[][], key: string) => rows.flat().find(r => r.key === key)!

const hitter = (o: Record<string, unknown> = {}) => ({
  gamesPlayed: 150, plateAppearances: 650, hits: 180, homeRuns: 30, rbi: 90, stolenBases: 20, runs: 100,
  doubles: 35, triples: 5, baseOnBalls: 60, totalBases: 315, strikeOuts: 120,
  avg: '.300', obp: '.370', slg: '.525', ops: '.895', ...o,
})
const pitcher = (o: Record<string, unknown> = {}) => ({
  gamesPlayed: 30, gamesStarted: 30, inningsPitched: '180.2', wins: 12, strikeOuts: 200, baseOnBalls: 45, saves: 0,
  era: '3.10', whip: '1.05', strikeoutsPer9Inn: '9.96', strikeoutWalkRatio: '4.44', battersFaced: 740, ...o,
})

describe('the comparison', () => {
  it('names a leader only where both sides have the number', () => {
    const groups = buildMlbComparison(lines({ hitting: hitter() }), lines({ pitching: pitcher() }))
    const bat = groups.find(g => g.key === 'batting')!
    const pit = groups.find(g => g.key === 'pitching')!
    expect(rowOf(bat.blocks, 'avg')).toMatchObject({ aText: '.300', bText: '—', leader: null })
    expect(rowOf(pit.blocks, 'era')).toMatchObject({ aText: '—', bText: '3.10', leader: null })
  })

  it('never lets playing time win', () => {
    const [bat] = buildMlbComparison(lines({ hitting: hitter() }), lines({ hitting: hitter({ plateAppearances: 300, gamesPlayed: 80 }) }))
    expect(bat.blocks[0].map(r => r.leader)).toEqual([null, null])
    expect(rowOf(bat.blocks, 'pa')).toMatchObject({ aText: '650', bText: '300' })
  })

  it('reads lower as better where it is, and ties as nobody', () => {
    const [pit] = buildMlbComparison(lines({ pitching: pitcher() }), lines({ pitching: pitcher({ era: '2.50', whip: '1.05', baseOnBalls: 60 }) }))
    expect(rowOf(pit.blocks, 'era').leader).toBe('b')
    expect(rowOf(pit.blocks, 'whip').leader).toBeNull()
    expect(rowOf(pit.blocks, 'pbb').leader).toBe('a')
    expect(rowOf(pit.blocks, 'ip').aText).toBe('180.2')
  })

  // StatsAPI files a pitcher who never batted with a hitting row of zeros.
  it('treats an empty line as no line, and leads with the bigger sample', () => {
    const groups = buildMlbComparison(
      lines({ hitting: hitter({ plateAppearances: 0, gamesPlayed: 3 }), pitching: pitcher() }),
      lines({ pitching: pitcher() }),
    )
    expect(groups.map(g => g.key)).toEqual(['pitching'])
    const mixed = buildMlbComparison(lines({ hitting: hitter({ plateAppearances: 40 }) }), lines({ pitching: pitcher() }))
    expect(mixed.map(g => g.key)).toEqual(['pitching', 'batting'])
  })

  it('carries the advanced block, and a dash for StatsAPI\'s undefined rates', () => {
    const [bat] = buildMlbComparison(
      lines({ hitting: hitter({ avg: '.---' }), saber: { hitting: { war: 6.4, wRcPlus: 151.2 }, pitching: null } }),
      lines({ hitting: hitter(), saber: { hitting: { war: 4.1, wRcPlus: 128 }, pitching: null } }),
    )
    expect(rowOf(bat.blocks, 'avg')).toMatchObject({ aText: '—', leader: null })
    expect(rowOf(bat.blocks, 'wrc+')).toMatchObject({ aText: '151', bText: '128', leader: 'a' })
    expect(rowOf(bat.blocks, 'bwar')).toMatchObject({ aText: '6.4', leader: 'a' })
  })

  it('has no overall winner to draw', () => {
    const groups = buildMlbComparison(lines({ hitting: hitter() }), lines({ hitting: hitter() }))
    expect(Object.keys(groups[0]).sort()).toEqual(['blocks', 'key', 'label'])
  })
})

// The shape StatsAPI answers `stats=vsPlayer&gameType=R,F,D,L,W` in: a split per season per type.
const vs = (splits: { season: string; gameType: string; pa: number; ab: number; h: number; hr?: number; bb?: number; so?: number }[]) => ({
  stats: [
    { type: { displayName: 'vsPlayer' }, splits: splits.map(s => ({ season: s.season, gameType: s.gameType, stat: {
      plateAppearances: s.pa, atBats: s.ab, hits: s.h, homeRuns: s.hr ?? 0, baseOnBalls: s.bb ?? 0, strikeOuts: s.so ?? 0,
    } })) },
    // Repeated per group, and ignored.
    { type: { displayName: 'vsPlayerTotal' }, splits: [{ gameType: 'R', stat: { plateAppearances: 999 } }] },
  ],
})

describe("the pair's skeleton", () => {
  // The bios land before the lines; until they do, the commonest pair, two hitters.
  it('reserves the cards the two positions will draw', () => {
    expect(mlbPairShape([])).toEqual({ groups: ['batting'], duel: false })
    expect(mlbPairShape(['6', undefined])).toEqual({ groups: ['batting'], duel: false })
    expect(mlbPairShape(['6', '8'])).toEqual({ groups: ['batting'], duel: false })
    expect(mlbPairShape(['1', '1'])).toEqual({ groups: ['pitching'], duel: false })
    expect(mlbPairShape(['1', '6'])).toEqual({ groups: ['batting', 'pitching'], duel: true })
    expect(mlbPairShape(['Y', '1'])).toEqual({ groups: ['batting', 'pitching'], duel: true })
  })
})

describe('the head to head', () => {
  it('sums this season, the career and the postseason apart', () => {
    const d = duelFromVsPlayer(vs([
      { season: '2024', gameType: 'R', pa: 10, ab: 9, h: 3, hr: 1, bb: 1 },
      { season: '2026', gameType: 'R', pa: 4, ab: 4, h: 1, so: 2 },
      { season: '2026', gameType: 'D', pa: 3, ab: 3, h: 0 },
      { season: '2026', gameType: 'F', pa: 2, ab: 1, h: 1, bb: 1 },
    ]), 2026, 'a')!
    expect(d.season).toEqual({ pa: 4, ab: 4, h: 1, hr: 0, bb: 0, so: 2 })
    expect(d.career).toEqual({ pa: 14, ab: 13, h: 4, hr: 1, bb: 1, so: 2 })
    expect(d.postseason).toEqual({ pa: 5, ab: 4, h: 1, hr: 0, bb: 1, so: 0 })
  })

  it('is nothing when they never met, and only October when that is all there is', () => {
    expect(duelFromVsPlayer(vs([]), 2026, 'a')).toBeNull()
    expect(duelFromVsPlayer({}, 2026, 'a')).toBeNull()
    const d = duelFromVsPlayer(vs([{ season: '2023', gameType: 'D', pa: 3, ab: 3, h: 1 }]), 2026, 'b')!
    expect(d).toMatchObject({ batter: 'b', season: null, career: null })
    expect(d.postseason?.pa).toBe(3)
  })

  it('asks only where a duel can exist', () => {
    const nothing = lines({})
    expect(canPitch('6', nothing)).toBe(false)
    expect(canPitch('1', nothing)).toBe(true)
    expect(canPitch('Y', nothing)).toBe(true)
    expect(canPitch('8', lines({ pitching: pitcher({ inningsPitched: '1.0' }) }))).toBe(true)
    expect(canBat('1', nothing)).toBe(false)
    expect(canBat('1', lines({ hitting: hitter({ plateAppearances: 2 }) }))).toBe(true)
    expect(canBat('Y', nothing)).toBe(true)
  })
})

describe('who the picker offers', () => {
  const split = (id: number, name: string, code: string, stat: Record<string, unknown>) =>
    ({ player: { id, fullName: name }, team: { id: 118 }, position: { code, abbreviation: code === '1' ? 'P' : 'SS' }, stat })
  const hitting = [
    split(1, 'Ann Short', '6', { plateAppearances: 100 }),
    split(2, 'Bea Long', '6', { plateAppearances: 600 }),
    split(3, 'Cy Arm', '1', { plateAppearances: 2 }),
  ]
  const pitchingPool = [split(3, 'Cy Arm', '1', { inningsPitched: '150.1' }), split(4, 'Di Pen', '1', { inningsPitched: '60.0' })]

  it('leads with hitters by plate appearances, then pitchers by innings, before a subject', () => {
    const c = rankMlbCompareCandidates(null, hitting, pitchingPool)
    expect(c.map(x => x.id)).toEqual([2, 1, 3, 4])
    expect(c.map(x => x.playedText)).toEqual(['600 PA', '100 PA', '150.1 IP', '60.0 IP'])
  })

  it('leads with the subject\'s own role, and leaves the subject out', () => {
    expect(rankMlbCompareCandidates(4, hitting, pitchingPool).map(x => x.id)).toEqual([3, 2, 1])
  })
})
