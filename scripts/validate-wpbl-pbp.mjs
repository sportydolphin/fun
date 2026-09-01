#!/usr/bin/env node
/**
 * validate-wpbl-pbp.mjs: find scoring errors in the WPBL play-by-play without watching video.
 *
 * WHY THIS EXISTS, AND WHY IT IS SHAPED THIS WAY.
 *
 * The obvious check is to diff the box score against the play log. It does not work. Measured
 * over the first 14 games, 291 player-games appear in both and only 5 disagree, all on at-bats,
 * with hits, home runs, walks and strikeouts matching exactly. The two are generated from the
 * same scoring input, so they inherit the same mistakes: credit a hit to the wrong player and
 * both views agree, and both are wrong. Anything built on "do our two copies match" is dead on
 * arrival.
 *
 * What does work is baseball's own rules. The batting order is strict, a half-inning ends on
 * the third out, and runs have to add up. Those hold regardless of what the scorer typed, so a
 * violation is a real problem in the data rather than a disagreement between two copies of it.
 *
 * Every check below points at ONE game, half-inning and lineup slot. That is the whole value:
 * it turns "watch fourteen games" into "check about thirty moments". Feed the output into a
 * video pass, do not read it as a list of confirmed errors.
 *
 * WHAT IT FOUND ON THE FIRST RUN. Five batters with box-score plate appearances and no plays
 * at all, worth 16 at-bats and 6 hits. Six team-games where a whole lineup slot is missing.
 *
 * And one false alarm worth recording, because it nearly became a correction pipeline built on
 * a misunderstanding: ten home runs looked like a feed bug for carrying runs_scored = 0 while
 * their own narrative read "homered ... RBI". The field counts runners and omits the batter,
 * so a solo home run reads 0 by design. The data was self-consistent and the check was wrong.
 * See runsOnPlay() in src/wpbl/derive/playByPlay.ts.
 *
 * WHAT THIS CANNOT CATCH. If two players are swapped consistently through a game, the batting
 * order stays legal, the outs still add up and both box lines look plausible. Nothing in here
 * will see it. That needs a genuinely independent transcription of the same game; see the note
 * at the bottom of this file.
 *
 * THE BASELINE, AND WHY IT EXISTS. Run unattended, this reports 57 things and would report 57
 * things tomorrow, so a job wired to "fail when anything is flagged" fails every night and is
 * ignored inside a week. Pass --baseline and it compares against a committed list of findings
 * already seen, reports only what is NEW, and exits 0 when nothing is. Triage a finding, then
 * --update-baseline to accept it. That is what makes the scheduled run worth reading.
 *
 * Usage:
 *   node --env-file=.env scripts/validate-wpbl-pbp.mjs
 *   node --env-file=.env scripts/validate-wpbl-pbp.mjs --game 2026-08-01
 *   node --env-file=.env scripts/validate-wpbl-pbp.mjs --json > report.json
 *   node --env-file=.env scripts/validate-wpbl-pbp.mjs --baseline scripts/wpbl-pbp-baseline.json
 *   node --env-file=.env scripts/validate-wpbl-pbp.mjs --baseline <file> --update-baseline
 *   node --env-file=.env scripts/validate-wpbl-pbp.mjs --baseline <file> --record
 *
 * Needs SUPABASE_DB_URL (the same connection string the migration runner uses).
 * Exits 1 when anything is flagged, or with a baseline, when anything NEW is.
 *
 * --record writes the run to wpbl_pbp_validation_runs and ALWAYS exits 0. That is what the
 * nightly job uses. A job that fails whenever the validator finds something fails every night,
 * because most findings are already known and are not going anywhere; the admin panel shows
 * the state instead, and the thing worth watching there is whether the run is recent at all.
 *
 * npm script: npm run validate-pbp
 */

import pg from 'pg'
import fs from 'node:fs'

const JSON_OUT = process.argv.includes('--json')
const UPDATE_BASELINE = process.argv.includes('--update-baseline')
const RECORD = process.argv.includes('--record')
const baseArgIx = process.argv.indexOf('--baseline')
const BASELINE = baseArgIx > -1 ? process.argv[baseArgIx + 1] : null
const gameArgIx = process.argv.indexOf('--game')
const GAME_DATE = gameArgIx > -1 ? process.argv[gameArgIx + 1] : null

