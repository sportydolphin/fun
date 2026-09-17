import { describe, it, expect } from 'vitest'
import { buildPlayerReply } from '../discordPlayerCard'
import type { WpblBattingLine, WpblPitchingLine, WpblTeam } from '../types'
import type { WpblSeasonGame } from '../season'

// The uniform number on the /player card. Worth pinning rather than eyeballing in Discord
// because the two ways to get it wrong are both silent: a "0" jersey read as falsy vanishes,
// and a player whose roster row has no number yet must not render a bare "#".

const team: WpblTeam = {
  id: 'LA', city: 'Los Angeles', name: 'Queens', abbr: 'LAQ',
  color: '#4b2e83', color_secondary: null, logo_url: null, sort_order: 1,
  api_id: null, created_at: '',
}

const games: WpblSeasonGame[] = [{ id: 'g1', game_type: 'regular', counts_in_standings: true }]

const line = (): WpblBattingLine => ({
  id: 'b1', game_id: 'g1', player_id: 'p1', team_id: 'LA',
  batting_order: 1, position: 'cf',
  ab: 4, r: 1, h: 2, doubles: 1, triples: 0, hr: 0, rbi: 1,
  bb: 1, so: 0, hbp: 0, sb: 1, cs: 0, sf: 0, sh: 0, ibb: 0, gdp: 0, tb: 3, lob: 1,
  created_at: '', sub_out: null,
} as unknown as WpblBattingLine)

const subject = (jersey: string | null) =>
  buildPlayerReply(
    { id: 'p1', name: "Mo'ne Davis", position: 'CF', jersey_number: jersey },
    team, [line()], [], games,
  ).embeds?.[0].description

const regPitch = (): WpblPitchingLine => ({
  id: 'r1', game_id: 'g1', player_id: 'p1', team_id: 'LA',
  outs: 18, bf: 24, h: 4, r: 1, er: 1, bb: 1, so: 8, hr: 0, pitches: 90, decision: 'W',
  gs: 1, hbp: 0, ibb: 0, wp: 0, bk: 0, strikes: 60, doubles: 0, triples: 0,
} as unknown as WpblPitchingLine)

const bothSeasons: WpblSeasonGame[] = [
  { id: 'g1', game_type: 'regular', counts_in_standings: true },
  // The postseason flag says nothing in 2026 (the feed sends counts_in_standings: true on
  // bracket rows), so game_type is the only signal, exactly as on the site. See season.ts.
  { id: 'gp', game_type: 'postseason', counts_in_standings: true },
]

describe('the /player card by role', () => {
  // A pitcher who came to the plate only in a playoff game. Her regular-season batting is
  // empty, so the regular "Batting" field must not draw a .000/.000/.000 line; her postseason
  // PA is real, so it belongs under its own "Postseason batting" field.
  it('splits a pitcher whose only batting was in the postseason', () => {
    const postBat = { ...line(), id: 'pb', game_id: 'gp' } as WpblBattingLine
    const reply = buildPlayerReply(
      { id: 'p1', name: 'Ayami Sato', position: 'RHP', jersey_number: '11' },
      team, [postBat], [regPitch()], bothSeasons)
    const names = reply.embeds?.[0].fields?.map(f => f.name) ?? []
    // Regular pitching leads; regular batting is dropped; the postseason PA gets its own field.
    expect(names.some(n => n.startsWith('Pitching'))).toBe(true)
    expect(names.some(n => n.startsWith('Batting'))).toBe(false)
    expect(names.some(n => n.startsWith('Postseason batting'))).toBe(true)
  })

  // The common two-slice case: a hitter with games in both. Both lines show, regular first.
  it('shows regular and postseason batting as two fields, regular first', () => {
    const postBat = { ...line(), id: 'pb', game_id: 'gp' } as WpblBattingLine
    const reply = buildPlayerReply(
      { id: 'p1', name: "Mo'ne Davis", position: 'CF', jersey_number: '3' },
      team, [line(), postBat], [], bothSeasons)
    const names = reply.embeds?.[0].fields?.map(f => f.name) ?? []
    const reg = names.findIndex(n => n.startsWith('Batting'))
    const post = names.findIndex(n => n.startsWith('Postseason batting'))
    expect(reg).toBeGreaterThanOrEqual(0)
    expect(post).toBeGreaterThan(reg)
  })

  // Most of the roster: a season that ended in the regular season carries no postseason field.
  it('shows no postseason field for a player who never reached the bracket', () => {
    const reply = buildPlayerReply(
      { id: 'p1', name: "Mo'ne Davis", position: 'CF', jersey_number: '3' },
      team, [line()], [], games)
    const names = reply.embeds?.[0].fields?.map(f => f.name) ?? []
    expect(names.some(n => n.startsWith('Postseason'))).toBe(false)
    expect(names.filter(n => n.startsWith('Batting')).length).toBe(1)
  })
})

describe("the /player card's uniform number", () => {
  it('leads the line, ahead of the position and the club', () => {
    expect(subject('3')).toBe('#3 · CF · Los Angeles Queens')
  })

  // The number is a string for exactly this reason. Read it as a number and the player
  // wearing 0 loses hers, which is the kind of bug nobody reports.
  it('keeps a zero, and keeps a leading zero', () => {
    expect(subject('0')).toBe('#0 · CF · Los Angeles Queens')
    expect(subject('00')).toBe('#00 · CF · Los Angeles Queens')
  })

  // Most roster rows had no number until the ingest started taking it off the box score, and
  // anyone who has not appeared since can still have none.
  it('drops out entirely when the roster row has no number', () => {
    expect(subject(null)).toBe('CF · Los Angeles Queens')
    expect(subject('  ')).toBe('CF · Los Angeles Queens')
  })
})
