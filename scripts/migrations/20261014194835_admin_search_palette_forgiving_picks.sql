-- /admin's Search box card says how often the forgiving pass is the one that answered.
--
-- `command_palette_picked` now carries `forgiving: true` when the row taken was found only by the
-- typo fallback (src/lib/fuzzyName.ts), which runs only after the exact search found nothing. So a
-- count of those is a count of searches that a slip would otherwise have lost, which is the one
-- number that says whether the pass earns its extra StatsAPI calls on MLB. `picks` gains
-- `forgiving` per kind; picks before Oct 14, 2026 never carry it and read as 0.
--
-- The rest of the function is unchanged from 20261014183000_add_palette_missed_queries.sql.

create or replace function public.admin_search_palette(
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
    raise exception 'admin_search_palette: not authorized' using errcode = '42501';
  end if;

  days_back := least(greatest(coalesce(days_back, 30), 1), 365);
  win_start := (((now() at time zone zone)::date - (days_back - 1))::timestamp) at time zone zone;

  with e as (
    select event, session_id, props, coalesce(props->>'section', '—') as section
    from public.events
    where event in ('command_palette_opened', 'command_palette_picked', 'command_palette_dismissed',
                    'command_palette_recents_cleared', 'search_finder_picked')
      and created_at >= win_start
  )
  select jsonb_build_object(
    -- One row per section: the funnel. Browsers beside events throughout, since the rates on the
    -- card are browsers over browsers (the funnel rule in docs/ADMIN_ANALYTICS.md section 4).
    'sections', coalesce((
      select jsonb_agg(x order by (x->>'opened')::int desc) from (
        select jsonb_build_object(
          'section',           section,
          'opened',            count(*) filter (where event = 'command_palette_opened'),
          'opened_browsers',   count(distinct session_id) filter (
                                 where event = 'command_palette_opened' and session_id <> 'no-storage'),
          'picked',            count(*) filter (
                                 where event = 'command_palette_picked' and props->>'kind' <> 'example'),
          'picked_browsers',   count(distinct session_id) filter (
                                 where event = 'command_palette_picked' and props->>'kind' <> 'example'
                                   and session_id <> 'no-storage'),
          'dismissed',         count(*) filter (where event = 'command_palette_dismissed'),
          -- Closed after typing something. The other dismissals are a reader who opened it and
          -- changed their mind; these are a reader who asked and did not get an answer worth taking.
          'dismissed_typed',   count(*) filter (
                                 where event = 'command_palette_dismissed' and coalesce((props->>'typed')::int, 0) > 0),
          -- Of those, the ones that were offered nothing at all.
          'dismissed_empty',   count(*) filter (
                                 where event = 'command_palette_dismissed' and coalesce((props->>'typed')::int, 0) > 0
                                   and coalesce((props->>'shown')::int, 0) = 0),
          'recents_cleared',   count(*) filter (where event = 'command_palette_recents_cleared')
        ) as x
        from e
        where event <> 'search_finder_picked'
        group by section
      ) s
    ), '[]'::jsonb),
    -- How it was opened. The shortcut and "/" are the keyboard readers; the field and the icon
    -- are everyone else. Whether anyone finds Ctrl+K at all is the question this exists for.
    'via', coalesce((
      select jsonb_agg(x order by x->>'section', (x->>'events')::int desc) from (
        select jsonb_build_object(
          'section', section, 'via', coalesce(props->>'via', '—'),
          'events', count(*),
          'browsers', count(distinct session_id) filter (where session_id <> 'no-storage')
        ) as x
        from e where event = 'command_palette_opened'
        group by section, props->>'via'
      ) s
    ), '[]'::jsonb),
    -- What kind of row is taken, and how far down the list it sat. `rank` counts from 0, so an
    -- average near 0 says the ordering is right and a high one says readers are scrolling past
    -- something. `top` is the share taken from the very first row.
    'picks', coalesce((
      select jsonb_agg(x order by x->>'section', (x->>'events')::int desc) from (
        select jsonb_build_object(
          'section',  section,
          'kind',     coalesce(props->>'kind', '—'),
          'events',   count(*),
          'browsers', count(distinct session_id) filter (where session_id <> 'no-storage'),
          'avg_rank', round(avg((props->>'rank')::numeric), 1),
          'top',      count(*) filter (where props->>'top' = 'true'),
          -- Taken from a row only the forgiving pass found: a typo the exact search would have lost.
          'forgiving', count(*) filter (where props->>'forgiving' = 'true'),
          'typed',    count(*) filter (where coalesce((props->>'typed')::int, 0) > 0)
        ) as x
        from e where event = 'command_palette_picked'
        group by section, props->>'kind'
      ) s
    ), '[]'::jsonb),
    -- The stat questions that were opened, by side, and how many named a club or dropped a word
    -- the parser could not place (a player's name, mostly: Find cannot ask about one).
    'finder', coalesce((
      select jsonb_agg(x order by x->>'section', (x->>'events')::int desc) from (
        select jsonb_build_object(
          'section',  section,
          'side',     coalesce(props->>'side', '—'),
          'events',   count(*),
          'browsers', count(distinct session_id) filter (where session_id <> 'no-storage'),
          'clubs',    count(*) filter (where coalesce((props->>'clubs')::int, 0) > 0),
          'ignored',  count(*) filter (where coalesce((props->>'ignored')::int, 0) > 0)
        ) as x
        from e where event = 'search_finder_picked'
        group by section, props->>'side'
      ) s
    ), '[]'::jsonb),
    -- What the box had no answer for, per section, most asked first. Only closes that carry `q`,
    -- which the palette sends only when it offered nothing, so this is never a log of searches.
    'missed', coalesce((
      select jsonb_agg(x order by x->>'section', (x->>'events')::int desc) from (
        select jsonb_build_object(
          'section',  section,
          'q',        lower(props->>'q'),
          'events',   count(*),
          'browsers', count(distinct session_id) filter (where session_id <> 'no-storage')
        ) as x
        from e
        where event = 'command_palette_dismissed' and coalesce(props->>'q', '') <> ''
        group by section, lower(props->>'q')
        order by count(*) desc
        limit 40
      ) s
    ), '[]'::jsonb),
    -- WPBL queries that read as a stat question, from `wpbl_searched`. Before Oct 14, 2026 these
    -- were counted as searches that found nothing, which is why the field is new.
    'wpbl_questions', (
      select jsonb_build_object(
        'events',   count(*),
        'browsers', count(distinct session_id) filter (where session_id <> 'no-storage')
      )
      from public.events
      where event = 'wpbl_searched' and created_at >= win_start
        and coalesce((props->>'finder')::int, 0) > 0
    )
  ) into result;

  return result;
end;
$$;

revoke all    on function public.admin_search_palette(int, text) from public;
grant execute on function public.admin_search_palette(int, text) to authenticated;
