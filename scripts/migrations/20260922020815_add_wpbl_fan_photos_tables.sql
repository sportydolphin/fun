-- add wpbl fan photos tables
-- Created 2026-09-22. Applied by scripts/migrate.mjs.
--
-- Fan-submitted photographs of the current league, tagged by who is in them and surfaced on
-- player pages. See docs/FAN_PHOTOS.md for the full argument. This is NOT wpbl_photos: that
-- table is the Commons history gallery, keyed on Commons' page_id with a licence slug and a
-- source category that a fan photo never has. These stay separate tables on purpose.
--
-- What it copies from wpbl_photos, deliberately: the approval gate lives in RLS, never in the
-- client query; every string is plain text rendered as text; the credit sits on every row.

-- ─── Contributors: the permission record, owner-only ─────────────────────────
-- Not publicly readable AT ALL. The public credit is denormalized onto the photo row, so no
-- reader ever queries this table. RLS is row-level and cannot hide a column, so a private
-- field (contact, permission evidence) on a publicly-readable row would be a leak, not a
-- precaution: it gets its own owner-only table instead.
create table if not exists public.wpbl_photo_contributors (
  id                    uuid primary key default gen_random_uuid(),
  display_name          text not null,             -- how they want to be credited
  contact               text,                      -- how to reach them
  -- Where the grant is actually recorded: a link to the Discord message or the email. A
  -- permission nobody can produce later is not one.
  permission_granted_on date,
  permission_evidence   text,
  -- What they agreed to. Site display is not social sharing, and neither is print.
  permission_scope      text,
  -- The takedown path, and one column because it has to be one update: a contributor who
  -- changes their mind should not require finding their photographs by memory. Photos link
  -- back via contributor_id, so withdrawing is: set this, then unapprove their rows.
  withdrawn_on          date,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

alter table public.wpbl_photo_contributors enable row level security;
drop policy if exists "Owner reads/writes fan photo contributors" on public.wpbl_photo_contributors;
create policy "Owner reads/writes fan photo contributors" on public.wpbl_photo_contributors
  for all using (public.is_site_owner()) with check (public.is_site_owner());

-- ─── Figures: the non-player subjects ────────────────────────────────────────
-- Managers, coaches, broadcasters, staff, umpires and mascots (Gladys the Goose), so they
-- have names to tag and show. `key` follows the existing `mgr:<slug>` convention from
-- awards.ts. `kind` DELIBERATELY does not cover places: every tag is a person or a character,
-- so wpbl_photo_subjects answers exactly one question, who is in this photograph. A future
-- "photos of the ballpark" wants its own column, not a second meaning for this one.
create table if not exists public.wpbl_photo_figures (
  key        text primary key,                 -- 'mgr:...', 'mascot:gladys-goose'
  name       text not null,
  kind       text not null
             check (kind in ('mascot', 'manager', 'coach', 'broadcaster', 'staff', 'umpire')),
  blurb      text,
  team_id    text references public.wpbl_teams (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.wpbl_photo_figures enable row level security;
-- Public read: figures are shown as gallery filters. Owner writes.
drop policy if exists "Fan photo figures are public" on public.wpbl_photo_figures;
create policy "Fan photo figures are public" on public.wpbl_photo_figures for select using (true);
drop policy if exists "Owner writes fan photo figures" on public.wpbl_photo_figures;
create policy "Owner writes fan photo figures" on public.wpbl_photo_figures
  for all using (public.is_site_owner()) with check (public.is_site_owner());

-- ─── The photographs ─────────────────────────────────────────────────────────
-- No club column: a photo's club comes from the game or the date, because a player's team_id
-- means "now", never "then" (a July photo of a player traded in August must not carry her
-- current cap).
create table if not exists public.wpbl_fan_photos (
  id             uuid primary key default gen_random_uuid(),
  -- sha256 of the ORIGINAL bytes. Makes the ingest idempotent and collapses two fans sending
  -- the same shot into one row; without it, re-running over a drop folder duplicates the
  -- batch, and the duplicate is not visibly one once captions differ.
  sha256         text not null unique,
  storage_path   text not null,                -- content-addressed R2 path; re-upload overwrites
  card_url       text not null,                -- the card render
  full_url       text not null,                -- the lightbox render
  -- Dimensions of the PUBLISHED render, not the original: we make the thumbnails here (unlike
  -- wpbl_photos, where Commons makes them), so the number reserving layout space is the number
  -- actually served.
  width          int,
  height         int,
  caption        text,
  credit         text,                         -- denormalized from the contributor
  contributor_id uuid references public.wpbl_photo_contributors (id) on delete set null,
  -- Curated. EXIF seeds this and does not settle it.
  taken_on       date,
  -- Store from day one even though Game Center is fourth on the surface list: it costs nothing
  -- now and a backfill later means re-identifying every photograph by eye.
  game_id        uuid references public.wpbl_games (id) on delete set null,
  approved       bool not null default false,
  sort_order     int,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- The gallery and the strips read "approved, in order". The partial index keeps the
-- unreviewed backlog out of it.
create index if not exists wpbl_fan_photos_approved_idx
  on public.wpbl_fan_photos (sort_order nulls last, created_at) where approved;
create index if not exists wpbl_fan_photos_game_idx
  on public.wpbl_fan_photos (game_id) where game_id is not null;

alter table public.wpbl_fan_photos enable row level security;
-- Public read is gated on `approved`, exactly like wpbl_photos: a row is NOT public simply by
-- existing, or the approval gate is a UI convention rather than a rule. The client query must
-- NOT also filter on approved, so the filter never reads as though it were the protection.
drop policy if exists "Approved fan photos are public" on public.wpbl_fan_photos;
create policy "Approved fan photos are public" on public.wpbl_fan_photos for select using (approved);
drop policy if exists "Owner writes fan photos" on public.wpbl_fan_photos;
create policy "Owner writes fan photos" on public.wpbl_fan_photos
  for all using (public.is_site_owner()) with check (public.is_site_owner());

-- ─── Subjects: who is in each photo (many-to-many) ───────────────────────────
-- Exactly one of player_id / figure_key is set. The player_id FK is not decoration: it is
-- what lets wpbl_merge_players repoint tags (extended below, in this same migration).
create table if not exists public.wpbl_photo_subjects (
  id         uuid primary key default gen_random_uuid(),
  photo_id   uuid not null references public.wpbl_fan_photos (id) on delete cascade,
  player_id  uuid references public.wpbl_players (id) on delete cascade,
  figure_key text references public.wpbl_photo_figures (key) on delete cascade,
  created_at timestamptz not null default now(),
  constraint wpbl_photo_subjects_one_subject
    check ((player_id is not null) <> (figure_key is not null))
);
-- No photo carries the same subject twice.
create unique index if not exists wpbl_photo_subjects_player_uidx
  on public.wpbl_photo_subjects (photo_id, player_id) where player_id is not null;
create unique index if not exists wpbl_photo_subjects_figure_uidx
  on public.wpbl_photo_subjects (photo_id, figure_key) where figure_key is not null;
-- The player-page lookup: every photo of one subject.
create index if not exists wpbl_photo_subjects_player_idx
  on public.wpbl_photo_subjects (player_id) where player_id is not null;
create index if not exists wpbl_photo_subjects_figure_idx
  on public.wpbl_photo_subjects (figure_key) where figure_key is not null;

alter table public.wpbl_photo_subjects enable row level security;
-- A tag is public only when its photo is. Gating on the parent keeps an unapproved photo's
-- subjects (which leak its existence and who curation thinks is in it) out of every read.
drop policy if exists "Fan photo subjects follow the photo" on public.wpbl_photo_subjects;
create policy "Fan photo subjects follow the photo" on public.wpbl_photo_subjects
  for select using (exists (
    select 1 from public.wpbl_fan_photos p
     where p.id = photo_id and p.approved
  ));
drop policy if exists "Owner writes fan photo subjects" on public.wpbl_photo_subjects;
create policy "Owner writes fan photo subjects" on public.wpbl_photo_subjects
  for all using (public.is_site_owner()) with check (public.is_site_owner());

-- ─── Extend wpbl_merge_players to repoint photo tags ─────────────────────────
-- MUST ship with the table above, not after: wpbl_merge_players hand-lists every table
-- holding a player_id and does not discover them, so a tag table it has not been taught about
-- silently orphans every tag on the merged player. Merges happen for real (Diana Ibarra, Suzu
-- Narasaki). This is a full replace of the function with one block added; everything else is
-- verbatim from the current definition in 20260901204532_dedupe_player_team_changes.sql.
create or replace function public.wpbl_merge_players(keep uuid, dupe uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if keep = dupe then
    raise exception 'wpbl_merge_players: keep and dupe are the same row (%)', keep;
  end if;
  if not exists (select 1 from wpbl_players where id = keep) then
    raise exception 'wpbl_merge_players: keep row % does not exist', keep;
  end if;
  if not exists (select 1 from wpbl_players where id = dupe) then
    raise exception 'wpbl_merge_players: dupe row % does not exist', dupe;
  end if;

  delete from wpbl_batting_lines d
   where d.player_id = dupe
     and exists (select 1 from wpbl_batting_lines k where k.player_id = keep and k.game_id = d.game_id);
  delete from wpbl_pitching_lines d
   where d.player_id = dupe
     and exists (select 1 from wpbl_pitching_lines k where k.player_id = keep and k.game_id = d.game_id);
  delete from wpbl_fielding_lines d
   where d.player_id = dupe
     and exists (select 1 from wpbl_fielding_lines k where k.player_id = keep and k.game_id = d.game_id);

  update wpbl_batting_lines  set player_id = keep where player_id = dupe;
  update wpbl_pitching_lines set player_id = keep where player_id = dupe;
  update wpbl_fielding_lines set player_id = keep where player_id = dupe;

  update wpbl_game_plays set batter_id  = keep where batter_id  = dupe;
  update wpbl_game_plays set pitcher_id = keep where pitcher_id = dupe;

  update wpbl_plays set batter_id           = keep where batter_id           = dupe;
  update wpbl_plays set pitcher_id          = keep where pitcher_id          = dupe;
  update wpbl_plays set runner_id           = keep where runner_id           = dupe;
  update wpbl_plays set runner_first_after  = keep where runner_first_after  = dupe;
  update wpbl_plays set runner_second_after = keep where runner_second_after = dupe;
  update wpbl_plays set runner_third_after  = keep where runner_third_after  = dupe;

  update wpbl_games set home_pitcher_id = keep where home_pitcher_id = dupe;
  update wpbl_games set away_pitcher_id = keep where away_pitcher_id = dupe;
  update wpbl_games set runner_first    = keep where runner_first    = dupe;
  update wpbl_games set runner_second   = keep where runner_second   = dupe;
  update wpbl_games set runner_third    = keep where runner_third    = dupe;

  delete from wpbl_discord_birthday_posts d
   where d.player_id = dupe
     and exists (select 1 from wpbl_discord_birthday_posts k
                  where k.player_id = keep and k.birthday_on = d.birthday_on);
  update wpbl_discord_birthday_posts set player_id = keep where player_id = dupe;

  -- Unique on (player_id, game_id, from_team_id, to_team_id) since the Sep 1 dedupe, so
  -- re-pointing the duplicate's rows can now COLLIDE with the kept player's: both logging the
  -- same move out of the same box score is precisely what a mergeable pair looks like. Same
  -- shape as the birthday block above, and for the same reason: an unmergeable pair is worse
  -- than losing a log line that says what a surviving line already says.
  delete from wpbl_player_team_changes d
   where d.player_id = dupe
     and exists (select 1 from wpbl_player_team_changes k
                  where k.player_id = keep
                    and k.game_id is not distinct from d.game_id
                    and k.from_team_id is not distinct from d.from_team_id
                    and k.to_team_id = d.to_team_id);
  update wpbl_player_team_changes set player_id = keep where player_id = dupe;

  -- Photo tags are unique on (photo_id, player_id): if both rows tag the same photo, drop the
  -- duplicate before repointing, the same shape as the box-score lines above. Miss this block
  -- and a merge orphans every fan photo of the merged player.
  delete from wpbl_photo_subjects d
   where d.player_id = dupe
     and exists (select 1 from wpbl_photo_subjects k where k.player_id = keep and k.photo_id = d.photo_id);
  update wpbl_photo_subjects set player_id = keep where player_id = dupe;

  update wpbl_articles
     set player_ids = (select array_agg(distinct x) from unnest(array_replace(player_ids, dupe, keep)) x)
   where player_ids @> array[dupe];

  update wpbl_players k
     set api_ids = (select coalesce(array_agg(distinct a), '{}'::text[])
                      from unnest(k.api_ids || d.api_ids || array[k.api_id, d.api_id]) a
                     where a is not null and a <> ''),
         position          = coalesce(k.position,          d.position),
         bats              = coalesce(k.bats,              d.bats),
         throws            = coalesce(k.throws,            d.throws),
         jersey_number     = coalesce(k.jersey_number,     d.jersey_number),
         age               = coalesce(k.age,               d.age),
         hometown          = coalesce(k.hometown,          d.hometown),
         bio               = coalesce(k.bio,               d.bio),
         birth_date        = coalesce(k.birth_date,        d.birth_date),
         birth_date_source = coalesce(k.birth_date_source, d.birth_date_source),
         draft_round       = coalesce(k.draft_round,       d.draft_round),
         draft_pick        = coalesce(k.draft_pick,        d.draft_pick)
    from wpbl_players d
   where k.id = keep and d.id = dupe;

  delete from wpbl_players where id = dupe;
end;
$fn$;
