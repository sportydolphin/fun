# Admin analytics: `/admin`

The owner's dashboard for what people actually do on the site: what got clicked, by how
many browsers, trending which way. It exists so answering "is anyone using the tracking
tab?" doesn't mean opening the Supabase SQL editor.

**Built 2026-08-16.** Superseded `docs/ADMIN_ANALYTICS_PLAN.md`.

---

## 1. The shape of it

| Piece | File |
|---|---|
| SQL: seven `security definer` RPCs | [`20260816195705_add_admin_analytics_rpcs.sql`](../scripts/migrations/20260816195705_add_admin_analytics_rpcs.sql) + [`20260820064501_add_admin_wpbl_stats_board_rpc.sql`](../scripts/migrations/20260820064501_add_admin_wpbl_stats_board_rpc.sql) |
| Typed RPC wrappers + pure helpers | [`src/lib/analyticsAdmin.ts`](../src/lib/analyticsAdmin.ts) |
| Helper tests | [`src/__tests__/analyticsAdmin.test.ts`](../src/__tests__/analyticsAdmin.test.ts) |
| The page | [`src/AdminPage.tsx`](../src/AdminPage.tsx) |
| Health + tools it embeds | `useOpsHealth`, `HealthStrip`, `HealthGroup`, `AdminTools` in [`src/AdminPanel.tsx`](../src/AdminPanel.tsx) |
| Group + health tests | [`adminPage.test.tsx`](../src/__tests__/adminPage.test.tsx), [`adminHealth.test.tsx`](../src/__tests__/adminHealth.test.tsx) |
| Route + owner gate | [`src/App.tsx`](../src/App.tsx) |
| Event capture (unchanged) | [`src/lib/analytics.ts`](../src/lib/analytics.ts), [`scripts/create_events.sql`](../scripts/create_events.sql) |

`/admin` is a static SPA route, so `public/_routes.json` needs nothing. That file only
lists paths that hit Cloudflare Functions.

**There is one admin surface.** The old `maxWidth="xs"` dialog off the account menu was
folded into this page (`AdminPanel.tsx` now exports `AdminTools`, the same sections with
the dialog chrome removed); the ⚡ Admin menu item navigates here. Feedback and Users are
still modals, but they're drill-downs opened *from* the page. If you add an admin feature,
it goes on this page. Don't start a second surface.

**Three groups, not one scroll** (Aug 20, 2026). The page had grown to seventeen stacked
cards mixing three unrelated jobs, with the range and league filters at the top implying they
governed all of it. It is now **Audience** (the analytics, and the only group the filters
apply to), **Health** (the four pipelines, one card), and **Tools** (feedback, users, test
push, apps, links). Two rules hold it together:

- **Pipeline health follows you.** `HealthStrip` renders above every group except Health
  itself, because the pipelines are the only thing here that is ever urgent and they used to
  live at the very bottom of the page. It goes quiet on the Health group rather than sitting
  directly above its own detail.
- **A pipeline with no row is `idle`, never `ok`.** "Not yet run" and "ran and was fine" are
  different answers, and collapsing them is how a job that never started reads green. The
  thresholds live in pure `*Status` functions in `AdminPanel.tsx` with tests, because none of
  the four jobs fails loudly and this page is the only place their state is visible.

Because /admin is behind the owner gate, it is the one page that cannot be checked by opening
a browser. `adminPage.test.tsx` is the substitute and is worth keeping honest.

---

## 2. The security model: read this before changing any of it

**Analytics data is readable only by the site owner, and the only thing enforcing that is
the pair of `security definer` + an explicit `is_site_owner()` guard inside each function.**

- `events` is RLS'd to owner-only reads. The RPCs are `security definer` so they can
  out-rank that RLS, which means **each one must re-check `public.is_site_owner()` itself**
  before touching a row. `security definer` without the guard would publish every visitor's
  activity to anyone with an account.
- Every function is `set search_path = ''` (closes definer-path hijacking, hence the
  schema-qualified names throughout) and `revoke all ... from public` +
  `grant execute ... to authenticated`.
- **Never expose this as a view.** A plain Postgres view runs with its owner's rights and
  bypasses the underlying RLS. The WPBL views here (`wpbl_pitching_usage` and friends)
  `grant select to anon, authenticated`; copying that pattern for analytics would make it
  world-readable. If you ever genuinely need a view, it must be
  `with (security_invoker = true)`.
- Some growth counts read tables that are RLS'd to **own rows only**
  (`push_subscriptions`, `user_preferences`). Counting those from the browser silently
  returns *your own* devices. They must come from an RPC.
- The `/admin` route gate in `App.tsx` and `useIsAdmin()` are **cosmetic**. They keep a
  non-owner from seeing a broken page; they are not the boundary.
