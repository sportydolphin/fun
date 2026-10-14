# CI and the test loop

What runs on a pull request, what each check is protecting, and what to do when one goes red.
Read this before changing `.github/workflows/ci.yml`, `vite.config.js`'s `test` block,
`eslint.config.js`, or `scripts/layout-sweep.mjs`.

## The gate

`main` takes changes only through a pull request (`.github/rulesets/main-pull-requests.json`),
squash-merged, and Cloudflare deploys whatever lands. The ruleset requires two checks **by name**:

| Check | Job in `ci.yml` | What it runs | Typical time |
|---|---|---|---|
| `check` | `check` | `npm ci`, typecheck, lint, the tests, the production build, then the code the build never sees (below) | about 3 min |
| `layout` | `layout` | nothing itself: passes only if every `layout` slice did | seconds |

`layout 1/8` to `layout 8/8` are the layout sweep split by route, run in parallel, and `layout
experiments` sweeps the flag-gated routes beside them in about a minute. Four slices took about 9
minutes each on Oct 14, 2026, nearly all of it the sweep's fixed waits; eight slices, and the
loading-shift check at the default text size only, brought that down without shortening a wait.
The slices are uneven: on the run that merged that change they took from 2m21s to 5m44s, and the
slowest one sets the pull request's time, so a UI pull request takes about 6 minutes. The `layout` job exists because a matrix reports one check per slice under its own
name, and the ruleset can only require a fixed name. It runs under `always()`: a job whose needs
failed is otherwise skipped, and a skipped required check counts as passing. **Rename a job and
you rename the check the ruleset waits for**, so every pull request waits forever.

**A pull request that touches no UI skips the sweep.** The `changes` job lists the pull request's
files, and if every one is under `docs/`, `scripts/`, `.github/` or `supabase/`, or ends in `.md`,
each slice skips its steps and reports success, so `layout` goes green with `check` in about 3
minutes. Three paths in those folders always sweep: `scripts/layout-sweep.mjs`,
`scripts/fixtures/`, and `.github/workflows/ci.yml`. Anything else, a new top-level folder included,
counts as UI until the list says otherwise. A renamed file counts under its old name too, and a push
to `main` always sweeps. The slices skip their steps rather than the whole job on purpose: a skipped
job fails the `layout` test, and a required check that never reports leaves the pull request waiting.

**The lockfile.** Every workflow runs Node 24 with npm 11, `.nvmrc` says 24, and `devEngines` in
package.json makes any other npm refuse at install with `EBADDEVENGINES`. That alone did not fix
Oct 14, 2026, when every check failed in seconds on `Missing: @emnapi/core from lock file`: npm on
Windows leaves `@napi-rs/wasm-runtime`'s optional `@emnapi/core` and `@emnapi/runtime` peers out of
the lockfile's top level, and npm on Linux requires them, so any `npm install` on a Windows machine
broke CI again. Both are now devDependencies, which puts them in the top level on every platform;
nothing imports them, so knip is told to ignore them. Another `Missing: X from lock file` is the
same bug: add X to devDependencies the same way.

**A branch is kept current by `pr-sync.yml`.** The ruleset does not require a branch to be up to
date, so after each pull request lands that workflow merges `main` into every open pull request set
to auto-merge (their checks re-run on the result), and comments on any that now conflict, since a
conflicting pull request otherwise waits on auto-merge with no notice. It merges rather than
rebases, so a local copy of the branch needs a `git pull` before its next push.

**Two TypeScripts are installed, on purpose.** `npm run typecheck` runs TypeScript 7, the native
compiler, installed as `typescript-7` (an npm alias): it checks the project in about 2 seconds
against 13 for TypeScript 6. `typescript` itself stays at 6.0 because typescript-eslint loads the
compiler's JavaScript API to parse, TS 7 has none, and typescript-eslint 8 accepts nothing past
6.0. Your editor uses 6.0 too. Both read the same `tsconfig.json`, so it must satisfy both: no
`moduleResolution: "node"`, which 6.0 deprecates and 7 removed. When typescript-eslint supports 7,
drop the alias and point `typescript` at 7.

After the build, `check` looks at the three kinds of code that deploy or run somewhere other than
the site, each of which used to fail only there:

- **Pages Functions** (`npm run check-functions`): bundled the way Cloudflare bundles them. `tsc`
  reads `functions/` already, but cannot see an import that drags in a Vite asset.
- **Cron scripts**: `node --check` on every `scripts/*.mjs`, and an esbuild bundle of every
  `scripts/*.ts`. Lint and `tsc` skip `scripts/` entirely.
