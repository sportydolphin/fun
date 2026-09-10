-- add admin award votes rpc
-- Created 2026-09-10. Applied by scripts/migrate.mjs.

-- admin_wpbl_award_votes: every ballot line, for the one account allowed to see them.
--
-- WHY THIS CANNOT BE READ FROM THE BROWSER. `wpbl_award_votes` has no select policy on purpose:
-- raw rows would hand out every voter_key, and the update policy is guarded by nothing except
-- those keys being unguessable. That stays true. So the owner's view of the ballot needs the
-- same shape as the analytics RPCs beside it: security definer to out-rank the absence of a
-- read policy, an EXPLICIT is_site_owner() guard because definer alone would publish every
-- vote to anybody with an account, `set search_path = ''` against definer-path hijacking, and
-- execute granted to authenticated only. See docs/ADMIN_ANALYTICS.md §2, which is the same
-- model and the same three failure modes.
--
-- IT DOES NOT RETURN THE VOTER KEY, and that is deliberate rather than shy. Since Sep 10, 2026
-- a key IS a user id (votes need an account), and knowing one is the whole of what lets a
-- caller rewrite that person's ballot through wpbl_cast_award_vote. A panel exists to be read,
-- and screenshots of it travel; handing it the keys would make every screenshot a set of
-- credentials for changing other people's votes. The md5 is stable, so the panel can still
-- count distinct voters, see who answered everything, and follow one ballot across categories,
-- which is every question the surface actually asks. `admin_user_roster` is where a name goes
-- with an account, and that join is deliberately not made here: this is a poll.
--
-- ONE ROW PER VOTE rather than a tally. The public wpbl_award_results already aggregates, and
-- the panel wants what it cannot: distinct voters, completion, and when the answers arrived.
-- The table is small by construction (one row per person per category) and there is no version
-- of this poll where paging is the constraint.
create or replace function public.admin_wpbl_award_votes()
returns table (
  category   text,
  choice     text,
  voter      text,
  voted_at   timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_site_owner() then
    raise exception 'not authorized';
  end if;

  return query
    select v.category,
           v.choice,
           -- Truncated because the panel only ever compares it to itself. A full md5 is not a
           -- secret either, but a shorter one is plainly not a key, which is the point.
           substr(md5(v.voter_key), 1, 12) as voter,
           v.created_at
    from public.wpbl_award_votes v
    order by v.created_at desc;
end;
$$;

revoke all on function public.admin_wpbl_award_votes() from public;
grant execute on function public.admin_wpbl_award_votes() to authenticated;
