// Two MLB players side by side: StatsAPI lines in, rows out. Pure, no React, no fetch, so the
// rules below are pinned by __tests__/compare.test.ts against recorded payloads.
//
// WPBL's rules, which are about what a comparison claims rather than about either league
// (src/wpbl/derive/compare.ts states each at length):
//
// 1. A leader is named only on a row where BOTH sides have the number. A null is not a loss: a
//    position player with no innings does not have the worse ERA, they have no ERA.
// 2. Playing time leads every group and is never a win. More games is context, not a result.
// 3. Nothing adds the ticks up. There is no overall winner and no field one could be drawn from.
//
// WHAT IS MLB'S OWN: a fourth block of the advanced numbers StatsAPI publishes and the WPBL feed
// does not (WAR, wRC+, FIP), and a head-to-head read from StatsAPI's own `vsPlayer` record, which
// covers every career meeting, so it is told as this season, the career, and the postseason.

/** Which side of the page. 'a' is the left column and the first player in the URL. */
export type MlbCompareSide = 'a' | 'b'

export interface MlbCompareRow {
  key: string
  label: string
  better: 'high' | 'low'
  a: number | null
  b: number | null
  aText: string
  bText: string
  /** Null on a tie, when either side has no number, and on every playing-time row. */
  leader: MlbCompareSide | null
}

export interface MlbCompareGroup {
  key: 'batting' | 'pitching'
  label: string
  /** Playing time, the counting line, the rates, the advanced numbers: drawn in that order. */
  blocks: MlbCompareRow[][]
}

/** What the comparison is built from for each player: the season's regular-season lines and the
 *  sabermetrics read beside them (playerProfile's SeasonBundle carries exactly this). */
export interface MlbCompareLines {
  hitting: any | null
  pitching: any | null
  saber: { hitting: any | null; pitching: any | null }
}

// StatsAPI sends rates as strings (".312", "3.45") and an undefined one as ".---" or "-.--".
const num = (v: any): number | null => (v == null || v === '' || isNaN(Number(v)) ? null : Number(v))
const count = (v: any): number => Number(v) || 0

const dash = '—'
const int = (v: number | null) => (v == null ? dash : String(Math.round(v)))
/** .312, and 1.023 for an OPS over one. */
const rate3 = (v: number | null) => (v == null ? dash : v.toFixed(3).replace(/^0(?=\.)/, ''))
const two = (v: number | null) => (v == null ? dash : v.toFixed(2))
const one = (v: number | null) => (v == null ? dash : v.toFixed(1))
const pct = (v: number | null) => (v == null ? dash : `${(v * 100).toFixed(1)}%`)

/** Outs from a "123.1"-style innings string. A local copy, like reportCardData's: playerProfile's
 *  comes with that module's fetches, and this file stays importable by the edge and the tests. */
const ipToOuts = (ip: any): number => {
  const [w, f] = String(ip ?? '0').split('.')
  return (Number(w) || 0) * 3 + (Number(f) || 0)
}
const outsToIp = (outs: number) => `${Math.floor(outs / 3)}.${outs % 3}`

/** One row with its leader decided. The null guard is the point: `(a ?? 0) > (b ?? 0)` would
 *  hand the tick to whoever has a number when the other has none. */
function row(key: string, label: string, better: 'high' | 'low', a: number | null, b: number | null, fmt: (v: number | null) => string): MlbCompareRow {
  const leader: MlbCompareSide | null =
    a == null || b == null || a === b ? null
      : better === 'high' ? (a > b ? 'a' : 'b') : (a < b ? 'a' : 'b')
  return { key, label, better, a, b, aText: fmt(a), bText: fmt(b), leader }
}

/** Shown, never won. */
const played = (key: string, label: string, a: number | null, b: number | null, fmt: (v: number | null) => string): MlbCompareRow =>
  ({ ...row(key, label, 'high', a, b, fmt), leader: null })

const pa = (s: any) => count(s?.plateAppearances)
/** Over plate appearances, as the player card's K% is, and inverted: ranked on raw strikeouts the
 *  hitter who barely plays always wins. */
