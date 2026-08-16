-- notify_pick_reminders — an explicit opt-in for the daily "make your picks" push.
--
-- THE BUG THIS FIXES. scripts/send-reminders.mjs selected every row in
-- push_subscriptions and pushed MLB pick reminders to all of them. A push subscription is a
-- DEVICE REGISTRATION, not a statement of what someone wants to hear about — but it was
-- being used as the consent record for this one notification type. Anything that needed to
-- send a push therefore silently signed the user up for pick reminders too.
--
-- The WPBL "remind me before this game" bell is exactly that: it calls the same enablePush()
-- as the MLB settings toggle (see src/wpbl/reminders.ts), because a reminder can't be
-- delivered without a subscription. So a WPBL fan who wanted one game-start nudge started
-- getting a daily MLB predictions notification for a game they don't play.
--
-- At the time of writing that was 6 of 7 subscribed users receiving a daily prompt to make
-- picks, having never made a single one between them.
--
-- The other two senders were already correct and are untouched: send-game-start.mjs gates on
-- user_preferences.notify_game_start, and send-wpbl-game-start.mjs gates on rows in
-- wpbl_game_reminders. This column follows the notify_game_start pattern deliberately.

alter table public.user_preferences
  add column if not exists notify_pick_reminders boolean not null default false;

-- Backfill. Default false means nobody gets these again until they ask, which is the point.
-- The one exception is a user who has BOTH subscribed to push AND actually made predictions:
-- that pairing is the strongest evidence of consent available after the fact, and switching
-- them off would be a silent regression for the people the feature is for. Anyone with a
-- subscription but no prediction history — the WPBL cohort this is fixing — stays off.
insert into public.user_preferences (user_id, notify_pick_reminders, updated_at)
select distinct s.user_id, true, now()
from public.push_subscriptions s
where exists (select 1 from public.game_predictions g where g.user_id = s.user_id)
on conflict (user_id) do update set
  notify_pick_reminders = true,
  updated_at = now();

comment on column public.user_preferences.notify_pick_reminders is
  'Explicit opt-in for the daily pick-reminder push (scripts/send-reminders.mjs). A push '
  'subscription alone must never be treated as consent for this.';
