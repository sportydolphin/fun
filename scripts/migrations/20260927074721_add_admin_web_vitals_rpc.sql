-- /admin's "Page speed" card: what real readers' page loads feel like.
--
-- Reads `web_vitals`, one event per production page load (src/lib/webVitals.ts), whose props are
-- {lcp, fcp, ttfb, inp} in milliseconds, {cls} as a score, and {device, section, conn}.
--
-- The 75th PERCENTILE, not the average, because that is what Google grades Core Web Vitals on
-- and what Search Console reports: a page is "good" when three loads in four are. An average
-- would let a few fast desktop loads hide a slow phone. `*_good` is the share of loads under
-- Google's own "good" line for that metric (LCP 2.5s, INP 200ms, CLS 0.1, FCP 1.8s, TTFB 0.8s),
-- over the loads that reported it: INP is absent from a load nobody interacted with.
--
-- GROUPING SETS, so the card gets each device and section, each device overall, and the whole
-- site in one read; a null `device` or `section` means "all". Percentiles cannot be combined
-- client-side, which is why the rollups are computed here.
--
-- Same footing as every admin_* function (docs/ADMIN_ANALYTICS.md section 2): security definer
-- so it can read the owner-only `events`, which is exactly why it must check is_site_owner()
-- itself before touching a row.

create or replace function public.admin_web_vitals(
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

  return result;
end;
$$;

revoke all    on function public.admin_web_vitals(int, text) from public;
grant execute on function public.admin_web_vitals(int, text) to authenticated;
