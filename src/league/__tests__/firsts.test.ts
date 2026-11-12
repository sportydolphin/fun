import { describe, it, expect } from 'vitest'
import { findFirsts, firstFindText, occurrenceTitle, occurrences, ordinal, parseFirstText } from '../firsts'
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

// A club's or a player's first: "first Hunters double", "Whitmore first hit". The owner can be typed
// before "first", between it and the play, or after "by" / "for", and it narrows the same search.
describe('whose first', () => {
  const clubs = [{ id: 'BOS', names: ['BOS', 'Boston', 'Hunters', 'Boston Hunters'] }, { id: 'SF', names: ['SF', 'San Francisco', 'Firebells'] }]
  const ask = (t: string) => parseFirstText(t, clubs)

  it('reads a club wherever it is typed', () => {
    for (const t of ['first hunters double', 'hunters first double', "hunters' first double", "boston's first double",
      'first double by the hunters', 'first double for boston', 'the first double in hunters history', 'who hit the hunters first double?'])
      expect(ask(t), t).toEqual({ kinds: ['double'], season: null, teamId: 'BOS' })
    expect(ask('first sf home run of 2026')).toEqual({ kinds: ['hr'], season: 2026, teamId: 'SF' })
    expect(ask('hunters first double play')).toEqual({ kinds: ['dp'], season: null, teamId: 'BOS' })
  })

  it('hands any other owner on as a name for the section to find', () => {
    expect(ask('whitmore first hit')).toEqual({ kinds: ['hit'], season: null, who: 'whitmore' })
    expect(ask("Kelsie Whitmore's first home run")).toEqual({ kinds: ['hr'], season: null, who: 'Kelsie Whitmore' })
    expect(ask('first walk by whitmore')).toEqual({ kinds: ['walk'], season: null, who: 'whitmore' })
  })

  it('keeps the league its own, and a play whose words hold a "by" whole', () => {
    expect(ask('first wpbl home run')).toEqual({ kinds: ['hr'], season: null })
    expect(ask('first hr in wpbl history')).toEqual({ kinds: ['hr'], season: null })
    expect(ask('first hit by pitch')).toEqual({ kinds: ['hbp'], season: null })
  })

  it('lists a club\'s firsts, and gives up on two owners', () => {
    expect(ask('hunters firsts')).toMatchObject({ teamId: 'BOS' })
    expect(ask('whitmore firsts')).toBeNull()
    expect(ask('first hunters double by whitmore')).toBeNull()
  })

  it('asks Find for every one beside a club\'s first, on the side it is credited to', () => {
    expect(firstFindText({ kinds: ['double'], season: null, teamId: 'BOS' })).toEqual({ text: 'BOS doubles', side: 'hitting' })
    expect(firstFindText({ kinds: ['so'], season: 2026, teamId: 'BOS' })).toEqual({ text: 'BOS strikeouts 2026', side: 'pitching' })
    expect(firstFindText({ kinds: ['double'], season: null })).toBeNull()
    expect(firstFindText({ kinds: ['double'], season: null, teamId: 'BOS', who: 'x' })).toBeNull()
  })

  // Two clubs, so the club's first is not the league's: the home side's first strikeout comes after the
  // away side's, and a player's first is theirs even when someone else did it sooner.
  const games = [game('g1', '2026-06-01'), game('g2', '2026-06-02')]
  const plays = [
    play({ game_id: 'g1', team_id: 'away', batter_id: 'a1', pitcher_id: 'hp', event_type: 'double' }),
    play({ game_id: 'g1', team_id: 'home', half: 'bottom', batter_id: 'h1', pitcher_id: 'ap', event_type: 'strikeout' }),
    play({ game_id: 'g2', team_id: 'home', half: 'bottom', batter_id: 'h2', pitcher_id: 'ap', event_type: 'double' }),
    play({ game_id: 'g2', team_id: 'away', batter_id: 'a2', pitcher_id: 'hp', event_type: 'strikeout' }),
    play({ game_id: 'g2', team_id: 'away', batter_id: 'a1', pitcher_id: 'hp', event_type: 'double' }),
  ]
  const lines = plateAppearanceLines(WPBL_LEAGUE, plays, games)
  const run = (kinds: Parameters<typeof findFirsts>[2], owner: Parameters<typeof findFirsts>[5]) => findFirsts(lines, games, kinds, g => g.game_date, plays, owner)

  it('narrows to a club, crediting a strikeout to the club in the field', () => {
    expect(run(['double'], { teamId: 'home' })[0]).toMatchObject({ playerId: 'h2', game_id: 'g2' })
    expect(run(['so'], { teamId: 'home' })[0]).toMatchObject({ playerId: 'hp', game_id: 'g2' })
    expect(run(['so'], { teamId: 'away' })[0]).toMatchObject({ playerId: 'ap', game_id: 'g1' })
  })

  it('narrows to a player, and finds nothing they never did', () => {
    expect(run(['double'], { playerId: 'h2' })[0]).toMatchObject({ game_id: 'g2' })
    expect(run(['hr'], { playerId: 'h2' })).toEqual([])
  })
})

