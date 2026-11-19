// Inline the entry's stylesheet into index.html instead of linking it.
//
// It is about 3 KB (the Inter face, the root type and chrome scales, the page colors), and as a
// <link> it is render-blocking: nothing paints until it arrives. It is requested in the same breath
// as the hundred module preloads, so on a slow phone it waited its turn among them. Measured on
// production with Chrome throttled to 1.6 Mbps and 4x CPU (Nov 18, 2026), the 1 KB response took
// 1.2s and held the first paint, index.html's static toolbar and title, to 1.55s. Inline, the first
// paint needs nothing past the HTML.
//
// Only a stylesheet linked from index.html is inlined, and only when it is small: a lazy chunk's CSS
// (the photo cropper's) stays a file its chunk loads. The file is still emitted, so a page cached
// from before this build, which links it by name, still finds it.
const MAX_INLINE = 16 * 1024

export function inlineEntryCss() {
  return {
    name: 'inline-entry-css',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const bundle = ctx.bundle
        if (!bundle) return html
        return html.replace(/<link rel="stylesheet"(?: crossorigin)? href="\/([^"]+\.css)">/g, (tag, file) => {
          const asset = bundle[file]
          if (!asset || asset.type !== 'asset') return tag
          const css = typeof asset.source === 'string' ? asset.source : new TextDecoder().decode(asset.source)
          if (css.length > MAX_INLINE) return tag
          return `<style data-inlined="${file}">${css}</style>`
        })
      },
    },
  }
}
