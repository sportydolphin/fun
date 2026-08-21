-- wpbl_game_details: the facts about a game that the league's own feed does not carry.
--
-- Source: RetroWPBL (github.com/exu6jh/RetroWPBL), an independent hand transcription of this
-- season into Retrosheet format, used with the transcriber's explicit permission (granted
-- Aug 21, 2026). Its event files open with `info` records that have no equivalent anywhere in
-- stats.womensprobaseballleague.com: first pitch, length of game, the umpiring crew and the
-- weather.
--
-- WHY A SEPARATE TABLE AND NOT COLUMNS ON wpbl_games. Because wpbl_games is a MIRROR.
-- `wpbl-ingest` upserts every scheduled and played game from the feed every two minutes, and
-- anything written into that row by another writer is living on borrowed time. The failure
-- would also be silent and slow: a duration would appear, survive until the next cron tick,
-- and vanish with no trace it had been there. Same reasoning as wpbl_play_corrections, which
-- exists because wpbl_game_plays is a mirror too. Keyed to the game rather than merged into
-- it, so the mirror stays the feed's and this stays ours.
--
-- THE SOURCE LAGS AND ALWAYS WILL. It is one person transcribing games by hand: 11 games
-- covered against our 16 finals on the day this shipped, running roughly six days behind.
-- Every consumer therefore has to treat a missing row as "not written up yet" rather than as
-- "no such game", which is why nothing here is NOT NULL beyond the key and why there is no
-- attempt to backfill a row per scheduled game.
--
-- WHY NOT ATTENDANCE. The Retrosheet gamelog has the field and it is 0 on every WPBL row.
-- A column that can only ever hold a zero is worse than no column, because the zero renders.

create table if not exists public.wpbl_game_details (
  -- Our game id, not RetroWPBL's. Their id is home team + date + game number ("NYH202608010")
  -- and is reconstructed by the sync from (date, home team); storing it as the key would make
  -- every reader do that translation. `retro_game_id` below keeps it for provenance.
  game_id            uuid primary key references public.wpbl_games(id) on delete cascade,
  retro_game_id      text not null,

  -- ─── The clock ───────────────────────────────────────────────────────────
  -- Local first pitch as transcribed ("5:00PM"), kept verbatim as text rather than parsed
  -- into a timestamptz. The feed's own start times are stored in Central and are already a
  -- documented trap (WPBL_TZ in constants.ts, and the Eastern/Central twin rows the ingest
  -- de-duplicates); inventing a second timezone opinion here would be a third version of the
  -- same fact. Readers render it as given.
  first_pitch_local  text,
  -- Minutes, from the event file's `timeofgame`. THIS IS THE POINT OF THE TABLE: game
  -- duration was investigated against the feed and found underivable, because there is no
  -- duration and no first-pitch field, `completed_at` is a processing timestamp, and plays
  -- carry no timestamps at all.
  duration_minutes   int check (duration_minutes is null or duration_minutes between 30 and 400),

  -- ─── The crew ────────────────────────────────────────────────────────────
  -- Names as transcribed, not ids into an umpires table. Five people work this whole league,
  -- every one of them appears here, and a join table for five rows buys nothing that a page
  -- about umpires would not have to denormalise straight back out.
  ump_home           text,
  ump_first          text,
  ump_second         text,
  ump_third          text,

  -- ─── The conditions ──────────────────────────────────────────────────────
  -- Fahrenheit, because that is what the source records and this league plays in Illinois.
  -- The site's unit switch converts on the way out, the way it already does for pitch speeds.
  temp_f             int check (temp_f is null or temp_f between -20 and 130),
  wind_dir           text,   -- Retrosheet vocabulary: ltor, rtol, fromcf, tocf, …
  sky                text,   -- sunny, cloudy, overcast, night, dome
  precip             text,   -- none, drizzle, rain, showers, snow
  field_cond         text,   -- dry, damp, wet, soaked

  -- ─── Where ───────────────────────────────────────────────────────────────
  -- Every game this season is at one venue, so this is constant today and will not be the
  -- day a second park appears. Stored rather than assumed for that reason alone.
  park_id            text,
  park_name          text,

  -- ─── Provenance ──────────────────────────────────────────────────────────
  -- Which upstream commit this row was read from, so a correction upstream can be told from a
  -- transcription that never changed, and so a re-sync can skip work.
  source             text not null default 'retrowpbl',
  source_commit      text,
  synced_at          timestamptz not null default now(),
  created_at         timestamptz not null default now()
);

comment on table public.wpbl_game_details is
  'Per-game facts absent from the league feed (first pitch, duration, umpires, weather), '
  'transcribed by RetroWPBL and used with permission. Separate from wpbl_games because that '
  'table is a feed mirror that wpbl-ingest overwrites every two minutes.';

alter table public.wpbl_game_details enable row level security;

-- Public read, owner writes: the same shape as every other WPBL table the browser only reads.
-- There is nothing private here; it is published data with an attribution requirement, and
-- the attribution is rendered by the client rather than enforced in the schema.
drop policy if exists "WPBL game details are public" on public.wpbl_game_details;
create policy "WPBL game details are public" on public.wpbl_game_details for select using (true);

drop policy if exists "Owner writes WPBL game details" on public.wpbl_game_details;
create policy "Owner writes WPBL game details" on public.wpbl_game_details
  for all using (public.is_site_owner()) with check (public.is_site_owner());
