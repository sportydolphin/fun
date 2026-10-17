import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { LIVE_GAME_COLUMN_NAMES, FIXED_GAME_COLUMN_NAMES, INGEST_ONLY_GAME_COLUMN_NAMES } from '../api/games'
import { BATTING_LINE_COLUMN_NAMES, PITCHING_LINE_COLUMN_NAMES } from '../api/lines'

// The hand-listed column reads, held to the TABLES rather than to the types. A column added to
// `wpbl_games` and to neither half of the live poll freezes on screen at its first-paint value
// for the whole game; one added to a line table and not to its bulk read is invisible to every
// season aggregate. Neither errors, and tsc sees neither, because a column the type does not
// know about is not something the type can miss (see the trap in src/wpbl/CLAUDE.md).
//
// The columns come from the schema's own history: the legacy baseline in scripts/*.sql, then
// scripts/migrations/ in order, replaying CREATE TABLE, ADD COLUMN, DROP COLUMN and RENAME COLUMN.
// That is every way this repo has ever changed these tables, and it is what CI can read with no
// database. A column added by hand in the dashboard would get past it, which the migration rule in
// CLAUDE.md already forbids.

const SCRIPTS = 'scripts'
const MIGRATIONS = join(SCRIPTS, 'migrations')

const ident = String.raw`(?:public\.)?"?(\w+)"?`
const CREATE = new RegExp(String.raw`create\s+table\s+(?:if\s+not\s+exists\s+)?${ident}\s*\(`, 'gi')
const ALTER = new RegExp(String.raw`alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?${ident}\s+([^;]*)`, 'gi')
const CONSTRAINT = /^(constraint|primary|unique|check|foreign|exclude)\b/i

/** The body of a parenthesised list starting at `open`, split on its top-level commas. */
function topLevelItems(sql: string, open: number): string[] {
  const items: string[] = []
  let depth = 0, start = open + 1
  for (let i = open; i < sql.length; i++) {
    const c = sql[i]
    if (c === '(') depth++
    else if (c === ')' && --depth === 0) { items.push(sql.slice(start, i)); break }
    else if (c === ',' && depth === 1) { items.push(sql.slice(start, i)); start = i + 1 }
  }
  return items.map(s => s.trim()).filter(Boolean)
}

function replay(files: string[], tables: string[]): Map<string, Set<string>> {
  const cols = new Map(tables.map(t => [t, new Set<string>()]))
  for (const file of files) {
    // Comments out first: a "-- add column foo" in prose must not create foo.
    const sql = readFileSync(file, 'utf8').replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
    for (const m of sql.matchAll(CREATE)) {
      const set = cols.get(m[1].toLowerCase())
      if (!set) continue
      for (const item of topLevelItems(sql, m.index! + m[0].length - 1)) {
        if (!CONSTRAINT.test(item)) set.add(item.split(/\s+/)[0].replace(/"/g, '').toLowerCase())
      }
    }
    for (const m of sql.matchAll(ALTER)) {
      const set = cols.get(m[1].toLowerCase())
      if (!set) continue
      const body = m[2]
      for (const a of body.matchAll(/add\s+column\s+(?:if\s+not\s+exists\s+)?"?(\w+)"?/gi)) set.add(a[1].toLowerCase())
      for (const d of body.matchAll(/drop\s+column\s+(?:if\s+exists\s+)?"?(\w+)"?/gi)) set.delete(d[1].toLowerCase())
      for (const r of body.matchAll(/rename\s+column\s+"?(\w+)"?\s+to\s+"?(\w+)"?/gi)) {
        if (set.delete(r[1].toLowerCase())) set.add(r[2].toLowerCase())
      }
    }
  }
  return cols
}

const sqlIn = (dir: string) => readdirSync(dir).filter(f => f.endsWith('.sql')).sort().map(f => join(dir, f))
// The baseline first, in any order (each file is idempotent and none drops a column of these
// tables), then the runner's migrations in timestamp order, which is the order they were applied.
const schema = replay([...sqlIn(SCRIPTS), ...sqlIn(MIGRATIONS)], ['wpbl_games', 'wpbl_batting_lines', 'wpbl_pitching_lines'])

const sorted = (xs: Iterable<string>) => [...xs].sort()

describe('the schema replay', () => {
  it('finds the tables, with columns from both the baseline and the migrations', () => {
    // A guard on the guard: a parser that read nothing would make every partition below vacuous.
    const games = schema.get('wpbl_games')!
    expect(games.has('game_date')).toBe(true)          // create_wpbl.sql
    expect(games.has('live_state')).toBe(true)         // add_wpbl_live_state.sql
    expect(games.has('tracking_checked_at')).toBe(true) // a runner migration, multi-line ALTER
    expect(schema.get('wpbl_batting_lines')!.has('sub_out')).toBe(true)
  })
})

describe('wpbl_games: the live poll and the fixed half partition the table', () => {
  const live = LIVE_GAME_COLUMN_NAMES as readonly string[]
  const fixed = FIXED_GAME_COLUMN_NAMES as readonly string[]
  const ingestOnly = INGEST_ONLY_GAME_COLUMN_NAMES as readonly string[]

  it('lists every column of the table exactly once', () => {
    expect(sorted([...live, ...fixed, ...ingestOnly])).toEqual(sorted(schema.get('wpbl_games')!))
  })

  it('never lists a column in two halves', () => {
    const all = [...live, ...fixed, ...ingestOnly]
    expect(all.filter((c, i) => all.indexOf(c) !== i)).toEqual([])
  })
})

describe('the bulk line reads take the whole table but created_at', () => {
  it('wpbl_batting_lines', () => {
    expect(sorted([...BATTING_LINE_COLUMN_NAMES, 'created_at'])).toEqual(sorted(schema.get('wpbl_batting_lines')!))
  })

  it('wpbl_pitching_lines', () => {
    expect(sorted([...PITCHING_LINE_COLUMN_NAMES, 'created_at'])).toEqual(sorted(schema.get('wpbl_pitching_lines')!))
  })
})
