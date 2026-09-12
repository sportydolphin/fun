import { describe, it, expect } from 'vitest'
import { buildWpblComparison, rankCompareCandidates } from '../derive/compare'
import type {
  WpblBattingLine, WpblPitchingLine, WpblGame, WpblTeam, WpblPlayer,
} from '../types'
import type { WpblMatchupPlay } from '../derive/matchups'

// The comparison page's arithmetic, and specifically the four ways it could quietly lie about
// two people. Every one of these renders perfectly and is wrong:
//
//   - a tick handed to whoever HAS a number when the other has none;
//   - a postseason line folded into a season total, which is the section's standing trap;
//   - a batting card for two pitchers who have never batted, all zeroes, implying a contest;
//   - a head-to-head built from the filtered play read, where the outs never arrived.

const teams: WpblTeam[] = [{ id: 'SF' } as WpblTeam, { id: 'LA' } as WpblTeam]

const A = { id: 'a', name: 'Val Perez', team_id: 'SF', position: 'CF' } as WpblPlayer
const B = { id: 'b', name: 'Liz Gilder', team_id: 'LA', position: 'RHP' } as WpblPlayer

/** A regular-season schedule of `n` games, plus one postseason game with id 'post'. */
const schedule = (n: number, withPostseason = false): WpblGame[] => {
  const games = Array.from({ length: n }, (_, i) => ({
    id: `g${i}`, status: 'final', home_team_id: 'SF', away_team_id: 'LA',
    game_type: 'regular', counts_in_standings: true,
  } as WpblGame))
  if (withPostseason) {
    games.push({
      id: 'post', status: 'final', home_team_id: 'SF', away_team_id: 'LA',
      // The feed sends `counts_in_standings: true` on postseason rows, so the game_type
      // backstop is the only thing holding these out. See CLAUDE.md.
      game_type: 'postseason', counts_in_standings: true,
    } as WpblGame)
  }
  return games
}

const bat = (o: Partial<WpblBattingLine> = {}): WpblBattingLine => ({
  id: Math.random().toString(36).slice(2), game_id: 'g0', player_id: 'a', team_id: 'SF',
  batting_order: 1, position: 'CF',
  ab: 0, r: 0, h: 0, doubles: 0, triples: 0, hr: 0, rbi: 0, bb: 0, so: 0,
  hbp: 0, sb: 0, cs: 0, sf: 0, sh: 0, ibb: 0, gdp: 0, ...o,
} as WpblBattingLine)

const pit = (o: Partial<WpblPitchingLine> = {}): WpblPitchingLine => ({
  id: Math.random().toString(36).slice(2), game_id: 'g0', player_id: 'b', team_id: 'LA',
  outs: 0, bf: 0, h: 0, r: 0, er: 0, bb: 0, so: 0, hr: 0, pitches: 0, strikes: 0,
  decision: null, gs: 0, hbp: 0, ibb: 0, wp: 0, bk: 0, doubles: 0, triples: 0, ...o,
} as WpblPitchingLine)

const play = (o: Partial<WpblMatchupPlay> = {}): WpblMatchupPlay => ({
  game_id: 'g0', batter_id: 'a', batter_name: 'Val Perez',
  pitcher_id: 'b', pitcher_name: 'Liz Gilder',
  event_type: 'groundout', narrative: null, ...o,
} as WpblMatchupPlay)

const build = (opts: Parameters<typeof buildWpblComparison>[2]) => buildWpblComparison(A, B, opts)
const rowFor = (
  c: ReturnType<typeof buildWpblComparison>, group: 'batting' | 'pitching', key: string,
) => {
  const g = c.groups.find(x => x.key === group)
  return [...(g?.playingTime ?? []), ...(g?.rate ?? []), ...(g?.counting ?? [])].find(r => r.key === key)
}

