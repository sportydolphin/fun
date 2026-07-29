-- Run this once in your Supabase SQL editor (Dashboard → SQL Editor)
--
-- User feedback: a short message anyone can send from the site footer. Signed-in
-- or anonymous, with an optional email for a reply. The site owner reads and acts
-- on them from the in-app Admin panel (and the Supabase dashboard), newest first.
--
-- Writes are open to everyone (anon + authenticated) so a visitor doesn't have to
-- make an account to send a note. Reads/edits/deletes are owner-only: RLS gates them
-- on the signed-in email claim (the same address as src/App.tsx ADMIN_EMAIL), so no
-- other client can see or touch submissions.

create table if not exists feedback (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id    uuid,               -- null for anonymous senders
  email      text,               -- optional reply-to the sender typed in
  message    text not null,
  path       text,               -- route/view the sender was on (e.g. /mlb?view=home)
  user_agent text,               -- browser UA string, for reproducing layout bugs
  handled_at timestamptz          -- null = new/open, set = dealt with (admin queue)
);

-- Owner reads newest-first.
create index if not exists feedback_created_idx on feedback (created_at desc);

alter table feedback enable row level security;

-- Anyone may submit (no user check) — this is a public "leave a note" box.
create policy "Anyone can submit feedback"
  on feedback for insert
  with check (true);

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

-- Owner-only read / update (mark handled) / delete.
create policy "Owner can read feedback"
  on feedback for select using (public.is_site_owner());

create policy "Owner can update feedback"
  on feedback for update using (public.is_site_owner()) with check (public.is_site_owner());

create policy "Owner can delete feedback"
  on feedback for delete using (public.is_site_owner());
