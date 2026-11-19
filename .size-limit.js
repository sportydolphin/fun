// Bundle budgets, checked by `npm run size` after `npm run build` (ci.yml, the `check` job).
//
// WHY BUDGETS AT ALL. Three quarters of the traffic is a phone, and nothing else in CI notices a
// bundle growing: a new import of a big library into a shared module lands in every visitor's
// first load and every test still passes. Each limit sits about 8% over what main measured on
// Nov 7, 2026, so ordinary work fits and a step change fails. Raising one is fine when the growth
// is wanted; say why in the pull request.
//
// "First load on /wpbl" is what index.html makes a browser fetch before the page can draw: the
// entry script plus every LIVE modulepreload. The MLB links inside <template> blocks are inert
// until the /mlb Pages Function unwraps them (scripts/vite-plugin-wpbl-preload.mjs), so they are
// cut out before counting, or the budget would charge every WPBL reader for MLB.
import { existsSync, readFileSync } from 'node:fs'

const html = existsSync('dist/index.html')
  ? readFileSync('dist/index.html', 'utf8').replace(/<template[\s\S]*?<\/template>/g, '')
  : ''
const firstLoad = [...new Set([...html.matchAll(/(?:href|src)="\/(assets\/[^"]+\.js)"/g)].map(m => `dist/${m[1]}`))]
if (firstLoad.length === 0) throw new Error('size-limit: no dist/index.html scripts found; run `npm run build` first')

export default [
  // Brotli, size-limit's default and what Cloudflare serves. Nov 7: 396 kB, 110 kB, 1.05 MB.
  //
  // THE FIRST LOAD IS HELD CLOSER, about 4% over the 372 kB measured on Nov 18, 2026, once the auth
  // client stopped loading for signed-out readers (src/lib/supabase.ts). At 8% it
  // had 32 kB of room, and the search parser (league/finderParse.ts and league/finder.ts, about
  // 30 kB brotlied) sat in that room for weeks without failing anything, loaded by every reader for
  // a search few of them typed. `npm run analyze` lists what is in this load, largest first.
  { name: 'First load on /wpbl (entry plus live preloads)', path: firstLoad, limit: '387 kB' },
  // The page itself, which since Nov 18, 2026 also carries the entry stylesheet (inlined, so the
  // first paint waits on nothing else) and the static toolbar and titles. Every byte of it arrives
  // before anything can draw, and the URLs of the reads it starts for Home (src/lib/earlyReads.ts).
  // 10.8 kB that day.
  { name: 'index.html', path: 'dist/index.html', limit: '11.6 kB' },
  { name: 'Entry chunk', path: 'dist/assets/index-*.js', limit: '119 kB' },
  // Raised from 1130 kB on Nov 13, when /admin's live notes console took it 379 B over: a lazy
  // chunk only the owner downloads, so no reader's load moved. Main had grown to the old limit since
  // Nov 7 in ordinary work, which the 8% was for.
  { name: 'All JavaScript', path: 'dist/assets/*.js', limit: '1180 kB' },
]
