#!/usr/bin/env node
/**
 * ingest-wpbl-birthdays.mjs: pull player birthdays into wpbl_players.birth_date.
 *
 * Why any of this: the league's feed carries `age` and never a date. An age cannot tell you
 * when a birthday falls, only roughly how old someone is, so the dates come from outside it.
 *
 * TWO SOURCES, IN ORDER.
 *
 * 1. The birthdays DOC is the source of truth. It lists one date per player with the
 *    citations behind it (USA Baseball, WBSC daily reports, club Instagram accounts), and
 *    it says out loud when a date is not pinned down. Where the doc has a date, that date
 *    wins, full stop.
 * 2. The BDay SHEET is the fallback, for players the doc does not list at all. It lays the
 *    same people out twice, as a zodiac grid (name, date) and an age-ordered list (name,
 *    age, date), so most players appear two or more times. That redundancy is what lets a
 *    sheet-only player be checked against themselves: where the two halves disagree the
 *    zodiac grid wins (it is the half organised *by* date, so a wrong date sits visibly in
 *    the wrong block, while the age list is a flat column where a slip goes unnoticed) and
 *    the row is flagged rather than quietly settled.
 *
 * What ends up in birth_date_source, and what it means to everything downstream:
 *
 *   'doc'            the doc gave a settled date. Trust it.
 *   'sheet'          the doc does not list this player; the sheet agreed with itself.
 *   'doc-unsettled'  the doc lists this player and says the date is NOT known ("? (2003/04)",
 *                    "September 9/6?, 2006"). Any date stored alongside it came from the
 *                    sheet and is good enough for a star sign, not for a greeting.
 *   'sheet-conflict' the doc does not list this player and the sheet contradicted itself.
 *                    Same standing as the above: a sign, not a greeting.
 *
 * Only the first two are settled. src/wpbl/derive/discordBirthdays.ts greets those and no
 * others, which is why the two unsettled values are worth keeping distinct from null.
 *
 * A doc date that disagrees with the sheet is not a conflict, it is the doc doing its job.
 * Those get printed on every run anyway, because a disagreement usually means the sheet has
 * a row somebody should fix.
 *
 * If the doc cannot be fetched the run FAILS rather than falling back wholesale to the
 * sheet. A silent fallback would rewrite every 'doc' row back to whatever the sheet says,
 * which is the one outcome worse than not running at all.
 *
 * KNOWN LIMIT (sheet only): the sheet colour-codes "Unconfirmed Dates", "Needs 2nd Source"
 * and "Conflicting Date". Cell colour does not survive CSV export, so those marks are
 * invisible here. Sheet-only players are checked by comparing the sheet's two halves, which
 * catches a contradiction but not a date that is merely unconfirmed and consistently typed.
 *
 * Usage:
 *   npm run birthdays -- --dry-run     # parse + match, print what would change, write nothing
 *   npm run birthdays                  # apply to the database
 *
 * Required env: SUPABASE_DB_URL.
 * Optional: WPBL_BDAY_DOC_ID, WPBL_BDAY_SHEET_ID, WPBL_BDAY_SHEET_TAB.
 */

import pg from 'pg'

const DOC_ID = process.env.WPBL_BDAY_DOC_ID
  ?? '1kSUGY5ObZOF4TWTGkH0Chrt5Ke6b9EdFAUzc862vahQ'
const SHEET_ID = process.env.WPBL_BDAY_SHEET_ID
  ?? '18JsyKVUmbEixxZx64M1i8PMtgfa-hiZZ2l9z2ieyWpI'
const SHEET_TAB = process.env.WPBL_BDAY_SHEET_TAB ?? 'BDay'
const DB_URL = process.env.SUPABASE_DB_URL ?? ''
const DRY_RUN = process.argv.includes('--dry-run')

if (!DB_URL) {
  console.error('❌  Set SUPABASE_DB_URL (Supabase → Connect → Session pooler).')
  process.exit(1)
}

// ─── The doc ────────────────────────────────────────────────────────────────

/** Docs renders any link-shared document as plain text, no API key and no auth. */
async function fetchDoc() {
  const url = `https://docs.google.com/document/d/${DOC_ID}/export?format=txt&cb=${Date.now()}`
  const res = await fetch(url, { headers: { 'Cache-Control': 'no-cache' } })
  if (!res.ok) throw new Error(`Doc fetch ${res.status}. Is it still link-shared?`)
  const text = await res.text()
  // An unshared doc is a redirect to the sign-in page, which arrives as HTML with a 200.
  if (text.trimStart().startsWith('<')) {
    throw new Error('Got HTML, not text. The birthdays doc is no longer readable without sign-in.')
  }
  return text.replace(/^﻿/, '')
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december']

/**
 * "Last, First" and nothing else. Both halves are letters, apostrophes, hyphens and periods
 * across at most three words, which admits "Valerio Montoya, Flor Elena" and "Day-Bedard,
 * Ela" while rejecting the doc's prose (its section headings carry no comma and its
 * disclaimer carries a colon).
 */
const DOC_NAME_RE = /^([\p{L}'’.-]+(?: [\p{L}'’.-]+){0,2}), ([\p{L}'’.-]+(?: [\p{L}'’.-]+){0,2})$/u

