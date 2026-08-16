# Admin analytics — build plan

**Status:** planned, not built. Nothing in the app reads the `events` table yet.
**Written:** 2026-08-16. **Goal:** stop having to open the Supabase dashboard to see what
people actually do on the site.

Read this top to bottom before writing code. The "Landmines" section is the part that will
cost you an afternoon if you skip it — several of them are things the obvious implementation
gets silently wrong (wrong numbers, or worse, analytics readable by any signed-in user).

When the build lands, fold the durable half of this doc into `docs/ADMIN_ANALYTICS.md`,
delete the plan half, and add a line to the doc list in [`context.md`](../context.md).

---

## 1. Decisions already made

| Question | Decision | Why |
|---|---|---|
| Where it lives | **A dedicated `/admin` route**, not a modal | Charts and tables need room; the current Admin dialog is `maxWidth="xs"` |
| Scope | **Site-wide, with a WPBL lens** | `events` already mixes MLB and WPBL; filtering to WPBL only would leave MLB invisible for no saved effort |
| Depth | **Full first cut** — all sections in §5 | One migration and one component either way; marginal cost per section is small |
| Aggregation | **`security definer` RPCs**, not views, not client-side | See Landmine 1 — a view would leak analytics to every signed-in user |
| Charts | **Hand-rolled inline SVG** | No chart library in `package.json`; [`src/wpbl/PitchLocation.tsx`](../src/wpbl/PitchLocation.tsx) already establishes inline SVG as this codebase's idiom. Do not add Recharts/d3 |

**Still open** — decide before starting Phase 5: whether to move the existing Admin *modal's*
sections onto the new page. Recommendation in §6.

---

## 2. Machine setup

```bash
npm install
```

`.env` at the repo root needs (copy from the other machine or Supabase dashboard):

- `SUPABASE_DB_URL` — Postgres connection string for the migration runner. Supabase →
  Connect → Connection string → **Session pooler** (port 5432). Not "Direct connection"
  (IPv6-only), not the transaction pooler (6543). The password is the *database* password,
  not the anon key.
- The `VITE_*` Supabase keys the app itself reads.

```bash
npm run dev
```

```bash
npm run migrate -- status
```

Migration conventions live in [`scripts/migrations/README.md`](../scripts/migrations/README.md).
Scaffold the new file with `npm run migrate -- new "add admin analytics rpcs"` — never
hand-name it, the timestamp prefix is what orders it.

---

## 3. What exists today

### The event pipeline (all built, all working)

