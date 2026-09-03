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

-- ─── Stash a GitHub token in Vault (run once; replace the value) ──────────────
-- Only for the nudge below. A FINE-GRAINED personal access token on sportydolphin/fun alone,
-- with "Contents: read and write" (which is what repository_dispatch is filed under; there is
-- no narrower permission for it) and nothing else. Give it an expiry and put a reminder in the
-- calendar: when it lapses the nudge stops and the workflow falls back to GitHub's schedule,
-- which is hours late but not broken, so nothing will alert you.
--
-- Never a classic token: those carry every repo and every scope on the account.
select vault.create_secret('PASTE_A_FINE_GRAINED_GITHUB_PAT_HERE', 'github_dispatch_token');

-- ─── Nudge: post to Bluesky when the game is ready, not when GitHub wakes up ───
-- WHY THIS EXISTS. `.github/workflows/wpbl-bluesky-recaps.yml` asks for '*/15 * * * *'. Over the
-- thirty scheduled runs before Sep 3, 2026 the real gaps were 130 to 452 minutes, and the daily
-- workflows in the repo ran four to eleven hours late over the same week. GitHub is
-- deprioritising this repository's schedule events, every run still goes green, and no cron
-- expression changes it. pg_cron is punctual because it is ours, so the database watches for a
-- settled final and pokes GitHub with a repository_dispatch, which is on-demand.
--
-- Every 5 minutes, and cheap: one indexed query against a 30-row table, and no HTTP at all
-- unless there is a game due. It self-limits to one dispatch per game per 20 minutes, which is
-- also the retry for a workflow run that fails.
select cron.schedule(
  'wpbl-bluesky-nudge',
  '*/5 * * * *',
  $$ select public.wpbl_bluesky_nudge(); $$
);

-- Did it work? The function returns how many games it dispatched for, so a hand call is the
-- quickest check (it will return 0 whenever nothing is due, which is nearly always):
--   select public.wpbl_bluesky_nudge();
-- And what the database asked GitHub, most recent first:
--   select created, status_code, content from net._http_response order by created desc limit 5;
--     -- a 204 is a dispatch GitHub accepted; a 404 with a fine-grained token almost always
--     -- means the token is missing "Contents: write" rather than that the repo is wrong.

-- ─── Check what is ACTUALLY scheduled ─────────────────────────────────────────
-- Worth doing occasionally: what this file schedules and what the database is running can
-- drift (a hand-edited schedule, or a second job scheduled under another name during
-- debugging). As of Aug 2026 wpbl_ingest_runs showed a pass roughly every 30 SECONDS, i.e.
-- about 4x what the line above asks for — harmless, but four times the edge-function
-- invocations and four times the pulls from the league's feed for no extra freshness.
--
--   select jobid, jobname, schedule, active from cron.job;                    -- what runs
--   select count(*) from wpbl_ingest_runs where created_at > now() - '10 min'::interval;
--     -- ~5 over ten minutes is the every-2-minutes this file intends; ~20 is every 30s
--
-- To put it back to every two minutes (unschedule the stray job first, if there is one):
--   select cron.unschedule('<jobname>');
--   select cron.alter_job((select jobid from cron.job where jobname = 'wpbl-ingest-active'),
--                         schedule := '*/2 * * * *');

-- ─── Handy management commands (for reference) ────────────────────────────────
-- Inspect the job:            select * from cron.job where jobname = 'wpbl-ingest-active';
-- See recent runs:            select * from cron.job_run_details order by start_time desc limit 20;
-- Unschedule:                 select cron.unschedule('wpbl-ingest-active');
--                             select cron.unschedule('wpbl-bluesky-nudge');
-- One-off FULL backfill call (also runnable from the Dashboard → Edge Functions tester,
-- or curl): POST the function with {"mode":"all"} once to pull every game's boxscore.
