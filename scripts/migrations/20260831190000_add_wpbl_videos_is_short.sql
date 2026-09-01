-- wpbl_videos.is_short: is this upload a YouTube Short?
--
-- WHY NOT A NEW `kind` VALUE. `kind` says what an upload is ABOUT (a game recap, a podcast,
-- everything else) and the browser reads it to rank the media shelf. Whether a video is a Short
-- is a different axis entirely: the league's Shorts are single-play clips, walk-off calls, and
-- short interview snippets, so folding them into `kind` would either lose the recap/podcast
-- distinction for every Short or add a fourth value that means "vertical" while the other three
-- mean "topic". Two questions, two columns.
--
-- NULL IS A REAL STATE, AND IT IS THE SAFE ONE. It means "we have not determined this yet". The
-- classifier is an HTTP probe of youtube.com/shorts/<id>, which answers 200 for a Short and
-- redirects to /watch for anything else, and YouTube is known to bot-gate this repo's requests
-- from GitHub's datacenter IPs (see the RSS fallback in sync-wpbl-youtube.mjs). So only an
-- unambiguous answer is recorded; anything else leaves the column null and is retried on the
-- next sync. A video stuck at null simply never posts to the Discord highlights channel, which
-- is a miss rather than a flood, and a miss is the failure worth choosing here.

alter table public.wpbl_videos add column if not exists is_short boolean;

comment on column public.wpbl_videos.is_short is
  'True when the upload is a YouTube Short, determined by probing youtube.com/shorts/<id>. '
  'NULL means undetermined (the probe was blocked or ambiguous), never "no": the sync retries '
  'nulls and the Discord poster ignores them.';

-- The Discord poster asks for "highlight reels OR Shorts" on every run, filtered to a few days.
create index if not exists wpbl_videos_is_short_published_idx
  on public.wpbl_videos (is_short, published_at desc);

-- ─── The poster learns to count two streams ─────────────────────────────────
--
-- The Discord highlights job now posts two kinds of thing into one channel: the league's game
-- highlight reels, which it has posted since Aug 14, and their Shorts, which are new here.
--
-- WHY THE COLUMN EXISTS AT ALL. The job's one safety rule is that a stream it has never posted
-- before is SEEDED rather than flooded: it sends the newest item and records the rest as
-- handled, so switching something on puts one video in the channel instead of a fortnight of
-- them. Answering "have we ever posted a Short?" needs to look past the job's few-day window,
-- and without this column that means fetching every Short id from wpbl_videos and asking about
-- the lot. Worse, inferring it from the window alone is quietly wrong: after a week with no
-- Shorts the window empties, the stream reads as new again, and the next batch is seeded down
-- to one and the others dropped without ever being posted.
--
-- Existing rows are all highlight reels, which is what the default backfills them as.
alter table public.wpbl_discord_highlight_posts
  add column if not exists stream text not null default 'reel';

comment on column public.wpbl_discord_highlight_posts.stream is
  '''reel'' for a league game-highlight reel, ''short'' for a YouTube Short. Each stream is '
  'seeded independently the first time the job sees it, so adding a third will not flood the '
  'channel with its back catalogue.';

create index if not exists wpbl_discord_highlight_posts_stream_idx
  on public.wpbl_discord_highlight_posts (stream);
