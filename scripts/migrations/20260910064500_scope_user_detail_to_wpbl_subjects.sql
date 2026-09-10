-- scope user detail to wpbl subjects
-- Created 2026-09-10. Applied by scripts/migrate.mjs.

-- `props->>'teamId'` IS SHARED BY BOTH SECTIONS, AND THEY DO NOT MEAN THE SAME THING.
--
-- A WPBL team id is our own text slug ('SF', 'LA', 'NY', 'BOS'); an MLB one is a StatsAPI
-- integer. `admin_user_detail` shipped a few minutes ago grouping on that column raw, so the
-- first busy account it was run against came back with `LA` sitting on top of 136, 117, 139,
-- 145 and eight more. The panel renders a club as a WPBL badge, so eleven of those twelve rows
-- would have drawn an empty circle beside a number that means nothing to a reader.
--
-- The fix is the helper this schema already uses for exactly this question:
-- `admin_event_league(props, path)`, which reads `props->>'league'` and falls back to the
-- route, and which is right on 100% of rows because every event carries /wpbl or /mlb.
-- Same treatment for `players`, which has the same exposure the moment an MLB surface starts
-- sending a playerId.
--
-- IT SCOPES THESE TWO LISTS AND NOTHING ELSE. `actions`, `paths` and the daily series stay
-- cross-section deliberately: they are what says this person reads MLB at all, and the
-- roster's own split bar is built from the same attribution. This narrows the two lists whose
-- values are RENDERED AS WPBL OBJECTS, and the caller labels them as clubs and players of
-- this league rather than as everything the person looked at.
--
-- Everything else in the function is unchanged; it is repeated in full because
-- `create or replace` has no other form.

create or replace function public.admin_user_detail(
  target    uuid,
  days_back int  default 30,
  tz        text default 'UTC',
  lim       int  default 12
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  zone      text := public.admin_safe_tz(tz);
  today_l   date;
  start_l   date;
  win_start timestamptz;
  result    jsonb;
begin
  if not public.is_site_owner() then
    raise exception 'admin_user_detail: not authorized' using errcode = '42501';
  end if;

  days_back := least(greatest(coalesce(days_back, 30), 1), 365);
  lim       := least(greatest(coalesce(lim, 12), 1), 50);
  today_l   := (now() at time zone zone)::date;
  start_l   := today_l - (days_back - 1);
  win_start := (start_l::timestamp) at time zone zone;

  with
  ev as (
    select * from public.events
     where user_id = target and created_at >= win_start
  ),
  days as (
    select generate_series(start_l, today_l, interval '1 day')::date as day
  ),
  per_day as (
    select (created_at at time zone zone)::date as day, count(*) as n
      from ev group by 1
  )
  select jsonb_build_object(
    'days_back', days_back,

    'series', coalesce((
      select jsonb_agg(jsonb_build_object('date', d.day, 'events', coalesce(p.n, 0)) order by d.day)
        from days d left join per_day p on p.day = d.day
    ), '[]'::jsonb),

    'events_window', (select count(*) from ev),
    'active_days',   (select count(distinct (created_at at time zone zone)::date) from ev),
    'browsers',      (select count(distinct session_id) from ev where session_id <> 'no-storage'),

    'first_seen',      (select min(created_at) from public.events where user_id = target),
    'last_seen',       (select max(created_at) from public.events where user_id = target),
    'lifetime_events', (select count(*) from public.events where user_id = target),

    -- Cross-section on purpose: this is the list that says an account lives on /mlb.
    'actions', coalesce((
      select jsonb_agg(t order by (t->>'n')::int desc) from (
        select jsonb_build_object('event', event, 'n', count(*), 'last', max(created_at)) as t
          from ev group by event order by count(*) desc limit lim
      ) s
    ), '[]'::jsonb),

    'views', coalesce((
      select jsonb_agg(t order by (t->>'n')::int desc) from (
        select jsonb_build_object('view', props->>'view', 'n', count(*)) as t
          from ev where event = 'wpbl_tab_viewed' and props->>'view' is not null
         group by props->>'view' order by count(*) desc limit lim
      ) s
    ), '[]'::jsonb),
    'paths', coalesce((
      select jsonb_agg(t order by (t->>'n')::int desc) from (
        select jsonb_build_object('path', path, 'n', count(*)) as t
          from ev where path is not null group by path order by count(*) desc limit lim
      ) s
    ), '[]'::jsonb),

    -- WPBL only, because the caller draws these as portraits and club badges of this league.
    -- The join stays a LEFT one so a player id we no longer have a row for still appears as a
    -- count rather than silently shortening the list.
    'players', coalesce((
      select jsonb_agg(t order by (t->>'n')::int desc) from (
        select jsonb_build_object(
                 'player_id', e.props->>'playerId',
                 'name',      coalesce(p.name, 'Unknown player'),
                 'team_id',   coalesce(p.team_id, e.props->>'teamId'),
                 'n',         count(*)) as t
          from ev e left join public.wpbl_players p on p.id::text = e.props->>'playerId'
         where e.props->>'playerId' is not null
           and public.admin_event_league(e.props, e.path) = 'wpbl'
         group by e.props->>'playerId', p.name, p.team_id, e.props->>'teamId'
         order by count(*) desc limit lim
      ) s
    ), '[]'::jsonb),
    -- Joined to wpbl_teams rather than merely league-filtered: the badge needs a club that
    -- exists, and this is the one list where an id that resolves to nothing draws an empty
    -- circle instead of a row you can read.
    'teams', coalesce((
      select jsonb_agg(t order by (t->>'n')::int desc) from (
        select jsonb_build_object('team_id', w.id, 'name', w.city || ' ' || w.name, 'n', count(*)) as t
          from ev e join public.wpbl_teams w on w.id = e.props->>'teamId'
         where public.admin_event_league(e.props, e.path) = 'wpbl'
         group by w.id, w.city, w.name
         order by count(*) desc limit lim
      ) s
    ), '[]'::jsonb),

    'misses', coalesce((
      select jsonb_agg(t order by (t->>'n')::int desc) from (
        select jsonb_build_object('q', props->>'q', 'n', count(*)) as t
          from ev where event = 'wpbl_searched' and props ? 'q'
         group by props->>'q' order by count(*) desc limit lim
      ) s
    ), '[]'::jsonb),

    'feedback', coalesce((
      select jsonb_agg(t order by (t->>'created_at') desc) from (
        select jsonb_build_object(
                 'created_at', created_at, 'message', message,
                 'path', path, 'handled', handled_at is not null) as t
          from public.feedback where user_id = target order by created_at desc limit lim
      ) s
    ), '[]'::jsonb),

    'picks', coalesce((
      select jsonb_agg(t order by (t->>'category')) from (
        select jsonb_build_object('category', category, 'choice', choice, 'at', updated_at) as t
          from public.wpbl_award_votes
         where voter_key = target::text and category like 'pickem:%'
      ) s
    ), '[]'::jsonb),

    'reminders', coalesce((
      select jsonb_agg(t order by (t->>'game_date')) from (
        select jsonb_build_object('game_id', r.game_id, 'game_date', r.game_date,
                                  'home', g.home_team_id, 'away', g.away_team_id) as t
          from public.wpbl_game_reminders r
          left join public.wpbl_games g on g.id = r.game_id
         where r.user_id = target
      ) s
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

revoke all on function public.admin_user_detail(uuid, int, text, int) from public;
grant execute on function public.admin_user_detail(uuid, int, text, int) to authenticated;
