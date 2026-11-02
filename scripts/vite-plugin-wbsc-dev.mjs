// vite-plugin-wbsc-dev.mjs: the World Cup preview's rows, from this machine's own file, in dev.
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
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

export function wbscDev() {
  return {
    name: 'wbsc-dev',
    apply: 'serve',
    configureServer(server) {
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
