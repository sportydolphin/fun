-- wpbl_run_environment: the season's run environment, priced once on a schedule instead of in
-- every reader's browser.
--
-- WHY. The Stats tab's wOBA, wRC+ and FIP columns take their weights from the league's own
-- run-expectancy table, built by walking every play of the season. Every visit to the most-read
-- tab therefore downloaded the whole play log (3,707 plays, four pages, about
-- 260KB gzipped) and walked it on the reader's device to arrive at a dozen numbers that change
-- only when a game goes final. scripts/compute-wpbl-run-environment.ts now runs that same code
-- (src/wpbl/derive/runExpectancy.ts, linearWeights.ts) and stores the answer here.
--
-- ONE ROW PER SCOPE. Only 'regular' exists: playRunValues prices the regular season alone, since
-- a postseason game must never reach a season total (CLAUDE.md).
--
-- final_games IS HOW A READER KNOWS THE ROW IS CURRENT. It is the number of regular-season games
-- that were final when the row was priced. The browser counts the same thing off the schedule it
-- already holds, and uses the row only when the two agree and no game is live; otherwise it falls
-- back to the play log exactly as before. A row that is behind can cost a reader speed, never a
-- wrong number. The exception is a play correction, which changes the plays without changing the
-- count: the job runs hourly, and can be run by hand from the Actions tab after a correction.
--
-- Written by the job with the service role; read by everyone, like the play log it summarises.
-- Created 2026-10-10. Applied by scripts/migrate.mjs.

create table if not exists public.wpbl_run_environment (
  scope         text primary key check (scope in ('regular')),
  woba_weights  jsonb,
  fip_weights   jsonb,
  final_games   integer not null,
  plays         integer not null,
  computed_at   timestamptz not null default now()
);

alter table public.wpbl_run_environment enable row level security;

drop policy if exists "WPBL run environment is public" on public.wpbl_run_environment;
create policy "WPBL run environment is public" on public.wpbl_run_environment for select using (true);
