import { describe, it, expect } from 'vitest'
import { computeStandings } from '../api'
import {
  seedingRace, semifinalLabel, bracketIsSet, magicOver, swingGames,
  clinchedSeeds, bestReachableSeed, finishesAhead,
} from '../derive/seeding'
import type { WpblGame, WpblStandingRow, WpblTeam } from '../types'

// The seeding race is the only frame the last regular-season games have. All four clubs
// qualify, so nothing here is about making the playoffs and everything is about which pairing
// you land in. These pin the two claims a fan will repeat out loud: "they need N more" and
// "they can't finish below third". Both are stated OUTRIGHT, with no head-to-head tiebreak
// leaned on, so a magic number that reaches 0 can never be undone by a tiebreak going the
// other way.

const team = (id: string): WpblTeam => ({
  id, city: id, name: id, abbr: id,
  color: null, color_secondary: null, logo_url: null,
  sort_order: 0, api_id: null, created_at: '',
})
const TEAMS = ['SF', 'NY', 'LA', 'BOS'].map(team)

let seq = 0
const game = (home: string, away: string, hs: number | null, as: number | null): WpblGame => ({
  id: `g${seq++}`,
  game_date: `2026-08-${String((seq % 28) + 1).padStart(2, '0')}`, start_time: '6:30 PM',
  home_team_id: home, away_team_id: away,
  venue: null,
  status: hs == null ? 'scheduled' : 'final',
  home_score: hs, away_score: as, innings: 7, notes: null,
  created_at: '', updated_at: '',
  game_type: 'regular', counts_in_standings: true,
})

// Records straight into standings rows rather than reverse-engineering a fixture list that
// produces them. `seedingRace` takes the rows as given (they arrive pre-sorted and pre-broken
// from `computeStandings`), so a scenario is exactly a table of records plus games left.
type Spec = { id: string; w: number; l: number; left: number }

const rowFor = (s: Spec): WpblStandingRow => ({
  team: team(s.id), wins: s.w, losses: s.l, runsFor: 0, runsAgainst: 0,
  pct: s.w + s.l ? s.w / (s.w + s.l) : 0,
  gamesBack: 0, streak: null, lastTen: { wins: 0, losses: 0 }, recent: [],
})

// The unplayed games each club has left. The opponent is a club outside the four, which the
// remaining-count ignores, so a spec can give each club its own number without having to
// balance a real schedule.
const race = (spec: Spec[]) => {
  const games: WpblGame[] = []
  for (const s of spec) for (let i = 0; i < s.left; i++) games.push(game(s.id, 'XX', null, null))
  return seedingRace(spec.map(rowFor), games)
}

// The standard mid-race shape: SF clear, NY second, LA and BOS trailing, three games each left.
const MID: Spec[] = [
  { id: 'SF', w: 10, l: 2, left: 3 },
  { id: 'NY', w: 8, l: 4, left: 3 },
  { id: 'LA', w: 5, l: 7, left: 3 },
  { id: 'BOS', w: 3, l: 9, left: 3 },
]

describe('magicOver', () => {
  it('counts down on either a win or a rival loss', () => {
    expect(magicOver({ wins: 8 }, { maxWins: 12 })).toBe(5)
    expect(magicOver({ wins: 9 }, { maxWins: 12 })).toBe(4)  // won one
    expect(magicOver({ wins: 8 }, { maxWins: 11 })).toBe(4)  // rival lost one
  })

  it('reaches 0 only once the rival cannot match the win total, tiebreak or not', () => {
    expect(magicOver({ wins: 10 }, { maxWins: 10 })).toBe(1) // a tie is still possible
    expect(magicOver({ wins: 11 }, { maxWins: 10 })).toBe(0)
  })

  it('never goes negative once the race is long over', () => {
    expect(magicOver({ wins: 15 }, { maxWins: 4 })).toBe(0)
  })
})