describe('who leads a row', () => {
  const games = schedule(10)

  it('names whoever is ahead, and knows ERA is not a high score', () => {
    const c = build({
      teams, games,
      batting: [],
      pitching: [
        pit({ player_id: 'a', outs: 60, er: 10, so: 10, bb: 5, h: 20 }),
        pit({ player_id: 'b', outs: 60, er: 4, so: 30, bb: 5, h: 12 }),
      ],
    })
    // Fewer earned runs over the same innings is the better ERA, so B leads on a 'low' row.
    expect(rowFor(c, 'pitching', 'era')?.leader).toBe('b')
    expect(rowFor(c, 'pitching', 'so')?.leader).toBe('b')
  })

  // THE ONE THAT WOULD SHIP. `(a ?? 0) > (b ?? 0)` reads as the obvious version and hands a
  // centre fielder who has never pitched the ERA row against an actual pitcher, on the
  // strength of having no ERA at all.
  it('names nobody when one side has no number', () => {
    const c = build({
      teams, games,
      batting: [bat({ player_id: 'a', ab: 30, h: 12 })],
      pitching: [pit({ player_id: 'b', outs: 60, er: 6, so: 20 })],
    })
    expect(rowFor(c, 'pitching', 'era')?.a).toBeNull()
    expect(rowFor(c, 'pitching', 'era')?.leader).toBeNull()
    expect(rowFor(c, 'batting', 'avg')?.leader).toBeNull()
  })

  // Playing time is shown as its own rows now (Stathead's order), but it is never a win: more
  // games or more innings is the context every tick is read against, not a tick of its own.
  it('never hands a tick to more playing time', () => {
    const c = build({
      teams, games,
      batting: [bat({ player_id: 'a', ab: 50, h: 15 }), bat({ player_id: 'b', ab: 4, h: 1 })],
      pitching: [pit({ player_id: 'a', outs: 60, gs: 8 }), pit({ player_id: 'b', outs: 9 })],
    })
    for (const key of ['g', 'pa']) expect(rowFor(c, 'batting', key)?.leader).toBeNull()
    for (const key of ['g', 'gs', 'ip']) expect(rowFor(c, 'pitching', key)?.leader).toBeNull()
    // And the numbers are still there to read.
    expect(rowFor(c, 'pitching', 'ip')?.aText).toBe('20.0')
  })

  it('names nobody on a tie', () => {
    const c = build({
      teams, games,
      batting: [
        bat({ player_id: 'a', ab: 20, h: 5 }),
        bat({ player_id: 'b', ab: 40, h: 10 }),
      ],
      pitching: [],
    })
    expect(rowFor(c, 'batting', 'avg')?.leader).toBeNull()
  })
})

// The rule percentiles.ts states for its own strip, pinned here because the failure is
// invisible: a walks-allowed row renders perfectly and hands the tick to whoever pitched less.
it('never ranks a counting stat where fewer is better', () => {
  const c = build({
    teams, games: schedule(10),
    batting: [bat({ player_id: 'a', ab: 30, h: 10, bb: 8 })],
    pitching: [pit({ player_id: 'b', outs: 60, er: 5, bb: 4 })],
  })
  for (const g of c.groups) {
    expect(g.counting.every(r => r.better === 'high')).toBe(true)
  }
})

describe('the season totals', () => {
  // The standing trap: a box-score line carries only a game_id, so it cannot say for itself
  // whether it belongs in a season total. `buildWpblComparison` takes the schedule for exactly
  // this reason and hands it to sumBatting, which does the excluding.
  it('leaves a postseason line out of both columns', () => {
    const games = schedule(10, true)
    const c = build({
      teams, games,
      batting: [
        bat({ player_id: 'a', game_id: 'g0', ab: 4, h: 2, hr: 1 }),
        bat({ player_id: 'a', game_id: 'post', ab: 4, h: 4, hr: 3 }),
        bat({ player_id: 'b', game_id: 'g1', ab: 4, h: 1 }),
      ],
      pitching: [],
    })
    expect(rowFor(c, 'batting', 'hr')?.a).toBe(1)
    expect(rowFor(c, 'batting', 'h')?.a).toBe(2)
    // Playing time is now its own rows, and the postseason game is out of both.
    expect(rowFor(c, 'batting', 'g')?.aText).toBe('1')
    expect(rowFor(c, 'batting', 'pa')?.aText).toBe('4')
  })
})

