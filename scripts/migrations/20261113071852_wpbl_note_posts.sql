-- wpbl_note_posts: the live notes (src/league/liveNotes.ts) the owner has posted to Bluesky.
--
-- WHY A TABLE. A note is not stored anywhere: the engine recomputes every note on every poll, so a
-- play correction that removes one simply stops producing it. A post cannot be edited, though, so
-- the console has to remember what went out, by the note's stable key, to flag a post the league's
-- corrections have since made untrue. `text` keeps the words as posted, since the note itself may be
-- gone.
--
-- OWNER ONLY, READ AND WRITE. Which notes were posted is the owner's working state, not something a
-- reader's page uses, so there is no public select policy (and the table stays off the edge cache's
-- list). The console only inserts and deletes, never upserts, so the owner's select policy is all a
-- write needs.

create table if not exists public.wpbl_note_posts (
  note_key   text primary key,
  game_id    uuid not null references public.wpbl_games(id) on delete cascade,
  text       text not null check (length(trim(text)) > 0),
  posted_at  timestamptz not null default now()
);

create index if not exists wpbl_note_posts_game on public.wpbl_note_posts (game_id);

alter table public.wpbl_note_posts enable row level security;

drop policy if exists "Owner reads and writes WPBL note posts" on public.wpbl_note_posts;
create policy "Owner reads and writes WPBL note posts" on public.wpbl_note_posts
  for all using (public.is_site_owner()) with check (public.is_site_owner());