describe('seedingRace', () => {
  it('numbers the seeds in standings order and pairs them 1v4, 2v3', () => {
    const rows = race(MID)
    expect(rows.map(r => [r.team.id, r.seed])).toEqual([['SF', 1], ['NY', 2], ['LA', 3], ['BOS', 4]])
    expect(rows.map(r => r.opponent?.id)).toEqual(['BOS', 'LA', 'NY', 'SF'])
  })

  // The seeds have to be whatever `computeStandings` says, tiebreaks included, or the card
  // could contradict the table it sits under.
  it('takes its order from computeStandings rather than re-deriving one', () => {
    const games = [
      game('BOS', 'SF', 6, 1), game('BOS', 'NY', 6, 1), game('BOS', 'LA', 6, 1),
      game('SF', 'NY', 4, 3), game('LA', 'NY', 4, 3),
      game('SF', 'LA', null, null),
    ]
    const rows = seedingRace(computeStandings(TEAMS, games), games)
    expect(rows[0].team.id).toBe('BOS')
    expect(rows[0].seed).toBe(1)
    expect(rows[0].opponent?.id).toBe(rows[3].team.id)
    expect(rows.find(r => r.team.id === 'SF')!.remaining).toBe(1)
  })

  it('counts scheduled and live games as still to be played, and finals as gone', () => {
    const games = [
      game('SF', 'NY', 5, 2),
      game('SF', 'LA', null, null),
      { ...game('SF', 'BOS', null, null), status: 'live' as const },
    ]
    const sf = seedingRace([rowFor({ id: 'SF', w: 1, l: 0, left: 0 })], games)[0]
    expect(sf.remaining).toBe(2)
    expect(sf.maxWins).toBe(3)
  })

  it('ignores postseason games, which are the thing being seeded', () => {
    const games = [
      game('SF', 'NY', 5, 2),
      { ...game('SF', 'NY', null, null), game_type: 'semifinal', counts_in_standings: false },
    ]
    const sf = seedingRace([rowFor({ id: 'SF', w: 1, l: 0, left: 0 })], games)[0]
    expect(sf.remaining).toBe(0)
  })

  it('quotes games ahead of the seed below and behind the seed above', () => {
    const rows = race(MID)
    expect(rows[0].aheadOfNext).toBe(2)
    expect(rows[0].behindPrev).toBeNull()
    expect(rows[1].behindPrev).toBe(2)
    expect(rows[3].aheadOfNext).toBeNull()
  })

  // The bottom seed has nobody to hold off, so "clinch no worse than fourth" is not a claim
  // worth printing. null keeps that out of the UI rather than rendering a permanent 0.
  it('gives the bottom seed no magic number', () => {
    expect(race(MID)[3].magic).toBeNull()
  })

  // What the bottom seed has instead. The card used to print a sentence here ("Can still reach
  // 3rd"), which was the one cell in the column not answering the column's question and the
  // longest string on the card. The climb is the same magic number asked about a different
  // seed, so it is priced by the same function.
  it('prices the bottom seed\u2019s climb to the best seed it can still reach', () => {
    const rows = race([
      { id: 'SF', w: 8, l: 4, left: 3 },
      { id: 'LA', w: 7, l: 6, left: 2 },
      { id: 'NY', w: 6, l: 7, left: 2 },
      { id: 'BOS', w: 4, l: 8, left: 3 },
    ])
    const bos = rows[3]
    // BOS tops out at 7 wins. LA already has 7 and SF 8, so only NY (ceiling 8) is catchable.
    expect(bos.bestPossible).toBe(3)
    // Which costs NY's ceiling of 8, minus BOS's 4, plus one: three BOS wins and two NY losses,
    // exactly the whole of what both clubs have left.
    expect(bos.climbMagic).toBe(5)
  })

  // A club already in the best seat it can reach has nothing to climb to, and printing a
  // climb number beside a defence number would put two answers in one cell.
  it('has no climb number for a club that cannot move up', () => {
    const rows = race(MID)
    // The top seed, which has nowhere to go.
    expect(rows[0].climbMagic).toBeNull()
    // And the third seed, which is the more interesting null: LA tops out at 8 wins and NY
    // already HAS 8, so LA can tie NY and can never pass it outright. Its ceiling is the seed
    // it is standing in, and the cell shows what it has to defend rather than a climb it
    // cannot make.
    expect(rows[2].climbMagic).toBeNull()
    expect(rows.map(r => r.climbMagic != null)).toEqual([false, true, false, true])
  })

  // Locking the top seed means holding off all three; locking second means holding off two,
  // so it can be clinched while the top seed is still live.
  it('prices the top seed against every rival and second against the cheapest two', () => {
    const rows = race([
      { id: 'SF', w: 11, l: 1, left: 3 },
      { id: 'NY', w: 9, l: 3, left: 3 },
      { id: 'LA', w: 4, l: 8, left: 3 },
      { id: 'BOS', w: 2, l: 10, left: 3 },
    ])
    // SF must clear NY's ceiling of 12: 12 - 11 + 1 = 2.
    expect(rows[0].magic).toBe(2)
    // NY is already clear of LA (7) and BOS (5), so second is locked even though first is not.
    expect(rows[1].magic).toBe(0)
    expect(rows[1].worstPossible).toBe(2)
  })

  it('reports the range of seeds still reachable', () => {
    const rows = race([
      { id: 'SF', w: 12, l: 0, left: 3 },
      { id: 'NY', w: 6, l: 6, left: 3 },
      { id: 'LA', w: 5, l: 7, left: 3 },
      { id: 'BOS', w: 1, l: 11, left: 3 },
    ])
    const sf = rows[0], bos = rows[3]
    expect([sf.bestPossible, sf.worstPossible]).toEqual([1, 1])   // untouchable
    expect([bos.bestPossible, bos.worstPossible]).toEqual([4, 4]) // and unreachable
    // NY and LA are a game apart with three each left, so either can take second or third.
    expect([rows[1].bestPossible, rows[1].worstPossible]).toEqual([2, 3])
    expect([rows[2].bestPossible, rows[2].worstPossible]).toEqual([2, 3])
  })

  it('settles the bracket only when no club can move', () => {
    expect(bracketIsSet(race(MID))).toBe(false)

    const done = race([
      { id: 'SF', w: 11, l: 4, left: 0 },
      { id: 'NY', w: 9, l: 6, left: 0 },
      { id: 'LA', w: 6, l: 9, left: 0 },
      { id: 'BOS', w: 4, l: 11, left: 0 },
    ])
    expect(bracketIsSet(done)).toBe(true)
    expect(done.every(r => r.magic === null || r.magic === 0)).toBe(true)
  })

  // A tie on the final day is settled by the standings tiebreak, not by this module's
  // "outright" range math, which puts both clubs on the LOWER of their two seeds. What must
  // hold is that the card still reads as finished rather than running a magic-number countdown
  // through the postseason it is meant to be introducing.
  it('settles a season that ended with two clubs level on record', () => {
    const done = race([
      { id: 'SF', w: 11, l: 4, left: 0 },
      { id: 'NY', w: 8, l: 7, left: 0 },
      { id: 'LA', w: 8, l: 7, left: 0 },
      { id: 'BOS', w: 3, l: 12, left: 0 },
    ])
    expect(bracketIsSet(done)).toBe(true)
    // Seeds come from the sort, so the tie is already broken by the time the card sees it.
    expect(done.map(r => [r.team.id, r.seed])).toEqual([['SF', 1], ['NY', 2], ['LA', 3], ['BOS', 4]])
  })

  // The two clubs that would meet are never adjacent on a list sorted by seed, so the letter
  // is the only thing pairing them on screen.
  it('marks the two clubs of a semifinal with the same letter', () => {
    expect([1, 2, 3, 4].map(semifinalLabel)).toEqual(['A', 'B', 'B', 'A'])
    expect(semifinalLabel(5)).toBeNull()
  })

  // Before a pitch is thrown every club is 0-0 and the sort is arbitrary, so the card must not
  // claim anything: every seed is reachable by everyone.
  it('says nothing is decided on opening day', () => {
    const rows = race([
      { id: 'SF', w: 0, l: 0, left: 15 },
      { id: 'NY', w: 0, l: 0, left: 15 },
      { id: 'LA', w: 0, l: 0, left: 15 },
      { id: 'BOS', w: 0, l: 0, left: 15 },
    ])
    for (const r of rows) {
      expect(r.bestPossible).toBe(1)
      expect(r.worstPossible).toBe(4)
    }
    expect(bracketIsSet(rows)).toBe(false)
  })
})

