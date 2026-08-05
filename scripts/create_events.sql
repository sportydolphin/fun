-- Run this once in your Supabase SQL editor (Dashboard → SQL Editor).
--
-- First-party product-analytics events. This is the counterpart to Cloudflare Web
-- Analytics: Cloudflare answers "how much traffic, to which pages"; this table
-- answers "what did people actually DO" — made a prediction, signed in, came back —
-- joined to our own user ids. Rows are written by the site (src/lib/analytics.ts)
-- and never shared with any third party.
--
-- Writes are open to everyone (anon + authenticated), like feedback, so a visitor
-- doesn't need an account to be counted. Two guards keep an open-insert log honest:
-- a signed-in row can only carry the caller's own verified user_id (no spoofing
-- someone else), and the event name is length-capped. Reads are owner-only via the
-- same non-spoofable is_site_owner() gate used by the feedback table.
--
-- NOTE: page views are already covered (cookielessly) by Cloudflare Web Analytics —
-- do not log them here. Keep this table for product actions tied to a user.

create table if not exists events (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id    uuid,                                  -- null for signed-out visitors
  session_id text,                                  -- random per-browser id (localStorage); groups a visitor's events before sign-in
  event      text not null,                         -- event name, e.g. 'prediction_made'
  props      jsonb not null default '{}'::jsonb,    -- small structured payload; keep it free of personal data
  path       text,                                  -- route the event fired on (e.g. /mlb)
  constraint events_event_len  check (char_length(event) between 1 and 64),
  constraint events_path_len   check (char_length(coalesce(path, '')) <= 512),
  constraint events_props_size check (pg_column_size(props) <= 4096)
);

-- Owner reads newest-first; the extra indexes serve the two questions worth asking:
-- "how did event X trend over time" and "what did this user do, in order".
create index if not exists events_created_idx   on events (created_at desc);
create index if not exists events_name_time_idx on events (event, created_at desc);
create index if not exists events_user_time_idx on events (user_id, created_at desc) where user_id is not null;

alter table events enable row level security;

-- Non-spoofable owner check. Defined identically to scripts/create_feedback.sql /
-- harden_admin_gate.sql — repeated here so this migration stands alone; re-running
-- it is harmless. Reads the confirmed email from auth.users by the caller's verified
-- auth.uid(), so no tampered client value can pass it.
create or replace function public.is_site_owner()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from auth.users
    where id = auth.uid() and email = 'snichols246@gmail.com' and email_confirmed_at is not null
  );
$$;
revoke all on function public.is_site_owner() from public;
grant execute on function public.is_site_owner() to authenticated;

-- Anyone may record an event, BUT a row that claims a user_id must match the
-- caller's own verified auth.uid() (anon callers pass null). This stops one client
-- from writing events attributed to a different account.
create policy "Anyone can record events"
  on events for insert
  with check (user_id is null or user_id = auth.uid());

-- Reads are owner-only — analytics stay private to the site owner.
create policy "Owner can read events"
  on events for select using (public.is_site_owner());

-- Owner can prune the log (e.g. drop test rows). No update policy: events are an
-- append-only record and shouldn't be edited in place.
create policy "Owner can delete events"
  on events for delete using (public.is_site_owner());
