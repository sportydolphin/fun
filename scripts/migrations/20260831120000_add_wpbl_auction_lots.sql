-- wpbl_auction_lots: a snapshot of the league's lots on The Realest, so the merch bot can tell
-- what is NEW there. Same shape of idea as wpbl_shop_products, and deliberately a separate
-- table rather than a second source bolted onto it.
--
-- WHY NOT REUSE THE SHOP TABLES. They are Shopify-shaped: bigint ids, a product with variants,
-- a boolean `available` whose false-to-true transition is the entire point. None of that
-- survives the move. The Realest deals in one-of-one memorabilia (game-used bases, game-worn
-- jerseys, locker nameplates, lineup cards, infield dirt), its ids are uuids, and a lot has no
-- variants and no restock: 187 of the league's 190 lots are already sold or ended. Forcing a
-- lot into `wpbl_shop_variants` would mean an `available` column that can only ever go one way
-- and a bigint primary key holding a uuid.
--
-- SO THE ONLY EVENT HERE IS A NEW LOT. They arrive in batch drops rather than a trickle: 70 on
-- Jul 28, 104 over Aug 4-5, then 14 across the following fortnight and nothing since Aug 17.
-- That is also why the watcher checks this source hourly and the Shopify store every ten
-- minutes; polling a source that moves twice a month at merch cadence is 144 wasted requests a
-- day against a host whose robots.txt would rather we did not.
--
-- announced_new_at carries the same meaning it does on wpbl_shop_products, and for the same
-- reason: the first run records 190 lots and must announce none of them.

create table if not exists public.wpbl_auction_lots (
  -- The Realest's own uuid, as text. Stable across a rename; the slug is not, since it is the
  -- URL segment and is rebuilt from the title.
  lot_id           text primary key,
  slug             text not null,
  name             text not null,
  -- 'buy_now' or 'auction' while a sale is live, null once it has ended or before it opens.
  -- Recorded for context in the announcement, never as the trigger.
  offer_type       text,
  -- Cents, from whichever of the buy-now price, the current bid or the last sale applies. The
  -- API gives decimal STRINGS ("249.99"), the same trap as Shopify's /products.json: a round
  -- price like "250" lands as 250 cents if this is treated as an integer.
  price_cents      integer,
  -- The league's own posting timestamp, not ours. Kept because a lot appearing with a
  -- date_posted from weeks ago is evidence the snapshot is broken rather than news.
  date_posted      timestamptz,
  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  announced_new_at timestamptz
);

create index if not exists wpbl_auction_lots_date_posted_idx
  on public.wpbl_auction_lots (date_posted desc);

comment on table public.wpbl_auction_lots is
  'Snapshot of the league''s memorabilia lots on therealest.com. Written by '
  'scripts/watch-wpbl-restock.mjs. A lot_id never seen before is the one announcement this '
  'source produces; there is no restock, because every lot is one of one.';

-- ─── One health table, two sources ──────────────────────────────────────────
--
-- The outage notice measures from the last successful run, so the two sources must not be able
-- to answer for each other: a healthy Shopify check every ten minutes would otherwise keep the
-- auction watcher looking alive forever after it went blind. Existing rows are all Shopify
-- checks, which is what the default backfills them as.
alter table public.wpbl_shop_watch_runs
  add column if not exists source text not null default 'shop';

comment on column public.wpbl_shop_watch_runs.source is
  '''shop'' for the league Shopify store, ''auction'' for The Realest. lastGoodRun() filters on '
  'it so one source staying healthy cannot mask the other having died.';

create index if not exists wpbl_shop_watch_runs_source_ran_at_idx
  on public.wpbl_shop_watch_runs (source, ran_at desc);

alter table public.wpbl_auction_lots enable row level security;
