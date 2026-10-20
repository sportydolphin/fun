# Deploy and routing traps

`functions/` is Cloudflare Pages Functions; `supabase/functions/` is Supabase Deno edge functions. This file also covers `public/` (`_redirects`, `_routes.json`, the manifest, the service worker, generated files), because a CLAUDE.md in `public/` would be published to the site. Read it before editing anything there.

- **A signed-out reader's Supabase reads come from Cloudflare's cache, so a database edit can
  take a while to show.** In a built site the client's `fetch` ([`edgeFetch.ts`](../src/lib/edgeFetch.ts))
  sends every signed-out GET of a table in [`edgeTables.ts`](../src/lib/edgeTables.ts) through
  `functions/api/sb`. Tables a daily job writes are held 5 minutes and then served stale for up to
  a day while a refresh runs. Tables a game writes are held 10 seconds while the league is active
  (a game live, or dated within a day) and like the slow ones when it is not. So a hand correction
  out of season can sit unseen behind a stale answer at a quiet location until a reader there
  triggers the refresh; signed in, you read direct and see it at once, which is why it looks fixed
  to you. **A table goes on that list only if every signed-out reader sees the same rows**: the
  cache hands one reader's answer to the next. `npm run dev` never uses it.

- **A new Cloudflare Pages Function also needs a route in `public/_routes.json`.** That
  file is an allow-list. Without an entry the function compiles, uploads, deploys, and is
  never called. **It can only narrow, never widen.** Function routing is by file path, so
  `functions/wpbl/index.ts` serves exactly `/wpbl`; adding `/wpbl/*` to `_routes.json` does
  not make it run on `/wpbl/stats`. Covering a subtree takes a catch-all file
  ([`functions/wpbl/[[tab]].ts`](wpbl/%5B%5Btab%5D%5D.ts), which re-exports the
  handler rather than copying it). This is how the player share-card rewrite quietly stopped
  running the day the WPBL tabs became real paths: the page was fine, only the unfurl was
  wrong.

- **`npx wrangler pages dev dist` is NOT the production runtime.** Production deploys as a
  Worker (the build log says `workers/scripts/fun/versions`). It is still the best local
  check for routing and status codes, but it accepts input the real deploy refuses, so a
  green local run is evidence and not proof. Watch the actual Cloudflare build after a push
  that touches `_redirects`, `_routes.json` or `functions/`, **and watch the one on `main`**:
  the Worker builds `main` only. Until Oct 9, 2026 it also built every PR branch, and those
  builds were red on every PR ever opened: a branch ran `npx wrangler versions upload`, which
  needs a Wrangler config the repo does not have, where `main` runs `npx wrangler deploy`,
  which works it out. "Builds for non-production branches" is now off in the Worker's Build
  settings, so a PR shows no `Workers Builds` check at all, and `Cloudflare Pages` gives each
  PR its preview. Turn it back on and the red check returns, training everyone to ignore the
  one signal this rule is asking you to read.

- **The wildcards in `_redirects` (`/wpbl/players/*`, `/wpbl/games/*`, `/wpbl/compare/*`,
  `/mlb/players/*`) each have a Pages Function standing in front of them** that answers a real
  404 for a slug naming nothing; the MLB one is [`functions/mlb/index.ts`](mlb/index.ts),
  which asks StatsAPI. The original, `/wpbl/players/*`, exists because the valid slugs live in
  the database. What keeps it from being a soft-404 hole is
  [`functions/wpbl/index.ts`](wpbl/index.ts), which resolves the slug against the
  roster and answers a real 404 for anything that names nobody, *before* the rewrite is
  reached. Cloudflare's `*` matches across slashes, so the same check has to reject
  `/wpbl/players/a/b` too. Remove either and every typo under that directory is an indexable
  page again.

- **`_redirects` may only use 200/301/302/303/307/308, and `wrangler pages dev` will not
  tell you.** Cloudflare validates the file at UPLOAD time and rejects the whole thing for
  anything else, which **fails the build and leaves the previous deploy serving**: the site
  does not break, it silently stops updating, which is the worst shape a failure can take.
  `/*  /404.html  404` did this on Aug 21, 2026 after months of working. No rule is needed
  for 404s anyway: once `public/404.html` exists the platform serves it with a 404 status for
  any unmatched path, and the reason unknown URLs used to answer 200 was only that the file
  did not exist. `src/wpbl/__tests__/routes.test.ts` now pins the allowed statuses.

