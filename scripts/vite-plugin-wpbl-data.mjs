import { createReadStream } from 'node:fs'
import { cp, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

// Publish the WPBL archive as the open-data download, at stable public paths:
//
//   /data/wpbl/index.json            every season and file, with row counts and sizes
//   /data/wpbl/<year>/<table>.json   one season's tables (archive/wpbl-<year>/)
//   /data/wpbl/league/<table>.json   the clubs, players and links (archive/wpbl/)
//   /data/wpbl/README.md             what the files are and are not
//
// WHY A COPY OF archive/ AND NOT A SECOND EXPORT. The archive is already the frozen season: the
// `wpbl-archive` workflow rewrites it weekly through the anon key, commits only when a row moved,
// and `npm run archive -- --check` holds it to the database. A second exporter writing into
// public/ would be two copies of the record that can disagree. Publishing the same files means a
// download is always exactly what git holds, and a league correction reaches it on the next deploy
// after the weekly commit.
//
// ONLY THE WPBL FOLDERS. archive/ also holds `wbsc/`, which is gitignored and must not be published
// until the World Cup goes public (ROADMAP-WOMENS-BASEBALL, stage 0, step 6). The pattern below
// names `wpbl` and `wpbl-<year>` and nothing else, so a new folder under archive/ is never served
// by accident.
//
// The site does not read these files: its reads stay on Supabase behind Cloudflare's cache (Nov 7,
// 2026), so a file that lags a correction can only ever be a stale download, never a stale page.
const SEASON_DIR = /^wpbl-(\d{4})$/
const LEAGUE_DIR = 'wpbl'
const PREFIX = '/data/wpbl/'

/** Archive folder name → its folder under /data/wpbl/, or null for anything not published. */
export function publishedFolder(name) {
  if (name === LEAGUE_DIR) return 'league'
  const m = SEASON_DIR.exec(name)
  return m ? m[1] : null
}

/** The index a reader starts from, built from each folder's own manifest.json. */
export async function buildIndex(archiveDir) {
  const seasons = []
  let league = null
  for (const name of (await readdir(archiveDir)).sort()) {
    const out = publishedFolder(name)
    if (!out) continue
    const manifest = JSON.parse(await readFile(path.join(archiveDir, name, 'manifest.json'), 'utf8'))
    const entry = {
      path: `${PREFIX}${out}/`,
      exported_at: manifest.exported_at,
      files: manifest.tables.map(t => ({ table: t.table, url: `${PREFIX}${out}/${t.table}.json`, rows: t.rows, bytes: t.bytes })),
    }
    if (out === 'league') league = entry
    else seasons.push({ season: Number(out), ...entry })
  }
  return {
    league: "Women's Pro Baseball League",
    source: 'https://sportydolphin.fun, mirrored from stats.womensprobaseballleague.com',
    readme: `${PREFIX}README.md`,
    league_tables: league,
    seasons,
  }
}

/** A request path under /data/wpbl/ → the archive file behind it, or null. */
export function resolveDataPath(archiveDir, url) {
  if (!url.startsWith(PREFIX)) return null
  const rest = decodeURIComponent(url.slice(PREFIX.length))
  if (rest === 'README.md') return path.join(archiveDir, 'README.md')
  const m = /^(league|\d{4})\/([a-z0-9_]+\.json)$/.exec(rest)
  if (!m) return null
  const folder = m[1] === 'league' ? LEAGUE_DIR : `wpbl-${m[1]}`
  return path.join(archiveDir, folder, m[2])
}

export function wpblData() {
  let root = process.cwd()
  let outDir = 'dist'
  let isBuild = false
  const archive = () => path.resolve(root, 'archive')
  return {
    name: 'wpbl-data',
    configResolved(config) {
      root = config.root
      outDir = config.build.outDir
      isBuild = config.command === 'build'
    },
    // The same paths under `npm run dev`, or they would fall through to the SPA locally.
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url || '').split('?')[0]
        if (url === `${PREFIX}index.json`) {
          buildIndex(archive()).then(
            index => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(index, null, 2)) },
            () => next(),
          )
          return
        }
        const file = resolveDataPath(archive(), url)
        if (!file) return next()
        stat(file).then(
          () => {
            res.setHeader('content-type', file.endsWith('.md') ? 'text/markdown; charset=utf-8' : 'application/json')
            createReadStream(file).pipe(res)
          },
          () => next(),
        )
      })
    },
    async closeBundle() {
      // Vitest fires closeBundle with a placeholder outDir; only a real `vite build` publishes.
      if (!isBuild) return
      const dest = path.resolve(root, outDir, 'data', 'wpbl')
      for (const name of await readdir(archive())) {
        const out = publishedFolder(name)
        if (out) await cp(path.join(archive(), name), path.join(dest, out), { recursive: true })
      }
      await cp(path.join(archive(), 'README.md'), path.join(dest, 'README.md'))
      await writeFile(path.join(dest, 'index.json'), JSON.stringify(await buildIndex(archive()), null, 2) + '\n')
    },
  }
}
