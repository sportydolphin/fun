-- Schedule the Substack mirror hourly, on Supabase rather than GitHub Actions.
--
-- WHY IT MOVED. Substack serves Cloudflare's JavaScript interstitial to datacenter address
-- space, and it covers every host it owns: her publication's archive API, her publication's
-- RSS feed, and substack.com itself all answer 403 from a GitHub Actions runner. Seven
-- scheduled runs, seven failures, and no header tuning reaches it because the challenge wants
-- a client that executes JavaScript. Supabase's egress is not challenged: probed with pg_net
-- before any of this was built, all three endpoints answer 200 including the feed at full
-- size, so the mirror running here is fully equivalent to one running on a laptop rather than
-- a degraded version of it. See docs/READING.md for the table.
--
-- HOURLY, not every two minutes like wpbl-ingest. She publishes about twice a week, so the
-- ceiling on staleness is what matters and an essay is no less good on the site an hour after
-- it lands. Each pass is one request to the profile endpoint, one to the feed, and a 20-row
-- upsert, so this is cheap; it is paced for her sake rather than ours.
--
-- Reuses the `wpbl_service_role_key` Vault secret that wpbl-ingest already schedules with, so
-- there is no new secret to create and nothing sits in plaintext in the command. The function
-- authorises on the JWT's `role` claim, so a rotated key keeps working as long as Vault holds
-- a current one.
--
-- Requires the function to be deployed first:
--   supabase functions deploy wpbl-substack-sync

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net  with schema extensions;

-- Idempotent: unschedule any previous copy before scheduling, so re-running this file (or a
-- rename during debugging) cannot leave two jobs both syncing the same rows on the hour.
do $$
begin
  perform cron.unschedule('wpbl-substack-sync');
exception when others then
  null;  -- not scheduled yet, which is the normal case on a first run
end $$;

select cron.schedule(
  'wpbl-substack-sync',
  '17 * * * *',   -- 17 past, to stay clear of the crowd of jobs that fire on the hour
  $$
  select net.http_post(
    url     := 'https://jyqswdnbwwkmgvfkexiw.supabase.co/functions/v1/wpbl-substack-sync',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'wpbl_service_role_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- Handy checks:
--   select jobid, jobname, schedule, active from cron.job where jobname = 'wpbl-substack-sync';
--   select * from cron.job_run_details where jobname = 'wpbl-substack-sync' order by start_time desc limit 5;
--   select count(*), max(updated_at) from wpbl_articles;   -- did a pass actually land
-- Force a run without waiting for the hour, or preview one:
--   npm run substack-sync -- --dry-run