- **[`scripts/create_events.sql`](../scripts/create_events.sql)** — the `events` table.
  Columns: `id` bigint, `created_at` timestamptz, `user_id` uuid (null when signed out),
  `session_id` text, `event` text, `props` jsonb, `path` text. Inserts are open to anon +
  authenticated (a signed-in row can only carry the caller's own `auth.uid()`); **reads and
  deletes are owner-only** via `public.is_site_owner()`. Indexes: `(created_at desc)`,
  `(event, created_at desc)`, `(user_id, created_at desc) where user_id is not null`.
- **[`src/lib/analytics.ts`](../src/lib/analytics.ts)** — the `EVENTS` constant and
  fire-and-forget `track()`. `session_id` is a random per-browser UUID in `localStorage`.
- **[`src/lib/admin.ts`](../src/lib/admin.ts)** — `ADMIN_EMAIL` + the cosmetic `useIsAdmin()`
  hook. Cosmetic only; RLS is the real boundary.
- `public.is_site_owner()` already exists in the DB (defined identically in
  `create_events.sql`, `create_feedback.sql`, and `harden_admin_gate.sql`). **Do not
  redefine it** in the new migration — just call it.

### The Admin surface

[`src/AdminPanel.tsx`](../src/AdminPanel.tsx) (872 lines) — a `maxWidth="xs"` dialog opened
from the account menu at [`src/App.tsx:913`](../src/App.tsx). It contains: Other Apps grid,
test-notification button, Feedback (opens `FeedbackModal`), payroll freshness, WPBL ingest
health, total predictions, Users (opens `UserModal`), quick links.

Reusable pieces to lift out, not duplicate: `Section`, `StatRow`, `timeAgo`, `timeAgoMin`,
`FreshnessChip`.

### Routing

Hand-rolled, no router. [`src/App.tsx:79`](../src/App.tsx) has a `Route` string union;
`navigate()` does `pushState` + a synthetic `popstate`; a `popstate` listener sets state.
**`/wpbl/api` is your template** — lazy component at `src/App.tsx:37`, render block at
`src/App.tsx:1072` (back button + `<Suspense>`).

`public/_routes.json` needs **no change** — it lists paths that hit Cloudflare Functions;
`/admin` is a static SPA route like `/privacy`.

---

## 4. Live data snapshot (measured 2026-08-16)

Real numbers from the production DB, so you know what the dashboard will actually render.
**10,973 rows, first event 2026-08-05** — only ~12 days of history exist.

| event | rows | browsers | users |
|---|---:|---:|---:|
| `discord_shown` | 3685 | 1228 | 40 |
| `game_center_opened` | 2784 | 516 | 31 |
| `wpbl_tab_viewed` | 2629 | 387 | 27 |
| `wpbl_player_opened` | 1073 | 160 | 16 |
| `board_viewed` | 367 | 18 | 7 |
| `prediction_made` | 189 | 10 | 4 |
| `discord_joined` | 109 | 102 | 8 |
| `discord_dismissed` | 84 | 83 | 12 |
| `login` | 33 | 10 | 5 |
| `wpbl_game_reminder_on` | 14 | 7 | 7 |
| `signup` | 4 | 4 | 4 |
| `wpbl_game_reminder_off` | 2 | 1 | 1 |

Recent daily volume: ~1,500–2,500 events and 240–465 unique browsers per day.

**Props shapes are confirmed populated** — every planned breakdown works against real rows:

- `wpbl_tab_viewed` → `{view, via, from}`. `via` is `pill` / `swipe` / `link`. Top rows:
  stats+pill 471, standings+pill 403, home+pill 341, schedule+pill 339, standings+swipe 209.
  Note `view` includes `tracking` (only **4 views, ever** — a finding in itself).
- `league` prop: `game_center_opened` splits wpbl 2749 / mlb 35; `board_viewed` and
  `prediction_made` are mlb-only. So the league lens is real, but `wpbl_player_opened`,
  `wpbl_tab_viewed`, and the Discord events carry no `league` — treat them as implicitly WPBL.
- `path`: `/wpbl` 10371, `/mlb` 598, `/wpbl/api` 4.

**Implication:** the dataset is small enough that client-side aggregation would work *today*.
Do it in SQL anyway — the RPC is what keeps the data private (Landmine 1), and this table
grows ~2k rows/day.

---

## 5. The build

### Phase 1 — SQL migration

`npm run migrate -- new "add admin analytics rpcs"`

Every function: `security definer`, `set search_path = ''`, **guards on `is_site_owner()`
before touching a row**, `revoke all ... from public`, `grant execute ... to authenticated`.

| Function | Returns |
|---|---|
| `admin_analytics_overview(days_back int, tz text)` | headline totals + gap-filled per-day series |
| `admin_event_counts(days_back int, league text)` | per-event count / browsers / users, **plus the same for the previous equal window** |
| `admin_wpbl_tab_stats(days_back int)` | `props->>'view'` × `props->>'via'` |
| `admin_top_players(days_back int, lim int)` | `props->>'playerId'` joined to `wpbl_players` |
| `admin_discord_funnel(days_back int)` | shown / joined / dismissed, **by distinct session** |
| `admin_growth(days_back int)` | signups per day, total users, live push subscribers, reminder opt-ins |

Starting sketch for the overview — verify against the DB before trusting it:

```sql
create or replace function public.admin_analytics_overview(
  days_back int default 30,
  tz        text default 'UTC'
) returns jsonb
language sql security definer set search_path = '' as $$
  with d as (
    select generate_series(
      ((now() at time zone tz)::date - (days_back - 1)),
      ((now() at time zone tz)::date),
      interval '1 day')::date as day
  ),
  ev as (
    select ((created_at at time zone tz)::date) as day, session_id, user_id
    from public.events
    where created_at >= now() - make_interval(days => days_back)
      and session_id is distinct from 'no-storage'
  ),
  agg as (
    select day, count(*) n, count(distinct session_id) browsers,
           count(distinct user_id) users
    from ev group by day
  )
  select case when public.is_site_owner() then
    jsonb_agg(jsonb_build_object(
      'date',     d.day,
      'events',   coalesce(agg.n, 0),
      'browsers', coalesce(agg.browsers, 0),
      'users',    coalesce(agg.users, 0)
    ) order by d.day)
  else null end
  from d left join agg on agg.day = d.day;
$$;

revoke all on function public.admin_analytics_overview(int, text) from public;
grant execute on function public.admin_analytics_overview(int, text) to authenticated;
```

> A `sql` function can fold the owner check into the projection as above, but prefer
> `plpgsql` with an explicit `if not public.is_site_owner() then raise exception ... using
> errcode = '42501'; end if;` for the rest — a hard failure is easier to read at the call
> site than a null.

No new indexes needed at this volume; the existing three cover every query.

### Phase 2 — `src/lib/analyticsAdmin.ts`

Typed `supabase.rpc()` wrappers plus one `fetchAnalytics(days, league)` firing them in
parallel. Copy the defensive style of [`src/lib/adminUsers.ts`](../src/lib/adminUsers.ts):
warn to console and return an empty shape on error, so an unapplied migration renders an
empty panel instead of crashing the route.

Pure helpers — delta percentage, series bucketing, "unique browsers" formatting — go here
(not in the component) and get `vitest` coverage. `npm test`.

### Phase 3 — the `/admin` route

1. Add `'/admin'` to the `Route` union ([`src/App.tsx:79`](../src/App.tsx)).
2. `const AdminPage = lazy(() => import('./AdminPage'))` beside `WpblApiDocs` (line 37).
3. Render block modeled on the `/wpbl/api` one (line 1072) — back control + `<Suspense>`.
4. **Gate it:** if `path === '/admin'` and the user is not `ADMIN_EMAIL`, `navigate('/wpbl')`.
   Wait for auth to resolve first, or a signed-in owner gets bounced on a hard refresh
   before the session loads. Cosmetic only — RLS and the `is_site_owner()` guards are the
   real boundary.
5. **SEO:** add `noindex` support to [`src/seo.ts`](../src/seo.ts) (it has none today) and
   add `Disallow: /admin` to [`public/robots.txt`](../public/robots.txt). See Landmine 7.

### Phase 4 — `src/AdminPage.tsx`

Range chips (7 / 30 / 90 days) + a league filter driving the RPC args. Each section loads and
fails independently — no single spinner gating the page, no one failed RPC blanking it.

1. **Headline tiles** — active browsers today / this week / this month, signed-in share,
   total events, each with a delta vs the previous window.
2. **Activity chart** — inline SVG, events + unique browsers per day.
3. **Events table** — name, count, browsers, users, ▲▼ vs previous window.
4. **WPBL tabs** — popularity split by how each tab was reached (pill / swipe / link). This
   is the payoff for `wpbl_tab_viewed` existing, and it is the most actionable panel here.
5. **Top players opened** — top 10 with portrait + name (`PlayerPortrait` from
   [`src/wpbl/ui.tsx`](../src/wpbl/ui.tsx)).
6. **Discord funnel** — shown → joined / dismissed, **rates over distinct sessions**.
7. **Reminders & growth** — signups/day, total users, live push subscribers, reminder opt-ins.

### Phase 5 — reconcile the two admin surfaces

See §6.

---

## 6. The two-admin-surfaces problem

A real `/admin` page makes the existing dialog a second, competing admin surface. Two options:

- **Recommended — move the modal's sections onto the page** (Other Apps, test notification,
  feedback, payroll + ingest freshness, users, quick links) and change the ⚡ Admin menu item
  at [`src/App.tsx:913`](../src/App.tsx) to `navigate('/admin')`. Mostly relocating JSX;
  `FeedbackModal` and `UserModal` can stay modals opened *from* the page. Two admin surfaces
  is the part most likely to rot.
