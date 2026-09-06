import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import LiveGameView, { lineFor } from '../LiveGameView'
import { deriveSituation } from '../Live'
import type {
  WpblBattingLine, WpblGame, WpblGamePlay, WpblLiveState, WpblPlayer, WpblTeam,
} from '../types'

// The Live tab draws things the feed only half-gives it, and each of those halves is a way to
// be confidently wrong: a count that cannot exist, a batter who is not batting, a name that
// belongs to two people. These pin the three.

const AWAY = { id: 'la', abbr: 'LA', name: 'Queens' } as WpblTeam
const HOME = { id: 'bos', abbr: 'BOS', name: 'Hunters' } as WpblTeam
const TEAMS = new Map<string, WpblTeam>([[AWAY.id, AWAY], [HOME.id, HOME]])

const player = (id: string, name: string, teamId: string): WpblPlayer =>
  ({ id, name, team_id: teamId } as WpblPlayer)

const bat = (playerId: string, over: Partial<WpblBattingLine> = {}): WpblBattingLine => ({
  id: `b-${playerId}`, game_id: 'g1', player_id: playerId, team_id: HOME.id,
  batting_order: 1, position: 'CF',
  ab: 2, r: 0, h: 1, doubles: 0, triples: 0, hr: 0, rbi: 0, bb: 0, so: 0, hbp: 0,
  sb: 0, cs: 0, sf: 0, sh: 0, ibb: 0, gdp: 0, tb: 1, lob: 0,
  ...over,
})

// A live at-bat: bottom of the 3rd, one out, 2-1, with the leadoff runner on first.
const LIVE: WpblLiveState = {
  complete: false, inning: 3, half: 'bottom', batting_team_id: HOME.id,
  outs: 1, balls: 2, strikes: 1,
  batter_name: 'Denver Bryant', pitcher_name: 'Michelle Roche',
  first_base: 'Lexi Hastings', second_base: '', third_base: '',
  bases_occupied: ['1B'], bases_loaded: false, away_runs: 8, home_runs: 1,
}

const game = (state: WpblLiveState): WpblGame => ({
  id: 'g1', game_date: '2026-09-05', start_time: null,
  home_team_id: HOME.id, away_team_id: AWAY.id, venue: null,
  status: 'live', home_score: 1, away_score: 8, innings: 7, notes: null,
  live_state: state,
} as WpblGame)

const NAMES = new Map<string, WpblPlayer>([
  ['p1', player('p1', 'Denver Bryant', HOME.id)],
  ['p2', player('p2', 'Michelle Roche', AWAY.id)],
  ['p3', player('p3', 'Lexi Hastings', HOME.id)],
])

const play = (over: Partial<WpblGamePlay> = {}): WpblGamePlay => ({
  game_id: 'g1', sequence: 1, inning: 3, half: 'bottom', team_id: HOME.id,
  // `parsePlay` fills `who` only when the narrative opens with THIS play's batter, which is
  // what keeps the name the last-play line links to the right person. A fixture without it
  // exercises the runner-only path, not the ordinary one.
  batter_name: 'Lexi Hastings', batter_id: 'p3',
  narrative: 'Lexi Hastings singled to left field.', outs: 0,
  ...over,
} as WpblGamePlay)

function draw(state: WpblLiveState, plays: WpblGamePlay[] = [play()]) {
  return render(
    <LiveGameView
      game={game(state)} teams={TEAMS} away={AWAY} home={HOME}
      plays={plays} batting={[bat('p1'), bat('p3')]} pitching={[]}
      names={NAMES} games={[]}
    />,
  )
}

