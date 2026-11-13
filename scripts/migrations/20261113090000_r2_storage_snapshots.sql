-- r2 storage snapshots
-- Created 2026-11-12. Applied by scripts/migrate.mjs.
--
-- The storage monitor (docs/FAN_UPLOADS.md, "Storage and its monitor"). R2 has a free tier and no
-- spending cap, and fan uploads are about to let strangers write to it, so the owner needs to see
-- usage without opening the Cloudflare dashboard. scripts/watch-r2-storage.mjs writes these daily
-- over SUPABASE_DB_URL; /admin reads them through the owner policy. Nobody else reads either table.

create table if not exists public.r2_storage_snapshots (
  day             date        not null,
  bucket          text        not null,
  object_count    bigint      not null,
  payload_bytes   bigint      not null,
  metadata_bytes  bigint      not null default 0,
  -- Operations in the calendar month (UTC) up to this snapshot, the window R2 bills on.
  class_a_month   bigint      not null default 0,
  class_b_month   bigint      not null default 0,
  recorded_at     timestamptz not null default now(),
  primary key (day, bucket)
);

-- One push per allowance per month: `key` is e.g. 'storage:2026-11'. Written by the job only.
create table if not exists public.r2_usage_alerts (
  key      text        primary key,
  sent_at  timestamptz not null default now(),
  detail   text
);

alter table public.r2_storage_snapshots enable row level security;
alter table public.r2_usage_alerts      enable row level security;

drop policy if exists "Owner reads R2 storage snapshots" on public.r2_storage_snapshots;
create policy "Owner reads R2 storage snapshots" on public.r2_storage_snapshots
  for select using ((select public.is_site_owner()));

drop policy if exists "Owner reads R2 usage alerts" on public.r2_usage_alerts;
create policy "Owner reads R2 usage alerts" on public.r2_usage_alerts
  for select using ((select public.is_site_owner()));
