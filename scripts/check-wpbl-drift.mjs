#!/usr/bin/env node
/**
 * check-wpbl-drift.mjs: prove the mirror still matches the league feed, and repair it if not.
 *
 * WHY THIS EXISTS. `wpbl-ingest` stops re-reading a game once it is stored final. Two gates
 * currently re-open it, and neither is about corrections:
 *
 *   • `force`, which nothing scheduled ever passes, and
 *   • the late-TrackMan backfill, which re-fetches finals under 21 days old that still have
 *     zero tracking rows.
 *
 * So every correction that has reached us so far arrived as a SIDE EFFECT of the league's
 * pitch tracking being stalled. That is not a mechanism, it is a coincidence with an expiry
 * date: the day tracking resumes, a game stops qualifying the moment its rows land, and past
 * 21 days nothing re-reads it at all.
 *
 * The league revises box scores long after the fact. Measured Sep 1, 2026: an Aug 3 game
 * carried `source_updated_at` of Aug 21, an Aug 8 game Aug 24. Sixteen days is comfortably
 * outside the backfill window that happens to be catching them.
 *
 * AND THE GAMES LIST WILL NOT TELL YOU. `GET /v1/games` publishes an `updated_at` per game,
 * which looks like exactly the revision stamp this needs. It is not: on a completed game it
 * equals `completed_at` and never moves again, while the boxscore's own `source_updated_at`
 * marches on for weeks. The only way to learn that a game changed is to fetch its boxscore
 * and compare, which is what this does.
 *
 * WHAT IT COMPARES, and why it is not just the score. A score correction DOES propagate on
 * its own, because the games list carries `presto_data.score` and the ingest folds that onto
 * the row every pass. The box score behind it does not. That combination is the worst case
 * rather than the harmless one: the scoreboard moves, the line score and player lines under
 * it do not, and the game page contradicts itself. So this checks the whole payload the
 * boxscore owns: line-score totals, play count, and the batting and pitching lines, both as
 * team totals and as a sorted multiset of the individual lines, which is what catches a hit
 * moved from one player to another without changing the team's total.
 *
 * AND IT WRITES THE CHANGELOG, which is the second reason it exists. This is the only moment
 * the old scoring and the new one are both in hand: the repair below re-ingests the game, and
 * `wpbl-ingest` deletes and reinserts, so a second later the version the league published first
 * is gone from our tables and the feed only serves the current one. So every drifted game is
 * diffed by NAME (which player's line moved, which play was rewritten) and the result is stored
 * in `wpbl_game_revisions` before anything is repaired. That table is append-only and nothing
 * can rebuild it. See revisionEntry, and boxScoreRevision in src/wpbl/derive/feedHealth.ts,
 * which is the "when" this supplies the "what" for.
 *
 * Usage:
 *   node --env-file=.env scripts/check-wpbl-drift.mjs
 *   node --env-file=.env scripts/check-wpbl-drift.mjs --repair
 *   node --env-file=.env scripts/check-wpbl-drift.mjs --json
 *
 * Needs SUPABASE_DB_URL. --repair also needs SUPABASE_URL (or VITE_SUPABASE_URL) and
 * SUPABASE_SERVICE_ROLE_KEY, and re-ingests ONE GAME PER CALL (`{ gameId }`) rather than
 * passing `force`: a force pass walks every final in a single edge-function invocation, and
 * the season is heading for sixty of them. If that ever runs past the wall clock it dies at
 * the same place every night, and the games after that place are never swept at all.
 *
 * Exits 1 if drift remains (so the nightly job goes red only when repair failed, which is
 * the one case that needs a person). npm script: npm run check-drift
 */

import pg from 'pg'
import { pathToFileURL } from 'node:url'

const FEED = 'https://stats.womensprobaseballleague.com/v1'
const JSON_OUT = process.argv.includes('--json')
const REPAIR = process.argv.includes('--repair')

