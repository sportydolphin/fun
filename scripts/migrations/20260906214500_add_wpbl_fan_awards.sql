-- wpbl_award_votes: the fan awards ballot for the inaugural season.
--
-- WHY A BALLOT AT ALL. The section can compute who was best; it has never once asked anyone.
-- The league's first season ends Sep 6, 2026 and the feed goes quiet on Sep 22, after which
-- every live surface here has nothing to say until spring 2027. A vote is the one feature
-- whose best day is AFTER the last pitch, so it is the section's only durable moment.
--
-- THE CATEGORIES ARE NOT IN THIS TABLE, on purpose. They live in src/wpbl/awards.ts, where
-- they are versioned with the code that renders them, testable, and free to gain a shortlist
-- rule without a migration. `category` here is that catalog's id and is therefore PERMANENT:
-- renaming an id in the catalog orphans every vote already cast under the old one. Add a new
-- id instead and leave the old rows where they are.
--
-- WHAT A `choice` HOLDS depends on the category's `pick`:
--   player  our own wpbl_players.id, never a feed player_id. The league mints a new feed id
--           per club, so a traded player would split into two candidates (see CLAUDE.md).
--   game    wpbl_games.id.
--   play    "<game_id>:<sequence>", never the play's uuid. wpbl_game_plays is a mirror that
--           is deleted and reinserted on every ingest pass, so the uuid is regenerated and a
--           vote keyed on it would point at nothing within two minutes.
-- Nothing in the database validates a choice against a candidate list, which would mean
-- teaching Postgres a shortlist that changes with every game. The reader maps keys back to
-- candidates and ignores what it cannot name, so a stale key is a dropped vote rather than a
-- broken page.

create table if not exists public.wpbl_award_votes (
  category   text not null,
  -- The per-browser id from src/lib/analytics.ts (localStorage), NOT a user id. One browser
  -- is one ballot whether the voter signs in or not, so signing in mid-ballot cannot double
  -- anyone's vote. It doubles as this row's own capability: it is a random uuid, it is never
  -- readable through this API (there is no select policy), and the update policy below leans
  -- on that.
  voter_key  text not null,
  choice     text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (category, voter_key),
  constraint wpbl_award_votes_category_len check (char_length(category) between 1 and 64),
  constraint wpbl_award_votes_choice_len   check (char_length(choice)   between 1 and 128),
  constraint wpbl_award_votes_voter_len    check (char_length(voter_key) between 8 and 64)
);

-- ─── RLS: write open, read closed ─────────────────────────────────────────────
-- Anyone may vote and change their vote, nobody may read a row. This is the shape the
-- feedback and events tables already use (scripts/create_feedback.sql), for the same reason:
-- a visitor should not need an account to take part, and the anon key ships in the client
-- bundle so nothing the browser claims about identity can be trusted.
--
-- NO SELECT POLICY, DELIBERATELY. Raw rows would let anyone pull the voter_key of every
-- ballot cast and then overwrite them through the update policy. Counts come from
-- wpbl_award_results() below, which is security definer and returns aggregates only. Do not
-- "fix" this by adding a public-read policy.
alter table public.wpbl_award_votes enable row level security;

drop policy if exists "Anyone can cast a fan award vote" on public.wpbl_award_votes;
create policy "Anyone can cast a fan award vote"
  on public.wpbl_award_votes for insert
  with check (true);

-- Changing your mind is the same row, rewritten. The gate is knowledge of the voter_key,
-- which is unguessable and unreadable; that is the whole of the protection, and it is
-- proportionate to a fan vote where the worst outcome is a stranger's award pick moving.
drop policy if exists "A voter can change their own vote" on public.wpbl_award_votes;
create policy "A voter can change their own vote"
  on public.wpbl_award_votes for update
  using (true) with check (true);

-- No delete policy: a cast vote cannot be removed by a client, only overwritten.

-- ─── Reading ──────────────────────────────────────────────────────────────────
-- The tally, for everyone. Running totals are shown as soon as a voter has voted, which is
-- the half of this that brings anybody back before the results are announced.
create or replace function public.wpbl_award_results()
returns table (category text, choice text, votes bigint)
language sql stable security definer set search_path = '' as $$
  select v.category, v.choice, count(*)::bigint as votes
  from public.wpbl_award_votes v
  group by v.category, v.choice
  order by v.category, votes desc;
$$;
revoke all on function public.wpbl_award_results() from public;
grant execute on function public.wpbl_award_results() to anon, authenticated;

-- One browser's own ballot, so a returning voter sees what they picked instead of an empty
-- form. Takes the key rather than reading a session, because the voter may never sign in.
-- Safe to expose: the caller has to already hold the key, and it returns nothing else.
create or replace function public.wpbl_award_ballot(p_voter_key text)
returns table (category text, choice text)
language sql stable security definer set search_path = '' as $$
  select v.category, v.choice
  from public.wpbl_award_votes v
  where v.voter_key = p_voter_key;
$$;
revoke all on function public.wpbl_award_ballot(text) from public;
grant execute on function public.wpbl_award_ballot(text) to anon, authenticated;
