-- wpbl_instagram_posts: every post the Instagram watcher has read from the league's account and
-- the four clubs', so a post is announced once and the re-signings have a record to build on.
--
-- WHY THIS EXISTS. The league announces 2027 re-signings on Instagram and nowhere else: no feed
-- endpoint, no press release, and the first two (Nov 10 and 11, 2026) were posted by the club
-- accounts, not the league's. Watching by hand misses them.
--
-- EVERY POST, NOT ONLY RE-SIGNINGS. Storing the rest costs nothing at five accounts and a few
-- posts a day, and lets a matcher that missed one be fixed and re-run over what is already held
-- rather than over a feed that only serves the latest posts.
--
-- SERVICE ROLE ONLY (RLS on, no policies). Captions are the league's copy, not ours, and
-- nothing on the site reads this table yet. A public read of re-signings should go through a
-- view of the confirmed rows when the site shows them, not open this table.
create table if not exists public.wpbl_instagram_posts (
  -- Instagram's media id. The permalink's shortcode would also do, but the id is what the API
  -- keys everything on and it never changes when a caption is edited.
  media_id      text primary key,
  account       text not null,                  -- the handle, e.g. 'wpbl_queens'
  team_id       text references public.wpbl_teams (id) on delete set null, -- null for the league
  permalink     text not null,
  caption       text,
  media_type    text,                           -- IMAGE | VIDEO | CAROUSEL_ALBUM
  posted_at     timestamptz not null,
  -- 'resign' is re-signing wording plus a rostered player's name; 'other' is everything else.
  -- Wording alone is not enough: the league's "Who do you hope to see re-signed??" has it.
  kind          text not null default 'other' check (kind in ('resign', 'other')),
  -- The players the caption names, kept as ids and names both so a wrong match can be read
  -- off the row without a join.
  player_ids    uuid[] not null default '{}',
  player_names  text[] not null default '{}',
  seen_at       timestamptz not null default now(),
  -- Null until the Discord alert is sent. Recorded and announced are separate steps so a
  -- webhook outage retries next run instead of losing the alert.
  announced_at  timestamptz
);

create index if not exists wpbl_instagram_posts_pending_idx
  on public.wpbl_instagram_posts (posted_at desc) where kind = 'resign' and announced_at is null;

-- One row per run, the same shape and reason as wpbl_mention_watch_runs: a watcher that stopped
-- and a quiet offseason look identical from Discord, and this is how they are told apart.
create table if not exists public.wpbl_instagram_watch_runs (
  id            uuid primary key default gen_random_uuid(),
  ran_at        timestamptz not null default now(),
  ok            boolean not null default true,
  seen          integer not null default 0,
  new_posts     integer not null default 0,
  announced     integer not null default 0,
  -- Set on the run that posted the token warning, so it is said once a day rather than every
  -- fifteen minutes for a week.
  token_warned  boolean not null default false,
  error         text
);

create index if not exists wpbl_instagram_watch_runs_ran_at_idx
  on public.wpbl_instagram_watch_runs (ran_at desc);

alter table public.wpbl_instagram_posts      enable row level security;
alter table public.wpbl_instagram_watch_runs enable row level security;

/**
 * Wakes the watcher every 15 minutes. GitHub's own schedule runs this repo's workflows 5 to 7
 * times a day whatever the cron says (measured Sep 7, 2026), which during a ten-day re-signing
 * window means hearing about one half a day late. Fourteen minutes so a 15-minute pg_cron
 * always clears the gate.
 */
create or replace function public.wpbl_nudge_instagram_watch()
returns boolean
language sql
set search_path = public
as $$ select public.wpbl_dispatch_workflow('wpbl-instagram-watch', '', interval '14 minutes') $$;

-- Callable by anon otherwise (Supabase's default grants), and each call is a workflow run on
-- our GitHub minutes. Only pg_cron, as the postgres role, needs it. Same lock as the siblings.
revoke all on function public.wpbl_nudge_instagram_watch() from public;
revoke all on function public.wpbl_nudge_instagram_watch() from anon, authenticated;

-- cron.schedule replaces a job of the same name, so re-running this file is safe.
select cron.schedule('wpbl-instagram-watch-nudge', '*/15 * * * *', $$ select public.wpbl_nudge_instagram_watch(); $$);