// Events that are a plate appearance. Mirrors classifyPa() in src/wpbl/derive/matchups.ts;
// keep the two in step. `unknown` is 21% of all rows and is almost entirely pickoff attempts
// and substitutions, but a few are real PAs phrased as "reached on an error", so those count.
const PA_EVENTS = [
  'single', 'double', 'triple', 'home_run',
  'groundout', 'flyout', 'popup', 'lineout', 'foul_out', 'out', 'strikeout', 'fielders_choice',
  'walk', 'hit_by_pitch', 'sacrifice',
]
const PA_FILTER = `(p.event_type = any($$PA$$) or (p.event_type = 'unknown' and p.narrative ~* 'reached'))`

const sql = {
  // ─── 1. A batter the box score says played, with no plays at all ──────────────
  //
  // The strongest single check, and the one that found real errors first time out: on Aug 1
  // the box score credits Maggie Foxx 3-for-3 and the play log has nothing for her.
  missingBatters: `
    with pbp as (select game_id, batter_id from wpbl_game_plays where batter_id is not null group by 1,2),
         box as (select game_id, player_id, sum(ab) ab, sum(h) h, sum(bb) bb, sum(hbp) hbp,
                        sum(sf) sf, sum(sh) sh
                 from wpbl_batting_lines group by 1,2)
    select g.game_date::text as game_date, t.abbr as team, pl.name as player,
           b.ab, b.h, b.bb
    from box b
    join wpbl_players pl on pl.id = b.player_id
    join wpbl_games g on g.id = b.game_id
    left join wpbl_teams t on t.id = pl.team_id
    left join pbp p on p.game_id = b.game_id and p.batter_id = b.player_id
    where p.batter_id is null
      and b.ab + b.bb + b.hbp + b.sf + b.sh > 0
    order by g.game_date, b.ab desc`,

  // ─── 2. Batting order continuity ──────────────────────────────────────────────
  //
  // Consecutive plate appearances for one side must advance exactly one slot, 9 wrapping to 1.
  // A mis-attributed batter breaks that, and the break is localised to the half-inning.
  //
  // Two benign cases are excluded rather than reported, because both are legal baseball and
  // reporting them buries the real signal:
  //   - the same slot twice in a row, which is a substitution taking over mid-slot
  //   - slot 10, where the feed parks pitchers who never bat (see the lineup-history migration)
  battingOrder: `
    with pa as (
      select p.game_id, p.team_id, p.sequence, p.inning, p.half, p.batter_name,
             bl.batting_order as slot
      from wpbl_game_plays p
      join wpbl_batting_lines bl on bl.game_id = p.game_id and bl.player_id = p.batter_id
      where p.batter_id is not null and bl.batting_order between 1 and 9 and ${PA_FILTER}
    ), seq as (
      select *,
             lag(slot) over (partition by game_id, team_id order by sequence) as prev_slot,
             lag(batter_name) over (partition by game_id, team_id order by sequence) as prev_batter
      from pa
    )
    select g.game_date::text as game_date, t.abbr as team, s.inning, s.half,
           s.prev_batter, s.prev_slot, s.batter_name, s.slot,
           count(*) over (partition by s.game_id, s.team_id, s.prev_slot, s.slot) as repeats
    from seq s
    join wpbl_games g on g.id = s.game_id
    left join wpbl_teams t on t.id = s.team_id
    where s.prev_slot is not null
      and s.slot <> (s.prev_slot % 9) + 1
      and s.slot <> s.prev_slot
    order by g.game_date, s.sequence`,

  // ─── 3. Half-innings that never reach a two-out state ─────────────────────────
  //
  // NOT a count of out events. Counting them undercounts badly: a double play is one row worth
  // two outs, and a sacrifice retires the batter without being an "out" event. Written that
  // way this check flagged 50 half-innings, nearly all of them fine, which would have buried
  // every real finding in the report.
  //
  // `outs` is the state BEFORE each play, so a half-inning that was completed must contain a
  // play that started with two away: the one that made the third. Never reaching two means
  // plays are missing. Reaching three is impossible and means the column is wrong.
  //
  // The last half-inning of a game is exempt, since it ends when the winning run scores and is
  // often not played at all.
  outs: `
    with o as (
      select p.game_id, p.inning, p.half, max(p.outs) as max_outs_before,
             count(*) as plays, max(p.sequence) as last_seq
      from wpbl_game_plays p where p.outs is not null group by 1,2,3
    ), last_half as (select game_id, max(last_seq) as game_last from o group by 1)
    select g.game_date::text as game_date, o.inning, o.half,
           o.max_outs_before, o.plays,
           case when o.max_outs_before > 2 then 'impossible: more than two outs before a play'
                else 'never reached two outs, so the half-inning looks incomplete' end as issue
    from o
    join last_half l on l.game_id = o.game_id
    join wpbl_games g on g.id = o.game_id
    where (o.max_outs_before < 2 or o.max_outs_before > 2)
      and o.last_seq <> l.game_last
    order by g.game_date, o.inning`,

  // ─── 4a. Runs on a home run against the runners who were on ───────────────────
  //
  // THE SAME MISREADING HAS NOW COST TWO CHECKS, so it is worth being blunt about. `runs_scored`
  // counts the runners who crossed and never the batter, so a solo home run reads 0 BY DESIGN
  // (see runsOnPlay in src/wpbl/derive/playByPlay.ts). This check first flagged those rows as a
  // feed bug, which they were not. It was then rewritten to flag `is_scoring_play` being false
  // on the same rows, described as a label-only problem the feed had. That was the same mistake
  // wearing a different hat: measured Sep 1, 2026 over 2,000-odd plays, `is_scoring_play` is
  // exactly `runs_scored > 0` with zero exceptions. It is not an independent flag the league can
  // get wrong, it is a restatement, so "unflagged home run" means "solo home run" and nothing
  // else. Seventeen of them were sitting in the findings, ten of those accepted into the
  // baseline as real.
  //
  // What is worth checking is the arithmetic the field DOES claim: the runners it counts have to
  // be the runners standing on the bases. That currently disagrees nowhere, which is the point.
  // A check that fires on every solo home run has no power to tell a good game from a bad one;
  // this one is quiet until a run genuinely fails to add up.
  homeRuns: `
    select g.game_date::text as game_date, t.abbr as team, p.inning, p.half,
           p.batter_name, p.runs_scored,
           (case when coalesce(p.first_base, '')  <> '' then 1 else 0 end
          + case when coalesce(p.second_base, '') <> '' then 1 else 0 end
          + case when coalesce(p.third_base, '')  <> '' then 1 else 0 end) as runners_on,
           left(p.narrative, 60) as narrative
    from wpbl_game_plays p
    join wpbl_games g on g.id = p.game_id
    left join wpbl_teams t on t.id = p.team_id
    where p.event_type = 'home_run'
      and coalesce(p.runs_scored, 0) <> (case when coalesce(p.first_base, '')  <> '' then 1 else 0 end
                                       + case when coalesce(p.second_base, '') <> '' then 1 else 0 end
                                       + case when coalesce(p.third_base, '')  <> '' then 1 else 0 end)
    order by g.game_date, p.sequence`,

  // ─── 4b. Runs in the play log against the final score ─────────────────────────
  //
  // Adds the batter back on every home run, mirroring runsOnPlay() in
  // src/wpbl/derive/playByPlay.ts. Without that this check flagged 15 of 28 team-games, all
  // short by 1 to 3 and never once over, which was not 15 findings but one misunderstanding
  // repeated. With it, one team-game is left, and that one is a real lead.
  //
  // `team_id` on a play is the BATTING side, verified against a game where the two halves
  // matched the two clubs exactly. Do not "fix" this join.
  runs: `
    with pbp as (
      select p.game_id, p.team_id,
             sum(coalesce(p.runs_scored, 0))
               + sum(case when p.event_type = 'home_run' then 1 else 0 end) as runs
      from wpbl_game_plays p group by 1,2
    )
    select g.game_date::text as game_date, t.abbr as team,
           pbp.runs as runs_in_play_log,
           case when g.home_team_id = pbp.team_id then g.home_score else g.away_score end as final_score
    from pbp
    join wpbl_games g on g.id = pbp.game_id
    left join wpbl_teams t on t.id = pbp.team_id
    where g.status = 'final'
      and pbp.runs <> case when g.home_team_id = pbp.team_id then g.home_score else g.away_score end
    order by g.game_date`,

  // ─── 5. Pitchers in one view and not the other ────────────────────────────────
  pitchers: `
    with pbp as (select game_id, pitcher_id from wpbl_game_plays where pitcher_id is not null group by 1,2),
         box as (select game_id, player_id from wpbl_pitching_lines group by 1,2)
    select g.game_date::text as game_date, pl.name as pitcher,
           case when b.player_id is null then 'in play log, no pitching line'
                else 'has a pitching line, never appears in the play log' end as issue
    from pbp p
    full outer join box b on b.game_id = p.game_id and b.player_id = p.pitcher_id
    join wpbl_games g on g.id = coalesce(p.game_id, b.game_id)
    join wpbl_players pl on pl.id = coalesce(p.pitcher_id, b.player_id)
    where p.pitcher_id is null or b.player_id is null
    order by g.game_date`,

  // ─── 6. Plate appearance counts per player ────────────────────────────────────
  //
  // Catches a batter who is in the log but short a trip, which the all-or-nothing check in (1)
  // cannot see. Sacrifices and hit-by-pitch are included so the two sides are counting the
  // same thing.
  paCounts: `
    with pbp as (
      select p.game_id, p.batter_id, count(*) as pa
      from wpbl_game_plays p where p.batter_id is not null and ${PA_FILTER} group by 1,2
    ), box as (
      select game_id, player_id, sum(ab + bb + hbp + sf + sh) as pa
      from wpbl_batting_lines group by 1,2
    )
    select g.game_date::text as game_date, t.abbr as team, pl.name as player,
           b.pa as box_score_pa, p.pa as play_log_pa
    from box b
    join pbp p on p.game_id = b.game_id and p.batter_id = b.player_id
    join wpbl_players pl on pl.id = b.player_id
    join wpbl_games g on g.id = b.game_id
    left join wpbl_teams t on t.id = pl.team_id
    where b.pa <> p.pa
    order by g.game_date, abs(b.pa - p.pa) desc`,
}

