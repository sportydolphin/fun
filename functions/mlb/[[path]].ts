// The same handler as ./index.ts, for everything BELOW /mlb.
//
// Pages Functions route by file path: functions/mlb/index.ts serves exactly `/mlb` and nothing
// else, and public/_routes.json can only narrow which requests reach the Functions worker, never
// widen what a file serves. This catch-all is what makes the handler run on /mlb/players/<slug>,
// which is the half that keeps that directory's wildcard in public/_redirects from answering 200
// for every typo. Re-exported rather than reimplemented so the two cannot drift.
export { onRequestGet } from './index'
