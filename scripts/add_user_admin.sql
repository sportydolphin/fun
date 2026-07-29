-- Run this once in your Supabase SQL editor (Dashboard → SQL Editor).
--
-- Lets the site owner soft-delete (deactivate) user accounts from the in-app Admin
-- panel without actually removing the row — a flag flip, fully reversible. Adds
-- `is_deleted` / `deleted_at` to `usernames` and an owner-only update policy so the
-- owner can flip the flag on ANY user's row (the existing "Users manage own username"
-- policy still only lets a normal user touch their own). "Owner" is matched on the
-- signed-in email claim, same address as src/App.tsx ADMIN_EMAIL.

alter table usernames add column if not exists is_deleted boolean not null default false;
alter table usernames add column if not exists deleted_at timestamptz;

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

-- Owner can update any username row (used to toggle is_deleted). Normal users keep
-- their own-row-only policy from add_usernames_table.sql; policies are OR'd.
drop policy if exists "Owner can update any username" on usernames;
create policy "Owner can update any username"
  on usernames for update
  using (public.is_site_owner()) with check (public.is_site_owner());
