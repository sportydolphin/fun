// The scheduled workflows, held to two promises nothing else checks until a cron fails at 3am.
//
// 1. A job installs what its scripts import, and only that. Every cron installs a hand-written
//    package list through .github/actions/script-deps. Until Oct 2026 the install step quietly
//    installed the WHOLE project regardless of the list, so a script that imported a package its
//    workflow forgot still worked; now it does not, and this is the only place that would notice
//    before the job does. Static imports only: a dynamic `import('pg')` in these scripts is a
//    deliberate local-only fallback (see writeViaPostgres in sync-wpbl-commons.mjs) that CI never
//    takes and the workflow deliberately does not pay for.
//
// 2. Every scheduled workflow can page. workflow-failure-alert.yml lists them by name because
//    GitHub's workflow_run has no wildcard, so a new cron left off that list fails in silence.
//
// Files come in through Vite's ?raw globs, like routes.test.ts and pwaShell.test.ts, so this stays
// a browser-target module without @types/node.
import { describe, it, expect } from 'vitest'
import packageJson from '../../package.json?raw'
import packageLock from '../../package-lock.json?raw'

const workflows = import.meta.glob('../../.github/workflows/*.yml', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const sources = import.meta.glob(
  ['../../scripts/**/*.{mjs,js,ts}', '../../shared/**/*.js', '../../src/**/*.ts', '!../../src/**/__tests__/**'],
  { query: '?raw', import: 'default' },
) as Record<string, () => Promise<string>>

const scripts = (JSON.parse(packageJson) as { scripts: Record<string, string> }).scripts
const locked = (JSON.parse(packageLock) as { packages: Record<string, unknown> }).packages

const NODE_BUILTINS = new Set([
  'assert', 'buffer', 'child_process', 'crypto', 'events', 'fs', 'http', 'https', 'module', 'net', 'os',
  'path', 'process', 'readline', 'stream', 'string_decoder', 'timers', 'tls', 'url', 'util', 'worker_threads', 'zlib',
])

const fileName = (key: string) => key.replace('../../.github/workflows/', '')
const STATIC_IMPORT = /^\s*(?:import|export)\s+(?!type\b)(?:[^'"`;]*?\sfrom\s+)?['"]([^'"]+)['"]/gm

/** Normalise a path like '../../scripts/../shared/x.js' against the glob's key space. */
function join(fromKey: string, spec: string): string {
  const parts = fromKey.split('/').slice(0, -1)
  for (const seg of spec.split('/')) {
    if (seg === '..') {
      if (parts.length && parts[parts.length - 1] !== '..') parts.pop()
      else parts.push('..')
    } else if (seg !== '.') parts.push(seg)
  }
  return parts.join('/')
}

function resolveLocal(fromKey: string, spec: string): string | null {
  const base = join(fromKey, spec)
  for (const c of [base, `${base}.ts`, `${base}.js`, `${base}.mjs`, `${base}/index.ts`]) if (c in sources) return c
  return null
}

/** Every bare package a script reaches through static imports, following local files. */
async function packagesReached(entryKey: string): Promise<Set<string>> {
  const seen = new Set<string>(), out = new Set<string>(), stack = [entryKey]
  while (stack.length) {
    const key = stack.pop()!
    if (seen.has(key)) continue
    seen.add(key)
    const load = sources[key]
    if (!load) throw new Error(`cannot read ${key}`)
    const src = (await load()).replace(/\/\*[\s\S]*?\*\//g, '')
    for (const m of src.matchAll(STATIC_IMPORT)) {
      const spec = m[1]
      if (spec.startsWith('.')) {
        const r = resolveLocal(key, spec)
        if (r) stack.push(r)
        // An unresolved relative import is an asset (an image, a .json) the glob does not cover.
      } else if (!spec.startsWith('node:') && !NODE_BUILTINS.has(spec.split('/')[0])) {
        out.add(spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0])
      }
    }
  }
  return out
}

interface ScriptDepsJob { file: string; packages: string[]; entries: string[]; bundles: boolean }

function scriptDepsJobs(): ScriptDepsJob[] {
  const jobs: ScriptDepsJob[] = []
  for (const [key, y] of Object.entries(workflows)) {
    const m = y.match(/uses: \.\/\.github\/actions\/script-deps\s+with:\s+packages: '([^']+)'/)
    if (!m) continue
    const entries = [...y.matchAll(/node (scripts\/[\w-]+\.mjs)/g)].map(x => x[1])
    let bundles = false
    for (const r of y.matchAll(/npm run ([\w-]+)/g)) {
      const cmd = scripts[r[1]]
      if (!cmd) throw new Error(`${fileName(key)} runs "npm run ${r[1]}", which package.json does not define`)
      const bundled = cmd.match(/esbuild (scripts\/\S+\.ts)/)
      if (bundled) { bundles = true; entries.push(bundled[1]) }
      entries.push(...[...cmd.matchAll(/node (scripts\/[\w-]+\.mjs)/g)].map(x => x[1]))
    }
    jobs.push({ file: fileName(key), packages: m[1].split(/\s+/).filter(Boolean), entries: [...new Set(entries)], bundles })
  }
  return jobs
}

describe('scheduled workflow dependencies', () => {
  it('finds the workflows it is meant to check', () => {
    expect(scriptDepsJobs().length).toBeGreaterThan(20)
  })

  it('never installs with a bare `npm install --no-save`, which installs the whole project', () => {
    const offenders = Object.entries(workflows).filter(([, y]) => /npm install --no-save/.test(y)).map(([k]) => fileName(k))
    expect(offenders).toEqual([])
  })

  it('lists only packages the lockfile pins', () => {
    const unknown = scriptDepsJobs().flatMap(j => j.packages.filter(p => !(`node_modules/${p}` in locked)).map(p => `${j.file}: ${p}`))
    expect(unknown).toEqual([])
  })

  it('installs every package its scripts import', async () => {
    const missing: string[] = []
    for (const job of scriptDepsJobs()) {
      expect(job.entries.length, `${job.file} runs no script this test can see`).toBeGreaterThan(0)
      const need = new Set<string>()
      for (const e of job.entries) for (const p of await packagesReached(`../../${e}`)) need.add(p)
      if (job.bundles) need.add('esbuild')
      for (const p of need) if (!job.packages.includes(p)) missing.push(`${job.file}: ${p}`)
    }
    expect(missing).toEqual([])
  })
})

describe('workflow failure paging', () => {
  const pager = Object.entries(workflows).find(([k]) => fileName(k) === 'workflow-failure-alert.yml')?.[1] ?? ''
  const listed = new Set(
    (pager.match(/workflows:\r?\n((?: +- .+\r?\n)+)/)?.[1] ?? '').split(/\r?\n/).map(l => l.replace(/^ +- /, '').trim()).filter(Boolean),
  )
  const named = Object.entries(workflows).map(([k, y]) => ({ file: fileName(k), name: y.match(/^name: *(.+?)\s*$/m)?.[1] ?? '', y }))

  it('lists every scheduled workflow by name', () => {
    const unlisted = named
      .filter(w => w.file !== 'workflow-failure-alert.yml' && /^ +(schedule|repository_dispatch):/m.test(w.y))
      .filter(w => !listed.has(w.name))
      .map(w => `${w.file} ("${w.name}")`)
    expect(unlisted).toEqual([])
  })

  it('lists no name that matches no workflow, which is what a rename looks like', () => {
    const names = new Set(named.map(w => w.name))
    expect([...listed].filter(n => !names.has(n))).toEqual([])
  })
})
