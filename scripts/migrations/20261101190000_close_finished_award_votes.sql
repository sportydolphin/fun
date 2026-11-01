-- close finished award votes
-- Created 2026-11-01. Applied by scripts/migrate.mjs.

-- A closed vote was only closed in the UI. Home names the winners off the live tally, Most Valuable
-- Player was 141 to 130 when this was written, and a dozen calls with made-up voter keys would have
-- changed the name on the front page. So the two functions that write refuse a finished category.
--
-- CLOSED BY NAME, NOT "EVERYTHING BUT THE OPEN ONES". An id that has taken a vote is never reused
-- (src/wpbl/awards.ts), so this list only ever grows, and a new season's new ids stay open without
-- anyone remembering this function. The other way round, a forgotten line would refuse every vote on
-- next year's ballot while the UI still looked like it worked. awards.test.ts pins this list and the
-- moment to WPBL_AWARDS and AWARDS_CLOSE_AT. `franchise-2027` closes with NEXT_SEASON_CLOSE_AT.
create or replace function public.wpbl_award_vote_closed(p_category text)
returns boolean
language sql stable set search_path = '' as $$
  select case
    when p_category = 'franchise-2027' then now() >= timestamptz '2027-03-01 05:00:00+00'
    when p_category like 'pickem:2026:%'
      or p_category in ('mvp', 'pitcher', 'glove', 'play', 'game', 'manager', 'aura', 'rookie',
                        'wheels', 'toughest-out', 'workhorse', 'utility', 'cannon', 'contact')
      then now() >= timestamptz '2026-09-16 18:00:00-05'
    else false
  end;
$$;

-- Only the two definer functions below need it, and they run as its owner.
revoke all on function public.wpbl_award_vote_closed(text) from public, anon, authenticated;

create or replace function public.wpbl_cast_award_vote(
  p_category  text,
  p_voter_key text,
  p_choice    text
) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
begin
  if p_category is null or p_voter_key is null or p_choice is null then return false; end if;
  if char_length(p_category)  not between 1 and 64  then return false; end if;
  if char_length(p_voter_key) not between 8 and 64  then return false; end if;
  if char_length(p_choice)    not between 1 and 128 then return false; end if;
  if public.wpbl_award_vote_closed(p_category) then return false; end if;

  insert into public.wpbl_award_votes (category, voter_key, choice)
  values (p_category, p_voter_key, p_choice)
  on conflict (category, voter_key)
  do update set choice = excluded.choice, updated_at = now();

  return true;
end;
$$;

-- Taking a vote back moves a closed tally exactly as casting one does.
create or replace function public.wpbl_clear_award_vote(
  p_category  text,
  p_voter_key text
) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
begin
  if p_category is null or p_voter_key is null then return false; end if;
  if char_length(p_category)  not between 1 and 64 then return false; end if;
  if char_length(p_voter_key) not between 8 and 64 then return false; end if;
  if public.wpbl_award_vote_closed(p_category) then return false; end if;

  delete from public.wpbl_award_votes
  where category = p_category and voter_key = p_voter_key;

  return true;
end;
$$;

-- The side door. The table's insert policy is still `with check (true)`, so a direct POST with the
-- public key would walk past both functions above. Nothing uses it: every write has gone through
-- these functions since Sep 7, 2026, and as definers they do not need the grant.
drop policy if exists "Anyone can cast a fan award vote" on public.wpbl_award_votes;
revoke insert, update, delete on public.wpbl_award_votes from anon, authenticated;
