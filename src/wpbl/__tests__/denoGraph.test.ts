import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, normalize, relative, sep } from 'node:path'

// `wpbl-ingest` is a Deno edge function that reaches into src/wpbl/ for the recap engine, and
// DENO RESOLVES A LOCAL SPECIFIER LITERALLY: `./slug` is not `./slug.ts`, it is a file that
// does not exist. Vite and esbuild both fill the extension in, so every other build of the
// same modules is green and the only thing that breaks is the deployed function, at import
// time, in a job nobody watches. It has no local reproduction either: Deno is not a dev
// dependency, so `npm run test` and `npm run build` cannot see it.
//
// So the graph is walked here instead. This fired for real when routes.ts entered the graph
// (announce-final.ts builds a game's canonical URL for the Discord recap) carrying an
// extensionless `import { slugifyName } from './slug'`.
//
// Type-only imports are exempt: `import type` is erased before Deno ever resolves it.
//
// EVERY PATH LEAVES HERE POSIX-SPELLED, and that is not cosmetic. `normalize` follows the
// host, so on Windows the walk returns `src\wpbl\derive\series.ts` and an assertion
// reading `includes('derive/series')` cannot match it. That made the guard below fail on
// every Windows checkout and pass in CI, which is the wrong way round for a test whose
// whole job is to fail on a machine that cannot run Deno: a red suite you learn to expect
// is a red suite you stop reading. The walk itself keeps native paths, because `existsSync`
// and `readFileSync` want those.

const ENTRY = 'supabase/functions/wpbl-ingest/index.ts'
const SPECIFIER = /^\s*(?:import|export)\s+(type\s+)?(?:[^'"]*?\sfrom\s+)?['"](\.[^'"]+)['"]/gm

const toPosix = (p: string) => p.split(sep).join('/')

function walk(entry: string): { files: string[]; extensionless: string[] } {
  const seen = new Set<string>()
  const extensionless: string[] = []
  const queue = [normalize(entry)]
  while (queue.length) {
    const file = queue.pop()!
    if (seen.has(file) || !existsSync(file)) continue
    seen.add(file)
    const src = readFileSync(file, 'utf8')
    for (const m of src.matchAll(SPECIFIER)) {
      const [, isType, spec] = m
      if (!spec.endsWith('.ts') && !spec.endsWith('.js')) {
        if (!isType) extensionless.push(`${toPosix(relative('.', file))} imports "${spec}"`)
        continue
      }
      queue.push(normalize(join(dirname(file), spec)))
    }
  }
  return { files: [...seen].map(toPosix), extensionless }
}

describe('the wpbl-ingest import graph', () => {
  const graph = walk(ENTRY)

  it('reaches the modules it is supposed to', () => {
    // A guard on the guard: if the walk silently stopped at the entry file, the assertion
    // below would pass by walking nothing at all.
    expect(graph.files.length).toBeGreaterThan(5)
    expect(graph.files.some(f => f.includes('discordRecap'))).toBe(true)
    // derive/series.ts joined the graph when the Discord recap became series-aware, and it
    // pulled season.ts in behind it. Named here so a future refactor that drops the import
    // does not quietly take the extension check with it.
    expect(graph.files.some(f => f.includes('derive/series'))).toBe(true)
    expect(graph.files.some(f => f.endsWith('wpbl/season.ts'))).toBe(true)
  })

  it('carries a .ts on every runtime import, because Deno will not add one', () => {
    expect(graph.extensionless).toEqual([])
  })
})