- `usernames.user_id` is `text` while `events.user_id` is `uuid`. Any join between them
  needs an explicit cast. `user_preferences`, `push_subscriptions`, and
  `wpbl_game_reminders` are all `uuid`: `usernames` is the odd one out.

To verify the boundary still holds: sign out (or sign in as anyone else), open the console,
and call one of the RPCs. It must return a 401 / `not authorized`, not data.

---

## 3. The RPCs

All take `days_back` (clamped 1–365) and an IANA `tz`, and all return `jsonb`.

| Function | Returns |
|---|---|
| `admin_analytics_overview(days_back, tz, league)` | gap-filled daily series, window totals, previous-window totals, fixed today/7d/30d browser counts, `first_event` |
| `admin_event_counts(days_back, league, tz)` | per-event count / browsers / users, plus the same for the previous equal window |
| `admin_wpbl_tab_stats(days_back, tz)` | `props->>'view'` × `props->>'via'` |
| `admin_wpbl_stats_boards(days_back, tz)` | inside the Stats tab: boards, how they were reached, sort columns, filter use |
| `admin_top_players(days_back, lim, tz)` | `props->>'playerId'` joined to `wpbl_players` |
| `admin_discord_funnel(days_back, tz)` | shown / joined / dismissed, **by distinct session** |
| `admin_growth(days_back, tz)` | signups per day, user totals, push subscribers, reminder opt-ins |

Two shared helpers: `admin_event_league(props, path)` and `admin_safe_tz(tz)`.

The existing three indexes on `events` cover every one of these. No new indexes.

`admin_wpbl_stats_boards` was added 2026-08-20 in its own migration
([`20260820064501_add_admin_wpbl_stats_board_rpc.sql`](../scripts/migrations/20260820064501_add_admin_wpbl_stats_board_rpc.sql)),
same security model, and returns one object with four arrays rather than four functions:
it is one card and one question.

---

## 4. Counting rules the numbers depend on

Break one of these and the dashboard keeps rendering. It just lies.

- **"Browsers", never "visitors".** `session_id` is a random per-browser id in
  localStorage. One person on a phone and a laptop is two; clearing site data starts a new
  one. The UI says "browsers" everywhere on purpose.
- **Exclude the `'no-storage'` sentinel from distinct counts.** `analytics.ts` writes that
  literal when localStorage is unavailable (221 rows and counting), so counting it would
  collapse every such visitor into one implausibly busy browser. Those rows still count as
  *events*: they're filtered only out of `count(distinct session_id)`.
- **Funnel rates are over distinct sessions.** `discord_shown` fires on every card mount,
  roughly 3× a session. Raw `joined / shown` reads ~3%; the honest sessions-that-joined ÷
  sessions-that-saw-it number is **8.3%**. Any new funnel does the same.
- **Gap-fill day series in SQL.** Days with zero events have no rows; without
  `generate_series` a quiet week silently compresses and reads as a busy one.
- **League comes from `props->>'league'`, falling back to `path`.** Most events carry the
  prop; the WPBL-only and cross-cutting ones (tab views, player opens, Discord, login)
  don't, and `path` resolves 100% of those. Don't reintroduce an "unlabelled means WPBL"
  assumption: it's true of today's traffic mix, not of the data.
- **Inside the Stats tab, `open` and `return` are per page-load, not per browser.** The tab
  pager unmounts a pane when the reader leaves it, so the flag behind those two names lives at
  module scope in [`StatsView.tsx`](../src/wpbl/StatsView.tsx). A component-scoped flag would be
  born false on every visit and call all of them `open`. It also means the board a `return`
  reports is the default one, not the board that reader left: the unmount takes the axes with
  it. Board counts are therefore arrivals plus deliberate switches, and only the switches say
  what someone chose.
- **Day buckets are timezone-dependent.** The client passes its own IANA zone and the page
  labels the axis with it; an unrecognised zone falls back to UTC rather than raising.
- **`noindex` is written on every route change, never conditionally.** See
  [`src/seo.ts`](../src/seo.ts). In a SPA a tag set for `/admin` persists in `<head>`, so a
  conditional write would leave `noindex` on whatever public page the user visited next.
  `robots.txt` also disallows `/admin`; neither is a security control.

---

## 5. Known limitations

- **History starts 2026-08-05.** The 90-day range is mostly empty and the previous-window
  deltas read "—" for anything longer than the data. The chart trims the leading blank days
  (`trimLeadingEmpty`) and the page says so above the tiles. Both stop mattering on their
  own as the table fills.
- **No retention policy.** `events` grows ~2k rows/day (~700k/year). Fine for Postgres for
  now; a monthly prune of rows older than ~400 days will eventually want writing.
- **Load-on-mount only**, with a manual refresh control. No polling, no realtime.
- Not built, deliberately: retention / returning-browser cohorts, a first-visit → signup
  funnel, and CSV export.
