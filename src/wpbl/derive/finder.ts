import { ipToOuts, outsToIp } from '../innings'
import { scopedLines, type SeasonScope, type WpblSeasonGame } from '../season'
import type { WpblBattingLine, WpblGame, WpblPitchingLine, WpblPlayer } from '../types'

/**
 * The finder: every game line in the league that matches a set of conditions.
 *
 * WHAT IT IS FOR. The Stats boards answer questions somebody thought to put on a board. This
 * answers the ones nobody did: how many times did anyone strike out five in a game, who has
 * gone four for four more than once, has a pitcher ever walked nobody through five. Those are
 * the questions a fan asks out loud, and without this the only way to answer one is to read
 * thirty box scores.
 *
 * WHY IT IS TRACTABLE HERE AND NEEDS A DATA WAREHOUSE ELSEWHERE. Baseball Reference built
 * Stathead because MLB has millions of game lines and no browser can sort them. This league's
 * whole season is about 750: every batting and pitching line the WPBL has ever produced is
 * already in memory when the Stats tab opens, cached app-wide by `fetchWpblAllLines`, each one
 * carrying its own `game_id`. So the query engine is a `filter` and a `sort`, with no index, no
 * RPC, no new table and no new request. The hard part of this feature is not the searching.
 *
 * THE RESULT IS TWO ANSWERS, NOT ONE, and that is the design. A list of matching games answers
 * "when did this happen"; the tally beside it answers "who does this most", which is the more
 * interesting half and is free once the matching is done. Stathead charges for the second one.
 *
 * EVERY CONDITION IS AND. Nothing here builds an OR, and that is a deliberate stopping point
 * rather than an oversight: "five strikeouts AND no walks" is a question people actually ask,
 * "five strikeouts OR no walks" is not, and offering a boolean tree would cost the whole UI.
 */

export type FinderSide = 'hitting' | 'pitching'

/** The three comparisons, which is all a box-score number ever needs. */
export type FinderOp = 'gte' | 'lte' | 'eq'

export const FINDER_OPS: { op: FinderOp; label: string; symbol: string }[] = [
  { op: 'gte', label: 'at least', symbol: '≥' },
  { op: 'lte', label: 'at most', symbol: '≤' },
  { op: 'eq', label: 'exactly', symbol: '=' },
]

export interface FinderCondition {
  field: string
  op: FinderOp
  /** Already in the field's OWN unit: innings are stored as outs, so this is outs. */
  value: number
}

/** Which side of the game a line sits on, and where it was played. */
export type FinderVenue = 'any' | 'home' | 'away'

export interface FinderQuery {
  conditions: FinderCondition[]
  /** The club the player was playing FOR. Null is every club. */
  teamId: string | null
  /** The club being played AGAINST. Null is every club. */
  oppId: string | null
  venue: FinderVenue
  scope: SeasonScope
}

export const EMPTY_FINDER_QUERY: FinderQuery = {
  conditions: [], teamId: null, oppId: null, venue: 'any', scope: 'regular',
}

interface Field<L> {
  key: string
  label: string
  /** The unit drawn beside the number, when this field is the headline. */
  unit: string
  value: (l: L) => number
  /** How the stored number is drawn. Innings are the only field where they differ. */
  display?: (v: number) => string
  /** Turn what the reader typed into the stored unit. Innings again: "4.2" is 14 outs. */
  parse?: (raw: string) => number
  /** Turn the stored unit back into what the reader would have typed, for the input box. */
  unparse?: (v: number) => string
}

