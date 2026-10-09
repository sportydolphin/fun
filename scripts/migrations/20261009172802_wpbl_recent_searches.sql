-- WPBL recent searches on user_preferences, so they follow a signed-in reader across devices
-- the way MLB's already do.
--
-- Its own column rather than sharing `recent_searches`: MLB's entries are numeric StatsAPI ids
-- rendered from MLB's team colours and headshot URLs, WPBL's are text ids rendered from the
-- WPBL roster. One list would need a league tag on every entry and each section filtering out
-- the other's, and the 8 / 12 caps would start evicting one league's recents with the other's.
--
-- Entries are `{ type: 'player' | 'team', id: text, name: text }`. Not foreign-keyed: an id
-- that stops resolving (a merged duplicate player, a dropped team row) simply draws nothing,
-- which is what the localStorage copy has always done.

alter table public.user_preferences
  add column if not exists wpbl_recent_searches jsonb not null default '[]'::jsonb;

comment on column public.user_preferences.wpbl_recent_searches is
  'WPBL header-search recents, newest first: [{type, id, name}]. Mirrors localStorage wpbl_recent_searches.';
