-- Run in Supabase SQL editor (Dashboard → SQL Editor)

create table if not exists usernames (
  user_id    text primary key,
  username   text not null,
  created_at timestamptz not null default now(),
  is_deleted boolean not null default false,  -- owner soft-delete (admin panel)
  deleted_at timestamptz,
  constraint usernames_username_unique unique (username),
  -- Enforce format: 3-20 chars, letters/numbers/underscores/hyphens only
  constraint usernames_format check (username ~ '^[a-zA-Z0-9_-]{3,20}$')
);

alter table usernames enable row level security;

-- Anyone can read usernames (needed for uniqueness checks + leaderboard display)
create policy "Public read usernames"
  on usernames for select using (true);

-- Authenticated users can insert/update their own row only
create policy "Users manage own username"
  on usernames for all
  using  (auth.uid()::text = user_id)
  with check (auth.uid()::text = user_id);

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

-- Owner can update any row — used to toggle is_deleted from the Admin panel.
create policy "Owner can update any username"
  on usernames for update
  using (public.is_site_owner()) with check (public.is_site_owner());