// ─── What can be asked about ──────────────────────────────────────────────────
//
// EVERY NUMBER ON THE FEED'S LINE, and nothing derived. A finder whose fields are a curated
// subset is a board with extra steps: the whole point is the question nobody anticipated, so
// the list is "what the box score records" rather than "what we think is interesting". The one
// exception in each direction is a sum the line does not carry but a reader plainly means:
// times on base for a hitter, and baserunners allowed for a pitcher.
const HIT_FIELDS: Field<WpblBattingLine>[] = [
  { key: 'h', label: 'Hits', unit: 'H', value: l => l.h },
  { key: 'ab', label: 'At-bats', unit: 'AB', value: l => l.ab },
  { key: 'tb', label: 'Total bases', unit: 'TB', value: l => l.tb },
  { key: 'hr', label: 'Home runs', unit: 'HR', value: l => l.hr },
  { key: '2b', label: 'Doubles', unit: '2B', value: l => l.doubles },
  { key: '3b', label: 'Triples', unit: '3B', value: l => l.triples },
  { key: 'rbi', label: 'Runs batted in', unit: 'RBI', value: l => l.rbi },
  { key: 'r', label: 'Runs scored', unit: 'R', value: l => l.r },
  { key: 'bb', label: 'Walks', unit: 'BB', value: l => l.bb },
  { key: 'so', label: 'Strikeouts', unit: 'SO', value: l => l.so },
  { key: 'hbp', label: 'Hit by pitch', unit: 'HBP', value: l => l.hbp },
  { key: 'sb', label: 'Stolen bases', unit: 'SB', value: l => l.sb },
  { key: 'cs', label: 'Caught stealing', unit: 'CS', value: l => l.cs },
  { key: 'gdp', label: 'Grounded into DP', unit: 'GDP', value: l => l.gdp ?? 0 },
  { key: 'ob', label: 'Times on base', unit: 'TOB', value: l => l.h + l.bb + l.hbp },
  // The trips to the plate, summed the way `plateAppearances` does it. Sac hits are in, which
  // is the half every hand-rolled copy of this has dropped: see stats.ts.
  { key: 'pa', label: 'Plate appearances', unit: 'PA', value: l => l.ab + l.bb + l.hbp + l.sf + l.sh },
]

const PIT_FIELDS: Field<WpblPitchingLine>[] = [
  // STORED IN OUTS AND ASKED FOR IN INNINGS, which is the one field where the two differ.
  // "4.2" is four and two thirds, not four point two, so the input is parsed with `ipToOuts`
  // rather than with Number: typed as a decimal, an innings threshold is wrong by a third of
  // an inning about two thirds of the time, and it reads perfectly either way.
  { key: 'ip', label: 'Innings pitched', unit: 'IP', value: l => l.outs,
    display: outsToIp, parse: ipToOuts, unparse: outsToIp },
  { key: 'so', label: 'Strikeouts', unit: 'K', value: l => l.so },
  { key: 'h', label: 'Hits allowed', unit: 'H', value: l => l.h },
  { key: 'r', label: 'Runs allowed', unit: 'R', value: l => l.r },
  { key: 'er', label: 'Earned runs', unit: 'ER', value: l => l.er },
  { key: 'bb', label: 'Walks allowed', unit: 'BB', value: l => l.bb },
  { key: 'hr', label: 'Home runs allowed', unit: 'HR', value: l => l.hr },
  { key: 'hbp', label: 'Hit batters', unit: 'HBP', value: l => l.hbp },
  { key: 'wp', label: 'Wild pitches', unit: 'WP', value: l => l.wp },
  { key: 'bk', label: 'Balks', unit: 'BK', value: l => l.bk },
  { key: 'bf', label: 'Batters faced', unit: 'BF', value: l => l.bf ?? 0 },
  { key: 'pitches', label: 'Pitches thrown', unit: 'P', value: l => l.pitches ?? 0 },
  { key: 'strikes', label: 'Strikes thrown', unit: 'STR', value: l => l.strikes ?? 0 },
  { key: 'baserunners', label: 'Baserunners allowed', unit: 'BR', value: l => l.h + l.bb + l.hbp },
]

