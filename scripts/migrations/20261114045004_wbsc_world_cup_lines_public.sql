-- wbsc world cup lines public
-- Created 2026-11-14. Applied by scripts/migrate.mjs.

-- The World Cup on WPBL player pages goes public (ROADMAP-WOMENS-BASEBALL.md, "The rollout in
-- phases", phase 1). Until now only the site owner could read this table (20261102200647), which
-- was the whole gate while WBSC's data waited on an answer. Publication rests on implied
-- permission from Nov 13, 2026, so every reader reads it.
--
-- EVERY READER SEES THE SAME ROWS, so it goes on the edge cache's list (src/lib/edgeTables.ts) in
-- the same change. Put the owner-only policy back and take it off that list together: a cached
-- answer would keep serving the rows after the policy closed.
--
-- STILL NO WRITE PATH from a browser. `npm run wbsc -- --upload` writes it over SUPABASE_DB_URL.
-- On a "no" from WBSC: `delete from public.wbsc_world_cup_lines`, then purge the edge cache.

drop policy if exists "Owner reads World Cup lines" on public.wbsc_world_cup_lines;
drop policy if exists "Everyone reads World Cup lines" on public.wbsc_world_cup_lines;
create policy "Everyone reads World Cup lines" on public.wbsc_world_cup_lines
  for select to anon, authenticated
  using (true);

grant select on table public.wbsc_world_cup_lines to anon, authenticated;
revoke insert, update, delete, truncate on table public.wbsc_world_cup_lines from anon, authenticated;
