import { describe, it, expect } from 'vitest'
import { computeStandings } from '../api'
import { buildBracket, winsNeeded, BEST_OF } from '../derive/bracket'
import type { WpblGame, WpblTeam } from '../types'

// The bracket is drawn from the standings order plus whatever postseason games exist, and the
// interesting part is that it needs NO new feed field to know how a series stands: a pair of
// team ids identifies a series, because no two of the three pairings in a four-club bracket
// can be the same two clubs.
//
// What is pinned here is that the pairings follow the seeds (1v4, 2v3), that a series is
// reconstructed from grouped games rather than from anything the feed calls them, that the
// championship stays empty until both semifinals have a winner, and that a postseason game
// the feed has NOT marked as postseason cannot leak into it.

const TEAMS: WpblTeam[] = (['SF', 'LA', 'NY', 'BOS'] as const).map((id, i) => ({
  id, city: id, name: id, abbr: id, color: null, color_secondary: null,
  logo_url: null, sort_order: i, api_id: null, created_at: '',
}))

let seq = 0
const game = (over: Partial<WpblGame> = {}): WpblGame => ({
  id: `g${seq++}`,
  game_date: '2026-08-01', start_time: '6:30 PM',
  home_team_id: 'SF', away_team_id: 'LA',
  venue: null, status: 'final',
  home_score: 5, away_score: 2, innings: 7, notes: null,
  created_at: '', updated_at: '',
  game_type: 'regular', counts_in_standings: true,
  ...over,
})

/** `winner` beats `loser` on `date`, as a regular-season game. */
const win = (winner: string, loser: string, date: string): WpblGame =>
  game({ game_date: date, home_team_id: winner, away_team_id: loser, home_score: 6, away_score: 1 })

/** A postseason game, marked the way the feed is expected to mark one. */
const post = (winner: string, loser: string, date: string): WpblGame =>
  game({
    game_date: date, home_team_id: winner, away_team_id: loser, home_score: 4, away_score: 2,
    game_type: 'Semifinal A', counts_in_standings: false,
  })

/**
 * A season that finishes SF 1st, LA 2nd, NY 3rd, BOS 4th, purely on wins, so the seeds are
 * unambiguous without leaning on any tiebreak.
 */
function seededSeason(): WpblGame[] {
  const days = (n: number, f: () => WpblGame) => Array.from({ length: n }, f)
  let d = 0
  const date = () => `2026-08-${String(++d % 28 + 1).padStart(2, '0')}`
  return [
    ...days(3, () => win('SF', 'BOS', date())),   // SF 3-0 over BOS
    ...days(2, () => win('LA', 'BOS', date())),   // LA 2-0
    ...days(1, () => win('NY', 'BOS', date())),   // NY 1-0
    ...days(1, () => win('BOS', 'NY', date())),   // BOS 1
    ...days(1, () => win('LA', 'NY', date())),    // LA 3
    ...days(1, () => win('SF', 'NY', date())),    // SF 4
  ]
}

const bracketOf = (games: WpblGame[]) => buildBracket(computeStandings(TEAMS, games), games)!

describe('the shape of the bracket', () => {
  it('is best-of-three semifinals into a best-of-five championship', () => {
    expect(BEST_OF.semifinal).toBe(3)
    expect(BEST_OF.championship).toBe(5)
    expect(winsNeeded('semifinal')).toBe(2)
    expect(winsNeeded('championship')).toBe(3)
  })

  it('pairs one against four and two against three', () => {
    const b = bracketOf(seededSeason())
    const [a, second] = b.semifinals
    expect([a.home.seed, a.away.seed]).toEqual([1, 4])
    expect([second.home.seed, second.away.seed]).toEqual([2, 3])
    expect(a.label).toBe('Semifinal A')
    expect(second.label).toBe('Semifinal B')
  })

  it('draws the higher seed first, so the sides never swap', () => {
    const b = bracketOf(seededSeason())
    for (const s of b.semifinals) {
      expect(s.home.seed!).toBeLessThan(s.away.seed!)
    }
  })

  it('returns null for a league with fewer than four clubs', () => {
    // Half a bracket is worse than none.
    expect(buildBracket(computeStandings(TEAMS.slice(0, 2), []), [])).toBeNull()
  })

  it('is a projection with no games played, not an error', () => {
    const b = bracketOf([])
    expect(b.started).toBe(false)
    expect(b.champion).toBeNull()
    expect(b.semifinals.every(s => s.status === 'upcoming')).toBe(true)
    expect(b.semifinals[0].summary).toBe('Best of 3')
  })
})

