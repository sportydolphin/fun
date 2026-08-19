-- wpbl_tracking_watch: one row remembering how far the league's TrackMan publishing had got
-- the last time we looked, so that it resuming is something we get TOLD about.
--
-- WHY THIS EXISTS. The Home screen used to carry a "Ballpark tracking" teaser card, hidden
-- automatically once the league's radar publishing fell more than three days behind the
-- schedule. The league stopped publishing after the first couple of games, so the card
-- rendered never, and a card that never renders is not a monitor: nobody was going to notice
-- the feed coming back, because the only thing watching for it was a component that had
-- already hidden itself. The card is gone and this is what replaced it.
--
-- WHAT IT IS NOT. It is not the visitor-facing cue. `NewTrackingBanner` in Home.tsx still
-- tells a READER when the tracked-game set has grown since their browser last saw it, out of
-- localStorage. That is per-browser and only fires if somebody visits. This table is the
-- server's memory, so the alert fires whether or not anyone is looking.
--
-- WHY A WATERMARK AND NOT A LOG OF ANNOUNCED GAMES. The league publishes tracking in batches
-- that land days late and often cover several games at once. The interesting event is "the
-- feed moved", once per batch, not "this game got tracked", once per game. A row-per-game
-- dedupe table (the shape wpbl_discord_recap_posts uses) would turn one backfill of twelve
-- games into twelve messages.

create table if not exists public.wpbl_tracking_watch (
  -- Singleton. `id` is a boolean that may only be true, which is the cheapest way to say
  -- "there is exactly one of these" in a schema rather than in a convention nobody reads.
  id                     boolean primary key default true,
  constraint wpbl_tracking_watch_singleton check (id),

  -- ─── What the last check saw ─────────────────────────────────────────────
  -- Newest game date that carries any tracking, and how many games do. Both move when a
  -- batch lands; the date is what the alert is about, and the count catches a backfill that
  -- fills in older games without extending the front edge.
  last_tracked_game_date date,
  tracked_game_count     int not null default 0,
  -- Newest game that has gone final, so the admin surface can show the lag without
  -- recomputing it, and so the alert can say how far behind the feed still is.
  last_final_game_date   date,

  last_checked_at        timestamptz,   -- every run, so silence is distinguishable from a dead job
  last_advanced_at       timestamptz,   -- when the watermark actually moved
  last_notified_at       timestamptz,   -- when we last said so out loud
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

alter table public.wpbl_tracking_watch enable row level security;

-- Public read, owner writes: the same shape as wpbl_ingest_runs, and for the same reason.
-- The admin panel reads this row to show whether the TrackMan feed is alive, and there is
-- nothing in it that is not already derivable from the public wpbl_pitch_tracking table.
drop policy if exists "WPBL tracking watch is public" on public.wpbl_tracking_watch;
create policy "WPBL tracking watch is public" on public.wpbl_tracking_watch for select using (true);

drop policy if exists "Owner writes WPBL tracking watch" on public.wpbl_tracking_watch;
create policy "Owner writes WPBL tracking watch" on public.wpbl_tracking_watch
  for all using (public.is_site_owner()) with check (public.is_site_owner());
