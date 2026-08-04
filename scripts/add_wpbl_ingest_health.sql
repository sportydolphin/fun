-- Run this once in your Supabase SQL editor, AFTER scripts/add_wpbl_api_ingest.sql.
-- Safe to re-run (guarded with `if not exists`).
--
-- INGEST HEALTH LOG — the wpbl-ingest Edge Function writes one row here at the end of
-- every run (success or failure), so we can tell at a glance whether the feed mirror is
-- current. The cron fires every 2 minutes; a "last run" older than that, or one carrying
-- errors, means the mirror is drifting from the official feed. The WPBL admin surfaces
-- this as a small freshness indicator on the home header.

create table if not exists wpbl_ingest_runs (
  id           uuid primary key default gen_random_uuid(),
  ran_at       timestamptz not null default now(),
  mode         text,                       -- 'active' | 'all' | single-game id
  ok           boolean not null default true,
  games        int not null default 0,     -- game rows upserted
  boxscores    int not null default 0,     -- boxscores (re)ingested
  error_count  int not null default 0,
  errors       jsonb,                       -- array of error strings (capped by the function)
  duration_ms  int,
  created_at   timestamptz not null default now()
);
-- Reads only ever want the newest few rows.
create index if not exists wpbl_ingest_runs_ran_at_idx on wpbl_ingest_runs (ran_at desc);

-- Keep the log from growing forever: after each insert, trim to the most recent 200 runs
-- (~7 hours at the 2-minute cadence — plenty for a freshness check and a short history).
create or replace function public.wpbl_trim_ingest_runs() returns trigger
language plpgsql as $$
begin
  delete from wpbl_ingest_runs
  where id in (
    select id from wpbl_ingest_runs order by ran_at desc offset 200
  );
  return null;
end $$;

drop trigger if exists wpbl_trim_ingest_runs_trg on wpbl_ingest_runs;
create trigger wpbl_trim_ingest_runs_trg
  after insert on wpbl_ingest_runs
  for each statement execute function public.wpbl_trim_ingest_runs();

-- ─── RLS: public read (the function writes via the service role, which bypasses RLS) ──
alter table wpbl_ingest_runs enable row level security;
do $$ begin
  create policy "WPBL ingest runs are public" on wpbl_ingest_runs for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Owner writes WPBL ingest runs" on wpbl_ingest_runs for all
    using (public.is_site_owner()) with check (public.is_site_owner());
exception when duplicate_object then null; end $$;
