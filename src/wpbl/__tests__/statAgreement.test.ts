import { describe, it, expect } from 'vitest'
import { archivedSeasons, archiveTable, leagueTable } from './archive'
import {
  aggregateBatting, aggregatePitching, catcherSteals, plateAppearances, sumBatting, sumPitching, fmtRate, fmtTwo,
  ERA_BASIS_CANONICAL, type WpblBattingTotals, type WpblPitchingTotals,
} from '../stats'
import { hittingColumns, pitchingColumns, leagueLine } from '../statColumns'
import { buildRunExpectancy, playRunValues, type RunValueGame } from '../derive/runExpectancy'
import { fipWeights, wobaWeights } from '../derive/linearWeights'
import { runWpblFinder, EMPTY_FINDER_QUERY, finderFields, type FinderBoardSide } from '../derive/finder'
import { applyPlayCorrections, type WpblPlayCorrection } from '../playCorrections'
import { countsInStandings } from '../../league/season'
import type { WpblBattingLine, WpblFieldingLine, WpblGame, WpblPitchingLine, WpblPlayer, WpblRunValuePlay } from '../types'

// ONE NUMBER, EVERY PATH. The same stat is computed by more than one piece of code (the Players
// board's totals, Find's season rows, a club's box score from both sides), and each is right on its
// own tests. These hold them to each other over every archived season, where a disagreement is a
// figure on the site that differs by page. None pins a number: a correction moves the archive.

const players = leagueTable<WpblPlayer>('wpbl_players')

