-- /admin → Roadmap: the site's priority list, editable from the page.
--
-- The tiers lived only in ROADMAP-WPBL.md's "Priorities" section, which meant reordering them took
-- a commit and a pull request. The markdown keeps the reasoning and the shipped log; this table is
-- the order. Seeded below with that section as it stood on Oct 13, 2026, plus the engineering
-- backlog added the same day.
--
-- OWNER ONLY, READ AND WRITE. The notes name unshipped work and open problems, so no other reader
-- may see a row, and the table must stay off src/lib/edgeTables.ts (the edge cache hands one
-- reader's answer to the next). The browser writes with plain insert / update / delete, never
-- upsert, which is fine here because the owner also holds the SELECT policy (see the upsert trap
-- in CLAUDE.md for the table where that is not true).
--
-- `position` orders rows within a tier; a move swaps two rows' positions, and a row that changes
-- tier goes to the bottom of its new one. `done_at` set means shipped: the row stays, under Done,
-- so a finished item can be reopened rather than retyped.

create table if not exists public.roadmap_items (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (length(btrim(title)) between 1 and 200),
  notes       text not null default '' check (length(notes) <= 4000),
  priority    text not null check (priority in ('P0', 'P1', 'P2', 'P3', 'parked')),
  area        text not null default 'site' check (area in ('site', 'wpbl', 'mlb')),
  position    integer not null default 0,
  done_at     timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists roadmap_items_order_idx on public.roadmap_items (priority, position);

alter table public.roadmap_items enable row level security;

drop policy if exists roadmap_items_owner on public.roadmap_items;
create policy roadmap_items_owner on public.roadmap_items
  for all using (public.is_site_owner()) with check (public.is_site_owner());

create or replace function public.roadmap_items_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists roadmap_items_touch on public.roadmap_items;
create trigger roadmap_items_touch before update on public.roadmap_items
  for each row execute function public.roadmap_items_touch();

-- Seed once. Guarded on an empty table so a re-run after the owner has edited it adds nothing.
insert into public.roadmap_items (priority, position, area, title, notes)
select v.priority, v.position, v.area, v.title, v.notes
from (values
  ('P0', 1, 'wpbl', 'Multiple seasons: the spring remainder',
   'Built and finished Oct 13 (year menus, every board cut to one year, per-season archive, Compare, offseason skeleton). Left: POSTSEASON_SCHEDULE, PICKEM_SEASON and the award constants wait for the league''s 2027 calendar. The spring rehearsal is the real test.'),

  ('P1', 1, 'site', 'The worst layout shifts',
   'Ops item 3. Fixed Oct 12: cold player and game addresses, the blocks under a player, the honours row, the season line, the win probability fallback, MLB''s bracket skeleton. Open: /wpbl/stats and MLB Home on a desktop reproduce clean locally and wait on the attributed reports.'),
  ('P1', 2, 'site', 'Google Play release',
   'Ops item 9. A signed build works on a device; only Play''s process is left. docs/ANDROID.md.'),
  ('P1', 3, 'wpbl', 'Wins added and baserunning on the player card and Compare',
   'Item 8 in ROADMAP-WPBL.md. Run value already has both.'),
  ('P1', 4, 'site', 'Crash triage',
   'Ops item 2, once a week of tagged rows is in (around Oct 18).'),

  ('P2', 1, 'site', 'iOS',
   'docs/IOS.md. A much bigger build than Play: Capacitor, Sign in with Apple, APNs beside Web Push, enough native to pass review guideline 4.2. Done before the season.'),
  ('P2', 2, 'wpbl', 'Spring readiness',
   'The feed rehearsal, wpbl-postseason-check failing on missing secrets, the Traps re-verified, the Bluesky rethink.'),
  ('P2', 3, 'wpbl', 'Feed contract in wpbl-ingest (valibot or zod)',
   'Validate the league payload at the door, so a renamed game_type, a missing completed_at or a short /games list throws loudly instead of ingesting as ok: true. Every one of those has happened once.'),
  ('P2', 4, 'wpbl', 'Make summary.errors mean failure, plus a freshness alarm',
   'An ingest pass with errors should log ok: false. Freshness: a scheduled game past its first pitch with no live row DMs the owner on Discord. admin-health-alert already pushes on unmapped teams and games never started; this closes the gap where the push is missed. Would have caught both Sep 9 outages.'),
  ('P2', 5, 'wpbl', 'Column-partition test for LIVE_GAME_COLUMNS',
   'Generate DB types (supabase gen types) and assert LIVE_GAME_COLUMNS plus the immutable list covers exactly the wpbl_games columns. Same for BATTING_LINE_COLUMNS and PITCHING_LINE_COLUMNS. Turns the "tsc catches none of this" trap into a failing CI check.'),
  ('P2', 6, 'wpbl', 'Freeze past seasons as static JSON',
   '2026 stops changing once the drift check stops finding edits. Serve it from R2 or /data/2026/*.json with immutable caching instead of Supabase: fewer reads, cheap multi-season, and it doubles as the open-data download.'),
  ('P2', 7, 'site', 'Bundle budget in CI (size-limit)',
   'Turns chunk growth (5% from Vite 8) into a number on every pull request.'),
  ('P2', 8, 'site', 'knip for dead exports and files',
   'The repo has grown fast and the five toys were deleted by hand.'),

  ('P3', 1, 'wpbl', '/wpbl/data and the embeddable widget',
   'Ops item 8. Pairs with the frozen season files.'),
  ('P3', 2, 'mlb', 'MLB plays and pitches',
   'None stored yet (checked Oct 12): the mirror is box-score lines only, 2000 to 2026, about 196 MB of a 344 MB database. Mirror 2026 and measure before any backfill.'),
  ('P3', 3, 'mlb', 'Archive old MLB line tables to R2 or Parquet',
   'They are the largest tables. Move them before the database nears the 500 MB ceiling, which MLB plays would bring forward.'),
  ('P3', 4, 'site', 'Data prefetch on link hover or visibility',
   'Warm the player and game fetches before the click; the real <a href> links are already there to hook.'),
  ('P3', 5, 'site', 'Replace html2canvas (modern-screenshot or html-to-image)',
   'html2canvas is unmaintained and misses modern CSS.'),
  ('P3', 6, 'site', '@tanstack/react-virtual for the stats table and Watch',
   'Once two seasons double the row counts.'),
  ('P3', 7, 'wpbl', 'fast-check property tests for derive/',
   'WAR sums, runsOnPlay, base-state transitions.'),
  ('P3', 8, 'wpbl', 'DuckDB-WASM SQL sandbox on the open-data page',
   'Over the static season files.'),
  ('P3', 9, 'site', 'MLB Draft board, the Visuals list, the data-mining list, portrait rights', ''),

  ('parked', 1, 'wpbl', 'Call the Play', ''),
  ('parked', 2, 'wpbl', 'Pick''em', '2027 Opening Day.'),
  ('parked', 3, 'site', 'Favourite-team theming', ''),
  ('parked', 4, 'wpbl', 'This day in the inaugural season', 'Aug 2027.'),
  ('parked', 5, 'wpbl', 'Rolling form', ''),
  ('parked', 6, 'wpbl', 'WPBL streaks and milestones', '')
) as v(priority, position, area, title, notes)
where not exists (select 1 from public.roadmap_items);
