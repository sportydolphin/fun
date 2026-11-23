-- /admin answers "is today unusual, and why", not just "how many".
--
-- WHY. On Nov 10, 2026 the site had 106 browsers by evening against a usual 10 to 30, 91 of them
-- new and 77 of those gone after four events or fewer, many on one `/wpbl/watch/<id>` each through
-- the day. The page showed the 106 and nothing else: not that it was unusual, not who was new, not
-- where they came from, not whether any of them did anything. Over the 30 days before it, 218
-- browsers had done nothing but load one comparison page, almost none sending a page-speed report,
-- which is the shape of a crawler rendering pages, not of readers. Four reads fix that:
--
--   * `admin_briefing`: today against the same hours of the last seven days, new against returning,
--     how many did anything, error screens on the running deploy, and where today's loads came from.
--   * `admin_audience`: the range's browsers split into new / returning / engaged, against the
--     previous window, plus weekly cohorts of new browsers and how many came back within 7 days.
--   * `admin_traffic_sources`: the `landed` event (src/lib/analytics.ts, from Nov 11, 2026), one per
--     page load, carrying the referrer's HOST only, utm_source, whether it opened as the installed
--     app, and the landing route. Read with the share of loads that went on to do something.
--   * `admin_daily_trend`: `events_daily`'s all-events rows, which hold true distinct browsers per
--     UTC day back to Aug 5, 2026 and which nothing on the page read.
--
-- "DID SOMETHING" IS DECIDED BY THE CLIENT'S LIST, NOT A COPY OF IT HERE. Most action events are
-- choices, but a few fire just because a page loaded: a comparison page drawing, a video page's
-- `wpbl_highlight_played` with `from = 'link'`, the Stats tab's first board (`via = 'open'`). Those
-- and every impression are passed in as `passive` (PASSIVE_EVENTS in src/lib/analyticsAdmin.ts),
-- either as a bare event name or as `event:via` / `event:from`. A second list in SQL would drift
-- from EVENT_INFO the first time an event was added to one and not the other.
--
-- SAME SECURITY MODEL AS EVERY admin_* FUNCTION (docs/ADMIN_ANALYTICS.md section 2): definer, the
-- owner check first, empty search_path, and execute revoked from anon. `admin_event_engaged` is
-- plain SQL over its arguments and reads no table, so it needs neither.

