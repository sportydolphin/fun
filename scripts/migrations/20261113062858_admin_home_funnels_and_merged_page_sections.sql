-- Two /admin cards that read wrong (Nov 12, 2026).
--
-- HOME CARDS OVER 100%. "Home cards: seen, then used" divided the browsers who fired the card's
-- action ANYWHERE by the browsers who saw the card: Compare read 220% (11 of 5) and Fan awards 200%
-- (2 of 1). Every one of those 11 Compare opens came from a player page, the More menu or a
-- matchup, none from Home. `admin_home_funnels` counts a use only from a browser that also saw the
-- card in the range, and only from the card itself where the event says where it came from
-- (`from`). The funnels stay defined in the client (HOME_FUNNELS in src/lib/analyticsAdmin.ts) and
-- are passed in, so a card added there needs nothing here.
--
-- ONE SECTION, TWO ROWS. `wpbl_page_section_seen` and `wpbl_page_open` carry a section as the
-- heading text of the day, so when the season recap's headings went to title case on Oct 22 to 28
-- every section split in two ("Playoff bracket" and "Playoff Bracket"), four were renamed outright
-- ("Where the ball goes" is "Spray Chart" now), and a few opens send a snake_case id. Counted as
-- separate groups, a browser who saw both spellings is in both and neither row is the section's
-- reach. `admin_page_section_key` folds them to one lowercase key before the distinct count, so the
-- browsers are counted once; the client prints the key in sentence case.
--
-- SAME SECURITY MODEL AS EVERY admin_* FUNCTION (docs/ADMIN_ANALYTICS.md section 2): definer, the
-- owner check first, empty search_path, execute revoked from anon. The key helper reads no table.

create or replace function public.admin_page_section_key(section text)
returns text language sql immutable set search_path = '' as $$
  select case k
    -- Renamed headings, old to current. A new rename goes here, or its history splits off again.
    when 'where the ball goes'      then 'spray chart'
    when 'plays that turned a game' then 'biggest plays'
    else k
  end
  from (select lower(regexp_replace(replace(section, '_', ' '), '^the ', '', 'i')) as k) s
$$;

create or replace function public.admin_wpbl_page_usage(days_back integer default 30, tz text default 'UTC')
returns jsonb
language plpgsql
stable security definer
set search_path = ''
as $function$
declare
  zone      text := public.admin_safe_tz(tz);
  win_start timestamptz;
  result    jsonb;
begin
  if not public.is_site_owner() then
    raise exception 'admin_wpbl_page_usage: not authorized' using errcode = '42501';
  end if;

  days_back := least(greatest(coalesce(days_back, 30), 1), 365);
  win_start := (((now() at time zone zone)::date - (days_back - 1))::timestamp) at time zone zone;

  with e as (
    select event, session_id, props,
           coalesce(props->>'page', '—') as page,
           coalesce(public.admin_page_section_key(props->>'section'), '—') as section
    from public.events
    where event in ('wpbl_page_section_seen', 'wpbl_page_open', 'wpbl_page_control')
      and created_at >= win_start
  )
  select jsonb_build_object(
    'sections', coalesce((
      select jsonb_agg(x order by x->>'page', (x->>'browsers')::int desc) from (
        select jsonb_build_object(
          'page', page, 'section', section,
          'events', count(*),
          'browsers', count(distinct session_id) filter (where session_id <> 'no-storage')
        ) as x
        from e where event = 'wpbl_page_section_seen'
        group by page, section
      ) s
    ), '[]'::jsonb),
    'opens', coalesce((
      select jsonb_agg(x order by x->>'page', (x->>'events')::int desc) from (
        select jsonb_build_object(
          'page', page, 'section', section,
          'kind', coalesce(props->>'kind', '—'),
          'events', count(*),
          'browsers', count(distinct session_id) filter (where session_id <> 'no-storage')
        ) as x
        from e where event = 'wpbl_page_open'
        group by page, section, props->>'kind'
      ) s
    ), '[]'::jsonb),
    -- By control, not by value: "did anyone use the country picker" is the question, and which
    -- country is a detail the raw rows still hold.
    'controls', coalesce((
      select jsonb_agg(x order by x->>'page', (x->>'browsers')::int desc) from (
        select jsonb_build_object(
          'page', page, 'control', coalesce(props->>'control', '—'),
          'events', count(*),
          'browsers', count(distinct session_id) filter (where session_id <> 'no-storage')
        ) as x
        from e where event = 'wpbl_page_control'
        group by page, props->>'control'
      ) s
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$function$;

-- funnels: [{ "seen": "wpbl_compare_shown", "used": ["wpbl_compare_opened"], "from": ["home"] }, ...]
-- `from` is optional. Returns one row per funnel, in the order given:
-- [{ "seen": ..., "seen_browsers": n, "used_browsers": n }]
create or replace function public.admin_home_funnels(days_back integer default 30, tz text default 'UTC', funnels jsonb default '[]')
returns jsonb
language plpgsql
stable security definer
set search_path = ''
as $function$
declare
  zone      text := public.admin_safe_tz(tz);
  today_l   date;
  win_start timestamptz;
  win_end   timestamptz;
  result    jsonb;
begin
  if not public.is_site_owner() then
    raise exception 'admin_home_funnels: not authorized' using errcode = '42501';
  end if;
  if jsonb_typeof(funnels) is distinct from 'array' or jsonb_array_length(funnels) > 32 then
    raise exception 'admin_home_funnels: funnels must be an array of at most 32' using errcode = '22023';
  end if;

  days_back := least(greatest(coalesce(days_back, 30), 1), 365);
  today_l   := (now() at time zone zone)::date;
  win_start := ((today_l - (days_back - 1))::timestamp) at time zone zone;
  win_end   := ((today_l + 1)::timestamp)               at time zone zone;

  with f as (
    select ord, x->>'seen' as seen,
           array(select jsonb_array_elements_text(coalesce(x->'used', '[]'))) as used,
           case when x ? 'from' then array(select jsonb_array_elements_text(x->'from')) end as froms
    from jsonb_array_elements(funnels) with ordinality t(x, ord)
  ),
  names as (select seen as n from f union select unnest(used) from f),
  ev as (
    select event, session_id, props->>'from' as from_
    from public.events
    where created_at >= win_start and created_at < win_end
      and session_id <> 'no-storage'
      and event in (select n from names)
  ),
  saw as (select distinct f.ord, ev.session_id from f join ev on ev.event = f.seen),
  used as (
    select distinct f.ord, ev.session_id
    from f join ev on ev.event = any(f.used) and (f.froms is null or ev.from_ = any(f.froms))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'seen',          f.seen,
    'seen_browsers', (select count(*) from saw where saw.ord = f.ord),
    'used_browsers', (select count(*) from used u join saw s on s.ord = u.ord and s.session_id = u.session_id where u.ord = f.ord)
  ) order by f.ord), '[]'::jsonb)
  into result
  from f;

  return result;
end;
$function$;

revoke all on function public.admin_page_section_key(text)                  from public, anon;
revoke all on function public.admin_wpbl_page_usage(integer, text)          from public, anon;
revoke all on function public.admin_home_funnels(integer, text, jsonb)      from public, anon;
grant execute on function public.admin_wpbl_page_usage(integer, text)       to authenticated;
grant execute on function public.admin_home_funnels(integer, text, jsonb)   to authenticated;
