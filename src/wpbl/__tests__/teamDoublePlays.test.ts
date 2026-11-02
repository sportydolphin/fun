import { describe, it, expect } from 'vitest'
import { teamDoublePlays } from '../derive/fielding'
import { catcherSteals, caughtStealingPct, fmtTwo } from '../stats'
import type { WpblBattingLine, WpblFieldingLine, WpblGame } from '../types'

// Three figures the audit of Nov 1, 2026 found wrong without a single error being thrown: a club's
// double plays and steals allowed were its players' credits added up, which counts one event two or
// three times, and an ERA of 4.725 printed 4.72 beside the league's 4.73.

const games = [
  { id: 'g1', home_team_id: 'NY', away_team_id: 'LA', game_type: 'regular', status: 'final' },
  { id: 'p1', home_team_id: 'NY', away_team_id: 'LA', game_type: 'postSeason', status: 'final' },
] as WpblGame[]

const play = (game_id: string, team_id: string, narrative: string) => ({ game_id, team_id, narrative })

describe('teamDoublePlays', () => {
  const plays = [
    play('g1', 'LA', 'Rae Runner grounded into double play 2b to ss to 1b (1-2 BKK); Bo Batter out on the play.'),
    play('g1', 'LA', 'Sky Fast lined into double play p to ss (0-2 FS); Bo Batter out on the play.'),
    play('g1', 'NY', 'Tam Slow singled to left field (0-0).'),
    play('p1', 'NY', 'Tam Slow grounded into double play 3b to 2b to 1b (2-0 BB); Bo Batter out on the play.'),
  ]

  it('files a double play under the club in the field, once however many fielders touched it', () => {
    expect(teamDoublePlays(plays, games, 'regular')).toEqual(new Map([['NY', 2]]))
  })

  it('keeps the postseason apart, and adds it on Both', () => {
    expect(teamDoublePlays(plays, games, 'postseason')).toEqual(new Map([['LA', 1]]))
    expect(teamDoublePlays(plays, games, 'all')).toEqual(new Map([['NY', 2], ['LA', 1]]))
  })
})

describe('catcherSteals', () => {
  const bat = (player_id: string, position: string) =>
    ({ game_id: 'g1', player_id, team_id: 'NY', position }) as WpblBattingLine
  const fld = (player_id: string, sba: number) =>
    ({ game_id: 'g1', player_id, team_id: 'NY', sba }) as WpblFieldingLine

  it('counts the catcher’s charge and not the pitcher’s, so a club reads what it allowed', () => {
    const { byPlayer, byTeam } = catcherSteals(
      [fld('c1', 3), fld('p1', 3)], [bat('c1', 'c'), bat('p1', 'p'), bat('c2', 'dh/c')], games)
    expect(byTeam.get('NY')).toBe(3)
    expect(byPlayer.get('c1')).toBe(3)
    // Caught and allowed nothing is a zero. Never caught is no entry, and so a dash on the board.
    expect(byPlayer.get('c2')).toBe(0)
    expect(byPlayer.has('p1')).toBe(false)
  })
})

describe('caughtStealingPct', () => {
  it('is throw-outs over everyone who ran, and null with nothing to say', () => {
    expect(caughtStealingPct({ sba: 12, cs: 5 })).toBeCloseTo(5 / 17)
    expect(caughtStealingPct({ sba: 0, cs: 0 })).toBeNull()
    expect(caughtStealingPct({ sba: 12, cs: null })).toBeNull()
    expect(caughtStealingPct(null)).toBeNull()
  })
})

describe('fmtTwo', () => {
  it('rounds what the number is, not its binary neighbor', () => {
    expect(fmtTwo(4.725)).toBe('4.73')
    expect(fmtTwo((9 * 7) / (40 / 3))).toBe('4.73')
    expect(fmtTwo(3.24)).toBe('3.24')
    expect(fmtTwo(0)).toBe('0.00')
    expect(fmtTwo(null)).toBe('—')
  })
})
