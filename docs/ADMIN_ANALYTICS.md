# Admin analytics: `/admin`

The owner's dashboard for what people actually do on the site: what got clicked, by how
many browsers, trending which way. It exists so answering "is anyone using the tracking
tab?" doesn't mean opening the Supabase SQL editor.

**Built 2026-08-16.** Superseded `docs/ADMIN_ANALYTICS_PLAN.md`.

---

## 1. The shape of it

| Piece | File |
|---|---|
| SQL: nine `security definer` RPCs | [`20260816195705_add_admin_analytics_rpcs.sql`](../scripts/migrations/20260816195705_add_admin_analytics_rpcs.sql) + [`20260820064501_add_admin_wpbl_stats_board_rpc.sql`](../scripts/migrations/20260820064501_add_admin_wpbl_stats_board_rpc.sql) + [`20260825065648_add_admin_wpbl_entry_point_and_search_rpcs.sql`](../scripts/migrations/20260825065648_add_admin_wpbl_entry_point_and_search_rpcs.sql) |
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
**What Audience shows, and what it deliberately does not** (Aug 25, 2026). The group was
audited alongside the new events and two things came off it:

- **The Discord funnel card is gone.** The promo it measured left Home on Aug 19, so its
  impressions and dismissals froze while joins kept accruing from the footer link: the rates
  were drifting toward a "joined" share that would eventually pass 100%, and the card opened by
  telling you not to read it. `admin_discord_funnel` and `fetchDiscordFunnel` still exist and
  still work; the wrapper is simply out of `fetchAnalytics`, so the page no longer spends a
  round trip on numbers that cannot move. The run it recorded is in the WPBL roadmap.
- **The headline row is three tiles, not five.** "Events" was a headline that a DEPLOY moves:
  adding seven event names on Aug 25 lifts it about a fifth with nothing changing in what
  anyone did, and the number was already on the page twice (the chart plots it per day, the
  Events card breaks it down). "Active today" and "Active 30d" were two tiles carrying three
  numbers, and unlike their neighbours they ignore the range chips entirely — they are now one
  tile whose sub-line names all three windows, so the fixed-window group cannot be mistaken for
  something the filter moved.

**The Today range is a partial day, and the deltas know it.** `days_back = 1` means midnight-to-now
in the reader's timezone, so the chip says "Today" rather than "24h": at 9am it covers nine
hours. Its previous window is ALL of yesterday, which would read negative every morning and
only catch up around midnight, so `comparable` in `AdminPage.tsx` drops every change arrow on
that range and says why. The same bias exists at 7d and 30d — every window is *n-1* full days
plus a partial one — at a seventh and a thirtieth of the weight, which is why those keep
theirs. A true rolling 24h window would need an hours parameter on all nine RPCs and an
hour-bucketed series behind the chart; that is a different feature, not a different label.

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
| `admin_wpbl_entry_points(days_back, tz)` | `props->>'from'` for player / team / game opens, plus Game Center tab × via |
| `admin_wpbl_search(days_back, tz, lim)` | the header-search funnel, what was picked, and the queries that matched nothing |
| `admin_top_players(days_back, lim, tz)` | `props->>'playerId'` joined to `wpbl_players` |
| `admin_discord_funnel(days_back, tz)` | shown / joined / dismissed, **by distinct session** |
| `admin_growth(days_back, tz)` | signups per day, user totals, push subscribers, reminder opt-ins |

Two shared helpers: `admin_event_league(props, path)` and `admin_safe_tz(tz)`.

The existing three indexes on `events` cover every one of these. No new indexes.

`admin_wpbl_entry_points` and `admin_wpbl_search` were added 2026-08-25 alongside the events
they read (`wpbl_team_opened`, `wpbl_searched`, `wpbl_search_picked`, `wpbl_game_tab`, and the
`from` prop that `game_center_opened` and `wpbl_player_opened` now carry). Two things about
them are load-bearing:

- **`admin_wpbl_entry_points` filters `game_center_opened` on `props->>'league' = 'wpbl'`.**
  That event is shared with `/mlb`, which has its own entry points and none of this labelling;
  without the filter the card would mix two sections' surfaces under one set of names.
- **`wpbl_searched` is the only event that stores typed text, and only on a miss.**
  `analytics.ts` keeps `q` when the query matched nothing and drops it otherwise, capped at 40
  characters. That asymmetry is the point: a query that matched is already described by
  whichever row the reader picked, so keeping it would be collecting freeform user text for
  nothing, while a query that matched nothing is the only thing on this dashboard that names a
  specific thing to go and fix. Do not "make it consistent" by logging every query.

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
- **Funnel rates are over distinct sessions.** `discord_shown` fired on every card mount,
  roughly 3× a session. Raw `joined / shown` read ~3%; the honest sessions-that-joined ÷
  sessions-that-saw-it number was **8.3%**. The card is retired but the rule is not: any new
  funnel counts distinct sessions, or it reports a third of the truth.
- **An event's count jumps on the day it was INSTRUMENTED, not on the day behaviour
  changed.** Search, team opens and the Game Center tabs all begin Aug 25, 2026, so any window
  spanning that date compares a surface against its own silence. The page's footnote says so;
  the trap is reading a 30d delta on a young event as growth.
- **Gap-fill day series in SQL.** Days with zero events have no rows; without
  `generate_series` a quiet week silently compresses and reads as a busy one.
- **`wpbl_team_opened` and `wpbl_bracket_team` / `wpbl_seeding_team` overlap on purpose.**
  The first is fired by `selectTeam` in `WpblApp.tsx` and counts every team-page open in the
  section; the other two are the bracket's and the seeding card's own funnels and carry the
  seed, which `selectTeam` does not know. A click on either card is therefore in both. Adding
  them together double-counts.
- **`from` on a player/team/game open is the SURFACE, not the widget**, and rows written
  before 2026-08-25 have no `from` at all. They report as `—`, which is honest (we did not
  know) rather than being folded into whichever surface looks likeliest.
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
- **Every window ends mid-day.** The current window is *n-1* complete days plus today so far;
  the previous window is *n* complete days. So every delta on the page is biased slightly
  negative, by roughly `(1 - fraction of today elapsed) / n`. Negligible at 30d, suppressed
  outright at 1d (see above), and genuinely worth fixing only by comparing against yesterday
  truncated to the same clock time, which is a change to `admin_analytics_overview` and
  `admin_event_counts` that would move every number already on the page.
- Not built, deliberately: retention / returning-browser cohorts, a first-visit → signup
  funnel, and CSV export.
