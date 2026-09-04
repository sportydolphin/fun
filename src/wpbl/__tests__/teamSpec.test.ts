import { describe, it, expect } from 'vitest'
import {
  teamSpecs, specLeagueGames, specRank, specHighlights, formatSpecStat,
  TEAM_SPEC_AXES, TEAM_SPEC_MIN_GAMES, type TeamSpecKey,
} from '../derive/teamSpec'
import type { WpblBattingLine, WpblGame, WpblPitchingLine, WpblPitchPlay } from '../types'

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

/**
 * Pitch sequences, which Contact is now computed from (whiff rate, not K%).
 *
 * `team_id` on a play is the BATTING side, which is the whole reason this axis can be built
 * without resolving a single player. `seq` is one plate appearance's codes: S swung through,
 * F fouled, P put in play, K taken for a strike, B ball.
 */
let pseq = 0
const play = (team: string, gameId: string, seq: string): WpblPitchPlay => ({
  game_id: gameId, sequence: pseq++, team_id: team,
  batter_id: null, batter_name: 'A Batter', pitcher_id: null, pitcher_name: 'A Pitcher',
  event_type: 'single', pitch_sequence: seq,
})

/** The same three swings and one miss for every club, so Contact is average by construction
 *  alongside the flat box-score lines. */
const flatPlays = (ids: string[]) => ids.flatMap(id => TEAMS.map(t => play(t, id, 'BSFP')))

/**
 * THE ONE RULE THE WHOLE CHART RESTS ON: further out is better, on every axis, always.
 *
 * The polygon, its fill, `specRank` and `specHighlights` all read `score`, so an axis whose
 * `better` flag is wrong does not draw a warning, it draws a club's worst trait as its best and
 * looks entirely normal doing it. Two of the six axes are inverted (`contact` and `glove`), and
 * the day someone adds a third, or flips one while renaming a stat, this is what catches it.
 *
 * Table-driven ON PURPOSE, iterating TEAM_SPEC_AXES rather than listing six cases: a new axis
 * added without a `worse`/`better` pair here fails the exhaustiveness check below instead of
 * quietly not being covered.
 */
const RICH_BAT: Partial<WpblBattingLine> = { ab: 4, h: 2, doubles: 1, tb: 3, bb: 1, so: 1, sb: 1 }
const RICH_PIT: Partial<WpblPitchingLine> = { outs: 21, so: 5, r: 4, er: 3 }

/** Every axis non-zero for every club, so none of them lands on the no-league-average branch. */
const richLeague = (ids: string[]) => ({
  batting: ids.flatMap(id => TEAMS.map(t => bat(t, id, RICH_BAT))),
  pitching: ids.flatMap(id => TEAMS.map(t => pit(t, id, RICH_PIT))),
  plays: ids.flatMap(id => TEAMS.map(t => play(t, id, 'BSFP'))),
})

/** How to make Boston BETTER at one axis, leaving the other five alone. */
const improve: Record<TeamSpecKey, (l: ReturnType<typeof richLeague>) => ReturnType<typeof richLeague>> = {
  // An extra double. NOT the line's own `tb` column, which `teamSpecs` deliberately ignores in
  // favour of recomputing total bases from the hit types: setting `tb` alone moves nothing, and
  // an earlier version of this test passed for that reason and proved nothing.
  power:   l => ({ ...l, batting: l.batting.map(x => x.team_id === 'BOS' ? { ...x, h: 3, doubles: 2, tb: 5 } : x) }),
  // The same three swings, none of them missed.
  contact: l => ({ ...l, plays: l.plays.map(x => x.team_id === 'BOS' ? { ...x, pitch_sequence: 'BFFP' } : x) }),
  eye:     l => ({ ...l, batting: l.batting.map(x => x.team_id === 'BOS' ? { ...x, bb: 2 } : x) }),
  speed:   l => ({ ...l, batting: l.batting.map(x => x.team_id === 'BOS' ? { ...x, sb: 2 } : x) }),
  arms:    l => ({ ...l, pitching: l.pitching.map(x => x.team_id === 'BOS' ? { ...x, so: 10 } : x) }),
  // Every run they allowed was earned: nothing given away.
  glove:   l => ({ ...l, pitching: l.pitching.map(x => x.team_id === 'BOS' ? { ...x, er: 4 } : x) }),
}

