// Emit a <link rel="modulepreload"> for the WPBL section's chunk (and the chunks it
// statically imports) into index.html.
//
// WpblApp is loaded with React.lazy, so the browser cannot discover it from the HTML: it
// only learns the URL once the entry chunk has downloaded AND executed far enough to hit
// the dynamic import. Measured on production that was a hard two-stage waterfall — the
// entry chunk finished at 317 ms and the WPBL chunk did not even start until 362 ms — and
// on a phone, where both the download and the parse are several times slower, the gap is
// proportionally worse. A modulepreload link moves the request up beside the entry chunk
// so the two download together.
//
// This goes into the one index.html every route shares, because /wpbl is where almost all
// traffic lands (`/` redirects there, it is the canonical URL, and it is the PWA's start_url).
// The /mlb Pages Function (functions/mlb/index.ts) strips the links back out of the page it
// serves, keyed on the `data-section` attribute below: an /mlb visitor used to download the
// whole WPBL section at first paint (WpblApp alone is ~220 KB, ~400 KB with what it imports),
// in parallel with the MLB chunks that page actually needed. Rename the attribute here and that
// strip silently stops matching, so src/mlb/__tests__/routes.test.ts pins the pair.
const WPBL_ENTRY = 'src/wpbl/WpblApp.tsx'

// THE SAME FOR /mlb, INERT EVERYWHERE ELSE. The MLB section has the same two-hop waterfall (the
// entry runs, then asks for MlbStats and the landing view's chunk), but index.html cannot carry
// live links for both sections or every /wpbl reader pays for MLB. So the MLB links are written
// inside <template> elements, whose contents a browser parses and never fetches, and the /mlb
// Pages Function unwraps the shell's block plus the one for the view that address opens
// (functions/mlb/index.ts, item 5). Each key here is a `data-view` that function looks up; the
// views mirror `preloadMlbViewFor` in src/mlb/views/lazyViews.ts, and `scores` has no block
// because that view is inside MlbStats's own chunk.
const MLB_SHELL = 'src/MlbStats.tsx'
export const MLB_VIEWS = {
  home: 'src/mlb/views/HomeView.tsx',
  standings: 'src/mlb/views/Standings.tsx',
  teams: 'src/mlb/views/TeamsView.tsx',
  leaderboard: 'src/mlb/views/LeaderboardView.tsx',
  stats: 'src/mlb/views/StatsView.tsx',
  viz: 'src/mlb/views/VizView.tsx',
  search: 'src/mlb/views/SearchView.tsx',
  player: 'src/mlb/views/MlbPlayerDetail.tsx',
  game: 'src/mlb/views/LiveGameCenter.tsx',
}

export function wpblPreload() {
  return {
    name: 'wpbl-preload',
    // Run after Vite has injected the entry <script>, so the preload links land after it in
    // <head> and the entry chunk keeps first claim on the connection.
    enforce: 'post',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        const bundle = ctx.bundle
        if (!bundle) return

        // Match on the chunk's module list, not its facadeModuleId.
        //
        // facadeModuleId is only set while a chunk is a thin re-export of one module, and it
        // silently became null the moment WpblApp itself grew dynamic imports: the section
        // still had its own chunk, but a facadeModuleId lookup stopped finding it. moduleIds
        // is the structural fact — which modules actually ended up in this chunk.
        const entry = Object.values(bundle).find(
          c => c.type === 'chunk' && !c.isEntry &&
            (c.moduleIds ?? []).some(id => id.replace(/\\/g, '/').endsWith(WPBL_ENTRY)),
        )
        // Fail the build rather than quietly shipping the slow version. Losing this preload
        // costs every visitor a serialized round trip and is invisible at runtime, so a
        // chunking change that hides the WPBL chunk should stop a deploy and get looked at.
        // (An earlier revision only warned here, and that is exactly how it slipped.)
        if (!entry) {
          throw new Error(
            `[wpbl-preload] no chunk contains ${WPBL_ENTRY}. The section's code-splitting ` +
            `changed shape — update this plugin's lookup, or the site loses its WPBL preload.`,
          )
        }

        // The section's own chunk plus everything it pulls in synchronously (today that is
        // the shared team-constants chunk). Preloading only the section chunk would just
        // move the waterfall one level down. The app's entry chunk is among those static
        // imports and is dropped here — it already has a <script> tag in this same <head>.
        const files = [entry.fileName, ...(entry.imports ?? [])].filter(
          f => !(bundle[f]?.type === 'chunk' && bundle[f].isEntry),
        )
        const link = (fileName, section) => ({
          tag: 'link',
          attrs: { rel: 'modulepreload', crossorigin: true, href: `/${fileName}`, 'data-section': section },
        })
        const wpbl = files.map(f => ({ ...link(f, 'wpbl'), injectTo: 'head' }))

        // MLB: every chunk the landing needs before it can draw, transitively, minus the entry.
        // A missing chunk fails the build for the same reason as above. A view's block repeats
        // nothing the shell's already names, since the function unwraps both.
        const chunkOf = module => Object.values(bundle).find(
          c => c.type === 'chunk' && !c.isEntry &&
            (c.moduleIds ?? []).some(id => id.replace(/\\/g, '/').endsWith(module)),
        )
        const closure = module => {
          const start = chunkOf(module)
          if (!start) throw new Error(`[wpbl-preload] no chunk contains ${module}.`)
          const seen = new Set()
          const visit = f => {
            const c = bundle[f]
            if (seen.has(f) || c?.type !== 'chunk' || c.isEntry) return
            seen.add(f)
            for (const i of c.imports ?? []) visit(i)
          }
          visit(start.fileName)
          return [...seen]
        }
        const template = (fileNames, view) => ({
          tag: 'template',
          attrs: view ? { 'data-section': 'mlb', 'data-view': view } : { 'data-section': 'mlb' },
          children: fileNames.map(f => link(f, 'mlb')),
          injectTo: 'head',
        })
        const shellFiles = closure(MLB_SHELL)
        const mlb = [template(shellFiles)]
        for (const [view, module] of Object.entries(MLB_VIEWS)) {
          const own = closure(module).filter(f => !shellFiles.includes(f))
          if (own.length) mlb.push(template(own, view))
        }
        return [...wpbl, ...mlb]
      },
    },
  }
}
