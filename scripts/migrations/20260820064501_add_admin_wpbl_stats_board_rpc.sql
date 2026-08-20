-- add admin wpbl stats board rpc
-- Created 2026-08-20. Applied by scripts/migrate.mjs.
--
-- Stats is the most-opened tab in the WPBL section and the only one whose contents were
-- unmeasured. `admin_wpbl_tab_stats` counts arrivals at the tab; nothing said whether the
-- reader was looking at Hitting, Pitching, the TrackMan boards or the draft analysis, and
-- the axes never touch the URL so Cloudflare cannot answer it either. src/lib/analytics.ts
-- now emits wpbl_stats_board / _sorted / _filtered; this is the read side.
--
-- Same security model as every other admin_* function (see the header of
-- 20260816195705_add_admin_analytics_rpcs.sql and docs/ADMIN_ANALYTICS.md): `security
-- definer` to out-rank the owner-only RLS on `events`, an explicit is_site_owner() guard
-- inside because definer alone would publish it, `set search_path = ''` with everything
-- schema-qualified, and execute granted to `authenticated` only.
--
-- One function returning four arrays rather than four functions: they are one card on the
-- page and one question ("what is anyone actually reading in there"), and the bundle
-- fetcher already pays a round trip per RPC.

create or replace function public.admin_wpbl_stats_boards(
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
    raise exception 'admin_wpbl_stats_boards: not authorized' using errcode = '42501';
  end if;

  days_back := least(greatest(coalesce(days_back, 30), 1), 365);
  win_start := (((now() at time zone zone)::date - (days_back - 1))::timestamp) at time zone zone;

  select jsonb_build_object(
    -- The board itself. 'draft' spans both sides, so it is named once rather than reported
    -- as two half-boards that would each look like a quarter of the traffic it has.
    'boards', coalesce((
      select jsonb_agg(jsonb_build_object(
        'board', board, 'mode', mode, 'events', n, 'browsers', br
      ) order by n desc) from (
        select
          case when props->>'source' = 'draft' then 'draft'
               else coalesce(props->>'source', '—') || ' ' || coalesce(props->>'side', '—') end as board,
          -- Players/Teams only exists on the season table; reporting the stale value the
          -- reader happened to leave behind would split the tracked and draft rows in two.
          case when coalesce(props->>'source', '') = 'season'
               then coalesce(props->>'mode', '—') else '—' end as mode,
          count(*) as n,
          count(distinct session_id) filter (where session_id <> 'no-storage') as br
        from public.events
        where event = 'wpbl_stats_board' and created_at >= win_start
        group by 1, 2
      ) g
    ), '[]'::jsonb),
    -- How the board was reached. 'open'/'return' are arrivals at the tab with the board
    -- already set; the rest are deliberate switches, which is the split worth reading.
    'via', coalesce((
      select jsonb_agg(v order by (v->>'events')::int desc) from (
        select jsonb_build_object(
          'via',      coalesce(props->>'via', '—'),
          'events',   count(*),
          'browsers', count(distinct session_id) filter (where session_id <> 'no-storage')
        ) as v
        from public.events
        where event = 'wpbl_stats_board' and created_at >= win_start
        group by props->>'via'
      ) s
    ), '[]'::jsonb),
    -- Which column readers sort by: the stat they came for, and the input the archive's
    -- frozen leaderboards need. Direction is folded in (`era ↑` and `era ↓` are different
    -- questions: best in the league, or worst).
    'sorts', coalesce((
      select jsonb_agg(x order by (x->>'events')::int desc) from (
        select jsonb_build_object(
          'key',      coalesce(props->>'key', '—'),
          'side',     coalesce(props->>'side', '—'),
          'asc',      coalesce(props->>'asc', 'false') = 'true',
          'events',   count(*),
          'browsers', count(distinct session_id) filter (where session_id <> 'no-storage')
        ) as x
        from public.events
        where event = 'wpbl_stats_sorted' and created_at >= win_start
        group by props->>'key', props->>'side', coalesce(props->>'asc', 'false') = 'true'
      ) s
    ), '[]'::jsonb),
    -- Does a four-team league need a team filter, and does Qualified earn its space.
    'filters', coalesce((
      select jsonb_agg(f order by (f->>'events')::int desc) from (
        select jsonb_build_object(
          'filter',   coalesce(props->>'filter', '—'),
          'on',       coalesce(props->>'on', 'false') = 'true',
          'events',   count(*),
          'browsers', count(distinct session_id) filter (where session_id <> 'no-storage')
        ) as f
        from public.events
        where event = 'wpbl_stats_filtered' and created_at >= win_start
        group by props->>'filter', coalesce(props->>'on', 'false') = 'true'
      ) s
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

-- Revoke the default `public` execute first: the guard is the real boundary, but an
-- unauthenticated caller should not even reach it.
revoke all    on function public.admin_wpbl_stats_boards(int, text) from public;
grant execute on function public.admin_wpbl_stats_boards(int, text) to authenticated;