describe('further out is always better', () => {
  it('covers every axis', () => {
    expect(Object.keys(improve).sort()).toEqual(TEAM_SPEC_AXES.map(a => a.key).sort())
  })

  it.each(TEAM_SPEC_AXES)('$label: doing it better pushes the spoke outward', (axis) => {
    const { games, ids } = season()
    const base = richLeague(ids)
    const flat = teamSpecs(TEAMS, base.batting, base.pitching, games, base.plays)!
    // Everyone identical to start with, or the comparison below proves nothing.
    expect(flat.byTeam.get('BOS')!.score[axis.key]).toBe(50)

    const l = improve[axis.key](base)
    const specs = teamSpecs(TEAMS, l.batting, l.pitching, games, l.plays)!
    const bos = specs.byTeam.get('BOS')!
    const sf = specs.byTeam.get('SF')!

    // The spoke, the rank and the summary line all agree, because all three read `score`.
    expect(bos.score[axis.key]).toBeGreaterThan(50)
    expect(bos.score[axis.key]).toBeGreaterThan(sf.score[axis.key])
    expect(specRank(specs, 'BOS', axis.key)).toBe(1)

    // And the RAW number moved the way the axis says it should, which is the half that would
    // otherwise let a flipped `better` flag pass: a wrong flag makes both the score and the
    // rank agree with each other and disagree with the world.
    const rawMoved = bos.raw[axis.key] - sf.raw[axis.key]
    expect(axis.better === 'high' ? rawMoved : -rawMoved).toBeGreaterThan(0)
  })
})

