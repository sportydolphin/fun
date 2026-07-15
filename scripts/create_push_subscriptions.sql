-- push_subscriptions — one row per browser/device a user has opted into Web Push on.
-- Run this once in the Supabase SQL editor (or via the CLI) before enabling
-- notifications. See docs/PUSH_NOTIFICATIONS.md for the full setup walkthrough.

create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_id_idx
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

-- A signed-in user can see, add, and remove only their own subscriptions.
-- The server-side sender uses the service role key, which bypasses RLS.
drop policy if exists "own subscriptions - select" on public.push_subscriptions;
create policy "own subscriptions - select" on public.push_subscriptions
  for select using (auth.uid() = user_id);

drop policy if exists "own subscriptions - insert" on public.push_subscriptions;
create policy "own subscriptions - insert" on public.push_subscriptions
  for insert with check (auth.uid() = user_id);

drop policy if exists "own subscriptions - update" on public.push_subscriptions;
create policy "own subscriptions - update" on public.push_subscriptions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own subscriptions - delete" on public.push_subscriptions;
create policy "own subscriptions - delete" on public.push_subscriptions
  for delete using (auth.uid() = user_id);
