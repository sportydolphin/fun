// Subset the Inter variable font to the characters this site can actually render.
//
// The upstream file (scripts/fonts/InterVariable-full.woff2) carries every script Inter
// supports (Cyrillic, Greek, Vietnamese, the full symbol set), about 344 KB that is
// preloaded at the highest priority on every cold load and, being woff2, is already
// compressed so the CDN's brotli does nothing for it. It was the single largest asset on
// the page and it competed for bandwidth with the entry chunk.
//
// The subset below keeps Latin (through Extended-A, so future roster names with Central
// and Eastern European diacritics still hit the real font), the punctuation and math the
// UI actually uses, and the geometric shapes/arrows that appear as literal glyphs in the
// components. Emoji are deliberately excluded: Inter has no emoji glyphs, so those
// already render from the platform emoji font.
//
// Anything outside the subset is not tofu: browsers fall back per character to the next
// family in the stack (system-ui), so an unforeseen glyph degrades to the system face
// rather than disappearing. That is what makes trimming this safe.
//
// Regenerate with `npm run subset-font` after replacing the upstream file.

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import subsetFont from 'subset-font'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC  = path.join(ROOT, 'scripts/fonts/InterVariable-full.woff2')
// A NEW NAME FOR EVERY NEW FILE. /fonts/* is served `immutable` for a year (public/_headers), so
// Cloudflare's cache and every browser that has the file keep it under its URL for that long: the
// Nov 18, 2026 trim (104 KB to 66 KB) deployed under the old name and the edge went on serving the
// old file. Bump the suffix here, then in index.html's preload and src/styles.css's @font-face
// (pinned together in pwaShell.test.ts).
const OUT  = path.join(ROOT, 'public/fonts/InterVariable-v2.woff2')

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => String.fromCodePoint(from + i)).join('')

const KEEP = [
  range(0x0020, 0x007e), // Basic Latin (printable ASCII)
  range(0x00a0, 0x00ff), // Latin-1 Supplement — é á ï í è appear in live roster/PBP data today
  range(0x0100, 0x017f), // Latin Extended-A — headroom for future signings (č ł ő š ž ...)
  // Only the non-Latin glyphs the UI actually renders, enumerated rather than taken as
  // whole Unicode blocks: the arrow/math/shape blocks cost ~35 KB for ~600 code points of
  // which the components use about 30. Combining diacritics (U+0300–036F) are deliberately
  // absent too: they add 15 KB of mark-attachment data, and every accented string in the
  // feed and the roster arrives precomposed (NFC), so nothing decomposed reaches the font.
  '‐‑–\u2014‘’“”†•…‹›⁄',        // punctuation
  '€™⅓⅔½¼¾°±×÷·',            // currency, fractions, math punctuation
  '→↗↔↑↓←↳↻⇆↩⇄⟳',         // arrows used as literal glyphs in components
  '≈≥≤−∞√⊂∝⋮⊙',              // math
  '─═│▲▼▾●▶◀▸★☆✓✔✕✖✗✘✎♥', // box drawing, shapes, ticks
].join('')

// THE OPENTYPE FEATURES THE SITE USES, and no others. Upstream Inter carries forty: thirteen
// character variants, eight stylistic sets, fractions, superscripts, a slashed zero and more, none
// of which any style here turns on (the one opt-in anywhere is `tabular-nums`, which is tnum). Kept
// whole they were 35 KB of the 104 KB file, and that file is preloaded at the highest priority on
// every cold load. The rest are what text needs to shape correctly: kerning, ligatures and contextual
// alternates, composition and marks for accented names, language forms, and the figure styles.
// Turning a new one on in CSS (`font-feature-settings: 'zero'`) needs it added here first, or it
// silently does nothing.
const KEEP_FEATURES = ['kern', 'liga', 'calt', 'ccmp', 'locl', 'mark', 'mkmk', 'rlig', 'tnum', 'pnum', 'lnum', 'case']

const src = await readFile(SRC)
// The weight axis stays variable, from 300: nothing on the site asks for lighter (src/styles.css
// declares the same range), and dropping fvar/gvar would collapse every weight to one master. The
// optical-size axis stays whole too. Pinning it would cut another 23 KB, but the large titles would
// lose the display cut they draw in now, a visible change rather than a saving.
const out = await subsetFont(src, KEEP, {
  targetFormat: 'woff2',
  keepFeatures: KEEP_FEATURES,
  variationAxes: { wght: { min: 300, max: 900 } },
})
await writeFile(OUT, out)

const pct = (1 - out.length / src.length) * 100
console.log(
  `InterVariable: ${(src.length / 1024).toFixed(0)} KB → ${(out.length / 1024).toFixed(0)} KB ` +
  `(-${pct.toFixed(0)}%, ${[...new Set(KEEP)].length} code points)`
)
