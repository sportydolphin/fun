// The league feed's contract: the shape `wpbl-ingest` reads, checked on every pass.
//
// WHY. Every feed failure that has reached the site so far arrived as a perfectly valid
// response: a `/games` list cut short at 50 rows, a club under an id we had never seen, a status
// string walked backwards. The ingest is written to keep going on odd input (`s()` turns a missing
// field into '', `n()` turns it into 0), which is right for one bad row and wrong for a renamed
// field, because a rename then reads as "every game has no completed_at" or "every game is a
// regular-season game", and the run logs `ok: true`. The 2027 feed is the first one nobody has
// watched, so the first pass against it has to say what changed rather than mirror it quietly.
//
// WHAT HAPPENS ON A BREAK. A broken ROW is reported, never skipped: each one becomes a line in
// `summary.errors`, which makes the run `ok: false` and pages the owner, while the ingest carries
// on with the defensive reads it has always had. Skipping would be the wrong failure. A renamed
// `game_type` breaks every row at once, and dropping them all blanks the site, where reporting
// them leaves the mirror running (wrong by the postseason flag, which `countsInStandings` already
// fails open on) and a person told. The one break that STOPS the pass is the list's own envelope
// (no `games` array, no numeric `count`), because without `count` the truncation guard in
// index.ts cannot run, and the phantom pass after it deletes rows off a list it cannot prove is
// whole.
//
// LOOSE ON PURPOSE. Unknown keys pass (the feed adds fields all the time and none of them hurt),
// and a stat line is any record of cells, because the feed omits a zero (a hitter with no walks
// has no `bb`). What is pinned is what the ingest decides things with: ids, `game_type`,
// `completed_at`, the status block, the sides and the play keys.
//
// Imported as the bare 'valibot': Node and tsc resolve it from node_modules, Deno through this
// function's deno.json, which pins the same version as package.json (a test holds them equal).

import * as v from 'valibot'

/** Every `game_type` the 2026 feed sent. A new one is a contract break, on purpose: the postseason
 *  backstop in `countsInStandings` and the start-time rule in `correctedStart` both read it. */
export const FEED_GAME_TYPES = ['regular', 'postSeason'] as const

const id = v.pipe(v.string(), v.minLength(1))
/** A timestamp, or '' where the feed has none yet. */
const stamp = v.pipe(v.string(), v.check(t => t === '' || !Number.isNaN(Date.parse(t)), 'not a timestamp'))
/** Box-score cells arrive as strings ("2", ".500") on the player lines and numbers elsewhere. */
const cell = v.union([v.string(), v.number()])

const FeedGame = v.pipe(v.looseObject({
  game_id: id,
  season_id: v.string(),
  // '' on a TBD placeholder, which the ingest skips.
  home_team_id: v.string(),
  away_team_id: v.string(),
  home_team_name: v.string(),
  away_team_name: v.string(),
  game_type: v.picklist(FEED_GAME_TYPES),
  counts_in_standings: v.boolean(),
  status: v.string(),
  scheduled_start: stamp,
  // Absent, not '', until the game ends: 31 of the 71 rows in the final 2026 list have no key.
  completed_at: v.optional(stamp),
  presto_data: v.looseObject({
    timeZone: v.optional(v.string()),
    score: v.optional(v.nullable(v.looseObject({
      home: v.optional(v.nullable(cell)),
      away: v.optional(v.nullable(cell)),
    }))),
  }),
}), v.check(
  // THE ONE FIELD THAT DOES NOT GO BACKWARDS (see CLAUDE.md beside this file), and the ingest
  // reads its absence as "not finished". Its being optional means a rename cannot be caught by
  // the key alone, so the status string vouches for it: all 40 finals in 2026 carried one, so a
  // final without it is the field gone, and every finished game would then follow the status
  // string backwards to live.
  g => !/^final/i.test(g.status) || !!g.completed_at,
  'a final without completed_at',
))

const FeedGameList = v.looseObject({
  count: v.number(),
  games: v.array(v.unknown()),
})

const StatLine = v.optional(v.nullable(v.record(v.string(), v.union([cell, v.boolean(), v.null()]))))

const FeedPlayer = v.looseObject({
  id: v.string(),
  name: v.string(),
  uniform: v.optional(v.string()),
  position: v.optional(v.string()),
  spot: v.optional(cell),
  hitting: StatLine,
  pitching: StatLine,
  fielding: StatLine,
})