// The line under the table, which is the only thing on the card that says WHEN the order gets
// decided rather than what it would take. Both conditions are load-bearing and both are about
// keeping a game off this line rather than putting one on it.
describe('swingGames', () => {
  const SPEC: Spec[] = [
    { id: 'SF', w: 8, l: 4, left: 0 },
    { id: 'LA', w: 7, l: 6, left: 0 },
    { id: 'NY', w: 6, l: 7, left: 0 },
    { id: 'BOS', w: 4, l: 8, left: 0 },
  ]
  // `remaining` is read off the schedule, so a scenario is the records plus real fixtures.
  const withGames = (games: WpblGame[]) => swingGames(seedingRace(SPEC.map(rowFor), games), games)

  it('names a game between two clubs arguing over the same seed', () => {
    const g = game('LA', 'NY', null, null)
    expect(withGames([g]).map(s => s.game.id)).toEqual([g.id])
  })

  it('ignores a game between clubs two seeds apart, which decides no single seat', () => {
    expect(withGames([game('SF', 'NY', null, null)])).toEqual([])
  })

  // The point of the strictness: in the last week most of the remaining fixtures are dead
  // rubbers as far as the ORDER goes, and a line naming one of those is worse than no line.
  it('ignores a pair whose order is already settled outright', () => {
    // NY tops out at 6 wins here, below BOS's current 7, so third and fourth are decided
    // however this game goes.
    const decided: Spec[] = [
      { id: 'SF', w: 9, l: 3, left: 0 },
      { id: 'LA', w: 8, l: 4, left: 0 },
      { id: 'BOS', w: 7, l: 5, left: 1 },
      { id: 'NY', w: 5, l: 7, left: 1 },
    ]
    const g = game('BOS', 'NY', null, null)
    expect(swingGames(seedingRace(decided.map(rowFor), [g]), [g])).toEqual([])
  })

  it('drops games that have been played and games outside the regular season', () => {
    const played = game('LA', 'NY', 5, 4)
    const post = { ...game('LA', 'NY', null, null), game_type: 'semifinal', counts_in_standings: false }
    expect(withGames([played, post])).toEqual([])
  })

  // Date order, because the card prints the first one and counts the rest. Compared as strings:
  // these are naive calendar days, and turning one into a Date moves it a day in half the world.
  it('returns them oldest first', () => {
    const later = { ...game('SF', 'LA', null, null), game_date: '2026-09-05' }
    const sooner = { ...game('LA', 'NY', null, null), game_date: '2026-09-03' }
    expect(withGames([later, sooner]).map(s => s.game.game_date)).toEqual(['2026-09-03', '2026-09-05'])
  })

  it('marks which club is the better seed, whoever is at home', () => {
    const s = withGames([game('NY', 'LA', null, null)])[0]
    expect([s.higher.team.id, s.lower.team.id]).toEqual(['LA', 'NY'])
  })
})

