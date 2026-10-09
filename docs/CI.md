# CI and the test loop

What runs on a pull request, what each check is protecting, and what to do when one goes red.
Read this before changing `.github/workflows/ci.yml`, `vite.config.js`'s `test` block,
`eslint.config.js`, or `scripts/layout-sweep.mjs`.

## The gate

`main` takes changes only through a pull request (`.github/rulesets/main-pull-requests.json`),
squash-merged, and Cloudflare deploys whatever lands. The ruleset requires two checks **by name**:

| Check | Job in `ci.yml` | What it runs | Typical time |
|---|---|---|---|
| `check` | `check` | `npm ci`, typecheck, lint, the tests, the production build | about 3 min |
| `layout` | `layout` | nothing itself: passes only if all four `layout i/4` jobs did | seconds |

`layout 1/4` to `layout 4/4` are the layout sweep split by route, run in parallel, about 3 to 4
minutes each. The `layout` job exists because a matrix reports one check per slice under its own
name, and the ruleset can only require a fixed name. It runs under `always()`: a job whose needs
failed is otherwise skipped, and a skipped required check counts as passing. **Rename a job and
you rename the check the ruleset waits for**, so every pull request waits forever.

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

## The layout sweep

`scripts/layout-sweep.mjs` drives Chrome against the dev server and checks two things at four
widths (375, 760, 960, 1440) and both text sizes: text that overflows its box, and anything that
moves when a page's skeleton is replaced by its content (the loading-states rule in CLAUDE.md).

In CI it runs in **replay** mode: every response comes from
`scripts/fixtures/layout-sweep.json.gz`, recorded from real data, with the clock frozen at the
moment of recording. A request the fixture lacks fails the job rather than sweeping an empty
page. **Change what a page fetches and you re-record**, against real data (needs `.env`):

```bash
npm run sweep:record
```

and commit the new fixture in the same pull request.

`scripts/fixtures/layout-sweep-baseline.json` lists findings accepted as known. **It is empty**
and should stay that way: fix a finding rather than baseline it.

Flags worth knowing:

| Flag | Does |
|---|---|
| `--replay` | serve from the fixture, network shut (what CI does) |
| `--shift` | also run the loading-shift check |
| `--baseline` | fail only on findings not in the baseline file |
| `--routes a,b` | only these routes (leading slash optional, for Git Bash) |
| `--shard i/n` | every n-th route from the i-th (CI runs `1/4` to `4/4`) |
| `--experiments` | with the experiments flag on; CI sweeps the flagged routes this way in shard 1 |
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
