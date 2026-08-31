import { describe, it, expect } from 'vitest'
import { buildRecap } from '../derive/recap'
import type { WpblGame, WpblTeam, WpblBattingLine, WpblPitchingLine, WpblRecapPlay } from '../types'

// Who gets the medal.
//
// `stars[0]` is the gold medal on the Home recap card, the first medal in the Discord box
// score, and the name the blurb drops into "X led the way" one sentence after naming the
// winner. Filled from the losing side it reads as a mistake rather than as a mention, and it
// was being filled that way in 5 of the season's first 25 decided finals.

const team = (id: string, name: string): WpblTeam => ({ id, name, abbr: id, city: name } as WpblTeam)
const TEAMS = new Map([['SF', team('SF', 'Firebells')], ['NY', team('NY', 'Heights')]])

const bat = (player_id: string, team_id: string, o: Partial<WpblBattingLine>): WpblBattingLine => ({
  player_id, team_id, ab: 4, r: 0, h: 0, doubles: 0, triples: 0, hr: 0, rbi: 0, bb: 0, so: 0,
  sb: 0, cs: 0, hbp: 0, sf: 0, sh: 0, tb: 0, ...o,
} as WpblBattingLine)

const game = (o: Partial<WpblGame> = {}): WpblGame => ({
  id: 'g1', status: 'final', game_date: '2026-08-30',
  home_team_id: 'SF', away_team_id: 'NY', home_score: 11, away_score: 9,
  home_line: [1, 2, 1, 0, 0, 0, 7].map((runs, i) => ({ inning: i + 1, runs })),
  away_line: [0, 5, 1, 0, 0, 3, 0].map((runs, i) => ({ inning: i + 1, runs })),
  ...o,
} as WpblGame)

const NAMES: Record<string, string> = { leblanc: 'Andréanne Leblanc', benites: 'Denae Benites', gutierrez: 'Samantha Gutierrez', lansdell: 'Ashton Lansdell' }
const nameOf = (id: string) => NAMES[id] ?? id
const recap = (batting: WpblBattingLine[], pitching: WpblPitchingLine[] = [], g = game()) =>
  buildRecap(g, TEAMS, batting, pitching, [] as WpblRecapPlay[], nameOf)!

describe('the medal goes to the winning side', () => {
  // THE REAL GAME. Aug 30, 2026: SF trailed 9-7 with two out in the bottom of the 7th and
  // Leblanc hit a walk-off grand slam to win it 11-9. Benites, on the losing side, went
  // 1-for-4 with a bigger RBI total, and the card credited her.
  const LEBLANC = bat('leblanc', 'SF', { ab: 5, h: 2, r: 2, rbi: 4, hr: 1, tb: 5 })
  // The stolen base is not decoration: it is what puts her raw score (12) strictly above
  // Leblanc's (11), which is the whole reason the old ranking chose her.
  const BENITES = bat('benites', 'NY', { ab: 4, h: 1, r: 2, rbi: 5, hr: 1, tb: 4, sb: 1 })
  const GUTIERREZ = bat('gutierrez', 'SF', { ab: 4, h: 2, r: 1, rbi: 3, doubles: 1, tb: 3 })

  it('credits the walk-off grand slam, not the bigger line in the loss', () => {
    const r = recap([BENITES, LEBLANC, GUTIERREZ])
    expect(r.stars[0].name).toBe('Andréanne Leblanc')
    expect(r.stars[0].teamId).toBe('SF')
  })

  it('puts the winner in the blurb, so the sentence agrees with the headline', () => {
    const r = recap([BENITES, LEBLANC, GUTIERREZ])
    expect(r.headline).toContain('Firebells')
    expect(r.blurb).toContain('Andréanne Leblanc')
    expect(r.blurb).not.toContain('Denae Benites')
  })

  // Raw score still ranks Benites highest; only the lead slot is reordered.
  it('does not pretend the losing line was smaller than it was', () => {
    const r = recap([BENITES, LEBLANC, GUTIERREZ])
    const benites = r.stars.find(s => s.name === 'Denae Benites')!
    expect(benites.score).toBeGreaterThan(r.stars[0].score)
  })
})

describe('the rest of the board stays honest', () => {
  // ONLY THE LEAD SLOT MOVES. Sorting the whole list winner-first would fill all three places
  // from the winning side, because a winning team always has three batters who scored or drove
  // one in, and that deletes the one thing worth reporting about the loser.
  it('keeps a big losing performance on the card, below the medal', () => {
    const r = recap([
      bat('lansdell', 'NY', { ab: 5, h: 4, r: 3, rbi: 4, hr: 2, tb: 11 }), // huge, in a loss
      bat('leblanc', 'SF', { ab: 4, h: 2, r: 1, rbi: 2, tb: 3 }),
      bat('gutierrez', 'SF', { ab: 4, h: 1, r: 1, rbi: 1, tb: 1 }),
      bat('benites', 'SF', { ab: 3, h: 1, r: 1, rbi: 0, tb: 1 }),
    ])
    expect(r.stars[0].teamId).toBe('SF')
    expect(r.stars.map(s => s.name)).toContain('Ashton Lansdell')
    expect(r.stars[1].name).toBe('Ashton Lansdell')
  })

  it('leaves a game alone when the best line already belongs to the winner', () => {
    const r = recap([
      bat('leblanc', 'SF', { ab: 5, h: 3, r: 2, rbi: 4, hr: 1, tb: 7 }),
      bat('benites', 'NY', { ab: 4, h: 1, r: 1, rbi: 1, tb: 1 }),
    ])
    expect(r.stars[0].name).toBe('Andréanne Leblanc')
    expect(r.stars[1].name).toBe('Denae Benites')
  })
})
