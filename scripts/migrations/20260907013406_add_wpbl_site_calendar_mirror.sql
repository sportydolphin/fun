-- add wpbl site calendar mirror
-- Created 2026-09-07. Applied by scripts/migrate.mjs.

-- wpbl_site_games: the league's own WEBSITE calendar, which is a different publication from
-- the stats feed everything else here mirrors.
--
-- WHY A SECOND SOURCE AT ALL. The stats feed (stats.womensprobaseballleague.com/v1) needs two
-- clubs before it will carry a game row, so it holds nothing for a postseason whose clubs are
-- decided by the last regular-season game: on Sep 6, 2026 it had 61 rows and every one of them
-- was game_type 'regular'. The website's calendar had all eleven postseason games six weeks
-- earlier, with dates, first-pitch times, tickets, and, for the six semifinal games, WHICH CLUB
-- BATS LAST. A reader had to point that out: the section had been printing the postseason with
-- no home club and a comment in the code saying the league had never published one.
--
-- WHAT IT IS NOT. It is not a second opinion about anything the stats feed carries. The feed
-- stays the source for scores, box scores, plays and standings, and nothing derived reads this
-- table. It answers exactly one question the feed cannot yet answer, which is what a scheduled
-- game the feed has never heard of looks like, and it retires itself game by game as the feed
-- picks each one up.
--
-- KEYED ON THE SITE'S OWN EVENT ID, a WordPress post id, so a game that moves date keeps its
-- row rather than arriving as a duplicate. `round` / `series_key` / `game_number` are parsed
-- out of the event's slug ("semi-final-series-a-playoff-game-2"), which is the only field that
-- says which series a postseason row belongs to, and they are NULLABLE on purpose: a slug the
-- parser does not recognise stores nulls and the app falls back to its own published constant,
-- rather than a wrong series being asserted.
create table if not exists public.wpbl_site_games (
  event_id           bigint primary key,
  -- The instant, exactly as published. Everything below is derived from it.
  starts_at          timestamptz not null,
  -- The same two fields wpbl_games uses, in the same shapes, so a row from here can be handed
  -- to the same formatter without a second spelling of "when": a Central calendar date and a
  -- Central wall clock. The venue is one hub stadium in Springfield IL, so Central is the
  -- league's own clock rather than a guess about the reader.
  game_date          date not null,
  start_time         text not null,
  title              text not null,
  status             text not null,
  status_label       text,
  -- The site publishes an abbreviation ("SF") that happens to be exactly our team id. The FK is
  -- what keeps that from being a coincidence we rely on silently: an abbreviation naming no
  -- club fails the write rather than storing a dangling one. Null while a game has no clubs,
  -- which is every championship game until the semifinals are done.
  home_team_id       text references public.wpbl_teams (id),
  away_team_id       text references public.wpbl_teams (id),
  home_score         int,
  away_score         int,
  venue              text,
  -- The league's own page for this game, and its ticketing link. Nothing renders these yet.
  url                text,
  ticket_status      text,
  ticket_url         text,
  promotion_theme    text,
  promotion_giveaway text,
  -- Parsed from the slug: 'semifinal' | 'championship', 'A' | 'B', and the game within the
  -- series. Null for a regular-season row, whose slug carries no series.
  round              text check (round in ('semifinal', 'championship')),
  series_key         text check (series_key in ('A', 'B')),
  game_number        int,
  -- The sync never deletes, so this is how a game withdrawn from the league's calendar becomes
  -- visible: its row stops being touched while everything around it moves.
  last_seen_at       timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists wpbl_site_games_date_idx on public.wpbl_site_games (game_date);
create unique index if not exists wpbl_site_games_series_idx
  on public.wpbl_site_games (round, series_key, game_number)
  where round is not null and game_number is not null;

alter table public.wpbl_site_games enable row level security;

-- Public read, owner-only writes, the same shape as wpbl_videos and wpbl_articles: the browser
-- reads it directly and the sync writes with the service-role key, which bypasses RLS, so the
-- owner policy is there for a hand-edit from the SQL editor.
drop policy if exists "WPBL site games are public" on public.wpbl_site_games;
create policy "WPBL site games are public" on public.wpbl_site_games for select using (true);

drop policy if exists "Owner writes WPBL site games" on public.wpbl_site_games;
create policy "Owner writes WPBL site games" on public.wpbl_site_games
  for all using (public.is_site_owner()) with check (public.is_site_owner());
