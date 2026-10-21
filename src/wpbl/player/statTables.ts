import { OVR_COLS, hittingColumns, pitchingColumns, type Col, type WpblLeagueLine } from '../statColumns'
import { plateAppearances, type EraBasis, type WpblBattingTotals, type WpblPitchingTotals } from '../stats'
import { fmtRunValue } from '../../league/runExpectancy'
import type { SeasonScope } from '../season'
import type { WpblBoard } from '../searchAnswers'
import type { BoardPlace, PlayerSeasonValue } from '../derive/seasonValue'
import type { StatCol, StatRank, StatRow } from '../../ui/playerCard'
import type { Role } from './pieces'
import type { PitchProfilePair } from '../PitchProfile'
import { fmtPct, type PitchRates } from '../derive/pitches'

// THE PLAYER CARD'S SEASON TABLES, as data: the summary a reader expects, and behind "All stats" the
// standard line and the advanced figures. Pure, so a test can hold the card's figures against the
// Stats table's own.
//
// EVERY FIGURE A COLUMN OF THE STATS TABLE. The rates and the league-relative figures come from the
// table's own builders (statColumns.ts) over the card's totals, and WAR from the board the search
// box builds (searchAnswers.ts), so the card and the table cannot print two numbers for one stat.
// The league row is the same columns over the league's line, which is how wRC+ reads 100 there.

/** A rank worth printing, and where pressing it goes. Null where the column has none or misses the bar. */
export type RankFor = (role: Role, label: string) => { rank: StatRank; onRank?: () => void } | null

export interface WpblTablesInput {
  bt: WpblBattingTotals
  pt: WpblPitchingTotals
  /** The league's line over the same slice as the totals (a season's playoffs, a career), or null
   *  until the league's lines land. */
  league: WpblLeagueLine | null
  /** The Stats table's board for the span: undefined while it is read, null when it failed. */
  board: WpblBoard | null | undefined
  playerId: string
  scope: SeasonScope
  /** Both roles are real, so each table's WAR is its own side's. */
  twoWay: boolean
  /** Wins added and runs on the bases, read off Run value's boards, and whether they apply at all
   *  (one season's regular season). */
  value: PlayerSeasonValue | null
  valueOn: boolean
  /** A reliever's line leads with saves where a starter's leads with the record. */
  leadsWithSaves: boolean
  rankFor: RankFor
  fmtEra: (v: number | null) => string
  eraBasis: EraBasis
}

export interface RoleTables { summary: StatCol[]; standard: StatCol[]; advanced: StatCol[] }