describe('series state, reconstructed without a series id', () => {
  it('counts wins within a pairing', () => {
    const season = seededSeason()             // SF 1st, BOS 4th, so Semifinal A is SF v BOS
    const b = bracketOf([...season,
      post('SF', 'BOS', '2026-09-09'),
      post('BOS', 'SF', '2026-09-10'),
    ])
    const a = b.semifinals[0]
    expect([a.home.team!.id, a.away.team!.id]).toEqual(['SF', 'BOS'])
    expect([a.home.wins, a.away.wins]).toEqual([1, 1])
    expect(a.status).toBe('live')
    expect(a.summary).toBe('Tied 1-1')
    expect(b.started).toBe(true)
  })

  it('names the leader while a series is open', () => {
    const b = bracketOf([...seededSeason(),
      post('SF', 'BOS', '2026-09-09'),
    ])
    expect(b.semifinals[0].summary).toBe('SF lead 1-0')
    expect(b.semifinals[0].winner).toBeNull()
  })

  it('closes a best-of-three at two wins', () => {
    const b = bracketOf([...seededSeason(),
      post('SF', 'BOS', '2026-09-09'),
      post('SF', 'BOS', '2026-09-10'),
    ])
    const a = b.semifinals[0]
    expect(a.winner!.id).toBe('SF')
    expect(a.status).toBe('done')
    expect(a.summary).toBe('SF win 2-0')
  })

  it('keeps two series apart even though both are postseason games', () => {
    // The whole reason pair-keying works: A is SF v BOS and B is LA v NY, and neither game
    // carries anything distinguishing them but the clubs in it.
    const b = bracketOf([...seededSeason(),
      post('SF', 'BOS', '2026-09-09'),
      post('LA', 'NY', '2026-09-09'),
      post('LA', 'NY', '2026-09-10'),
    ])
    expect(b.semifinals[0].summary).toBe('SF lead 1-0')
    expect(b.semifinals[1].summary).toBe('LA win 2-0')
  })
})

describe('the championship slot', () => {
  const season = seededSeason()

  it('stays empty until both semifinals have a winner', () => {
    const b = bracketOf([...season, post('SF', 'BOS', '2026-09-09'), post('SF', 'BOS', '2026-09-10')])
    expect(b.championship.home.team).toBeNull()
    expect(b.championship.status).toBe('upcoming')
    expect(b.championship.summary).toBe('Awaiting semifinal')
  })

  it('fills with the two winners, higher seed first', () => {
    const b = bracketOf([...season,
      post('BOS', 'SF', '2026-09-09'), post('BOS', 'SF', '2026-09-10'),   // 4 beats 1
      post('LA', 'NY', '2026-09-09'), post('LA', 'NY', '2026-09-10'),     // 2 beats 3
    ])
    // LA is the 2 seed and BOS the 4, so LA is drawn first even though BOS won its semi first.
    expect(b.championship.home.team!.id).toBe('LA')
    expect(b.championship.away.team!.id).toBe('BOS')
    expect(b.championship.bestOf).toBe(5)
    expect(b.championship.summary).toBe('Best of 5')
  })

  it('crowns a champion at three wins', () => {
    const b = bracketOf([...season,
      post('SF', 'BOS', '2026-09-09'), post('SF', 'BOS', '2026-09-10'),
      post('LA', 'NY', '2026-09-09'), post('LA', 'NY', '2026-09-10'),
      post('SF', 'LA', '2026-09-14'), post('SF', 'LA', '2026-09-15'), post('SF', 'LA', '2026-09-16'),
    ])
    expect(b.champion!.id).toBe('SF')
    expect(b.championship.summary).toBe('SF win 3-0')
  })
})

describe('what must not leak in', () => {
  it('ignores regular-season games between the same two clubs', () => {
    // SF and BOS play all season. None of it may show up as a semifinal record.
    const b = bracketOf(seededSeason())
    expect(b.semifinals[0].played).toBe(0)
    expect(b.started).toBe(false)
  })

  it('ignores a postseason game that has not been played', () => {
    const b = bracketOf([...seededSeason(),
      game({
        game_date: '2026-09-09', home_team_id: 'SF', away_team_id: 'BOS',
        status: 'scheduled', home_score: null, away_score: null,
        game_type: 'Semifinal A', counts_in_standings: false,
      }),
    ])
    expect(b.semifinals[0].played).toBe(0)
    expect(b.semifinals[0].status).toBe('upcoming')
  })

  it('credits nobody for a postseason game that somehow ends level', () => {
    // Cannot happen, must not silently hand it to the home side if it does.
    const b = bracketOf([...seededSeason(),
      game({
        game_date: '2026-09-09', home_team_id: 'SF', away_team_id: 'BOS',
        home_score: 3, away_score: 3, game_type: 'Semifinal A', counts_in_standings: false,
      }),
    ])
    expect([b.semifinals[0].home.wins, b.semifinals[0].away.wins]).toEqual([0, 0])
  })

  it('does not let postseason games reach the seeding they are seeded by', () => {
    // The bracket is drawn from the regular-season order. A semifinal sweep must not reorder
    // the seeds underneath it mid-series.
    const before = bracketOf(seededSeason())
    const after = bracketOf([...seededSeason(),
      post('BOS', 'SF', '2026-09-09'), post('BOS', 'SF', '2026-09-10'),
    ])
    expect(after.semifinals[0].home.seed).toBe(before.semifinals[0].home.seed)
    expect(after.semifinals[0].home.team!.id).toBe('SF')
  })
})

describe('settled', () => {
  it('is false while the seeds can still move', () => {
    // Games still to play, so the pairings are a snapshot.
    const b = buildBracket(computeStandings(TEAMS, seededSeason()), [...seededSeason(),
      game({ game_date: '2026-09-05', status: 'scheduled', home_score: null, away_score: null }),
    ])!
    expect(b.settled).toBe(false)
  })

  it('is true once every seed is locked', () => {
    // Nothing left on the schedule, so every club's range has closed.
    expect(bracketOf(seededSeason()).settled).toBe(true)
  })
})
