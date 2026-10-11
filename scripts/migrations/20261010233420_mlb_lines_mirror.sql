-- mlb_games, mlb_batting_lines, mlb_pitching_lines, mlb_players: every MLB box-score line, mirrored.
--
-- WHY. StatsAPI answers "who led the league" but never "what is the most anyone did in one game"
-- or "every game somebody struck out ten and walked nobody": those need every line of every game,
-- and a season is about 2,470 box scores, which no browser can fetch from StatsAPI. WPBL's Bests
-- and Find boards already answer both from its own mirror, and the engines behind them are now
-- league-neutral (src/league/). This is the MLB mirror they run on. ROADMAP.md item 6, step 3.
--
-- THE COLUMNS ARE THE NEUTRAL ONES (src/league/types.ts), which are WPBL's column names, so the
-- engines read these rows with no translation beyond turning ids into strings. Integers here
-- because StatsAPI's ids are integers and a season is ~90k rows: text keys would double the size.
--
-- ONLY APPEARANCES. A box score lists every player on the roster card; a batting row is kept only
-- for someone who batted, scored or ran, and a pitching row only for someone who pitched. The
-- WPBL finder already excludes non-appearances from what it searched, so storing them would be
-- space spent on rows nothing reads.
--
-- POSTSEASON. StatsAPI's playoff rounds are single letters (F, D, L, W) that the round-name pattern
-- in src/league/season.ts cannot match safely, so the job writes counts_in_standings = false on
-- them, which that module treats as definitive. Never null on a playoff row.
--
-- Written nightly by scripts/sync-mlb-lines.mjs with the service role; read by everyone.
-- Created 2026-10-10. Applied by scripts/migrate.mjs.

create table if not exists public.mlb_games (
  game_pk             integer primary key,
  season              smallint not null,
  game_date           date not null,
  game_type           text not null,
  counts_in_standings boolean not null,
  -- 'final' once StatsAPI's codedGameState is F. Only finals are stored today; the column exists
  -- because the engines filter on it, and a later pass may store games in progress.
  status              text not null,
  home_team_id        integer not null,
  away_team_id        integer not null,
  home_score          smallint,
  away_score          smallint,
  synced_at           timestamptz not null default now()
);

create index if not exists mlb_games_season on public.mlb_games (season, game_date);

create table if not exists public.mlb_batting_lines (
  game_pk   integer not null references public.mlb_games (game_pk) on delete cascade,
  player_id integer not null,
  -- The club played for THAT DAY. A traded player's line keeps the club it was played for.
  team_id   integer not null,
  ab smallint not null, r smallint not null, h smallint not null,
  doubles smallint not null, triples smallint not null, hr smallint not null,
  rbi smallint not null, bb smallint not null, so smallint not null, hbp smallint not null,
  sb smallint not null, cs smallint not null, sf smallint not null, sh smallint not null,
  gdp smallint not null, tb smallint not null,
  primary key (game_pk, player_id)
);

create table if not exists public.mlb_pitching_lines (
  game_pk   integer not null references public.mlb_games (game_pk) on delete cascade,
  player_id integer not null,
  team_id   integer not null,
  -- Innings as OUTS, as everywhere on the site: "5.2" is 17.
  outs smallint not null, bf smallint, h smallint not null, r smallint not null,
  er smallint not null, bb smallint not null, so smallint not null, hr smallint not null,
  pitches smallint, strikes smallint, hbp smallint not null, wp smallint not null,
  bk smallint not null,
  primary key (game_pk, player_id)
);

-- Names for the board rows, from the box scores themselves, so a board never has to ask StatsAPI
-- about 1,500 people. team_id is the club NOW; team_as_of is the date of the box score it came
-- from, and the job only ever moves it forward, because a re-read of an April game must not send a
-- player traded in July back to the club they left (CLAUDE.md, the WPBL trap of the same shape).
create table if not exists public.mlb_players (
  player_id  integer primary key,
  name       text not null,
  team_id    integer,
  team_as_of date
);

alter table public.mlb_games          enable row level security;
alter table public.mlb_batting_lines  enable row level security;
alter table public.mlb_pitching_lines enable row level security;
alter table public.mlb_players        enable row level security;

drop policy if exists "MLB games are public"          on public.mlb_games;
drop policy if exists "MLB batting lines are public"  on public.mlb_batting_lines;
drop policy if exists "MLB pitching lines are public" on public.mlb_pitching_lines;
drop policy if exists "MLB players are public"        on public.mlb_players;
create policy "MLB games are public"          on public.mlb_games          for select using (true);
create policy "MLB batting lines are public"  on public.mlb_batting_lines  for select using (true);
create policy "MLB pitching lines are public" on public.mlb_pitching_lines for select using (true);
create policy "MLB players are public"        on public.mlb_players        for select using (true);
