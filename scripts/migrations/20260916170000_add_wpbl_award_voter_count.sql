-- add wpbl award voter count
-- Created 2026-09-16. Applied by scripts/migrate.mjs.

-- HOW MANY PEOPLE VOTED, THE SAME NUMBER THE ADMIN PANEL REPORTS. The public results view could
-- only ever sum a category's votes (wpbl_award_results is per choice), and one person answering
-- five categories is five of those. So the site had no honest "N fans voted" and the admin panel
-- did (admin_wpbl_award_votes, counted distinct in buildAdminAwardReport), and the two disagreed.
--
-- This returns the DISTINCT voter count over a caller-supplied category list, which the client
-- passes as FAN_VOTE_IDS (the five the ballot asks). Counting distinct voter_key over exactly
-- those categories is the same cardinality as the admin's `voters` headline (distinct voters who
-- answered at least one ballot category), so the two surfaces now match by construction.
--
-- SECURITY DEFINER AND AGGREGATE-ONLY, like wpbl_award_results beside it: wpbl_award_votes has no
-- select policy on purpose (a raw row leaks a voter_key that the update policy leans on being
-- unreadable). A count leaks nothing, so it is safe for anon; the keys never leave the function.
create or replace function public.wpbl_award_voter_count(p_categories text[])
returns bigint
language sql stable security definer set search_path = '' as $$
  select count(distinct v.voter_key)::bigint
  from public.wpbl_award_votes v
  where v.category = any(p_categories);
$$;
revoke all on function public.wpbl_award_voter_count(text[]) from public;
grant execute on function public.wpbl_award_voter_count(text[]) to anon, authenticated;