describe('teamSpecs', () => {
  it('puts an exactly average league on the midpoint of every axis', () => {
    const { games, ids } = season()
    const { batting, pitching } = flatLines(ids)
    const specs = teamSpecs(TEAMS, batting, pitching, games, flatPlays(ids))!
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
    const specs = teamSpecs(TEAMS, batting, sloppy, games, flatPlays(ids))!
    expect(specs.byTeam.get('BOS')!.score.glove).toBeLessThan(50)
    expect(specs.byTeam.get('SF')!.score.glove).toBeGreaterThan(50)
    // And the raw number is NOT inverted: it is unearned runs, so Boston's is the big one.
    expect(specs.byTeam.get('BOS')!.raw.glove).toBeGreaterThan(specs.byTeam.get('SF')!.raw.glove)
  })

  it('inverts whiffs for the hitters and strikeouts for the pitchers', () => {
    const { games, ids } = season()
    const { batting, pitching } = flatLines(ids)
    // Boston swing and miss on two of every three swings; everyone else on one of three.
    const whiffy = flatPlays(ids).map(p => p.team_id === 'BOS' ? { ...p, pitch_sequence: 'BSSP' } : p)
    const p = pitching.map(l => l.team_id === 'BOS' ? { ...l, so: 1 } : l)
    const specs = teamSpecs(TEAMS, batting, p, games, whiffy)!
    expect(specs.byTeam.get('BOS')!.score.contact).toBeLessThan(50)  // Whiff% up, Contact down
    expect(specs.byTeam.get('BOS')!.score.arms).toBeLessThan(50)     // K/7 down, Arms down
  })

  // THE GUARD ON THE Sep 4, 2026 CHANGE. Contact was a club's strikeout rate off the box score
  // until it was shown that 38% of this league's strikeouts are called, with no swing taken: an
  // axis named Contact was two times in five counting an at-bat where nobody tried to make any.
  // It reads the play log now. This fails the moment anyone points it back at `b.so`, which is
  // otherwise a completely reasonable-looking line of code.
  it('does not move Contact when a club strikes out more but swings the same', () => {
    const { games, ids } = season()
    const { batting, pitching } = flatLines(ids)
    const b = batting.map(l => l.team_id === 'BOS' ? { ...l, so: 3 } : l)
    const specs = teamSpecs(TEAMS, b, pitching, games, flatPlays(ids))!
    expect(specs.byTeam.get('BOS')!.raw.contact).toBeCloseTo(1 / 3, 10)
    expect(specs.byTeam.get('BOS')!.score.contact).toBe(50)
  })

  // The failure mode a caller reaches for by accident. The team page already holds this club's
  // lines, pre-filtered, and handing those over produces a chart rather than an error: the three
  // clubs with no lines read as zero on every axis, which drags the average down and inflates
  // the subject's own shape. Pinned so the plumbing on the page stays league-wide.
  it('is a comparison, and says so loudly when handed one club', () => {
    const { games, ids } = season()
    const { batting, pitching } = flatLines(ids)
    // A caller who filtered the PLAYS to one club as well gets nothing at all, which is the
    // point of the swings gate: three clubs with no swings would each score a whiff rate of
    // zero, and zero on an axis where lower is better is the OUTERMOST spoke on the chart. The
    // failure would not have looked like missing data, it would have looked like three
    // untouchable offences.
    expect(teamSpecs(TEAMS,
      batting.filter(l => l.team_id === 'SF'), pitching.filter(l => l.team_id === 'SF'),
      games, flatPlays(ids).filter(p => p.team_id === 'SF'))).toBeNull()
    // With the plays intact but the lines filtered, the chart still draws, and the box-score
    // axes still show the original bug this test was written for.
    const wrong = teamSpecs(TEAMS,
      batting.filter(l => l.team_id === 'SF'), pitching.filter(l => l.team_id === 'SF'),
      games, flatPlays(ids))!
    // Los Angeles have no lines at all, so they record no strikeouts, and San Francisco are the
    // only club that ever pitched: one club pegged at the rim and three on the floor. Nothing
    // about that chart looks broken. (Arms, because it is the one axis the flat fixture gives a
    // non-zero league average to; the rest are zero for everybody and land on 50 by the
    // no-average rule, which would pass this test for the wrong reason.)
    expect(wrong.byTeam.get('LA')!.raw.arms).toBe(0)
    expect(wrong.byTeam.get('LA')!.score.arms).toBe(5)
    expect(wrong.byTeam.get('SF')!.score.arms).toBe(100)
    // Against the whole league the same club is exactly average, which is the truth.
    const right = teamSpecs(TEAMS, batting, pitching, games, flatPlays(ids))!
    expect(right.byTeam.get('SF')!.score.contact).toBe(50)
  })

  it('will not draw anything until every club has played enough', () => {
    const short = season(TEAM_SPEC_MIN_GAMES - 1)
    const shortLines = flatLines(short.ids)
    expect(teamSpecs(TEAMS, shortLines.batting, shortLines.pitching, short.games, flatPlays(short.ids))).toBeNull()
    const enough = season(TEAM_SPEC_MIN_GAMES)
    const enoughLines = flatLines(enough.ids)
    expect(teamSpecs(TEAMS, enoughLines.batting, enoughLines.pitching, enough.games, flatPlays(enough.ids))).not.toBeNull()
  })

  // The gate is on the LEAGUE, not on each club: a club on two games does not only make its own
  // shape noise, it sets the average the other three are drawn against.
  it('gates on the club with the fewest games, not on the club being drawn', () => {
    const { games, ids } = season()
    // Boston's last four games never happened.
    const thin = games.filter(g => !(g.home_team_id === 'NY' && Number(g.id.replace(/\D/g, '')) > 0))
    const { batting, pitching } = flatLines(ids)
    expect(specLeagueGames(TEAMS, thin)).toBeLessThan(TEAM_SPEC_MIN_GAMES)
    expect(teamSpecs(TEAMS, batting, pitching, thin, flatPlays(ids))).toBeNull()
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
      [...games, post],
      // Four swings, four misses, in a game that must not count. Contact reads the play log
      // rather than the box score, so it needs its own postseason row here or the filter is
      // only proven on the inputs it was already proven on.
      [...flatPlays(ids), play('SF', 'post1', 'SSSS')])!
    for (const row of withPost.rows) {
      for (const a of TEAM_SPEC_AXES) expect(row.score[a.key]).toBe(50)
    }
  })

  it('pegs rather than overflows, and never collapses a spoke to nothing', () => {
    const { games, ids } = season()
    const { batting, pitching } = flatLines(ids)
    // One club with twenty times the league's steal attempts, one with none at all.
    const b = batting.map(l => l.team_id === 'NY' ? { ...l, sb: 20 } : l)
    const specs = teamSpecs(TEAMS, b, pitching, games, flatPlays(ids))!
    expect(specs.byTeam.get('NY')!.score.speed).toBe(100)
    expect(specs.byTeam.get('SF')!.score.speed).toBeGreaterThan(0)
  })

  // Seen on a live page: the batting read came back empty while the pitching read did not, and
  // the chart drew four confident 50s across Power, Contact, Eye and Speed beside entirely
  // correct Arms and Glove. Half a chart is worse than none, because the half that is wrong
  // looks exactly like the half that is right.
  it('refuses to draw when half of the league lines are missing', () => {
    const { games, ids } = season()
    const { batting, pitching } = flatLines(ids)
    expect(teamSpecs(TEAMS, [], pitching, games, flatPlays(ids))).toBeNull()
    expect(teamSpecs(TEAMS, batting, [], games, flatPlays(ids))).toBeNull()
    expect(teamSpecs(TEAMS, batting, pitching, games, flatPlays(ids))).not.toBeNull()
  })

  // Speed is STEALS per time on first, not attempts. It shipped as attempts and that credited a
  // club for being thrown out: every other axis on this chart is an outcome, and a caught
  // stealing is a lost runner and an out, so an attempts denominator drew a longer spoke for
  // doing a bad thing more often.
  it('does not reward a club for being caught stealing', () => {
    const { games, ids } = season()
    const { batting, pitching } = flatLines(ids)
    // Two clubs run exactly as often. New York succeed; Los Angeles are thrown out every time.
    const b = batting.map(l =>
      l.team_id === 'NY' ? { ...l, sb: 2, cs: 0 } :
      l.team_id === 'LA' ? { ...l, sb: 0, cs: 2 } : l)
    const specs = teamSpecs(TEAMS, b, pitching, games, flatPlays(ids))!
    expect(specs.byTeam.get('NY')!.score.speed).toBeGreaterThan(specs.byTeam.get('LA')!.score.speed)
    // And the club that only ever got caught is no faster than the clubs that never ran at all.
    expect(specs.byTeam.get('LA')!.score.speed).toBe(specs.byTeam.get('SF')!.score.speed)
  })

  it('survives a league that has done none of something', () => {
    const { games, ids } = season()
    const { batting, pitching } = flatLines(ids)
    // Nobody has attempted a steal all year, so there is no average to be above or below.
    const specs = teamSpecs(TEAMS, batting.map(l => ({ ...l, sb: 0, cs: 0 })), pitching, games, flatPlays(ids))!
    for (const row of specs.rows) expect(row.score.speed).toBe(50)
  })
})