- **Edge functions**: `deno cache` resolves each `supabase/functions/*/index.ts` and everything it
  imports, which is how the missing-`.ts` trap in CLAUDE.md now fails on the pull request instead of
  at `supabase functions deploy`. It is not `deno check`: Deno's strict mode reports ten disagreements
  between the supabase-js types and the ingest's row shapes, and those are their own piece of work.

Last, `check` runs the dead-code report (`npm run knip`), which never fails the job: see "Dead code"
below.

Other checks on a pull request:

- `Cloudflare Pages`: builds a preview of the branch. Useful, not required.
- `Supabase Preview`: skipped; there is no branch database.
- There is deliberately **no** `Workers Builds` check. The production Worker builds `main` only;
  see "Cloudflare builds" below.

Open a pull request with `gh pr create --fill && gh pr merge --auto --squash`. It merges itself
once both required checks pass. The title and body become the commit on `main`, so they follow
the commit-message rule in CLAUDE.md (why, not what; no em dashes).

## The tests

`npm run test` is Vitest, about 22 seconds for the whole suite locally (it was 87 before Oct 9,
2026). Two settings in `vite.config.js` carry most of that, and both have traps:

- **Two environments.** `*.test.tsx` runs in jsdom; `*.test.ts` runs in plain Node, which skips
  building a browser for the two thirds of the suite that is pure logic. A `.ts` test that needs
  `window`, `history` or `localStorage` says so in its first line:
  `// @vitest-environment jsdom`. Forgetting it fails loudly (`window is not defined`), never
  silently.
- **MUI is pre-bundled** (`test.deps.optimizer`), so each test file loads one file instead of
  hundreds. The cost: a test cannot `vi.mock` a single MUI module. None does; if one ever needs
  to, take that package out of `MUI_DEPS`.

Setup files: `src/test/setup.ts` (both environments: jest-dom, a storage shim for Node 25,
`matchMedia` and `ResizeObserver` stubs) and `src/test/setupDom.ts` (jsdom only, see flakes).

The tests run against placeholder Supabase settings (`test.env`), never the real project, so no
test may need `.env`. A test that needs data mocks the client or the module.

## Flaky tests

A flake fails CI on a change that cannot have caused it, and teaches everyone to re-run instead
of read. Two kinds have bitten this suite, both timing:

- **Anything the app starts and nothing awaits.** Game Center preloads the win probability chart
  with a fire-and-forget `import()`. A test file can finish while it is in flight, and the run
  fails with `Closing rpc while "fetch" was pending` while every test passes. `setupDom.ts` loads
  that module up front; add any new preloaded chunk there.
- **A fixed sleep standing in for an event.** jsdom delivers `popstate` on a timer, so a test that
  calls `history.back()` and sleeps 20ms loses the race under load. Use `traverse()` from
  `src/test/history.ts`, which waits for the event.

To hunt one, loop the suite and stop on the first real failure. Match the summary line, not the
word "failed", which the app's own logs print:

```bash
for i in $(seq 12); do npx vitest run > vt.log 2>&1; grep -qE "Tests .*failed|Errors " vt.log && break; done
```

## Lint

`npm run lint` must print nothing. `react-hooks/exhaustive-deps` is an **error**: as a warning
it sat at 45 in every run, where a new one was invisible, and two of the 45 were real stale-data
bugs. A dependency left out on purpose gets
`// eslint-disable-next-line react-hooks/exhaustive-deps` with the reason on the line above
(usually "keyed on the id, not the object, which is rebuilt on every poll"). For a hook with no
dependency list at all, the directive goes above the hook call, not above its closing brace.
`npm run lint -- --fix` removes unused imports; an unused variable is left for a person.

## Dead code

`npm run knip` lists unused files, exports and dependencies across `src/`, `functions/`,
`scripts/`, `shared/` and the edge functions; `knip.jsonc` says what runs without being imported
(Pages Functions route by path, each edge function is its own entry, the cron jobs are run by
name). It was clean when it went in, on Oct 14, 2026, after a first pass removed what it found:
a module from the deleted toys, the Hall of Firsts' read and logic (its card came off Home on
Aug 18), and some forty exports nothing imported.

The CI step **reports and never blocks** (`continue-on-error`). A change that orphans an export
leaves it for the next change to delete rather than holding itself up, so a yellow step on a
pull request is a to-do, not a failure. Keep it at zero all the same: a list that is never empty
is a list nobody reads, which is how the lint warnings got to 45.

Two things it cannot see, so each carries a JSDoc tag instead of an entry in a list:

- **Kept on purpose.** `@public` on the export, with the reason in the same comment (the Discord
  funnel RPC kept for its history, the recap outlet's sitemap kept for the day the feed's window
  closes, a compile-time assertion type that is exported only so it is not an unused local).
