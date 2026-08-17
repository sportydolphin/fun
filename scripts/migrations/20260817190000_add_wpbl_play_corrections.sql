-- wpbl_play_corrections: our fixes to the league's play-by-play, kept OUT of the mirror.
--
-- WHY A SEPARATE TABLE RATHER THAN EDITING THE ROW.
--
-- wpbl_game_plays is a mirror, and wpbl-ingest treats it as one: it DELETES every play for a
-- game and reinserts them on each pass ("delete + reinsert (immutable per game, keeps sequence
-- clean)"). Anything corrected in place survives until the next cron tick and then vanishes,
-- silently, with no trace that it was ever there. A correction has to live somewhere the
-- ingest does not own.
--
-- Keyed on (game_id, sequence) rather than the play's uuid for the same reason: the uuid is
-- regenerated on every reinsert, so it identifies a row for minutes. The sequence number is
-- the feed's own stable identifier for a play within a game.
--
-- SHAPE. One row per field corrected, not per play. A play can be wrong in more than one way
-- (wrong batter AND wrong event), those are usually found at different times and by different
-- means, and one may be reverted without the other. `old_value` is stored so a correction can
-- be audited later against what the feed actually said, and so an overlay can notice when the
-- feed has since changed its mind and the correction is stale.
--
-- Values are text regardless of the column's real type. The set of correctable fields is small
-- and the overlay casts on the way out; a jsonb blob would be tidier in the abstract and worse
-- in practice, because every consumer would have to know the shape.

create table if not exists public.wpbl_play_corrections (
  id           uuid primary key default gen_random_uuid(),
  game_id      uuid not null references public.wpbl_games(id) on delete cascade,
  sequence     integer not null,

  -- Which field is wrong. Constrained deliberately: an open string invites corrections to
  -- fields the overlay does not apply, which then look applied and are not.
  field        text not null check (field in (
                 'batter_id', 'batter_name', 'pitcher_id', 'pitcher_name',
                 'event_type', 'runs_scored', 'is_hit', 'is_scoring_play', 'narrative'
               )),

  old_value    text,              -- what the feed said when the correction was made
  new_value    text,              -- null is a legitimate correction, so this is nullable
  reason       text not null,     -- free text, for the human who reads this in 2027

  -- How we know. 'video' is the strongest and the slowest; 'derived' means a rule in
  -- validate-wpbl-pbp.mjs concluded it; 'external' means a second transcription agreed.
  source       text not null default 'video'
                 check (source in ('video', 'derived', 'external', 'league')),

  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id) on delete set null,

  -- One correction per field per play. Re-correcting updates rather than accumulating.
  unique (game_id, sequence, field)
);

create index if not exists wpbl_play_corrections_game_idx
  on public.wpbl_play_corrections (game_id, sequence);

comment on table public.wpbl_play_corrections is
  'Our corrections to the league play-by-play. Applied as a read-time overlay because '
  'wpbl-ingest deletes and reinserts wpbl_game_plays wholesale on every run.';

-- Public read: the corrections are part of what the site shows, so the anon key needs them
-- exactly as it needs the plays themselves. Writes stay with the service role and the owner,
-- matching how every other WPBL table is fed.
alter table public.wpbl_play_corrections enable row level security;

drop policy if exists "wpbl_play_corrections public read" on public.wpbl_play_corrections;
create policy "wpbl_play_corrections public read"
  on public.wpbl_play_corrections for select using (true);

grant select on public.wpbl_play_corrections to anon, authenticated;
