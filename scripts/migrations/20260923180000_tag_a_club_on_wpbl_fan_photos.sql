-- tag a club on wpbl fan photos
-- Created 2026-09-23. Applied by scripts/migrate.mjs.
--
-- A team photo (the whole club lined up on the field) has no sensible set of player tags: tagging
-- twenty people by hand is a chore nobody finishes, and a partial list reads as the complete one.
-- So a club becomes a third kind of subject. It still answers "who is in this photograph", which
-- is the one question this table answers; it is not a club column on the photo, which stays out
-- for the reason in the table's own migration (a player's club is a fact about a date).
--
-- The check becomes num_nonnulls = 1 so the three kinds stay mutually exclusive: a row that set
-- two would be counted under both subjects on every surface.

alter table public.wpbl_photo_subjects
  add column if not exists team_id text references public.wpbl_teams (id) on delete cascade;

alter table public.wpbl_photo_subjects drop constraint if exists wpbl_photo_subjects_one_subject;
alter table public.wpbl_photo_subjects add constraint wpbl_photo_subjects_one_subject
  check (num_nonnulls(player_id, figure_key, team_id) = 1);

create unique index if not exists wpbl_photo_subjects_team_uidx
  on public.wpbl_photo_subjects (photo_id, team_id) where team_id is not null;
create index if not exists wpbl_photo_subjects_team_idx
  on public.wpbl_photo_subjects (team_id) where team_id is not null;