- **Cheaper — leave the modal alone**, add a "📊 Analytics" row that navigates to `/admin`.
  Ships faster, but the split is permanent unless someone comes back to it.

Either is fine; just pick deliberately rather than drifting into the second by default.

---

## 7. Landmines

**1. A view over `events` would leak every visitor's activity.** A normal Postgres view runs
with the *view owner's* permissions and bypasses the underlying table's RLS. Existing WPBL
views (`wpbl_pitching_usage` etc.) `grant select to anon, authenticated` — copy that pattern
here and analytics become world-readable to anyone with an account. Use `security definer`
functions with an explicit `is_site_owner()` guard, granted to `authenticated` only. (If you
ever do want a view, it must be `with (security_invoker = true)`.)

**2. `usernames.user_id` is `text`; `events.user_id` is `uuid`.** Verified in the live DB.
Any join needs an explicit cast (`u.user_id::uuid = e.user_id`) or Postgres errors out.
`user_preferences.user_id`, `push_subscriptions.user_id`, and `wpbl_game_reminders.user_id`
are all `uuid` — `usernames` is the odd one.

**3. `push_subscriptions` RLS is own-rows-only.** A client-side count returns *your own*
devices, not the site's. It has to come from an RPC (`security definer` bypasses RLS). Same
trap for any per-user preference count.

