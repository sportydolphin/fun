-- /admin's "Offseason pages" card: what readers reach and use on the standalone WPBL pages.
--
-- Reads the three generic events added on Sep 25, 2026 (src/lib/analytics.ts):
--   wpbl_page_section_seen  {page, section}        a section heading scrolled into view
--   wpbl_page_open          {page, section, kind}  followed a game/player/team/page out
--   wpbl_page_control       {page, control, value} used a filter, toggle, sort, search, scrub
-- One function for all three because the card is one card, and each is grouped by `page` so a
-- page added later appears without a change here.
--
-- Counted in BROWSERS first: section_seen and the continuous controls fire once per page load
-- by design, so their event counts are loads, while browsers is the number the card leads with.
--
-- Same footing as every admin_* function (docs/ADMIN_ANALYTICS.md section 2): security definer
-- so it can read the owner-only `events`, which is exactly why it must check is_site_owner()
-- itself before touching a row.

create or replace function public.admin_wpbl_page_usage(
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
    raise exception 'admin_wpbl_page_usage: not authorized' using errcode = '42501';
  end if;

  days_back := least(greatest(coalesce(days_back, 30), 1), 365);
  win_start := (((now() at time zone zone)::date - (days_back - 1))::timestamp) at time zone zone;

  with e as (
    select event, session_id, props
    from public.events
    where event in ('wpbl_page_section_seen', 'wpbl_page_open', 'wpbl_page_control')
      and created_at >= win_start
  )
  select jsonb_build_object(
    'sections', coalesce((
      select jsonb_agg(x order by x->>'page', (x->>'browsers')::int desc) from (
        select jsonb_build_object(
          'page', coalesce(props->>'page', '—'), 'section', coalesce(props->>'section', '—'),
          'events', count(*),
          'browsers', count(distinct session_id) filter (where session_id <> 'no-storage')
        ) as x
        from e where event = 'wpbl_page_section_seen'
        group by props->>'page', props->>'section'
      ) s
    ), '[]'::jsonb),
    'opens', coalesce((
      select jsonb_agg(x order by x->>'page', (x->>'events')::int desc) from (
        select jsonb_build_object(
          'page', coalesce(props->>'page', '—'), 'section', coalesce(props->>'section', '—'),
          'kind', coalesce(props->>'kind', '—'),
          'events', count(*),
          'browsers', count(distinct session_id) filter (where session_id <> 'no-storage')
        ) as x
        from e where event = 'wpbl_page_open'
        group by props->>'page', props->>'section', props->>'kind'
      ) s
    ), '[]'::jsonb),
    -- By control, not by value: "did anyone use the country picker" is the question, and which
    -- country is a detail the raw rows still hold.
    'controls', coalesce((
      select jsonb_agg(x order by x->>'page', (x->>'browsers')::int desc) from (
        select jsonb_build_object(
          'page', coalesce(props->>'page', '—'), 'control', coalesce(props->>'control', '—'),
          'events', count(*),
          'browsers', count(distinct session_id) filter (where session_id <> 'no-storage')
        ) as x
        from e where event = 'wpbl_page_control'
        group by props->>'page', props->>'control'
      ) s
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

revoke all    on function public.admin_wpbl_page_usage(int, text) from public;
grant execute on function public.admin_wpbl_page_usage(int, text) to authenticated;
