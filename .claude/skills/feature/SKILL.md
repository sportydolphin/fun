---
name: feature
description: Build a new feature, page, board or route on the site through the project's checklist, so nothing that fails silently in production (routes, redirects, SEO, fixtures, changelog, architecture docs) is missed. Use when the user asks to add, build, make or ship a new feature, page, tab, stat or chart.
---

# Feature

Most of what breaks a new feature here works perfectly in `npm run dev` and fails in production.
This is the list of those, in the order the work hits them.

## 1. Before writing code

- Check ROADMAP-PRIORITIES.md and the open pull requests (the SessionStart hook lists them): the
  feature may be planned with decisions already made, or half built on a branch.
- Read the scoped `CLAUDE.md` for every directory you will touch, and the guarding doc in `docs/`.
- WPBL and MLB never import each other. Shared UI goes in `src/ui/`, league-neutral logic in
  `src/league/`.
- If the scope or the look is unclear, ask once, with a recommendation.

## 2. While building

- **Data.** WPBL reads follow src/wpbl/CLAUDE.md: `fetchAllPaged` with an `.order()` for every
  row, `cut` to the season before summing, schedule passed to every aggregate, PA gates via
  `plateAppearances()`, names from `fetchWpblAllPlayers`.
- **Schema.** `npm run migrate -- new "<what>"`, never a loose `.sql`. A browser `.upsert()` needs a
  SELECT policy; a new `public` function is callable by `anon` (scripts/migrations/CLAUDE.md).
- **UI.** The three rules in src/CLAUDE.md: loading state is the loaded page drawn empty, outlines
  3:1 in both themes, no `opacity` on text. Names shorten to "F. Last" through `NameText` or
  `nameStages`, never by character count. Lengths in `rem` / `chromePx()`. Links via `linkTo()`.
  Phone layout via `usePhoneLayout()`.
- **Copy.** Labels, not narration; definitions in an `InfoDot`. No em dashes, American spelling,
  ⚾ for WPBL, no Yankees in sample data.

## 3. A new route

All of these, or it 404s in production (functions/CLAUDE.md):

- two lines in `public/_redirects` (the `200` rewrite to `/` and the trailing-slash `301`);
- a WPBL tab also needs `src/wpbl/routes.ts` and `src/seo.ts`; `routes.test.ts` pins all four;
- a new Pages Function also needs a `public/_routes.json` entry;
- the sitemap is generated (`npm run sitemap`), never hand-edited.

## 4. Before calling it done

- `npm run typecheck`, `npm run lint` (prints nothing), `npx vitest related --run <files>`, and new
  tests for any logic worth pinning.
- Changed what a page fetches: `npm run sweep:record -- --merge --routes <routes>` and commit the
  fixture. Then `npm run sweep -- --replay --shift --routes <routes>` clean.
- Look at it in the preview at 375 and 1440, light and dark, and send a screenshot.
- `npm run size` if it adds a dependency or a heavy module to the entry chunk.
- Bump `APP_VERSION` in `src/version.ts` and add an entry at the top of `src/changelog.ts` for a
  reader-visible change.
- Update ARCHITECTURE.md for a new table, workflow, edge function, cron job or integration.
- Ship only when asked, through the `ship` skill. Stop the dev servers you started.
