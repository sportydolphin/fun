-- add wpbl award vote clear
-- Created 2026-09-07. Applied by scripts/migrate.mjs.

-- wpbl_clear_award_vote: take an answer back.
--
-- WHY A FUNCTION AND NOT A DELETE POLICY. `wpbl_award_votes` has insert and update policies and
-- deliberately no delete policy, on the reasoning that a cast vote should only ever be
-- overwritten. Withdrawing one is a different act from changing it, and the pick'em is what
-- makes it worth having: a reader who called all three series and wants out should not have to
-- leave a wrong prediction standing because the only way to change an answer is to give another
-- one. Adding a client-facing delete policy would have been the smaller diff and the worse one,
-- because it opens deletes on the whole table to anybody holding any key, forever, for the sake
-- of one screen.
--
-- IT GRANTS EXACTLY WHAT THE UPDATE POLICY ALREADY DOES. Both are gated on knowing the
-- voter_key, which is an unguessable uuid that is never readable through this API (there is no
-- select policy; see the ballot's own migration). Somebody who can guess a key can already
-- overwrite that person's answers, which is the same harm arrived at one step later.
--
-- Security definer, like the three functions beside it, for the reason that migration gives:
-- this table cannot be reachable directly by a client and still keep its keys private.
create or replace function public.wpbl_clear_award_vote(
  p_category  text,
  p_voter_key text
) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
begin
  if p_category is null or p_voter_key is null then return false; end if;
  -- Length-checked for the same reason the writer is: a caller that hands over an empty or
  -- absurd key gets false rather than a scan.
  if char_length(p_category)  not between 1 and 64 then return false; end if;
  if char_length(p_voter_key) not between 8 and 64 then return false; end if;

  delete from public.wpbl_award_votes
  where category = p_category and voter_key = p_voter_key;

  -- True whether or not a row was there. The caller is asking for the answer to be gone, and it
  -- is; reporting "nothing to delete" as a failure would make a double tap look like an error.
  return true;
end;
$$;

revoke all on function public.wpbl_clear_award_vote(text, text) from public;
grant execute on function public.wpbl_clear_award_vote(text, text) to anon, authenticated;
