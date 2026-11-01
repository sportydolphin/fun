-- lock down player merge and award vote updates
-- Created 2026-11-01. Applied by scripts/migrate.mjs.

-- wpbl_merge_players: security definer with no check on the caller, and executable by anon because
-- Supabase's default privileges grant EXECUTE on every new function in public. Player ids are public
-- too, so any visitor could fold any player into any other and delete box score lines, and only a
-- backup undoes that. It is a repair run by hand from a database connection
-- (check-wpbl-roster-forks.mjs prints the statement), which is the postgres role and needs no grant.
revoke all on function public.wpbl_merge_players(uuid, uuid) from public, anon, authenticated;

-- wpbl_award_votes: the policy's own comment said knowing the voter_key was the gate, but the policy
-- is `using (true)`. A PATCH with no filter reads no column, so Postgres does not ask for a SELECT
-- policy, and one request could plausibly overwrite every vote without knowing a single key. Nobody
-- needs it: the ballot writes through wpbl_cast_award_vote (security definer), which is unaffected and
-- is where changing your own answer now happens.
drop policy if exists "A voter can change their own vote" on public.wpbl_award_votes;
revoke update on public.wpbl_award_votes from anon, authenticated;
