import { describe, it, expect } from 'vitest'
import { archivedSeasons, archiveTable, leagueTable } from './archive'
import { computeWpblPlayerRanks, type WpblStatRank } from '../percentiles'
import { leadersFor, type LeaderCol, type LeaderTotals } from '../LeadersBoard'
import { aggregateBatting, aggregatePitching, plateAppearances, wpblQualifiers, type WpblBattingTotals, type WpblPitchingTotals } from '../stats'
import { HIT_COLS, PIT_COLS } from '../statColumns'
import { cellText } from '../stats/columns'
import { compareRows } from '../leaderOrder'
import { printedRanks, LEADERS_SHOWN } from '../../ui/leaders'
import type { WpblBattingLine, WpblGame, WpblPitchingLine, WpblPlayer, WpblTeam } from '../types'

// ONE RANK PER PLAYER PER STAT, wherever it is printed. A player card says "3rd" beside a stat
// and links to the Players board sorted by it; the Leaders card for the same stat lists the top
// five. All three are computed by different code (percentiles.ts, StatsView's `printedRanks` over
// the sorted rows, LeadersBoard's `leadersFor`), so nothing but this test keeps them agreeing.
// They did not: on 2026, four cards read "5th in SB" against the qualified field while both
// boards had all four at T-6 among everyone.
//
// Every archived season on its own, so a 2027 directory is checked the day it is archived.

const players = leagueTable<WpblPlayer>('wpbl_players')
const teams = leagueTable<WpblTeam>('wpbl_teams')

/** Card rank key, board column key. The pairs PlayerDetail's `rankFor` links. */
const BAT: [string, string][] = [
  ['avg', 'avg'], ['obp', 'obp'], ['slg', 'slg'], ['ops', 'ops'],
  ['c_hr', 'hr'], ['c_rbi', 'rbi'], ['c_h', 'h'], ['c_r', 'r'], ['c_sb', 'sb'], ['c_2b', '2b'], ['c_3b', '3b'], ['c_bb', 'bb'],
]
const PIT: [string, string][] = [
  ['era', 'era'], ['whip', 'whip'], ['kbb', 'kbb'], ['c_so', 'so'], ['c_outs', 'ip'], ['c_w', 'w'], ['c_s', 'sv'],
]

for (const season of archivedSeasons()) {
  describe(`ranks agree across the card and the boards, ${season}`, () => {
    const games = archiveTable<WpblGame>('wpbl_games', [season])
    const batting = archiveTable<WpblBattingLine>('wpbl_batting_lines', [season])
    const pitching = archiveTable<WpblPitchingLine>('wpbl_pitching_lines', [season])
    const qual = wpblQualifiers(teams, games)
    const batSeasons = aggregateBatting(players, batting, games)
    const pitSeasons = aggregatePitching(players, pitching, games)

    const cards = new Map<string, ReturnType<typeof computeWpblPlayerRanks>>()
    const card = (id: string) => {
      if (!cards.has(id)) cards.set(id, computeWpblPlayerRanks(id, players, teams, games, batting, pitching))
      return cards.get(id)!
    }
    const cardRank = (id: string, key: string): WpblStatRank | undefined => {
      const r = card(id)
      return [...r.batting, ...r.pitching, ...r.battingCounts, ...r.pitchingCounts].find(x => x.key === key)
    }

    it('has a live qualifier, or the rate checks below check nothing', () => {
      expect(qual.active).toBe(true)
    })

    const check = <T extends LeaderTotals>(
      side: 'hitting' | 'pitching', pairs: [string, string][], cols: LeaderCol<T>[],
      seasons: { player: WpblPlayer; totals: T }[], sample: (t: T) => number, bar: number,
    ) => {
      for (const [rankKey, colKey] of pairs) {
        it(`${side} ${colKey}`, () => {
          const col = cols.find(c => c.key === colKey)!
          // The Players board: rates over the qualified rows (the link opens it qualified), counts
          // over everyone, sorted by the shared row order and ranked on the printed text.
          const rows = seasons
            .filter(s => !col.rate || sample(s.totals) >= bar)
            .filter(s => { const v = col.value(s.totals); return v != null && Number.isFinite(v) })
            .sort((a, b) => compareRows(col.value(a.totals), col.value(b.totals), !!col.lowerBetter,
              sample(a.totals), sample(b.totals), a.player.name, b.player.name))
          const board = printedRanks(rows.map(s => cellText(col, s.totals)))
          const wrong: string[] = []
          rows.forEach((s, i) => {
            const mine = cardRank(s.player.id, rankKey)
            if (!mine) { if (col.rate) wrong.push(`${s.player.name}: on the board at ${board[i].rank}, no rank on the card`); return }
            if (mine.rank !== board[i].rank) wrong.push(`${s.player.name} ${cellText(col, s.totals)}: card ${mine.rank} of ${mine.of}, board ${board[i].rank} of ${rows.length}`)
            if (mine.of !== rows.length) wrong.push(`${s.player.name}: card field ${mine.of}, board field ${rows.length}`)
          })
          // The Leaders card shows the top of the same board, at the same places.
          const qualFor = { active: qual.active, minPa: qual.minPa, minOuts: qual.minOuts, minG: qual.minG }
          for (const row of leadersFor(seasons, col, side, qualFor)) {
            const mine = cardRank(row.player.id, rankKey)
            if (mine?.rank !== row.rank) wrong.push(`${row.player.name} ${row.text}: card ${mine?.rank}, Leaders card ${row.rank}`)
          }
          expect(leadersFor(seasons, col, side, qualFor).length).toBeLessThanOrEqual(LEADERS_SHOWN)
          expect(wrong).toEqual([])
        })
      }
    }

    check<WpblBattingTotals>('hitting', BAT, HIT_COLS, batSeasons, plateAppearances, qual.minPa)
    check<WpblPitchingTotals>('pitching', PIT, PIT_COLS, pitSeasons, t => t.outs, qual.minOuts)
  })
}
