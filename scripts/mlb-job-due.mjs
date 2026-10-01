#!/usr/bin/env node
/**
 * mlb-job-due.mjs: should this MLB cron job do anything today?
 *
 *   node scripts/mlb-job-due.mjs games      the bots, the pushes, the resolvers
 *   node scripts/mlb-job-due.mjs regular    the boards built on regular-season totals
 *
 * Prints why, and writes `due=true|false` to $GITHUB_OUTPUT for the steps after it. The windows
 * are in shared/mlbSeason.js. Every MLB job ran every day of the year until Oct 2026, through four
 * winter months with no game to pick, grade or push; WPBL's ingest has had the same gate since
 * Sep 2026 (wpbl_ingest_due).
 *
 * Runs before `npm install` on purpose (no imports outside the repo), so a skipped day costs a
 * checkout and one request. A manual run from the Actions tab skips this check in the workflow
 * itself, so a job can always be forced.
 */

import { appendFileSync } from 'node:fs'
import { mlbJobDue, JOB_KINDS } from '../shared/mlbSeason.js'

const kind = process.argv[2]
if (!JOB_KINDS.includes(kind)) {
  console.error(`usage: node scripts/mlb-job-due.mjs <${JOB_KINDS.join('|')}>`)
  process.exit(2)
}

const { due, reason } = await mlbJobDue(kind)
console.log(`${due ? 'due' : 'not due'}: ${reason}`)
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `due=${due}\n`)
