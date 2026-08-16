-- notify_wpbl_all_games — a standing opt-in for a reminder before EVERY WPBL game,
-- rather than one row per game.
--
-- Why: the only way to ask for a WPBL reminder was the bell on the Home next-game card,
-- which writes a single wpbl_game_reminders row for that one game. A fan who wants a nudge
-- before every game had to come back and tap it again after each one, and there was no way
-- to express "all of them".
--
-- DELIBERATELY NOT BACKFILLED. Existing wpbl_game_reminders rows are consent for one named
-- game, and turning that into a standing subscription to all thirty would be widening
-- consent on the user's behalf. That is the same mistake notify_pick_reminders was added to
-- fix. Everyone starts off and opts in themselves.
--
-- Per-game rows keep working: send-wpbl-game-start.mjs now sends to the union of users with
-- this preference and users with a row for the specific game, so nobody loses a reminder
-- they already asked for.

alter table public.user_preferences
  add column if not exists notify_wpbl_all_games boolean not null default false;

comment on column public.user_preferences.notify_wpbl_all_games is
  'Standing opt-in for a push before every WPBL game. Unioned with per-game '
  'wpbl_game_reminders rows by scripts/send-wpbl-game-start.mjs.';
