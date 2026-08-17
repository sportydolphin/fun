-- wpbl_pbp_validation_runs: one row per nightly play-by-play validation pass.
--
-- The validator finds scoring errors in the league's feed. The question this table answers is
-- narrower and more important day to day: is the check still running, and did anything new
-- turn up. That is a freshness indicator, so it is stored and displayed exactly like the feed
-- mirror's own health (wpbl_ingest_runs, scripts/add_wpbl_ingest_health.sql) rather than
-- inventing a second way to say the same thing.
--
-- Deliberately NOT a failing CI job. The validator reports every finding it can see and most
-- are already known, so a job wired to fail on findings fails every night and stops being
-- read. It writes a row here and exits 0; the admin panel shows the state.

create table if not exists public.wpbl_pbp_validation_runs (
  id              uuid primary key default gen_random_uuid(),
  ran_at          timestamptz not null default now(),
  ok              boolean not null default true,   -- false when the run itself errored
  new_findings    integer not null default 0,      -- not in the committed baseline
  total_findings  integer not null default 0,      -- everything the checks matched
  by_check        jsonb,                           -- { checkKey: count }, for the detail line
  error           text
);

create index if not exists wpbl_pbp_validation_runs_ran_at_idx
  on public.wpbl_pbp_validation_runs (ran_at desc);

comment on table public.wpbl_pbp_validation_runs is
  'Nightly play-by-play validation health. Written by scripts/validate-wpbl-pbp.mjs --record, '
  'read by the admin panel. Freshness matters more than the counts: a gap means the job stopped.';

alter table public.wpbl_pbp_validation_runs enable row level security;

-- Matches wpbl_ingest_runs: public read so the admin page can render it with the anon key,
-- writes restricted to the owner. The nightly job connects as the service role and bypasses
-- RLS entirely, same as the ingest function.
drop policy if exists "WPBL pbp validation runs are public" on public.wpbl_pbp_validation_runs;
create policy "WPBL pbp validation runs are public"
  on public.wpbl_pbp_validation_runs for select using (true);

drop policy if exists "Owner writes WPBL pbp validation runs" on public.wpbl_pbp_validation_runs;
create policy "Owner writes WPBL pbp validation runs"
  on public.wpbl_pbp_validation_runs for all
  using (public.is_site_owner()) with check (public.is_site_owner());

grant select on public.wpbl_pbp_validation_runs to anon, authenticated;
