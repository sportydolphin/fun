/**
 * Regenerate public/sitemap.xml, including a URL for every WPBL player and every game
 * that has been played.
 *
 * The file used to be written by hand, which was fine for five URLs and is not fine for a
 * hundred and twenty. It was also quietly lying: every entry claimed `changefreq: hourly`
 * and a `lastmod` of the day the file was created, for pages that had not changed since.
 *
 * The tab paths come from src/wpbl/routes.ts rather than being restated here, so a new tab
 * cannot be added to the app and forgotten in the sitemap. That is also what
 * src/wpbl/__tests__/routes.test.ts pins.
 *
 *   npm run sitemap
 *
 * Needs VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (both public, both already in the
 * client bundle). Reads only; writes nothing but the file.
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  WPBL_VIEW_PATHS, WPBL_PLAYERS_BASE, wpblPlayerSlug, type WpblSluggable,
  wpblGameSlug, type WpblSluggableGame, type WpblSluggableTeam,
  WPBL_TEAMS_BASE, teamSlug,
} from '../src/wpbl/routes'
import { slugifyName } from '../src/wpbl/slug'

const SITE = 'https://sportydolphin.fun'
// Relative to the repo root, NOT to this file: `npm run sitemap` bundles it into
// node_modules/.cache first, so import.meta.url points somewhere useless by the time it runs.
const OUT = resolve(process.cwd(), 'public', 'sitemap.xml')

interface Entry { loc: string; changefreq: string; priority: string }

// The pages that exist regardless of what is in the database. Priorities are relative to
// each other and to nothing else: WPBL is the section the site leads with, the legal pages
// are here only so they are not orphaned.
const STATIC: Entry[] = [
  { loc: '/wpbl', changefreq: 'hourly', priority: '1.0' },
  { loc: '/wpbl/standings', changefreq: 'daily', priority: '0.9' },
  { loc: '/wpbl/stats', changefreq: 'daily', priority: '0.9' },
  { loc: '/wpbl/schedule', changefreq: 'daily', priority: '0.8' },
  { loc: '/wpbl/teams', changefreq: 'weekly', priority: '0.8' },
  { loc: `${WPBL_PLAYERS_BASE}`, changefreq: 'weekly', priority: '0.8' },
  { loc: '/mlb', changefreq: 'hourly', priority: '0.8' },
  // Durable rather than daily: it changes when the roster does, and it is the one page here
  // that still says something after the feed stops.
  { loc: '/wpbl/league', changefreq: 'monthly', priority: '0.7' },
  { loc: '/wpbl/api', changefreq: 'weekly', priority: '0.5' },
  { loc: '/privacy', changefreq: 'yearly', priority: '0.2' },
  { loc: '/terms', changefreq: 'yearly', priority: '0.2' },
  { loc: '/delete-account', changefreq: 'yearly', priority: '0.2' },
]

async function readRoster(): Promise<WpblSluggable[]> {
  const base = process.env.VITE_SUPABASE_URL
  const key = process.env.VITE_SUPABASE_ANON_KEY
  if (!base || !key) {
    throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required (try: node --env-file=.env)')
  }
  const res = await fetch(`${base.replace(/\/+$/, '')}/rest/v1/wpbl_players?select=id,name&order=name.asc`, {
    headers: { apikey: key, authorization: `Bearer ${key}`, accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`postgrest ${res.status}`)
  return (await res.json()) as WpblSluggable[]
}

/**
 * The schedule and the clubs, for the game URLs.
 *
 * FINALS ONLY. A scheduled game's page is a preview with no box score and no play-by-play,
 * which is a thin page by anyone's definition and there are never more than a handful of
 * them at once; submitting one only to have it become a different page a week later is
 * churn for no gain. A game earns its entry by having been played, and the daily cron picks
 * it up the morning after.
 */
async function readSchedule(): Promise<{ games: WpblSluggableGame[]; teams: WpblSluggableTeam[] }> {
  const base = process.env.VITE_SUPABASE_URL
  const key = process.env.VITE_SUPABASE_ANON_KEY
  if (!base || !key) {
    throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required (try: node --env-file=.env)')
  }
  const read = async <T>(query: string): Promise<T[]> => {
    const res = await fetch(`${base.replace(/\/+$/, '')}/rest/v1/${query}`, {
      headers: { apikey: key, authorization: `Bearer ${key}`, accept: 'application/json' },
    })
    if (!res.ok) throw new Error(`postgrest ${res.status}`)
    return (await res.json()) as T[]
  }
  const [games, teams] = await Promise.all([
    // The WHOLE schedule, not just the finals: wpblGameSlug decides whether a slug needs
    // disambiguating by looking at every game, so filtering first could hand a bare slug to
    // a game that shares its date and matchup with one that has not been played yet.
    read<WpblSluggableGame & { status: string | null }>(
      'wpbl_games?select=id,game_date,home_team_id,away_team_id,status&order=game_date.asc',
    ),
    read<WpblSluggableTeam>('wpbl_teams?select=id,name'),
  ])
  return { games, teams }
}