**4. `discord_shown` fires on every card mount, ~3× per session.** 3685 impressions across
1228 browsers. A raw `joined / shown` ratio reads 3.0% when the honest number — sessions that
joined ÷ sessions that saw it — is **8.3%**. Compute every funnel rate over
`count(distinct session_id)`.

**5. Gap-fill the day series in SQL.** Days with zero events simply have no rows; without
`generate_series` the chart silently compresses empty days and a quiet week looks busy.

**6. `session_id` is a per-browser localStorage id.** Label it "unique browsers", not
"unique visitors" — one person on phone + laptop is two, and clearing site data resets it.
Also exclude the literal `'no-storage'` sentinel ([`src/lib/analytics.ts:43`](../src/lib/analytics.ts)),
written when localStorage is unavailable; otherwise every such visitor collapses into one
fake browser.

**7. A stale `noindex` would deindex the public site.** `useSeo` has no robots handling
today. Whatever you set for `/admin` **must be reset** when navigating away, or a session
that visits `/admin` then lands on `/wpbl` leaves `noindex` on the public page. Safest shape:
always `upsertMeta('name', 'robots', seo.noindex ? 'noindex, nofollow' : 'index, follow')` on
every route change, never conditionally.

**8. Timezone.** `created_at::date` buckets in UTC — which is why the raw daily query returns
dates stamped `T07:00:00Z`. Pick one timezone, pass it as an RPC arg, and label the axis.

**9. Only ~12 days of history exist** (first event 2026-08-05). The 90-day range will be
mostly empty for a while — either clamp the range to the first event or label the axis
honestly rather than rendering 78 blank days.

---

## 8. Done when

- [ ] `npm run migrate -- status` shows the new migration applied
- [ ] Signed in as the owner, `/admin` renders every section with real numbers
- [ ] Signed in as a **non-owner**, `/admin` redirects to `/wpbl`, and calling any new RPC
      from the browser console returns an authorization error (**verify this explicitly** —
      it's the whole security model)
- [ ] Signed out, `/admin` redirects and does not flash the page
- [ ] `npm test` passes, including new tests for the pure helpers
- [ ] `npm run build` clean
- [ ] Discord funnel rates are session-based (spot-check against the §4 numbers: ~8.3% join)
- [ ] Navigating `/admin` → `/wpbl` leaves `robots` as `index, follow` (check `<head>`)
- [ ] Range chips change the numbers; the league filter changes the event table
- [ ] `docs/` updated and the doc list in `context.md` amended

---

## 9. Out of scope (deliberate follow-ups)

- **Retention / signup funnel** — week-over-week returning browsers, first-visit → signup.
  Genuinely useful but the SQL is harder and the numbers are noisy at this traffic level.
- **Event pruning.** `events` grows ~2k rows/day (~700k/year). Fine for Postgres for now, but
  there is no retention policy; a monthly prune of rows older than ~400 days will want one.
- **Real-time / auto-refresh.** Load on mount, with a manual refresh control.
- **CSV export.**
