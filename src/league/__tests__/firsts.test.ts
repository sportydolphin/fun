import { describe, it, expect } from 'vitest'
import { findFirsts, parseFirstText } from '../firsts'
import { plateAppearanceLines } from '../inningLines'
import type { LeagueGame, RunValuePlay } from '../types'
import { WPBL_LEAGUE } from '../../wpbl/league'

// A first is answered with the play it happened on, so the two things worth pinning are which words
// ask for one and which play wins: the earliest by the calendar, never by game id.

describe('parseFirstText', () => {
  it('reads a first ever, with or without the history words', () => {
    for (const t of ['first home run', 'first hr', 'the first homer in wpbl history', "who hit the league's first home run?", 'first ever home run'])
      expect(parseFirstText(t), t).toEqual({ kinds: ['hr'], season: null })
  })

  it('reads a season', () => {
    expect(parseFirstText('first grand slam of 2026')).toEqual({ kinds: ['slam'], season: 2026 })
    expect(parseFirstText('first strikeout in 2026')).toEqual({ kinds: ['so'], season: 2026 })
  })

  it('lists every first for "firsts" and "hall of firsts"', () => {
    expect(parseFirstText('firsts')!.kinds.length).toBeGreaterThan(5)
    expect(parseFirstText('hall of firsts')!.season).toBeNull()
    expect(parseFirstText('firsts of 2026')!.season).toBe(2026)
  })

  it('leaves an inning, a name and a stat line alone', () => {
    for (const t of ['first inning', 'k in the first inning', 'Whitmore', 'first base', '2 hr', 'first'])
      expect(parseFirstText(t), t).toBeNull()
  })

  it('reads a walk-off and a hit by pitch', () => {
    expect(parseFirstText('first walk-off')!.kinds).toEqual(['walkoff'])
    expect(parseFirstText('first walkoff hit')!.kinds).toEqual(['walkoff'])
    expect(parseFirstText('first hit by pitch')!.kinds).toEqual(['hbp'])
  })
})

const game = (id: string, date: string, over: Partial<LeagueGame> = {}): LeagueGame => ({
  id, game_date: date, status: 'final', game_type: 'R', counts_in_standings: true,
  home_team_id: 'home', away_team_id: 'away', home_score: 0, away_score: 1, ...over,
})
let sequence = 0
const play = (over: Partial<RunValuePlay>): RunValuePlay => ({
  game_id: 'g1', sequence: sequence++, inning: 1, half: 'top', team_id: 'away',
  batter_id: 'b', batter_name: 'Batter', pitcher_id: 'p', pitcher_name: 'Pitcher',
  outs: 0, first_base: '', second_base: '', third_base: '', event_type: null, runs_scored: 0,
  narrative: null, pitch_sequence: 'P', ...over,
})

describe('findFirsts', () => {
  // Game ids sort the wrong way round on purpose: "a" is the later game.
  const games = [game('a', '2026-06-02'), game('z', '2026-06-01')]
  const plays = [
    play({ game_id: 'a', batter_id: 'later', event_type: 'home_run' }),
    play({ game_id: 'z', batter_id: 'walker', event_type: 'walk' }),
    play({ game_id: 'z', batter_id: 'earlier', event_type: 'home_run', first_base: 'x', second_base: 'y', third_base: 'w', runs_scored: 3 }),
    play({ game_id: 'z', half: 'bottom', team_id: 'home', batter_id: 'h', pitcher_id: 'ace', event_type: 'strikeout' }),
  ]
  const lines = plateAppearanceLines(WPBL_LEAGUE, plays, games)
  const run = (kinds: Parameters<typeof findFirsts>[2]) => findFirsts(lines, games, kinds, g => g.game_date)

  it('takes the earliest game by date, then the earliest play in it', () => {
    const [hr] = run(['hr'])
    expect(hr).toMatchObject({ kind: 'hr', playerId: 'earlier', teamId: 'away' })
    expect(hr.line.game_id).toBe('z')
  })

  it('reads a grand slam off the runners, and credits a strikeout to the pitcher and the club in the field', () => {
    expect(run(['slam'])[0].playerId).toBe('earlier')
    expect(run(['so'])[0]).toMatchObject({ playerId: 'ace', teamId: 'away' })
  })

  it('skips a kind nobody has done', () => {
    expect(run(['triple', 'walk']).map(f => f.kind)).toEqual(['walk'])
  })
})

// The runners' plays are rows of their own, which the plate-appearance lines leave out, so these are
// read off the log itself: "first balk" offered nothing until they were.
describe('firsts off the rows', () => {
  it('reads the runners, the pitcher and the field', () => {
    for (const [t, kind] of [['first balk', 'bk'], ['first stolen base', 'sb'], ['first steal', 'sb'], ['first caught stealing', 'cs'],
      ['first pickoff', 'pk'], ['first wild pitch', 'wp'], ['first passed ball', 'pb'], ['first double play', 'dp'],
      ['first triple play', 'tp'], ['first steal of home', 'sbh'], ['first sac fly', 'sf'], ['first sacrifice bunt', 'sh'],
      ['first bunt hit', 'bunthit'], ['first infield hit', 'ifh'], ['first pinch hit', 'phit'], ['first pinch-hit home run', 'phhr'],
      ['first leadoff home run', 'leadoffhr'], ['first single', 'single'], ['who committed the first balk?', 'bk']] as const)
      expect(parseFirstText(t)?.kinds, t).toEqual([kind])
  })

  it('keeps "firsts" to the headline kinds', () => {
    const kinds = parseFirstText('firsts')!.kinds
    expect(kinds).toContain('bk')
    expect(kinds).toContain('sb')
    expect(kinds).not.toContain('tp')
  })

  const games = [game('g1', '2026-06-01')]
  const plays = [
    play({ batter_id: 'ann', batter_name: 'Ann Lee', event_type: 'single', first_base: 'Ann Lee' }),
    play({ batter_id: 'ann', batter_name: 'Ann Lee', pitcher_id: 'ace', event_type: null, narrative: 'Ann Lee stole second.', pitch_sequence: null }),
    play({ batter_id: 'bo', batter_name: 'Bo Diaz', pitcher_id: 'ace', event_type: null, narrative: 'Balk by Ace. Ann Lee advanced to third.', pitch_sequence: null }),
    play({ batter_id: 'bo', batter_name: 'Bo Diaz', event_type: 'groundout', narrative: 'Bo Diaz grounded into double play ss to 2b to 1b.' }),
  ]
  const lines = plateAppearanceLines(WPBL_LEAGUE, plays, games)
  const run = (kinds: Parameters<typeof findFirsts>[2]) => findFirsts(lines, games, kinds, g => g.game_date, plays)

  it('names the runner off the clause, the pitcher for a balk, and the club in the field for a double play', () => {
    expect(run(['sb'])[0]).toMatchObject({ playerId: 'ann', teamId: 'away', sequence: plays[1].sequence })
    expect(run(['bk'])[0]).toMatchObject({ playerId: 'ace', teamId: 'home', sequence: plays[2].sequence })
    expect(run(['dp'])[0]).toMatchObject({ playerId: null, teamId: 'home' })
  })

  it('finds nothing off the rows without the log', () => {
    expect(findFirsts(lines, games, ['bk'], g => g.game_date)).toEqual([])
  })
})
