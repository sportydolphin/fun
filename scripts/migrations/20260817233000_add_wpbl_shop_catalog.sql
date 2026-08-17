-- wpbl_shop_products / wpbl_shop_variants: a snapshot of the league's Shopify catalog, so the
-- watcher can tell what CHANGED since last run.
--
-- WHY THE SCOPE GREW. The watcher started out asking about one cap. Watching the whole store
-- for new merch and restocks is the same question asked 271 times, and the honest way to
-- answer it is to keep a snapshot and diff it, rather than to keep a list of things to poll.
--
-- ONE SOURCE OF TRUTH FOR "WAS IT IN STOCK LAST TIME". That state now lives here, on the
-- variant, and nowhere else. wpbl_restock_watch used to carry its own copy; keeping both would
-- mean two places that can disagree about whether an item has already been announced, and the
-- symptom of them disagreeing is a missed alert. So the per-row state columns come off that
-- table below. Nothing has ever been written to them (the job had not completed a real check
-- when this was applied), so no history is lost.
--
-- WHAT wpbl_restock_watch IS NOW: a shortlist of things worth SHOUTING about. Everything in
-- the catalog is announced quietly in the shop channel; a product on that list additionally
-- gets a loud @everyone alert in the private channel. It no longer drives the polling.

create table if not exists public.wpbl_shop_products (
  product_id       bigint primary key,           -- Shopify's id, stable across renames
  handle           text not null,                -- the URL segment; CAN change, so not the key
  title            text not null,
  product_type     text,
  published_at     timestamptz,
  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  -- Null means never announced, which is also true of everything written by the first
  -- seeding run. That is the point: seeding must not announce 78 products as new merch.
  announced_new_at timestamptz,
  -- Set when a product stops appearing in the catalog. Kept rather than deleted so a product
  -- that comes back is not announced as new a second time.
  delisted_at      timestamptz
);

create table if not exists public.wpbl_shop_variants (
  variant_id        bigint primary key,
  product_id        bigint not null references public.wpbl_shop_products(product_id) on delete cascade,
  title             text,                        -- the size or colourway ('Default Title' when there is one)
  price_cents       integer,
  -- The whole point of the table. Compared against the live catalog on every run; a false to
  -- true transition is a restock.
  available         boolean not null,
  last_seen_at      timestamptz not null default now(),
  last_restocked_at timestamptz
);

create index if not exists wpbl_shop_variants_product_idx
  on public.wpbl_shop_variants (product_id);

-- Run health, so a watcher that has quietly died can be told apart from a quiet store. Same
-- shape and same reasoning as wpbl_pbp_validation_runs.
create table if not exists public.wpbl_shop_watch_runs (
  id             uuid primary key default gen_random_uuid(),
  ran_at         timestamptz not null default now(),
  ok             boolean not null default true,
  products_seen  integer not null default 0,
  new_products   integer not null default 0,
  restocks       integer not null default 0,
  error          text
);

create index if not exists wpbl_shop_watch_runs_ran_at_idx
  on public.wpbl_shop_watch_runs (ran_at desc);

comment on table public.wpbl_shop_products is
  'Snapshot of the WPBL Shopify catalog. Written by scripts/watch-wpbl-restock.mjs. The diff '
  'against the live store is what produces new-merch and restock announcements.';
comment on table public.wpbl_shop_variants is
  'Per-variant availability. available is last run''s value; false -> true is a restock.';

-- Server-only bookkeeping, like wpbl_shop_watch_runs' siblings: RLS on, no policies, so the
-- anon and authenticated keys see nothing. The job uses the service role and bypasses it.
alter table public.wpbl_shop_products   enable row level security;
alter table public.wpbl_shop_variants   enable row level security;
alter table public.wpbl_shop_watch_runs enable row level security;

-- ─── wpbl_restock_watch becomes a shortlist, not a poller ────────────────────
alter table public.wpbl_restock_watch drop column if exists last_available;
alter table public.wpbl_restock_watch drop column if exists last_checked_at;
alter table public.wpbl_restock_watch drop column if exists last_ok_at;
alter table public.wpbl_restock_watch drop column if exists last_error;
alter table public.wpbl_restock_watch drop column if exists error_notified_at;

alter table public.wpbl_restock_watch add column if not exists last_announced_at timestamptz;

comment on table public.wpbl_restock_watch is
  'Products worth SHOUTING about: a restock here gets an @everyone alert in the private '
  'channel on top of the quiet post every restock gets in the shop channel. Availability '
  'state lives in wpbl_shop_variants, not here.';
