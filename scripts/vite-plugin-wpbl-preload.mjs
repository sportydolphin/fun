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
// This preloads WPBL on every route, including /mlb. That is deliberate: /wpbl is the
// default section (`/` redirects there, it is the canonical URL, and it is the PWA's
// start_url), so it is the right guess for almost all traffic. The cost of guessing wrong
// is that an /mlb visitor speculatively fetches ~60 KB they may not use; the cost of not
// guessing is a serialized round trip for everyone else. index.html is one static file
// shared by both sections, so there is no place to make this decision per-route without
// pushing asset hashes into the edge function that serves /wpbl.
const WPBL_ENTRY = 'src/wpbl/WpblApp.tsx'

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
        return files.map(fileName => ({
          tag: 'link',
          attrs: { rel: 'modulepreload', crossorigin: true, href: `/${fileName}` },
          injectTo: 'head',
        }))
      },
    },
  }
}