const n = (v) => Number(v ?? 0) || 0
const s = (v) => (v == null ? '' : String(v))
// "2.2" innings → outs. Mirrors ipToOuts in the ingest; keep the two in step.
const ipToOuts = (ip) => {
  const t = s(ip).trim()
  if (!t) return 0
  const [w, f] = t.split('.')
  return n(w) * 3 + Math.min(n(f), 2)
}
// Timestamps come back from Postgres and from the feed in different spellings of the same
// instant. Compare them as instants, not as strings.
const instant = (v) => {
  const t = Date.parse(s(v))
  return Number.isFinite(t) ? t : null
}

/** One play, reduced to the feed-native fields the mirror stores, in a fixed order.
 *
 *  COUNTING PLAYS WAS NOT ENOUGH, and the gap was invisible for exactly the reason this whole
 *  script exists. The first version compared `plays.length`, so a game the league RE-SCORED kept
 *  the same number of rows and passed as "no drift" while every narrative under it changed. The
 *  Aug 20 game is the reason it got noticed: its 6th and 7th are 13 rows with no batter, no
 *  narrative and `outs` stuck at 0, and if the league ever repairs them the row count will not
 *  move by one.
 *
 *  Resolver-derived columns are deliberately absent. `batter_id`, `pitcher_id` and `team_id` are
 *  OURS, not the feed's: the feed sends its own ids and names and the ingest resolves them
 *  against the roster, so comparing them would report a player merge as league drift. Names are
 *  compared instead, which is what the feed actually publishes. `pitch_events` is left out too:
 *  it is a nested array whose contents are already summarised by `pitch_sequence`, `balls`,
 *  `strikes` and `fouls`, all four of which are here.
 *
 *  \u0001 as the separator because no narrative contains it, and the same string is built in SQL
 *  by the query below so the two sides cannot drift apart in how they spell a row. */
const playDigest = (p) => PLAY_FIELDS.map(f => f.read(p)).join('\u0001')

/** The digest's field order, NAMED, so one list defines both how a play is flattened for
 *  comparison and how it is read back apart for the changelog. It was an inline array until
 *  the changelog needed to say WHICH field of a play moved, and two hand-kept copies of an
 *  order this long is a bug waiting for the day somebody inserts a field into one of them.
 *  (The SQL below spells the order out a third time because it has to; the tests pin that.) */
const PLAY_FIELDS = [
  { key: 'inning', read: p => n(p.inning) },
  { key: 'half', read: p => (s(p.half) === 'bottom' ? 'bottom' : 'top') },
  { key: 'batter_name', read: p => s(p.batter_name) },
  { key: 'pitcher_name', read: p => s(p.pitcher_name) },
  { key: 'outs', read: p => n(p.outs) },
  { key: 'first_base', read: p => s(p.first_base) },
  { key: 'second_base', read: p => s(p.second_base) },
  { key: 'third_base', read: p => s(p.third_base) },
  { key: 'bases_loaded', read: p => (p.bases_loaded ? 1 : 0) },
  { key: 'narrative', read: p => s(p.narrative) },
  { key: 'event_type', read: p => s(p.event_type) },
  { key: 'is_hit', read: p => (p.is_hit ? 1 : 0) },
  { key: 'is_scoring_play', read: p => (p.is_scoring_play ? 1 : 0) },
  { key: 'runs_scored', read: p => n(p.runs_scored) },
  { key: 'pitch_sequence', read: p => s(p.pitch_sequence) },
  { key: 'balls', read: p => n(p.balls) },
  { key: 'strikes', read: p => n(p.strikes) },
  { key: 'fouls', read: p => n(p.fouls) },
]

/** A digest read back into named fields, which is what lets the changelog say "the narrative
 *  changed" rather than "something in this play changed". Safe for the same reason the digest
 *  can be built this way at all: no narrative contains the separator. */
export const playRecord = (digest) => {
  const parts = s(digest).split('\u0001')
  const out = {}
  PLAY_FIELDS.forEach((f, i) => { out[f.key] = parts[i] ?? '' })
  return out
}

/** Feed plays as sequence -> digest. */
export function playMapFeed(box) {
  return new Map((box.plays ?? []).map(p => [String(n(p.sequence)), playDigest(p)]))
}

/** Our plays as sequence -> digest, from the `play_digests` array the query builds. Each entry
 *  is the sequence, then the same fields in the same order, joined the same way. */