for (const season of archivedSeasons()) {
  const games = archiveTable<WpblGame>('wpbl_games', [season])
  const batting = archiveTable<WpblBattingLine>('wpbl_batting_lines', [season])
  const pitching = archiveTable<WpblPitchingLine>('wpbl_pitching_lines', [season])
  const fielding = archiveTable<WpblFieldingLine>('wpbl_fielding_lines', [season])

  // ── The league-relative stats, on the league's own line ────────────────────
  // Each is defined so the league is exactly average: an index of 100, wOBA scaled onto OBP, FIP's
  // constant rebuilt onto ERA. Anything else is a baseline or a constant built from the wrong slice.
  describe(`the league line is average by definition, ${season}`, () => {
    const plays = applyPlayCorrections(
      archiveTable<WpblRunValuePlay>('wpbl_game_plays', [season]),
      archiveTable<WpblPlayCorrection>('wpbl_play_corrections', [season]),
    ).sort((a, b) => (a.game_id < b.game_id ? -1 : a.game_id > b.game_id ? 1 : a.sequence - b.sequence))
    const values = playRunValues(plays, games as RunValueGame[], buildRunExpectancy(plays, games as RunValueGame[]))
    const league = leagueLine(batting, pitching, games, 'regular')
    const ctx = { league, wWeights: wobaWeights(values), fWeights: fipWeights(values), fmtEra: fmtTwo, eraBasis: ERA_BASIS_CANONICAL }
    const hit = (k: string) => hittingColumns(ctx).find(c => c.key === k)!.value(league.batting)
    const pit = (k: string) => pitchingColumns(ctx).find(c => c.key === k)!.value(league.pitching)

    it('puts OPS+, wRC+ and ERA+ at exactly 100', () => {
      expect(hit('opsPlus')).toBeCloseTo(100, 9)
      expect(hit('wrcPlus')).toBeCloseTo(100, 9)
      expect(pit('eraPlus')).toBeCloseTo(100, 9)
    })

    it('scales wOBA onto OBP and FIP onto ERA', () => {
      expect(hit('woba')).toBeCloseTo(league.batting.obp!, 9)
      expect(pit('fip')).toBeCloseTo(league.pitching.era!, 9)
    })

    // The same balls in play, counted from the bat and from the mound. Pitcher BABIP counted every
    // sacrifice bunt as a ball in play until the pitching line carried `sh` (Nov 23, 2026): .368
    // against .371 for 2026. As printed, not to the last digit: the league's own box score has one
    // more batter faced than plate appearances in 2026 (the accepted slip below), one ball in play.
    it('reads the same league BABIP from both sides', () => {
      expect(fmtRate(league.pitching.babip)).toBe(fmtRate(league.batting.babip))
    })
  })

  // ── A game's box score, from both sides ─────────────────────────────────────
  // What one club's batters did is what the other club's pitchers and fielders allowed. The feed
  // writes the two halves separately, so a slip in either shows as a disagreement here. Two of
  // 2026's are the league's own and accepted, named by game and check, so a new one fails.
  describe(`each box score agrees with itself, ${season}`, () => {
    const ACCEPTED = new Set([
      // Scorer's slips in the league's box score, both seen in the feed itself (Nov 23, 2026 audit).
      '2026-09-10 LA@NY LA: putouts against outs pitched',
      '2026-08-28 BOS@SF SF: plate appearances against batters faced',
    ])
    const sum = <T,>(rows: T[], k: keyof T) => rows.reduce((n, r) => n + (Number(r[k]) || 0), 0)
    const findings: string[] = []
    const finals = games.filter(g => g.status === 'final')

    for (const g of finals) {
      for (const side of ['home', 'away'] as const) {
        const team = side === 'home' ? g.home_team_id : g.away_team_id
        const opp = side === 'home' ? g.away_team_id : g.home_team_id
        const tag = `${g.game_date} ${g.away_team_id}@${g.home_team_id} ${team}`
        const bat = batting.filter(l => l.game_id === g.id && l.team_id === team)
        const pit = pitching.filter(l => l.game_id === g.id && l.team_id === opp)
        const fld = fielding.filter(l => l.game_id === g.id && l.team_id === opp)
        const note = (check: string, a: number, b: number) => { if (a !== b) findings.push(`${tag}: ${check} (${a} vs ${b})`) }
        note('runs against the score', sum(bat, 'r'), g[`${side}_score`] ?? 0)
        for (const k of ['h', 'r', 'bb', 'so', 'hr', 'hbp', 'doubles', 'triples'] as const) note(`${k} against ${k} allowed`, sum(bat, k), sum(pit, k))
        if (pit.every(l => l.sh != null)) note('sacrifice bunts against bunts allowed', sum(bat, 'sh'), sum(pit, 'sh'))
        if (pit.every(l => l.bf != null)) note('plate appearances against batters faced', plateAppearances(sumBatting(bat, games, 'all')), sum(pit, 'bf'))
        if (fld.length) note('putouts against outs pitched', sum(fld, 'po'), sum(pit, 'outs'))
      }
    }
    const fresh = findings.filter(f => !ACCEPTED.has(f.replace(/ \(.*\)$/, '')))
    const stale = [...ACCEPTED].filter(a => a.startsWith(season.slice(5)) && !findings.some(f => f.startsWith(a)))

    it('has no disagreement nobody has accepted', () => {
      expect(finals.length).toBeGreaterThan(0)
      expect(fresh).toEqual([])
    })
    it('accepts nothing that is gone', () => { expect(stale).toEqual([]) })

    // The feed charges every steal to the catcher AND the pitcher; `catcherSteals` keeps the
    // catcher's. A club's steals allowed must then be exactly what the other clubs' runners stole.
    it('charges each steal once, to the catcher', () => {
      const allowed = catcherSteals(fielding, batting, games).byTeam
      const counted = games.filter(countsInStandings).map(g => g.id)
      for (const [team, n] of allowed) {
        const stolen = batting.filter(l => counted.includes(l.game_id) && l.team_id !== team
          && games.some(g => g.id === l.game_id && (g.home_team_id === team || g.away_team_id === team)))
        expect(n, team).toBe(sum(stolen, 'sb'))
      }
    })
  })

  // ── Find's season rows against the Players board ────────────────────────────
  // Find sums its own season rows from the lines, with its own rate formulas. Every stat they share
  // must print the same for every player, a missing rate included: a hitter with walks and no
  // at-bats read AVG .000 and OPS 1.000 in Find (Nov 23, 2026) where the board showed a dash.
  describe(`Find's season rows match the Players board, ${season}`, () => {
    const thousandths = (v: number | null) => (v == null ? null : Math.round(v * 1000))
    const hundredths = (v: number | null) => (v == null ? null : Math.round(v * 100))
    const HIT: Record<string, (t: WpblBattingTotals) => number | null> = {
      g: t => t.g, pa: t => plateAppearances(t), ab: t => t.ab, h: t => t.h, '2b': t => t.doubles, '3b': t => t.triples,
      hr: t => t.hr, tb: t => t.tb, rbi: t => t.rbi, r: t => t.r, bb: t => t.bb, so: t => t.so, hbp: t => t.hbp,
      sb: t => t.sb, cs: t => t.cs, sf: t => t.sf, sh: t => t.sh, gdp: t => t.gdp, xbh: t => t.xbh,
      avg: t => thousandths(t.avg), obp: t => thousandths(t.obp), slg: t => thousandths(t.slg), ops: t => thousandths(t.ops),
    }
    const PIT: Record<string, (t: WpblPitchingTotals) => number | null> = {
      g: t => t.g, ip: t => t.outs, w: t => t.w, l: t => t.l, sv: t => t.s, gs: t => t.gs, so: t => t.so, h: t => t.h,
      r: t => t.r, er: t => t.er, bb: t => t.bb, hr: t => t.hr, hbp: t => t.hbp, wp: t => t.wp, bk: t => t.bk, bf: t => t.bf,
      era: t => hundredths(t.era), whip: t => hundredths(t.whip),
    }
    const board = {
      hitting: new Map<string, WpblBattingTotals>(aggregateBatting(players, batting, games).map(s => [s.player.id, s.totals])),
      pitching: new Map<string, WpblPitchingTotals>(aggregatePitching(players, pitching, games).map(s => [s.player.id, s.totals])),
    }
    const check = <T,>(side: FinderBoardSide, stats: Record<string, (t: T) => number | null>, rows: Map<string, T>) => {
      const fields = new Set(finderFields(side, 'season').map(f => f.key))
      for (const [key, want] of Object.entries(stats)) {
        it(`${side} ${key}`, () => {
          expect(fields.has(key), `${key} is not a season field`).toBe(true)
          const q = { ...EMPTY_FINDER_QUERY, per: 'season' as const, conditions: [] }
          const res = runWpblFinder(side, batting, pitching, players, games, q, 10_000, { key, desc: true }, { eraInnings: ERA_BASIS_CANONICAL })
          expect(res.rows.length).toBeGreaterThan(0)
          const wrong: string[] = []
          for (const r of res.rows) {
            const t = rows.get(r.player?.id ?? '')
            if (!t) { wrong.push(`${r.name}: no board row`); continue }
            const w = want(t), got = r.values[key]
            if (w == null ? !Number.isNaN(got) : got !== w) wrong.push(`${r.name}: Find ${got}, board ${w}`)
          }
          expect(wrong).toEqual([])
        })
      }
    }
    check('hitting', HIT, board.hitting)
    check('pitching', PIT, board.pitching)
  })
}

// Sanity on the inputs, so a missing archive cannot pass every check above by checking nothing.
describe('the archive', () => {
  it('has a season with a postseason, and sums the regular season alone', () => {
    const games = archiveTable<WpblGame>('wpbl_games')
    expect(games.some(g => !countsInStandings(g))).toBe(true)
    expect(sumPitching(archiveTable('wpbl_pitching_lines'), games).outs).toBeGreaterThan(0)
  })
})
