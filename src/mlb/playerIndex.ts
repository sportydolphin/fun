// This season's MLB players, kept in the browser, so the header search answers a name as it is typed
// rather than 350ms later from StatsAPI.
//
// WHY. `people/search` is one round trip per settled query, with a debounce in front of it so it is
// not one per key, and the two together are most of the wait between typing "Skenes" and seeing
// him. Everyone a reader is likely to look for has played this season: StatsAPI's season list holds
// them all (about 1,560, 42KB gzipped, cached at its edge for 15 minutes), so one read a day answers
// nearly every search locally. The network search stays for everyone else, a retired player or a
// prospect not yet up, and runs only when the local list comes up short.
//
// Every storage read and write is guarded: private modes and blocked storage throw, and the cost is
// only that the search asks the network as it did before.

import { foldName } from '../lib/fuzzyName'
import type { Player } from './types'

const KEY = 'sd:mlbPlayerIndex:v1'
const FRESH_MS = 24 * 60 * 60_000
const FIELDS = 'people,id,fullName,active,primaryPosition,code,name,type,abbreviation,currentTeam,primaryNumber,currentAge,mlbDebutDate'

interface Stored { season: number; at: number; people: Player[] }

let players: Player[] = []
let folded: string[][] = []
let loading: Promise<void> | null = null

function adopt(people: Player[]): void {
  players = people
  folded = people.map(p => foldName(p.fullName).split(' '))
}

function read(season: number): Stored | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as Partial<Stored>
    return v.season === season && typeof v.at === 'number' && Array.isArray(v.people) ? v as Stored : null
  } catch {
    return null
  }
}

/** Loads the season's players: the browser's copy at once, and a fresh read when it is a day old or
 *  missing. Safe to call on every focus; it reads the network at most once a page load. */
export function loadMlbPlayerIndex(season: number): Promise<void> {
  if (loading) return loading
  const stored = read(season)
  if (stored) adopt(stored.people)
  if (stored && Date.now() - stored.at < FRESH_MS) return (loading = Promise.resolve())
  loading = fetch(`https://statsapi.mlb.com/api/v1/sports/1/players?season=${season}&fields=${FIELDS}`)
    .then(r => { if (!r.ok) throw new Error(`sports/1/players ${r.status}`); return r.json() })
    .then((d: { people?: Player[] }) => {
      if (!d.people?.length) return
      adopt(d.people)
      try { localStorage.setItem(KEY, JSON.stringify({ season, at: Date.now(), people: d.people } satisfies Stored)) } catch { /* storage full or blocked */ }
    })
    // A failed read keeps whatever copy there was and lets the next page load try again.
    .catch(() => { loading = null })
  return loading
}

/** True once there is a list to search, from either the browser's copy or the network. */
export const mlbPlayerIndexReady = (): boolean => players.length > 0

/**
 * The season's players whose name fits `query` the way StatsAPI's own search does: each typed word
 * opens a different word of the name, in any order, accents ignored ("acuna" finds Acuña). Best
 * first: a name that starts with the query, then a surname that does, then the rest; active players
 * before inactive ones, then the shorter name.
 */
export function searchMlbPlayerIndex(query: string): Player[] {
  const typed = foldName(query).split(' ').filter(Boolean)
  if (!typed.length) return []
  const q = typed.join(' ')
  const hits: { p: Player; score: number }[] = []
  players.forEach((p, i) => {
    const words = folded[i]
    const used = new Set<number>()
    const fits = typed.every(t => {
      const at = words.findIndex((w, j) => !used.has(j) && w.startsWith(t))
      if (at < 0) return false
      used.add(at)
      return true
    })
    if (!fits) return
    const full = words.join(' ')
    // The surname is the last word that is not a suffix: "acuna" opens Ronald Acuña Jr.'s.
    const named = words.filter(w => !/^(jr|sr|ii|iii|iv)$/.test(w))
    const last = named[named.length - 1] ?? ''
    const score = full.startsWith(q) ? 3 : last.startsWith(typed[0]) ? 2 : 1
    hits.push({ p, score })
  })
  hits.sort((a, b) => b.score - a.score || Number(b.p.active) - Number(a.p.active) || a.p.fullName.length - b.p.fullName.length)
  return hits.map(h => h.p)
}

/** Tests only. */
export function resetMlbPlayerIndex(): void { players = []; folded = []; loading = null }