export function playMapOurs(row) {
  return new Map((row.play_digests ?? []).map(entry => {
    const ix = entry.indexOf('\u0001')
    return [entry.slice(0, ix), entry.slice(ix + 1)]
  }))
}

/** Everything the boxscore owns, reduced to comparable primitives. Built the same way from
 *  the feed's payload and from our rows, so a mismatch is drift rather than a shape
 *  difference. */
export function fingerprintFeed(box) {
  const sides = {}
  const bat = [], pit = []
  for (const team of box.teams ?? []) {
    const side = s(team.side)
    const tot = team.totals ?? {}
    sides[side] = { runs: n(tot.runs), hits: n(tot.hits), errors: n(tot.errors) }
    for (const pl of team.players ?? []) {
      const h = pl.hitting, p = pl.pitching
      // The same admission test the ingest applies, or every bench player who never came up
      // reads as a line we are missing.
      if (h && (n(pl.spot) || n(h.ab) || n(h.h) || n(h.bb) || n(h.r) || n(h.rbi) || n(h.hbp) || n(h.so))) {
        bat.push([n(h.ab), n(h.r), n(h.h), n(h.rbi), n(h.bb), n(h.so), n(h.hr), n(h.double), n(h.triple), n(h.sb)].join('-'))
      }
      if (p) {
        pit.push([ipToOuts(p.ip), n(p.h), n(p.r), n(p.er), n(p.bb), n(p.so), n(p.hr)].join('-'))
      }
    }
  }
  return {
    away_score: n(sides.away?.runs), home_score: n(sides.home?.runs),
    away_hits: n(sides.away?.hits), home_hits: n(sides.home?.hits),
    away_errors: n(sides.away?.errors), home_errors: n(sides.home?.errors),
    batting: bat.sort().join(' '), pitching: pit.sort().join(' '),
    source_updated_at: instant(box.source_updated_at),
  }
}

export function fingerprintOurs(row) {
  return {
    away_score: n(row.away_score), home_score: n(row.home_score),
    away_hits: n(row.away_hits), home_hits: n(row.home_hits),
    away_errors: n(row.away_errors), home_errors: n(row.home_errors),
    batting: (row.batting ?? []).slice().sort().join(' '),
    pitching: (row.pitching ?? []).slice().sort().join(' '),
    source_updated_at: instant(row.source_updated_at),
  }
}

/** The comparison itself, kept pure so it can be tested without a feed or a database.
 *  Returns one entry per field that disagrees. */
export function diffGame(box, row) {
  const feed = fingerprintFeed(box)
  const held = fingerprintOurs(row)
  const diffs = []
  for (const k of Object.keys(feed)) {
    if (String(feed[k]) !== String(held[k])) {
      const fmt = (v) => (k === 'source_updated_at' && v ? new Date(v).toISOString() : v)
      diffs.push({ field: k, feed: fmt(feed[k]), ours: fmt(held[k]) })
    }
  }
  // The boxscore only reaches this function once the feed calls it complete, so anything we
  // still hold as live or scheduled is drift in the field readers notice first.
  if (row.status !== 'final') diffs.push({ field: 'status', feed: 'final', ours: row.status })

  // Play CONTENT, row by row, and the row COUNT with it: a separate `plays.length` field used to
  // sit above this and became two fields reporting one fact the moment the digest arrived, which
  // is the shape of bug this whole script exists to catch. Reported as the sequences that
  // disagree rather than as two long strings: a repair names the half-inning it touched, and
  // `--repair` re-ingests the game either way, so the message only has to say where to look.
  const fp = playMapFeed(box), op = playMapOurs(row)
  const seqs = [...new Set([...fp.keys(), ...op.keys()])].sort((a, b) => Number(a) - Number(b))
  const changed = seqs.filter(q => fp.get(q) !== op.get(q))
  if (changed.length) {
    const only = (m, q) => (m.has(q) ? 'differs' : 'missing')
    diffs.push({
      field: 'play rows',
      feed: `${fp.size} rows`,
      ours: `${op.size} rows, ${changed.length} not matching at sequence ` +
        changed.slice(0, 8).join(', ') + (changed.length > 8 ? ', …' : '') +
        (changed.some(q => !op.has(q)) ? ` (${changed.filter(q => !op.has(q)).length} ${only(op, changed[0])} here)` : ''),
    })
  }
  return diffs
}