- **Two names for one thing.** `@alias` on the second (`WPBL_PLAYERS_INDEX`), or knip reports
  the pair as a duplicate export.

Test files count as entries, so an export used only by a test is not reported. That is the one
gap: a module whose only importer is its own test is dead code knip will call alive.

## The layout sweep

`scripts/layout-sweep.mjs` drives Chrome against the dev server and checks four things at four
widths (375, 760, 960, 1440) and both text sizes: text that overflows its box, anything that
moves when a page's skeleton is replaced by its content (the loading-states rule in CLAUDE.md;
default text size only, since Large text breaks overflow and almost never a skeleton's size),
every outline under 3:1 against what is behind it (the borders rule), and the axe-core rules in
`AXE_RULES`: text contrast, and a name on every control, link, image and input (the
accessibility rule). The last two run in the light theme and then the dark one on the same load.
A border finding prints its ratio, the colour and the start of the box's text; an axe finding
prints the rule, the element's HTML and axe's own explanation, which is usually enough to find
the component. A rule goes into `AXE_RULES` only once it reads clean on every page.

In CI it runs in **replay** mode: every response comes from
`scripts/fixtures/layout-sweep/`, recorded from real data, with the clock frozen at the moment of
recording (`meta.json`). It is one gzipped file per response, named by a hash of the request, plus
`images.json`, so two pull requests that record different reads touch different files. It was one
`.json.gz` until Oct 2026, and every pair of branches that re-recorded it conflicted on a binary.
A request the fixture lacks fails the job rather than sweeping an empty page, and the log ends
with the exact command to record what is missing. **Change what a page fetches and you re-record**,
against real data (needs `.env`), either on your machine or with the **Sweep: record** workflow,
which records on a runner and commits to the branch (`gh workflow run sweep-record.yml -f
branch=<branch> -f routes=<routes>`, routes as the log printed them, `all` for a full record):

```bash
npm run sweep:record
```

and commit the new fixture in the same pull request.

Adding one page, or one read on one page? Merge instead, which records only what is missing and
keeps the fixture's clock, so the pull request does not also carry a day of unrelated data changes:

```bash
npm run sweep:record -- --merge --routes mlb/compare
```

`scripts/fixtures/layout-sweep-baseline.json` lists findings accepted as known. **It is empty**
and should stay that way: fix a finding rather than baseline it.

Flags worth knowing:

| Flag | Does |
|---|---|
| `--replay` | serve from the fixture, network shut (what CI does) |
| `--shift` | also run the loading-shift check (default text size only) |
| `--record --merge` | add what the named routes fetch to the fixture, at its own clock |
| `--baseline` | fail only on findings not in the baseline file |
| `--routes a,b` | only these routes (leading slash optional, for Git Bash) |
| `--shard i/n` | every n-th route from the i-th (CI runs `1/8` to `8/8`) |
| `--experiments` | with the experiments flag on; CI sweeps the flagged routes this way in the `layout experiments` slice |
| `--cpu 4` | slow Chrome down to CI's speed |
| `--shots dir` | save the before and after frame of every case that shifts |

The sweep needs a dev server built the way CI builds it. With a real `.env` the app talks to the
real project; for a replay, start one with the placeholder settings:

```bash
VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_ANON_KEY=sweep-anon-key VITE_VAPID_PUBLIC_KEY=sweep-vapid-key npx vite --port 5180
npm run sweep -- --base http://localhost:5180 --replay --shift --baseline
```

## When the layout job fails and your machine is clean

This happens, because CI's runner is several times slower than a desktop and catches loading
phases a fast machine skips. It has never yet been noise: each one was a real jump a reader on
a slow phone would see, or the sweep misreading something, which is a sweep bug to fix.

1. Download the `sweep-shots-<n>` artifact from the failed run. It holds the before and after
   frame of every case that shifted.
2. Reproduce with `--cpu 4` on the failing routes.
3. If the frames show nothing moving, the sweep is wrong. Fixed so far: repeated text paired by
   document order (it pairs nearest copies now), text under an open modal (`aria-hidden`, now
   skipped), a fixed dialog measured against the page instead of the screen, and snapshots taken
   mid-transition.

## Cloudflare builds

Two Cloudflare projects deploy this repo, both named `fun`:

- the **Worker** (route `*.sportydolphin.fun/*`), which serves production, deploying `main` with
  `npx wrangler deploy`;
- the **Pages project** (`fun-ege.pages.dev`), which builds every branch and gives each pull
  request its preview.

The Worker's "Builds for non-production branches" is **off**, since Oct 9, 2026. A branch build
runs `npx wrangler versions upload`, which needs a Wrangler config the repo does not have, so
with it on every pull request carried a red check that meant nothing. Turn it back on only with
a Wrangler config in the same change.
