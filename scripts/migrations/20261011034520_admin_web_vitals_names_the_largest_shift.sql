-- /admin's Page speed card names the layout shifts that cost the most.
--
-- The field CLS p75 in the 14 days to Oct 10, 2026 was 0.27 on an MLB desktop and about 0.15
-- everywhere else, while the layout sweep in CI passed. The sweep measures the load; field CLS is
-- the worst burst across the whole visit, so the shifts that hurt come after first paint, and a
-- score alone cannot say where. Since this release every `web_vitals` event carries the largest
-- shift's element (`cls_target`, a short selector, and `cls_label`, the heading of the box it was
-- in), that shift's own score (`cls_shift`), the document's load state when it happened
-- (`cls_state`) and the route the reader was on at that moment (`cls_route`, which in a
-- single-page app is often not the page they landed on). See src/lib/webVitals.ts.
--
-- `shifts` ranks them over the loads that missed Google's "good" line (CLS over 0.1), BY HOW MANY
-- LOADS each element was the worst shift of, because the p75 moves when the count of bad loads
-- does. `over` is all such loads in the window and `named` the ones carrying an element: loads
-- recorded before this release have none, and a large gap between the two says so.
--
-- Everything else is unchanged from 20260927074721, including the owner check, which must stay
-- first: this function is security definer precisely so it can read the owner-only `events`.

create or replace function public.admin_web_vitals(
  days_back int  default 30,
  tz        text default 'UTC'
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  zone      text := public.admin_safe_tz(tz);
  win_start timestamptz;
  result    jsonb;
  shifts    jsonb;
begin
  if not public.is_site_owner() then
    raise exception 'admin_web_vitals: not authorized' using errcode = '42501';
  end if;

  days_back := least(greatest(coalesce(days_back, 30), 1), 365);
  win_start := (((now() at time zone zone)::date - (days_back - 1))::timestamp) at time zone zone;

  with v as (
    select
      props->>'device'  as device,
      props->>'section' as section,
      nullif(props->>'lcp',  '')::numeric as lcp,
      nullif(props->>'inp',  '')::numeric as inp,
      nullif(props->>'cls',  '')::numeric as cls,
      nullif(props->>'fcp',  '')::numeric as fcp,
      nullif(props->>'ttfb', '')::numeric as ttfb
    from public.events
    where event = 'web_vitals' and created_at >= win_start
  ),
  g as (
    select
      device, section,
      grouping(device) as all_devices, grouping(section) as all_sections,
      count(*) as loads,
      percentile_cont(0.75) within group (order by lcp)  as lcp_p75,
      percentile_cont(0.75) within group (order by inp)  as inp_p75,
      percentile_cont(0.75) within group (order by cls)  as cls_p75,
      percentile_cont(0.75) within group (order by fcp)  as fcp_p75,
      percentile_cont(0.75) within group (order by ttfb) as ttfb_p75,
      avg((lcp  <= 2500)::int) filter (where lcp  is not null) as lcp_good,
      avg((inp  <= 200)::int)  filter (where inp  is not null) as inp_good,
      avg((cls  <= 0.1)::int)  filter (where cls  is not null) as cls_good,
      avg((fcp  <= 1800)::int) filter (where fcp  is not null) as fcp_good,
      avg((ttfb <= 800)::int)  filter (where ttfb is not null) as ttfb_good
    from v
    group by grouping sets ((device, section), (device), ())
  )
  select jsonb_build_object('rows', coalesce(jsonb_agg(jsonb_build_object(
    'device',   case when all_devices  = 1 then null else coalesce(device,  '—') end,
    'section',  case when all_sections = 1 then null else coalesce(section, '—') end,
    'loads',    loads,
    'lcp_p75',  round(lcp_p75),  'inp_p75', round(inp_p75),  'cls_p75', round(cls_p75::numeric, 3),
    'fcp_p75',  round(fcp_p75),  'ttfb_p75', round(ttfb_p75),
    'lcp_good', round(lcp_good, 3), 'inp_good', round(inp_good, 3), 'cls_good', round(cls_good, 3),
    'fcp_good', round(fcp_good, 3), 'ttfb_good', round(ttfb_good, 3)
  ) order by all_devices desc, device, all_sections desc, section), '[]'::jsonb))
  into result
  from g;

  with s as (
    select
      coalesce(props->>'section', '—')   as section,
      coalesce(props->>'device',  '—')   as device,
      coalesce(props->>'cls_route', '—') as route,
      props->>'cls_target'               as target,
      props->>'cls_label'                as label,
      props->>'cls_state'                as state,
      nullif(props->>'cls', '')::numeric       as cls,
      nullif(props->>'cls_shift', '')::numeric as shift
    from public.events
    where event = 'web_vitals' and created_at >= win_start
      and nullif(props->>'cls', '')::numeric > 0.1
  ),
  ranked as (
    select section, device, route, target,
           mode() within group (order by label) as label,
           count(*) as loads,
           percentile_cont(0.5) within group (order by shift) as shift_p50,
           avg((state = 'complete')::int) as after_load
    from s
    where target is not null
    group by section, device, route, target
    order by count(*) desc, sum(cls) desc
    limit 12
  )
  select jsonb_build_object(
    'over',  (select count(*) from s),
    'named', (select count(*) from s where target is not null),
    'rows',  coalesce((select jsonb_agg(jsonb_build_object(
      'section', section, 'device', device, 'route', route, 'target', target, 'label', label,
      'loads', loads, 'shift_p50', round(shift_p50::numeric, 3), 'after_load', round(after_load, 3)
    ) order by loads desc) from ranked), '[]'::jsonb)
  ) into shifts;

  return result || jsonb_build_object('shifts', shifts);
end;
$$;

revoke all    on function public.admin_web_vitals(int, text) from public;
grant execute on function public.admin_web_vitals(int, text) to authenticated;
