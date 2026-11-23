-- lock down definer views and functions
-- Created 2026-11-07. Applied by scripts/migrate.mjs.
-- Clears the Supabase security advisor's ERROR and the grants it flags as open to `anon`.
-- Every statement is an ALTER, REVOKE or SET, so re-running it is harmless.

-- 1. The two WPBL views ran as their owner (postgres), so they read past RLS on the tables
-- underneath. Today every one of those tables is public to read, which is why nothing leaked,
-- but a table that later goes owner-only would stay readable through the view. As invoker the
-- view obeys the caller's RLS, so it can never show more than the tables do.
alter view public.wpbl_lineup_history set (security_invoker = true);
alter view public.wpbl_pitching_usage set (security_invoker = true);

-- 2. Trigger functions are never RPCs. PostgREST lists them all the same, and as definer
-- functions any grant on them is a door the advisor rightly counts.
revoke all on function public.divert_test_event()  from public, anon, authenticated;
revoke all on function public.email_new_feedback() from public, anon, authenticated;

-- 3. The admin RPCs each open with is_site_owner(), so `anon` already gets nothing back. The
-- revoke is the second lock: a future admin_* function that forgets the check is still closed
-- to signed-out callers. `authenticated` keeps EXECUTE because the owner signs in as one, and the
-- service role (check-admin-health.mjs) is untouched.
revoke execute on function public.admin_analytics_overview(integer, text, text)       from public, anon;
revoke execute on function public.admin_discord_funnel(integer, text)                 from public, anon;
revoke execute on function public.admin_event_counts(integer, text, text)             from public, anon;
revoke execute on function public.admin_growth(integer, text)                         from public, anon;
revoke execute on function public.admin_mlb_usage(integer, text)                      from public, anon;
revoke execute on function public.admin_search_palette(integer, text)                 from public, anon;
revoke execute on function public.admin_set_user_role(uuid, text, boolean, text)      from public, anon;
revoke execute on function public.admin_top_players(integer, integer, text)           from public, anon;
revoke execute on function public.admin_user_detail(uuid, integer, text, integer)     from public, anon;
revoke execute on function public.admin_user_roster(integer, text)                    from public, anon;
revoke execute on function public.admin_web_vitals(integer, text)                     from public, anon;
revoke execute on function public.admin_wpbl_award_votes()                            from public, anon;
revoke execute on function public.admin_wpbl_entry_points(integer, text)              from public, anon;
revoke execute on function public.admin_wpbl_page_usage(integer, text)                from public, anon;
revoke execute on function public.admin_wpbl_search(integer, text, integer)           from public, anon;
revoke execute on function public.admin_wpbl_stats_boards(integer, text)              from public, anon;
revoke execute on function public.admin_wpbl_tab_stats(integer, text)                 from public, anon;

-- 4. A function with no search_path resolves names through the caller's, so a caller who can
-- create objects earlier on the path can swap in their own. The four below already qualify or
-- use only built-ins, so the empty path changes nothing. wpbl_trim_ingest_runs names its table
-- unqualified, so it gets `public` rather than a rewrite of its body.
alter function public.normalize_for_profanity(text) set search_path = '';
alter function public.username_has_profanity(text)  set search_path = '';
alter function public.reject_profane_username()     set search_path = '';
alter function public.wpbl_zodiac(date)             set search_path = '';
alter function public.wpbl_trim_ingest_runs()       set search_path = public;
