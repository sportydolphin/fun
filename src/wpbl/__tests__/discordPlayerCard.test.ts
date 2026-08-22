import { describe, it, expect } from 'vitest'
import { buildPlayerReply } from '../discordPlayerCard'
import type { WpblBattingLine, WpblTeam } from '../types'
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