// ─── the changelog: what changed, and to whom ─────────────────────────────────
// Everything above answers "did this game move". Everything below answers "WHAT moved", and it
// is a separate pass on purpose rather than a richer fingerprint.
//
// THE FINGERPRINT IS PLAYER-ANONYMOUS DELIBERATELY. It compares batting as a sorted multiset of
// stat lines with nobody's name on them, so that a player merge, a rename or a resolver change
// on our side cannot be reported as the league having drifted. That is exactly right for
// detection and useless to a reader: "3-1-1-0-0-1 became 3-1-2-1-0-1, somewhere" is not a
// changelog entry. So the fingerprint stays as it is, and this runs only on the games it has
// already flagged, where the extra work buys something.
//
// AND THIS IS THE ONLY MOMENT IT CAN BE DONE. `wpbl-ingest` deletes and reinserts, so the
// version the league published first exists in exactly one place, our own tables, right up
// until the repair below overwrites it. Whatever is not written down here is gone for good.

/** How many changes are stored per revision. A wholesale re-score rewrites every play in a
 *  game, and an uncapped array would put a megabyte of narrative in one row on the night the
 *  league reprocesses a season. `change_count` carries the true total beside it, so the cap is
 *  visible rather than a page confidently reporting 80 changes out of 300. */
const MAX_CHANGES = 80

/** Our column name, then the feed's, wherever the two disagree. `double`/`triple` are the
 *  feed's spelling, and `hitdp` is what the ingest stores as `gdp` (the feed's own `gdp` field
 *  is present but always 0). */
const BATTING_FIELDS = [
  ['ab', 'ab'], ['r', 'r'], ['h', 'h'], ['doubles', 'double'], ['triples', 'triple'],
  ['hr', 'hr'], ['rbi', 'rbi'], ['bb', 'bb'], ['so', 'so'], ['hbp', 'hbp'],
  ['sb', 'sb'], ['cs', 'cs'], ['sf', 'sf'], ['sh', 'sh'], ['ibb', 'ibb'],
  ['gdp', 'hitdp'], ['lob', 'lob'],
]

/** The pitching line as it is READ, plus the decision. `bf`, `pitches`, `strikes` and the
 *  doubles and triples allowed are stored but left out here: they move for reasons that are not
 *  scoring decisions, and a changelog they crowd is one nobody finishes reading. Nothing is
 *  lost, because the fingerprint does not compare them either, so a revision that moved only a
 *  pitch count is never detected in the first place. */
const PITCHING_FIELDS = ['outs', 'h', 'r', 'er', 'bb', 'so', 'hr', 'hbp', 'ibb', 'wp', 'bk', 'decision']

/** W/L/S/H, in the same precedence the ingest uses. */
const decisionOf = (p) => (p.win ? 'W' : p.loss ? 'L' : p.save ? 'S' : p.hold ? 'H' : '')

/** The fields of a play worth reporting, and how to read each one back out of a digest, which
 *  is all strings.
 *
 *  `is_scoring_play` is absent because it is not a second opinion about `runs_scored`, it is the
 *  same number (across every stored play it is exactly `runs_scored > 0`), and printing one fact
 *  twice makes a two-line change look like a four-line one. The bases and the pitch-level fields
 *  are absent because they move whenever the narrative does, and the narrative says it in words.
 */
const PLAY_FIELD_DIFFS = [
  ['outs', Number],
  ['narrative', String],
  ['event_type', String],
  ['is_hit', v => v === '1'],
  // NOT the batter. The feed's `runs_scored` counts the runners who crossed, so a solo home run
  // reads 0 and a grand slam 3. The label the page prints has to say so; renaming it to
  // something friendlier here would only move the trap somewhere with less room to explain it.
  ['runs_scored', Number],
]

