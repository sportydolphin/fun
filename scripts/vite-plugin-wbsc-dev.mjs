// vite-plugin-wbsc-dev.mjs: the World Cup preview's data, from this machine's own files, in dev.
//
// Two things: a WPBL player's World Cup rows (below), and the World Cup pages' files that
// `npm run wbsc -- --site` writes to archive/wbsc/site/ (`/__dev/wbsc-site/<file>.json`). The pages
// exist only under `npm run dev` until the World Cup goes public (src/intl/WorldCupPage.tsx).
//
// WHY. Production reads them from `wbsc_world_cup_lines`, which only the owner's real session can
// read, and a dev server has no such session: the dev menu's "Owner view" draws owner UI but holds
// no token RLS would accept, and a service-role key on this machine would bypass every policy on
// the production database to show one table. The rows already sit in the gitignored
// archive/wbsc/international.json that `npm run wbsc -- --international` wrote, so the dev server
// hands those over instead (src/wpbl/player/WorldCup.tsx asks here first under `npm run dev`).
//
// SERVE ONLY, LOOPBACK ONLY. `apply: 'serve'` keeps it out of every build, so nothing WBSC wrote can
// reach a bundle. And the `vite-dev-lan` launch config binds the dev server to the network so a
// phone can open it, which would hand WBSC's data to anyone on the same Wi-Fi: so a request from
// anywhere but this machine gets a 404, the same answer as no file.

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const FILE = resolve('archive/wbsc/international.json')
const PREFIX = '/__dev/wbsc-world-cup/'
const SITE_DIR = resolve('archive/wbsc/site')
const SITE_PREFIX = '/__dev/wbsc-site/'
// A file name, never a path: nothing outside the site folder can be asked for.
const SITE_FILE = /^world-cup(-[0-9]{4}|-people|-game-[0-9]+|-player-[a-z0-9-]+)?\.json$/
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

export function wbscDev() {
  return {
    name: 'wbsc-dev',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith(SITE_PREFIX)) return next()
        const name = decodeURIComponent(req.url.slice(SITE_PREFIX.length).split('?')[0])
        const path = resolve(SITE_DIR, name)
        const ok = SITE_FILE.test(name) && LOOPBACK.has(req.socket.remoteAddress ?? '') && existsSync(path)
        res.statusCode = ok ? 200 : 404
        res.setHeader('content-type', 'application/json; charset=utf-8')
        res.setHeader('cache-control', 'no-store')
        res.end(ok ? readFileSync(path) : 'null')
      })
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith(PREFIX)) return next()
        const id = decodeURIComponent(req.url.slice(PREFIX.length).split('?')[0])
        // Read on every request, so a fresh --international shows without restarting the server.
        const player = LOOPBACK.has(req.socket.remoteAddress ?? '') && existsSync(FILE)
          ? JSON.parse(readFileSync(FILE, 'utf8'))[id]
          : undefined
        res.statusCode = player ? 200 : 404
        res.setHeader('content-type', 'application/json; charset=utf-8')
        res.setHeader('cache-control', 'no-store')
        res.end(JSON.stringify(player ? { events: player.events } : { events: [] }))
      })
    },
  }
}
