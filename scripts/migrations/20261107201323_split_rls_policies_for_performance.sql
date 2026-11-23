-- split rls policies for performance
-- Created 2026-11-07. Applied by scripts/migrate.mjs.
-- Clears the Supabase performance advisor's auth_rls_initplan (15) and
-- multiple_permissive_policies (145) warnings. Nobody gains or loses access to any row: each
-- policy below keeps its command, its roles (all `public`) and its expression.
--
-- Why the shapes change:
-- * A bare auth.uid() or is_site_owner() in a policy runs once per row. Wrapped as
--   (select auth.uid()) Postgres plans it as an initplan and runs it once per statement. Both
--   functions are STABLE and read only the caller's JWT, so the answer cannot differ by row.
-- * A `FOR ALL` policy also covers SELECT, so on a table that already has a public read policy
--   every SELECT evaluated both, owner check included, on every row. Splitting the write policy
--   into INSERT, UPDATE and DELETE leaves exactly one SELECT policy per table. Where the public
--   read was narrower than the owner's (unapproved photos, private revisions), the owner's view
--   moves into that one SELECT policy with an OR, which is how Postgres combined them anyway.
-- Undoing this brings the warnings back and nothing else; it does not reopen anything.
--
-- Every statement is drop-if-exists then create, so a re-run lands on the same policies.

-- 1. Owner-written tables whose public read is `using (true)`: the owner's SELECT was redundant.
do $$
declare
  t record;
begin
  for t in
    select * from (values
      ('wpbl_articles',            'Owner writes WPBL articles'),
      ('wpbl_batting_lines',       'Owner writes WPBL batting lines'),
      ('wpbl_fielding_lines',      'Owner writes WPBL fielding lines'),
      ('wpbl_game_details',        'Owner writes WPBL game details'),
      ('wpbl_game_plays',          'Owner writes WPBL game plays'),
      ('wpbl_games',               'Owner writes WPBL games'),
      ('wpbl_ingest_runs',         'Owner writes WPBL ingest runs'),
      ('wpbl_pbp_validation_runs', 'Owner writes WPBL pbp validation runs'),
      ('wpbl_photo_categories',    'Owner writes fan photo categories'),
      ('wpbl_photo_figures',       'Owner writes fan photo figures'),
      ('wpbl_pitch_tracking',      'Owner writes WPBL pitch tracking'),
      ('wpbl_pitching_lines',      'Owner writes WPBL pitching lines'),
      ('wpbl_players',             'Owner writes WPBL players'),
      ('wpbl_plays',               'Owner writes WPBL plays'),
      ('wpbl_site_games',          'Owner writes WPBL site games'),
      ('wpbl_teams',               'Owner writes WPBL teams'),
      ('wpbl_tracking_watch',      'Owner writes WPBL tracking watch'),
      ('wpbl_video_tags',          'Owner writes WPBL video tags'),
      ('wpbl_videos',              'Owner writes WPBL videos'),
      -- The next three have a narrower public read; section 2 gives the owner their SELECT.
      ('wpbl_fan_photos',          'Owner writes fan photos'),
      ('wpbl_photos',              'Owner writes WPBL photos'),
      ('wpbl_photo_subjects',      'Owner writes fan photo subjects'),
      -- "Read own roles" already includes is_site_owner(), so the owner keeps reading every role.
      ('user_roles',               'Owner manages roles')
    ) as v(tbl, pol)
  loop
    execute format('drop policy if exists %I on public.%I', t.pol, t.tbl);
    execute format('drop policy if exists %I on public.%I', t.pol || ' (insert)', t.tbl);
    execute format('drop policy if exists %I on public.%I', t.pol || ' (update)', t.tbl);
    execute format('drop policy if exists %I on public.%I', t.pol || ' (delete)', t.tbl);
    execute format('create policy %I on public.%I for insert with check ((select public.is_site_owner()))',
                   t.pol || ' (insert)', t.tbl);
    execute format('create policy %I on public.%I for update using ((select public.is_site_owner())) with check ((select public.is_site_owner()))',
                   t.pol || ' (update)', t.tbl);
    execute format('create policy %I on public.%I for delete using ((select public.is_site_owner()))',
                   t.pol || ' (delete)', t.tbl);
  end loop;
