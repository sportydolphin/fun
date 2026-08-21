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
// Re-exported rather than reimplemented so the two routes cannot drift. The handler already
// no-ops (returns `next()`) for any request without a ?player=, which is almost all of them.
export { onRequestGet } from './index'
