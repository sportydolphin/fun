-- notify_wpbl_resigns: a reader's opt-in to a push each time a club re-signs a player for next
-- season.
--
-- WHY. Re-signings arrive one at a time over a ten-day window (Nov 9 to 20, 2026), announced on
-- Instagram, and are the offseason's only regular news. scripts/watch-wpbl-instagram.mjs now
-- records each one within fifteen minutes; this is how a reader hears about it without watching
-- the rosters page.
--
-- OFF BY DEFAULT, and not inferred from notify_wpbl_all_games. Asking for a reminder before each
-- game is consent to game reminders, not to roster news, the same line the game-reminder opt-in
-- drew when it was added (20260816074835).
--
-- Written by the reader through user_preferences' existing own-row policies, read by the watcher
-- with the service role. No new policy.

alter table public.user_preferences
  add column if not exists notify_wpbl_resigns boolean not null default false;

comment on column public.user_preferences.notify_wpbl_resigns is
  'Opt-in for a push when a WPBL club re-signs a player. Read by scripts/watch-wpbl-instagram.mjs.';
