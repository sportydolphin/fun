/**
 * check-wpbl-event-counts.ts: every event we read off the WPBL play log, counted against the box
 * score, game by game (src/wpbl/derive/eventAudit.ts says why and what it cannot see).
 *
 * WHY A SECOND CHECK BESIDE validate-wpbl-pbp.mjs. That one checks the scorer against the rules of
 * baseball. This one checks US against the box score: the play log is read by our own code, and a
 * phrasing it does not know undercounts in silence. Sacrifice bunts written "SAC" went uncounted
 * until the owner found them by hand, and on its first run (Nov 10, 2026) this found 52 plate
 * appearances the readers had dropped because the feed leaves a 0-0 trip without a pitch sequence.
 *
 * THE BASELINE holds the gaps someone looked at and accepted, each with why
 * (scripts/wpbl-event-baseline.json). A run fails on any gap not in it. Triage one by reading the
 * game's plays: a phrasing we miss is a reader fix; a play the league left out, or credited to
 * another player than the box score does, is accepted here (or corrected in wpbl_play_corrections
 * after the video). `src/wpbl/__tests__/eventAudit.test.ts` runs the same audit over the archived
 * seasons on every pull request, so a reader change that drops an event fails CI.
 *
 * Usage:
 *   npm run event-audit                       # live database (SUPABASE_DB_URL), against the baseline
 *   npm run event-audit -- --archive          # the archived seasons in archive/, no database
 *   npm run event-audit -- --update-baseline  # accept every current gap (fill in each new `why`)
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import pg from 'pg'
import { againstBaseline, auditEventCounts, eventFingerprint, eventTotals, type AcceptedGap, type BoxBatting, type BoxFielding, type BoxPitching, type EventFinding } from '../src/wpbl/derive/eventAudit'
import { applyPlayCorrections, type WpblPlayCorrection } from '../src/wpbl/playCorrections'
import type { LeagueGame, RunValuePlay } from '../src/league/types'

// Relative to the repo root: run-ts bundles this into node_modules/.cache first.
const ROOT = resolve('.')
const BASELINE = join(ROOT, 'scripts', 'wpbl-event-baseline.json')
const ARCHIVE = process.argv.includes('--archive')
const UPDATE = process.argv.includes('--update-baseline')

interface Input { plays: RunValuePlay[]; games: LeagueGame[]; batting: BoxBatting[]; pitching: BoxPitching[]; fielding: BoxFielding[]; corrections: WpblPlayCorrection[] }

function fromArchive(): Input {
  const out: Input = { plays: [], games: [], batting: [], pitching: [], fielding: [], corrections: [] }
  const dirs = readdirSync(join(ROOT, 'archive')).filter(d => /^wpbl-\d{4}$/.test(d))
  for (const d of dirs) {
    const read = (f: string) => {
      const p = join(ROOT, 'archive', d, f)
      return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : []
    }
    out.plays.push(...read('wpbl_game_plays.json'))
    out.games.push(...read('wpbl_games.json'))
    out.batting.push(...read('wpbl_batting_lines.json'))
    out.pitching.push(...read('wpbl_pitching_lines.json'))
    out.fielding.push(...read('wpbl_fielding_lines.json'))
    out.corrections.push(...read('wpbl_play_corrections.json'))
  }
  return out
}

async function fromDatabase(): Promise<Input> {
  const url = process.env.SUPABASE_DB_URL
  if (!url) throw new Error('Set SUPABASE_DB_URL, or pass --archive to read the archived seasons.')
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    const all = async <T>(table: string) => (await client.query(`select * from ${table}`)).rows as T[]
    // One at a time: one client runs one query at a time.
    return {
      plays: await all<RunValuePlay>('wpbl_game_plays'),
      games: await all<LeagueGame>('wpbl_games'),
      batting: await all<BoxBatting>('wpbl_batting_lines'),
      pitching: await all<BoxPitching>('wpbl_pitching_lines'),
      fielding: await all<BoxFielding>('wpbl_fielding_lines'),
      corrections: await all<WpblPlayCorrection>('wpbl_play_corrections'),
    }
  } finally {
    await client.end()
  }
}

const describe = (f: EventFinding) =>
  `${f.game_id} ${f.who} ${f.player_id ?? f.team_id ?? '?'} ${f.event}: log ${f.log}, box ${f.box}`

const input = ARCHIVE ? fromArchive() : await fromDatabase()
// Finals only: a game in progress has a box score and a log that are both still arriving.
const finals = input.games.filter(g => g.status === 'final')
const findings = auditEventCounts({
  plays: applyPlayCorrections(input.plays, input.corrections),
  games: finals, batting: input.batting, pitching: input.pitching, fielding: input.fielding,
})
const baseline: { accepted: AcceptedGap[] } = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : { accepted: [] }

if (UPDATE) {
  const why = new Map(baseline.accepted.map(a => [a.fingerprint, a.why]))
  const accepted = findings.map(f => ({ fingerprint: eventFingerprint(f), why: why.get(eventFingerprint(f)) ?? '' }))
  writeFileSync(BASELINE, `${JSON.stringify({ ...baseline, accepted }, null, 2)}\n`)
  console.log(`Accepted ${accepted.length} gaps. Write a reason into each empty "why" before committing.`)
  process.exit(0)
}

const { fresh, stale } = againstBaseline(findings, baseline.accepted)
console.log(`${finals.length} finals, ${findings.length} gaps between the play log and the box score, ${fresh.length} new.`)
for (const [k, t] of Object.entries(eventTotals(findings))) console.log(`  ${k}: log ${t.log}, box ${t.box} over ${t.gaps} gaps`)
for (const a of stale) console.log(`Gone (drop it from the baseline): ${a.fingerprint}`)
if (fresh.length) {
  console.error('\nNew gaps. A phrasing we do not read is a reader fix; a play the league left out goes in the baseline with why.')
  for (const f of fresh) console.error(`  ${describe(f)}`)
  process.exit(1)
}
