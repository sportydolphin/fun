import { HUE } from '../ui/color'
// The World Cup's rows in the site search, built from `matchWorldCup`. Imported only behind
// `import.meta.env.DEV` (useWpblSearch.ts) until the World Cup goes public; the production build
// fails if it ships (scripts/vite-plugin-no-dev-code.mjs).
import { setSearchQuery } from '../mlb/state/SearchBridgeContext'
import type { SearchResultRow } from '../mlb/state/SearchBridgeContext'
import { navigate } from '../nav'
import { countryName } from './countries'
import { flagOf } from './flags'
import { fetchSite } from './siteFile'
import { matchWorldCup } from './worldCupSearch'
import type { WorldCupIndexEntry } from './wbsc/editions'
import type { WorldCupSearchPerson } from './wbsc/personFile'

// Read once, on the search's first use, and kept: about 60KB for every World Cup-only player.
let files: Promise<[WorldCupSearchPerson[], WorldCupIndexEntry[]]> | null = null
const load = () => (files ??= Promise.all([
  fetchSite<WorldCupSearchPerson[]>('world-cup-people.json').then(r => r ?? []),
  fetchSite<WorldCupIndexEntry[]>('world-cup.json').then(r => r ?? []),
]))

const GREY = HUE.grayDeep

const open = (path: string) => () => { setSearchQuery(''); navigate(path) }

export async function worldCupRows(query: string, season: number | null): Promise<SearchResultRow[]> {
  const [people, editions] = await load()
  const m = matchWorldCup(people, editions, query, season)
  const editionRows = m.editions.map((e): SearchResultRow => ({
    key: `world-cup-${e.slug}`,
    title: e.title,
    subtitle: [e.hosts.join(', '), e.medals ? `Gold: ${countryName(e.medals.gold)}` : null].filter(Boolean).join(' · '),
    avatar: { imageUrl: flagOf(e.medals?.gold), fallbackText: 'WC', bg: GREY, fit: 'cover', circle: true },
    onSelect: open(`/world-cup/${e.slug}`),
  }))
  const personRows = m.people.slice(0, 4).map((p): SearchResultRow => ({
    key: `world-cup-player-${p.slug}`,
    title: p.name,
    subtitle: [p.country ? countryName(p.country) : null, `World Cup ${p.editions.join(', ')}`].filter(Boolean).join(' · '),
    avatar: { imageUrl: flagOf(p.country), fallbackText: p.country ?? '', bg: GREY, fit: 'cover', circle: true },
    onSelect: open(`/world-cup/players/${p.slug}`),
    forgiving: m.forgiving || undefined,
  }))
  const teamRows = m.teams.map((t): SearchResultRow => {
    const n = editions.filter(e => e.team_ids?.includes(t)).length
    return {
      key: `world-cup-team-${t}`,
      title: countryName(t),
      subtitle: `World Cup · ${n} ${n === 1 ? 'edition' : 'editions'}`,
      avatar: { imageUrl: flagOf(t), fallbackText: t, bg: GREY, fit: 'cover', circle: true },
      onSelect: open(`/world-cup/teams/${t.toLowerCase()}`),
    }
  })
  return [...editionRows, ...teamRows, ...personRows]
}