/** The feed's batting and pitching lines, carrying the id and the name the league gave them.
 *  Admission is the same test the ingest and the fingerprint apply, or every bench player who
 *  never came up reads as a line the league has just added. */
export function feedLines(box) {
  const batting = [], pitching = []
  for (const team of box.teams ?? []) {
    for (const pl of team.players ?? []) {
      const who = { apiId: s(pl.id), name: s(pl.name) }
      const h = pl.hitting, p = pl.pitching
      if (h && (n(pl.spot) || n(h.ab) || n(h.h) || n(h.bb) || n(h.r) || n(h.rbi) || n(h.hbp) || n(h.so))) {
        const stats = {}
        for (const [ours, theirs] of BATTING_FIELDS) stats[ours] = n(h[theirs])
        batting.push({ ...who, stats })
      }
      if (p) {
        const stats = { outs: ipToOuts(p.ip), decision: decisionOf(p) }
        for (const k of PITCHING_FIELDS) if (!(k in stats)) stats[k] = n(p[k])
        pitching.push({ ...who, stats })
      }
    }
  }
  return { batting, pitching }
}

/** Pair the feed's lines with ours, and report the fields that differ.
 *
 *  MATCHED ON THE FEED'S ID AND NOTHING ELSE. `wpbl_players.api_ids` holds every id a person has
 *  held, which is what survives the league minting a new one when somebody changes club, and it
 *  is the only thing that separates a trade from a namesake. There is deliberately no name
 *  fallback: an entry the league gave no id is evidence of nothing about identity (`anonymous`
 *  in supabase/functions/wpbl-ingest/names.ts), and guessing here would file one player's
 *  correction under another player's name on a public page. Such an entry is reported as
 *  unidentified instead, which is both honest and, on this season's data, empty: of 118 players
 *  the 49 with no feed id have no box-score line between them.
 *
 *  Names come from OUR row rather than the feed, so the changelog spells a player the way the
 *  rest of the site spells her. */
export function matchLines(feedList, ourList, kind, out) {
  const byApi = new Map()
  for (const o of ourList) for (const a of o.api_ids ?? []) byApi.set(String(a), o)
  const seen = new Set()
  const fields = kind === 'batting' ? BATTING_FIELDS.map(([ours]) => ours) : PITCHING_FIELDS

  for (const f of feedList) {
    if (!f.apiId) { out.push({ kind, change: 'unidentified', player: f.name }); continue }
    const mine = byApi.get(f.apiId)
    if (!mine) { out.push({ kind, change: 'added', player: f.name }); continue }
    seen.add(mine.player_id)
    for (const k of fields) {
      const before = mine.stats?.[k] ?? (k === 'decision' ? '' : 0)
      const after = f.stats[k]
      if (s(before) !== s(after)) {
        out.push({ kind, player: mine.name, player_id: mine.player_id, field: k, before, after })
      }
    }
  }
  for (const o of ourList) {
    if (!seen.has(o.player_id)) out.push({ kind, change: 'removed', player: o.name, player_id: o.player_id })
  }
}

/** Every change the league made to this game, in reading order: the score, then the club
 *  totals, then each player's line, then the play-by-play. */
export function revisionChanges(box, row) {
  const changes = []
  const feed = fingerprintFeed(box), held = fingerprintOurs(row)
  for (const f of ['away_score', 'home_score', 'away_hits', 'home_hits', 'away_errors', 'home_errors']) {
    if (feed[f] !== held[f]) changes.push({ kind: 'game', field: f, before: held[f], after: feed[f] })
  }

  const lines = feedLines(box)
  matchLines(lines.batting, row.batting_detail ?? [], 'batting', changes)
  matchLines(lines.pitching, row.pitching_detail ?? [], 'pitching', changes)

  const fp = playMapFeed(box), op = playMapOurs(row)
  const seqs = [...new Set([...fp.keys(), ...op.keys()])].sort((a, b) => Number(a) - Number(b))
  for (const q of seqs) {
    const after = fp.get(q), before = op.get(q)
    if (after === before) continue
    const at = playRecord(after ?? before)
    const where = { kind: 'play', sequence: Number(q), inning: Number(at.inning), half: at.half, batter: at.batter_name }
    if (after == null) { changes.push({ ...where, change: 'removed' }); continue }
    if (before == null) { changes.push({ ...where, change: 'added' }); continue }
    const was = playRecord(before)
    for (const [k, cast] of PLAY_FIELD_DIFFS) {
      if (was[k] !== at[k]) changes.push({ ...where, field: k, before: cast(was[k]), after: cast(at[k]) })
    }
  }
  return changes
}

