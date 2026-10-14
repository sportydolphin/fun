#!/usr/bin/env node
// Open pull requests and how their checks stand, printed when a Claude Code session starts
// (.claude/settings.json, SessionStart). Work here lands only through pull requests that merge
// themselves, so a session reading `main` alone misses everything still in flight: on Oct 14,
// 2026 a session reported the search roadmap as empty while it sat in an open pull request, and
// two pull requests had been red for an hour (a lockfile, a sweep fixture) with nobody looking.
//
// Silent when there is nothing open or `gh` is missing or signed out: a hook that errors at
// startup is noise in every session, and this is a convenience, not a gate.

import { execFileSync } from 'node:child_process'

let prs
try {
  prs = JSON.parse(execFileSync('gh', ['pr', 'list', '--state', 'open', '--limit', '20', '--json',
    'number,title,headRefName,isDraft,autoMergeRequest,mergeable,statusCheckRollup'],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15_000 }))
} catch {
  process.exit(0)
}
if (!prs.length) process.exit(0)

const FAIL = new Set(['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED'])
const state = c => c.conclusion || c.state || c.status
const lines = prs.map(p => {
  const checks = p.statusCheckRollup ?? []
  const failing = checks.filter(c => FAIL.has(state(c))).map(c => c.name || c.context)
  const pending = checks.filter(c => ['PENDING', 'QUEUED', 'IN_PROGRESS', 'EXPECTED'].includes(state(c))).length
  const ci = failing.length ? `FAILING: ${failing.join(', ')}` : pending ? `${pending} check(s) running` : checks.length ? 'checks pass' : 'no checks'
  const flags = [p.isDraft && 'draft', p.autoMergeRequest && 'auto-merge', p.mergeable === 'CONFLICTING' && 'CONFLICTS WITH MAIN'].filter(Boolean)
  return `- #${p.number} ${p.title} [${p.headRefName}] ${ci}${flags.length ? ` (${flags.join(', ')})` : ''}`
})
console.log(`Open pull requests (work in flight that is not on main yet; read their branches too):\n${lines.join('\n')}`)
