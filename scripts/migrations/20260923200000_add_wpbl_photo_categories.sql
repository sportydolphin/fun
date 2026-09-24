-- add wpbl photo categories
-- Created 2026-09-23. Applied by scripts/migrate.mjs.
--
-- Photos that are not OF someone: a fan's sign, the ballpark. docs/FAN_PHOTOS.md reserved exactly
-- this ("a future 'photos of the ballpark' wants its own column, not a second meaning for this
-- one"): wpbl_photo_subjects answers only who is in a photograph, and a sign has nobody in it.
--
-- One category per photo, nullable. NULL is the ordinary fan photograph, which is every row that
-- existed before this table, so nothing has to be backfilled and the CLI ingest (which knows
-- nothing about categories) keeps producing valid rows. Owner-curated, like the figures: the
-- owner makes a category from the admin page and files photos into it.

create table if not exists public.wpbl_photo_categories (
  key        text primary key,                  -- slug, 'fan-signs'
  name       text not null,                     -- 'Fan signs'
  blurb      text,
  sort_order int,
  created_at timestamptz not null default now()
);

alter table public.wpbl_photo_categories enable row level security;
-- Public read: categories are the gallery's filter chips. Owner writes.
drop policy if exists "Fan photo categories are public" on public.wpbl_photo_categories;
create policy "Fan photo categories are public" on public.wpbl_photo_categories for select using (true);
drop policy if exists "Owner writes fan photo categories" on public.wpbl_photo_categories;
create policy "Owner writes fan photo categories" on public.wpbl_photo_categories
  for all using (public.is_site_owner()) with check (public.is_site_owner());

-- `on delete set null`, not cascade: deleting a category must return its photos to the general
-- pool, never delete photographs somebody gave permission for.
alter table public.wpbl_fan_photos
  add column if not exists category_key text
    references public.wpbl_photo_categories (key) on update cascade on delete set null;
create index if not exists wpbl_fan_photos_category_idx
  on public.wpbl_fan_photos (category_key) where category_key is not null;