export function wpblRoleTables(role: Role, i: WpblTablesInput): RoleTables {
  // The weights are the span's (a season's regular season); the league line is the slice on screen,
  // as the Stats table builds a playoff board: a playoff hitter's wRC+ is against the playoffs.
  const ctx = {
    league: i.league ?? EMPTY_LEAGUE,
    wWeights: i.board?.weights.woba ?? null,
    fWeights: i.board?.weights.fip ?? null,
    fmtEra: i.fmtEra,
    eraBasis: i.eraBasis,
  }
  // Waiting on a read that has not failed: drawn as a sample, not as a dash that becomes a number.
  const leaguePending = i.league == null
  const weightsPending = leaguePending || i.board === undefined
  const regular = i.scope === 'regular'
  const own = i.board?.value?.get(i.playerId)
  const warPending = regular && i.board === undefined

  const ranked = (label: string, c: StatCol): StatCol => {
    const r = i.rankFor(role, label)
    return r ? { ...c, rank: r.rank, onRank: r.onRank } : c
  }
  // A column of the Stats table, over the player and over the league. `rate` columns get a league
  // figure; a count has no average worth printing beside one player's season.
  const fromCol = <T>(cols: Col<T>[], key: string, mine: T, lg: T | null, pending: boolean, sample: string, label?: string): StatCol => {
    const c = cols.find(x => x.key === key)!
    const show = (t: T) => (c.display ? c.display(t) : String(c.value(t) ?? '—'))
    return ranked(label ?? c.label, {
      label: label ?? c.label,
      value: pending ? sample : show(mine),
      pending,
      league: c.rate && lg && !leaguePending ? show(lg) : null,
    })
  }
  const war = (key: 'war' | 'batWar' | 'pitWar', label: string): StatCol => {
    const c = OVR_COLS.find(x => x.key === key)!
    return {
      label, term: 'WAR',
      value: warPending ? '0.00' : regular && own && c.display ? c.display(own) : '—',
      pending: warPending,
    }
  }
  const valueCell = (label: string, term: string, p: BoardPlace | null | undefined, digits: 1 | 2, sample: string): StatCol => {
    const pending = i.valueOn && !i.value
    return {
      label, term,
      value: pending ? sample : i.valueOn && p ? fmtRunValue(p.value, digits) : '—',
      pending,
      rank: !pending && p ? i.rankFor(role, label)?.rank ?? null : null,
    }
  }
  const count = (label: string, value: number | string): StatCol => ranked(label, { label, value })

  if (role === 'pitching') {
    const cols = pitchingColumns(ctx)
    const pt = i.pt, lg = i.league?.pitching ?? null
    const p = (key: string, pending = false, sample = '0.00', label?: string) => fromCol(cols, key, pt, lg, pending, sample, label)
    const sideWar = war(i.twoWay ? 'pitWar' : 'war', i.twoWay ? 'Pit WAR' : 'WAR')
    return {
      summary: [
        count('G', pt.g), count('GS', pt.gs), p('ip'),
        i.leadsWithSaves ? p('sv') : { label: 'W-L', value: `${pt.w}–${pt.l}` },
        p('era'), p('whip'), p('so'), p('bb'),
        p('fip', weightsPending), sideWar,
      ],
      standard: [
        p('w'), p('l'), p('era'), count('G', pt.g), count('GS', pt.gs), p('sv'), p('ip'),
        p('h'), p('r'), p('er'), p('hr'), p('bb'), p('so'), p('whip'),
        ...(pt.hbp ? [p('hbp')] : []), ...(pt.wp ? [p('wp')] : []), ...(pt.bk ? [p('bk')] : []),
        p('p'),
      ],
      advanced: [
        p('eraPlus', leaguePending, '000'), p('fip', weightsPending),
        p('kPct', false, '00.0%'), p('bbPct', false, '00.0%'), p('kbbPct', false, '00.0%'), p('kbb'),
        p('babip', false, '.000'), sideWar,
        valueCell('WPA', 'WPA', i.value?.wpaPitching, 2, '+0.00'),
      ],
    }
  }

  const cols = hittingColumns(ctx)
  const bt = i.bt, lg = i.league?.batting ?? null
  const h = (key: string, pending = false, sample = '.000', label?: string) => fromCol(cols, key, bt, lg, pending, sample, label)
  const sideWar = war(i.twoWay ? 'batWar' : 'war', i.twoWay ? 'Pos WAR' : 'WAR')
  const runs = (key: 'bat' | 'fld', label: string): StatCol => {
    const c = OVR_COLS.find(x => x.key === key)!
    return { label, value: warPending ? '+0.0' : regular && own && c.display ? c.display(own) : '—', pending: warPending }
  }
  return {
    summary: [
      count('G', bt.g), count('PA', plateAppearances(bt)), h('hr'),
      h('avg'), h('obp'), h('slg'), h('ops'),
      h('woba', weightsPending), h('wrcPlus', weightsPending, '000'), sideWar,
    ],
    standard: [
      count('G', bt.g), count('PA', plateAppearances(bt)), h('ab'), h('r'), h('h'), h('2b'), h('3b'), h('hr'),
      h('rbi'), h('bb'), h('so'), h('sb'), h('cs'),
      h('avg'), h('obp'), h('slg'), h('ops'),
      ...(bt.gdp ? [h('gdp')] : []), ...(bt.hbp ? [h('hbp')] : []), ...(bt.sh ? [h('sh')] : []), ...(bt.sf ? [h('sf')] : []),
    ],
    advanced: [
      h('opsPlus', leaguePending, '000'), h('iso'), h('babip'), h('kPct', false, '00.0%'), h('bbPct', false, '00.0%'),
      h('woba', weightsPending), h('wrcPlus', weightsPending, '000'), sideWar,
      runs('bat', 'Bat'),
      valueCell('BsR', 'BsR', i.value?.bases, 1, '+0.0'),
      runs('fld', 'Fld'),
      valueCell('WPA', 'WPA', i.value?.wpaHitting, 2, '+0.00'),
    ],
  }
}

/** The lead cell: the year, or what the slice is when it is not a plain season. */
export function seasonLead(season: number | null, career: boolean, scope: SeasonScope): string {
  if (scope === 'postseason') return 'Playoffs'
  if (scope === 'all') return 'Total'
  return career ? 'Career' : season != null ? String(season) : 'Season'
}

export const row = (lead: string, cols: StatCol[]): StatRow => ({ lead, cols })

// A league line with nothing in it, for the columns before the league's lines land. Every
// league-relative column reads it as no baseline and returns null, which the card draws as a sample.
const EMPTY_LEAGUE = { batting: {}, pitching: {} } as unknown as WpblLeagueLine

/**
 * PLATE DISCIPLINE, from every pitch in the play log (the Pitches board's arithmetic, read for one
 * player by usePitchProfiles), with the league's under it. Null when the side's pitch record is too
 * thin to draw; every cell a sample while the log is read.
 *
 * NO K% OR BB% HERE, though the pitch log has both: the Advanced table has them from the box scores,
 * and the two counts differ by the odd plate appearance the play log missed, which would put two
 * walk rates on one card a tenth apart.
 */
export function wpblDisciplineCols(role: Role, profiles: Record<Role, PitchProfilePair | null> | undefined): StatCol[] | null {
  const pair = profiles?.[role]
  if (profiles && !pair) return null
  const pending = !profiles
  const defs: [label: string, key: keyof PitchRates][] = role === 'pitching'
    ? [['P/PA', 'pitchesPerPa'], ['Strike%', 'strikePct'], ['F-Strike%', 'firstStrikePct'], ['Swing%', 'swingPct'],
      ['Whiff%', 'whiffPct'], ['SwStr%', 'swStrPct'], ['Putaway%', 'putawayPct']]
    : [['P/PA', 'pitchesPerPa'], ['Swing%', 'swingPct'], ['Contact%', 'contactPct'], ['Whiff%', 'whiffPct'],
      ['SwStr%', 'swStrPct'], ['CStr%', 'calledPct']]
  const show = (key: keyof PitchRates, v: number | null) => (key === 'pitchesPerPa' ? (v == null ? '—' : v.toFixed(2)) : fmtPct(v))
  return defs.map(([label, key]) => ({
    label,
    value: pending ? (key === 'pitchesPerPa' ? '0.00' : '00.0%') : show(key, pair!.me[key]),
    pending,
    league: pair ? show(key, pair.league[key]) : null,
  }))
}
