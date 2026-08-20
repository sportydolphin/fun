-- wpbl_photos: a curated mirror of Wikimedia Commons photography of women's baseball, so
-- the section has something worth opening after the league's feed goes quiet on Sep 6.
--
-- Populated by scripts/sync-wpbl-commons.mjs on a weekly GitHub Actions cron, which walks a
-- seed list of Commons categories and keeps only freely licensed photographs.
--
-- WHY THIS IS A HISTORY GALLERY AND NOT A LIVE ONE. Commons has essentially no current WPBL
-- photography: at the time this was written Category:Women's Pro Baseball League held eight
-- files (two of one player, two SVGs, four city shots), and searching all 118 rostered
-- players by name returned no real matches. What Commons does have is the deep record of
-- women's baseball: the AAGPBL, the World Cup, the pioneers, largely public domain. That is
-- the version of this feature the source can actually support, and unlike everything else
-- under /wpbl it does not need a live game to be worth looking at.
--
-- NOTHING RENDERS UNTIL A HUMAN APPROVES IT. `approved` defaults to false and the sync never
-- writes that column, so a re-sync can neither publish a new file nor resurrect a rejected
-- one. Category membership on Commons is crowd-maintained: the query returns whatever
-- somebody filed there, which is not the same thing as what belongs on the site.
--
-- Like the rest of WPBL the client degrades gracefully: until this table exists,
-- fetchWpblPhotos() resolves to an empty list and the rail renders nothing.

create table if not exists public.wpbl_photos (
  page_id         bigint primary key,        -- Commons' stable numeric page id for the file
  title           text not null,             -- "File:…", as Commons names it
  -- Plain text, with the description HTML stripped by the sync. See `artist` for why we
  -- never keep the markup.
  description     text,
  -- A curator's replacement caption, shown instead of `description` when set. Not a nicety:
  -- many Commons descriptions are archive boilerplate ("Title: … Creator: Unknown …
  -- Rights Information: …") that reads as broken next to a photograph. The sync never
  -- writes this column, so an edit here survives every later run.
  caption         text,

  -- Two renders of the file, both from Commons' thumbnailer, never the original: the
  -- originals run to several megabytes and 4000px, which is not what a rail card wants.
  -- Files narrower than the requested width have no thumbnail, so both columns can hold the
  -- original URL for a small image; that is correct rather than a fallback.
  --
  -- The widths are 500 and 1280 and they are not free choices: Commons serves thumbnails only
  -- at a fixed ladder of widths and 400s anything else. Both URLs come from the API rather
  -- than being constructed, for reasons set out in docs/COMMONS_PHOTOS.md.
  file_url        text not null,             -- 1280px render, for the lightbox
  thumb_url       text not null,             -- 500px render, for cards
  width           int,                       -- the ORIGINAL's dimensions, for aspect ratio
  height          int,

  -- The Commons file page. Required, not decorative: every licence in the allow-list below
  -- obliges us to point at the source, and it is also where a viewer goes to find the parts
  -- of the provenance we deliberately do not copy.
  description_url text not null,

  -- Attribution, stored as PLAIN TEXT with the markup stripped. Commons serves Artist and
  -- Credit as HTML containing links, and rendering that would mean injecting third-party
  -- markup edited by anyone into our pages. Name plus a link to description_url satisfies
  -- every licence here, so the markup buys nothing and costs an XSS hole.
  artist          text,
  credit          text,
  license_short   text not null,             -- "Public domain", "CC BY-SA 4.0": what we show
  -- The machine-readable licence slug the sync's allow-list actually tested ("pd",
  -- "cc-by-sa-4.0"). Stored so a later audit can re-check the filter's decisions without
  -- re-reading Commons, and so tightening the allow-list can find what it would now reject.
  license_slug    text not null,
  license_url     text,

  -- Commons' DateTimeOriginal, kept verbatim and deliberately not parsed into a date. The
  -- field is wildly inconsistent (a 1945 photograph carries "2011-03-14 10:41:24", its
  -- Flickr upload time), so a timestamptz column here would look authoritative and be wrong.
  date_original   text,

  categories      text[] not null default '{}',
  source_category text not null,             -- which seed category the walk reached it through
  approved        bool not null default false,
  -- Manual ordering within the gallery, nulls last. A curated set of forty photographs has a
  -- reading order that upload date does not give it.
  sort_order      int,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- The rail and the gallery both read "approved, in order", which is the whole access
-- pattern. The partial index keeps the unreviewed backlog out of it.
create index if not exists wpbl_photos_approved_idx
  on public.wpbl_photos (sort_order nulls last, page_id) where approved;

alter table public.wpbl_photos enable row level security;

-- Public read, owner-only writes, matching wpbl_articles and wpbl_videos. The sync runs on
-- the service-role key (which bypasses RLS), so the owner policy is what makes the approval
-- pass possible from the SQL editor.
--
-- Note the `using (approved)`: unlike the sibling tables, a row here is NOT public simply by
-- existing. The unreviewed backlog is the majority of the table and must not be readable, or
-- the approval gate is a UI convention rather than a rule.
drop policy if exists "WPBL photos are public" on public.wpbl_photos;
create policy "WPBL photos are public" on public.wpbl_photos for select using (approved);

drop policy if exists "Owner writes WPBL photos" on public.wpbl_photos;
create policy "Owner writes WPBL photos" on public.wpbl_photos
  for all using (public.is_site_owner()) with check (public.is_site_owner());