/** One revision, ready to store.
 *
 *  `kind` is the whole reason this is not merely a diff, and getting it wrong would blame the
 *  league's scorer for our own bug. The drift check finds ONE thing, our rows disagreeing with
 *  the feed, and it has two causes that only the stamps tell apart: a feed stamp NEWER than the
 *  one we held means the league re-scored the game, while equal stamps mean the league never
 *  touched it and our copy is simply wrong. Only the first is a scoring change, and only the
 *  first is readable by the browser, which the RLS policy on wpbl_game_revisions decides rather
 *  than any query.
 *
 *  A revision with NO changes in it is still worth storing. The fingerprint compares a little
 *  more than this does, so a stamp can move on something the changelog has no sentence for, and
 *  "revised, and nothing here changed" is a truthful answer to a reader who saw the date. */
export function revisionEntry(box, row) {
  const feedAt = instant(box.source_updated_at), heldAt = instant(row.source_updated_at)
  const changes = revisionChanges(box, row)
  return {
    kind: feedAt != null && (heldAt == null || feedAt > heldAt) ? 'league' : 'mirror',
    source_updated_at: feedAt == null ? null : new Date(feedAt).toISOString(),
    prior_source_updated_at: heldAt == null ? null : new Date(heldAt).toISOString(),
    changes: changes.slice(0, MAX_CHANGES),
    change_count: changes.length,
  }
}

const OURS_SQL = `
  select g.id, g.api_game_id, g.game_date::text as game_date, g.status,
         g.away_team_id, g.home_team_id,
         g.away_score, g.home_score, g.away_hits, g.home_hits, g.away_errors, g.home_errors,
         g.source_updated_at,
         (select array_agg(b.ab||'-'||b.r||'-'||b.h||'-'||b.rbi||'-'||b.bb||'-'||b.so||'-'||b.hr||'-'||b.doubles||'-'||b.triples||'-'||b.sb)
            from wpbl_batting_lines b where b.game_id = g.id) as batting,
         (select array_agg(p.outs||'-'||p.h||'-'||p.r||'-'||p.er||'-'||p.bb||'-'||p.so||'-'||p.hr)
            from wpbl_pitching_lines p where p.game_id = g.id) as pitching,
         -- The same two line sets again, but WITH THE PLAYER ON THEM, for the changelog. The
         -- pair above is anonymous on purpose (a sorted multiset, so a merge or a rename on our
         -- side cannot read as league drift), and that is exactly what makes it unreadable as a
         -- changelog. Two shapes of one fact, answering two different questions; see
         -- revisionChanges. It is api_ids and not api_id, because the league mints a new id per
         -- club and the array is the only thing that holds a traded player together.
         (select jsonb_agg(jsonb_build_object(
              'name', coalesce(pl.name, ''), 'player_id', b.player_id,
              'api_ids', coalesce(to_jsonb(pl.api_ids), '[]'::jsonb),
              'stats', jsonb_build_object(
                'ab', b.ab, 'r', b.r, 'h', b.h, 'doubles', b.doubles, 'triples', b.triples,
                'hr', b.hr, 'rbi', b.rbi, 'bb', b.bb, 'so', b.so, 'hbp', b.hbp, 'sb', b.sb,
                'cs', b.cs, 'sf', b.sf, 'sh', b.sh, 'ibb', b.ibb, 'gdp', b.gdp, 'lob', b.lob)))
            from wpbl_batting_lines b left join wpbl_players pl on pl.id = b.player_id
            where b.game_id = g.id) as batting_detail,
         (select jsonb_agg(jsonb_build_object(
              'name', coalesce(pl.name, ''), 'player_id', p.player_id,
              'api_ids', coalesce(to_jsonb(pl.api_ids), '[]'::jsonb),
              'stats', jsonb_build_object(
                'outs', p.outs, 'h', p.h, 'r', p.r, 'er', p.er, 'bb', p.bb, 'so', p.so,
                'hr', p.hr, 'hbp', p.hbp, 'ibb', p.ibb, 'wp', p.wp, 'bk', p.bk,
                'decision', coalesce(p.decision, ''))))
            from wpbl_pitching_lines p left join wpbl_players pl on pl.id = p.player_id
            where p.game_id = g.id) as pitching_detail,
         -- The same digest playDigest() builds in JS, in the same field order, joined by the
         -- same separator, prefixed with the sequence. Keep the two in step: a column added on
         -- one side and not the other reports every game in the league as drifted.
         (select array_agg(
              p.sequence || chr(1) || concat_ws(chr(1),
                p.inning, p.half,
                coalesce(p.batter_name, ''), coalesce(p.pitcher_name, ''), p.outs,
                coalesce(p.first_base, ''), coalesce(p.second_base, ''), coalesce(p.third_base, ''),
                case when p.bases_loaded then 1 else 0 end,
                coalesce(p.narrative, ''), coalesce(p.event_type, ''),
                case when p.is_hit then 1 else 0 end,
                case when p.is_scoring_play then 1 else 0 end,
                coalesce(p.runs_scored, 0), coalesce(p.pitch_sequence, ''),
                coalesce(p.balls, 0), coalesce(p.strikes, 0), coalesce(p.fouls, 0))
              order by p.sequence)
            from wpbl_game_plays p where p.game_id = g.id) as play_digests
  from wpbl_games g`