function xml(entries: Entry[], lastmod: string): string {
  const urls = entries.map(e => `  <url>
    <loc>${SITE}${e.loc}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${e.changefreq}</changefreq>
    <priority>${e.priority}</priority>
  </url>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- Generated by scripts/build-sitemap.ts (npm run sitemap). Do not hand-edit: the player
     URLs come from the roster, and a hand edit is lost on the next run. -->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`
}

const roster = await readRoster()
const schedule = await readSchedule()

// Loud on purpose. A shared name is the one case where a player's URL is not simply their
// name, and it is otherwise invisible: both players still get a working page, but at
// suffixed URLs, and anyone who linked the bare slug now has a dead link.
const byBase = new Map<string, string[]>()
for (const p of roster) {
  const b = slugifyName(p.name)
  byBase.set(b, [...(byBase.get(b) ?? []), p.name])
}
const collisions = [...byBase.entries()].filter(([, names]) => names.length > 1)
if (collisions.length) {
  console.warn(`\n  ${collisions.length} shared name(s); these players get id-suffixed URLs:`)
  for (const [base, names] of collisions) console.warn(`    ${base}: ${names.join(', ')}`)
  console.warn('')
}

const players: Entry[] = roster.map(p => ({
  loc: `${WPBL_PLAYERS_BASE}/${wpblPlayerSlug(p, roster)}`,
  changefreq: 'daily',
  priority: '0.7',
}))

// One entry per club, derived from the schedule's own team list rather than a literal, so the
// sitemap cannot name a club the game URLs do not. High priority and weekly: a club page is a
// season-long destination whose numbers move every day, and it is the hub that gives a crawler
// a path to eighteen player pages it would otherwise reach only from the flat index.
const teamEntries: Entry[] = (schedule.teams as WpblSluggableTeam[]).map(t => ({
  loc: `${WPBL_TEAMS_BASE}/${teamSlug(t.id, schedule.teams)}`,
  changefreq: 'daily',
  priority: '0.8',
}))

const played = (schedule.games as (WpblSluggableGame & { status: string | null })[])
  .filter(g => g.status === 'final')
const gameEntries: Entry[] = played.map(g => ({
  loc: `/wpbl/games/${wpblGameSlug(g, schedule.teams, schedule.games)}`,
  // A final never changes again, bar a scoring correction. Monthly is the honest claim, and
  // it is the difference between a crawler re-fetching 41 settled pages every day and not.
  changefreq: 'monthly',
  priority: '0.6',
}))

// Guard against the tab list and this file drifting apart. The test pins the sitemap's
// CONTENTS, but only this can catch a tab that exists and was never given an entry.
const missing = WPBL_VIEW_PATHS.filter(p => !STATIC.some(e => e.loc === p))
if (missing.length) throw new Error(`WPBL tabs missing from STATIC: ${missing.join(', ')}`)

const entries = [...STATIC, ...teamEntries, ...players, ...gameEntries]

// Rewrite ONLY when the set of URLs actually changed.
//
// This runs on a daily cron, and `lastmod` is stamped with the run date, so regenerating
// unconditionally would produce a diff every single day: a commit that says nothing, and a
// Cloudflare deploy behind it, for a file whose contents are identical. Worse, a sitemap
// that claims every page changed today, every day, is a signal Google learns to distrust.
//
// So lastmod here means "when this URL set last changed", which is a claim the file can
// actually keep. A new player, or a retired one, moves it; a quiet Tuesday does not.
const existing = existsSync(OUT) ? readFileSync(OUT, 'utf8') : ''
const locsIn = (xmlText: string) => [...xmlText.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]).join('\n')
const wanted = entries.map(e => `${SITE}${e.loc}`).join('\n')

if (existing && locsIn(existing) === wanted) {
  console.log(`sitemap: unchanged (${entries.length} URLs), not rewritten`)
} else {
  const lastmod = new Date().toISOString().slice(0, 10)
  writeFileSync(OUT, xml(entries, lastmod), 'utf8')
  console.log(`sitemap: ${entries.length} URLs (${teamEntries.length} clubs, ${players.length} players, ${gameEntries.length} games) -> public/sitemap.xml`)
}