const kRate = (s: any) => (pa(s) > 0 ? count(s.strikeOuts) / pa(s) : null)

function battingBlocks(a: MlbCompareLines, b: MlbCompareLines): MlbCompareRow[][] {
  const x = a.hitting, y = b.hitting
  // A side with no line at all has no numbers, not zeros: every row is a dash, and so no row is a
  // win for the other side.
  const c = (s: any, f: (s: any) => number | null) => (s ? f(s) : null)
  return [
    [
      played('g', 'G', c(x, s => count(s.gamesPlayed)), c(y, s => count(s.gamesPlayed)), int),
      played('pa', 'PA', c(x, pa), c(y, pa), int),
    ],
    // The counting line in the order Stathead and Baseball-Reference lead with.
    [
      row('h', 'H', 'high', c(x, s => count(s.hits)), c(y, s => count(s.hits)), int),
      row('hr', 'HR', 'high', c(x, s => count(s.homeRuns)), c(y, s => count(s.homeRuns)), int),
      row('rbi', 'RBI', 'high', c(x, s => count(s.rbi)), c(y, s => count(s.rbi)), int),
      row('sb', 'SB', 'high', c(x, s => count(s.stolenBases)), c(y, s => count(s.stolenBases)), int),
      row('r', 'R', 'high', c(x, s => count(s.runs)), c(y, s => count(s.runs)), int),
      row('2b', '2B', 'high', c(x, s => count(s.doubles)), c(y, s => count(s.doubles)), int),
      row('3b', '3B', 'high', c(x, s => count(s.triples)), c(y, s => count(s.triples)), int),
      row('bb', 'BB', 'high', c(x, s => count(s.baseOnBalls)), c(y, s => count(s.baseOnBalls)), int),
      row('tb', 'TB', 'high', c(x, s => count(s.totalBases)), c(y, s => count(s.totalBases)), int),
    ],
    [
      row('avg', 'AVG', 'high', num(x?.avg), num(y?.avg), rate3),
      row('obp', 'OBP', 'high', num(x?.obp), num(y?.obp), rate3),
      row('slg', 'SLG', 'high', num(x?.slg), num(y?.slg), rate3),
      row('ops', 'OPS', 'high', num(x?.ops), num(y?.ops), rate3),
      row('k%', 'K%', 'low', c(x, kRate), c(y, kRate), pct),
    ],
    [
      row('wrc+', 'wRC+', 'high', num(a.saber.hitting?.wRcPlus), num(b.saber.hitting?.wRcPlus), int),
      row('bwar', 'WAR', 'high', num(a.saber.hitting?.war), num(b.saber.hitting?.war), one),
    ],
  ]
}

function pitchingBlocks(a: MlbCompareLines, b: MlbCompareLines): MlbCompareRow[][] {
  const x = a.pitching, y = b.pitching
  const c = (s: any, f: (s: any) => number | null) => (s ? f(s) : null)
  return [
    [
      played('pg', 'G', c(x, s => count(s.gamesPlayed)), c(y, s => count(s.gamesPlayed)), int),
      played('gs', 'GS', c(x, s => count(s.gamesStarted)), c(y, s => count(s.gamesStarted)), int),
      // From outs, so 6.2 stays two thirds of an inning.
      played('ip', 'IP', c(x, s => ipToOuts(s.inningsPitched)), c(y, s => ipToOuts(s.inningsPitched)), v => (v == null ? dash : outsToIp(v))),
    ],
    // W and SO more-is-better; BB the one 'low' count, because IP sits three rows above it and the
    // reader weighs the walks against the innings they came in. Hits and runs allowed appear only
    // as WHIP and ERA: as counts they reward not pitching.
    [
      row('w', 'W', 'high', c(x, s => count(s.wins)), c(y, s => count(s.wins)), int),
      row('so', 'SO', 'high', c(x, s => count(s.strikeOuts)), c(y, s => count(s.strikeOuts)), int),
      row('pbb', 'BB', 'low', c(x, s => count(s.baseOnBalls)), c(y, s => count(s.baseOnBalls)), int),
      row('sv', 'SV', 'high', c(x, s => count(s.saves)), c(y, s => count(s.saves)), int),
    ],
    [
      row('era', 'ERA', 'low', num(x?.era), num(y?.era), two),
      row('whip', 'WHIP', 'low', num(x?.whip), num(y?.whip), two),
      row('k9', 'K/9', 'high', num(x?.strikeoutsPer9Inn), num(y?.strikeoutsPer9Inn), two),
      row('kbb', 'K/BB', 'high', num(x?.strikeoutWalkRatio), num(y?.strikeoutWalkRatio), two),
    ],
    [
      row('fip', 'FIP', 'low', num(a.saber.pitching?.fip), num(b.saber.pitching?.fip), two),
      row('pwar', 'WAR', 'high', num(a.saber.pitching?.war), num(b.saber.pitching?.war), one),
    ],
  ]
}

