import { describe, it, expect } from 'vitest'
import { teamSpecs, specLeagueGames, formatSpecStat, TEAM_SPEC_AXES, TEAM_SPEC_MIN_GAMES } from '../derive/teamSpec'
import type { WpblBattingLine, WpblGame, WpblPitchingLine } from '../types'

// The six numbers behind the team spec chart. Every score is a RATIO TO THE LEAGUE AVERAGE, and
// almost everything that can go wrong here goes wrong quietly: an inverted axis draws a bad
// defence as a good one, a postseason game folded in moves the whole league, and a caller handed
// one club's lines gets a perfectly plausible chart of four 50s.

const TEAMS = ['SF', 'LA', 'NY', 'BOS']

let seq = 0
const bat = (team: string, gameId: string, o: Partial<WpblBattingLine> = {}): WpblBattingLine => ({
  id: `b${seq++}`, game_id: gameId, player_id: `p${seq}`, team_id: team,
  batting_order: 1, position: 'CF',
  ab: 4, r: 0, h: 1, doubles: 0, triples: 0, hr: 0, rbi: 0, bb: 0, so: 1, hbp: 0,
  sb: 0, cs: 0, sf: 0, sh: 0, ibb: 0, gdp: 0, tb: 1, lob: 0, ...o,
})
const pit = (team: string, gameId: string, o: Partial<WpblPitchingLine> = {}): WpblPitchingLine => ({
  id: `q${seq++}`, game_id: gameId, player_id: `r${seq}`, team_id: team,
  outs: 21, bf: 28, h: 7, r: 4, er: 4, bb: 3, so: 5, hr: 1, pitches: 100, strikes: 60,
  decision: null, gs: 1, hbp: 0, ibb: 0, wp: 0, bk: 0, doubles: 1, triples: 0, ...o,
})

/** `n` finals per club pairing, enough to clear the games gate. */
function season(n = TEAM_SPEC_MIN_GAMES): { games: WpblGame[]; ids: string[] } {
  const games: WpblGame[] = []
  for (let i = 0; i < n; i++) {
    games.push(
      { id: `g${i}a`, game_date: `2026-08-0${(i % 9) + 1}`, start_time: '6:30 PM',
        home_team_id: 'SF', away_team_id: 'LA', venue: null, status: 'final',
        home_score: 5, away_score: 2, innings: 7, notes: null, created_at: '', updated_at: '',
        game_type: 'regular', counts_in_standings: true },
      { id: `g${i}b`, game_date: `2026-08-0${(i % 9) + 1}`, start_time: '6:30 PM',
        home_team_id: 'NY', away_team_id: 'BOS', venue: null, status: 'final',
        home_score: 5, away_score: 2, innings: 7, notes: null, created_at: '', updated_at: '',
        game_type: 'regular', counts_in_standings: true },
    )
  }
  return { games, ids: games.map(g => g.id) }
}

/** One identical line per club per game, so every club is exactly average by construction. */
const flatLines = (ids: string[]) => ({
  batting: ids.flatMap(id => TEAMS.map(t => bat(t, id))),
  pitching: ids.flatMap(id => TEAMS.map(t => pit(t, id))),
})

