#!/usr/bin/env node
/**
 * ingest-wpbl-birthdays.mjs — pull player birthdays from the community "BDay" sheet
 * into wpbl_players.birth_date.
 *
 * Why a spreadsheet: the league's feed carries `age` and nothing else. An age can't tell you
 * when a birthday actually falls, so the dates are fan-collected in a Google Sheet. This
 * script is the bridge; re-run it whenever the sheet gains rows.
 *
 * The sheet lays the same people out twice — a zodiac grid (name, date) and an age-ordered
 * list (name, age, date) — so every player is typically listed two or more times. That
 * redundancy is useful: where the two disagree we can flag it rather than silently pick one.
 *
 * Reconciliation rule: the ZODIAC GRID wins. It's the half organised *by* date, so a wrong
 * date there would sit visibly in the wrong block, while the age list is a flat column where
 * a copy-paste slip goes unnoticed. Players whose listings disagree are stored with
 * birth_date_source = 'sheet-conflict' so nothing downstream treats them as settled.
 *
 * KNOWN LIMIT — the sheet colour-codes "Unconfirmed Dates", "Needs 2nd Source" and
 * "Conflicting Date". Cell colour does not survive CSV export, so this script cannot see
 * those marks. It re-derives conflicts by comparing the sheet's two halves, which catches
 * the third category but NOT a date that is merely unconfirmed and consistently mistyped.
 *
 * Usage:
 *   npm run birthdays -- --dry-run     # parse + match, print what would change, write nothing
 *   npm run birthdays                  # apply to the database
 *
 * Required env: SUPABASE_DB_URL. Optional: WPBL_BDAY_SHEET_ID, WPBL_BDAY_SHEET_TAB.
 */

import pg from 'pg'

const SHEET_ID = process.env.WPBL_BDAY_SHEET_ID
  ?? '18JsyKVUmbEixxZx64M1i8PMtgfa-hiZZ2l9z2ieyWpI'
const SHEET_TAB = process.env.WPBL_BDAY_SHEET_TAB ?? 'BDay'
const DB_URL = process.env.SUPABASE_DB_URL ?? ''
const DRY_RUN = process.argv.includes('--dry-run')

if (!DB_URL) {
  console.error('❌  Set SUPABASE_DB_URL (Supabase → Connect → Session pooler).')
  process.exit(1)
}

// ─── Fetch + parse ──────────────────────────────────────────────────────────

