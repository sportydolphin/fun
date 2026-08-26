-- add admin wpbl entry point and search rpcs
-- Created 2026-08-25. Applied by scripts/migrate.mjs.
--
-- The read side for the events added the same day (see src/lib/analytics.ts):
-- wpbl_team_opened, wpbl_searched, wpbl_search_picked, wpbl_game_tab, plus the `from` prop
-- that game_center_opened and wpbl_player_opened now carry.
--
-- Two questions the dashboard could not answer before:
--
--   1. HOW DO READERS REACH A PAGE. Player opens are the section's retention event and team
--      pages are the deepest surface in it, and both were reported as one flat number: nothing
--      said whether Home, the Stats table, the schedule or the header search is what actually
--      feeds them. `admin_wpbl_entry_points` is that breakdown for all three destinations, plus
--      which Game Center tab gets read once someone is inside one.
--   2. DOES SEARCH WORK. It sits in the header on every page in the section and produced no
--      rows at all. `admin_wpbl_search` gives the funnel (searched → picked) and, crucially,
--      the queries that matched NOTHING, which is the only list here that names a specific
--      thing to go and fix.
--
-- Same security model as every other admin_* function (see the header of
-- 20260816195705_add_admin_analytics_rpcs.sql and docs/ADMIN_ANALYTICS.md): `security
-- definer` to out-rank the owner-only RLS on `events`, an explicit is_site_owner() guard
-- inside because definer alone would publish every visitor's activity, `set search_path = ''`
-- with everything schema-qualified, and execute granted to `authenticated` only.
--
-- Browser counts exclude the 'no-storage' sentinel throughout, for the reason in
-- docs/ADMIN_ANALYTICS.md §4: analytics.ts writes that literal when localStorage is off, so
-- counting it collapses every such visitor into one implausibly busy browser.

create or replace function public.admin_wpbl_entry_points(
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
    raise exception 'admin_wpbl_entry_points: not authorized' using errcode = '42501';
  end if;

  days_back := least(greatest(coalesce(days_back, 30), 1), 365);
  win_start := (((now() at time zone zone)::date - (days_back - 1))::timestamp) at time zone zone;

  select jsonb_build_object(
    -- One array rather than three, keyed by destination, so the page can render it as a
    -- single table and the three destinations stay directly comparable. Rows older than the
    -- day `from` shipped have no prop at all and land in '—'; that is honest (we did not
    -- know) rather than being folded into whichever surface looks likeliest.
    'sources', coalesce((
      select jsonb_agg(jsonb_build_object(
        'dest', dest, 'from', src, 'events', n, 'browsers', br
      ) order by dest, n desc) from (
        select
          case event
            when 'wpbl_player_opened'  then 'player'
            when 'wpbl_team_opened'    then 'team'
            when 'game_center_opened'  then 'game'
          end as dest,
          coalesce(nullif(props->>'from', ''), '—') as src,
          count(*) as n,
          count(distinct session_id) filter (where session_id <> 'no-storage') as br
        from public.events
        where created_at >= win_start
          and (
            event in ('wpbl_player_opened', 'wpbl_team_opened')
            -- game_center_opened is shared with /mlb, which has its own entry points and
            -- none of this labelling. Filtering on the league prop keeps the two apart.
            or (event = 'game_center_opened' and props->>'league' = 'wpbl')
          )
        group by 1, 2
      ) g
    ), '[]'::jsonb),
    -- Inside a game. `via` splits the tab the modal opened on ('open') from the tabs the
    -- reader chose ('pill', 'swipe'); only the second kind says what anyone wanted, exactly
    -- as with the Stats boards. `status` separates a live game from a finished one, because
    -- Recap does not exist on the first and is the default on the second.
    'game_tabs', coalesce((
      select jsonb_agg(x order by (x->>'events')::int desc) from (
        select jsonb_build_object(
          'tab',      coalesce(props->>'tab', '—'),
          'via',      coalesce(props->>'via', '—'),
          'status',   coalesce(props->>'status', '—'),
          'events',   count(*),
          'browsers', count(distinct session_id) filter (where session_id <> 'no-storage')
        ) as x
        from public.events
        where event = 'wpbl_game_tab' and created_at >= win_start
        group by props->>'tab', props->>'via', props->>'status'
      ) s
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

revoke all    on function public.admin_wpbl_entry_points(int, text) from public;
grant execute on function public.admin_wpbl_entry_points(int, text) to authenticated;


create or replace function public.admin_wpbl_search(
  days_back int  default 30,
  tz        text default 'UTC',
  lim       int  default 25
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  zone      text := public.admin_safe_tz(tz);
  win_start timestamptz;
  result    jsonb;
begin
  if not public.is_site_owner() then
    raise exception 'admin_wpbl_search: not authorized' using errcode = '42501';
  end if;

  days_back := least(greatest(coalesce(days_back, 30), 1), 365);
  lim       := least(greatest(coalesce(lim, 25), 1), 100);
  win_start := (((now() at time zone zone)::date - (days_back - 1))::timestamp) at time zone zone;

  select jsonb_build_object(
    'totals', (
      select jsonb_build_object(
        -- `searched` fires once per SETTLED query, not per keystroke, so this is a count of
        -- questions asked rather than of typing.
        'searched',        count(*) filter (where event = 'wpbl_searched'),
        'searched_browsers', count(distinct session_id) filter (
                               where event = 'wpbl_searched' and session_id <> 'no-storage'),
        -- The rate that matters. A search that finds nothing is a reader who came looking for
        -- something specific and left without it.
        'empty',           count(*) filter (where event = 'wpbl_searched' and props ? 'q'),
        'picked',          count(*) filter (where event = 'wpbl_search_picked'),
        'picked_browsers', count(distinct session_id) filter (
                             where event = 'wpbl_search_picked' and session_id <> 'no-storage')
      )
      from public.events
      where event in ('wpbl_searched', 'wpbl_search_picked') and created_at >= win_start
    ),
    -- What a pick actually was. `source` says whether the typed results or the recents list
    -- did the work, which is the only evidence for whether recents earned the space they take
    -- in the empty-query dropdown.
    'picks', coalesce((
      select jsonb_agg(x order by (x->>'events')::int desc) from (
        select jsonb_build_object(
          'type',     coalesce(props->>'type', '—'),
          'source',   coalesce(props->>'source', '—'),
          'events',   count(*),
          'browsers', count(distinct session_id) filter (where session_id <> 'no-storage')
        ) as x
        from public.events
        where event = 'wpbl_search_picked' and created_at >= win_start
        group by props->>'type', props->>'source'
      ) s
    ), '[]'::jsonb),
    -- The queries that matched nothing, which is the only place the typed text is stored at
    -- all (analytics.ts keeps `q` on a zero-result search and drops it otherwise). This is the
    -- actionable list: a player the roster is missing, a nickname the filter cannot reach, a
    -- spelling worth aliasing. Nobody will ever report these.
    'missed', coalesce((
      select jsonb_agg(x order by (x->>'events')::int desc, x->>'q') from (
        select jsonb_build_object(
          'q',        props->>'q',
          'events',   count(*),
          'browsers', count(distinct session_id) filter (where session_id <> 'no-storage')
        ) as x
        from public.events
        where event = 'wpbl_searched' and created_at >= win_start and props ? 'q'
        group by props->>'q'
        order by count(*) desc, props->>'q'
        limit lim
      ) s
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

revoke all    on function public.admin_wpbl_search(int, text, int) from public;
grant execute on function public.admin_wpbl_search(int, text, int) to authenticated;
