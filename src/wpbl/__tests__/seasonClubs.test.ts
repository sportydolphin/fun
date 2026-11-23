import { describe, expect, it } from 'vitest'
import { archivedSeasons, archiveTable, leagueTable } from './archive'
import { seasonClubs, withSeasonClubs } from '../stats'
import { buildRows } from '../stats/rows'
import type { WpblBattingLine, WpblPitchingLine, WpblPlayer } from '../types'

// A ROSTER ROW'S CLUB IS "NOW"; A SEASON'S BOARDS NEED "THEN". In November 2026 Alyssa Zettlemoyer
// was traded from New York to Boston, and the 2026 Players board filed her whole New York season
// under Boston's club chip. These hold the rule that replaced the roster's club on those boards.

const bat = (player_id: string, team_id: string | null, game_id: string) => ({ player_id, team_id, game_id })
const roster = (id: string, team_id: string | null) => ({ id, team_id })

describe('seasonClubs', () => {
  it('names the club a player played for, not the one the roster holds now', () => {
    const clubs = seasonClubs([bat('z', 'NY', 'g1'), bat('z', 'NY', 'g2')], [], [roster('z', 'BOS')])
    expect(clubs.get('z')).toBe('NY')
  })

  it('takes the club with the most games, a game counted once across batting and pitching', () => {
    const clubs = seasonClubs(
      [bat('t', 'NY', 'g1'), bat('t', 'LA', 'g3')],
      [bat('t', 'NY', 'g1'), bat('t', 'LA', 'g4')],
      [roster('t', 'NY')])
    // NY: g1 once. LA: g3 and g4.
    expect(clubs.get('t')).toBe('LA')
  })

  it('breaks a tie toward the club the roster holds now, then by id', () => {
    expect(seasonClubs([bat('t', 'NY', 'g1'), bat('t', 'LA', 'g2')], [], [roster('t', 'NY')]).get('t')).toBe('NY')
    expect(seasonClubs([bat('t', 'NY', 'g1'), bat('t', 'LA', 'g2')], [], [roster('t', 'SF')]).get('t')).toBe('LA')
  })

  it('ignores a line with no club and leaves out a player with no line', () => {
    const clubs = seasonClubs([bat('a', null, 'g1')], [], [roster('a', 'SF'), roster('b', 'SF')])
    expect(clubs.size).toBe(0)
  })

  it('relabels only the players whose club differs, keeping the others as they were', () => {
    const a = { id: 'a', team_id: 'NY' }, b = { id: 'b', team_id: 'BOS' }
    const out = withSeasonClubs([a, b], new Map([['a', 'NY'], ['b', 'NY']]))
    expect(out[0]).toBe(a)
    expect(out[1]).toEqual({ id: 'b', team_id: 'NY' })
    expect(b.team_id).toBe('BOS')
  })
})

// Over every archived season: the club named is always one the player has a line for that season.
const players = leagueTable<WpblPlayer>('wpbl_players')
for (const season of archivedSeasons()) {
  describe(`season clubs, ${season}`, () => {
    const batting = archiveTable<WpblBattingLine>('wpbl_batting_lines', [season])
    const pitching = archiveTable<WpblPitchingLine>('wpbl_pitching_lines', [season])
    it('is a club the player has a line for', () => {
      const clubs = seasonClubs(batting, pitching, players)
      const played = new Map<string, Set<string>>()
      for (const l of [...batting, ...pitching]) if (l.team_id) played.set(l.player_id, (played.get(l.player_id) ?? new Set()).add(l.team_id))
      expect(clubs.size).toBe(played.size)
      for (const [pid, club] of clubs) expect(played.get(pid)?.has(club)).toBe(true)
    })
  })
}

// The Players board's club chip, end to end through the row builder.
describe('the Players board club chip', () => {
  it('files a season under the club it was played for', async () => {
    const { aggregateBatting, wpblQualifiers } = await import('../stats')
    const { hittingColumns, leagueLine } = await import('../statColumns')
    const p = (id: string, team_id: string) => ({ id, name: id, team_id, position: 'SS', active: true }) as unknown as WpblPlayer
    const line = (player_id: string, team_id: string, game_id: string) => ({
      id: `${player_id}-${game_id}`, game_id, player_id, team_id, batting_order: 1, position: 'SS',
      ab: 4, r: 1, h: 2, doubles: 0, triples: 0, hr: 0, rbi: 1, bb: 0, so: 1, sb: 0, cs: 0, hbp: 0, sf: 0, sh: 0, gdp: 0, ibb: 0, lob: 0,
    }) as unknown as WpblBattingLine
    const roster = [p('traded', 'BOS'), p('stayed', 'NY')]
    const batting = [line('traded', 'NY', 'g1'), line('stayed', 'NY', 'g1')]
    const games = [{ id: 'g1', game_type: 'regularSeason', counts_in_standings: true }] as never[]
    const labeled = withSeasonClubs(roster, seasonClubs(batting, [], roster))
    const league = leagueLine(batting, [], games, 'regular')
    const ctx = { league, wWeights: null, fWeights: null, fmtEra: (v: number | null) => String(v), eraBasis: 7 as never }
    const col = hittingColumns(ctx).find(c => c.key === 'h')!
    const rowsFor = (teamId: string) => buildRows({
      mode: 'players', side: 'hitting', players: labeled, lines: { batting, pitching: [] }, fielding: null, valueSeasons: null,
      batSeasons: aggregateBatting(labeled, batting, games), pitSeasons: [], teams: [], teamById: new Map(), teamId,
      qualified: false, qual: wpblQualifiers([], games as never), activeCol: col as never, sortAsc: false,
      onOpenPlayer: () => {}, playerLink: (() => ({})) as never, lobByGameTeam: new Map(), games: games as never, scope: 'regular',
      positionIndex: new Map(), pos: null, teamDp: null, armCs: null,
    }).map(r => r.key).sort()
    expect(rowsFor('NY')).toEqual(['stayed', 'traded'])
    expect(rowsFor('BOS')).toEqual([])
  })
})
