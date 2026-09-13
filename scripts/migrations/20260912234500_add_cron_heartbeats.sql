-- cron_heartbeats: a generic "this job ran, and here is how it went" record, one row per job.
--
-- The pipelines with their own health tables (ingest, scoring, tracking, payrolls) are surfaced
-- on /admin and, since the health-alert cron, paged on. The rest of the fleet — the game-start
-- push sender, the nightly drift checker, the recap sync — are invisible: if one silently stops,
-- nothing shows it, which for the push sender is a user-facing failure (missed reminders) and for
-- the drift checker is a silent-correctness one (league revisions stop being caught). Giving each
-- its own table the way ingest did would be a migration per job; this is the shared version.
--
-- ONE ROW PER JOB, upserted at the end of each run (not an append log): health only ever asks
-- "when did this last run and did it succeed", so a heartbeat is all that is kept. A job that
-- RAN and reported trouble writes ok=false with a detail; a job that hard-CRASHED writes nothing,
-- and its silence is caught as staleness by whatever cadence shared/adminHealth.js expects of it.
--
-- WRITTEN BY the crons themselves, two ways depending on how each reaches the database: the
-- service-role senders (supabase-js) upsert through the client, and the drift checker (a direct
-- SUPABASE_DB_URL pg connection) upserts by SQL. Both bypass RLS. READ publicly, exactly as the
-- ingest and validation run tables are, so the /admin Health group can render it with the anon
-- key without a round trip through an RPC.

create table if not exists public.cron_heartbeats (
  -- The job's stable name, matching the workflow / HEARTBEAT_CHECKS key in shared/adminHealth.js
  -- (e.g. 'wpbl-drift-check'). One row per job.
  job         text primary key,
  -- When the job last finished a run — the freshness the staleness check reads.
  ran_at      timestamptz not null default now(),
  -- Whether that run succeeded. A job that ran but its work failed writes false; a hard crash
  -- writes nothing at all and shows up as staleness instead.
  ok          boolean not null default true,
  -- A short human line for the page and the panel: "3 drifted, 0 missing", or an error message.
  detail      text,
  updated_at  timestamptz not null default now()
);

comment on table public.cron_heartbeats is
  'One row per background job: when it last ran and whether it succeeded. Written by the crons, '
  'read by the /admin Health group and the health-alert cron (shared/adminHealth.js). Public '
  'read, service-role/direct write, same as wpbl_ingest_runs.';

alter table public.cron_heartbeats enable row level security;

-- Public read: this is part of what /admin shows, and it carries only a job name, a timestamp and
-- a short status line — nothing user-scoped. Writes stay with the service role and the direct
-- SUPABASE_DB_URL connection, both of which bypass RLS, so no write policy is needed.
drop policy if exists "cron_heartbeats public read" on public.cron_heartbeats;
create policy "cron_heartbeats public read" on public.cron_heartbeats for select using (true);
