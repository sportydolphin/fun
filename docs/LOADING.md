# Loading

What a cold load of `/wpbl` does, in order, and the file that owns each step. **Read this before
proposing or building anything that touches loading speed.** On Nov 18, 2026 a review proposed five
things that already existed (the budgets, early reads, the chunk preload, the font subset, the split
Supabase client), and each cost a round of measuring before it was found. If an idea is below,
tighten or extend what is there.

## The sequence

| Step | What happens | Owner |
|---|---|---|
| 1. HTML | The entry stylesheet is inlined, so the first paint waits on nothing past the HTML. | [`scripts/vite-plugin-inline-css.mjs`](../scripts/vite-plugin-inline-css.mjs) |
| 2. Head scripts | Theme, desktop scale and text size stamped before paint; `/` resolved to the reader's default section (`window.__sdOpens`). | `index.html`, first inline script |
| 3. Early reads | Teams, games, players and the site schedule start at once on every WPBL page; Home adds nine more at low priority. Signed-out only. The client claims each by exact URL. | [`src/lib/earlyReads.ts`](../src/lib/earlyReads.ts), [`src/lib/edgeFetch.ts`](../src/lib/edgeFetch.ts) |
| 4. Preloads | The entry, the WPBL chunk and everything they import are `modulepreload` links; MLB's sit inert in `<template>` until the `/mlb` function unwraps them. The logo is high priority, the font is preloaded. | [`scripts/vite-plugin-wpbl-preload.mjs`](../scripts/vite-plugin-wpbl-preload.mjs) |
| 5. Static page | The toolbar (same sizes as the real one) and the opened tab's title, where the loaded page draws them. The site description shows only without JavaScript or after a failed load. | `index.html`, the `.sd-bar` and `.sd-frame` styles and script; pinned in [`pwaShell.test.ts`](../src/__tests__/pwaShell.test.ts) |
| 6. First render | Waits up to 3s for the WPBL chunk, then renders it without a Suspense frame. | [`src/main.tsx`](../src/main.tsx), [`src/sectionLoad.ts`](../src/sectionLoad.ts) |
| 7. Skeletons | Each tab draws its loaded layout empty, real titles included. | [`src/CLAUDE.md`](../src/CLAUDE.md), "Loading states" |
| 8. After the data | The other tabs, Game Center and the player card are warmed once the section's data is in, not before. | `usePreloadGameDetail` in [`WpblApp.tsx`](../src/wpbl/WpblApp.tsx) |

## What is kept out of the first load

- **The auth client**, unless the reader may be signed in (a stored session, or an OAuth or email
  link answer in the address). [`src/lib/supabase.ts`](../src/lib/supabase.ts), pinned in
  `src/lib/__tests__/supabaseAuthLazy.test.ts`. Realtime, storage and the functions client never
  were in it.
- **The search parser** (`league/finderParse.ts`, `league/finder.ts`), the glossaries (only the two
  rules pages build their FAQ markup from them), and the owner's winners poster.
- **The font's unused OpenType features and weights under 300.** [`scripts/subset-inter.mjs`](../scripts/subset-inter.mjs)
  (`npm run subset-font`) says which features stay; a new `font-feature-settings` needs adding there.

## Checks and tools

- **`npm run size`**: the brotli budgets in [`.size-limit.js`](../.size-limit.js), run in CI. The
  first load is held to about 4% headroom. See [CI.md](CI.md#bundle-budgets).
- **`npm run analyze`**: the production build plus a printed list of every module in the first load,
  largest first, and a treemap at `node_modules/.cache/analyze/stats.html`.
- **`npm run sweep -- --shift`**: no loading state may move anything. See [`src/CLAUDE.md`](../src/CLAUDE.md).
- **`/admin`**: real readers' load timings (`src/lib/webVitals.ts`). The best guide to what to fix.

## Measuring

Measure against **https://sportydolphin.fun**, with Chrome throttled (for example 150ms latency,
1.6 Mbps down, 4x CPU through the DevTools protocol), and read the resource timings. Do not draw
conclusions from `vite preview` alone. It serves HTTP/1.1, so Chrome opens six connections and every
file queues (a 3 KB logo there "arrives" at 4.5s), and it has no `/api/sb` edge cache, so every
early read misses and the client asks again. Use it for the order things start in, not for when they
finish. `?devSlowMount` and `?devSlow` on the dev server hold the static page and the skeletons on
screen for checking their layout ([`src/dev/slowLoad.ts`](../src/dev/slowLoad.ts)).