/** gviz renders any tab as CSV without an API key, as long as the sheet is link-shared. */
async function fetchSheet() {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq`
    + `?tqx=out:csv&sheet=${encodeURIComponent(SHEET_TAB)}&cb=${Date.now()}`
  const res = await fetch(url, { headers: { 'Cache-Control': 'no-cache' } })
  if (!res.ok) throw new Error(`Sheet fetch ${res.status} — is it still link-shared?`)
  const text = await res.text()
  // A sheet that isn't shared returns Google's HTML sign-in page with a 200.
  if (text.trimStart().startsWith('<')) {
    throw new Error('Got HTML, not CSV — the sheet is no longer readable without sign-in.')
  }
  return text
}

/** Every field in this export is quoted, so a small RFC4180 reader is enough. */
function parseCsv(csv) {
  const rows = []
  let row = [], cell = '', inQuotes = false
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i]
    if (inQuotes) {
      if (c === '"' && csv[i + 1] === '"') { cell += '"'; i++ }
      else if (c === '"') inQuotes = false
      else cell += c
    } else if (c === '"') inQuotes = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = '' }
    else if (c !== '\r') cell += c
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows
}

const DATE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/
// Sign names, month names and the section/legend headers all sit in the same columns as
// player names, so they have to be filtered out by hand.
const NOT_A_NAME = new RegExp('^(♈|♉|♊|♋|♌|♍|♎|♏|♐|♑|♒|♓|January|February|March|April|May'
  + '|June|July|August|September|October|November|December|Birthdays|Unconfirmed|Needs'
  + '|Conflicting)')

/**
 * Harvest (name, date) pairs from anywhere on the sheet. The zodiac grid puts the date one
 * column right of the name and the age list puts it two (name, age, date), so looking ahead
 * up to two columns covers both layouts without hard-coding either one's coordinates —
 * which matters because the grid's column offsets shift as blocks grow.
 *
 * Order is preserved: the zodiac grid is physically above the age list, so the first
 * sighting of a name is its grid date. That is what makes "the grid wins" work.
 */
function harvest(rows) {
  const seen = new Map()
  for (const row of rows) {
    row.forEach((raw, ci) => {
      const name = raw.trim()
      if (!name || NOT_A_NAME.test(name) || DATE_RE.test(name)) return
      if (!name.includes(' ') || !/[A-Za-zÀ-ÿ]/.test(name)) return
      for (let k = 1; k <= 2; k++) {
        const next = (row[ci + k] ?? '').trim()
        if (DATE_RE.test(next)) {
          if (!seen.has(name)) seen.set(name, [])
          if (!seen.get(name).includes(next)) seen.get(name).push(next)
          return
        }
      }
    })
  }
  return seen
}

/** Two-digit years: the sheet is all living ballplayers, so >30 means 19xx. */
function toIso(mdy) {
  const [, m, d, y] = mdy.match(DATE_RE)
  let year = Number(y)
  if (year < 100) year += year <= 30 ? 2000 : 1900
  return `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** Accents and punctuation differ between sheet and feed (Benítez / Benitez, O'Sullivan). */
const normName = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim()

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nFetching "${SHEET_TAB}" …`)
  const rows = parseCsv(await fetchSheet())
  const seen = harvest(rows)
  console.log(`  ${seen.size} players found on the sheet`)

  const parsed = []
  for (const [name, dates] of seen) {
    parsed.push({
      name,
      birthDate: toIso(dates[0]),          // first sighting = zodiac grid = authoritative
      source: dates.length > 1 ? 'sheet-conflict' : 'sheet',
      allDates: dates,
    })
  }

  const conflicts = parsed.filter((p) => p.source === 'sheet-conflict')
  if (conflicts.length) {
    console.log(`\n⚠️  ${conflicts.length} player(s) listed with more than one date —`
      + ' taking the zodiac grid, flagging the row:')
    for (const c of conflicts) console.log(`     ${c.name}: ${c.allDates.join('  vs  ')}`)
  }

  const db = new pg.Client({ connectionString: DB_URL })
  await db.connect()
  try {
    const { rows: players } = await db.query('select id, name, birth_date from wpbl_players')
    const byName = new Map(players.map((p) => [normName(p.name), p]))

    const updates = [], unmatched = []
    for (const p of parsed) {
      const match = byName.get(normName(p.name))
      if (!match) { unmatched.push(p.name); continue }
      const current = match.birth_date ? match.birth_date.toISOString().slice(0, 10) : null
      if (current !== p.birthDate) {
        updates.push({ ...p, id: match.id, dbName: match.name, was: current })
      }
    }

    console.log(`\n  matched ${parsed.length - unmatched.length}/${parsed.length} to wpbl_players`)
    if (unmatched.length) {
      // Not fatal: the sheet can list a player before the roster feed carries them.
      console.log(`  ⚠️  no roster row for: ${unmatched.join(', ')}`)
    }
    if (!updates.length) { console.log('\n✅  Every birth date already matches. Nothing to do.\n'); return }

    console.log(`\n  ${updates.length} to write:`)
    for (const u of updates) {
      console.log(`     ${u.dbName.padEnd(24)} ${u.was ?? '(none)'} → ${u.birthDate}`
        + `${u.source === 'sheet-conflict' ? '  ⚠️ conflicted' : ''}`)
    }

    if (DRY_RUN) { console.log('\n(dry run — nothing written)\n'); return }

    // One statement, one transaction: either the whole sheet lands or none of it does.
    await db.query('begin')
    for (const u of updates) {
      await db.query(
        'update wpbl_players set birth_date = $1, birth_date_source = $2 where id = $3',
        [u.birthDate, u.source, u.id],
      )
    }
    await db.query('commit')

    const { rows: [tally] } = await db.query(
      'select count(birth_date) with_date, count(*) total from wpbl_players',
    )
    console.log(`\n✅  Wrote ${updates.length}.`
      + ` ${tally.with_date}/${tally.total} players now have a birth date.\n`)
  } catch (err) {
    await db.query('rollback').catch(() => {})
    throw err
  } finally {
    await db.end()
  }
}

main().catch((err) => { console.error(`\n❌  ${err.message}\n`); process.exit(1) })