/**
 * The comparison's groups. A group is shown when EITHER of them has done it, so a hitter against a
 * pitcher shows both, with one column empty in each, which is the true thing: one of them does
 * this and the other does not. On plate appearances and outs, not games: a line with neither in it
 * is not a season of that kind. The bigger sample leads, so the page opens on the half of it that
 * carries the comparison rather than a card of dashes.
 */
export function buildMlbComparison(rawA: MlbCompareLines, rawB: MlbCompareLines): MlbCompareGroup[] {
  // A line with nothing in it is no line. StatsAPI files a pitcher who never came to the plate
  // with a hitting row of zeros, which would draw "0 G, 0 PA" against a hitter as if they had come
  // up and done nothing; as no line, the column is dashes, which is what happened.
  const real = (l: MlbCompareLines): MlbCompareLines => ({
    ...l,
    hitting: pa(l.hitting) > 0 ? l.hitting : null,
    pitching: ipToOuts(l.pitching?.inningsPitched) > 0 || count(l.pitching?.battersFaced) > 0 ? l.pitching : null,
  })
  const a = real(rawA), b = real(rawB)
  const groups: (MlbCompareGroup & { weight: number })[] = []
  const pas = pa(a.hitting) + pa(b.hitting)
  if (pas > 0) groups.push({ key: 'batting', label: 'Batting', blocks: battingBlocks(a, b), weight: pas })
  const outs = ipToOuts(a.pitching?.inningsPitched) + ipToOuts(b.pitching?.inningsPitched)
  // Outs scaled to roughly batters faced (an inning is about four), so the two weigh alike.
  if (outs > 0) groups.push({ key: 'pitching', label: 'Pitching', blocks: pitchingBlocks(a, b), weight: outs * 4 / 3 })
  return groups.sort((x, y) => y.weight - x.weight).map(({ weight: _w, ...g }) => g)
}

// ─── Head to head ─────────────────────────────────────────────────────────────

export interface MlbDuelCounts { pa: number; ab: number; h: number; hr: number; bb: number; so: number }

/** One direction of a duel, in three slices. Each null when they did not meet in it. */
export interface MlbDuel {
  /** Which side was batting. */
  batter: MlbCompareSide
  season: MlbDuelCounts | null
  career: MlbDuelCounts | null
  postseason: MlbDuelCounts | null
}

/**
 * The slices of StatsAPI's `vsPlayer` record for one batter against one pitcher, read with every
 * game type (`gameType=R,F,D,L,W`). It answers a split per season per game type, so the three
 * slices are sums: this season's regular season, every regular season, and every postseason round.
 * `vsPlayerTotal` is not used: it repeats itself per group and adds nothing the sums do not say.
 *
 * THE POSTSEASON IS NEVER FOLDED INTO THE CAREER LINE, for the reason it is never folded into a
 * season total anywhere on the site: a reader checking the line against another site's regular-
 * season record would find it disagreeing by the playoffs.
 */
