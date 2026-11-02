/**
 * wbsc-review.ts: the crosswalk review as a page, for `npm run wbsc -- --review`.
 *
 * The review is 39 or more yes-or-no calls, and hand-editing a JSON file of them invited a typo in
 * "decision" and gave the reviewer only the two names to decide on. This serves a page on
 * 127.0.0.1 that shows each candidate beside the facts both sides hold (review.ts), writes every
 * answer straight into the review file, so closing the tab loses nothing, and runs --confirm from a
 * button. It binds to loopback only and reads nothing from the network: the page is built from the
 * gitignored files on this machine, and WBSC's data never leaves it.
 */
import { exec } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Review } from '../src/intl/wbsc/crosswalk'
import { countryAgrees, reviewGroup, wbscRecord, type ReviewRow, type WbscLineRow } from '../src/intl/wbsc/review'
import { wpblPlayerPath } from '../src/wpbl/routes'

interface RosterRow { id: string; name: string; hometown?: string | null; position?: string | null; bats?: string | null; throws?: string | null; birth_date?: string | null; team_id?: string | null }

export interface ReviewDeps {
  outDir: string
  reviewPath: string
  rosterPath: string
  readJson: <T>(path: string, fallback: T) => T
  writeJson: (path: string, value: unknown) => void
  /** Runs --confirm, sending its lines to `log`; true when it moved the decisions. */
  confirm: (log: (line: string) => void) => boolean
  /** Open the page in the default browser. */
  open: boolean
}

function rows(d: ReviewDeps): { checked_by: string; rows: ReviewRow[] } {
  const review = d.readJson<Review>(d.reviewPath, { checked_by: '', candidates: [] })
  const roster = d.readJson<RosterRow[]>(d.rosterPath, [])
  const byId = new Map(roster.map(p => [p.id, p]))
  const lines = new Map<string, { batting: WbscLineRow[]; pitching: WbscLineRow[] }>()
  const eventLines = (key: string) => {
    let got = lines.get(key)
    if (!got) {
      got = {
        batting: d.readJson<WbscLineRow[]>(join(d.outDir, key, 'batting_lines.json'), []),
        pitching: d.readJson<WbscLineRow[]>(join(d.outDir, key, 'pitching_lines.json'), []),
      }
      lines.set(key, got)
    }
    return got
  }
  return {
    checked_by: review.checked_by,
    rows: review.candidates.map(c => {
      const p = byId.get(c.wpbl_id)
      const l = eventLines(c.event_key)
      return {
        ...c,
        group: reviewGroup(c),
        country: countryAgrees(c.wbsc_team, c.wpbl_hometown),
        wbsc: wbscRecord(c.wbsc_id, l.batting, l.pitching),
        wpbl: {
          id: c.wpbl_id, name: c.wpbl_name, position: p?.position ?? null, bats: p?.bats ?? null,
          throws: p?.throws ?? null, birth_date: p?.birth_date ?? null, team_id: p?.team_id ?? null,
          path: p ? wpblPlayerPath(p, roster) : null,
        },
      }
    }),
  }
}

async function body(req: import('node:http').IncomingMessage): Promise<Record<string, unknown>> {
  let text = ''
  for await (const chunk of req) text += chunk
  return text ? JSON.parse(text) as Record<string, unknown> : {}
}

