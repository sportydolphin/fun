-- nudge the throttled workflows from pg_cron
-- Created 2026-09-07. Applied by scripts/migrate.mjs.
--
-- GITHUB IS NOT RUNNING OUR SCHEDULES, AND IT NEVER SAYS SO. Measured Sep 7, 2026 over the last
-- sixty scheduled runs of the shop watcher (203 hours): it asks for `*/10 * * * *`, which is 144
-- runs a day, and got **7.1**. Median gap 3h23m, worst 7h46m, best 1h44m. Not once within an hour
-- of its cron. It is not that workflow: `wpbl-youtube-sync` asks for twice an hour and gets 5.4
-- runs a day, `wpbl-game-start-reminders` the same. Every run goes green. GitHub is deprioritising
-- this repository's `schedule` events and no cron expression changes it.
--
-- The Bluesky poster hit this on Sep 3 and the fix worked: pg_cron is ours and is punctual (it
-- drives wpbl-ingest every two minutes, on time, all season), and `repository_dispatch` is an
-- on-demand event that GitHub runs immediately. Measured on 39 dispatched runs in this repo: 0
-- seconds queued, every one. This migration generalises that one nudge into three more.
--
-- WHAT IT COSTS AND WHY THAT IS FINE. A dispatch is one Actions run. The shop watcher becomes
-- ~144 runs a day where it was 7, which is what the workflow has been asking for since it was
-- written, and Actions minutes are unlimited on a public repository.
--
-- THE `schedule:` LINES STAY IN EVERY WORKFLOW. They are the backstop for the day this token
-- expires, and a job that runs five times a day is worse than one that runs on time and far
-- better than one that does not run at all. Nothing here can tell you the token has lapsed: the
-- nudge warns into the Postgres log, which nobody reads, and the workflow keeps limping along on
-- GitHub's schedule. Put the expiry in a calendar.

-- ─── What has been asked for, and when ────────────────────────────────────────
--
-- Firing is not the same as finishing. A workflow takes a minute or two to install and run, and
-- a nudge running every five minutes would dispatch the same thing again while the first run is
-- still going. This is the record of having asked, and the per-job gate below is also the retry:
-- a run that dies leaves the world unchanged and the next nudge past the gap asks again.
--
-- `key` is what the gate is per: the empty string for a job that is simply a poll, and a game id
-- for one that should fire once per game. Keyed rather than one row per job so a per-game gate
-- needs no new table the day another job wants one.
create table if not exists public.wpbl_workflow_dispatches (
  event_type    text not null,
  key           text not null default '',
  dispatched_at timestamptz not null default now(),
  primary key (event_type, key)
);

comment on table public.wpbl_workflow_dispatches is
  'When pg_cron last asked GitHub to run each workflow, and for what. Not proof the run '
  'happened: it is what keeps a five-minute nudge from dispatching the same job twice, and the '
  'gap in each nudge doubles as that job''s retry. See scripts/wpbl_cron.sql.';

-- Nothing outside pg_cron reads or writes this.
alter table public.wpbl_workflow_dispatches enable row level security;

-- ─── The dispatch itself ──────────────────────────────────────────────────────

/**
 * Ask GitHub to run a workflow, at most once per `p_gap` for this event and key.
 *
 * Returns true when it actually dispatched. Every caller below is a thin condition in front of
 * this, so the HTTP call, the token handling and the gate are written once.
 *
 * NOT SECURITY DEFINER, and execute revoked below: it reads a GitHub token out of Vault and can
 * make GitHub run a workflow, so it must not be reachable through PostgREST by anon or by any
 * signed-in user. pg_cron runs as postgres, which is the only caller it needs.
 */
create or replace function public.wpbl_dispatch_workflow(
  p_event text,
  p_key   text default '',
  p_gap   interval default interval '5 minutes'
)
returns boolean
language plpgsql
set search_path = public, net, vault, extensions
as $$
declare
  token text;
  fresh boolean;
begin
  select not exists (
    select 1 from public.wpbl_workflow_dispatches d
    where d.event_type = p_event and d.key = coalesce(p_key, '')
      and d.dispatched_at > now() - p_gap
  ) into fresh;
  if not fresh then
    return false;
  end if;

  select decrypted_secret into token
  from vault.decrypted_secrets where name = 'github_dispatch_token';

  -- A warning and not an error, the same as wpbl_bluesky_nudge: the workflows still run on
  -- GitHub's own schedule, badly, and a function that raised here would fill the log every few
  -- minutes with something nobody can act on from inside the database.
  if token is null then
    raise warning 'wpbl_dispatch_workflow: no github_dispatch_token in Vault, so % waits for the GitHub schedule. See scripts/wpbl_cron.sql.', p_event;
    return false;
  end if;

  perform net.http_post(
    url     := 'https://api.github.com/repos/sportydolphin/fun/dispatches',
    headers := jsonb_build_object(
      'Content-Type',         'application/json',
      'Accept',               'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28',
      -- GitHub rejects an API request with no user agent outright, with a 403 that says nothing
      -- about the cause. pg_net does not send one.
      'User-Agent',           'sportydolphin-wpbl-nudge',
      'Authorization',        'Bearer ' || token
    ),
    body    := jsonb_build_object('event_type', p_event)
  );

  insert into public.wpbl_workflow_dispatches (event_type, key, dispatched_at)
  values (p_event, coalesce(p_key, ''), now())
  on conflict (event_type, key) do update set dispatched_at = excluded.dispatched_at;

  return true;