export function duelFromVsPlayer(d: any, season: number, batter: MlbCompareSide): MlbDuel | null {
  const splits: any[] = (d?.stats ?? []).find((st: any) => st.type?.displayName === 'vsPlayer')?.splits ?? []
  const sum = (keep: (s: any) => boolean): MlbDuelCounts | null => {
    const t = { pa: 0, ab: 0, h: 0, hr: 0, bb: 0, so: 0 }
    for (const s of splits.filter(keep)) {
      t.pa += count(s.stat?.plateAppearances); t.ab += count(s.stat?.atBats); t.h += count(s.stat?.hits)
      t.hr += count(s.stat?.homeRuns); t.bb += count(s.stat?.baseOnBalls); t.so += count(s.stat?.strikeOuts)
    }
    return t.pa > 0 ? t : null
  }
  const regular = (s: any) => (s.gameType ?? 'R') === 'R'
  const duel: MlbDuel = {
    batter,
    season: sum(s => regular(s) && Number(s.season) === season),
    career: sum(regular),
    postseason: sum(s => !regular(s)),
  }
  return duel.career || duel.postseason ? duel : null
}

/** Whether a duel can exist with `pitcher` on the mound: a pitcher, a two-way player, or anybody
 *  with innings this season. Two position players never get the request, which would answer empty. */
export function canPitch(positionCode: string | undefined, lines: MlbCompareLines): boolean {
  return positionCode === '1' || positionCode === 'Y' || ipToOuts(lines.pitching?.inningsPitched) > 0
}

/** Whether `batter` bats: anybody but a pitcher, and a pitcher with a plate appearance this season. */
export function canBat(positionCode: string | undefined, lines: MlbCompareLines): boolean {
  return positionCode !== '1' || pa(lines.hitting) > 0
}

// ─── Who to offer ─────────────────────────────────────────────────────────────

export interface MlbCompareCandidate {
  id: number
  name: string
  teamId: number | null
  /** The abbreviation StatsAPI files the player under ("SS", "P", "TWP"). */
  position: string | null
  pitcher: boolean
  /** The sort key: outs for a pitcher, plate appearances for a hitter. */
  played: number
  playedText: string
}

/**
 * The season's players in the order to offer them, from the two season pools the Stats boards
 * already read (one row per player, a traded season as its total).
 *
 * WPBL's order (rankCompareCandidates), for its reasons: the subject's own half of the game first,
 * since a hitter against a pitcher shares almost no rows; then by playing time, the honest proxy
 * for "is there a season here to compare" and not a ranking of quality; then by name. Each role is
 * a contiguous block sorted in its own unit, so every row's printed figure is in order. Before a
 * subject is chosen hitters lead, the larger group and the commoner first pick.
 */
export function rankMlbCompareCandidates(subjectId: number | null, hitting: any[], pitching: any[]): MlbCompareCandidate[] {
  const byId = new Map<number, { name: string; teamId: number | null; position: any; pa: number; outs: number }>()
  const take = (s: any) => {
    const id = Number(s?.player?.id)
    if (!id) return null
    let e = byId.get(id)
    if (!e) {
      e = { name: s.player.fullName ?? '', teamId: s.team?.id != null ? Number(s.team.id) : null, position: s.position, pa: 0, outs: 0 }
      byId.set(id, e)
    }
    return e
  }
  for (const s of hitting) { const e = take(s); if (e) e.pa = pa(s.stat) }
  for (const s of pitching) { const e = take(s); if (e) { e.outs = ipToOuts(s.stat?.inningsPitched); e.position ??= s.position } }

  const all: MlbCompareCandidate[] = [...byId].filter(([, e]) => e.name).map(([id, e]) => {
    const code: string | undefined = e.position?.code
    // Filed as a pitcher, or no position and more innings than plate appearances. A two-way player
    // is filed as one ('Y') and leads with hitting, as the player card does.
    const pitcher = code === '1' || (code == null && e.outs * 4 / 3 > e.pa)
    return {
      id, name: e.name, teamId: e.teamId, position: e.position?.abbreviation ?? null, pitcher,
      played: pitcher ? e.outs : e.pa,
      playedText: pitcher ? `${outsToIp(e.outs)} IP` : `${e.pa} PA`,
    }
  })
  const leadingRole = subjectId != null ? all.find(c => c.id === subjectId)?.pitcher ?? false : false
  return all
    .filter(c => c.id !== subjectId)
    .sort((x, y) => Number(y.pitcher === leadingRole) - Number(x.pitcher === leadingRole)
      || y.played - x.played
      || x.name.localeCompare(y.name))
}