describe('which groups appear', () => {
  const games = schedule(10)

  // A pitcher who never bats still carries a batting LINE for every game she appeared in, all
  // of them zeroes. On `g > 0` that is a full card of dashes implying a contest nobody entered.
  it('drops the batting card when neither of them has batted', () => {
    const c = build({
      teams, games,
      batting: [bat({ player_id: 'a', ab: 0 }), bat({ player_id: 'b', ab: 0 })],
      pitching: [pit({ player_id: 'a', outs: 30, er: 3 }), pit({ player_id: 'b', outs: 30, er: 2 })],
    })
    expect(c.groups.map(g => g.key)).toEqual(['pitching'])
  })

  // The asymmetry is deliberate: one of them doing a thing the other does not IS the
  // comparison, and hiding the group would drop the half of the page about the pitcher.
  it('keeps a group one of them has to herself', () => {
    const c = build({
      teams, games,
      batting: [bat({ player_id: 'a', ab: 20, h: 6 })],
      pitching: [pit({ player_id: 'b', outs: 60, er: 5 })],
    })
    expect(c.groups.map(g => g.key).sort()).toEqual(['batting', 'pitching'])
  })

  it('leads with the group the pair has actually played', () => {
    const c = build({
      teams, games,
      // Sixty plate appearances of batting against three innings of mop-up pitching.
      batting: [bat({ player_id: 'a', ab: 55, h: 20 }), bat({ player_id: 'b', ab: 5 })],
      pitching: [pit({ player_id: 'b', outs: 9, er: 2 })],
    })
    expect(c.groups[0].key).toBe('batting')
  })
})

describe('the qualifying bar', () => {
  it('reports which side is short rather than hiding her rates', () => {
    const games = schedule(15)
    const c = build({
      teams, games,
      batting: [bat({ player_id: 'a', ab: 50, h: 15 }), bat({ player_id: 'b', ab: 4, h: 3 })],
      pitching: [],
    })
    const g = c.groups.find(x => x.key === 'batting')!
    expect(g.qualified).toEqual({ a: true, b: false })
    // The row is still there, with the number in it. A page that declines to say anything
    // about the short-sample player is worse than one that says it with the caveat attached.
    expect(rowFor(c, 'batting', 'avg')?.bText).toBe('.750')
    expect(g.barText).toBe('36 PA')
  })

  it('says the bar is not active yet in the first week of a season', () => {
    const c = build({
      teams, games: schedule(1),
      batting: [bat({ player_id: 'a', ab: 4, h: 2 })],
      pitching: [],
    })
    const g = c.groups.find(x => x.key === 'batting')!
    expect(g.barText).toBeNull()
    expect(g.qualified).toEqual({ a: false, b: false })
  })
})

describe('the head to head', () => {
  const games = schedule(10, true)

  it('counts the outs, not only the hits', () => {
    const c = build({
      teams, games, batting: [], pitching: [],
      plays: [
        play({ event_type: 'single' }),
        play({ event_type: 'groundout' }),
        play({ event_type: 'strikeout' }),
        play({ event_type: 'walk' }),
        play({ event_type: 'home_run' }),
      ],
    })
    const m = c.matchups.find(x => x.batter === 'a')!
    expect(m.pa).toBe(5)
    expect(m.ab).toBe(4)       // the walk is a PA and not an at-bat
    expect(m.h).toBe(2)
    expect(m.hr).toBe(1)
    expect(m.so).toBe(1)
    expect(m.avg).toBeCloseTo(0.5)
  })

  it('leaves a postseason at-bat out, like every other season total here', () => {
    const c = build({
      teams, games, batting: [], pitching: [],
      plays: [play({ event_type: 'single' }), play({ game_id: 'post', event_type: 'home_run' })],
    })
    expect(c.matchups[0].pa).toBe(1)
    expect(c.matchups[0].hr).toBe(0)
  })

  it('says nothing when they have never met', () => {
    const c = build({
      teams, games, batting: [], pitching: [],
      plays: [play({ pitcher_id: 'someone-else', pitcher_name: 'Someone Else' })],
    })
    expect(c.matchups).toEqual([])
  })

  // The league mints a new player_id on a trade, so a July at-bat is keyed on the id she held
  // then. Matching on the current id alone silently loses half of a traded player's record.
  it('finds an at-bat taken under a feed id she has since left behind', () => {
    const traded = { ...A, api_id: 'new-id', api_ids: ['old-id', 'new-id'] } as WpblPlayer
    const c = buildWpblComparison(traded, B, {
      teams, games, batting: [], pitching: [],
      plays: [play({ batter_id: 'old-id', event_type: 'double' })],
    })
    expect(c.matchups[0]?.h).toBe(1)
  })

  it('is absent, rather than empty, when the play log has not arrived', () => {
    const c = build({ teams, games, batting: [], pitching: [] })
    expect(c.matchups).toEqual([])
  })
})


