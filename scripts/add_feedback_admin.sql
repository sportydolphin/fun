-- Run this once in your Supabase SQL editor (Dashboard → SQL Editor).
--
-- Upgrades the existing `feedback` table so the site owner can read and act on
-- submissions from inside the app's Admin panel (previously reads were closed to
-- all clients and feedback was only visible in the Supabase dashboard).
--
-- Adds a `handled_at` timestamp (null = new/open, set = dealt with) and owner-only
-- read/update/delete policies. "Owner" is matched on the signed-in email claim, the
-- same address gating the Admin panel client-side (src/App.tsx ADMIN_EMAIL). The
-- public insert policy from create_feedback.sql is left untouched — anyone can still
-- submit.

-- Mark-as-handled state for the admin queue.
alter table feedback add column if not exists handled_at timestamptz;

-- Non-spoofable owner check (see scripts/harden_admin_gate.sql for the rationale):
-- reads the confirmed email from auth.users by the caller's verified auth.uid(), so
-- no tampered client value can pass it.
create or replace function public.is_site_owner()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from auth.users
    where id = auth.uid() and email = 'snichols246@gmail.com' and email_confirmed_at is not null
  );
$$;
revoke all on function public.is_site_owner() from public;
grant execute on function public.is_site_owner() to authenticated;

-- Owner can read every submission.
drop policy if exists "Owner can read feedback" on feedback;
create policy "Owner can read feedback"
  on feedback for select using (public.is_site_owner());

-- Owner can mark handled / reopen.
drop policy if exists "Owner can update feedback" on feedback;
create policy "Owner can update feedback"
  on feedback for update using (public.is_site_owner()) with check (public.is_site_owner());

-- Owner can delete submissions.
drop policy if exists "Owner can delete feedback" on feedback;
create policy "Owner can delete feedback"
  on feedback for delete using (public.is_site_owner());
