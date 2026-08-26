// The same handler as ./index.ts, for everything BELOW /wpbl.
//
// Pages Functions routing is by file path: functions/wpbl/index.ts serves exactly `/wpbl`
// and nothing else. public/_routes.json can only narrow which requests reach the Functions
// worker at all, so listing `/wpbl/*` there does not make index.ts run on /wpbl/stats. A
// catch-all file is the only thing that does.
//
// Why the subtree needs it: an open player or game modal hangs off whichever tab it was
// opened from, so once the tabs became real paths (Aug 21, 2026) the most-shared links on
// the site (a player tapped from the Stats leaders or a Teams roster, living at
// /wpbl/stats?player=…) stopped invoking the og:image rewrite and quietly unfurled as the
// site's generic card. The page looked perfectly fine; only the link preview was wrong,
// which is precisely the kind of thing nobody notices for a month.
//
// Re-exported rather than reimplemented so the two routes cannot drift. The handler no-ops
// (returns `next()`) for anything that is not a player page, a game page, or a legacy
// ?player= / ?game= / ?view= link, which is almost every request.
//
// It is also what makes the two wildcards in public/_redirects safe. /wpbl/players/* and
// /wpbl/games/* have to be wildcards, because the valid slugs are the roster and the
// schedule and neither can be enumerated in a static file; this resolves the slug and
// answers a real 404 for anything naming nobody and no game, BEFORE the rewrite is reached.
// Delete this file and every typo under either directory is an indexable page again.
export { onRequestGet } from './index'
