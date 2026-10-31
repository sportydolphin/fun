-- What the Watch section could not say about a video: how long it runs, how many have seen it,
-- and, for a clip pinned to a play, what the play was.
--
-- duration_seconds and view_count come from the same Data API read as the region restrictions
-- (refreshVideoDetails in scripts/sync-wpbl-youtube.mjs). Null means not read yet, and every surface
-- draws nothing for it rather than a zero.
--
-- event_type is copied onto the tag so the page does not have to load the season's play log (3,700
-- rows) to label a clip or file the home runs together. The sync writes it with the tag from here
-- on, and the update below covers the 61 tags that already name a play, hand-set ones included: a
-- --relink never touches those.

alter table public.wpbl_videos add column if not exists duration_seconds integer;
alter table public.wpbl_videos add column if not exists view_count bigint;

comment on column public.wpbl_videos.duration_seconds is
  'Length from the Data API contentDetails.duration. Null until the sync has read it.';
comment on column public.wpbl_videos.view_count is
  'YouTube''s view count, refreshed about once a day. Null until the sync has read it.';

alter table public.wpbl_video_tags add column if not exists event_type text;

comment on column public.wpbl_video_tags.event_type is
  'The pinned play''s wpbl_game_plays.event_type, copied at tagging time. Null without a pinned play.';

update public.wpbl_video_tags t
   set event_type = p.event_type
  from public.wpbl_game_plays p
 where t.play_sequence is not null
   and p.game_id = t.game_id
   and p.sequence = t.play_sequence;
