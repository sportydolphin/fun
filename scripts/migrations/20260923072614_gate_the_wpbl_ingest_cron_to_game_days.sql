-- gate the wpbl ingest cron to game days
-- Created 2026-09-23. Applied by scripts/migrate.mjs.
--
-- The feed went quiet on Sep 22, 2026 and wpbl-ingest-active kept polling it every two minutes:
-- 720 edge-function calls and 720 wpbl_ingest_runs rows a day, each one reading a feed with
-- nothing new in it, until spring. Unscheduling it for the winter would work until the day
-- somebody forgets to schedule it again, and the first 2027 game would then happen with no row
-- on the site, the same silent shape as the Sep 9 postseason outage.
--
-- So the job stays on its */2 schedule and decides for itself whether a tick is worth a call:
-- every tick near a game date, four times a day otherwise. The four-a-day floor is what makes
-- this self-reopening. It keeps reading /games all winter, so the day the league publishes a
-- 2027 schedule those rows land here, and as the first date comes inside the window the
-- two-minute cadence comes back with nobody touching anything. wpbl_site_games counts too, because
-- the league's website calendar has carried fixtures the feed had not yet published (it held all
-- eleven postseason games while the feed held none), and wpbl-site-calendar keeps syncing it.
--
-- The window is the same [-2, +3] Central days wpbl_nudge_admin_health uses, so "the ingest is
-- expected to run every two minutes" and "a quiet ingest is a stall" are one definition, not two
-- that can drift apart. A game still reading 'live' also keeps it hot, whatever its date: the
-- feed has published a finished game back into "In Progress" before (Sep 10), and polling that
-- one every two minutes is the cheap side of being wrong.
--
-- The drift checker is unaffected: it re-ingests by { gameId } directly, not through this job.

/** True when this two-minute tick should call wpbl-ingest. */
create or replace function public.wpbl_ingest_due()
returns boolean
language sql
stable
set search_path = public
as $$
  select
    exists (
      select 1 from public.wpbl_games g
      where g.game_date between ((now() at time zone 'America/Chicago')::date - 2)
                            and ((now() at time zone 'America/Chicago')::date + 3)
         or g.status = 'live'
    )
    or exists (
      select 1 from public.wpbl_site_games s
      where s.game_date between ((now() at time zone 'America/Chicago')::date - 2)
                            and ((now() at time zone 'America/Chicago')::date + 3)
    )
    -- The off-season floor: the :00 tick of 00, 06, 12 and 18 UTC. `< 2` rather than `= 0` so a
    -- tick pg_cron starts a few seconds late still counts, and the */2 schedule means exactly one
    -- tick falls inside it.
    or (extract(minute from now() at time zone 'UTC') < 2
        and extract(hour from now() at time zone 'UTC')::int % 6 = 0);
$$;

comment on function public.wpbl_ingest_due() is
  'Whether a wpbl-ingest-active tick should call the edge function: every tick within [-2, +3] '
  'Central days of a game (feed or site calendar) or while a game reads live, else four times a '
  'day, so a newly published season reopens the two-minute cadence on its own.';

revoke all on function public.wpbl_ingest_due() from public;
revoke all on function public.wpbl_ingest_due() from anon, authenticated;

-- cron.schedule replaces a job of the same name, so this rewrites the command in place and
-- re-running the file is safe. Same URL, key and body as scripts/wpbl_cron.sql; only the WHERE
-- is new. pg_net's http_post under a false WHERE is never evaluated, so a skipped tick costs one
-- indexed query and no HTTP.
select cron.schedule(
  'wpbl-ingest-active',
  '*/2 * * * *',
  $$
  select net.http_post(
    url     := 'https://jyqswdnbwwkmgvfkexiw.supabase.co/functions/v1/wpbl-ingest',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'wpbl_service_role_key')
    ),
    body    := jsonb_build_object('mode', 'active')
  )
  where public.wpbl_ingest_due();
  $$
);

-- Checks:
--   select public.wpbl_ingest_due();   -- false most of the winter, true at 00/06/12/18 UTC
--   select jobname, schedule, command from cron.job where jobname = 'wpbl-ingest-active';
--   select ran_at, ok from wpbl_ingest_runs order by ran_at desc limit 8;   -- ~6h apart off-season
