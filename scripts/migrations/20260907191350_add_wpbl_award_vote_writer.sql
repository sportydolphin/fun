-- add wpbl award vote writer
-- Created 2026-09-07. Applied by scripts/migrate.mjs.

-- wpbl_cast_award_vote: the write half of the ballot, which until now did not work.
--
-- THE BUG, because it is worth writing down. `wpbl_award_votes` has an INSERT policy and an
-- UPDATE policy, both `with check (true)`, and deliberately NO SELECT POLICY: raw rows would
-- hand out every voter_key, and the update policy is guarded by nothing except those keys being
-- unguessable. That is right and stays.
--
-- But the client upserts, and PostgREST turns an upsert into `insert ... on conflict do update`.
-- Postgres applies the SELECT policies to the conflicting row on that path, so with no select
-- policy the statement is refused even when there is no conflicting row to read. It fails as
-- "new row violates row-level security policy", which points at the WITH CHECK expressions,
-- which are `true`. A plain insert of the same values succeeds. Measured, both ways, as `anon`:
--
--   set local role anon;
--   insert into wpbl_award_votes (category, choice, voter_key) values (...);                  -- OK
--   insert into wpbl_award_votes (...) values (...) on conflict (category, voter_key)
--     do update set choice = excluded.choice;                                                 -- FAILS
--
-- The ballot shipped on Sep 6 with no surface on it, so nothing had ever tried to write: the
-- table stood at zero rows, which is exactly what a ballot nobody has voted in looks like.
--
-- THE FIX IS THE SHAPE THE READ SIDE ALREADY USES. `wpbl_award_results` and `wpbl_award_ballot`
-- are security definer for the same reason this is: the table cannot be reachable directly by a
-- client and still keep its keys private. The write belongs on the same footing. It grants
-- nothing the policies did not already allow, which is the test to apply to any change here:
-- anyone may answer any question, and changing somebody else's answer still means guessing a
-- random uuid.
--
-- The length rules are repeated from the table's own constraints on purpose. A constraint
-- violation reaches a client as an exception it has to parse; this returns false, and the
-- caller leaves the previous selection showing rather than claiming a vote it did not record.
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

  insert into public.wpbl_award_votes (category, voter_key, choice)
  values (p_category, p_voter_key, p_choice)
  on conflict (category, voter_key)
  do update set choice = excluded.choice, updated_at = now();

  return true;
end;
$$;

revoke all on function public.wpbl_cast_award_vote(text, text, text) from public;
grant execute on function public.wpbl_cast_award_vote(text, text, text) to anon, authenticated;
