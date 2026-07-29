-- Run this once in your Supabase SQL editor (Dashboard → SQL Editor).
--
-- Database-side half of soft-delete enforcement: stops an owner-deactivated account
-- (is_deleted on usernames, see add_user_admin.sql) from writing, even if the client
-- guard (src/lib/userActive.ts) is bypassed. Adds a reusable predicate and folds it
-- into each user-write policy's WITH CHECK.
--
-- Depends on add_user_admin.sql having been run first (needs the is_deleted column).

-- Reusable predicate: true when the current signed-in user is NOT deactivated.
-- security definer so it can read usernames regardless of caller; a brand-new user
-- with no usernames row yet counts as active (nothing to deactivate), so signup works.
create or replace function public.user_is_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1 from public.usernames
    where user_id = auth.uid()::text and is_deleted
  );
$$;

grant execute on function public.user_is_active() to authenticated, anon;

-- ── usernames: own insert/update (from add_usernames_table.sql) ──────────────────
drop policy if exists "Users manage own username" on usernames;
create policy "Users manage own username"
  on usernames for all
  using  (auth.uid()::text = user_id)
  with check (auth.uid()::text = user_id and public.user_is_active());

-- ── push_subscriptions: own insert + update (from create_push_subscriptions.sql) ─
drop policy if exists "own subscriptions - insert" on public.push_subscriptions;
create policy "own subscriptions - insert" on public.push_subscriptions
  for insert with check (auth.uid() = user_id and public.user_is_active());

drop policy if exists "own subscriptions - update" on public.push_subscriptions;
create policy "own subscriptions - update" on public.push_subscriptions
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id and public.user_is_active());

-- ── survivor_picks: own insert/update (from create_survivor_picks.sql) ───────────
drop policy if exists "Users manage own survivor_picks" on survivor_picks;
create policy "Users manage own survivor_picks"
  on survivor_picks for all
  using  (auth.uid()::text = user_id)
  with check (auth.uid()::text = user_id and public.user_is_active());

-- ── Tables whose policies live only in the Supabase dashboard (no create script in
--    this repo): game_predictions, prediction_stats, user_preferences. Their exact
--    policy definitions aren't reproduced here to avoid clobbering them blind. For
--    each, edit its INSERT/UPDATE (or FOR ALL) policy in the dashboard and append
--    `and public.user_is_active()` to the WITH CHECK expression, e.g.:
--
--      alter policy "<existing policy name>" on game_predictions
--        with check (auth.uid()::text = user_id and public.user_is_active());
--
--    (The client guard in src/lib/userActive.ts already covers these three; this is
--    the belt-and-suspenders DB layer.)
