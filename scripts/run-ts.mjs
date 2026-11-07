// Runs a TypeScript script: `node scripts/run-ts.mjs [--env] scripts/foo.ts [args...]`.
//
// The scripts import without `.ts` extensions and reach into src/, so Node's own type stripping
// cannot run them; each needs bundling first. That used to be a 200-character esbuild command
// copied into every package.json entry, which a new script had to copy again exactly.
//
// The bundle lands at node_modules/.cache/<name>.mjs, the same depth the old commands used, and
// runs as its own process, so `process.argv[1]` is the bundle: the `import.meta.url ===
// pathToFileURL(process.argv[1])` main guards in export-wpbl-archive.ts and
// check-wpbl-postseason.ts depend on that. `--env` loads .env when there is one (CI has none and
// reads its secrets from the environment).
import { spawnSync } from 'node:child_process'
import { basename } from 'node:path'
import { build } from 'esbuild'

const args = process.argv.slice(2)
const env = args[0] === '--env'
if (env) args.shift()
const [entry, ...rest] = args
if (!entry) {
  console.error('usage: node scripts/run-ts.mjs [--env] <script.ts> [args...]')
  process.exit(2)
}

const outfile = `node_modules/.cache/${basename(entry, '.ts')}.mjs`
await build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  outfile,
  logLevel: 'warning',
})

const node = spawnSync(process.execPath, [...(env ? ['--env-file-if-exists=.env'] : []), outfile, ...rest], { stdio: 'inherit' })
process.exit(node.status ?? 1)