async function readOurs(url) {
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    const { rows } = await client.query(OURS_SQL)
    return rows
  } finally {
    await client.end().catch(() => {})
  }
}

/** Re-ingest one game. The edge function owns every rule about how a game becomes rows;
 *  repairing by writing to the tables directly would fork that logic, and `wpbl_game_plays`
 *  is a mirror that the next ingest pass would overwrite anyway. */
async function reingest(apiGameId) {
  const base = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!base || !key) throw new Error('--repair needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
  const res = await fetch(`${base.replace(/\/$/, '')}/functions/v1/wpbl-ingest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ gameId: apiGameId }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || body.ok === false) throw new Error(`ingest ${apiGameId}: ${res.status} ${JSON.stringify(body)}`)
  return body
}

/** Store what each detected revision changed, BEFORE anything repairs it.
 *
 *  THE ORDERING IS THE WHOLE DESIGN. Repair re-ingests the game, which deletes and reinserts
 *  its rows, and at that moment the version the league published first stops existing anywhere:
 *  not in our tables, and not in the feed, which only ever serves the current one. This is the
 *  one writer, and it runs once, on the first scan's findings. The re-scan after a repair must
 *  never reach here, because by then the "before" it would record is the after.
 *
 *  It writes unconditionally, not only under --repair. Detection is the moment that matters, and
 *  a person running this by hand to look at something is exactly when a revision the nightly job
 *  would have coalesced gets caught. Repeat runs are free: a revision carries the feed's stamp,
 *  so the same one found twice collides on the unique index and does nothing.
 *
 *  This is also the only place the script writes to a table, and the only reason that is not a
 *  contradiction of the rule beside `reingest` (the edge function owns how a game becomes rows)
 *  is that this table is not a game. Nothing derives from it, nothing regenerates it, and no
 *  ingest pass can produce it. */
async function recordRevisions(url, drift) {
  const rows = drift.filter(g => g.game_id && g.revision)
  if (!rows.length) return 0
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  await client.connect()
  let stored = 0
  try {
    for (const g of rows) {
      const r = g.revision
      const res = await client.query(
        `insert into wpbl_game_revisions
           (game_id, kind, source_updated_at, prior_source_updated_at, changes, change_count)
         values ($1, $2, $3, $4, $5::jsonb, $6)
         on conflict do nothing`,
        [g.game_id, r.kind, r.source_updated_at, r.prior_source_updated_at,
          JSON.stringify(r.changes), r.change_count])
      stored += res.rowCount ?? 0
    }
  } finally {
    await client.end().catch(() => {})
  }
  return stored
}

async function scan(ours) {
  const byApi = new Map(ours.map(r => [r.api_game_id, r]))

  const listRes = await fetch(`${FEED}/games?limit=500`)
  if (!listRes.ok) throw new Error(`games list → ${listRes.status}`)
  const list = await listRes.json()
  const feedGames = list.games ?? []
  // The list caps silently and reports the real total beside the short array. A partial
  // schedule would make missing games look like games the league never played.
  if (Number.isFinite(Number(list.count)) && feedGames.length < Number(list.count)) {
    throw new Error(`feed /games truncated: ${feedGames.length} of ${list.count}`)
  }

  const drift = [], missing = []
  let checked = 0
  for (const fg of feedGames) {
    const apiGameId = s(fg.game_id)
    if (!apiGameId) continue
    const res = await fetch(`${FEED}/games/${apiGameId}/boxscore`)
    if (!res.ok) continue
    const box = (await res.json()).boxscore
    if (!box?.status?.complete) continue
    checked++

    const mine = byApi.get(apiGameId)
    if (!mine) {
      // Not necessarily a fault: the feed carries timezone twins and stale never-played
      // copies, and the ingest deliberately suppresses those. A COMPLETED copy we hold no
      // row for is the shape that matters, so report it and let a person judge.
      missing.push({ api_game_id: apiGameId, scheduled_start: s(fg.scheduled_start) })
      continue
    }

    const diffs = diffGame(box, mine)
    if (diffs.length) {
      drift.push({
        api_game_id: apiGameId, game_id: mine.id, game_date: mine.game_date,
        matchup: `${mine.away_team_id}@${mine.home_team_id}`, diffs,
        // What changed, by name, computed here because this is the last moment both versions
        // exist. Stored by recordRevisions before anything repairs the game.
        revision: revisionEntry(box, mine),
      })
    }
  }
  return { checked, drift, missing }
}

async function main() {
  const url = process.env.SUPABASE_DB_URL
  if (!url) {
    console.error('SUPABASE_DB_URL is not set. Run with: node --env-file=.env scripts/check-wpbl-drift.mjs')
    process.exit(2)
  }

  let { checked, drift, missing } = await scan(await readOurs(url))

  // BEFORE the repair below, and before the re-scan that follows it. See recordRevisions.
  const logged = await recordRevisions(url, drift)

  const repaired = []
  if (REPAIR && drift.length) {
    for (const g of drift) {
      try {
        await reingest(g.api_game_id)
        repaired.push(g.api_game_id)
      } catch (err) {
        console.error(`  repair failed: ${err.message}`)
      }
    }
    // Re-read rather than assume. A repair that ran without error but left the row unchanged
    // is the interesting case: it means the disagreement is not something re-ingesting fixes.
    ;({ checked, drift, missing } = await scan(await readOurs(url)))
  }

  if (JSON_OUT) {
    console.log(JSON.stringify({ generated_at: new Date().toISOString(), checked, logged, repaired, drift, missing }, null, 2))
  } else {
    console.log(`Checked ${checked} completed games against the feed.`)
    if (logged) console.log(`Logged ${logged} revision${logged === 1 ? '' : 's'} to wpbl_game_revisions.`)
    if (repaired.length) console.log(`Re-ingested ${repaired.length}: ${repaired.join(', ')}`)
    for (const m of missing) console.log(`  NOT MIRRORED  ${m.scheduled_start}  ${m.api_game_id}`)
    for (const g of drift) {
      console.log(`\n  DRIFT  ${g.game_date}  ${g.matchup}  (${g.api_game_id})`)
      for (const d of g.diffs) console.log(`    ${d.field}: feed=${d.feed} ours=${d.ours}`)
    }
    if (!drift.length && !missing.length) console.log('In sync: no drift.')
  }
  process.exit(drift.length || missing.length ? 1 : 0)
}

if (process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(err => { console.error(err); process.exit(2) })
}
