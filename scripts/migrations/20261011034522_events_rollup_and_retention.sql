-- `events` keeps 90 days of raw rows, a daily rollup keeps the rest, and pg_cron forgets its
-- own run history after a week.
--
-- WHY NOW. The database stood at 332 MB on Oct 11, 2026 against the free tier's 500, before the
-- MLB plays mirror (about a million rows a season) has landed. Two tables were growing with no
-- bound and no reader past a few weeks:
--
--   * `events`: 86 MB, 230k rows since Aug 5 and no retention. At the September peak it took
--     about 50k rows a week. /admin never reads past 90 days (its widest range chip), so older
--     raw rows were paid for and never read.
--   * `cron.job_run_details`: 49 MB. pg_cron logs every run of every job and never deletes one,
--     and the ingest alone runs 720 times a day. Nothing reads it but a person debugging a job,
--     who needs the last few days.
--
-- THE ROLLUP IS THE RECORD PAST 90 DAYS. One row per UTC day per event per league, plus the
-- rollups across them (`'all'`), with events, browsers and signed-in users counted by the same
-- rules as /admin (docs/ADMIN_ANALYTICS.md section 4: `no-storage` is not a browser, league from
-- `admin_event_league`). Distinct counts do not add across days or events, which is why the
-- 'all' rows are computed here from raw rows rather than summed later. Days are UTC because a
-- record that outlives the raw rows cannot be re-bucketed into a reader's zone afterwards.
--
-- THE PRUNE ONLY TAKES WHAT IS ROLLED UP. `events_maintain` rolls up every complete day that has
-- no rollup yet (and yesterday again, for a straggler sent as a page closed), and only then
-- deletes raw rows from before the 90-day line, in whole UTC days. A rollup that fails raises,
-- which aborts the delete with it. The first delete is due Nov 3, 2026, 90 days after the first
-- event; nothing is deleted the day this applies.
--
-- `events_test` (the test-run quarantine) is untouched: it is a few MB and is cleared by hand.

create table if not exists public.events_daily (
  day      date not null,
  event    text not null,
  league   text not null,
  events   int  not null,
  browsers int  not null,
  users    int  not null,
  primary key (day, event, league)
);

alter table public.events_daily enable row level security;
drop policy if exists "Owner can read the daily rollup" on public.events_daily;
create policy "Owner can read the daily rollup"
  on public.events_daily for select using (public.is_site_owner());

create or replace function public.events_rollup_day(d date)
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.events_daily where day = d;
  -- The empty grouping set yields a row even on a day with no events, so a quiet day is
  -- recorded as zero rather than looking like a day nobody rolled up.
  with e as (
    select event, coalesce(public.admin_event_league(props, path), 'other') as league,
           session_id, user_id
    from public.events
    where created_at >= d::timestamp at time zone 'UTC'
      and created_at <  (d + 1)::timestamp at time zone 'UTC'
  )
  insert into public.events_daily (day, event, league, events, browsers, users)
  select d,
         case when grouping(event)  = 1 then 'all' else event  end,
         case when grouping(league) = 1 then 'all' else league end,
         count(*),
         count(distinct session_id) filter (where session_id <> 'no-storage'),
         count(distinct user_id)
  from e
  group by grouping sets ((event, league), (event), (league), ());
end;
$$;

create or replace function public.events_maintain(keep_days int default 90)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  today  date := (now() at time zone 'UTC')::date;
  first  date;
  d      date;
  rolled int := 0;
  pruned bigint := 0;
begin
  select (min(created_at) at time zone 'UTC')::date into first from public.events;
  if first is not null then
    for d in select g::date from generate_series(first, today - 1, interval '1 day') g loop
      if d = today - 1 or not exists (select 1 from public.events_daily where day = d) then
        perform public.events_rollup_day(d);
        rolled := rolled + 1;
      end if;
    end loop;
  end if;

  -- Every day before today is rolled up by now, so whole days before the line can go. A shorter
  -- window is refused rather than obeyed: /admin's widest range is 90 days and reads raw rows.
  delete from public.events
  where created_at < (today - greatest(keep_days, 90))::timestamp at time zone 'UTC';
  get diagnostics pruned = row_count;

  return jsonb_build_object('rolled', rolled, 'pruned', pruned);
end;
$$;

-- Maintenance, not an API: security definer so pg_cron's job can write past RLS, and therefore
-- callable by nobody else. Supabase grants new functions to anon and authenticated by default,
-- so revoking from `public` alone would leave both able to prune the analytics table.
revoke all on function public.events_rollup_day(date) from public, anon, authenticated;
revoke all on function public.events_maintain(int)    from public, anon, authenticated;

-- Backfill every day so far. Deletes nothing: the oldest event is younger than 90 days.
select public.events_maintain();

-- cron.schedule replaces a job of the same name, so re-running this file is harmless.
select cron.schedule('events-maintain', '23 9 * * *', $$ select public.events_maintain(); $$);
select cron.schedule('cron-history-prune', '41 9 * * *',
  $$ delete from cron.job_run_details where end_time < now() - interval '7 days'; $$);

-- And the first week's worth now. Autovacuum makes the freed space reusable, so the table stops
-- growing from here; giving the space back to the disk takes a VACUUM FULL, which cannot run in
-- a migration's transaction.
delete from cron.job_run_details where end_time < now() - interval '7 days';