describe('the bases, named', () => {
  // The feed's `first_base` is a runner's NAME, not a flag, and the header strip throws that
  // away with a `!!`. Naming them is the whole reason this pane exists.
  it('carries the runner names off the feed and nulls the empty bases', () => {
    const s = deriveSituation(LIVE, AWAY, HOME)
    expect(s.firstName).toBe('Lexi Hastings')
    expect(s.secondName).toBeNull()
    expect(s.thirdName).toBeNull()
    expect(s.first).toBe(true)
    expect(s.second).toBe(false)
  })

  it('names who is on, and does not list the bases that are empty', () => {
    draw(LIVE)
    expect(screen.getByText('1B')).toBeTruthy()
    expect(screen.getByText('L. Hastings')).toBeTruthy()
    expect(screen.queryByText('2B')).toBeNull()
    expect(screen.queryByText('3B')).toBeNull()
  })

  it('says the bases are empty rather than listing three blanks', () => {
    draw({ ...LIVE, first_base: '', bases_occupied: [] })
    expect(screen.getByText('Bases empty')).toBeTruthy()
    expect(screen.queryByText('On base')).toBeNull()
  })

  // The flag and the name come out of the same field, so they cannot disagree today. They are
  // read separately all the same, and a base occupied by nobody named still has to draw.
  it('draws a base the feed marks occupied without naming the runner', () => {
    const s = deriveSituation({ ...LIVE, second_base: ' ' }, AWAY, HOME)
    expect(s.second).toBe(true)
    render(
      <LiveGameView
        game={game({ ...LIVE, second_base: ' ' })} teams={TEAMS} away={AWAY} home={HOME}
        plays={[play()]} batting={[]} pitching={[]} names={NAMES} games={[]}
      />,
    )
    expect(screen.getByText('Runner on')).toBeTruthy()
  })
})

describe('the count the feed cannot have meant', () => {
  // Watched on Sep 5, 2026: balls 3, strikes 3 on a batter with nobody out, which then dropped
  // to 0-1. It is the previous strikeout's full count sitting on the next batter's name, and
  // the strip printed "3-3" and got away with it because it is four characters. As pips it is
  // four balls and three strikes, so it clamps.
  it('will not draw a fourth ball or a third strike', () => {
    draw({ ...LIVE, balls: 3, strikes: 3, outs: 0 })
    expect(screen.getByLabelText('3 balls')).toBeTruthy()
    expect(screen.getByLabelText('2 strikes')).toBeTruthy()
  })

  it('reads an empty count as a phrase rather than as "0 balls"', () => {
    draw({ ...LIVE, balls: 0, strikes: 0, outs: 0 })
    expect(screen.getByLabelText('No balls')).toBeTruthy()
    expect(screen.getByLabelText('No outs')).toBeTruthy()
  })

  it('says one strike, not one strikes', () => {
    draw({ ...LIVE, strikes: 1 })
    expect(screen.getByLabelText('1 strike')).toBeTruthy()
    expect(screen.getByLabelText('1 out')).toBeTruthy()
  })
})

describe('between half-innings', () => {
  // The feed announces the next half-inning the moment the last one ends and then sits on it,
  // so during the break the batter, the count and the runners all belong to an at-bat that is
  // over. At strip size a stale "AB" is a curiosity; here it is a portrait and a statline for
  // somebody who is not batting.
  const BREAK: WpblLiveState = {
    ...LIVE, outs: 0, balls: 0, strikes: 0, first_base: '', bases_occupied: [],
  }

  it('shows the break and nothing else', () => {
    draw(BREAK)
    expect(screen.getByText('Middle of the 3rd')).toBeTruthy()
    expect(screen.queryByText('Denver Bryant')).toBeNull()
    expect(screen.queryByText('Michelle Roche')).toBeNull()
    expect(screen.queryByText('Bases empty')).toBeNull()
  })

  it('is not fooled into a break by a leadoff home run', () => {
    // Empty bases, nobody out, no count, but the batting side has scored in this inning.
    render(
      <LiveGameView
        game={{ ...game(BREAK), home_line: [{ inning: 3, runs: 1 }] } as WpblGame}
        teams={TEAMS} away={AWAY} home={HOME}
        plays={[play()]} batting={[bat('p1')]} pitching={[]} names={NAMES} games={[]}
      />,
    )
    expect(screen.getByText('Denver Bryant')).toBeTruthy()
  })
})