describe('teamSpecs', () => {
  it('puts an exactly average league on the midpoint of every axis', () => {
    const { games, ids } = season()
    const { batting, pitching } = flatLines(ids)
    const specs = teamSpecs(TEAMS, batting, pitching, games)!
    expect(specs).not.toBeNull()
    for (const row of specs.rows) {
      for (const a of TEAM_SPEC_AXES) expect(row.score[a.key]).toBe(50)
    }
  })

  // The bug that would be invisible on screen: a low-is-good axis drawn as if high were good
  // gives the worst defence in the league the biggest spoke, and it looks completely fine.
  it('inverts the axes where low is good', () => {
    const { games, ids } = season()
    const { batting, pitching } = flatLines(ids)
    // Boston give up three unearned runs a game; everyone else gives up none.
    const sloppy = pitching.map(p => p.team_id === 'BOS' ? { ...p, r: 7, er: 4 } : p)
    const specs = teamSpecs(TEAMS, batting, sloppy, games)!
    expect(specs.byTeam.get('BOS')!.score.glove).toBeLessThan(50)
    expect(specs.byTeam.get('SF')!.score.glove).toBeGreaterThan(50)
    // And the raw number is NOT inverted: it is unearned runs, so Boston's is the big one.
    expect(specs.byTeam.get('BOS')!.raw.glove).toBeGreaterThan(specs.byTeam.get('SF')!.raw.glove)
  })

  it('inverts strikeouts for the hitters and not for the pitchers', () => {
    const { games, ids } = season()
    const { batting, pitching } = flatLines(ids)
    // Boston strike out twice as often at the plate, and their pitchers strike out nobody.
    const b = batting.map(l => l.team_id === 'BOS' ? { ...l, so: 3 } : l)
    const p = pitching.map(l => l.team_id === 'BOS' ? { ...l, so: 1 } : l)
    const specs = teamSpecs(TEAMS, b, p, games)!
    expect(specs.byTeam.get('BOS')!.score.contact).toBeLessThan(50)  // K% up, Contact down
    expect(specs.byTeam.get('BOS')!.score.arms).toBeLessThan(50)     // K/9 down, Arms down
  })

  // The failure mode a caller reaches for by accident. The team page already holds this club's
  // lines, pre-filtered, and handing those over produces a chart rather than an error: the three
  // clubs with no lines read as zero on every axis, which drags the average down and inflates
  // the subject's own shape. Pinned so the plumbing on the page stays league-wide.
  it('is a comparison, and says so loudly when handed one club', () => {
    const { games, ids } = season()
    const { batting, pitching } = flatLines(ids)
    const wrong = teamSpecs(TEAMS,
      batting.filter(l => l.team_id === 'SF'), pitching.filter(l => l.team_id === 'SF'), games)!
    // Los Angeles have no lines at all, so they strike out at a rate of zero and come out as
    // the best contact team in the league, while San Francisco are pinned at the floor for
    // being the only club that ever made an out. Nothing about that chart looks broken.
    expect(wrong.byTeam.get('LA')!.raw.contact).toBe(0)
    expect(wrong.byTeam.get('LA')!.score.contact).toBe(100)
    expect(wrong.byTeam.get('SF')!.score.contact).toBeLessThan(10)
    // Against the whole league the same club is exactly average, which is the truth.
    const right = teamSpecs(TEAMS, batting, pitching, games)!
    expect(right.byTeam.get('SF')!.score.contact).toBe(50)
  })

  it('will not draw anything until every club has played enough', () => {
    const short = season(TEAM_SPEC_MIN_GAMES - 1)
    const shortLines = flatLines(short.ids)
    expect(teamSpecs(TEAMS, shortLines.batting, shortLines.pitching, short.games)).toBeNull()
    const enough = season(TEAM_SPEC_MIN_GAMES)
    const enoughLines = flatLines(enough.ids)
    expect(teamSpecs(TEAMS, enoughLines.batting, enoughLines.pitching, enough.games)).not.toBeNull()
  })

  // The gate is on the LEAGUE, not on each club: a club on two games does not only make its own
  // shape noise, it sets the average the other three are drawn against.
  it('gates on the club with the fewest games, not on the club being drawn', () => {
    const { games, ids } = season()
    // Boston's last four games never happened.
    const thin = games.filter(g => !(g.home_team_id === 'NY' && Number(g.id.replace(/\D/g, '')) > 0))
    const { batting, pitching } = flatLines(ids)
    expect(specLeagueGames(TEAMS, thin)).toBeLessThan(TEAM_SPEC_MIN_GAMES)
    expect(teamSpecs(TEAMS, batting, pitching, thin)).toBeNull()
  })

  // CLAUDE.md's standing trap, applied here: sumBatting/sumPitching take the schedule so that a
  // postseason game cannot reach a season total. If this ever regresses the league average moves
  // and every one of the four shapes is wrong, with nothing on screen to say so.
  it('keeps the postseason out of the league average', () => {
    const { games, ids } = season()
    const { batting, pitching } = flatLines(ids)
    const post: WpblGame = {
      id: 'post1', game_date: '2026-09-09', start_time: '6:00 PM',
      home_team_id: 'SF', away_team_id: 'BOS', venue: null, status: 'final',
      home_score: 9, away_score: 0, innings: 7, notes: null, created_at: '', updated_at: '',
      game_type: 'Semifinal A', counts_in_standings: false,
    }
    const withPost = teamSpecs(TEAMS,
      [...batting, bat('SF', 'post1', { hr: 4, ab: 4, h: 4, tb: 16 })],
      [...pitching, pit('SF', 'post1', { so: 20 })],
      [...games, post])!
    for (const row of withPost.rows) {
      for (const a of TEAM_SPEC_AXES) expect(row.score[a.key]).toBe(50)
    }
  })

  it('pegs rather than overflows, and never collapses a spoke to nothing', () => {
    const { games, ids } = season()
    const { batting, pitching } = flatLines(ids)
    // One club with twenty times the league's steal attempts, one with none at all.
    const b = batting.map(l => l.team_id === 'NY' ? { ...l, sb: 20 } : l)
    const specs = teamSpecs(TEAMS, b, pitching, games)!
    expect(specs.byTeam.get('NY')!.score.speed).toBe(100)
    expect(specs.byTeam.get('SF')!.score.speed).toBeGreaterThan(0)
  })

  it('survives a league that has done none of something', () => {
    const { games, ids } = season()
    const { batting, pitching } = flatLines(ids)
    // Nobody has attempted a steal all year, so there is no average to be above or below.
    const specs = teamSpecs(TEAMS, batting.map(l => ({ ...l, sb: 0, cs: 0 })), pitching, games)!
    for (const row of specs.rows) expect(row.score.speed).toBe(50)
  })
})

describe('formatSpecStat', () => {
  it('prints each stat the way its own board does', () => {
    expect(formatSpecStat('power', 0.192)).toBe('.192')   // ISO, leading zero dropped
    expect(formatSpecStat('contact', 0.111)).toBe('11.1%')
    expect(formatSpecStat('arms', 6.2394)).toBe('6.24')
    expect(formatSpecStat('glove', 1.3077)).toBe('1.31')
  })
})
