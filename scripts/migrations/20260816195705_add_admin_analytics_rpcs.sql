-- Admin analytics RPCs — the read side of the `events` table (scripts/create_events.sql).
--
-- Why functions and not a view: a plain Postgres view runs with its OWNER's rights and
-- bypasses the underlying table's RLS. The WPBL views in this schema `grant select to anon,
-- authenticated`; copying that pattern here would hand every visitor's activity to anyone
-- with an account. So every function below is `security definer` (it needs to out-rank the
-- owner-only RLS on `events`), re-checks `public.is_site_owner()` before touching a row,
-- and is granted to `authenticated` only. The definer + explicit guard pair is the whole
-- security model: `security definer` alone would make these world-readable.
--
-- `set search_path = ''` on every function closes the definer-hijack hole, which is why
-- everything below is schema-qualified.
--
-- Two counting conventions the callers rely on:
--
--   * `session_id` is a random per-browser id in localStorage, so distinct sessions are
--     "browsers", not people — one person on a phone and a laptop is two. When localStorage
--     is unavailable, src/lib/analytics.ts writes the literal 'no-storage' (221 rows so
--     far), which would otherwise collapse every such visitor into one very busy browser.
--     Those rows still COUNT as events; they're excluded only from distinct-browser counts.
--
--   * Funnel rates are over distinct sessions, never raw rows. `discord_shown` fires on
--     every card mount (~3x a session), so raw joined/shown reads 3% where the honest
--     sessions-that-joined / sessions-that-saw-it number is ~8%.

-- ── helpers ───────────────────────────────────────────────────────────────────

-- Which league a row belongs to. Most events carry `props->>'league'`, but the WPBL-only
-- ones (tab views, player opens, reminders) and the cross-cutting ones (Discord card,
-- login, signup) don't. `path` resolves every one of those: it is /wpbl or /mlb on 100% of
-- rows in the table, which is a truer attribution than assuming everything unlabelled is
-- WPBL just because WPBL carries the traffic today.
create or replace function public.admin_event_league(props jsonb, path text)
returns text language sql immutable set search_path = '' as $$
  select coalesce(
    props->>'league',
    case when path like '/wpbl%' then 'wpbl'
         when path like '/mlb%'  then 'mlb' end
  );
$$;

-- A timezone name we know Postgres will accept. The client passes its own IANA zone; an
-- unrecognised one would otherwise raise and blank the whole dashboard, so fall back to UTC.
create or replace function public.admin_safe_tz(tz text)
returns text language plpgsql immutable set search_path = '' as $$
begin
  -- A fixed instant, so the probe stays immutable.
  perform timestamp '2000-01-01 00:00' at time zone coalesce(tz, 'UTC');
  return coalesce(tz, 'UTC');
exception when others then
  return 'UTC';
end;
$$;

-- ── 1. overview: headline totals + the gap-filled daily series ────────────────
--
-- Days with no events have no rows at all. Without the generate_series left join the chart
-- would silently close those gaps and a dead week would render as a busy one.
create or replace function public.admin_analytics_overview(
  days_back int  default 30,
  tz        text default 'UTC',
  league    text default 'all'
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  zone       text := public.admin_safe_tz(tz);
  today_l    date;
  start_l    date;
  prev_l     date;
  win_start  timestamptz;
  win_end    timestamptz;
  prev_start timestamptz;
  result     jsonb;
begin
  if not public.is_site_owner() then
    raise exception 'admin_analytics_overview: not authorized' using errcode = '42501';
  end if;

  days_back := least(greatest(coalesce(days_back, 30), 1), 365);

  today_l    := (now() at time zone zone)::date;
  start_l    := today_l - (days_back - 1);
  prev_l     := start_l - days_back;
  win_start  := (start_l::timestamp)          at time zone zone;
  win_end    := ((today_l + 1)::timestamp)    at time zone zone;
  prev_start := (prev_l::timestamp)           at time zone zone;

  with ev as (
    select
      ((created_at at time zone zone)::date) as day,
      created_at, session_id, user_id
    from public.events
    where created_at >= prev_start and created_at < win_end
      and (league = 'all' or public.admin_event_league(props, path) = league)
  ),
  cur as (select * from ev where created_at >= win_start),
  prv as (select * from ev where created_at <  win_start),
  days as (
    select generate_series(start_l, today_l, interval '1 day')::date as day
  ),
  by_day as (
    select day,
           count(*)                                                       as events,
           count(distinct session_id) filter (where session_id <> 'no-storage') as browsers,
           count(distinct user_id)                                        as users
    from cur group by day
  )
  select jsonb_build_object(
    'tz',        zone,
    'days_back', days_back,
    'league',    league,
    -- Lets the UI label an over-long range honestly instead of drawing empty days
    -- before the table existed.
    'first_event', (select min(created_at at time zone zone)::date from public.events),
    'series', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date',     d.day,
        'events',   coalesce(b.events,   0),
        'browsers', coalesce(b.browsers, 0),
        'users',    coalesce(b.users,    0)
      ) order by d.day)
      from days d left join by_day b on b.day = d.day
    ), '[]'::jsonb),
    'totals', (
      select jsonb_build_object(
        'events',   count(*),
        'browsers', count(distinct session_id) filter (where session_id <> 'no-storage'),
        'users',    count(distinct user_id),
        'signed_in_browsers', count(distinct session_id)
                                filter (where user_id is not null and session_id <> 'no-storage')
      ) from cur
    ),
    'prev', (
      select jsonb_build_object(
        'events',   count(*),
        'browsers', count(distinct session_id) filter (where session_id <> 'no-storage'),
        'users',    count(distinct user_id),
        'signed_in_browsers', count(distinct session_id)
                                filter (where user_id is not null and session_id <> 'no-storage')
      ) from prv
    ),
    -- Fixed windows, deliberately NOT scoped to the range chip: the "is anyone here right
    -- now" read, which should say the same thing whichever range is selected. Hence its own
    -- scan rather than a filter over `cur` — on a 7-day range `cur` has no month to count.
    'active', (
      select jsonb_build_object(
        'today', count(distinct session_id) filter (where day  = today_l),
        'week',  count(distinct session_id) filter (where day >  today_l - 7),
        'month', count(distinct session_id) filter (where day >  today_l - 30)
      )
      from (
        select ((created_at at time zone zone)::date) as day, session_id
        from public.events
        where created_at >= ((today_l - 29)::timestamp at time zone zone)
          and session_id <> 'no-storage'
          and (league = 'all' or public.admin_event_league(props, path) = league)
      ) a
    )
  ) into result;

  return result;
end;
$$;

-- ── 2. per-event counts, with the previous equal window for a delta ───────────
--
-- Full outer join, not left: an event that fired last week and not this one still belongs
-- in the table (as a 100% drop), and a brand-new event has no previous row to join to.
create or replace function public.admin_event_counts(
  days_back int  default 30,
  league    text default 'all',
  tz        text default 'UTC'
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  zone       text := public.admin_safe_tz(tz);
  today_l    date;
  win_start  timestamptz;
  win_end    timestamptz;
  prev_start timestamptz;
  result     jsonb;
begin
  if not public.is_site_owner() then
    raise exception 'admin_event_counts: not authorized' using errcode = '42501';
  end if;

  days_back := least(greatest(coalesce(days_back, 30), 1), 365);
  today_l    := (now() at time zone zone)::date;
  win_start  := ((today_l - (days_back - 1))::timestamp) at time zone zone;
  win_end    := ((today_l + 1)::timestamp)               at time zone zone;
  prev_start := ((today_l - (2 * days_back - 1))::timestamp) at time zone zone;

  with ev as (
    select event, created_at, session_id, user_id
    from public.events
    where created_at >= prev_start and created_at < win_end
      and (league = 'all' or public.admin_event_league(props, path) = league)
  ),
  cur as (
    select event,
           count(*)                                                       as events,
           count(distinct session_id) filter (where session_id <> 'no-storage') as browsers,
           count(distinct user_id)                                        as users
    from ev where created_at >= win_start group by event
  ),
  prv as (
    select event,
           count(*)                                                       as events,
           count(distinct session_id) filter (where session_id <> 'no-storage') as browsers
    from ev where created_at < win_start group by event
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'event',         coalesce(c.event, p.event),
    'events',        coalesce(c.events,   0),
    'browsers',      coalesce(c.browsers, 0),
    'users',         coalesce(c.users,    0),
    'prev_events',   coalesce(p.events,   0),
    'prev_browsers', coalesce(p.browsers, 0)
  ) order by coalesce(c.events, 0) desc, coalesce(c.event, p.event)), '[]'::jsonb)
  into result
  from cur c full outer join prv p on p.event = c.event;

  return result;
end;
$$;

-- ── 3. WPBL tab views, split by how the tab was reached ───────────────────────
--
-- The payoff for wpbl_tab_viewed carrying {view, via, from}: Cloudflare can count /wpbl
-- hits but cannot tell a pill tap from a swipe from a card link.
create or replace function public.admin_wpbl_tab_stats(
  days_back int  default 30,
  tz        text default 'UTC'
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  zone      text := public.admin_safe_tz(tz);
  win_start timestamptz;
  result    jsonb;
begin
  if not public.is_site_owner() then
    raise exception 'admin_wpbl_tab_stats: not authorized' using errcode = '42501';
  end if;

  days_back := least(greatest(coalesce(days_back, 30), 1), 365);
  win_start := (((now() at time zone zone)::date - (days_back - 1))::timestamp) at time zone zone;

  select coalesce(jsonb_agg(t order by t->>'view', (t->>'events')::int desc), '[]'::jsonb)
  into result
  from (
    select jsonb_build_object(
      'view',     coalesce(props->>'view', '—'),
      'via',      coalesce(props->>'via',  '—'),
      'events',   count(*),
      'browsers', count(distinct session_id) filter (where session_id <> 'no-storage')
    ) as t
    from public.events
    where event = 'wpbl_tab_viewed' and created_at >= win_start
    group by props->>'view', props->>'via'
  ) s;

  return result;
end;
$$;

-- ── 4. most-opened WPBL players ───────────────────────────────────────────────
--
-- Joined on p.id::text rather than casting the prop to uuid: a malformed prop would make
-- the cast raise for the whole query, where a text compare just fails to match that row.
create or replace function public.admin_top_players(
  days_back int  default 30,
  lim       int  default 10,
  tz        text default 'UTC'
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  zone      text := public.admin_safe_tz(tz);
  win_start timestamptz;
  result    jsonb;
begin
  if not public.is_site_owner() then
    raise exception 'admin_top_players: not authorized' using errcode = '42501';
  end if;

  days_back := least(greatest(coalesce(days_back, 30), 1), 365);
  lim       := least(greatest(coalesce(lim, 10), 1), 100);
  win_start := (((now() at time zone zone)::date - (days_back - 1))::timestamp) at time zone zone;

  select coalesce(jsonb_agg(t order by (t->>'opens')::int desc), '[]'::jsonb)
  into result
  from (
    select jsonb_build_object(
      'player_id', e.props->>'playerId',
      'name',      coalesce(p.name, 'Unknown player'),
      'team_id',   coalesce(p.team_id, e.props->>'teamId'),
      'opens',     count(*),
      'browsers',  count(distinct e.session_id) filter (where e.session_id <> 'no-storage')
    ) as t
    from public.events e
    left join public.wpbl_players p on p.id::text = e.props->>'playerId'
    where e.event = 'wpbl_player_opened'
      and e.created_at >= win_start
      and e.props->>'playerId' is not null
    group by e.props->>'playerId', p.name, p.team_id, e.props->>'teamId'
    order by count(*) desc
    limit lim
  ) s;

  return result;
end;
$$;

-- ── 5. Discord invite funnel, over distinct sessions ──────────────────────────
create or replace function public.admin_discord_funnel(
  days_back int  default 30,
  tz        text default 'UTC'
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  zone      text := public.admin_safe_tz(tz);
  win_start timestamptz;
  result    jsonb;
begin
  if not public.is_site_owner() then
    raise exception 'admin_discord_funnel: not authorized' using errcode = '42501';
  end if;

  days_back := least(greatest(coalesce(days_back, 30), 1), 365);
  win_start := (((now() at time zone zone)::date - (days_back - 1))::timestamp) at time zone zone;

  -- Rates are computed client-side from these counts; SQL just reports the sessions.
  select jsonb_build_object(
    'impressions', count(*) filter (where event = 'discord_shown'),
    'shown',     count(distinct session_id) filter (where event = 'discord_shown'     and session_id <> 'no-storage'),
    'joined',    count(distinct session_id) filter (where event = 'discord_joined'    and session_id <> 'no-storage'),
    'dismissed', count(distinct session_id) filter (where event = 'discord_dismissed' and session_id <> 'no-storage')
  ) into result
  from public.events
  where created_at >= win_start
    and event in ('discord_shown', 'discord_joined', 'discord_dismissed');

  return result;
end;
$$;

-- ── 6. accounts, notifications, reminders ─────────────────────────────────────
--
-- Signups come from usernames.created_at, not the `signup` event: the roster predates
-- analytics, so the event stream would under-report every account created before 2026-08-05.
--
-- The subscription and preference counts MUST come from here. Those tables are RLS'd to
-- own-rows-only, so the same counts run from the browser would return the owner's own
-- devices and read as a site with one user.
create or replace function public.admin_growth(
  days_back int  default 30,
  tz        text default 'UTC'
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  zone    text := public.admin_safe_tz(tz);
  today_l date;
  start_l date;
  result  jsonb;
begin
  if not public.is_site_owner() then
    raise exception 'admin_growth: not authorized' using errcode = '42501';
  end if;

  days_back := least(greatest(coalesce(days_back, 30), 1), 365);
  today_l   := (now() at time zone zone)::date;
  start_l   := today_l - (days_back - 1);

  with days as (
    select generate_series(start_l, today_l, interval '1 day')::date as day
  ),
  signups as (
    select ((created_at at time zone zone)::date) as day, count(*) as n
    from public.usernames
    where created_at >= (start_l::timestamp at time zone zone)
    group by 1
  )
  select jsonb_build_object(
    'signups', coalesce((
      select jsonb_agg(jsonb_build_object('date', d.day, 'signups', coalesce(s.n, 0)) order by d.day)
      from days d left join signups s on s.day = d.day
    ), '[]'::jsonb),
    'signups_window', (select coalesce(sum(n), 0) from signups),
    'total_users',    (select count(*) from public.usernames where coalesce(is_deleted, false) = false),
    'deleted_users',  (select count(*) from public.usernames where coalesce(is_deleted, false) = true),
    -- One user can have several devices subscribed; both numbers are worth seeing.
    'push_users',     (select count(distinct user_id) from public.push_subscriptions),
    'push_devices',   (select count(*)                from public.push_subscriptions),
    'notify_game_start',  (select count(*) from public.user_preferences where notify_game_start),
    'notify_picks',       (select count(*) from public.user_preferences where notify_pick_reminders),
    'notify_wpbl_all',    (select count(*) from public.user_preferences where notify_wpbl_all_games),
    -- Per-game opt-ins: rows are deleted as games pass, so this is a live, not lifetime, count.
    'game_reminder_users', (select count(distinct user_id) from public.wpbl_game_reminders),
    'game_reminder_rows',  (select count(*)                from public.wpbl_game_reminders)
  ) into result;

  return result;
end;
$$;

-- ── grants ────────────────────────────────────────────────────────────────────
-- Revoke the default `public` execute first: without this, `anon` could call them and rely
-- on the guard alone. Belt and braces — the guard is the real boundary, but an unauthenticated
-- caller should not even reach it.
revoke all on function public.admin_analytics_overview(int, text, text) from public;
revoke all on function public.admin_event_counts(int, text, text)       from public;
revoke all on function public.admin_wpbl_tab_stats(int, text)           from public;
revoke all on function public.admin_top_players(int, int, text)         from public;
revoke all on function public.admin_discord_funnel(int, text)           from public;
revoke all on function public.admin_growth(int, text)                   from public;

grant execute on function public.admin_analytics_overview(int, text, text) to authenticated;
grant execute on function public.admin_event_counts(int, text, text)       to authenticated;
grant execute on function public.admin_wpbl_tab_stats(int, text)           to authenticated;
grant execute on function public.admin_top_players(int, int, text)         to authenticated;
grant execute on function public.admin_discord_funnel(int, text)           to authenticated;
grant execute on function public.admin_growth(int, text)                   to authenticated;
