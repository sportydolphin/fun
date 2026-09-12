-- wpbl_recaps: an independent outlet's game recaps, as LINKS and nothing else.
--
-- Source: This is Women's Baseball (thisiswomensbaseball.com), an independently run site with
-- no affiliation to the league or to us. They write one recap per WPBL game, and they gave
-- explicit permission for us to link to them (ARCHITECTURE §10).
--
-- WHY THIS IS NOT wpbl_articles. That table has the same shape, and sharing it was the first
-- plan. Two things stopped it. Its primary key is `post_id`, a Substack integer that has no
-- meaning here; and more importantly the two sources are different people under different
-- terms, so "what we are allowed to keep" is a per-source question and a shared table would
-- answer it once for both. A second table costs a join nobody makes and keeps the two answers
-- apart.
--
-- WHAT WE KEEP, AND THE RULE BEHIND IT. A headline, a link, the date, and the URL of their own
-- title image. Nothing else. The same rule docs/READING.md sets for the Substack mirror applies
-- here and is enforced the same way, BY THE SCHEMA: there is no column to put an article in, so
-- nobody can decide one afternoon that a paragraph of somebody else's reporting would look good
-- on a card.
--
-- THE FEED OFFERS MORE THAN THIS AND WE DECLINE IT. Their RSS carries a `description` holding
-- the lede. On recaps this short that lede is roughly 44% of the whole article, which is a
-- different thing from a Substack dek on a 1,200-word essay, so it is not stored and not shown.
-- A headline, their picture and their name is what a link looks like.
--
-- THE IMAGE IS NEVER COPIED, only pointed at. `cover_url` is their own CDN URL, rendered
-- straight into an <img src>, so the bytes are served by them and we are embedding rather than
-- reproducing. See recapThumb() in src/wpbl/derive/recaps.ts for the resize parameters their
-- CDN takes, which turn a 248 KB title card into 18 KB.

create table if not exists public.wpbl_recaps (
  -- ONE RECAP PER GAME, which is the invariant this table exists to hold, so it is the key.
  -- It is also what the sync upserts on and the only way anything reads the table: every
  -- surface arrives holding a game and asks whether there is a recap of it.
  game_id       uuid primary key references public.wpbl_games(id) on delete cascade,

  -- Their own URL for the post. Unique the other way round, so one recap cannot be attached
  -- to two games: the matcher already refuses that, and this is the backstop that turns a
  -- re-match gone wrong into a loud error rather than two cards quoting one article.
  url           text not null unique,

  title         text not null,
  -- Their title image, absolute, on their CDN. Null where a post has none, which has not
  -- happened yet across 33 recaps but costs nothing to allow.
  cover_url     text,
  published_at  timestamptz not null,

  -- How the matcher placed it: 'both clubs', 'club played once', 'one club+score',
  -- 'no club, sole game', 'next night'. Kept because these are judgement calls about someone
  -- else's headline, and the day one is wrong the first question is which rule made it.
  matched_by    text not null,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.wpbl_recaps is
  'Game recaps by This is Women''s Baseball, stored as links: headline, their cover URL, date. '
  'No body text, by permission and by design. See docs/RECAPS.md.';

alter table public.wpbl_recaps enable row level security;

-- Public read, exactly as the plays and the articles are: this is part of what the site shows.
-- Writes stay with the service role, which is the nightly sync and nothing else.
drop policy if exists "wpbl_recaps public read" on public.wpbl_recaps;
create policy "wpbl_recaps public read" on public.wpbl_recaps for select using (true);