create or replace function public.admin_event_engaged(event text, props jsonb, passive text[])
returns boolean language sql immutable set search_path = '' as $$
  -- The name rule as well as the list: events retired from EVENT_INFO (`wpbl_bracket_shown`, the
  -- September Home's impressions) are still in the rows, and the client can only list what it
  -- knows. Without it 98% of September's new browsers read as engaged.
  select not (
    event like '%\_shown' or event like '%\_seen'
    or event = any(coalesce(passive, '{}'))
    or (event || ':' || coalesce(props->>'via', props->>'from', '')) = any(coalesce(passive, '{}'))
  );
$$;

-- ─── today ──────────────────────────────────────────────────────────────────────

create or replace function public.admin_briefing(
  tz      text   default 'UTC',
  passive text[] default '{}',
  build   text   default null
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  zone      text := public.admin_safe_tz(tz);
  today_l   date;
  day_start timestamptz;
  elapsed   interval;
  result    jsonb;
begin
  if not public.is_site_owner() then
    raise exception 'admin_briefing: not authorized' using errcode = '42501';
  end if;

  today_l   := (now() at time zone zone)::date;
  day_start := today_l::timestamp at time zone zone;
  elapsed   := now() - day_start;

  with recent as materialized (
    select session_id, created_at, event, props
    from public.events
    where created_at >= ((today_l - 7)::timestamp at time zone zone)
      and session_id <> 'no-storage'
  ),
  today as (select * from recent where created_at >= day_start),
  sessions as (
    select session_id, bool_or(public.admin_event_engaged(event, props, passive)) as engaged
    from today group by session_id
  ),
  -- One scan of the older rows for the whole day's browsers, not a lookup per browser: there is
  -- no index on session_id, and a correlated probe would read the table once per visitor.
  seen_before as (
    select distinct session_id from public.events
    where created_at < day_start and session_id in (select session_id from sessions)
  ),
  -- The same stretch of each of the last seven days (midnight to this clock time), so a morning
  -- read is compared with mornings rather than with whole days, which would read low until night.
  pace as (
    select k, count(distinct r.session_id) as browsers
    from generate_series(1, 7) k
    left join recent r
      on r.created_at >= ((today_l - k)::timestamp at time zone zone)
     and r.created_at <  ((today_l - k)::timestamp at time zone zone) + elapsed
    group by k
  ),
  landed as (
    select nullif(props->>'ref', '') as ref, nullif(props->>'utm', '') as utm,
           coalesce((props->>'app')::boolean, false) as app, session_id
    from today where event = 'landed'
  )
  select jsonb_build_object(
    'tz', zone,
    'date', today_l,
    'browsers', (select count(*) from sessions),
    'new',      (select count(*) from sessions s where not exists (select 1 from seen_before b where b.session_id = s.session_id)),
    'engaged',  (select count(*) from sessions where engaged),
    'events',   (select count(*) from today),
    'pace', jsonb_build_object(
      'median', (select percentile_cont(0.5) within group (order by browsers) from pace),
      'days',   (select jsonb_agg(browsers order by k) from pace)
    ),
    'errors', jsonb_build_object(
      'today',          (select count(*) from today where event = 'app_error'),
      'today_browsers', (select count(distinct session_id) from today where event = 'app_error'),
      'last_message',   (select props->>'message' from today where event = 'app_error' order by created_at desc limit 1),
      'build',          build,
      'on_build',       case when build is null then null else
                          (select count(*) from public.events where event = 'app_error' and props->>'build' = build) end
    ),
    'sources', coalesce((
      select jsonb_agg(x order by x.browsers desc)
      from (
        select ref, utm, app, count(distinct session_id) as browsers
        from landed group by ref, utm, app
        order by browsers desc limit 6
      ) x
    ), '[]'::jsonb),
    'sources_since', (select min(created_at at time zone zone)::date from public.events where event = 'landed')
  ) into result;

  return result;
end;
$$;

-- ─── new, returning, engaged ────────────────────────────────────────────────────

create or replace function public.admin_audience(
  days_back int    default 30,
  tz        text   default 'UTC',
  league    text   default 'all',
  passive   text[] default '{}'
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  zone    text := public.admin_safe_tz(tz);
  today_l date;
  start_l date;
  prev_l  date;
  history date;
  result  jsonb;
begin
  if not public.is_site_owner() then
    raise exception 'admin_audience: not authorized' using errcode = '42501';
  end if;

  days_back := least(greatest(coalesce(days_back, 30), 1), 365);
  league    := coalesce(league, 'all');
  today_l   := (now() at time zone zone)::date;
  start_l   := today_l - (days_back - 1);
  prev_l    := start_l - days_back;

  -- Raw rows are kept 90 days, so "first seen" can only mean first seen since this date. A
  -- browser that last came in August reads as new when it returns; the client says so.
  select (min(created_at) at time zone zone)::date into history from public.events;

  -- One row per browser per day is all any of this needs, and it is a fraction of the raw rows.
  with sd as materialized (
    select session_id, (created_at at time zone zone)::date as day,
           bool_or(public.admin_event_engaged(event, props, passive)) as engaged
    from public.events
    where session_id <> 'no-storage'
      and (league = 'all' or public.admin_event_league(props, path) = league)
    group by 1, 2
  ),
  firsts as (select session_id, min(day) as first_day from sd group by session_id),
  win as (
    select sd.session_id,
           case when sd.day >= start_l then 'cur' else 'prev' end as w,
           bool_or(sd.engaged) as engaged,
           min(f.first_day) as first_day
    from sd join firsts f using (session_id)
    where sd.day >= prev_l and sd.day <= today_l
    group by 1, 2
  ),
  -- A cohort is the browsers first seen in one week (Monday start). It is complete once its last
  -- day has had its full 7 days to come back in, and it is left out within two weeks of the
  -- history line, where "first seen" is mostly "first seen since the rows began".
  cohort as (
    select f.session_id, date_trunc('week', f.first_day)::date as wk,
           bool_or(sd.day > f.first_day and sd.day <= f.first_day + 7) as back,
           bool_or(sd.day = f.first_day and sd.engaged) as engaged
    from firsts f join sd using (session_id)
    where f.first_day >= history + 14
      and date_trunc('week', f.first_day)::date + 13 < today_l
      and date_trunc('week', f.first_day)::date >= today_l - 13 - 7 * 8
    group by 1, 2
  )
  select jsonb_build_object(
    'tz', zone,
    'history_from', history,
    'totals', (
      select jsonb_build_object(
        'browsers', count(*),
        'new',      count(*) filter (where first_day >= start_l),
        'engaged',  count(*) filter (where engaged)
      ) from win where w = 'cur'
    ),
    'prev', (
      select jsonb_build_object(
        'browsers', count(*),
        'new',      count(*) filter (where first_day >= prev_l),
        'engaged',  count(*) filter (where engaged)
      ) from win where w = 'prev'
    ),
    'cohorts', coalesce((
      select jsonb_agg(jsonb_build_object('week', wk, 'new', n, 'back', b, 'engaged', e) order by wk)
      from (
        select wk, count(*) as n, count(*) filter (where back) as b, count(*) filter (where engaged) as e
        from cohort group by wk
      ) c
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

-- ─── where loads come from ──────────────────────────────────────────────────────

create or replace function public.admin_traffic_sources(
  days_back int    default 30,
  tz        text   default 'UTC',
  passive   text[] default '{}'
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  zone      text := public.admin_safe_tz(tz);
  today_l   date;
  win_start timestamptz;
  win_end   timestamptz;
  result    jsonb;
begin
  if not public.is_site_owner() then
    raise exception 'admin_traffic_sources: not authorized' using errcode = '42501';
  end if;

  days_back := least(greatest(coalesce(days_back, 30), 1), 365);
  today_l   := (now() at time zone zone)::date;
  win_start := (today_l - (days_back - 1))::timestamp at time zone zone;
  win_end   := (today_l + 1)::timestamp at time zone zone;

  with land as materialized (
    select id, session_id, created_at,
           nullif(props->>'ref', '') as ref, nullif(props->>'utm', '') as utm,
           coalesce((props->>'app')::boolean, false) as app,
           coalesce(nullif(props->>'route', ''), '—') as route
    from public.events
    where event = 'landed' and created_at >= win_start and created_at < win_end
      and session_id <> 'no-storage'
  ),
  -- What the landing browsers did that counts, over the window plus the half hour after it so a
  -- load just before midnight still gets its chance.
  acts as (
    select session_id, created_at from public.events
    where created_at >= win_start and created_at < win_end + interval '30 minutes'
      and session_id in (select session_id from land)
      and public.admin_event_engaged(event, props, passive)
  ),
  -- A load "did something" when its browser did an engaged event within 30 minutes of it. There
  -- is no page-load id on the other events, and a browser's next load re-lands anyway.
  scored as (
    select land.id, bool_or(a.session_id is not null) as engaged
    from land left join acts a
      on a.session_id = land.session_id
     and a.created_at >= land.created_at and a.created_at < land.created_at + interval '30 minutes'
    group by land.id
  ),
  firsts as (
    select session_id, min(created_at) as first_at from public.events
    where session_id in (select session_id from land) group by session_id
  ),
  landed_rows as (
    select land.*, s.engaged,
           -- New when nothing from this browser came before the landing (a few seconds' slack for
           -- the order in which a load's first events are written).
           f.first_at >= land.created_at - interval '5 seconds' as is_new
    from land join scored s using (id) join firsts f using (session_id)
  )
  select jsonb_build_object(
    'since', (select min(created_at at time zone zone)::date from public.events where event = 'landed'),
    'sources', coalesce((
      select jsonb_agg(x order by x.browsers desc)
      from (
        select ref, utm, app,
               count(*) as loads,
               count(distinct session_id) as browsers,
               count(distinct session_id) filter (where is_new) as new,
               count(distinct session_id) filter (where engaged) as engaged
        from landed_rows group by ref, utm, app
      ) x
    ), '[]'::jsonb),
    'routes', coalesce((
      select jsonb_agg(x order by x.browsers desc)
      from (
        select route,
               count(*) as loads,
               count(distinct session_id) as browsers,
               count(distinct session_id) filter (where engaged) as engaged
        from landed_rows group by route
        order by browsers desc limit 15
      ) x
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

-- ─── since launch ───────────────────────────────────────────────────────────────

-- An RPC rather than a table read, though the owner can read `events_daily` directly: a plain
-- select stops at PostgREST's 1000 rows in silence, and this series passes that in 2029.
create or replace function public.admin_daily_trend(section text default 'all')
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_site_owner() then
    raise exception 'admin_daily_trend: not authorized' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('date', day, 'events', events, 'browsers', browsers, 'users', users) order by day)
    from public.events_daily
    where event = 'all' and league = coalesce(section, 'all')
  ), '[]'::jsonb);
end;
$$;

revoke execute on function public.admin_briefing(text, text[], text)                 from public, anon;
revoke execute on function public.admin_audience(integer, text, text, text[])         from public, anon;
revoke execute on function public.admin_traffic_sources(integer, text, text[])        from public, anon;
revoke execute on function public.admin_daily_trend(text)                             from public, anon;
grant  execute on function public.admin_briefing(text, text[], text)                 to authenticated;
grant  execute on function public.admin_audience(integer, text, text, text[])         to authenticated;
grant  execute on function public.admin_traffic_sources(integer, text, text[])        to authenticated;
grant  execute on function public.admin_daily_trend(text)                             to authenticated;