// ─── The tiebreak, which the magic numbers above deliberately do not know ────
//
// Everything above is stated OUTRIGHT: a magic number that reaches zero can never be undone by
// a tiebreak going the other way, which is the right caution for a number a fan quotes at
// somebody. A CLINCH is the opposite kind of claim. Reading it pessimistically does not make it
// safe, it makes it wrong, and on Sep 3, 2026 it was wrong in both directions on the same card:
// San Francisco had banked the top seed and the site said "1 to lock", while Boston had not
// banked fourth and the site said "Seed set".
describe('clinchedSeeds and the head-to-head tiebreak', () => {
  const won = (w: string, l: string, n: number) =>
    Array.from({ length: n }, () => game(w, l, 6, 1))
  const toPlay = (h: string, a: string) => game(h, a, null, null)
  const seedsFor = (games: WpblGame[]) => seedingRace(computeStandings(TEAMS, games), games)

  /**
   * THE REAL TABLE ON Sep 3, 2026, and balanced the way a real season is: every pair meets five
   * times, so every club plays fifteen and has thirteen behind it. That matters more than it
   * looks. `computeStandings` sorts on win PERCENTAGE, so a fixture where clubs have played
   * different numbers of games can put a 7-3 club above a 9-5 one, and an earlier draft of these
   * tests did exactly that and quietly asked the wrong question.
   *
   *   SF 9-4   LA 7-6   NY 6-7   BOS 4-9,   two to play each
   *   head to head: SF-LA 3-2 (done)   NY-BOS 3-2 to BOS (done)
   *                 SF-NY 2-2, SF-BOS 4-0, LA-NY 2-2, LA-BOS 3-1 (one left in each)
   */
  const season = () => [
    ...won('SF', 'LA', 3), ...won('LA', 'SF', 2),
    ...won('SF', 'NY', 2), ...won('NY', 'SF', 2), toPlay('NY', 'SF'),
    ...won('SF', 'BOS', 4), toPlay('SF', 'BOS'),
    ...won('LA', 'NY', 2), ...won('NY', 'LA', 2), toPlay('LA', 'NY'),
    ...won('LA', 'BOS', 3), ...won('BOS', 'LA', 1), toPlay('BOS', 'LA'),
    ...won('NY', 'BOS', 2), ...won('BOS', 'NY', 3),
  ]

  it('reproduces the table it is built from', () => {
    const seeds = seedsFor(season())
    expect(seeds.map(s => `${s.team.id} ${s.wins}-${s.losses}`))
      .toEqual(['SF 9-4', 'LA 7-6', 'NY 6-7', 'BOS 4-9'])
    expect(seeds.every(s => s.remaining === 2)).toBe(true)
  })

  // Los Angeles' ceiling is 9 and San Francisco's floor is 9, so the only way LA catch them is a
  // 9-6 tie, and SF hold that series 3-2 with nothing left in it. The top seed is banked, and
  // the site said "1 to lock".
  it('clinches a seed a club can only be TIED for, when it holds the completed series', () => {
    const games = season()
    expect(clinchedSeeds(seedsFor(games), games).get('SF')).toBe(1)
  })

  it('leaves the same club unclinched while that series still has a game in it', () => {
    // Identical, except one San Francisco win over Los Angeles has not been played yet: the 3-2
    // lead in the only series that could separate them is no longer banked.
    const games = season()
    const i = games.findIndex(g => g.home_team_id === 'SF' && g.away_team_id === 'LA')
    games[i] = toPlay('SF', 'LA')
    expect(clinchedSeeds(seedsFor(games), games).has('SF')).toBe(false)
  })

  // The other direction, and why `bestPossible === worstPossible` cannot be trusted for this: it
  // resolves ties AGAINST the club, so it closed Boston's range on fourth while Boston held the
  // only series that could separate them from third.
  it('does not clinch a club that would WIN the tie it can still force', () => {
    const games = season()
    const seeds = seedsFor(games)
    expect(clinchedSeeds(seeds, games).has('BOS')).toBe(false)
    // Boston top out at 6 wins, which is exactly New York's total, and Boston hold that series
    // 3-2 with none left. So third is still reachable, which `bestPossible` cannot see.
    expect(bestReachableSeed(seeds, games, 'BOS')).toBe(3)
    expect(seeds.find(s => s.team.id === 'BOS')!.bestPossible).toBe(4)
  })

  // With nothing left to play the order is simply the standings, tiebreaks already applied. The
  // wins-only comparison could not see this on its own: two clubs can finish level on WINS and
  // not be level at all, because 1-3 and 1-6 are two different seasons.
  it('clinches every seed once the season is over, even on equal wins', () => {
    const games = [
      ...won('SF', 'BOS', 3), ...won('SF', 'NY', 1),
      ...won('LA', 'BOS', 2), ...won('LA', 'NY', 1),
      ...won('NY', 'BOS', 1), ...won('BOS', 'NY', 1),
    ]
    const seeds = seedsFor(games)
    const clinched = clinchedSeeds(seeds, games)
    expect(clinched.size).toBe(4)
    expect([...clinched.values()].sort()).toEqual([1, 2, 3, 4])
    // NY and BOS both have one win here and are not level: NY are 1-3 and BOS 1-6.
    expect(clinched.get('NY')).toBeLessThan(clinched.get('BOS')!)
  })

  // The percentage rule, isolated. A club two wins clear on the raw count can still be BEHIND
  // on the table, which is the order that decides a bracket.
  it('compares on percentage, not on raw wins', () => {
    const games = [
      ...won('SF', 'BOS', 9), ...won('NY', 'SF', 5),
      ...won('LA', 'NY', 7), ...won('BOS', 'LA', 3),
      toPlay('SF', 'NY'), toPlay('LA', 'BOS'),
    ]
    const seeds = seedsFor(games)
    // SF are 9-5 and LA 7-3: fewer wins, better percentage, higher seed.
    expect(seeds.map(s => s.team.id).indexOf('LA'))
      .toBeLessThan(seeds.map(s => s.team.id).indexOf('SF'))
    // And nothing here claims SF finish above LA, which a wins-only reading would have.
    expect(finishesAhead(seeds.find(s => s.team.id === 'SF')!, seeds.find(s => s.team.id === 'LA')!, games)).toBe(false)
  })
})