export function serveReview(d: ReviewDeps): void {
  if (!existsSync(d.reviewPath)) { console.log(`No ${d.reviewPath}. Run --propose first.`); process.exitCode = 1; return }
  if (!readdirSync(d.outDir).length) { console.log(`Nothing imported in ${d.outDir}.`); process.exitCode = 1; return }

  const server = createServer((req, res) => {
    const send = (status: number, value: unknown, type = 'application/json') => {
      res.writeHead(status, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store' })
      res.end(typeof value === 'string' ? value : JSON.stringify(value))
    }
    void (async () => {
      try {
        if (req.method === 'GET' && req.url === '/') return send(200, PAGE, 'text/html')
        if (req.method === 'GET' && req.url === '/api/rows') return send(200, rows(d))
        if (req.method === 'POST' && req.url === '/api/decide') {
          const { wbsc_id, wpbl_id, decision, checked_by } = await body(req)
          const review = d.readJson<Review>(d.reviewPath, { checked_by: '', candidates: [] })
          if (typeof checked_by === 'string') review.checked_by = checked_by.trim()
          if (wbsc_id) {
            const c = review.candidates.find(x => x.wbsc_id === wbsc_id && x.wpbl_id === wpbl_id)
            if (!c || !['', 'yes', 'no'].includes(decision as string)) return send(400, { error: 'unknown candidate or decision' })
            c.decision = decision as Review['candidates'][number]['decision']
          }
          d.writeJson(d.reviewPath, review)
          return send(200, { ok: true })
        }
        if (req.method === 'POST' && req.url === '/api/confirm') {
          const out: string[] = []
          const ok = d.confirm(line => out.push(line))
          return send(200, { ok, lines: out })
        }
        send(404, { error: 'not found' })
      } catch (err) {
        send(500, { error: err instanceof Error ? err.message : String(err) })
      }
    })()
  })
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address() as { port: number }
    const url = `http://127.0.0.1:${port}/`
    console.log(`Crosswalk review at ${url}  (Ctrl+C to stop; every answer is saved as you click)`)
    const open = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`
    if (d.open) exec(open, () => {})
  })
}

const PAGE = /* html */ `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Crosswalk review</title>
<style>
:root { --bg:#fff; --ink:#111; --ink2:#555; --line:#d0d0d0; --fill:#f4f4f5; --yes:#16794a; --no:#b42318; --warn:#9a5b00; --link:#1d5fd1; color-scheme: light dark }
@media (prefers-color-scheme: dark) { :root { --bg:#121214; --ink:#eee; --ink2:#a6a6ad; --line:#55555c; --fill:#1d1d21; --yes:#4cc38a; --no:#ff7b72; --warn:#e3a33a; --link:#7aa7ff } }
* { box-sizing: border-box }
body { margin:0; background:var(--bg); color:var(--ink); font: 15px/1.4 system-ui, sans-serif }
header { position: sticky; top:0; background:var(--bg); border-bottom:1px solid var(--line); padding:12px 16px; display:flex; gap:12px; align-items:center; flex-wrap:wrap; z-index:1 }
h1 { font-size:17px; margin:0 12px 0 0 }
main { max-width: 1100px; margin: 0 auto; padding: 0 16px 80px }
h2 { font-size:13px; text-transform:uppercase; letter-spacing:.06em; color:var(--ink2); margin:28px 0 8px; display:flex; gap:12px; align-items:center }
input { font: inherit; padding:6px 8px; border:1px solid var(--line); border-radius:6px; background:var(--bg); color:var(--ink) }
button { font: inherit; padding:6px 12px; border:1px solid var(--line); border-radius:6px; background:var(--fill); color:var(--ink); cursor:pointer }
button:disabled { cursor: default; color: var(--ink2) }
.row { display:grid; grid-template-columns: 1fr 1fr auto; gap:16px; padding:12px; border:1px solid var(--line); border-radius:8px; margin-bottom:8px; align-items:center }
.row.yes { border-color: var(--yes) } .row.no { border-color: var(--no) }
.name { font-weight:600 } .facts { color:var(--ink2); font-size:13px }
.flag { color: var(--warn); font-weight: 600 }
.ok { color: var(--yes) }
a { color: var(--link) }
.choice { display:flex; gap:6px }
.choice button[aria-pressed=true].y { background:var(--yes); color:#fff; border-color:var(--yes) }
.choice button[aria-pressed=true].n { background:var(--no); color:#fff; border-color:var(--no) }
.count { margin-left:auto; color:var(--ink2) }
pre { white-space: pre-wrap; background:var(--fill); padding:12px; border-radius:8px; font-size:13px }
@media (max-width: 700px) { .row { grid-template-columns: 1fr } }
</style></head>
<body>
<header>
  <h1>Crosswalk review</h1>
  <label>Checked by <input id="who" autocomplete="name" placeholder="Your name"></label>
  <span class="count" id="count"></span>
  <button id="confirm" disabled>Confirm</button>
</header>
<main id="main"><p>Loading.</p></main>
<script>
const GROUPS = {
  conflict: ['Conflicts', 'Another candidate claims the same player. At most one is right.'],
  check: ['Check', 'Matched on an initial, a middle name, a nickname or a near spelling, or the national team differs from the hometown.'],
  clear: ['Full name, same country', ''],
}
const MATCH = { initial: 'Initial only', middle: 'Middle name', nickname: 'Nickname', spelling: 'Surname spelled differently' }
const IP = o => Math.floor(o / 3) + (o % 3 ? '.' + (o % 3) : '')
let state = { checked_by: '', rows: [] }
const key = r => r.wbsc_id + '|' + r.wpbl_id
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

async function post(url, data) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) })
  return res.json()
}
async function decide(r, decision) {
  r.decision = r.decision === decision ? '' : decision
  await post('/api/decide', { wbsc_id: r.wbsc_id, wpbl_id: r.wpbl_id, decision: r.decision })
  render()
}
async function decideAll(group) {
  for (const r of state.rows.filter(r => r.group === group && !r.decision)) {
    r.decision = 'yes'
    await post('/api/decide', { wbsc_id: r.wbsc_id, wpbl_id: r.wpbl_id, decision: 'yes' })
  }
  render()
}

function rowHtml(r) {
  const w = r.wbsc, p = r.wpbl
  // '2023-ix-womens-baseball-world-cup-group-a' reads '2023 Group A'; the year alone for 2016.
  const tail = r.event_key.split('world-cup')[1].replace(/^-/, '').replace('group-stage-', '')
  const event = (r.event_key.slice(0, 4) + ' ' + tail.split('-').map(w => w.length === 1 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)).join(' ')).trim()
  // Age at the event, from the roster's birth date: a player who would have been ten is someone else.
  // Every World Cup so far was played in July or August.
  const age = p.birth_date ? Number(r.event_key.slice(0, 4)) - Number(p.birth_date.slice(0, 4)) - (Number(p.birth_date.slice(5, 7)) > 7 ? 1 : 0) : null
  const played = [w.games + ' G', w.pa ? w.pa + ' PA' : '', w.outs ? IP(w.outs) + ' IP' : '', w.positions.join(', ')].filter(Boolean).join(' · ')
  const country = r.country === 'differs' ? '<span class="flag">Country differs</span>' : r.country === 'same' ? '<span class="ok">Same country</span>' : 'Country unknown'
  const flags = [MATCH[r.match] ? '<span class="flag">' + MATCH[r.match] + '</span>' : '', r.ambiguous ? '<span class="flag">Conflict</span>' : ''].filter(Boolean).join(' · ')
  const game = w.first_game ? 'https://www.wbsc.org/en/events/' + r.event_key + '/schedule-and-results/box-score/' + w.first_game.replace('wbsc:g:', '') : null
  const wpblFacts = [p.position, p.bats && p.throws ? 'B/T ' + p.bats + '/' + p.throws : '', age != null ? 'Age ' + age + ' at the event' : '', r.wpbl_hometown].filter(Boolean).join(' · ')
  return '<div class="row ' + r.decision + '">'
    + '<div><div class="name">' + esc(r.wbsc_name) + '</div><div class="facts">' + esc(r.wbsc_team) + ' · ' + esc(event) + '</div>'
    + '<div class="facts">' + esc(played) + (game ? ' · <a href="' + game + '" target="_blank" rel="noopener">Box score</a>' : '') + '</div></div>'
    + '<div><div class="name">' + esc(r.wpbl_name) + (p.team_id ? ' <span class="facts">' + esc(p.team_id) + '</span>' : '') + '</div>'
    + '<div class="facts">' + esc(wpblFacts) + (p.path ? ' · <a href="https://sportydolphin.fun' + p.path + '" target="_blank" rel="noopener">Player page</a>' : '') + '</div>'
    + '<div class="facts">' + country + (flags ? ' · ' + flags : '') + '</div></div>'
    + '<div class="choice" data-k="' + esc(key(r)) + '">'
    + '<button class="y" aria-pressed="' + (r.decision === 'yes') + '">Same player</button>'
    + '<button class="n" aria-pressed="' + (r.decision === 'no') + '">Different</button></div></div>'
}

function render() {
  const main = document.getElementById('main')
  const rows = state.rows
  if (!rows.length) { main.innerHTML = '<p>Nothing to review.</p>'; return }
  let html = ''
  for (const g of ['conflict', 'check', 'clear']) {
    const list = rows.filter(r => r.group === g)
    if (!list.length) continue
    const open = list.filter(r => !r.decision).length
    html += '<h2>' + GROUPS[g][0] + ' (' + list.length + ')'
      + (g === 'clear' && open ? ' <button data-all="clear">All ' + open + ' undecided: same player</button>' : '') + '</h2>'
      + (GROUPS[g][1] ? '<p class="facts">' + GROUPS[g][1] + '</p>' : '')
      + list.map(rowHtml).join('')
  }
  main.innerHTML = html
  const done = rows.filter(r => r.decision).length
  document.getElementById('count').textContent = done + ' of ' + rows.length + ' decided'
  document.getElementById('confirm').disabled = !done || !state.checked_by
}

document.getElementById('main').addEventListener('click', e => {
  const all = e.target.closest('[data-all]')
  if (all) return decideAll(all.dataset.all)
  const btn = e.target.closest('.choice button')
  if (!btn) return
  const r = state.rows.find(r => key(r) === btn.parentElement.dataset.k)
  if (r) decide(r, btn.classList.contains('y') ? 'yes' : 'no')
})
document.getElementById('who').addEventListener('change', async e => {
  state.checked_by = e.target.value.trim()
  await post('/api/decide', { checked_by: state.checked_by })
  render()
})
document.getElementById('confirm').addEventListener('click', async () => {
  const res = await post('/api/confirm', {})
  const out = '<pre>' + esc(res.lines.join('\\n')) + '</pre>'
  if (res.ok) { await load(); document.getElementById('main').insertAdjacentHTML('afterbegin', out) }
  else document.getElementById('main').insertAdjacentHTML('afterbegin', out)
})
async function load() {
  state = await (await fetch('/api/rows')).json()
  document.getElementById('who').value = state.checked_by
  render()
}
load()
</script></body></html>`
