-- add wpbl games tracking checked at
-- Created 2026-09-04. Applied by scripts/migrate.mjs.
--
-- WHAT THIS IS FOR. `wpbl-ingest` re-fetches the box score of every final under 21 days old
-- that still has no pitch-tracking rows, because the league reconciles TrackMan in batches
-- that land days after a game ends and the every-two-minutes pass skips a stored final.
--
-- The gate had no memory, so "still has no tracking" was re-asked every two minutes forever.
-- The league published tracking for the Aug 1 and Aug 2 games and has published none since:
-- as of Sep 4, 2026 that was 17 games being re-read 30 times an hour, a box score and a paged
-- activity call each, around 24,000 requests a day to the league's API and roughly 1.2M row
-- upserts, for data that has not existed for a month. scripts/wpbl_cron.sql still says
-- "finished games stop costing anything"; this is what made that untrue.
--
-- Tracking that arrives days late does not need a two-minute poll. This column records when we
-- last LOOKED at a game's tracking, so the backfill can ask once an hour instead: same window,
-- same self-healing behaviour, 30 times less of it.
--
-- Null means never looked at, which is what every existing row wants: the first pass after this
-- lands checks each of them once and then leaves them alone for an hour. The ingest stamps it
-- on every box-score fetch, so a game that has just gone final is already fresh and is not
-- re-read a second time on the next pass.
--
-- Not an index: the gate reads it off the same 30-row `wpbl_games` scan the ingest already does
-- to build its api_game_id map, and a season is a few hundred rows even with a postseason.

alter table public.wpbl_games
  add column if not exists tracking_checked_at timestamptz;

comment on column public.wpbl_games.tracking_checked_at is
  'When wpbl-ingest last read this game''s box score looking for pitch tracking. Throttles the '
  'late-TrackMan backfill to hourly; null means never checked.';
