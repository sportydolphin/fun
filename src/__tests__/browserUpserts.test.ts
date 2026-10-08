// Every table the browser upserts into, pinned, because an upsert into the wrong table fails in a
// way nothing notices.
//
// PostgREST turns `.upsert()` into `insert ... on conflict do update`, and Postgres applies the
// table's SELECT policies on that path. A table the browser may write but not read therefore
// refuses every upsert with "new row violates row-level security policy", while a plain insert of
// the same row succeeds. The fan-award ballot shipped that way on Sep 6, 2026 and lost every vote
// it ever took (see the trap in CLAUDE.md, and awardVotes.ts).
//
// Each table below was checked against pg_policies on Oct 8, 2026 and has a SELECT (or ALL) policy
// covering the writer's own rows. A new browser upsert fails this test until its table is added,
// which is the moment to check it: run
//   select cmd, qual from pg_policies where tablename = '<table>';
// and look for a SELECT or ALL row the signed-in writer passes. If there is none, the browser
// cannot upsert there: give it a security-definer writer function, as wpbl_cast_award_vote is.
import { describe, it, expect } from 'vitest'

const CHECKED = new Set([
  'game_predictions', 'prediction_stats', 'push_subscriptions', 'survivor_picks', 'user_preferences',
  'usernames', 'wpbl_photo_categories', 'wpbl_photo_figures', 'wpbl_video_tags',
])

// Node-side code that lives in src only to share types: it writes with the service role, which
// RLS does not apply to.
const SERVER_SIDE = new Set(['src/wpbl/substackSync.ts'])

const sources = import.meta.glob(['../**/*.{ts,tsx}', '!../**/__tests__/**'], {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>

describe('browser upserts', () => {
  const found: { file: string; table: string | null }[] = []
  for (const [key, raw] of Object.entries(sources)) {
    const file = key.replace(/^\.\.\//, 'src/')
    if (SERVER_SIDE.has(file)) continue
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    for (const m of src.matchAll(/\.upsert\(/g)) {
      const before = src.slice(Math.max(0, m.index! - 200), m.index)
      const from = [...before.matchAll(/\.from\(\s*'([a-z_]+)'\s*\)/g)].pop()
      found.push({ file, table: from?.[1] ?? null })
    }
  }

  it('finds the upserts it is meant to check', () => {
    expect(found.length).toBeGreaterThan(5)
  })

  it('upserts only into tables whose SELECT policy has been checked', () => {
    const unchecked = found.filter(f => !f.table || !CHECKED.has(f.table)).map(f => `${f.file}: ${f.table ?? '(table not found)'}`)
    expect(unchecked).toEqual([])
  })
})