const CHECKS = [
  { key: 'missingBatters', severity: 'high',
    title: 'Batters with plate appearances in the box score and no plays logged',
    note: 'Their at-bats are unaccounted for. Watch these innings first.' },

  { key: 'battingOrder', severity: 'high',
    title: 'Breaks in the batting order',
    note: 'A jump repeated 3+ times means a whole slot is missing all game; a single one is a likelier mis-attribution.' },
  { key: 'paCounts', severity: 'medium',
    title: 'Plate appearance counts that disagree',
    note: 'The batter is in the log but short or long a trip.' },
  { key: 'outs', severity: 'medium',
    title: 'Half-innings that look incomplete',
    note: 'Flags a half-inning with no two-out play, so the third out has nothing before it. The final half-inning of each game is excluded.' },
  { key: 'runs', severity: 'medium',
    title: 'Runs in the play log against the final score',
    note: 'Counts the batter on a home run. A gap here is a real lead, not the old systematic bias.' },
  { key: 'homeRuns', severity: 'medium',
    title: 'Home runs whose runs do not match the runners on base',
    note: 'runs_scored excludes the batter, so it must equal the number of occupied bases. A solo home run reading 0 is correct and is not flagged.' },
  { key: 'pitchers', severity: 'low',
    title: 'Pitchers in one view and not the other' },
]

