-- Run in Supabase SQL editor (Dashboard → SQL Editor)
--
-- Adds cross-device "recent searches" to the existing user_preferences table.
-- Safe to run more than once. Until this is applied, recent searches still work
-- via localStorage — they just won't sync across devices.

alter table user_preferences
  add column if not exists recent_searches jsonb not null default '[]'::jsonb;
