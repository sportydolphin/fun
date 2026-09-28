-- /admin's "MLB: what gets used" card. The MLB section carried three events until Sep 28, 2026,
-- so nothing could say which of its tabs or Home cards anyone used, which is exactly what the
-- WPBL alignment has to know before it decides what MLB keeps (ROADMAP.md, "Aligning with WPBL").
--
-- Reads the five events added that day (src/lib/analytics.ts):
--   mlb_card_seen      {card}              a Home card scrolled into view, once per page load
--   mlb_card_used      {card}              first click inside a Home card, once per page load
--   mlb_tab_viewed     {view, via, from}   switched tab, by pill or by a link
--   mlb_player_opened  {playerId, from}    opened a player
--   mlb_team_opened    {teamId, from}      opened a team
-- Grouped by prop, so a card, tab or source added later appears without a change here.
--
-- Cards are counted in BROWSERS on both sides, never events: both halves are once per page
-- load, so their event counts are loads, and a rate has to be browsers over browsers (the
-- funnel rule in docs/ADMIN_ANALYTICS.md section 4).
--
-- Same footing as every admin_* function (docs/ADMIN_ANALYTICS.md section 2): security definer
-- so it can read the owner-only `events`, which is exactly why it must check is_site_owner()
-- itself before touching a row.

create or replace function public.admin_mlb_usage(
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
    raise exception 'admin_mlb_usage: not authorized' using errcode = '42501';
  end if;

  days_back := least(greatest(coalesce(days_back, 30), 1), 365);
  win_start := (((now() at time zone zone)::date - (days_back - 1))::timestamp) at time zone zone;

  with e as (
    select event, session_id, props
    from public.events
    where event in ('mlb_card_seen', 'mlb_card_used', 'mlb_tab_viewed', 'mlb_player_opened', 'mlb_team_opened')
      and created_at >= win_start
  )
  select jsonb_build_object(
    'cards', coalesce((
      select jsonb_agg(x order by (x->>'seen')::int desc, x->>'card') from (
        select jsonb_build_object(
          'card', coalesce(props->>'card', '—'),
          'seen', count(distinct session_id) filter (where event = 'mlb_card_seen' and session_id <> 'no-storage'),
          'used', count(distinct session_id) filter (where event = 'mlb_card_used' and session_id <> 'no-storage')
        ) as x
        from e where event in ('mlb_card_seen', 'mlb_card_used')
        group by props->>'card'
      ) s
    ), '[]'::jsonb),
    'tabs', coalesce((
      select jsonb_agg(x order by x->>'view', (x->>'events')::int desc) from (
        select jsonb_build_object(
          'view', coalesce(props->>'view', '—'), 'via', coalesce(props->>'via', '—'),
          'events', count(*),
          'browsers', count(distinct session_id) filter (where session_id <> 'no-storage')
        ) as x
        from e where event = 'mlb_tab_viewed'
        group by props->>'view', props->>'via'
      ) s
    ), '[]'::jsonb),
    'opens', coalesce((
      select jsonb_agg(x order by x->>'kind', (x->>'browsers')::int desc) from (
        select jsonb_build_object(
          'kind', case event when 'mlb_player_opened' then 'player' else 'team' end,
          'from', coalesce(props->>'from', '—'),
          'events', count(*),
          'browsers', count(distinct session_id) filter (where session_id <> 'no-storage')
        ) as x
        from e where event in ('mlb_player_opened', 'mlb_team_opened')
        group by event, props->>'from'
      ) s
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

revoke all    on function public.admin_mlb_usage(int, text) from public;
grant execute on function public.admin_mlb_usage(int, text) to authenticated;
