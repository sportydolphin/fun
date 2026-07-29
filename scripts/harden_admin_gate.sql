-- Run this once in your Supabase SQL editor (Dashboard → SQL Editor) on an already-
-- deployed database. Hardens the owner-only ("admin") gate so it cannot be spoofed.
--
-- Before: admin RLS policies trusted the JWT email *claim*
--   (auth.jwt() ->> 'email') = 'snichols246@gmail.com'
-- After: they call public.is_site_owner(), which reads the CONFIRMED email straight
-- from auth.users keyed by the caller's verified auth.uid(). That id comes from the
-- signed JWT's `sub` and can't be forged; auth.users.email is the confirmed address
-- and can't be reassigned to an already-registered email. So there is no client-side
-- value a user can tamper with to pass this check — the app's client `isAdmin` flag
-- (email compare) only decides whether the Admin *button* renders; it grants nothing.
--
-- Idempotent: safe to run more than once. Fresh installs get the same via the updated
-- create_feedback.sql / add_usernames_table.sql / add_user_admin.sql.

-- ── The non-spoofable owner predicate ───────────────────────────────────────────
create or replace function public.is_site_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from auth.users
    where id = auth.uid()
      and email = 'snichols246@gmail.com'
      and email_confirmed_at is not null
  );
$$;
revoke all on function public.is_site_owner() from public;
grant execute on function public.is_site_owner() to authenticated;

-- ── Re-point every admin policy at it ────────────────────────────────────────────
drop policy if exists "Owner can read feedback" on feedback;
create policy "Owner can read feedback"
  on feedback for select using (public.is_site_owner());

drop policy if exists "Owner can update feedback" on feedback;
create policy "Owner can update feedback"
  on feedback for update using (public.is_site_owner()) with check (public.is_site_owner());

drop policy if exists "Owner can delete feedback" on feedback;
create policy "Owner can delete feedback"
  on feedback for delete using (public.is_site_owner());

drop policy if exists "Owner can update any username" on usernames;
create policy "Owner can update any username"
  on usernames for update using (public.is_site_owner()) with check (public.is_site_owner());
