-- Post a WPBL final to Bluesky when the game is ready, not when GitHub gets round to it.
--
-- THE PROBLEM THIS SOLVES IS NOT IN OUR CODE. `wpbl-bluesky-recaps` asks for `*/15 * * * *`.
-- Measured over the thirty scheduled runs before Sep 3, 2026, the gaps between actual runs were
-- 130 to 452 minutes, and the repo's DAILY workflows (`wpbl-pbp-validation` at 08:00,
-- `build-sitemap` at 06:40) landed four to eleven hours late over the same week. Every run
-- succeeds; GitHub is simply deprioritising this repository's `schedule` events, and no cron
-- expression fixes that. Recaps were reaching the timeline 5 to 12 hours after the game.
--
-- pg_cron, on the other hand, is ours and is punctual: it already drives `wpbl-ingest` every
-- two minutes, which is how a game becomes final in the mirror in the first place. So the
-- database watches for a settled final and pokes GitHub through `repository_dispatch`, which
-- is an on-demand event and is not subject to the schedule delay. The `schedule:` line stays
-- as the backstop for the day this token expires.
--
-- WHY A COLUMN AND NOT JUST A QUERY. Firing is not the same as posting: the workflow takes a
-- couple of minutes to install and render, during which the game still looks unposted, so a
-- five-minute nudge would dispatch it again and again. `dispatched_at` is the record of having
-- asked, and the 20-minute gate below is also the retry: a run that fails leaves posted_at
-- null and gets another dispatch, rather than needing a person.
alter table public.wpbl_bluesky_recap_posts
  add column if not exists dispatched_at timestamptz;

comment on column public.wpbl_bluesky_recap_posts.dispatched_at is
  'When wpbl_bluesky_nudge() last asked GitHub to run the poster for this game. Not proof it '
  'was posted (posted_at is); it exists so a five-minute nudge does not re-dispatch a game the '
  'workflow is already rendering, and so a failed run retries on its own 20 minutes later.';

-- first_final_at is no longer what the settle window is measured against; see `isSettled` in
-- src/wpbl/derive/blueskyRecap.ts. Its comment claimed the opposite, which is now the trap.
comment on column public.wpbl_bluesky_recap_posts.first_final_at is
  'When this job first observed the game final. NO LONGER the settle basis: the window runs '
  'from the league''s own wpbl_games.source_updated_at, because "when we noticed" is really '
  '"whenever GitHub woke a runner", which was hours. Still the fallback for a game the feed '
  'never stamped, and still the honest record of when we first held it.';

-- Ask GitHub to run the Bluesky poster, if there is a settled final waiting for it.
--
-- Returns how many games it dispatched for; 0 on the overwhelming majority of runs, which cost
-- one indexed query and no HTTP at all. The 45 minutes here MUST match SETTLE_MINUTES in
-- scripts/post-wpbl-bluesky-recaps.ts: too short and the job wakes to find nothing settled and
-- burns a run, too long and the post waits on the GitHub schedule after all. It is deliberately
-- a copy rather than a shared constant, because nothing can be shared between a Postgres
-- function and a Node script, and a nudge that fires early is a wasted run rather than a wrong
-- post: the poster re-checks the window itself and is the only thing that decides.
--
-- Not SECURITY DEFINER, and execute is revoked below: it reads a GitHub token out of Vault and
-- can make GitHub run a workflow, so it must not be reachable through PostgREST by anon or by
-- any signed-in user. pg_cron runs it as the postgres role, which is the only caller it needs.
create or replace function public.wpbl_bluesky_nudge()
returns integer
language plpgsql
set search_path = public, net, vault, extensions
as $$
declare
  due   uuid[];
  token text;
begin
  select array_agg(g.id) into due
  from public.wpbl_games g
  left join public.wpbl_bluesky_recap_posts p on p.game_id = g.id
  where g.status = 'final'
    -- The poster skips ties and scoreless rows too. Dispatching for one would wake a runner to
    -- do nothing, every twenty minutes, until the game fell out of the window.
    and g.home_score is not null
    and g.away_score is not null
    and g.home_score <> g.away_score
    -- The league's stamp, the same basis the poster settles on.
    and g.source_updated_at is not null
    and g.source_updated_at < now() - interval '45 minutes'
    -- Past the poster's own 36-hour window there is nothing it would publish.
    and g.game_date >= (now() - interval '36 hours')::date
    -- Unresolved: never posted, never deliberately skipped.
    and p.posted_at is null
    and p.skipped_reason is null
    and (p.dispatched_at is null or p.dispatched_at < now() - interval '20 minutes');

  if due is null then
    return 0;
  end if;

  select decrypted_secret into token
  from vault.decrypted_secrets where name = 'github_dispatch_token';

  -- Not an error. The migration lands before anybody pastes a token, and the schedule backstop
  -- still posts these games; a function that raised here would fill the log every five minutes
  -- with something nobody can act on from inside the database.
  if token is null then
    raise warning 'wpbl_bluesky_nudge: no github_dispatch_token in Vault, so % settled final(s) wait for the GitHub schedule. See scripts/wpbl_cron.sql.', array_length(due, 1);
    return 0;
  end if;

  perform net.http_post(
    url     := 'https://api.github.com/repos/sportydolphin/fun/dispatches',
    headers := jsonb_build_object(
      'Content-Type',        'application/json',
      'Accept',              'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28',
      -- GitHub rejects an API request with no user agent outright, with a 403 that says
      -- nothing about the cause. pg_net does not send one.
      'User-Agent',          'sportydolphin-wpbl-bluesky-nudge',
      'Authorization',       'Bearer ' || token
    ),
    body    := jsonb_build_object('event_type', 'wpbl-final')
  );

  -- Mark every game this dispatch covers, not just one: the run it triggers posts all of them.
  insert into public.wpbl_bluesky_recap_posts (game_id, dispatched_at)
  select unnest(due), now()
  on conflict (game_id) do update set dispatched_at = excluded.dispatched_at;

  return array_length(due, 1);
end;
$$;

comment on function public.wpbl_bluesky_nudge() is
  'Fires a GitHub repository_dispatch when a WPBL final has settled, so the Bluesky recap does '
  'not wait on GitHub''s schedule event (which runs this repo hours late). Scheduled by '
  'pg_cron every 5 minutes; see scripts/wpbl_cron.sql.';

-- It reads a GitHub token and can start a workflow. Nothing outside pg_cron may call it.
revoke all on function public.wpbl_bluesky_nudge() from public;
revoke all on function public.wpbl_bluesky_nudge() from anon, authenticated;
