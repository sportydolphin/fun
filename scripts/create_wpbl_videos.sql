-- WPBL video highlights — a mirror of the league's official YouTube uploads, so the
-- app can surface game recaps without every browser hitting YouTube on load. Populated
-- by scripts/sync-wpbl-youtube.mjs (GitHub Actions cron), which reads the channel's
-- public RSS feed, parses each highlight title into the game it recaps, and upserts here.
-- The browser only ever reads this table (public select); the sync writes as the owner.
--
-- Run once in the Supabase SQL editor before shipping the highlights rail. Like the rest
-- of WPBL, the client degrades gracefully: until this table exists, fetchWpblVideos()
-- resolves to an empty list and the rail simply doesn't render.

-- ─── wpbl_videos ────────────────────────────────────────────────────────────────
-- One row per uploaded video. Keyed by the YouTube video id (the 11-char code in the
-- watch URL), which is stable and the natural upsert key. `game_id` is the WPBL game the
-- video recaps, resolved by the sync from the parsed title; null when the title didn't
-- parse to a known game (podcasts, league features, an unrecognised matchup). The
-- *_hint columns preserve what the parser read from the title, so a mismatch is
-- debuggable and a later re-match (once a game row exists) is possible without re-fetching.
create table if not exists public.wpbl_videos (
  video_id      text primary key,                 -- YouTube 11-char id
  title         text not null,
  published_at  timestamptz not null,             -- upload time from the feed
  thumbnail_url text,                              -- i.ytimg.com poster
  kind          text not null default 'other',    -- 'highlight' | 'podcast' | 'other'
  game_id       uuid references public.wpbl_games (id) on delete set null,
  away_hint     text,                              -- team id parsed from the title (away)
  home_hint     text,                              -- team id parsed from the title (home)
  game_date_hint date,                             -- date parsed from the title
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- The rail reads newest-first; the per-game recap looks up by game_id.
create index if not exists wpbl_videos_published_idx on public.wpbl_videos (published_at desc);
create index if not exists wpbl_videos_game_idx       on public.wpbl_videos (game_id);
create index if not exists wpbl_videos_kind_idx       on public.wpbl_videos (kind);

alter table public.wpbl_videos enable row level security;

-- Public read; owner-only writes (the sync uses the service role key, which bypasses RLS,
-- so this owner policy is just belt-and-suspenders for a manual insert from the SQL editor).
drop policy if exists "WPBL videos are public" on public.wpbl_videos;
create policy "WPBL videos are public" on public.wpbl_videos for select using (true);

drop policy if exists "Owner writes WPBL videos" on public.wpbl_videos;
create policy "Owner writes WPBL videos" on public.wpbl_videos
  for all using (public.is_site_owner()) with check (public.is_site_owner());