async function main() {
  const url = process.env.SUPABASE_DB_URL
  if (!url) {
    console.error('SUPABASE_DB_URL is not set. Run with: node --env-file=.env scripts/validate-wpbl-pbp.mjs')
    process.exit(2)
  }
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  await client.connect()

  const results = {}
  for (const check of CHECKS) {
    const text = sql[check.key].replace('$$PA$$', '$1')
    const params = text.includes('$1') ? [PA_EVENTS] : []
    const { rows } = await client.query(text, params)
    results[check.key] = GAME_DATE ? rows.filter(r => r.game_date === GAME_DATE) : rows
  }
  await client.end()

  // A finding's identity is its check plus its whole row. Rows are aggregates of stable facts
  // (date, team, player, inning), so the same underlying problem fingerprints identically run
  // to run, and a genuinely new one cannot collide with an accepted one.
  const fingerprint = (key, row) => `${key}:${JSON.stringify(row)}`
  const current = new Set()
  for (const [key, rows] of Object.entries(results)) for (const row of rows) current.add(fingerprint(key, row))

  if (UPDATE_BASELINE) {
    if (!BASELINE) { console.error('--update-baseline needs --baseline <file>'); process.exit(2) }
    fs.writeFileSync(BASELINE, JSON.stringify({ updated_at: new Date().toISOString(), accepted: [...current] }, null, 2) + '\n')
    console.log(`Baseline written: ${current.size} findings accepted in ${BASELINE}`)
    process.exit(0)
  }

  let accepted = new Set()
  if (BASELINE && fs.existsSync(BASELINE)) {
    accepted = new Set(JSON.parse(fs.readFileSync(BASELINE, 'utf8')).accepted ?? [])
  }
  const fresh = {}
  for (const [key, rows] of Object.entries(results)) {
    fresh[key] = BASELINE ? rows.filter(r => !accepted.has(fingerprint(key, r))) : rows
  }
  const newCount = Object.values(fresh).reduce((n, r) => n + r.length, 0)

  if (JSON_OUT) {
    console.log(JSON.stringify({
      generated_at: new Date().toISOString(),
      baseline: BASELINE ?? null,
      new_findings: newCount,
      results: BASELINE ? fresh : results,
    }, null, 2))
  } else {
    report(BASELINE ? fresh : results)
    if (BASELINE) {
      console.log(accepted.size
        ? `\nBaseline: ${accepted.size} findings already accepted and not shown.`
        : `\nBaseline file ${BASELINE} is empty or missing; everything counts as new.`)
    }
  }
  if (RECORD) {
    await recordRun(url, { newCount, results })
    // Always 0. See the note at the top: the row IS the signal, and a red X on a nightly job
    // that is working exactly as intended teaches everyone to ignore the job.
    process.exit(0)
  }
  process.exit(newCount > 0 ? 1 : 0)
}

