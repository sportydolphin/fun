-- wpbl_news_watch: what scripts/watch-wpbl-news.mjs has already seen, so it reports each piece of
-- league news once.
--
-- Between seasons the league announces things the ingest never reads (WordPress posts and pages,
-- player records, the website calendar, YouTube) and the stats feed will one day carry the next
-- season with no announcement at all. The watcher compares each source with this table and
-- reports only what is new or moved. Without it, it would either repeat every item every run or
-- report once and miss the next.
--
-- ONE ROW PER (source, key): a post id, a feed season id, a player id. `fingerprint` is whatever
-- about the item counts as a change (a title, a status and club), so an edit reports as changed.
--
-- wpbl_news_watch_sources holds one row per source: whether its last read worked, and how many in
-- a row have failed. `seeded_at` is null until a read of that source first succeeds, which is
-- what makes that first read seed silently instead of reporting the league's whole history. A
-- source that has only ever failed still gets a row, so its failures are counted and can page.
--
-- Owner bookkeeping for a cron on SUPABASE_DB_URL, which bypasses RLS: RLS on with no policies,
-- so neither the anon key nor a signed-in reader can see it.

create table if not exists public.wpbl_news_watch (
  source      text not null,
  key         text not null,
  fingerprint text not null,
  title       text not null,
  url         text,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  primary key (source, key)
);

alter table public.wpbl_news_watch enable row level security;

create table if not exists public.wpbl_news_watch_sources (
  source               text primary key,
  seeded_at            timestamptz,
  last_ok_at           timestamptz,
  last_error           text,
  consecutive_failures integer not null default 0,
  items                integer not null default 0
);

alter table public.wpbl_news_watch_sources enable row level security;
