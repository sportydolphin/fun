-- Run this once in your Supabase SQL editor, AFTER deploying the wpbl-ingest function
-- (`supabase functions deploy wpbl-ingest`). It schedules the feed refresh with pg_cron.
--
-- Two things to fill in below:
--   1. <PROJECT_REF>       — your project ref (the subdomain of your Supabase URL,
--                            e.g. https://abcd1234.supabase.co → abcd1234).
--   2. the service-role key — pulled from Vault (set once, just below) so it never
--                            sits in plaintext in the cron command.
--
-- The job POSTs {"mode":"active"} every 2 minutes: cheap, only re-fetches boxscores for
-- games that aren't already final in our DB (scheduled→live→final transitions), so a
-- live game's box score + play-by-play refresh within ~2 min, and finished games stop
-- costing anything. Adjust the schedule to taste.

-- ─── Extensions (no-ops if already enabled) ───────────────────────────────────
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net  with schema extensions;

-- ─── Stash the service-role key in Vault (run once; replace the value) ─────────
-- The service-role key is under Dashboard → Settings → API. If you re-run this file,
-- delete the old secret first (select vault.delete_secret('wpbl_service_role_key')).
select vault.create_secret('PASTE_YOUR_SERVICE_ROLE_KEY_HERE', 'wpbl_service_role_key');

-- ─── Schedule: refresh the feed every 2 minutes ───────────────────────────────
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
  );
  $$
);

-- ─── Handy management commands (for reference) ────────────────────────────────
-- Inspect the job:            select * from cron.job where jobname = 'wpbl-ingest-active';
-- See recent runs:            select * from cron.job_run_details order by start_time desc limit 20;
-- Unschedule:                 select cron.unschedule('wpbl-ingest-active');
-- One-off FULL backfill call (also runnable from the Dashboard → Edge Functions tester,
-- or curl): POST the function with {"mode":"all"} once to pull every game's boxscore.
