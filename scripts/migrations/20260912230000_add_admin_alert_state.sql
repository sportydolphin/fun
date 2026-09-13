-- admin_alert_state: the dedupe memory for the owner health-alert cron.
--
-- scripts/check-admin-health.mjs runs on a schedule and pushes the owner when a background
-- pipeline breaks (a failed ingest, the "unmapped team" trap, the nightly scoring job going
-- missing). Without a memory it would re-push the same outage every run — the alert fatigue
-- that trains the owner to ignore the one signal this whole feature exists to make loud. This
-- table is that memory: one row per problem `key`, holding the signature it last alerted on and
-- when. The cron re-pushes only when the signature CHANGES (a new kind of problem) or when the
-- same problem has persisted past a reminder window; a row that clears is deleted.
--
-- SERVICE-ROLE ONLY, by having RLS on and no policies. Nothing in the browser reads or writes
-- it: it is cron bookkeeping, the same footing as the ingest and validation run tables' writes.
-- The state is not user data and carries nothing sensitive beyond a pipeline name and a short
-- error signature, but there is no reason for the anon key to see it, so it does not.

create table if not exists public.admin_alert_state (
  -- The HealthAlert.key from shared/adminHealth.js: 'ingest-down', 'ingest-errors',
  -- 'ingest-stale', 'scoring-down', 'scoring-stale'. One row per kind of problem.
  key           text primary key,
  -- The last signature paged for this key. Stable while a problem persists, changes when the
  -- problem itself does; the cron compares against it to decide whether to page again.
  signature     text not null,
  -- When the last page went out, for the "still broken N hours later" reminder cadence.
  last_alerted  timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.admin_alert_state is
  'Dedupe memory for the owner health-alert cron (scripts/check-admin-health.mjs): one row per '
  'active pipeline problem, so an outage pages once rather than every run. Service-role only.';

alter table public.admin_alert_state enable row level security;
-- No policies on purpose: only the service role (the cron) touches this. RLS on with no policy
-- means the anon and authenticated keys can neither read nor write it.