/** "May 3, 2004", written out in full, and nothing looser. */
const DOC_DATE_RE = /^([A-Z][a-z]+) (\d{1,2}), (\d{4})$/

/**
 * The doc's entries, keyed by normalised name.
 *
 * Shape: `{ name, iso, raw, sources[] }`, where `iso` is null for an entry the doc marks as
 * unknown. Those are worth keeping rather than skipping: an entry saying "? (2003/04)" is
 * the doc actively telling us the day is not known, which has to outrank a sheet row that
 * states one, and it can only do that if it survives the parse.
 *
 * Deliberately loose about which section a name sits in. "Rostered" and "Unrostered" is the
 * doc's own bookkeeping and it drifts behind the feed; whether a player is on a roster is
 * answered by wpbl_players, and a name with no roster row is simply not matched below.
 */
function parseDoc(text) {
  const entries = new Map()
  let current = null
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue

    // Bullets under an entry are its citations. "?" is the doc's shorthand for "no idea
    // where this came from any more", which is reported but does not veto the date.
    if (trimmed.startsWith('*')) {
      if (current) current.sources.push(trimmed.replace(/^\*\s*/, ''))
      continue
    }

    const [namePart, ...rest] = trimmed.split(' - ')
    // Trailing asterisks are the doc's own margin note on a name ("Hicks, Zoe***").
    const nameMatch = DOC_NAME_RE.exec(namePart.replace(/\*+$/, '').trim())
    if (!nameMatch) { current = null; continue }

    const name = `${nameMatch[2]} ${nameMatch[1]}`
    // Split on the FIRST ' - ' and rejoin, so "? (Oct. - Dec. 2005)" stays in one piece and
    // fails the date match as the unknown it is.
    const entry = { name, iso: parseDocDate(rest.join(' - ').trim()), raw: rest.join(' - ').trim(), sources: [] }
    entries.set(normName(name), entry)
    current = entry
  }
  return entries
}