end $$;

-- 2. One SELECT policy where the public sees less than the owner. The owner reads unapproved
-- photos to review them, and every revision, not just the league's.
drop policy if exists "Approved fan photos are public" on public.wpbl_fan_photos;
create policy "Approved fan photos are public" on public.wpbl_fan_photos
  for select using (approved or (select public.is_site_owner()));

drop policy if exists "WPBL photos are public" on public.wpbl_photos;
create policy "WPBL photos are public" on public.wpbl_photos
  for select using (approved or (select public.is_site_owner()));

drop policy if exists "Fan photo subjects follow the photo" on public.wpbl_photo_subjects;
create policy "Fan photo subjects follow the photo" on public.wpbl_photo_subjects
  for select using (
    exists (select 1 from public.wpbl_fan_photos p where p.id = wpbl_photo_subjects.photo_id and p.approved)
    or (select public.is_site_owner())
  );

drop policy if exists "Owner reads all WPBL revisions" on public.wpbl_game_revisions;
drop policy if exists "WPBL league revisions are public" on public.wpbl_game_revisions;
create policy "WPBL league revisions are public" on public.wpbl_game_revisions
  for select using (kind = 'league' or (select public.is_site_owner()));

drop policy if exists "Read own roles" on public.user_roles;
create policy "Read own roles" on public.user_roles
  for select using (user_id = (select auth.uid()) or (select public.is_site_owner()));

-- 3. Users' own rows on tables that everyone may read. The `FOR ALL` policy becomes INSERT,
-- UPDATE and DELETE with the same expressions. A `FOR ALL` with no WITH CHECK (prediction_stats)
-- checks new rows against its USING, so that expression is spelled out as the check.
drop policy if exists "own_predictions" on public.game_predictions;
drop policy if exists "own_predictions (insert)" on public.game_predictions;
drop policy if exists "own_predictions (update)" on public.game_predictions;
drop policy if exists "own_predictions (delete)" on public.game_predictions;
create policy "own_predictions (insert)" on public.game_predictions
  for insert with check ((select auth.uid()) = user_id);
create policy "own_predictions (update)" on public.game_predictions
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own_predictions (delete)" on public.game_predictions
  for delete using ((select auth.uid()) = user_id);

drop policy if exists "own write" on public.prediction_stats;
drop policy if exists "own write (insert)" on public.prediction_stats;
drop policy if exists "own write (update)" on public.prediction_stats;
drop policy if exists "own write (delete)" on public.prediction_stats;
create policy "own write (insert)" on public.prediction_stats
  for insert with check ((select auth.uid()) = user_id);
create policy "own write (update)" on public.prediction_stats
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own write (delete)" on public.prediction_stats
  for delete using ((select auth.uid()) = user_id);

drop policy if exists "Users manage own survivor_picks" on public.survivor_picks;
drop policy if exists "Users manage own survivor_picks (insert)" on public.survivor_picks;
drop policy if exists "Users manage own survivor_picks (update)" on public.survivor_picks;
drop policy if exists "Users manage own survivor_picks (delete)" on public.survivor_picks;
create policy "Users manage own survivor_picks (insert)" on public.survivor_picks
  for insert with check (((select auth.uid())::text = user_id) and (select public.user_is_active()));
create policy "Users manage own survivor_picks (update)" on public.survivor_picks
  for update using ((select auth.uid())::text = user_id)
  with check (((select auth.uid())::text = user_id) and (select public.user_is_active()));
create policy "Users manage own survivor_picks (delete)" on public.survivor_picks
  for delete using ((select auth.uid())::text = user_id);

-- usernames had two UPDATE policies (the user's own and the owner's). Postgres ORs permissive
-- policies' USING and WITH CHECK separately, so one policy with both ORs is the same rule.
drop policy if exists "Users manage own username" on public.usernames;
drop policy if exists "Owner can update any username" on public.usernames;
drop policy if exists "Users manage own username (insert)" on public.usernames;
drop policy if exists "Users and owner update usernames" on public.usernames;
drop policy if exists "Users manage own username (delete)" on public.usernames;
create policy "Users manage own username (insert)" on public.usernames
  for insert with check (((select auth.uid())::text = user_id) and (select public.user_is_active()));
