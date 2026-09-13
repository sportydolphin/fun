-- nudge the admin health-alert workflow from pg_cron
-- Created 2026-09-12. Applied by scripts/migrate.mjs.
--
-- The admin-health-alert workflow is the one that pages the owner when a pipeline breaks, so of
-- everything in this repo it is the WORST one to leave at the mercy of GitHub's schedule: the
-- 20260907154954 migration measured this repo's scheduled runs at 5 to 7 a day against a `*/10`
-- cron, which would turn a "you find out in ~15 minutes" alarm into "you find out sometime
-- today". pg_cron is punctual (it drives wpbl-ingest every two minutes, on time, all season), so
-- the database pokes the workflow with a repository_dispatch instead, exactly as the shop /
-- game-start / tracking nudges do. Reuses public.wpbl_dispatch_workflow, so there is no new
-- token, table, or HTTP call here — only the condition and the schedule.
--
-- The workflow's own `schedule:` line stays as the backstop for the day the token in Vault
-- expires; see the note in 20260907154954 and scripts/wpbl_cron.sql.

/**
 * Ask GitHub to run the health check, but only while there is baseball to have a pipeline for.
 *
 * WHY THE SEASON GATE. The ingest pg_cron runs every two minutes all season, so in-season the
 * mirror is never more than two minutes stale and `healthAlerts`' 15-minute staleness check only
 * ever fires on a real stall. Off-season the feed stops (Sep 22 in 2026) and the ingest is
 * legitimately quiet, and a check run then would read that quiet as a stall and page a false
 * alarm. Gating on games in a small window around today scopes the health check to when the
 * pipelines are actually expected to run, the same way wpbl_nudge_game_start scopes itself to a
 * game being near. Date-based rather than status-based so it does not itself depend on the ingest
 * that may be the thing that broke.
 *
 * If pg_cron itself dies, this nudge dies with it and nothing pages — but the workflow's GitHub
 * `schedule:` backstop still fires (late, but it fires), which is the one failure this cannot
 * cover from inside the database anyway.
 */
create or replace function public.wpbl_nudge_admin_health()
returns boolean
language plpgsql
set search_path = public
as $$
declare
  in_season boolean;
begin
  select exists (
    select 1 from public.wpbl_games g
    where g.game_date between ((now() at time zone 'America/Chicago')::date - 2)
                          and ((now() at time zone 'America/Chicago')::date + 3)
  ) into in_season;
  if not in_season then
    return false;
  end if;
  -- 14-minute gap under a 15-minute cron: the tick always clears it, and a second job scheduled
  -- by hand cannot double the rate (the ingest was once found running at 4x its schedule).
  return public.wpbl_dispatch_workflow('admin-health', '', interval '14 minutes');
end;
$$;

comment on function public.wpbl_nudge_admin_health() is
  'pg_cron nudge for the admin-health-alert workflow, gated to the season so an off-season quiet '
  'ingest is not read as a stall. Reuses wpbl_dispatch_workflow. See scripts/wpbl_cron.sql.';

-- Reads a token and can start a workflow; only pg_cron (postgres) may call it.
revoke all on function public.wpbl_nudge_admin_health() from public;
revoke all on function public.wpbl_nudge_admin_health() from anon, authenticated;

-- Scheduled here rather than left for a hand-run of scripts/wpbl_cron.sql, because a bridge that
-- exists and is not scheduled looks exactly like one that works. cron.schedule replaces a job of
-- the same name, so re-running this file is safe.
select cron.schedule('admin-health-nudge', '*/15 * * * *', $$ select public.wpbl_nudge_admin_health(); $$);
