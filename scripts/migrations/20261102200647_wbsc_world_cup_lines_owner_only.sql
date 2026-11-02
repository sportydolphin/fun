-- wbsc world cup lines owner only
-- Created 2026-11-02. Applied by scripts/migrate.mjs.

-- Each WPBL player's World Cups (archive/wbsc/international.json, one row per player), for the
-- World Cup table on the player page while it is the owner's preview.
--
-- THE OWNER ALONE CAN READ IT, AND THAT IS THE WHOLE GATE. WBSC has not said its data may be
-- published (docs/WBSC_INGEST.md), and the client's `useIsAdmin` only hides a component: anything
-- in the bundle, or in a table `anon` can read, is public to anyone who opens dev tools. So the
-- rows live here behind `is_site_owner()`, which reads the confirmed email by the verified
-- auth.uid(), and every other reader gets an empty answer, not an error.
--
-- NOT ON THE EDGE CACHE'S LIST (functions/CLAUDE.md): that list is for tables every reader sees
-- alike, and this one answers differently for exactly one person.
--
-- No write policy: `npm run wbsc -- --upload` writes it over SUPABASE_DB_URL, as the migrations
-- do, from the gitignored file on the owner's machine. On WBSC's yes the data moves into git with
-- the rest and this table goes (ROADMAP-WOMENS-BASEBALL.md, stage 0 step 6).
create table if not exists public.wbsc_world_cup_lines (
  wpbl_player_id text primary key,
  events         jsonb not null,
  updated_at     timestamptz not null default now()
);

alter table public.wbsc_world_cup_lines enable row level security;

drop policy if exists "Owner reads World Cup lines" on public.wbsc_world_cup_lines;
create policy "Owner reads World Cup lines" on public.wbsc_world_cup_lines
  for select to authenticated
  using (public.is_site_owner());

-- RLS already refuses them; this keeps a later permissive policy from opening it by accident.
revoke all on table public.wbsc_world_cup_lines from anon;
revoke insert, update, delete, truncate on table public.wbsc_world_cup_lines from authenticated;
