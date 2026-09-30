-- wpbl_videos: which countries YouTube will play each upload in.
--
-- WHY. The league's full-game broadcasts are blocked in the United States, where most readers
-- are, and a blocked video embeds as "Video unavailable". The Watch page and Game Center were
-- offering a Full game button that opened exactly that. Nothing in a title or a thumbnail says a
-- video is geo-blocked; the only source is the Data API's contentDetails.regionRestriction, which
-- scripts/sync-wpbl-youtube.mjs now reads and stores here.
--
-- TWO LISTS, as YouTube sends them, and at most one is set: `region_allowed` means ONLY these
-- countries, `region_blocked` means everywhere EXCEPT these. Both null means playable everywhere,
-- which is also what a row reads before the sync has checked it: an unknown restriction shows the
-- video rather than hiding the league's whole back catalogue on a missing API key.
--
-- `region_checked_at` is when the sync last asked, so a restriction the league lifts is picked
-- up (rights windows end) and a stale answer is visible.

alter table public.wpbl_videos
  add column if not exists region_allowed text[],
  add column if not exists region_blocked text[],
  add column if not exists region_checked_at timestamptz;

comment on column public.wpbl_videos.region_allowed is
  'ISO 3166-1 alpha-2 countries the video plays in, and only those (YouTube regionRestriction.allowed). Null: no allow-list.';
comment on column public.wpbl_videos.region_blocked is
  'ISO 3166-1 alpha-2 countries the video is blocked in (YouTube regionRestriction.blocked). Null: blocked nowhere.';
comment on column public.wpbl_videos.region_checked_at is
  'When sync-wpbl-youtube last read the restriction from the Data API. Null: never checked.';
