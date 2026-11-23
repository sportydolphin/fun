import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// The archived seasons (archive/, in git), read the way scripts/export-wpbl-archive.ts wrote them:
// one directory per season, one JSON array per table, plus the league-wide tables in archive/wpbl/.
// Real data with no .env, for the tests that check one number against another across a whole
// season. Not a fixture to snapshot: a correction moves these files, so a test reading them
// asserts a relation that must hold on any data, never a figure.

const ROOT = join(__dirname, '..', '..', '..')

const readTable = <T,>(dir: string, file: string): T[] => {
  const p = join(ROOT, 'archive', dir, file)
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) as T[] : []
}

/** Every archived season's directory, oldest first. */
export const archivedSeasons = (): string[] =>
  readdirSync(join(ROOT, 'archive')).filter(d => /^wpbl-\d{4}$/.test(d)).sort()

/** One table over the seasons named (all of them by default). */
export const archiveTable = <T,>(file: string, seasons = archivedSeasons()): T[] =>
  seasons.flatMap(d => readTable<T>(d, `${file}.json`))

/** A table that belongs to no one season: players, teams. */
export const leagueTable = <T,>(file: string): T[] => readTable<T>('wpbl', `${file}.json`)
