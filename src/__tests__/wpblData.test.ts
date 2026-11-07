import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { buildIndex, publishedFolder, resolveDataPath } from '../../scripts/vite-plugin-wpbl-data.mjs'

const ARCHIVE = path.resolve(process.cwd(), 'archive')

describe('the open-data download', () => {
  it('publishes the WPBL folders and nothing else under archive/', () => {
    expect(publishedFolder('wpbl')).toBe('league')
    expect(publishedFolder('wpbl-2026')).toBe('2026')
    // The World Cup data is private until its public switch; it must never ride along.
    expect(publishedFolder('wbsc')).toBeNull()
    expect(publishedFolder('wpbl-2026-old')).toBeNull()
    expect(publishedFolder('README.md')).toBeNull()
  })

  it('serves only table files and the readme, never a path out of the archive', () => {
    expect(resolveDataPath(ARCHIVE, '/data/wpbl/2026/wpbl_games.json')).toBe(path.join(ARCHIVE, 'wpbl-2026', 'wpbl_games.json'))
    expect(resolveDataPath(ARCHIVE, '/data/wpbl/league/wpbl_teams.json')).toBe(path.join(ARCHIVE, 'wpbl', 'wpbl_teams.json'))
    expect(resolveDataPath(ARCHIVE, '/data/wpbl/README.md')).toBe(path.join(ARCHIVE, 'README.md'))
    for (const bad of [
      '/data/wpbl/../wbsc/people.json',
      '/data/wpbl/2026/..%2F..%2F.env',
      '/data/wpbl/wbsc/people.json',
      '/data/wpbl/2026/sub/x.json',
      '/data/other/2026/wpbl_games.json',
    ]) expect(resolveDataPath(ARCHIVE, bad)).toBeNull()
  })

  it('indexes every published file, and every file it names exists at its stated size', async () => {
    const index = await buildIndex(ARCHIVE)
    const seasons = readdirSync(ARCHIVE).filter(n => /^wpbl-\d{4}$/.test(n))
    expect(index.seasons.map((s: { season: number }) => s.season)).toEqual(seasons.map(n => Number(n.slice(5))).sort())
    const all = [index.league_tables, ...index.seasons]
    for (const group of all) {
      for (const f of group.files) {
        const file = resolveDataPath(ARCHIVE, f.url)
        expect(file).not.toBeNull()
        expect(statSync(file!).size).toBe(f.bytes)
        expect(JSON.parse(readFileSync(file!, 'utf8'))).toHaveLength(f.rows)
      }
    }
  })
})
