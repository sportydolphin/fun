// The WPBL section's first reads, started by index.html before any JavaScript bundle loads.
//
// WHY. Every read the section makes is asked by code inside the section's own chunk, so none could
// start until the browser had downloaded and run every module the page needs: about 5s into a cold
// load on a throttled phone, on the local build and on production alike (Nov 6, 2026). The clubs,
// the schedule and the roster are what everything on /wpbl is drawn from, about 20 KB gzipped, so
// an inline script in index.html asks the edge cache for them at the first byte of the page and
// leaves the promises on `window`, and edgeFetch.ts answers the client's own request for that exact
// URL from them instead of asking again.
//
// THE PATHS MUST MATCH THE CLIENT'S URLS EXACTLY, query string and all, or the early answer is
// never claimed and the read happens twice. src/__tests__/earlyReads.test.ts pins three things
// together: this list, the copy in index.html's inline script, and the URLs the api functions
// actually build. Change a query in api/games.ts or api/players.ts and that test says so.
//
// SIGNED-OUT ONLY, like the edge cache itself: the inline script skips a browser holding a
// session, whose reads go to Supabase directly (edgeFetch.ts).

/** Path and query under the Supabase REST root, as the client builds them. Every WPBL address.
 *  The site's own schedule joined the first three on Nov 18, 2026: every tab asks for it. */
export const EARLY_READS = [
  '/rest/v1/wpbl_teams?select=*&order=sort_order.asc',
  '/rest/v1/wpbl_games?select=*&order=game_date.asc',
  '/rest/v1/wpbl_players?select=*',
  '/rest/v1/wpbl_site_games?select=event_id%2Cgame_date%2Cstart_time%2Ctitle%2Cstatus%2Chome_team_id%2Caway_team_id%2Chome_score%2Caway_score%2Cround%2Cseries_key%2Cgame_number%2Curl%2Cticket_url&order=game_date.asc%2Cevent_id.asc',
] as const

/**
 * HOME'S OWN READS, started on Home's address only (`/wpbl`, and `/` when it opens WPBL).
 *
 * Home draws its skeleton the moment the code arrives, then asks for these: the tracked games, the
 * Reading and Watch rails, the fan photos and their tags, and the roster moves. Measured on
 * production with Chrome throttled to 1.6 Mbps and 4x CPU (Nov 18, 2026), the code finished at
 * 4.2s, these went out at 5.2s, and Home's cards filled in at 6.5s; the first three reads above had
 * finished at 2.4s. Started here they arrive while the code is still downloading.
 *
 * AT LOW PRIORITY, unlike the three above. They are about 70 KB, and the code is what Home is
 * waiting on first: at the default priority they would share the connection with it and make the
 * skeleton later to make the cards sooner. Another tab never asks for these, so starting them there
 * would be bandwidth spent for nothing.
 */
export const HOME_EARLY_READS = [
  '/rest/v1/wpbl_pitch_tracking?select=game_id&order=activity_id.asc&offset=0&limit=1000',
  '/rest/v1/wpbl_articles?select=post_id%2Csource%2Cslug%2Curl%2Ctitle%2Csubtitle%2Ccover_url%2Cpublished_at%2Cword_count%2Cvideo_count%2Cgame_id%2Cteam_ids%2Cplayer_ids&order=published_at.desc%2Cpost_id.desc',
  '/rest/v1/wpbl_videos?select=video_id%2Cchannel_id%2Ctitle%2Cpublished_at%2Cthumbnail_url%2Ckind%2Cgame_id%2Caway_hint%2Chome_hint%2Cgame_date_hint%2Cis_short%2Cregion_allowed%2Cregion_blocked%2Cduration_seconds%2Cview_count&order=published_at.desc%2Cvideo_id.asc&offset=0&limit=1000',
  '/rest/v1/wpbl_fan_photos?select=id%2Ccard_url%2Cfull_url%2Cwidth%2Cheight%2Ccaption%2Ccredit%2Ctaken_on%2Cgame_id%2Csort_order%2Ccategory_key%2Capproved&approved=eq.true&order=sort_order.asc.nullslast%2Ccreated_at.asc%2Cid.asc&offset=0&limit=1000',
  '/rest/v1/wpbl_photo_subjects?select=id%2Cphoto_id%2Cplayer_id%2Cfigure_key%2Cteam_id&order=photo_id.asc%2Cid.asc&offset=0&limit=1000',
  '/rest/v1/wpbl_photo_figures?select=key%2Cname%2Ckind%2Cblurb%2Cteam_id&order=name.asc%2Ckey.asc&offset=0&limit=1000',
  '/rest/v1/wpbl_photo_categories?select=key%2Cname%2Cblurb%2Csort_order&order=sort_order.asc.nullslast%2Cname.asc',
  '/rest/v1/wpbl_roster_moves?select=id%2Cseason%2Ckind%2Cplayer_id%2Cplayer_name%2Cteam_id%2Cfrom_team_id%2Ctrade_id%2Cdraft_round%2Cdraft_pick%2Cannounced_on%2Csource_url&order=announced_on.desc%2Cid.desc',
] as const

/** Where index.html leaves the started requests, keyed by the paths above. */
export const EARLY_READS_GLOBAL = '__sdEarlyReads'

type EarlyMap = Record<string, Promise<Response> | undefined>

/** The early request for this path and query, at most once: a later read of the same URL (a poll)
 *  must reach the network, not this page's first answer. */
export function takeEarlyRead(pathAndSearch: string): Promise<Response> | null {
  if (typeof window === 'undefined') return null
  const map = (window as unknown as Record<string, EarlyMap | undefined>)[EARLY_READS_GLOBAL]
  const p = map?.[pathAndSearch]
  if (!p) return null
  delete map[pathAndSearch]
  return p
}
