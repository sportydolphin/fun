// Subset the Inter variable font to the characters this site can actually render.
//
// The upstream file (scripts/fonts/InterVariable-full.woff2) carries every script Inter
// supports — Cyrillic, Greek, Vietnamese, the full symbol set — about 344 KB that is
// preloaded at the highest priority on every cold load and, being woff2, is already
// compressed so the CDN's brotli does nothing for it. It was the single largest asset on
// the page and it competed for bandwidth with the entry chunk.
//
// The subset below keeps Latin (through Extended-A, so future roster names with Central
// and Eastern European diacritics still hit the real font), the punctuation and math the
// UI actually uses, and the geometric shapes/arrows that appear as literal glyphs in the
// components. Emoji are deliberately excluded — Inter has no emoji glyphs, so those
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
const OUT  = path.join(ROOT, 'public/fonts/InterVariable.woff2')

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => String.fromCodePoint(from + i)).join('')

const KEEP = [
  range(0x0020, 0x007e), // Basic Latin (printable ASCII)
  range(0x00a0, 0x00ff), // Latin-1 Supplement — é á ï í è appear in live roster/PBP data today
  range(0x0100, 0x017f), // Latin Extended-A — headroom for future signings (č ł ő š ž ...)
  // Only the non-Latin glyphs the UI actually renders, enumerated rather than taken as
  // whole Unicode blocks: the arrow/math/shape blocks cost ~35 KB for ~600 code points of
  // which the components use about 30. Combining diacritics (U+0300–036F) are deliberately
  // absent too — they add 15 KB of mark-attachment data, and every accented string in the
  // feed and the roster arrives precomposed (NFC), so nothing decomposed reaches the font.
  '‐‑–—‘’“”†•…‹›⁄',        // punctuation
  '€™⅓⅔½¼¾°±×÷·',            // currency, fractions, math punctuation
  '→↗↔↑↓←↳↻⇆↩⇄⟳',         // arrows used as literal glyphs in components
  '≈≥≤−∞√⊂∝⋮⊙',              // math
  '─═│▲▼▾●▶◀▸★☆✓✔✕✖✗✘✎♥', // box drawing, shapes, ticks
].join('')

const src = await readFile(SRC)
// Keep the weight axis intact: the theme uses 100–900 from this one file, and dropping
// fvar/gvar would collapse every weight to a single master.
const out = await subsetFont(src, KEEP, { targetFormat: 'woff2', variationAxes: { wght: { min: 100, max: 900 } } })
await writeFile(OUT, out)

const pct = (1 - out.length / src.length) * 100
console.log(
  `InterVariable: ${(src.length / 1024).toFixed(0)} KB → ${(out.length / 1024).toFixed(0)} KB ` +
  `(-${pct.toFixed(0)}%, ${[...new Set(KEEP)].length} code points)`
)
