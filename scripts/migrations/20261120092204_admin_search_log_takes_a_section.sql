-- admin_search_log learns a section, so the Search tab's headline numbers, daily bars and
-- lists can be read for WPBL or MLB alone. The totals are aggregates, so filtering the log on the
-- client could only ever narrow the list, never the numbers above it.
--
-- A new argument is a new signature, so the five-argument one goes first: left beside it, a call
-- naming only the old arguments would be ambiguous between the two. Otherwise unchanged from
-- 20261120091845_add_admin_search_log_rpc.sql.

drop function if exists public.admin_search_log(int, text, boolean, text[], int);

create or replace function public.admin_search_log(
  days_back   int     default 30,
  tz          text    default 'UTC',
  exclude_me  boolean default true,
  me_sessions text[]  default '{}',
  lim         int     default 300,
  sect        text    default 'all'
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  zone      text := public.admin_safe_tz(tz);
  win_start timestamptz;
  me        uuid := auth.uid();
  mine      text[];
  result    jsonb;
begin
  if not public.is_site_owner() then
    raise exception 'admin_search_log: not authorized' using errcode = '42501';
  end if;

  days_back := least(greatest(coalesce(days_back, 30), 1), 365);
  lim       := least(greatest(coalesce(lim, 300), 1), 1000);
  win_start := (((now() at time zone zone)::date - (days_back - 1))::timestamp) at time zone zone;

  -- Every browser the owner has used, whether or not this window saw it signed in.
  select coalesce(array_agg(distinct s), '{}') into mine from (
    select session_id as s from public.events where user_id = me
    union select unnest(coalesce(me_sessions, '{}'))
  ) x where s is not null and s <> 'no-storage';

  with e as (
    select ev.id, ev.created_at, ev.event, ev.session_id, ev.user_id, ev.props,
           coalesce(ev.props->>'section', case when ev.event like 'wpbl_%' then 'wpbl' else '—' end) as section,
           ev.session_id = any(mine) as is_me
    from public.events ev
    where ev.event in ('command_palette_opened', 'command_palette_picked', 'command_palette_dismissed',
                       'wpbl_searched', 'wpbl_search_picked')
      and ev.created_at >= win_start
      and not (exclude_me and ev.session_id = any(mine))
      and (coalesce(sect, 'all') = 'all'
           or coalesce(ev.props->>'section', case when ev.event like 'wpbl_%' then 'wpbl' end) = sect)
  ),
  -- One row per finished search: a pick that left the box, or a close after typing.
  outcome as (
    select e.*,
      case when e.event = 'command_palette_picked' then 'picked'
           when coalesce((e.props->>'shown')::int, 0) = 0 then 'nothing'
           else 'closed' end as result
    from e
    where (e.event = 'command_palette_picked' and coalesce(e.props->>'kind', '') <> 'example')
       or (e.event = 'command_palette_dismissed' and coalesce((e.props->>'typed')::int, 0) > 0)
  ),
  -- The WPBL row a pick opened, from the section's own event in the same flush.
  named as (
    select o.*, coalesce(nullif(o.props->>'title', ''), sp.name) as title, sp.player_id, sp.team_id
    from outcome o
    left join lateral (
      select coalesce(p.name, case when t.id is not null then t.city || ' ' || t.name end) as name,
             case when w.props->>'type' = 'player' then w.props->>'id' end as player_id,
             coalesce(p.team_id, t.id) as team_id
      from e w
      left join public.wpbl_players p on w.props->>'type' = 'player' and p.id::text = w.props->>'id'
      left join public.wpbl_teams   t on w.props->>'type' = 'team'   and t.id = w.props->>'id'
      where o.result = 'picked' and w.event = 'wpbl_search_picked' and w.session_id = o.session_id
        and abs(extract(epoch from w.created_at - o.created_at)) < 3
      order by abs(extract(epoch from w.created_at - o.created_at))
      limit 1
    ) sp on true
  ),
  -- Text that found nothing, from both places that keep it.
  misses as (
    select section, lower(trim(props->>'q')) as q, session_id, created_at
    from e
    where event in ('command_palette_dismissed', 'wpbl_searched') and coalesce(trim(props->>'q'), '') <> ''
  )
  select jsonb_build_object(
    'excluded_browsers', case when exclude_me then coalesce(array_length(mine, 1), 0) else 0 end,
    'totals', (
      select jsonb_build_object(
        'opened',          (select count(*) from e where event = 'command_palette_opened'),
        'opened_browsers', (select count(distinct session_id) from e where event = 'command_palette_opened' and session_id <> 'no-storage'),
        'searches',        count(*),
        'browsers',        count(distinct session_id) filter (where session_id <> 'no-storage'),
        'picked',          count(*) filter (where result = 'picked'),
        'closed',          count(*) filter (where result = 'closed'),
        'nothing',         count(*) filter (where result = 'nothing'),
        'top_row',         count(*) filter (where result = 'picked' and props->>'top' = 'true'),
        'forgiving',       count(*) filter (where result = 'picked' and props->>'forgiving' = 'true'),
        'avg_rank',        round(avg((props->>'rank')::numeric) filter (where result = 'picked'), 1),
        'avg_typed',       round(avg((props->>'typed')::numeric) filter (where (props->>'typed')::int > 0), 1)
      ) from outcome
    ),
    -- Gap-filled, so a quiet day is a zero and not a missing bar.
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'day', d::date, 'picked', coalesce(x.picked, 0), 'closed', coalesce(x.closed, 0), 'nothing', coalesce(x.nothing, 0)
      ) order by d), '[]'::jsonb)
      from generate_series((win_start at time zone zone)::date, (now() at time zone zone)::date, interval '1 day') d
      left join (
        select (created_at at time zone zone)::date as day,
               count(*) filter (where result = 'picked')  as picked,
               count(*) filter (where result = 'closed')  as closed,
               count(*) filter (where result = 'nothing') as nothing
        from outcome group by 1
      ) x on x.day = d::date
    ),
    'kinds', coalesce((
      select jsonb_agg(x order by (x->>'events')::int desc) from (
        select jsonb_build_object(
          'section', section, 'kind', coalesce(props->>'kind', '—'),
          'events', count(*),
          'browsers', count(distinct session_id) filter (where session_id <> 'no-storage'),
          'avg_rank', round(avg((props->>'rank')::numeric), 1),
          'top', count(*) filter (where props->>'top' = 'true')
        ) as x
        from outcome where result = 'picked'
        group by section, props->>'kind'
      ) s
    ), '[]'::jsonb),
    -- WPBL players by how often a search opened them: from `wpbl_search_picked`, which has run
    -- since Aug 25, 2026, so this list has history the `title` prop does not.
    'players', coalesce((
      select jsonb_agg(x order by (x->>'events')::int desc, x->>'name') from (
        select jsonb_build_object(
          'id', w.props->>'id', 'name', coalesce(p.name, '—'), 'team_id', p.team_id,
          'events', count(*),
          'browsers', count(distinct w.session_id) filter (where w.session_id <> 'no-storage'),
          'last_at', max(w.created_at)
        ) as x
        from e w left join public.wpbl_players p on p.id::text = w.props->>'id'
        where w.event = 'wpbl_search_picked' and w.props->>'type' = 'player'
        group by w.props->>'id', p.name, p.team_id
        order by count(*) desc
        limit 50
      ) s
    ), '[]'::jsonb),
    -- Every picked row with a name, both sections and every kind (a ranking, a question, an MLB player).
    'picks', coalesce((
      select jsonb_agg(x order by (x->>'events')::int desc) from (
        select jsonb_build_object(
          'section', section, 'kind', coalesce(props->>'kind', '—'), 'title', title,
          'events', count(*),
          'browsers', count(distinct session_id) filter (where session_id <> 'no-storage'),
          'last_at', max(created_at)
        ) as x
        from named where result = 'picked' and title is not null
        group by section, props->>'kind', title
        order by count(*) desc
        limit 50
      ) s
    ), '[]'::jsonb),
    -- Counted once per browser per day: a reader retyping the same name is one miss, not four.
    'missed', coalesce((
      select jsonb_agg(x order by (x->>'browsers')::int desc, x->>'last_at' desc) from (
        select jsonb_build_object(
          'section', section, 'q', q,
          'events', count(distinct (session_id, (created_at at time zone zone)::date)),
          'browsers', count(distinct session_id) filter (where session_id <> 'no-storage'),
          'last_at', max(created_at)
        ) as x
        from misses group by section, q
        order by count(distinct session_id) desc, max(created_at) desc
        limit 60
      ) s
    ), '[]'::jsonb),
    -- The log, newest first. `browser` is a short hash rather than the id, which is enough to
    -- follow one reader down the list and is all a screenshot of this page should carry.
    'recent', coalesce((
      select jsonb_agg(x order by x->>'at' desc) from (
        select jsonb_build_object(
          'at', n.created_at, 'section', n.section, 'result', n.result,
          'kind', n.props->>'kind', 'title', n.title, 'q', n.props->>'q',
          'player_id', n.player_id, 'team_id', n.team_id,
          'typed', (n.props->>'typed')::int, 'rank', (n.props->>'rank')::int,
          'shown', (n.props->>'shown')::int,
          'top', n.props->>'top' = 'true', 'forgiving', n.props->>'forgiving' = 'true',
          'browser', left(md5(n.session_id), 6), 'me', n.is_me,
          'user', u.username
        ) as x
        from named n
        left join public.usernames u on n.user_id is not null and u.user_id = n.user_id::text and not coalesce(u.is_deleted, false)
        order by n.created_at desc
        limit lim
      ) s
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

revoke all    on function public.admin_search_log(int, text, boolean, text[], int, text) from public;
grant execute on function public.admin_search_log(int, text, boolean, text[], int, text) to authenticated;
