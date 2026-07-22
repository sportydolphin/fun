-- Game-start reminder preference columns on user_preferences.
-- Run once in the Supabase SQL editor. Both columns are additive and default to
-- "off / 5 minutes", so existing rows keep working and the client degrades
-- gracefully (falls back to localStorage) until this has run.

alter table public.user_preferences
  add column if not exists notify_game_start   boolean not null default false,
  add column if not exists game_start_lead_min integer not null default 5;
