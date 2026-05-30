-- Run in Supabase SQL editor (Dashboard → SQL Editor)

create table if not exists usernames (
  user_id    text primary key,
  username   text not null,
  created_at timestamptz not null default now(),
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
