-- wpbl_videos.channel_id: which YouTube channel an upload came from.
--
-- WHY. Until now the table mirrored one channel, the league's own (@wpbl_official), and every
-- reader assumed so. A second channel joins it: "WPBL from Day 1" (@wpblfanrecaps), a fan who
-- cuts condensed games and season compilations and gave the owner explicit permission to embed
-- them on the site (Sep 28, 2026). Their uploads need their own credit on every card, and two
-- readers must be able to tell them apart:
--
--   * The Discord highlights poster posts only the LEAGUE's uploads. The permission we hold is
--     for the site, and that job posts anything it can see, so without this column the first
--     fan upload with `is_short = true` would reach the fan server.
--   * Game Center now shows more than one video per game (the league's reel and a condensed
--     game), and orders them by channel.
--
-- THE DEFAULT IS THE LEAGUE'S CHANNEL, and that is a statement of fact rather than a
-- convenience: every row that exists today came from it. It also keeps an older copy of the
-- sync (still on `main` until this ships) inserting correctly, since it does not name the column.
--
-- `kind` gains two values, 'condensed' and 'compilation', set only by the fan channel's
-- classifier in scripts/sync-wpbl-youtube.mjs. The column has no check constraint, so they need
-- nothing here. They are deliberately NOT 'highlight': that value is what the Discord poster's
-- reel stream keys on.

alter table public.wpbl_videos
  add column if not exists channel_id text not null default 'UCtd3k09dk2H6UjU7skfmemQ';

comment on column public.wpbl_videos.channel_id is
  'YouTube channel id the upload came from. UCtd3k09dk2H6UjU7skfmemQ is the league (@wpbl_official); '
  'UC9oWksw_L8tfpxdF6uUiTXw is WPBL from Day 1 (@wpblfanrecaps), embedded with permission and '
  'credited on every card. Only league rows are posted to Discord.';

comment on column public.wpbl_videos.kind is
  '''highlight'' | ''podcast'' | ''other'' for the league channel; ''condensed'' | ''compilation'' | '
  '''other'' for WPBL from Day 1. The Discord reel stream keys on ''highlight''.';