const FeedTeam = v.looseObject({
  side: v.picklist(['away', 'home']),
  // '' on a bracket game whose clubs are not decided yet.
  id: v.string(),
  name: v.string(),
  // null before first pitch.
  line: v.nullable(v.array(v.looseObject({ inning: v.number(), runs: cell }))),
  totals: v.looseObject({ runs: v.number(), hits: v.number(), errors: v.number(), left_on_base: v.number() }),
  // Absent on a game with no lineup posted.
  players: v.optional(v.nullable(v.array(FeedPlayer))),
})

const FeedPlay = v.looseObject({
  sequence: v.number(),
  inning: v.number(),
  half: v.picklist(['top', 'bottom']),
  team_id: v.string(),
  batter_name: v.string(),
  pitcher_name: v.string(),
  outs: v.number(),
  first_base: v.string(),
  second_base: v.string(),
  third_base: v.string(),
  narrative: v.string(),
  event_type: v.string(),
  is_hit: v.boolean(),
  is_scoring_play: v.boolean(),
  // Runners who crossed, NOT counting the batter (runsOnPlay in src/wpbl/derive/playByPlay.ts).
  runs_scored: v.number(),
  balls: v.number(),
  strikes: v.number(),
})

const FeedBoxscore = v.looseObject({
  game_status: v.string(),
  source_updated_at: v.optional(v.nullable(v.string())),
  // Everything the live/final decision in ingestBoxscore reads.
  status: v.looseObject({
    complete: v.boolean(),
    inning: v.number(),
    half: v.string(),
    outs: v.number(),
    balls: v.number(),
    strikes: v.number(),
    away_runs: v.number(),
    home_runs: v.number(),
  }),
  teams: v.pipe(
    v.array(FeedTeam),
    v.check(ts => ts.length === 2 && ts.some(t => t.side === 'away') && ts.some(t => t.side === 'home'),
      'expected one away side and one home side'),
  ),
  // `sequence` is the conflict key for wpbl_game_plays, so a repeat would fail the whole upsert.
  plays: v.optional(v.nullable(v.pipe(
    v.array(FeedPlay),
    v.check(ps => new Set(ps.map(p => p.sequence)).size === ps.length, 'repeated play sequence'),
  ))),
})

const FeedBoxscoreResponse = v.looseObject({ boxscore: FeedBoxscore })

/** One line per distinct problem, so 71 rows broken the same way read as one line with a count
 *  rather than 71 lines that push everything else out of the 25 the run log keeps. */
function describe(where: string, found: { issues: v.BaseIssue<unknown>[]; row?: string }[]): string[] {
  const groups = new Map<string, { n: number; rows: string[] }>()
  for (const { issues, row } of found) {
    for (const issue of issues) {
      const path = v.getDotPath(issue) ?? '(root)'
      const key = `${path}: ${issue.message}`
      const g = groups.get(key) ?? { n: 0, rows: [] }
      g.n++
      if (row && g.rows.length < 2 && !g.rows.includes(row)) g.rows.push(row)
      groups.set(key, g)
    }
  }
  return [...groups].map(([key, g]) => {
    const rows = g.n > 1 ? ` (${g.n} rows, e.g. ${g.rows.join(', ')})` : g.rows.length ? ` (${g.rows[0]})` : ''
    return `contract ${where} ${key}${rows}`
  })
}

/**
 * Check a `/games` response. `fatal` is set when the envelope itself is wrong and the pass must
 * stop; `breaks` lists every row that does not match, for `summary.errors`. `games` is the list
 * as sent, broken rows included: they are reported, not dropped (see the top of this file).
 */
export function checkGameList(body: unknown): { games: any[]; count: number; breaks: string[]; fatal: string | null } {
  const list = v.safeParse(FeedGameList, body)
  if (!list.success) {
    return { games: [], count: 0, breaks: [], fatal: describe('/games', [{ issues: list.issues }]).join('; ') }
  }
  const found: { issues: v.BaseIssue<unknown>[]; row?: string }[] = []
  for (const [i, row] of list.output.games.entries()) {
    const r = v.safeParse(FeedGame, row)
    if (!r.success) {
      const gid = (row as { game_id?: unknown } | null)?.game_id
      found.push({ issues: r.issues, row: typeof gid === 'string' && gid ? gid : `#${i}` })
    }
  }
  return { games: list.output.games as any[], count: list.output.count, breaks: describe('/games', found), fatal: null }
}

/** Check a `/games/{id}/boxscore` response. Empty when it matches. */
export function checkBoxscore(body: unknown, apiGameId: string): string[] {
  const r = v.safeParse(FeedBoxscoreResponse, body)
  return r.success ? [] : describe(`boxscore ${apiGameId}`, [{ issues: r.issues }])
}