/** The fields one side can be asked about, in the order the pickers list them. */
export function finderFields(side: FinderSide): { key: string; label: string; unit: string }[] {
  const fields: Field<never>[] = (side === 'pitching' ? PIT_FIELDS : HIT_FIELDS) as Field<never>[]
  return fields.map(f => ({ key: f.key, label: f.label, unit: f.unit }))
}

function fieldFor(side: FinderSide, key: string): Field<never> | null {
  const fields: Field<never>[] = (side === 'pitching' ? PIT_FIELDS : HIT_FIELDS) as Field<never>[]
  return fields.find(f => f.key === key) ?? null
}

/** The default condition a freshly added row carries: the side's headline stat, at least one. */
export function defaultCondition(side: FinderSide): FinderCondition {
  return { field: side === 'pitching' ? 'so' : 'h', op: 'gte', value: side === 'pitching' ? 5 : 3 }
}

/** What the reader typed, in the field's own unit. NaN and negatives clamp to 0. */
export function parseFinderValue(side: FinderSide, fieldKey: string, raw: string): number {
  const f = fieldFor(side, fieldKey)
  const n = f?.parse ? f.parse(raw) : Number(raw)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** The stored number as the reader would have typed it, for the input box. */
export function unparseFinderValue(side: FinderSide, fieldKey: string, v: number): string {
  const f = fieldFor(side, fieldKey)
  return f?.unparse ? f.unparse(v) : String(v)
}

/** A stored number as it should be drawn. */
export function displayFinderValue(side: FinderSide, fieldKey: string, v: number): string {
  const f = fieldFor(side, fieldKey)
  return f?.display ? f.display(v) : String(v)
}

/** The unit label for a field, for the row's big number. */
export function finderUnit(side: FinderSide, fieldKey: string): string {
  return fieldFor(side, fieldKey)?.unit ?? ''
}

export interface FinderRow {
  key: string
  player: WpblPlayer | null
  name: string
  /** The club played for THAT DAY, off the line. Never the roster's, which means "now". */
  teamId: string | null
  game: WpblGame | null
  /** The value of the first condition's field, which is what the row is measured by. */
  headline: number
  headlineDisplay: string
  /** The rest of the line, so the number has a shape. */
  detail: string
}

export interface FinderTally {
  player: WpblPlayer | null
  name: string
  teamId: string | null
  games: number
}

export interface FinderResult {
  rows: FinderRow[]
  /** How many lines matched, before any cap on `rows`. */
  total: number
  /** How many lines were considered, so a zero result can say what it searched. */
  searched: number
  /** Who did it most often. The second answer, free once the matching is done. */
  tally: FinderTally[]
  /** The field `headline` is measured in, for the unit beside each number. */
  headlineField: string
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

const hitDetail = (l: WpblBattingLine): string => [
  `${l.h}-for-${l.ab}`,
  l.hr > 0 && plural(l.hr, 'HR', 'HR'),
  l.doubles > 0 && plural(l.doubles, '2B', '2B'),
  l.rbi > 0 && plural(l.rbi, 'RBI', 'RBI'),
  l.bb > 0 && plural(l.bb, 'walk'),
  l.sb > 0 && plural(l.sb, 'SB', 'SB'),
].filter(Boolean).join(', ')

const pitDetail = (l: WpblPitchingLine): string =>
  `${outsToIp(l.outs)} IP, ${l.h} H, ${l.r} R, ${l.bb} BB, ${l.so} K`

const passes = (v: number, c: FinderCondition): boolean =>
  c.op === 'gte' ? v >= c.value : c.op === 'lte' ? v <= c.value : v === c.value

/**
 * Run a query over every stored line.
 *
 * FINALS ONLY, and the schedule is REQUIRED, both for the reasons written out on
 * `wpblBestGames`: a line carries a `game_id` and nothing else, so it cannot say for itself
 * whether it belongs to the slice being asked about, and a half-finished line is not a
 * performance yet.
 */
export function runWpblFinder(
  side: FinderSide,
  batting: WpblBattingLine[],
  pitching: WpblPitchingLine[],
  players: WpblPlayer[],
  games: WpblGame[],
  query: FinderQuery,
  limit = 50,
): FinderResult {
  const finals = games.filter(g => g.status === 'final')
  const gameById = new Map(finals.map(g => [g.id, g]))
  const seasonGames: WpblSeasonGame[] = finals
  const playerById = new Map(players.map(p => [p.id, p]))
  const headlineField = query.conditions[0]?.field ?? (side === 'pitching' ? 'so' : 'h')

  // Every filter that is about the GAME rather than the line, applied once per line because a
  // line's club is its own and not the roster's. `oppId` and `venue` both need the game row,
  // which is why neither can be pushed into the line filter above.
  const gameOk = (g: WpblGame | undefined, teamId: string | null): boolean => {
    if (!g) return false
    const home = teamId != null && g.home_team_id === teamId
    const opp = home ? g.away_team_id : g.home_team_id
    if (query.oppId && opp !== query.oppId) return false
    if (query.venue === 'home' && !home) return false
    if (query.venue === 'away' && home) return false
    return true
  }

  const collect = <L extends { id: string; player_id: string; team_id: string | null; game_id: string }>(
    lines: L[], fields: Field<L>[], detail: (l: L) => string, played: (l: L) => boolean,
  ): FinderResult => {
    const byKey = new Map(fields.map(f => [f.key, f]))
    const head = byKey.get(headlineField) ?? fields[0]
    const inScope = scopedLines(lines.filter(l => gameById.has(l.game_id)), seasonGames, query.scope)
    // THE SEARCHED COUNT EXCLUDES LINES THAT ARE NOT APPEARANCES. Ninety-seven of the season's
    // batting lines are a pitcher's all-zero row, and telling a reader who found nothing that we
    // looked through 610 lines when 97 of them could never match anything is a worse answer than
    // the number they would have guessed.
    const pool = inScope.filter(l => (!query.teamId || l.team_id === query.teamId) && played(l))
    const matched: { line: L; head: number }[] = []
    for (const line of pool) {
      if (!gameOk(gameById.get(line.game_id), line.team_id)) continue
      let ok = true
      for (const c of query.conditions) {
        const f = byKey.get(c.field)
        // An unknown field is a hand-edited link, and dropping the condition would answer a
        // different question than the one the URL asks. Match nothing instead.
        if (!f || !passes(f.value(line), c)) { ok = false; break }
      }
      if (ok) matched.push({ line, head: head.value(line) })
    }

    matched.sort((a, b) => {
      if (a.head !== b.head) return b.head - a.head
      const ad = gameById.get(a.line.game_id)?.game_date ?? ''
      const bd = gameById.get(b.line.game_id)?.game_date ?? ''
      if (ad !== bd) return ad < bd ? -1 : 1
      return a.line.id < b.line.id ? -1 : 1
    })

    const counts = new Map<string, number>()
    // The club a player matched for MOST OFTEN, so a traded player's tally is one row filed
    // under the club it mostly belongs to rather than the roster's "now", which would put
    // earlier games under a club not yet joined. Tallied here in the same pass as the counts.
    const clubs = new Map<string, Map<string | null, number>>()
    for (const m of matched) {
      counts.set(m.line.player_id, (counts.get(m.line.player_id) ?? 0) + 1)
      let byClub = clubs.get(m.line.player_id)
      if (!byClub) { byClub = new Map(); clubs.set(m.line.player_id, byClub) }
      byClub.set(m.line.team_id, (byClub.get(m.line.team_id) ?? 0) + 1)
    }
    const topClub = (id: string): string | null => {
      const byClub = clubs.get(id)
      if (!byClub) return null
      // Ties broken on the club id, so the badge is deterministic rather than insertion-ordered.
      return [...byClub.entries()]
        .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))[0]?.[0] ?? null
    }
    const tally: FinderTally[] = [...counts.entries()]
      .map(([id, n]) => {
        const p = playerById.get(id) ?? null
        return { player: p, name: p?.name ?? '—', teamId: topClub(id), games: n }
      })
      .sort((a, b) => (b.games !== a.games ? b.games - a.games : a.name.localeCompare(b.name)))

    return {
      rows: matched.slice(0, limit).map(({ line, head: v }) => {
        const p = playerById.get(line.player_id) ?? null
        return {
          key: line.id,
          player: p,
          name: p?.name ?? '—',
          teamId: line.team_id,
          game: gameById.get(line.game_id) ?? null,
          headline: v,
          headlineDisplay: head.display ? head.display(v) : String(v),
          detail: detail(line),
        }
      }),
      total: matched.length,
      searched: pool.length,
      tally,
      headlineField: head.key,
    }
  }

  if (side === 'pitching') {
    return collect(pitching, PIT_FIELDS, pitDetail, l => l.outs > 0 || (l.bf ?? 0) > 0)
  }
  return collect(batting, HIT_FIELDS, hitDetail, l => l.ab + l.bb + l.hbp + l.sf + l.sh > 0)
}

