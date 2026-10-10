// The Supabase tables whose signed-out reads go through the edge cache (functions/api/sb), and
// how long each may be served from it. Shared by the browser's router (src/lib/supabase.ts) and
// the function, so the two cannot disagree on what is allowed. No imports: the Pages Function
// bundles this file.
//
// WHY THERE IS A CACHE. Every Supabase read took 230 to 670ms in the browser, every visit, every
// reader: the REST API answers `cf-cache-status: DYNAMIC` with no cache-control, so nothing
// between the reader and Postgres ever kept an answer. A read served from Cloudflare's edge comes
// back over the connection the page already has open to this origin, in tens of milliseconds.
//
// TWO TIERS, because the two kinds of table fail differently when stale.
// `slow`: written by a daily job or by hand. Served from the edge for 5 minutes, then served
//   stale (up to a day) while one background read refreshes it. The site has a few hundred
//   readers a day spread over many Cloudflare locations, so without the stale window nearly
//   every read would miss and the cache would buy nothing.
// `live`: anything a game in progress writes. While the league is ACTIVE, a plain 10 second
//   cache and never served stale: stale-while-revalidate would show a lone reader every live poll
//   one poll late, for the whole game. Ten seconds is under every live poll on the site (the
//   shortest is 20s). While it is IDLE these tables cannot change, so they take the `slow` policy:
//   without that they would almost never be held, since ten seconds rarely spans two readers here.
//   Active means a game is live, or one is dated yesterday, today or tomorrow, which covers every
//   timezone and a game running past midnight; the edge asks once a minute (functions/api/sb). It
//   fails ACTIVE: a signal that cannot be read costs speed, never a stale score.
//
// NOT HERE, on purpose: anything a reader writes or reads about themselves (picks, votes,
// preferences, usernames, events), and the admin tables. A table goes here only if every
// signed-out reader is shown the same rows, because the cache hands one reader's answer to the
// next.

export type EdgeTier = 'slow' | 'live'

export const EDGE_TABLES: Readonly<Record<string, EdgeTier>> = {
  wpbl_teams: 'slow',
  wpbl_players: 'slow',
  wpbl_videos: 'slow',
  wpbl_video_tags: 'slow',
  wpbl_articles: 'slow',
  wpbl_recaps: 'slow',
  wpbl_fan_photos: 'slow',
  wpbl_photos: 'slow',
  wpbl_photo_subjects: 'slow',
  wpbl_photo_figures: 'slow',
  wpbl_photo_categories: 'slow',
  wpbl_photo_contributors: 'slow',
  wpbl_tracking_watch: 'slow',
  milestone_watch: 'slow',
  streak_leaders: 'slow',
  playoff_odds: 'slow',
  team_payrolls: 'slow',
  player_contracts: 'slow',

  wpbl_games: 'live',
  wpbl_site_games: 'live',
  wpbl_game_details: 'live',
  wpbl_game_plays: 'live',
  wpbl_play_corrections: 'live',
  wpbl_batting_lines: 'live',
  wpbl_pitching_lines: 'live',
  wpbl_fielding_lines: 'live',
  wpbl_pitch_tracking: 'live',
  wpbl_pitching_usage: 'live',
  wpbl_lineup_history: 'live',
}

/** Seconds an answer is served as current, and how long past that it may be served stale. */
export const EDGE_POLICY: Readonly<Record<EdgeTier, { fresh: number; stale: number }>> = {
  slow: { fresh: 300, stale: 86_400 },
  live: { fresh: 10, stale: 0 },
}

/** The question the edge asks to decide whether the league is active: any game live, or dated
 *  within a day of `now`. Answered by a single id or none. */
export function leagueActiveQuery(now: Date): string {
  const day = (offset: number) => new Date(now.getTime() + offset * 86_400_000).toISOString().slice(0, 10)
  return `/rest/v1/wpbl_games?select=id&or=(status.eq.live,and(game_date.gte.${day(-1)},game_date.lte.${day(1)}))&limit=1`
}

/** The path the browser asks under, in front of Supabase's own `/rest/v1/...`. */
export const EDGE_PREFIX = '/api/sb'

/** The table a `/rest/v1/<table>` path reads, when it is one the edge serves. */
export function edgeTable(path: string): string | null {
  const m = /^\/rest\/v1\/([a-z0-9_]+)$/.exec(path)
  return m && Object.prototype.hasOwnProperty.call(EDGE_TABLES, m[1]) ? m[1] : null
}