describe('lineFor', () => {
  // The feed's situation carries names and no ids, so the batter and the pitcher are matched by
  // name. A wrong match does not merely mislabel: it puts somebody else's line under this
  // batter's face and links her name to somebody else's page.
  const statline = (l: WpblBattingLine) => `${l.h}-${l.ab}`

  it('finds a player whose name nobody else in the game holds', () => {
    const got = lineFor('Denver Bryant', HOME, NAMES, [bat('p1')], statline)
    expect(got.player?.id).toBe('p1')
    expect(got.statline).toBe('1-2')
  })

  it('folds punctuation and accents rather than being brittle about them', () => {
    const names = new Map([['x', player('x', 'Maïka Dumais', HOME.id)]])
    expect(lineFor('Maika Dumais', HOME, names, [bat('x')], statline).player?.id).toBe('x')
  })

  it('uses the club to settle a name two roster rows share', () => {
    // The league mints a new player_id when somebody changes club, so one person can be on two
    // rosters at once. Only one of those clubs is batting this half-inning.
    const names = new Map([
      ['a', player('a', 'Diana Ibarra', AWAY.id)],
      ['b', player('b', 'Diana Ibarra', HOME.id)],
    ])
    expect(lineFor('Diana Ibarra', HOME, names, [bat('b')], statline).player?.id).toBe('b')
    expect(lineFor('Diana Ibarra', AWAY, names, [bat('a')], statline).player?.id).toBe('a')
  })

  it('resolves to nobody when even the club cannot settle it', () => {
    const names = new Map([
      ['a', player('a', 'Jamie Mackay', HOME.id)],
      ['b', player('b', 'Jamie Mackay', HOME.id)],
    ])
    const got = lineFor('Jamie Mackay', HOME, names, [bat('a')], statline)
    expect(got.player).toBeNull()
    expect(got.statline).toBeNull()
  })

  it('gives no statline for somebody the box score has not entered yet', () => {
    // The feed stages the leadoff batter before the half-inning starts. A dash here would
    // claim a line of 0-0, which is a statement about a player rather than the absence of one.
    const got = lineFor('Denver Bryant', HOME, NAMES, [], statline)
    expect(got.player?.id).toBe('p1')
    expect(got.statline).toBeNull()
  })
})

describe('the last play', () => {
  it('takes the highest sequence, not the last element of the array', () => {
    // The poll writes whatever order PostgREST returned; `sequence` is the only ordering the
    // league guarantees.
    draw(LIVE, [
      play({ sequence: 9, batter_name: 'Molly Paddison', batter_id: 'p4', narrative: 'Molly Paddison grounded out to short.' }),
      play({ sequence: 4, narrative: 'Lexi Hastings singled to left field.' }),
    ])
    expect(screen.getByText('Molly Paddison')).toBeTruthy()
    expect(screen.getByText(/grounded out to short/)).toBeTruthy()
    expect(screen.queryByText(/singled to left field/)).toBeNull()
  })

  // The feed writes one long sentence with everything in it. Printed verbatim on the most
  // valuable line of the card, the thing that happened is buried mid-sentence and a bracket of
  // pitch letters lands somewhere different on every play.
  it('splits the batter, the outcome, the count and the runners apart', () => {
    draw(LIVE, [play({
      sequence: 2, batter_name: 'Isabella Villareal', batter_id: 'p5',
      narrative: 'Isabella Villareal singled to center field (3-1 BBKB); Sarah Edwards advanced to third.',
    })])
    expect(screen.getByText('Isabella Villareal')).toBeTruthy()
    expect(screen.getByText(/singled to center field/)).toBeTruthy()
    // The count in its own column, and the raw pitch letters gone with the brackets. 3-1 rather
    // than 1-2 only so it cannot collide with a batter's hits-for-at-bats elsewhere on the card.
    expect(screen.getByText('3-1')).toBeTruthy()
    // The runners condensed onto their own quieter line, and shortened.
    expect(screen.getByText(/Edwards to 3rd/)).toBeTruthy()
  })

  it('badges the runs a play put on the board, counting the batter', () => {
    // `runs_scored` counts the runners who crossed and never the batter, so a solo home run
    // reads 0 on the row and has to read +1 here. See CLAUDE.md.
    draw(LIVE, [play({
      sequence: 2, event_type: 'home_run', runs_scored: 0,
      batter_name: 'Denver Bryant', batter_id: 'p1',
      narrative: 'Denver Bryant homered to left field, RBI.',
    })])
    expect(screen.getByText('+1')).toBeTruthy()
  })

  it('keeps a substitution at the weight of bookkeeping, not of a play', () => {
    // It can genuinely be the last thing the feed logged, and it did not happen in the at-bat.
    draw(LIVE, [play({
      sequence: 2, narrative: 'Michelle Roche to p for Ayami Sato.',
    })])
    const line = screen.getByText(/to p for Ayami Sato/)
    expect(line).toBeTruthy()
    expect(getComputedStyle(line).fontStyle).toBe('italic')
  })
})
