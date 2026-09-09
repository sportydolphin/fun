-- One row per fan-award question posted into Discord as a reaction poll.
--
-- The channel is a second ballot box for the same election: a reader in the Discord votes by
-- reacting, scripts/sync-wpbl-discord-awards.ts reads the reactions every few minutes and casts
-- them into wpbl_award_votes under `discord:<user id>`, and the site's tally counts both. Voting
-- in both places is allowed on purpose, as a bonus for being in the Discord.
--
-- WHY A TABLE AND NOT THE MESSAGE ITSELF. The reader has to turn "1️⃣ on message 123" back into a
-- vote for a specific candidate key, and those keys are player uuids and `mgr:` slugs that no
-- reader should ever see. Storing the mapping when the message is posted also freezes it: the
-- ballot's shortlists are computed from the regular season, which ended Sep 6, so the four names
-- on a message cannot drift out from under the reactions already on it.
--
-- `options` is the emoji-to-choice map, in the order drawn:
--   [{ "emoji": "1️⃣", "key": "<player uuid or mgr:slug>", "name": "Kelsie Whitmore", "team": "SF" }]
--
-- Bookkeeping for a CI job rather than public data, so RLS is on with no policies: the anon key
-- cannot see it and the sync runs with the service role, which bypasses RLS. Same shape and same
-- reasoning as wpbl_discord_recap_posts.
create table if not exists public.wpbl_award_discord_polls (
  category   text primary key,
  channel_id text not null,
  message_id text not null,
  options    jsonb not null,
  posted_at  timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.wpbl_award_discord_polls enable row level security;
