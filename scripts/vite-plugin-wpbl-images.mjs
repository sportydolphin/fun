import { createReadStream } from 'node:fs'
import { cp, stat } from 'node:fs/promises'
import path from 'node:path'

// Publish two bundled WPBL image folders at STABLE public paths:
//
//   /cards/<slug>.webp      the 1200x630 share card behind og:image
//   /portraits/<slug>.webp  the 512 headshot the card is built from
//
// The app itself doesn't need either: portraits.ts imports the headshots through Vite,
// which emits content-hashed URLs. But the Pages function that writes og:image for a
// shared player link (functions/wpbl/index.ts) runs at the edge with no knowledge of the
// build's hash map, so it needs a name it can predict from the player's name alone.
// Copying rather than moving the folders into public/ keeps the app's hashed,
// immutably-cacheable URLs intact: the two copies are the same bytes serving two
// different cache strategies.
//
// The headshot mirror is no longer what og:image points at (see scripts/
// make-wpbl-share-cards.py for why the square lost that job) and is kept published
// anyway. Links shared before the cards existed named it, and an unfurler that
// revalidates one of those should find the file rather than a 404.
const FOLDERS = [
  { src: 'src/wpbl/cards', prefix: '/cards/', out: 'cards' },
  { src: 'src/wpbl/portraits', prefix: '/portraits/', out: 'portraits' },
]

export function wpblImageAssets() {
  let root = process.cwd()
  let outDir = 'dist'
  let isBuild = false
  return {
    name: 'wpbl-image-assets',
    configResolved(config) {
      root = config.root
      outDir = config.build.outDir
      isBuild = config.command === 'build'
    },
    // Dev has no build output to copy into, so serve the same paths straight from
    // source, or they would 404 locally and silently fall through to the SPA.
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url || '').split('?')[0]
        const folder = FOLDERS.find(f => url.startsWith(f.prefix))
        if (!folder) return next()
        const name = path.basename(decodeURIComponent(url))
        if (!/^[a-z0-9-]+\.webp$/.test(name)) return next()
        const file = path.resolve(root, folder.src, name)
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
      // second copy of every image. Only a real `vite build` publishes them.
      if (!isBuild) return
      for (const folder of FOLDERS) {
        await cp(path.resolve(root, folder.src), path.resolve(root, outDir, folder.out), { recursive: true })
      }
    },
  }
}
