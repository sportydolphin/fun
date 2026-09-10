-- admin user detail rpc
-- Created 2026-09-10. Applied by scripts/migrate.mjs.

-- ONE PERSON, INSTEAD OF ONE ROW.
--
-- `admin_user_roster` answers "who are these 150 people" and deliberately answers it in
-- totals: an event count, a WPBL/MLB split, a device count. That is the right shape for a
-- table and the wrong shape for the question that follows it, which is always about ONE of
-- them: what does this person actually do here. A roster cannot carry that without becoming
-- 150 copies of it, so this is a second function taking a target.
--
-- Same security model as everything else in this file's neighbourhood, and it matters more
-- here than anywhere: this returns one named person's browsing history. `security definer` so
-- it can out-rank the owner-only RLS on `events`, an explicit `is_site_owner()` guard so that
-- definer does not publish it to anyone with an account, `set search_path = ''` so the
-- definer path cannot be hijacked, and never, ever a view.
--
-- WINDOWED AND LIFETIME ARE BOTH HERE, ON PURPOSE. `days_back` scopes the series and every
-- breakdown, because "what have they been doing lately" is the question. `first_seen`,
-- `lifetime_events` and the feedback list ignore it, because "when did they arrive" and "have
-- they ever written to us" are not questions about a window and answering them inside one
-- makes a long-standing reader look new.

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
  -- Every row this person wrote in the window. Served by events_user_time_idx, which is
  -- (user_id, created_at desc) and is exactly this predicate.
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

    -- GAP-FILLED, for the reason the overview chart is: days with no rows have no rows, and a
    -- chart that closes those gaps draws a fortnight away as a busy week.
    'series', coalesce((
      select jsonb_agg(jsonb_build_object('date', d.day, 'events', coalesce(p.n, 0)) order by d.day)
        from days d left join per_day p on p.day = d.day
    ), '[]'::jsonb),

    'events_window', (select count(*) from ev),
    'active_days',   (select count(distinct (created_at at time zone zone)::date) from ev),
    -- "Browsers", never devices: session_id is a per-browser localStorage id, so one person on
    -- a phone and a laptop is two, and the 'no-storage' sentinel would collapse every visitor
    -- who blocks storage into one. Same rule as every other count on this dashboard.
    'browsers', (select count(distinct session_id) from ev where session_id <> 'no-storage'),

    -- Lifetime. Not windowed, and labelled as such by the caller.
    'first_seen',      (select min(created_at) from public.events where user_id = target),
    'last_seen',       (select max(created_at) from public.events where user_id = target),
    'lifetime_events', (select count(*) from public.events where user_id = target),

    -- WHAT THEY DO. The raw event names, most-used first, with the last time each fired: a
    -- count alone cannot tell "uses this constantly" from "used it twice in July".
    'actions', coalesce((
      select jsonb_agg(t order by (t->>'n')::int desc) from (
        select jsonb_build_object('event', event, 'n', count(*), 'last', max(created_at)) as t
          from ev group by event order by count(*) desc limit lim
      ) s
    ), '[]'::jsonb),

    -- WHERE THEY GO. `view` is the WPBL tab; `path` is the route, which is the only thing
    -- every row carries and so the only honest answer for the MLB side.
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

    -- WHO THEY LOOK AT. Player opens are the section's retention event. Two events carry a
    -- playerId (the page open and an MVP-card tap) and both are a look at that person, so both
    -- count; the join is by our own player id, never a feed id.
    'players', coalesce((
      select jsonb_agg(t order by (t->>'n')::int desc) from (
        select jsonb_build_object(
                 'player_id', e.props->>'playerId',
                 'name',      coalesce(p.name, 'Unknown player'),
                 'team_id',   coalesce(p.team_id, e.props->>'teamId'),
                 'n',         count(*)) as t
          from ev e left join public.wpbl_players p on p.id::text = e.props->>'playerId'
         where e.props->>'playerId' is not null
         group by e.props->>'playerId', p.name, p.team_id, e.props->>'teamId'
         order by count(*) desc limit lim
      ) s
    ), '[]'::jsonb),
    'teams', coalesce((
      select jsonb_agg(t order by (t->>'n')::int desc) from (
        select jsonb_build_object('team_id', props->>'teamId', 'n', count(*)) as t
          from ev where props->>'teamId' is not null
         group by props->>'teamId' order by count(*) desc limit lim
      ) s
    ), '[]'::jsonb),

    -- WHAT THEY COULD NOT FIND. `wpbl_searched` keeps the typed text ONLY when the query
    -- matched nothing (analytics.ts drops it otherwise, capped at 40 chars), so this is not a
    -- log of what they searched for: it is the list of things they came looking for and left
    -- without. That asymmetry is deliberate upstream and is the reason this is worth showing.
    'misses', coalesce((
      select jsonb_agg(t order by (t->>'n')::int desc) from (
        select jsonb_build_object('q', props->>'q', 'n', count(*)) as t
          from ev where event = 'wpbl_searched' and props ? 'q'
         group by props->>'q' order by count(*) desc limit lim
      ) s
    ), '[]'::jsonb),

    -- WHAT THEY SAID. Lifetime, never windowed: a note sent in July is the most useful thing
    -- on this panel and a 30-day window would hide it.
    'feedback', coalesce((
      select jsonb_agg(t order by (t->>'created_at') desc) from (
        select jsonb_build_object(
                 'created_at', created_at, 'message', message,
                 'path', path, 'handled', handled_at is not null) as t
          from public.feedback where user_id = target order by created_at desc limit lim
      ) s
    ), '[]'::jsonb),

    -- WHAT THEY CALLED. The bracket pick'em is the half of wpbl_award_votes keyed to an
    -- ACCOUNT; the awards ballot on the same table is keyed to a browser id and cannot appear
    -- here at all. Filtering on the category prefix first is mandatory, not tidiness.
    'picks', coalesce((
      select jsonb_agg(t order by (t->>'category')) from (
        select jsonb_build_object('category', category, 'choice', choice, 'at', updated_at) as t
          from public.wpbl_award_votes
         where voter_key = target::text and category like 'pickem:%'
      ) s
    ), '[]'::jsonb),

    -- WHAT THEY ASKED TO BE TOLD. Rows are deleted as games pass, so this is a live opt-in
    -- list rather than a history: empty means "nothing coming up", never "never used it".
    'reminders', coalesce((
      select jsonb_agg(t order by (t->>'game_date')) from (
        -- The date off the REMINDER row, not the game: it is not-null there by definition, so
        -- a reminder outlives a game row going missing and still sorts.
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