- **A new app route also needs two lines in `public/_redirects`,** and a WPBL tab needs an
  entry in [`src/wpbl/routes.ts`](../src/wpbl/routes.ts) and
  [`src/seo.ts`](../src/seo.ts) besides. `src/wpbl/__tests__/routes.test.ts` pins all four
  together, because three of the four failures are invisible locally. Otherwise it 404s in
  production while working perfectly in dev. Pages used to serve the SPA shell with a 200 for *any*
  unmatched path, which made every typo on the domain an indexable page: Google found
  `/wpbl),and` from a mangled pasted link and indexed it as a real page of the site. So the
  fallback is inverted. `_redirects` lists the app's routes explicitly (a `200` rewrite plus
  a `301` folding the trailing-slash spelling), and `/*` falls through to a real `404.html`.
  Vite serves the shell for everything, so `npm run dev` will never show you the omission.
  Verify with `npx wrangler pages dev dist` after `npm run build`. Rewrite to `/`, never to
  `/index.html`: Pages canonicalizes the latter with a 308, which silently turns every app
  route into a redirect to the home page.

- **`manifest.webmanifest`'s `id` is `/mlb` while `start_url` is `/wpbl`, and that is not a
  bug to fix.** `id` is the installed app's IDENTITY, not a route. Chrome keys an installed
  PWA on it, so "correcting" it does not rename the app, it creates a second unrelated one
  and orphans every existing install, plus (once the Android app ships) the Digital Asset
  Links association built against it. The mismatch is cosmetic and costs nothing; the fix
  costs the installed base. Pinned in `src/__tests__/pwaShell.test.ts`.

- **`public/sw.js` must never cache the app shell.** It caches `offline.html` and three
  images, and serves them only for a navigation that could not reach the network. Widen it
  into a shell cache and the failure is invisible by construction: the app renders fine, it
  is just an old build, for anyone who does not close every tab. Navigations stay
  network-first with nothing written back.

- **`public/icon.svg` is generated**, along with every other published icon, by
  [`scripts/make-brand-icons.py`](../scripts/make-brand-icons.py) from `public/logo.png`. A
  hand-edit is lost on the next run. Change the art, rerun the script, commit the lot.

- **`public/sitemap.xml` is generated.** `npm run sitemap` rebuilds it from the roster (one
  URL per player). A hand-edit is lost on the next run.

- **SEO:** `robots.txt`, `sitemap.xml`, and per-route meta plus JSON-LD via
  [`src/seo.ts`](../src/seo.ts), which runs after React mounts and so never reaches an
  unfurler. Shared player links get their card from [`functions/wpbl/`](wpbl)
  instead, rewriting the tags at the edge; the per-player 1200x630 art it points at is
  generated by [`scripts/make-wpbl-share-cards.py`](../scripts/make-wpbl-share-cards.py) and
  republished at a stable `/cards/<slug>.webp` by a Vite plugin, since the edge has no copy
  of the build's hashed-asset map. MLB player and game links get theirs from
  [`functions/mlb/`](mlb/index.ts) out of the same StatsAPI read that proves the page
  exists, worded by [`src/mlb/ogCard.ts`](../src/mlb/ogCard.ts); the player image is MLB's own
  headshot padded to shape on the club color by MLB's image CDN, so there is no MLB art to
  generate. Both sections rewrite through one helper, [`src/lib/ogTags.ts`](../src/lib/ogTags.ts).
  **og:image must stay 1200x630**: Bluesky reads `og:`
  only, ignores the `twitter:card` hint asking for a square thumbnail, and center-crops
  whatever it gets to one 1.91:1 band. **Search Console is verified**, and Googlebot renders the JS completely,
  so pre-rendering is settled as not needed. The remaining constraint is not code: near-zero
  inbound links, worked from [`docs/BACKLINKS.md`](../docs/BACKLINKS.md).
