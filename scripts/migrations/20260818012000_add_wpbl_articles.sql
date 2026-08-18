-- wpbl_articles: a mirror of an independent writer's Substack, so the section can point
-- readers at good writing about the league next to the numbers it already holds.
--
-- Source: "towards a more perfect game: women's baseball & the wpbl" by mary mustard
-- (towardsamoreperfectgame.substack.com). Populated by scripts/sync-wpbl-substack.ts on a
-- GitHub Actions cron, which reads her public archive API + RSS feed, keeps only the WPBL
-- posts, and resolves each one to the players, teams and game it is about.
--
-- THERE IS DELIBERATELY NO BODY COLUMN. The RSS feed hands over the complete article text
-- in content:encoded, and storing it would make us a mirror of her writing rather than a
-- signpost to it. The sync reads the body in memory to find names in it and throws it away.
-- Everything the app renders is a headline, a dek, a cover image and a link to her post.
-- Keeping the column out of the schema is what stops that rule from depending on everyone
-- remembering it.
--
-- Like the rest of WPBL the client degrades gracefully: until this table exists,
-- fetchWpblArticles() resolves to an empty list and every reading surface renders nothing.

create table if not exists public.wpbl_articles (
  post_id       bigint primary key,            -- Substack's stable numeric post id
  slug          text not null,
  url           text not null,                 -- canonical_url; what every card opens
  title         text not null,
  subtitle      text,                          -- her dek, often the best line on a card
  cover_url     text,
  published_at  timestamptz not null,
  word_count    int,                           -- drives the "N min read" label
  tags          text[] not null default '{}',  -- postTags names, as published
  -- The game this post recaps, when all three signals agree (two teams, a date within a
  -- couple of days, a score in the title matching the final). Null for everything else,
  -- which is most posts: a wrong story attached to a game is worse than no story.
  game_id       uuid references public.wpbl_games (id) on delete set null,
  -- Arrays rather than the single game_id + hints shape wpbl_videos uses: a highlight reel
  -- is about exactly one game, but an essay is genuinely about several people at once.
  team_ids      text[] not null default '{}',
  player_ids    uuid[] not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- The rail and archive read newest-first; the game card looks up by game_id; the player and
-- team surfaces ask "which posts contain this id", which is what the GIN indexes serve.
create index if not exists wpbl_articles_published_idx on public.wpbl_articles (published_at desc);
create index if not exists wpbl_articles_game_idx      on public.wpbl_articles (game_id);
create index if not exists wpbl_articles_players_idx   on public.wpbl_articles using gin (player_ids);
create index if not exists wpbl_articles_teams_idx     on public.wpbl_articles using gin (team_ids);

alter table public.wpbl_articles enable row level security;

-- Public read, owner-only writes. The sync runs on the service-role key (which bypasses
-- RLS), so the owner policy is belt-and-braces for a manual edit from the SQL editor.
drop policy if exists "WPBL articles are public" on public.wpbl_articles;
create policy "WPBL articles are public" on public.wpbl_articles for select using (true);

drop policy if exists "Owner writes WPBL articles" on public.wpbl_articles;
create policy "Owner writes WPBL articles" on public.wpbl_articles
  for all using (public.is_site_owner()) with check (public.is_site_owner());