describe('specRank and specHighlights', () => {
  // Ranked on the SCORE, not the raw stat, which is the whole reason one function covers all six
  // axes: direction is already applied, so 1st is the FEWEST unearned runs on Glove and the MOST
  // steal attempts on Speed. Ranking the raw numbers would silently invert the two low-is-good
  // axes and hand the worst defence in the league a "1st of 4".
  it('ranks a low-is-good axis the right way up', () => {
    const { games, ids } = season()
    const { batting, pitching } = flatLines(ids)
    const sloppy = pitching.map(p => p.team_id === 'BOS' ? { ...p, r: 9, er: 4 } : p)
    const specs = teamSpecs(TEAMS, batting, sloppy, games, flatPlays(ids))!
    expect(specRank(specs, 'BOS', 'glove')).toBe(4)
    expect(specRank(specs, 'SF', 'glove')).toBe(1)
    // And the raw number Boston is last on is the BIGGEST one, which is the trap.
    expect(specs.byTeam.get('BOS')!.raw.glove).toBeGreaterThan(specs.byTeam.get('SF')!.raw.glove)
  })

  it('shares the better rank on a tie, as the leaderboards do', () => {
    const { games, ids } = season()
    const { batting, pitching } = flatLines(ids)
    const specs = teamSpecs(TEAMS, batting, pitching, games, flatPlays(ids))!
    // Everyone is identical, so everyone is first.
    for (const t of TEAMS) expect(specRank(specs, t, 'power')).toBe(1)
  })

  it('names a best and a weakest trait', () => {
    const { games, ids } = season()
    const { batting, pitching } = flatLines(ids)
    const b = batting.map(l => l.team_id === 'NY' ? { ...l, sb: 3 } : l)
    const p = pitching.map(l => l.team_id === 'NY' ? { ...l, so: 1 } : l)
    const high = specHighlights(teamSpecs(TEAMS, b, p, games, flatPlays(ids))!, 'NY')!
    expect(high.best.key).toBe('speed')
    expect(high.worst.key).toBe('arms')
  })

  // A club level on all six has no best and no worst, and naming one would be reading a tie as
  // a fact. The caller prints "even across all six" instead.
  it('returns nothing for a club that is level on every axis', () => {
    const { games, ids } = season()
    const { batting, pitching } = flatLines(ids)
    expect(specHighlights(teamSpecs(TEAMS, batting, pitching, games, flatPlays(ids))!, 'SF')).toBeNull()
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
