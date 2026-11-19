// `npm run analyze`: the production build, plus two reports on what it ships. Its own config so
// the deploy build never loads the visualizer, and its own output folder so nothing here can be
// mistaken for dist/ (which Cloudflare deploys).
//
// 1. A treemap of every chunk and the modules in it, written to node_modules/.cache/analyze/.
// 2. THE FIRST LOAD, printed: every module in the chunks a /wpbl reader fetches before Home can draw
//    (the entry's static imports and WpblApp's, which is what index.html preloads), largest first.
//    The treemap shows everything, and most of everything is lazy; this is the part a phone pays
//    for up front. The search parser sat in it at 135 KB until Nov 18, 2026, under the size budget's
//    headroom, and finding it took a hand-written version of this.
//
// Sizes in the printed list are each module's code as rendered into its chunk, before minifying
// (Rolldown's renderedLength), so they rank modules rather than predict bytes on the wire: the total
// runs about twice the files' size. `npm run size` measures what is sent, brotlied.
import { visualizer } from 'rollup-plugin-visualizer'
import base from '../vite.config.js'

const OUT = 'node_modules/.cache/analyze'
const WPBL_ENTRY = 'src/wpbl/WpblApp.tsx'
const SHOW = 40

const norm = id => {
  const s = id.split('\\').join('/')
  const at = s.indexOf('/node_modules/')
  if (at >= 0) {
    const rest = s.slice(at + '/node_modules/'.length).split('/')
    return rest[0].startsWith('@') ? `${rest[0]}/${rest[1]}` : rest[0]
  }
  const src = s.search(/\/(src|shared|scripts)\//)
  return src >= 0 ? s.slice(src + 1) : s
}

function firstLoadReport() {
  return {
    name: 'first-load-report',
    apply: 'build',
    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle).filter(c => c.type === 'chunk')
      const entry = chunks.find(c => c.isEntry)
      const wpbl = chunks.find(c => !c.isEntry && (c.moduleIds ?? []).some(id => id.split('\\').join('/').endsWith(WPBL_ENTRY)))
      if (!entry || !wpbl) {
        this.warn(`first-load report: no ${entry ? WPBL_ENTRY : 'entry'} chunk found`)
        return
      }
      const seen = new Set()
      const visit = name => {
        const c = bundle[name]
        if (seen.has(name) || c?.type !== 'chunk') return
        seen.add(name)
        for (const i of c.imports) visit(i)
      }
      visit(entry.fileName)
      visit(wpbl.fileName)
      const bytes = new Map()
      let total = 0
      for (const name of seen) {
        for (const [id, m] of Object.entries(bundle[name].modules)) {
          const key = norm(id)
          bytes.set(key, (bytes.get(key) ?? 0) + m.renderedLength)
          total += m.renderedLength
        }
      }
      const kb = n => `${(n / 1024).toFixed(1)} KB`.padStart(10)
      const rows = [...bytes].sort((a, b) => b[1] - a[1]).slice(0, SHOW)
      console.log(`\nFirst load on /wpbl: ${seen.size} chunks, ${kb(total).trim()} of code before minifying`)
      console.log(`The ${SHOW} largest (packages summed):`)
      for (const [id, n] of rows) console.log(`${kb(n)}  ${id}`)
      console.log(`\nTreemap: ${OUT}/stats.html\n`)
    },
  }
}

export default {
  ...base,
  build: { ...base.build, outDir: OUT, emptyOutDir: true },
  plugins: [
    ...base.plugins,
    firstLoadReport(),
    visualizer({ filename: `${OUT}/stats.html`, template: 'treemap', gzipSize: true, brotliSize: true }),
  ],
}