create policy "Users and owner update usernames" on public.usernames
  for update
  using (((select auth.uid())::text = user_id) or (select public.is_site_owner()))
  with check ((((select auth.uid())::text = user_id) and (select public.user_is_active()))
              or (select public.is_site_owner()));
create policy "Users manage own username (delete)" on public.usernames
  for delete using ((select auth.uid())::text = user_id);

-- 4. Owner-only policies. The advisor does not flag is_site_owner() because it only knows
-- auth.*, but the function reads auth.users and runs per row all the same: before this, an anon
-- `select count(*)` on events ran it on every row and hit the statement timeout (a 500).
do $$
declare
  t record;
begin
  for t in
    select * from (values
      ('events',                     'Owner can delete events',                   'delete'),
      ('events',                     'Owner can read events',                     'select'),
      ('events_daily',               'Owner can read the daily rollup',           'select'),
      ('feedback',                   'Owner can delete feedback',                 'delete'),
      ('feedback',                   'Owner can read feedback',                   'select'),
      ('feedback',                   'Owner can update feedback',                 'update'),
      ('roadmap_items',              'roadmap_items_owner',                       'all'),
      ('wpbl_photo_contributors',    'Owner reads/writes fan photo contributors', 'all'),
      ('wpbl_photo_reports',         'Owner resolves photo reports',              'all'),
      ('wpbl_photo_tag_blocks',      'Owner manages photo tag blocks',            'all'),
      ('wpbl_photo_tag_suggestions', 'Owner reviews photo tag suggestions',       'all')
    ) as v(tbl, pol, cmd)
  loop
    execute format('drop policy if exists %I on public.%I', t.pol, t.tbl);
    execute format('create policy %I on public.%I for %s using ((select public.is_site_owner()))%s',
                   t.pol, t.tbl, t.cmd,
                   case when t.cmd in ('update', 'all') then ' with check ((select public.is_site_owner()))' else '' end);
  end loop;
end $$;

drop policy if exists "Owner reads World Cup lines" on public.wbsc_world_cup_lines;
create policy "Owner reads World Cup lines" on public.wbsc_world_cup_lines
  for select to authenticated using ((select public.is_site_owner()));

-- 5. Policies that only needed the initplan wrap. user_preferences keeps `FOR ALL` because it
-- is its only policy, so nothing else is evaluated beside it.
drop policy if exists "own_prefs" on public.user_preferences;
create policy "own_prefs" on public.user_preferences
  for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "Anyone can record events" on public.events;
create policy "Anyone can record events" on public.events
  for insert with check (user_id is null or user_id = (select auth.uid()));

drop policy if exists "own subscriptions - select" on public.push_subscriptions;
drop policy if exists "own subscriptions - insert" on public.push_subscriptions;
drop policy if exists "own subscriptions - update" on public.push_subscriptions;
drop policy if exists "own subscriptions - delete" on public.push_subscriptions;
create policy "own subscriptions - select" on public.push_subscriptions
  for select using ((select auth.uid()) = user_id);
create policy "own subscriptions - insert" on public.push_subscriptions
  for insert with check (((select auth.uid()) = user_id) and (select public.user_is_active()));
create policy "own subscriptions - update" on public.push_subscriptions
  for update using ((select auth.uid()) = user_id)
  with check (((select auth.uid()) = user_id) and (select public.user_is_active()));
create policy "own subscriptions - delete" on public.push_subscriptions
  for delete using ((select auth.uid()) = user_id);

drop policy if exists "own wpbl reminders - select" on public.wpbl_game_reminders;
drop policy if exists "own wpbl reminders - insert" on public.wpbl_game_reminders;
drop policy if exists "own wpbl reminders - update" on public.wpbl_game_reminders;
drop policy if exists "own wpbl reminders - delete" on public.wpbl_game_reminders;
create policy "own wpbl reminders - select" on public.wpbl_game_reminders
  for select using ((select auth.uid()) = user_id);
create policy "own wpbl reminders - insert" on public.wpbl_game_reminders
  for insert with check ((select auth.uid()) = user_id);
create policy "own wpbl reminders - update" on public.wpbl_game_reminders
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own wpbl reminders - delete" on public.wpbl_game_reminders
  for delete using ((select auth.uid()) = user_id);
