import { createReadStream } from 'node:fs'
import { cp, stat } from 'node:fs/promises'
import path from 'node:path'

// Publish the bundled WPBL headshots at a STABLE public path (/portraits/<slug>.webp).
//
// The app itself doesn't need this: portraits.ts imports them through Vite, which emits
// content-hashed URLs. But the Pages function that writes og:image for a shared player
// link (functions/wpbl/index.ts) runs at the edge with no knowledge of the build's hash
// map, so it needs a name it can predict from the player's name alone. Copying rather
// than moving the folder into public/ keeps the app's hashed, immutably-cacheable URLs
// intact — the two copies are the same bytes serving two different cache strategies.
const SRC_DIR = 'src/wpbl/portraits'
const PUBLIC_PREFIX = '/portraits/'

export function wpblPortraitAssets() {
  let root = process.cwd()
  let outDir = 'dist'
  let isBuild = false
  return {
    name: 'wpbl-portrait-assets',
    configResolved(config) {
      root = config.root
      outDir = config.build.outDir
      isBuild = config.command === 'build'
    },
    // Dev has no build output to copy into, so serve the same path straight from source —
    // otherwise /portraits/* would 404 locally and silently fall through to the SPA.
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url || '').split('?')[0]
        if (!url.startsWith(PUBLIC_PREFIX)) return next()
        const name = path.basename(decodeURIComponent(url))
        if (!/^[a-z0-9-]+\.webp$/.test(name)) return next()
        const file = path.resolve(root, SRC_DIR, name)
        stat(file).then(
          () => {
            res.setHeader('content-type', 'image/webp')
            createReadStream(file).pipe(res)
          },
          () => next(),
        )
      })
    },
    async closeBundle() {
      // Vitest loads the same plugin list and fires closeBundle with a placeholder outDir
      // ('dummy-non-existing-folder'), so a test run would otherwise litter the repo with a
      // second copy of every headshot. Only a real `vite build` publishes them.
      if (!isBuild) return
      await cp(path.resolve(root, SRC_DIR), path.resolve(root, outDir, 'portraits'), { recursive: true })
    },
  }
}