// The last and the Nth ride the same reading: "last Hunters double", "Hunters 100th hit" (Nov 11, 2026).
describe('lasts and milestones', () => {
  const clubs = [{ id: 'BOS', names: ['BOS', 'Boston', 'Hunters'] }]
  const ask = (t: string) => parseFirstText(t, clubs)

  it('reads the last and the Nth, with an owner wherever it is typed', () => {
    expect(ask('last hunters double')).toEqual({ kinds: ['double'], season: null, teamId: 'BOS', which: 'last' })
    expect(ask('most recent home run')).toEqual({ kinds: ['hr'], season: null, which: 'last' })
    expect(ask("whitmore's latest hit")).toEqual({ kinds: ['hit'], season: null, who: 'whitmore', which: 'last' })
    expect(ask('hunters 100th hit')).toEqual({ kinds: ['hit'], season: null, teamId: 'BOS', which: 100 })
    expect(ask('the 500th strikeout of 2026')).toEqual({ kinds: ['so'], season: 2026, which: 500 })
    expect(ask('whitmore tenth home run')).toEqual({ kinds: ['hr'], season: null, who: 'whitmore', which: 10 })
    expect(ask('1st home run')).toEqual({ kinds: ['hr'], season: null })
  })

  // An inning, a base, a count of games: Find's questions, which a first must not swallow.
  it('leaves an inning, a base and a run of games alone', () => {
    for (const t of ['3rd inning home runs', 'first inning hr', 'second base', 'last 10 games', 'queens last 10', 'last 10 home runs', 'hr in the 2nd inning', 'last inning'])
      expect(ask(t), t).toBeNull()
  })

  it('titles each the way it is said', () => {
    expect(occurrenceTitle('double', undefined, { club: 'Hunters' })).toBe('First Hunters double')
    expect(occurrenceTitle('double', 'last', { club: 'Hunters' })).toBe('Last Hunters double')
    expect(occurrenceTitle('hit', 100, { club: 'Hunters' })).toBe('Hunters 100th hit')
    expect(occurrenceTitle('hr', 10, { player: 'Kelsie Whitmore' })).toBe("Kelsie Whitmore's 10th home run")
    expect(occurrenceTitle('so', 1000, {})).toBe('1,000th strikeout')
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '101st', '111th'])
  })

  // A double steal is two stolen bases on one row, so the Nth can be the second runner on it.
  const games = [game('g1', '2026-06-01')]
  const plays = [
    play({ batter_id: 'ann', batter_name: 'Ann Lee', event_type: 'single', first_base: 'Ann Lee' }),
    play({ batter_id: 'bo', batter_name: 'Bo Diaz', event_type: 'single', first_base: 'Bo Diaz', second_base: 'Ann Lee' }),
    play({ batter_id: 'cy', batter_name: 'Cy Ray', event_type: null, pitch_sequence: null, narrative: 'Ann Lee stole third; Bo Diaz stole second.' }),
    play({ batter_id: 'cy', batter_name: 'Cy Ray', event_type: 'double' }),
  ]
  const lines = plateAppearanceLines(WPBL_LEAGUE, plays, games)
  const all = (kind: Parameters<typeof occurrences>[2]) => occurrences(lines, games, kind, g => g.game_date, plays)

  it('counts each event, not each row, in the order they happened', () => {
    expect(all('sb').map(f => f.playerId)).toEqual(['ann', 'bo'])
    expect(all('hit').map(f => f.playerId)).toEqual(['ann', 'bo', 'cy'])
    expect(all('hit')[2]).toMatchObject({ playerId: 'cy', sequence: plays[3].sequence })
    expect(occurrences(lines, games, 'sb', g => g.game_date, plays, { playerId: 'bo' })).toHaveLength(1)
  })
})
