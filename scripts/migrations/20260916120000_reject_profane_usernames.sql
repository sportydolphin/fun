-- Reject profane usernames at the database, not just in the app.
--
-- A username is a public display name (leaderboards, predictions), and it is written straight from
-- the browser: src/App.tsx upserts into public.usernames under RLS. The client already blocks the
-- obvious offensive ones (src/lib/profanity.ts via usernameValidationMsg), but that is a courtesy a
-- determined user bypasses by hitting PostgREST directly with the anon key. This trigger is the
-- backstop that the RLS insert/update path cannot get around: it runs inside the same statement,
-- so there is no write that skips it.
--
-- IT MIRRORS src/lib/profanity.ts, and the two must stay in step. The normalization is the same:
-- lowercase, fold common leet characters back to letters, drop every non-letter. The match is the
-- same too: each banned term as a pattern with every letter allowed to repeat (so "fuuuck" is
-- caught) while a doubled letter still has to be present (so "Nigeria" is NOT caught by the
-- double-g slur). Only full offensive terms are listed, never short fragments, to avoid rejecting
-- "class", "raccoon", "Peacock" and the like. If you change the list or the leet map in the TS,
-- change it here as well; nothing enforces that they agree except review.
--
-- ON EXISTING ROWS: none. A trigger fires on writes, so usernames already stored are left as they
-- are; this only governs new names and renames from here on.

-- The normalized form of a candidate username: lower, leet folded, letters only.
create or replace function public.normalize_for_profanity(u text)
returns text
language sql
immutable
as $$
  select regexp_replace(
    -- translate() maps each leet character to the letter it stands in for; the two strings are
    -- index-aligned and the same length. Mirrors LEET in src/lib/profanity.ts.
    translate(lower(coalesce(u, '')), '01345789@$!+(<|', 'oieastbgasitcci'),
    '[^a-z]', '', 'g')
$$;

-- Whether a candidate contains a banned term once normalized. The pattern is one alternation of
-- the banned words, each letter suffixed with '+' so stretched spellings match; mirrors
-- BANNED_PATTERNS in src/lib/profanity.ts.
create or replace function public.username_has_profanity(u text)
returns boolean
language sql
immutable
as $$
  select public.normalize_for_profanity(u) ~
    ('f+u+c+k+|s+h+i+t+|b+i+t+c+h+|b+a+s+t+a+r+d+|c+u+n+t+|a+s+s+h+o+l+e+'
     || '|d+u+m+b+a+s+s+|j+a+c+k+a+s+s+|d+i+c+k+h+e+a+d+|w+a+n+k+e+r+|b+o+l+l+o+c+k+'
     || '|t+w+a+t+|p+r+i+c+k+|p+u+s+s+y+|w+h+o+r+e+|s+l+u+t+|n+i+g+g+e+r+|n+i+g+g+a+'
     || '|f+a+g+g+o+t+|r+e+t+a+r+d+|k+i+k+e+|c+h+i+n+k+|w+e+t+b+a+c+k+|t+r+a+n+n+y+')
$$;

create or replace function public.reject_profane_username()
returns trigger
language plpgsql
as $$
begin
  if public.username_has_profanity(new.username) then
    -- check_violation, so it reads as a constraint failure rather than an internal error; the
    -- browser never reaches this because the client validates first, so the message is for the
    -- API-direct path.
    raise exception 'That username is not allowed.' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- Fire only when a username is actually being set: every insert, and an update that touches the
-- username column. An update that only flips is_deleted (the admin deactivate path) does not
-- re-validate a name that is not changing.
drop trigger if exists reject_profane_username on public.usernames;
create trigger reject_profane_username
  before insert or update of username on public.usernames
  for each row execute function public.reject_profane_username();
