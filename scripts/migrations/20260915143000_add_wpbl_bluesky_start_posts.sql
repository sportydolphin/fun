-- wpbl_bluesky_start_posts: which upcoming games have had a "starting soon" reminder posted to
-- Bluesky, so each is posted exactly once.
--
-- THE PRE-GAME TWIN OF wpbl_bluesky_recap_posts, and the same reasoning: Bluesky has NO EDIT and
-- NO UNDO, so a reminder is published once or not at all. But the two windows point opposite
-- ways. The recap waits for a final to SETTLE so a late scoring correction cannot strand a wrong
-- box score in public. This one is the reverse: a reminder is only worth anything BEFORE first
-- pitch, and a permanent "first pitch soon" left over a game already in the 5th inning is the
-- exact failure to avoid. So the poster publishes only inside a short window before the game and
-- never once it has started, and this row is what keeps it to one post.
--
-- NO first_final_at, NO dispatched_at, NO seed run. The recap table needed a settle basis and its
-- own dispatch column (it predates the generic dispatcher below), plus a seed to record a season
-- of past finals as handled. None of that applies here: the poster only ever looks at SCHEDULED
-- games in a ~25-minute window, so there is no backlog to flood, nothing to seed, and the
-- dispatch gate lives in wpbl_workflow_dispatches with every other nudge. A row here is only ever
-- the record that a reminder was posted, or deliberately not.
create table if not exists public.wpbl_bluesky_start_posts (
  game_id        uuid primary key references public.wpbl_games (id) on delete cascade,
  posted_at      timestamptz,
  -- The at:// uri and cid of the published reminder, kept so a wrong one can be found and deleted
  -- by hand. Without the uri there is no way back to a post except scrolling the timeline.
  post_uri       text,
  post_cid       text,
  -- Set when the poster closes a game without publishing: the window had passed before any run
  -- reached it. A row with this set is never posted.
  skipped_reason text
);

-- The job's one hot query: games not yet resolved either way.
create index if not exists wpbl_bluesky_start_posts_pending_idx
  on public.wpbl_bluesky_start_posts (game_id)
  where posted_at is null and skipped_reason is null;

comment on table public.wpbl_bluesky_start_posts is
  'Which upcoming WPBL games have had a Bluesky game-start reminder posted, written by '
  'scripts/post-wpbl-bluesky-game-start.ts. Bluesky posts cannot be edited, so each game is '
  'posted once, inside a short window before first pitch and never after the game has started.';

-- Server-only bookkeeping, same as every other posting job: RLS on, no policies, so the anon and
-- authenticated keys read it as empty. The job uses the service role and bypasses it.
alter table public.wpbl_bluesky_start_posts enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Post the reminder when the game is about to start, not when GitHub gets round to it.
--
-- GitHub runs this repo's `schedule` events 5 to 7 times a day whatever the cron says (see
-- migration 20260907154954). A recap landing hours late is merely late; a game-start reminder has
-- a ~25-minute window, so on the schedule alone it would miss almost every game or post one after
-- it had started. So pg_cron watches for a game entering the window and dispatches through the
-- shared wpbl_dispatch_workflow, exactly like the push reminder's nudge beside it.
--
-- COARSE ON PURPOSE; THE POSTER IS THE ONLY DECIDER. This estimates first pitch as the wall clock
-- read in Central and fires on a WIDE window around it. The poster then re-checks with the full
-- correction logic (the league calendar and the rain-delay map in src/wpbl/startTimes.ts, neither
-- of which SQL can see) and is the only thing that publishes. A nudge that fires early just wakes
-- a runner that finds nothing due; a nudge that fails to fire is a missed reminder, so it errs
-- wide. The one case it cannot cover is a game the league moved LATER on the day (a rain delay
-- lives only in the TypeScript map): SQL nudges around the original time, the poster declines, and
-- that game falls to the schedule backstop. A missed reminder is acceptable; a wrongly-timed
-- permanent post is not.
--
-- The site-calendar start overrides the feed's here too, the same precedence applyLeagueStartTimes
-- uses, so a stale feed time does not park the whole window in the wrong place.
create or replace function public.wpbl_nudge_bluesky_game_start()
returns boolean
language plpgsql
set search_path = public
as $$
declare
  due boolean;
begin
  select exists (
    select 1
    from public.wpbl_games g
    left join public.wpbl_bluesky_start_posts p on p.game_id = g.id
    left join lateral (
      select sg.start_time
      from public.wpbl_site_games sg
      where sg.game_date = g.game_date
        and sg.home_team_id = g.home_team_id
        and sg.away_team_id = g.away_team_id
        and sg.start_time is not null
      limit 1
    ) sg on true
    cross join lateral (select coalesce(sg.start_time, g.start_time) as start_time) eff
    where g.status = 'scheduled'
      -- A castable wall clock only. A null or oddly-shaped start would raise on the cast, and a
      -- game with no usable time is one the poster could not place in a window anyway.
      and eff.start_time ~ '^\d{1,2}:\d{2} (AM|PM)$'
      and ((g.game_date::text || ' ' || eff.start_time)::timestamp at time zone 'America/Chicago')
          between now() - interval '12 minutes' and now() + interval '40 minutes'
      -- Unresolved: never posted, never deliberately skipped.
      and p.posted_at is null
      and p.skipped_reason is null
  ) into due;
  if not due then
    return false;
  end if;
  -- A four-minute gate, so a five-minute pg_cron always clears it and a hand-scheduled duplicate
  -- cannot double the rate. Also the retry: a failed run leaves posted_at null and the next tick
  -- past the gap asks again.
  return public.wpbl_dispatch_workflow('wpbl-bluesky-game-start', '', interval '4 minutes');
end;
$$;

comment on function public.wpbl_nudge_bluesky_game_start() is
  'Fires a GitHub repository_dispatch when a WPBL game is about to start, so the Bluesky '
  'game-start reminder does not wait on GitHub''s schedule event. Coarse by design; the poster '
  're-checks the window with the full start-time correction. Scheduled by pg_cron every 5 '
  'minutes; see scripts/wpbl_cron.sql.';

-- It reads a token (through wpbl_dispatch_workflow) and can start a workflow. Only pg_cron may
-- call it.
revoke all on function public.wpbl_nudge_bluesky_game_start() from public;
revoke all on function public.wpbl_nudge_bluesky_game_start() from anon, authenticated;

-- Scheduled in the migration rather than left for a hand-run of scripts/wpbl_cron.sql, the same as
-- the sibling nudges: a bridge that exists and is not scheduled looks exactly like one that works.
-- cron.schedule replaces a job of the same name, so re-running this file is safe.
select cron.schedule('wpbl-bluesky-start-nudge', '*/5 * * * *', $$ select public.wpbl_nudge_bluesky_game_start(); $$);
