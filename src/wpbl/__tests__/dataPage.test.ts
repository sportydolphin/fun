import { readdirSync } from 'node:fs'
import path from 'node:path'
import { dataGroups, tableLabel } from '../DataPage'
import { publishedFolder } from '../../../scripts/vite-plugin-wpbl-data.mjs'

describe('/wpbl/data', () => {
  // The page reads the manifests at build time and the build publishes the folders: the two lists
  // must be the same, or the page offers a file that 404s (or hides one that exists).
  it('lists exactly the folders the download publishes, seasons newest first', () => {
    const published = readdirSync(path.resolve(process.cwd(), 'archive')).map(publishedFolder).filter((f): f is string => f != null)
    const groups = dataGroups()
    expect(groups.map(g => g.folder).sort()).toEqual(published.sort())
    expect(groups[groups.length - 1].folder).toBe('league')
    expect(groups.every(g => g.tables.length > 0)).toBe(true)
  })

  it('never offers the World Cup folder', () => {
    const groups = dataGroups({ '../../archive/wbsc/manifest.json': { tables: [{ table: 'people', rows: 1, bytes: 1 }] } })
    expect(groups).toEqual([])
  })

  it('names a table it does not know yet', () => {
    expect(tableLabel('wpbl_game_plays')).toBe('Plays')
    expect(tableLabel('wpbl_umpire_lines')).toBe('Umpire lines')
  })
})
