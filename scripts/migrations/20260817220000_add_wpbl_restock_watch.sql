-- wpbl_restock_watch: products on the league's Shopify store we want to hear about when
-- they come back in stock.
--
-- WHY A TABLE AND NOT A CONSTANT IN THE SCRIPT.
--
-- The job runs every 10 minutes, so the only interesting thing it ever does is notice a
-- CHANGE. That needs somewhere to remember what it saw last time, or it either shouts every
-- ten minutes for as long as the item is in stock, or shouts once ever and stays quiet
-- through the next restock. `last_available` is that memory, and once a row exists to hold
-- it, watching a second product is an insert rather than a code change.
--
-- Written by scripts/watch-wpbl-restock.mjs (service role, via GitHub Actions). Nothing in
-- the browser reads this, so it gets RLS with no policies at all: server-only bookkeeping,
-- exactly like wpbl_discord_board_state.

create table if not exists public.wpbl_restock_watch (
  id             uuid primary key default gen_random_uuid(),

  -- The store and the product's URL handle: shop.example.com/products/<handle>. Availability
  -- comes from Shopify's own /products/<handle>.js, which every storefront serves and which
  -- robots.txt permits (only /cart.js and the checkout paths are disallowed). That beats
  -- scraping the page: it is 3 KB of JSON with an explicit `available` per variant, and it
  -- does not move when the theme changes.
  shop_domain    text not null default 'shop.womensprobaseballleague.com',
  product_handle text not null,

  -- Which variant to watch. NULL means "tell me when ANY variant is available", which is the
  -- right default for a product with sizes. A single-variant product can pin the id so a
  -- restock of some future second colourway does not read as this one coming back.
  variant_id     bigint,

  label          text,              -- what to call it in the Discord message
  note           text,              -- why we are watching, for whoever reads this in 2027
  active         boolean not null default true,

  -- ─── What the last run saw ───────────────────────────────────────────────
  last_available    boolean,        -- null = never successfully checked
  last_checked_at   timestamptz,    -- every attempt, successful or not
  last_ok_at        timestamptz,    -- last attempt that actually reached the store
  last_notified_at  timestamptz,    -- last restock alert we sent
  last_error        text,
  -- The watcher is only useful if it is running. If the store stops answering we say so once,
  -- rather than every ten minutes, and rather than going quiet and letting the restock pass
  -- unnoticed. Cleared on the next successful check so a later outage alerts again.
  error_notified_at timestamptz,

  created_at     timestamptz not null default now()
);

-- One row per thing watched. `nulls not distinct` (PG 15+) is the point: without it, two
-- "any variant" rows for the same product both have variant_id = null, Postgres reads those
-- as distinct, and the product gets watched twice and announced twice.
create unique index if not exists wpbl_restock_watch_target_idx
  on public.wpbl_restock_watch (shop_domain, product_handle, variant_id) nulls not distinct;

comment on table public.wpbl_restock_watch is
  'Shopify products to announce in Discord when they come back in stock. Written by '
  'scripts/watch-wpbl-restock.mjs. last_available is what makes the job announce a change '
  'rather than a state.';

-- Server-only, like wpbl_discord_board_state: RLS on with no policies, so the anon and
-- authenticated keys see nothing. The watcher uses the service role and bypasses it.
alter table public.wpbl_restock_watch enable row level security;

-- The reason this table exists today: the giveaway winner picked this cap and it is out of
-- stock. Single-variant product, so the variant is pinned.
insert into public.wpbl_restock_watch (product_handle, variant_id, label, note)
values (
  'san-francisco-new-era-9forty-a-frame-alternate-colors-cap',
  45424656580655,
  'San Francisco New Era 9FORTY A-Frame Alternate Colors Cap',
  'Giveaway winner''s chosen prize, out of stock when they picked it.'
)
on conflict do nothing;