end;
$$;

comment on function public.wpbl_dispatch_workflow(text, text, interval) is
  'Fires a GitHub repository_dispatch, gated to once per gap per (event, key), because this '
  'repo''s schedule events run 5 to 7 times a day whatever the cron says. Called only by the '
  'wpbl_nudge_* functions, which pg_cron runs.';

-- ─── One nudge per job ────────────────────────────────────────────────────────

/**
 * The shop watcher, which is a pure poll and has no condition worth checking in SQL.
 *
 * The store is where the news is: 241 of 271 variants were sold out when the watcher was
 * written, and a restock can sell out inside an hour. Running it seven times a day is close to
 * not running it. The gap is nine minutes so a ten-minute pg_cron always clears it and a
 * duplicate job scheduled by hand cannot double the rate (the ingest was found running at four
 * times its schedule once; see scripts/wpbl_cron.sql).
 */
create or replace function public.wpbl_nudge_shop_watch()
returns boolean
language sql
set search_path = public
as $$ select public.wpbl_dispatch_workflow('wpbl-shop-watch', '', interval '9 minutes') $$;

/**
 * The game-start push notifications, which are worthless late.
 *
 * A reader's lead time is their own (`lead_min`, defaulting to 30), so the window here is wide
 * enough to cover any of them and the sender re-checks each one itself: this only decides
 * whether a runner is worth waking. Two hours before the first pitch through five minutes after
 * covers the longest lead anyone can pick and the grace the sender allows.
 *
 * The start instant is built the same way `gameStartMs` builds it in the app: the stored wall
 * clock read in the league's own timezone, DST-safe, never a fixed offset.
 */
create or replace function public.wpbl_nudge_game_start()
returns boolean
language plpgsql
set search_path = public
as $$
declare
  due boolean;
begin
  select exists (
    select 1 from public.wpbl_games g
    where g.status = 'scheduled'
      and g.start_time is not null
      and ((g.game_date::text || ' ' || g.start_time)::timestamp at time zone 'America/Chicago')
          between now() - interval '5 minutes' and now() + interval '2 hours'
  ) into due;
  if not due then
    return false;
  end if;
  return public.wpbl_dispatch_workflow('wpbl-game-start', '', interval '4 minutes');
end;
$$;

/**
 * The TrackMan listener, which has to be CONNECTED before the pitch it exists to catch.
 *
 * Once per game, not once per tick: the job it starts holds a socket for hours, and a second
 * dispatch would queue behind the first and then hold another. Keyed on the game id with a
 * six-hour gap, which is longer than the run itself, so a game gets exactly one listener.
 *
 * Forty minutes ahead. The run needs a minute to install and the socket wants to be open before
 * the first pitch; earlier costs nothing but an idle socket, and the script exits by itself when
 * its own window finds no game.
 */
create or replace function public.wpbl_nudge_tracking_listen()
returns boolean
language plpgsql
set search_path = public
as $$
declare
  game_key text;
begin
  select g.id::text into game_key
  from public.wpbl_games g
  where g.start_time is not null
    and g.status in ('scheduled', 'live')
    and ((g.game_date::text || ' ' || g.start_time)::timestamp at time zone 'America/Chicago')
        between now() - interval '30 minutes' and now() + interval '40 minutes'
  order by g.game_date, g.start_time
  limit 1;

  if game_key is null then
    return false;
  end if;
  return public.wpbl_dispatch_workflow('wpbl-tracking-listen', game_key, interval '6 hours');
end;
$$;

-- All three read a token and can start a workflow. Only pg_cron may call them.
revoke all on function public.wpbl_dispatch_workflow(text, text, interval) from public;
revoke all on function public.wpbl_dispatch_workflow(text, text, interval) from anon, authenticated;
revoke all on function public.wpbl_nudge_shop_watch() from public;
revoke all on function public.wpbl_nudge_shop_watch() from anon, authenticated;
revoke all on function public.wpbl_nudge_game_start() from public;
revoke all on function public.wpbl_nudge_game_start() from anon, authenticated;
revoke all on function public.wpbl_nudge_tracking_listen() from public;
revoke all on function public.wpbl_nudge_tracking_listen() from anon, authenticated;

-- ─── Schedule them ────────────────────────────────────────────────────────────
--
-- In the migration rather than left for a hand-run of scripts/wpbl_cron.sql, because a bridge
-- that exists and is not scheduled looks exactly like one that works. cron.schedule replaces a
-- job of the same name, so re-running this file is safe.
--
-- The tracking nudge is every 5 minutes rather than every 10: its window is forty minutes wide
-- and it fires once per game, so the only thing a finer tick buys is a socket open sooner.
select cron.schedule('wpbl-shop-watch-nudge',      '*/10 * * * *', $$ select public.wpbl_nudge_shop_watch(); $$);
select cron.schedule('wpbl-game-start-nudge',      '*/5 * * * *',  $$ select public.wpbl_nudge_game_start(); $$);
select cron.schedule('wpbl-tracking-listen-nudge', '*/5 * * * *',  $$ select public.wpbl_nudge_tracking_listen(); $$);
