#!/usr/bin/env node
/**
 * pull-tasks.mjs — Pull open Google Tasks into docs/feature-requests.md.
 *
 * The site's feature backlog is kept in Google Tasks; this reads those lists
 * (read-only) and writes them into a tracked markdown file so the current wish
 * list travels with the repo and can be picked up without leaving the editor.
 *
 * Reads incomplete tasks only. Set GOOGLE_TASKS_LIST to a list title to pull just
 * that one list; otherwise every list is included.
 *
 * Prereqs: run scripts/google-auth.mjs once to get GOOGLE_REFRESH_TOKEN, and set
 * GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in .env (see docs/GOOGLE_TASKS.md).
 *
 * Usage:
 *   node --env-file=.env scripts/pull-tasks.mjs           # write the file
 *   node --env-file=.env scripts/pull-tasks.mjs --print   # also print to stdout
 *
 * npm script: npm run tasks
 */

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID ?? ''
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? ''
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN ?? ''
const ONLY_LIST     = process.env.GOOGLE_TASKS_LIST ?? ''     // optional list-title filter
const PRINT         = process.argv.includes('--print')

if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
  console.error('❌  Missing Google credentials. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and')
  console.error('    GOOGLE_REFRESH_TOKEN in .env — run scripts/google-auth.mjs for the last one.')
  console.error('    See docs/GOOGLE_TASKS.md.')
  process.exit(1)
}

const OUT_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'feature-requests.md')

// ─── Google API ─────────────────────────────────────────────────────────────

async function accessToken() {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN,
      grant_type:    'refresh_token',
    }).toString(),
  })
  const d = await r.json()
  if (!d.access_token) {
    throw new Error(`Token refresh failed: ${d.error ?? 'unknown'}${d.error_description ? ` (${d.error_description})` : ''}`)
  }
  return d.access_token
}

async function api(path, token, params = {}) {
  const url = `https://tasks.googleapis.com/tasks/v1/${path}?` + new URLSearchParams(params).toString()
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!r.ok) throw new Error(`Tasks API ${r.status} on ${path}: ${await r.text()}`)
  return r.json()
}

async function fetchLists(token) {
  const out = []
  let pageToken
  do {
    const d = await api('users/@me/lists', token, { maxResults: 100, ...(pageToken ? { pageToken } : {}) })
    out.push(...(d.items ?? []))
    pageToken = d.nextPageToken
  } while (pageToken)
  return out
}

async function fetchOpenTasks(listId, token) {
  const out = []
  let pageToken
  do {
    const d = await api(`lists/${listId}/tasks`, token, {
      showCompleted: 'false', showHidden: 'false', maxResults: 100,
      ...(pageToken ? { pageToken } : {}),
    })
    out.push(...(d.items ?? []))
    pageToken = d.nextPageToken
  } while (pageToken)
  // Google returns tasks in manual order via `position`; keep that ordering.
  return out.sort((a, b) => String(a.position ?? '').localeCompare(String(b.position ?? '')))
}

// ─── Markdown ─────────────────────────────────────────────────────────────────

function renderTask(t) {
  const lines = [`- [ ] ${t.title?.trim() || '(untitled)'}`]
  const due = t.due ? new Date(t.due).toISOString().slice(0, 10) : null
  if (due) lines[0] += `  _(due ${due})_`
  const notes = (t.notes ?? '').trim()
  if (notes) for (const n of notes.split('\n')) lines.push(`  ${n.trim()}`)
  return lines.join('\n')
}

function render(listsWithTasks) {
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
  const total = listsWithTasks.reduce((n, l) => n + l.tasks.length, 0)
  const out = [
    '# Feature requests',
    '',
    '> Generated from Google Tasks by `npm run tasks` (scripts/pull-tasks.mjs). Do not',
    '> edit by hand — edit the tasks in Google Tasks and re-run.',
    `> Last pulled: ${stamp} UTC · ${total} open item${total === 1 ? '' : 's'}.`,
    '',
  ]
  for (const l of listsWithTasks) {
    out.push(`## ${l.title}`, '')
    if (!l.tasks.length) { out.push('_No open items._', ''); continue }
    for (const t of l.tasks) out.push(renderTask(t))
    out.push('')
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const token = await accessToken()
  let lists = await fetchLists(token)
  if (ONLY_LIST) {
    lists = lists.filter(l => l.title?.toLowerCase() === ONLY_LIST.toLowerCase())
    if (!lists.length) { console.error(`❌  No task list titled "${ONLY_LIST}" found.`); process.exit(1) }
  }

  const listsWithTasks = []
  for (const l of lists) {
    listsWithTasks.push({ title: l.title || '(untitled list)', tasks: await fetchOpenTasks(l.id, token) })
  }

  const md = render(listsWithTasks)
  writeFileSync(OUT_FILE, md)

  const total = listsWithTasks.reduce((n, l) => n + l.tasks.length, 0)
  console.log(`✅  Wrote ${total} open task(s) from ${listsWithTasks.length} list(s) → docs/feature-requests.md`)
  if (PRINT) console.log('\n' + md)
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1) })
