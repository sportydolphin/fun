-- add wpbl game revisions
-- Created 2026-09-07. Applied by scripts/migrate.mjs.

-- wpbl_game_revisions: what the league changed about a game after it was final.
--
-- WHY IT HAS TO EXIST AT ALL. Everything else about a game is a MIRROR. `wpbl-ingest` deletes
-- and reinserts, `syncGameRows` overwrites, and the moment a revision is repaired the version
-- the league published first is gone with no trace it was ever there. The before and the after
-- coexist in exactly one place for exactly one moment: inside scripts/check-wpbl-drift.mjs,
-- between the scan that finds drift and the re-ingest that repairs it. This table is written
-- there, before the repair, or it cannot be written at all.
--
-- SO THIS IS NOT A MIRROR, and that is the one thing to keep. Nothing may rebuild it from the
-- feed, because the feed only ever holds the current version: a "resync" of this table would
-- silently empty it of the only copy of the past that exists. It is append-only, written once
-- per detected revision, by one writer.
--
-- WHAT IT ADDS to the revision stamp already on wpbl_games. `source_updated_at` says a game was
-- revised and when (see boxScoreRevision in src/wpbl/derive/feedHealth.ts, shipped v1.73.0);
-- its stated gap was that it cannot say WHAT changed. This is that.
create table if not exists public.wpbl_game_revisions (
  id                      uuid primary key default gen_random_uuid(),
  game_id                 uuid not null references public.wpbl_games (id) on delete cascade,

  -- WHICH OF TWO COMPLETELY DIFFERENT STORIES THIS IS, and getting it wrong would be a lie
  -- about someone else's work. The drift check finds one thing (our rows disagree with the
  -- feed) that has two causes, and `source_updated_at` is what tells them apart:
  --
  --   'league': the feed's stamp is NEWER than the one we held. The league re-scored the
  --              game. This is the changelog a reader is asking for.
  --   'mirror': the stamps are equal and the rows still differ. The league never touched it;
  --              our copy was wrong. That is our bug, not league news, and publishing it as
  --              "the league changed the score" would blame the scorer for our mistake.
  --
  -- Both are stored, because a mirror fault is worth keeping a record of too. Only 'league' is
  -- readable by the browser, and that gate is in the RLS policy below rather than in the query,
  -- for the reason docs/COMMONS_PHOTOS.md gives about its own approval gate: a query is one
  -- caller's discipline, a policy covers every caller including the ones not written yet.
  kind                    text not null check (kind in ('league', 'mirror')),

  -- The feed's stamp at detection, and the one we were holding before the repair. The reader's
  -- "revised on" day is derived from the first of these by the same formatter the game page
  -- already uses, so there is no second opinion about which calendar day a revision landed on.
  source_updated_at       timestamptz,
  prior_source_updated_at timestamptz,
  detected_at             timestamptz not null default now(),

  -- The changes themselves: an array of objects, each `{kind, field, before, after}` plus
  -- whatever identifies the thing that changed (a player's name and our player id, or a play's
  -- sequence, inning and batter). Shapes are documented on WpblRevisionChange in
  -- src/wpbl/types.ts and built by scripts/check-wpbl-drift.mjs.
  --
  -- JSONB and not a child table because nothing queries INTO it: a revision is read whole, for
  -- one game, and rendered as a list. A child table would buy filtering nobody has asked for
  -- and cost the guarantee that a revision is written in one statement.
  changes                 jsonb not null default '[]'::jsonb,
  -- The TRUE number of changes, which `jsonb_array_length(changes)` may be smaller than: a
  -- wholesale re-score can rewrite every play in a game, and the array is capped so one bad
  -- night cannot store a megabyte. Without this column the cap would be invisible and the page
  -- would confidently report "40 changes" for a game where 300 things moved.
  change_count            int not null default 0
);

-- One row per game per revision. Detection is idempotent by construction: the same revision
-- found twice (a local dry run, then the nightly job) carries the same feed stamp and collides.
-- COALESCE because a null stamp is not distinct from another null under a plain unique index,
-- and a boxscore that arrived without one would then insert without limit.
create unique index if not exists wpbl_game_revisions_unique_idx
  on public.wpbl_game_revisions (game_id, kind, coalesce(source_updated_at, 'epoch'::timestamptz));

-- The read is always "this game's revisions, newest first".
create index if not exists wpbl_game_revisions_game_idx
  on public.wpbl_game_revisions (game_id, detected_at desc);

alter table public.wpbl_game_revisions enable row level security;

-- Public read of LEAGUE revisions only. See the `kind` comment above: a mirror fault is our
-- bug and reaches nobody's browser. The nightly job writes over SUPABASE_DB_URL as the owner
-- and bypasses RLS entirely, so there is no insert policy to write.
drop policy if exists "WPBL league revisions are public" on public.wpbl_game_revisions;
create policy "WPBL league revisions are public" on public.wpbl_game_revisions
  for select using (kind = 'league');

drop policy if exists "Owner reads all WPBL revisions" on public.wpbl_game_revisions;
create policy "Owner reads all WPBL revisions" on public.wpbl_game_revisions
  for select using (public.is_site_owner());