/** Write the run to wpbl_pbp_validation_runs for the admin panel's freshness indicator. Uses
 *  its own short-lived connection so a failure here cannot take the report down with it. */
async function recordRun(url, { newCount, results }) {
  const byCheck = Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.length]))
  const total = Object.values(results).reduce((n, r) => n + r.length, 0)
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  try {
    await client.connect()
    await client.query(
      `insert into wpbl_pbp_validation_runs (ok, new_findings, total_findings, by_check)
       values (true, $1, $2, $3)`,
      [newCount, total, JSON.stringify(byCheck)])
    console.log(`\nRecorded: ${newCount} new, ${total} total.`)
  } catch (err) {
    console.error('Could not record the run:', err.message)
  } finally {
    await client.end().catch(() => {})
  }
}

function report(results) {
  const total = Object.values(results).reduce((n, r) => n + r.length, 0)
  console.log('\nWPBL play-by-play validation')
  console.log('='.repeat(60))
  if (GAME_DATE) console.log(`Filtered to ${GAME_DATE}`)

  for (const check of CHECKS) {
    const rows = results[check.key]
    console.log(`\n[${check.severity.toUpperCase()}] ${check.title}: ${rows.length}`)
    if (check.note) console.log(`  ${check.note}`)
    if (rows.length === 0) { console.log('  none'); continue }
    console.table(rows.slice(0, 40))
    if (rows.length > 40) console.log(`  ... and ${rows.length - 40} more, use --json for all`)
  }

  console.log('\n' + '='.repeat(60))
  console.log(total === 0
    ? 'Nothing flagged.'
    : `${total} things to look at. These are candidates, not confirmed errors: check the video before correcting anything.`)
}

main().catch(async err => {
  console.error(err)
  // A run that dies still has something to say: without this the admin panel would show the
  // last GOOD run and look healthy while the job had been broken for a week.
  if (RECORD && process.env.SUPABASE_DB_URL) {
    const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
    try {
      await client.connect()
      await client.query(`insert into wpbl_pbp_validation_runs (ok, error) values (false, $1)`,
        [String(err?.message ?? err).slice(0, 500)])
    } catch { /* nothing more we can do */ } finally { await client.end().catch(() => {}) }
    process.exit(0)
  }
  process.exit(2)
})

// ─── The gap this leaves ──────────────────────────────────────────────────────
//
// Everything above tests the data against the rules of baseball. That catches plays that are
// missing, duplicated or attributed to a batter who breaks the order. It cannot catch a game
// where two players are swapped consistently: the order stays legal, the outs add up, and both
// box lines look ordinary.
//
// Closing that needs a second, independently produced transcription of the same game.
// github.com/exu6jh/RetroWPBL is one: hand-written Retrosheet .EVW files with a batter id on
// every plate appearance. It carries NO LICENCE, so it is all rights reserved by default and
// must not be ingested or republished. Reading it to check our own rows is a different act
// from redistributing it, but the clean move is to ask the author first.
