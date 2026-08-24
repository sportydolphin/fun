-- wpbl_mention_hits: every public post the mention watcher has already seen, so the same
-- thread is never surfaced twice.
--
-- WHY THIS EXISTS. People keep asking, in public, where they can follow a WPBL game live.
-- That question is the single best moment to mention the site, and it is currently found by
-- luck. This is the un-lucky version: poll the places whose terms of service permit it,
-- and put the threads worth answering in one Discord channel.
--
-- IT FINDS THREADS. IT DOES NOT ANSWER THEM. Nothing here or in the script ever posts a reply
-- anywhere but our own Discord. An auto-reply in someone else's community is spam, gets the
-- account banned from exactly the places worth being in, and would burn goodwill that took
-- months to build. The job's output is a human's to-do list.
--
-- FACEBOOK IS ABSENT ON PURPOSE. The Groups API was withdrawn, group content is in no search
-- API, and scraping it violates the terms whichever account does it. The two groups that are
-- already working are worked by hand; see docs/BACKLINKS.md.
--
-- ANNOUNCING IS SEPARATE FROM SEEING (announced_at). The first run looks back a week and can
-- find dozens at once. Recording all of them but announcing a budgeted few per run turns that
-- backlog into a drip instead of one unreadable wall, and nothing is lost: a row still holding
-- announced_at null is simply next run's message. Rows that go stale before their turn are
-- marked announced WITHOUT being posted, so a one-off flood cannot dribble out for a month.
create table if not exists public.wpbl_mention_hits (
  -- "<source>:<the source's own id>", e.g. "reddit:t3_1abcdef" or the post's at:// uri.
  -- The source's id rather than the URL: a Reddit permalink carries the (mutable) title slug,
  -- so the same post can present two URLs and would dedupe as two threads.
  external_id  text primary key,
  source       text not null,                  -- 'reddit' | 'bluesky'
  -- 'question' is someone asking where to follow along, which is the whole point of the job.
  -- 'mention' is the league being discussed without a question, and 'link' is somebody naming
  -- the site itself. Different urgencies, so the digest keeps them apart.
  kind         text not null,
  url          text not null,
  author       text,
  title        text,
  excerpt      text,
  -- Which terms matched, kept so a query that starts pulling junk can be diagnosed from the
  -- rows rather than by guessing at the search strings.
  matched      text[] not null default '{}',
  posted_at    timestamptz,                    -- when the human posted it, per the source
  found_at     timestamptz not null default now(),
  -- Null means "not yet in a digest". See the note above: this is the drip, not a duplicate
  -- of found_at.
  announced_at timestamptz
);

create index if not exists wpbl_mention_hits_pending_idx
  on public.wpbl_mention_hits (posted_at desc) where announced_at is null;

-- Run health, so a watcher that has quietly died can be told apart from a quiet week. Same
-- shape and same reasoning as wpbl_shop_watch_runs.
create table if not exists public.wpbl_mention_watch_runs (
  id           uuid primary key default gen_random_uuid(),
  ran_at       timestamptz not null default now(),
  ok           boolean not null default true,
  seen         integer not null default 0,     -- results read from the sources
  new_hits     integer not null default 0,     -- of those, ones never recorded before
  announced    integer not null default 0,
  error        text
);

create index if not exists wpbl_mention_watch_runs_ran_at_idx
  on public.wpbl_mention_watch_runs (ran_at desc);

comment on table public.wpbl_mention_hits is
  'Public posts about the WPBL that the mention watcher has seen, written by '
  'scripts/watch-wpbl-mentions.mjs. Dedupe plus a drip queue: announced_at null means the row '
  'is waiting for a digest. The job only ever posts to our own Discord, never replies anywhere.';

-- Server-only bookkeeping: RLS on, no policies, so the anon and authenticated keys see
-- nothing. The job uses the service role and bypasses it.
alter table public.wpbl_mention_hits       enable row level security;
alter table public.wpbl_mention_watch_runs enable row level security;