// ─── The query in the address bar ─────────────────────────────────────────────
//
// ONE PARAM, NOT SEVEN. A finder has as many controls as it has ideas, and giving each one its
// own query key would mean every new control is also an edit to the list WpblApp carries across
// a navigation (see STATS_URL_PARAMS in StatsView) and a fresh chance to forget one. So the
// whole query encodes into `q`, and this module owns the grammar.
//
// READABLE ON PURPOSE, rather than base64 or JSON. `q=so.gte.5~bb.lte.0&team=NY` is a thing a
// person can read in a status bar, edit by hand, and paste into a chat message without it
// looking like a tracking parameter. Every character in it is URL-safe unencoded, which is the
// other half: `>=` would come out as %3E%3D and make the link look broken.

const COND_SEP = '~'
const PART_SEP = '.'

/** The query as a `q` value, or '' when it is asking for everything. */
export function encodeFinderQuery(q: FinderQuery): string {
  return q.conditions.map(c => `${c.field}${PART_SEP}${c.op}${PART_SEP}${c.value}`).join(COND_SEP)
}

/**
 * Read a `q` value back.
 *
 * FAILS TOWARD THE CONDITION IT CAN READ, and drops the rest. A hand-edited or truncated link
 * should show something rather than an error, and a dropped condition widens the result, which
 * is visible in the count. The opposite, keeping a condition whose field is nonsense, is what
 * `runWpblFinder` refuses: there it would silently answer a question nobody asked.
 */
export function decodeFinderQuery(raw: string | null, side: FinderSide): FinderCondition[] {
  if (!raw) return []
  const known = new Set(finderFields(side).map(f => f.key))
  const ops = new Set(FINDER_OPS.map(o => o.op as string))
  const out: FinderCondition[] = []
  for (const part of raw.split(COND_SEP)) {
    const [field, op, value] = part.split(PART_SEP)
    const n = Number(value)
    if (!known.has(field) || !ops.has(op) || !Number.isFinite(n) || n < 0) continue
    out.push({ field, op: op as FinderOp, value: n })
    if (out.length >= 6) break
  }
  return out
}

/** The query in words, for the line above the results. */
export function describeFinderQuery(side: FinderSide, q: FinderQuery): string {
  const labels = new Map(finderFields(side).map(f => [f.key, f]))
  const parts = q.conditions.map(c => {
    const f = labels.get(c.field)
    const sym = FINDER_OPS.find(o => o.op === c.op)?.label ?? ''
    return `${f?.label ?? c.field} ${sym} ${displayFinderValue(side, c.field, c.value)}`
  })
  return parts.length ? parts.join(' and ') : 'every game line'
}
