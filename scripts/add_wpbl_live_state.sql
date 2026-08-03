-- Run once in the Supabase SQL editor, AFTER scripts/add_wpbl_api_ingest.sql.
--
-- Adds the single column the feed-driven live view needs: wpbl_games.live_state, a jsonb
-- snapshot of the official feed's boxscore `status` object (inning, half, outs, count,
-- bases, batter/pitcher, running score) while a game is in progress. wpbl-ingest sets it
-- for live games and nulls it otherwise; the client renders it in the live hero + Game
-- Center banner and auto-updates via realtime (wpbl_games is already in the realtime
-- publication from scripts/add_wpbl_live.sql).

alter table wpbl_games add column if not exists live_state jsonb;