/** An ISO date, or null for anything the doc did not state cleanly. */
function parseDocDate(raw) {
  const m = DOC_DATE_RE.exec(raw)
  if (!m) return null                       // '', '?', '? (2006/07)', 'September 9/6?, 2006'
  const month = MONTHS.indexOf(m[1].toLowerCase()) + 1
  if (!month) return null
  const day = Number(m[2]), year = Number(m[3])
  if (day < 1 || day > 31) return null
  // Nobody plays professional baseball at 8 or 80. A year outside this is a typo, and a typo
  // that lands in birth_date becomes a greeting on the wrong day.
  if (year < 1960 || year > new Date().getFullYear() - 14) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** An entry the doc gave a date for but cited nothing behind. Reported, still trusted. */
const unsourced = (entry) => !entry.sources.length || entry.sources.every(s => /^\?+$/.test(s.trim()))

// ─── The sheet ──────────────────────────────────────────────────────────────

/** gviz renders any tab as CSV without an API key, as long as the sheet is link-shared. */
async function fetchSheet() {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq`
    + `?tqx=out:csv&sheet=${encodeURIComponent(SHEET_TAB)}&cb=${Date.now()}`
  const res = await fetch(url, { headers: { 'Cache-Control': 'no-cache' } })
  if (!res.ok) throw new Error(`Sheet fetch ${res.status}. Is it still link-shared?`)
  const text = await res.text()
  // A sheet that isn't shared returns Google's HTML sign-in page with a 200.
  if (text.trimStart().startsWith('<')) {
    throw new Error('Got HTML, not CSV. The sheet is no longer readable without sign-in.')
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
 * up to two columns covers both layouts without hard-coding either one's coordinates,
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

/** Accents and punctuation differ between doc, sheet and feed (Benítez / Benitez, O'Sullivan). */
const normName = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim()

// ─── Merge ──────────────────────────────────────────────────────────────────

/**
 * Every source turns into records of one shape, so that reconciling them is one function
 * used twice: once over the names as written, and again over the roster rows they land on
 * (the doc and the sheet spell some people differently, and only the database can say they
 * are the same person).
 */
function docRecords(entries) {
  return [...entries.values()].map(entry => entry.iso
    ? { name: entry.name, birthDate: entry.iso, source: 'doc', unsourced: unsourced(entry) }
    : { name: entry.name, birthDate: null, source: 'doc-unsettled', docSaid: entry.raw || '(no date)' })
}

function sheetRecords(sheetDates) {
  return [...sheetDates].map(([name, dates]) => ({
    name,
    birthDate: toIso(dates[0]),          // first sighting = zodiac grid = authoritative
    source: dates.length > 1 ? 'sheet-conflict' : 'sheet',
    allDates: dates,
  }))
}

// Most to least settled. The doc outranks the sheet even when it is the doc saying it does
// not know: "no reliable date for this player" is a finding, not an absence, and it has to
// be able to overrule a sheet row that states one.
const PRECEDENCE = ['doc', 'doc-unsettled', 'sheet', 'sheet-conflict']

/**
 * The one record to keep for a player, out of everything said about them.
 *
 * The runner-up is not thrown away entirely. It supplies a date when the winner has none,
 * which is how a player the doc lists as unknown still gets a star sign on the site, and it
 * supplies the disagreement line that gets printed on every run.
 */
function combine(records) {
  const [winner, runnerUp] = [...records]
    .sort((a, b) => PRECEDENCE.indexOf(a.source) - PRECEDENCE.indexOf(b.source))
  const merged = { ...winner }
  if (!runnerUp) return merged
  if (merged.birthDate && runnerUp.birthDate && runnerUp.birthDate !== merged.birthDate) {
    merged.otherSaid = { source: runnerUp.source, birthDate: runnerUp.birthDate }
  }
  if (!merged.birthDate && runnerUp.birthDate) merged.borrowed = runnerUp.birthDate
  if (!merged.birthDate) merged.birthDate = runnerUp.birthDate
  return merged
}

/** Group by whatever identity the caller is reconciling on, then keep one per group. */
function reconcile(records, identity) {
  const groups = new Map()
  for (const record of records) {
    const key = identity(record)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(record)
  }
  return [...groups.values()].map(combine)
}

// ─── Matching names to the roster ───────────────────────────────────────────

/**
 * Surname plus first initial, for a second pass when the exact name misses.
 *
 * The doc writes people the way the clubhouse does and the feed writes them the way the
 * paperwork does: Addie Frank is Adelaide Frank, Britt Apgar is Brittany Apgar, Allison
 * Lacey is Allie Lacey. Without this the doc's entry for each of them is silently dropped
 * and the sheet keeps the row, which is the opposite of what this script is for.
 *
 * Only used when the key is unique on both sides, so the surnames that repeat on this roster
 * (two Kims, two Yamamotos, two O'Sullivans) can only ever match on a first initial that
 * belongs to exactly one of them.
 */
function initialKey(name) {
  const parts = normName(name).split(' ').filter(Boolean)
  return parts.length < 2 ? null : `${parts[parts.length - 1]} ${parts[0][0]}`
}

/** Index of key → the single value holding it, dropping any key more than one thing shares. */
function uniqueBy(items, key) {
  const seen = new Map()
  for (const item of items) {
    const k = key(item)
    if (!k) continue
    seen.set(k, seen.has(k) ? null : item)
  }
  return new Map([...seen].filter(([, v]) => v))
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('\nFetching the birthdays doc …')
  const docEntries = parseDoc(await fetchDoc())
  const settled = [...docEntries.values()].filter(e => e.iso)
  console.log(`  ${docEntries.size} players in the doc, ${settled.length} with a settled date`)

  console.log(`Fetching "${SHEET_TAB}" …`)
  const sheetDates = harvest(parseCsv(await fetchSheet()))
  console.log(`  ${sheetDates.size} players found on the sheet`)

  const byName = reconcile(
    [...docRecords(docEntries), ...sheetRecords(sheetDates)],
    record => normName(record.name),
  )

  const db = new pg.Client({ connectionString: DB_URL })
  await db.connect()
  try {
    const { rows: players } = await db.query(
      'select id, name, birth_date, birth_date_source from wpbl_players')
    const byExactName = new Map(players.map(p => [normName(p.name), p]))

    const matched = [], unmatched = []
    for (const record of byName) {
      const player = byExactName.get(normName(record.name))
      if (player) matched.push({ ...record, player })
      else unmatched.push(record)
    }

    // Second pass, over what the exact names missed. The roster side is indexed in full
    // rather than only over players nothing has claimed yet: the whole point is to let the
    // doc's "Addie Frank" reach the same roster row the sheet's "Adelaide Frank" already
    // has, and the reconcile below then prefers the doc's version of her.
    const rosterByInitial = uniqueBy(players, p => initialKey(p.name))
    const recordByInitial = uniqueBy(unmatched, r => initialKey(r.name))
    const stillUnmatched = [], nicknamed = []
    for (const record of unmatched) {
      const key = initialKey(record.name)
      const player = key && recordByInitial.get(key) === record ? rosterByInitial.get(key) : null
      if (!player) { stillUnmatched.push(record); continue }
      nicknamed.push({ record, player })
      matched.push({ ...record, player })
    }

    const parsed = reconcile(matched, m => m.player.id)

    // ─── What the sources said, before anything is written ───

    const disagreements = parsed.filter(p => p.otherSaid)
    if (disagreements.length) {
      console.log(`\nℹ️   ${disagreements.length} date(s) the two sources disagree on.`
        + ' The doc wins; the sheet rows are worth fixing:')
      for (const d of disagreements) {
        console.log(`     ${d.name}: ${d.source} ${d.birthDate}  vs  ${d.otherSaid.source} ${d.otherSaid.birthDate}`)
      }
    }

    if (nicknamed.length) {
      console.log(`\nℹ️   ${nicknamed.length} name(s) matched on surname and first initial:`)
      for (const n of nicknamed) console.log(`     ${n.record.name}  →  ${n.player.name}`)
    }

    const noCitation = parsed.filter(p => p.unsourced)
    if (noCitation.length) {
      console.log(`\nℹ️   ${noCitation.length} doc date(s) with no citation behind them,`
        + ' taken as given: ' + noCitation.map(p => p.name).join(', '))
    }

    const unsettled = parsed.filter(p => p.source === 'doc-unsettled')
    if (unsettled.length) {
      console.log(`\n⚠️   ${unsettled.length} player(s) the doc says it does not know,`
        + ' stored unsettled (star sign only, never greeted):')
      for (const u of unsettled) {
        console.log(`     ${u.name}: doc "${u.docSaid}"`
          + (u.borrowed ? `, sheet offers ${u.borrowed}` : ', and the sheet has nothing either'))
      }
    }

    const conflicts = parsed.filter(p => p.source === 'sheet-conflict')
    if (conflicts.length) {
      console.log(`\n⚠️   ${conflicts.length} player(s) the doc does not list and the sheet`
        + ' contradicts itself about, taking the zodiac grid and flagging the row:')
      for (const c of conflicts) console.log(`     ${c.name}: ${c.allDates.join('  vs  ')}`)
    }

    console.log(`\n  matched ${parsed.length}/${byName.length} to wpbl_players`)
    if (stillUnmatched.length) {
      // Not fatal: both sources list players the roster feed does not carry, and the doc
      // keeps a whole "Unrostered" section of them on purpose.
      console.log(`  ⚠️   no roster row for: ${stillUnmatched.map(r => r.name).join(', ')}`)
    }

    // ─── Write ───

    const updates = []
    for (const p of parsed) {
      const current = p.player.birth_date ? p.player.birth_date.toISOString().slice(0, 10) : null
      // The source is written even when the date is unchanged. A player the sheet used to
      // settle and the doc now questions has to stop being greeted, and the only place that
      // shows up is birth_date_source.
      if (current !== p.birthDate || p.player.birth_date_source !== p.source) {
        updates.push({ ...p, was: current, wasSource: p.player.birth_date_source })
      }
    }
    if (!updates.length) { console.log('\n✅  Every birth date already matches. Nothing to do.\n'); return }

    console.log(`\n  ${updates.length} to write:`)
    for (const u of updates) {
      const date = u.was === u.birthDate
        ? `${u.birthDate ?? '(none)'}`
        : `${u.was ?? '(none)'} → ${u.birthDate ?? '(none)'}`
      const source = u.wasSource === u.source ? u.source : `${u.wasSource ?? '(none)'} → ${u.source}`
      console.log(`     ${u.player.name.padEnd(24)} ${date.padEnd(26)} ${source}`)
    }

    if (DRY_RUN) { console.log('\n(dry run, nothing written)\n'); return }

    // One transaction: either the whole reconciliation lands or none of it does.
    await db.query('begin')
    for (const u of updates) {
      await db.query(
        'update wpbl_players set birth_date = $1, birth_date_source = $2 where id = $3',
        [u.birthDate, u.source, u.player.id],
      )
    }
    await db.query('commit')

    const { rows: [tally] } = await db.query(
      'select count(birth_date) with_date,'
      + " count(*) filter (where birth_date_source in ('doc', 'sheet')) settled,"
      + ' count(*) total from wpbl_players',
    )
    console.log(`\n✅  Wrote ${updates.length}.`
      + ` ${tally.with_date}/${tally.total} players now have a birth date,`
      + ` ${tally.settled} of them settled enough to greet.\n`)
  } catch (err) {
    await db.query('rollback').catch(() => {})
    throw err
  } finally {
    await db.end()
  }
}

main().catch((err) => { console.error(`\n❌  ${err.message}\n`); process.exit(1) })
