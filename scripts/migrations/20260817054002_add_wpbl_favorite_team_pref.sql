-- A WPBL favourite team on user_preferences.
--
-- Its own column rather than reusing `followed_team_id`: that one is an integer MLB
-- StatsAPI team id, while WPBL team ids are our own text slugs ('SF', 'NY', 'BOS', 'LA').
-- Sharing the column would mean a type change plus a rule about which league a given
-- number belongs to, for no saved space.
--
-- Nullable, and null is a real state with a real meaning: "never asked, or asked and
-- declined" — the client keeps its own record of whether the prompt has been answered, so
-- null here never re-triggers the prompt on another device. The value is a team id and is
-- NOT foreign-keyed to wpbl_teams: the roster of teams is mirrored from the league feed, and
-- a feed reshuffle that dropped a team row should leave a stale favourite pointing nowhere
-- rather than block writes to a preferences table. The client falls back to "no favourite"
-- when the id doesn't resolve.
alter table public.user_preferences
  add column if not exists wpbl_favorite_team_id text;

comment on column public.user_preferences.wpbl_favorite_team_id is
  'WPBL team id (text slug, e.g. ''SF''). Null = no favourite chosen. Not FK''d — a stale id degrades to no favourite client-side.';