// ─── Who the picker offers next ───────────────────────────────────────────────

describe('ranking who to compare her with', () => {
  const games = schedule(10)

  const person = (id: string, name: string, position: string): WpblPlayer =>
    ({ id, name, position, team_id: 'SF' } as WpblPlayer)

  // Three hitters with different playing time and two pitchers with different innings, so
  // both blocks have an order that can be checked.
  const HITTERS = [person('h1', 'Aaa Regular', 'CF'), person('h2', 'Bbb Bench', '1B'), person('h3', 'Ccc Everyday', 'SS')]
  const PITCHERS = [person('p1', 'Ddd Starter', 'RHP'), person('p2', 'Eee Reliever', 'LHP')]
  const ROSTER = [...HITTERS, ...PITCHERS]
  const LINES = {
    games,
    batting: [
      ...Array.from({ length: 40 }, () => bat({ player_id: 'h1', ab: 1 })),
      ...Array.from({ length: 5 }, () => bat({ player_id: 'h2', ab: 1 })),
      ...Array.from({ length: 60 }, () => bat({ player_id: 'h3', ab: 1 })),
    ],
    pitching: [
      pit({ player_id: 'p1', outs: 60, bf: 90, gs: 8 }),
      pit({ player_id: 'p2', outs: 21, bf: 30 }),
    ],
  }

  const order = (subject: WpblPlayer | null) =>
    rankCompareCandidates(subject, ROSTER, LINES).map(c => c.player.id)

  it('leads with her own half of the game', () => {
    // A hitter is offered hitters first; the pitchers are still there, underneath.
    expect(order(HITTERS[0]).slice(0, 2)).toEqual(['h3', 'h2'])
    // And a pitcher is offered pitchers first.
    expect(order(PITCHERS[1]).slice(0, 1)).toEqual(['p1'])
  })

  it('orders each block by how much she has played, most first', () => {
    // The starter's own block first (the one other pitcher), then every hitter by plate
    // appearances: 60, 40, 5.
    expect(order(PITCHERS[0])).toEqual(['p2', 'h3', 'h1', 'h2'])
  })

  // THE RULE THAT MADE THE LIST LOOK BROKEN WHEN IT WAS BROKEN. Ranked on batters faced while
  // the column printed innings, the pitchers came out 21.0 IP, 21.2 IP, 18.2, 15.2, 18.2: a
  // correct sort that no reader could verify. Every block must descend in the printed figure.
  it('prints the number it sorted on, so each block descends on screen', () => {
    for (const subject of [HITTERS[0], PITCHERS[0], null]) {
      const ranked = rankCompareCandidates(subject, ROSTER, LINES)
      for (const role of [true, false]) {
        const block = ranked.filter(c => c.pitcher === role).map(c => c.played)
        expect(block).toEqual([...block].sort((x, y) => y - x))
      }
    }
  })

  it('never offers her herself', () => {
    expect(order(HITTERS[2])).not.toContain('h3')
    expect(order(HITTERS[2])).toHaveLength(ROSTER.length - 1)
  })

  it('leads with hitters when nobody is chosen yet', () => {
    expect(order(null).slice(0, 3)).toEqual(['h3', 'h1', 'h2'])
  })

  it('prints innings for a pitcher and plate appearances for a hitter', () => {
    const ranked = rankCompareCandidates(null, ROSTER, LINES)
    expect(ranked.find(c => c.player.id === 'h3')?.playedText).toBe('60 PA')
    expect(ranked.find(c => c.player.id === 'p1')?.playedText).toBe('20.0 IP')
  })

  it('leaves a postseason game out of the playing time it ranks on', () => {
    const withPost = { ...LINES, games: schedule(10, true) }
    const ranked = rankCompareCandidates(null, ROSTER, {
      ...withPost,
      batting: [...LINES.batting, ...Array.from({ length: 30 }, () => bat({ player_id: 'h2', game_id: 'post', ab: 1 }))],
    })
    // Still last of the hitters: thirty postseason trips do not buy her a place above anyone.
    expect(ranked.filter(c => !c.pitcher).map(c => c.player.id)).toEqual(['h3', 'h1', 'h2'])
  })
})
