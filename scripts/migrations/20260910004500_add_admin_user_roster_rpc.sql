-- admin user roster rpc
-- Created 2026-09-09. Applied by scripts/migrate.mjs.

-- ONE OWNER-ONLY READ THAT ANSWERS "WHO ARE THESE 150 PEOPLE".
--
-- The Users panel was built when the site was an MLB predictions game, so it read three
-- tables from the browser (usernames + prediction_boards + prediction_stats) and showed a
-- name, a join date and a pick record. WPBL now carries the traffic, and every fact that
-- would describe a WPBL reader lives in a table RLS'd to OWN ROWS ONLY: user_preferences
-- (favourite club, notification opt-ins), push_subscriptions (devices), wpbl_game_reminders
-- (per-game alerts), events (owner-only). Counting any of those from the browser returns the
-- owner's own row and reports a site with one user: the exact trap docs/ADMIN_ANALYTICS.md
-- section 2 already records for admin_growth.
--
-- So this is a security definer function with an explicit is_site_owner() guard, on the same
-- footing as the nine analytics RPCs beside it, and for the same reason: security definer
-- WITHOUT the guard would publish every visitor's preferences to anyone with an account.
-- set search_path = '' closes the definer-path hijack, hence the schema-qualified names.
--
-- IT RETURNS EMAIL AND LAST SIGN-IN, which the client-side version could not. Those come
-- from auth.users and are the only way to tell two accounts apart when the question is "which
-- of these is the person who emailed me". This function is the boundary that keeps them
-- owner-only; nothing else may read them, and this must never become a view (a view runs with
-- its owner's rights and would hand auth.users to everyone).
--
-- usernames.user_id is TEXT while every other per-user table is UUID. Every join below casts
-- explicitly; that mismatch is documented and is not being "fixed" here.

-- === roles ===================================================================
--
-- A place to say "this person is not the owner and is not an ordinary reader either".
-- Deliberately a table rather than another hard-coded email compare like ADMIN_EMAIL: the
-- owner is one address that never changes, a collaborator is a person who arrives, and
-- shipping a deploy to add one is not a workflow.
--
-- A ROLE GRANTS NOTHING ON ITS OWN. It is read by the client to decide what to draw, exactly
-- as useIsAdmin() is, and every server-side check in this schema still asks is_site_owner().
-- If a role ever needs to unlock a WRITE, that check goes in the RLS policy for the write,
-- not here.
create table if not exists public.user_roles (
  user_id    uuid        not null references auth.users(id) on delete cascade,
  role       text        not null,
  granted_at timestamptz not null default now(),
  -- Why this person has it. The grant is a fact about a relationship (who collaborated on
  -- what), and in a year nothing else will remember.
  note       text,
  primary key (user_id, role),
  constraint user_roles_known check (role in ('collaborator', 'moderator'))
);

comment on table public.user_roles is
  'Cosmetic capability grants, read by the client to decide what to render. Never a security boundary: server-side checks use is_site_owner().';

alter table public.user_roles enable row level security;

-- A user reads their OWN roles, because the client gate needs to know them and a role is not
-- a secret from the person holding it. Nobody reads anybody else's: the roster below is the
-- owner's view and it comes through the definer function, so a signed-in reader cannot
-- enumerate who the collaborators are.
drop policy if exists "Read own roles" on public.user_roles;
create policy "Read own roles"
  on public.user_roles for select
  using (user_id = auth.uid() or public.is_site_owner());

-- Grants and revokes are the owner's alone. Written through the RPC below rather than a bare
-- insert so the role name is validated in one place and the note travels with the grant.
drop policy if exists "Owner manages roles" on public.user_roles;
create policy "Owner manages roles"
  on public.user_roles for all
  using (public.is_site_owner()) with check (public.is_site_owner());

-- Does the CALLER hold this role. For RLS policies and any future server-side use; the client
-- asks by reading its own rows.
create or replace function public.user_has_role(want text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.user_roles where user_id = auth.uid() and role = want
  );
$$;
revoke all on function public.user_has_role(text) from public;
grant execute on function public.user_has_role(text) to authenticated;

-- === the roster ==============================================================
--
-- One row per registered account, newest first, with everything the panel shows. days_back
-- scopes only the ACTIVITY columns (events, active days, the wpbl/mlb split); identity,
-- preferences and push are lifetime facts and ignore it, which is why the panel labels that
-- group with the window and the rest without one.
create or replace function public.admin_user_roster(
  days_back int  default 30,
  tz        text default 'UTC'
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  zone      text := public.admin_safe_tz(tz);
  win_start timestamptz;
  result    jsonb;
begin
  if not public.is_site_owner() then
    raise exception 'admin_user_roster: not authorized' using errcode = '42501';
  end if;

  days_back := least(greatest(coalesce(days_back, 30), 1), 365);
  win_start := (((now() at time zone zone)::date - (days_back - 1))::timestamp) at time zone zone;

  with u as (
    select n.user_id::uuid as uid, n.username, n.created_at,
           coalesce(n.is_deleted, false) as is_deleted, n.deleted_at
      from public.usernames n
     -- A row whose user_id will not cast is a pre-auth leftover, not a person. Skipping it
     -- here rather than letting the cast raise keeps one bad row from blanking the panel.
     where n.user_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  ),
  -- Activity in the window, plus the lifetime last-seen. Two aggregates over the same table
  -- because "quiet lately" and "never came back" are different answers and the panel shows
  -- both.
  ev as (
    select e.user_id as uid,
           count(*) filter (where e.created_at >= win_start)                           as events,
           count(distinct (e.created_at at time zone zone)::date)
             filter (where e.created_at >= win_start)                                  as active_days,
           count(*) filter (where e.created_at >= win_start
                              and public.admin_event_league(e.props, e.path) = 'wpbl')  as wpbl_events,
           count(*) filter (where e.created_at >= win_start
                              and public.admin_event_league(e.props, e.path) = 'mlb')   as mlb_events,
           max(e.created_at)                                                            as last_seen
      from public.events e
     where e.user_id is not null
     group by e.user_id
  ),
  push as (
    select p.user_id as uid, count(*) as devices
      from public.push_subscriptions p group by p.user_id
  ),
  rem as (
    select r.user_id as uid, count(*) as reminders
      from public.wpbl_game_reminders r group by r.user_id
  ),
  fb as (
    select f.user_id as uid, count(*) as messages
      from public.feedback f where f.user_id is not null group by f.user_id
  ),
  -- The bracket pick'em is the one thing in wpbl_award_votes keyed to an ACCOUNT; the fan
  -- awards ballot on the same table is keyed to a browser id. Filtering on the category
  -- prefix first is mandatory rather than tidy: without it this counts browser ids as users.
  picks as (
    select v.voter_key as uid_text, count(*) as series_picks
      from public.wpbl_award_votes v
     where v.category like 'pickem:%'
     group by v.voter_key
  ),
  roles as (
    select r.user_id as uid,
           jsonb_agg(jsonb_build_object('role', r.role, 'note', r.note) order by r.role) as roles
      from public.user_roles r group by r.user_id
  ),
  -- The all-time prediction board, the same source the MLB leaderboard reads.
  -- prediction_stats is only written when a user opens My Stats, so it misses most predictors
  -- and is the fallback rather than the number.
  board as (
    select (e->>'userId')          as uid_text,
           (e->>'total')::int      as total,
           (e->>'correct')::int    as correct,
           (e->>'accuracy')::numeric as accuracy
      from public.prediction_boards b,
           lateral jsonb_array_elements(b.data->'entries') e
     where b.window_key = 'all'
  )
  select coalesce(jsonb_agg(r.row order by (r.row->>'created_at') desc), '[]'::jsonb)
    into result
  from (
    select jsonb_build_object(
      'user_id',    u.uid,
      'username',   u.username,
      'created_at', u.created_at,
      'is_deleted', u.is_deleted,
      'deleted_at', u.deleted_at,
      -- auth.users. `provider` says how they got in, which is the difference between a
      -- password reset being useful and being impossible.
      'email',        au.email,
      'provider',     coalesce(au.raw_app_meta_data->>'provider', 'email'),
      'confirmed',    au.email_confirmed_at is not null,
      'last_sign_in', au.last_sign_in_at,
      -- Activity, windowed by days_back.
      'events',       coalesce(ev.events, 0),
      'active_days',  coalesce(ev.active_days, 0),
      'wpbl_events',  coalesce(ev.wpbl_events, 0),
      'mlb_events',   coalesce(ev.mlb_events, 0),
      'last_seen',    ev.last_seen,
      -- What they have set up. Lifetime, not windowed.
      'favorite_team',     p.wpbl_favorite_team_id,
      'notify_wpbl_all',   coalesce(p.notify_wpbl_all_games, false),
      'notify_game_start', coalesce(p.notify_game_start, false),
      'notify_picks',      coalesce(p.notify_pick_reminders, false),
      'push_devices',      coalesce(push.devices, 0),
      'game_reminders',    coalesce(rem.reminders, 0),
      'series_picks',      coalesce(picks.series_picks, 0),
      'feedback',          coalesce(fb.messages, 0),
      'roles',             coalesce(roles.roles, '[]'::jsonb),
      -- MLB predictions: demoted but not dropped, since it is still the only record some of
      -- these accounts have.
      'predictions', coalesce(board.total,    ps.total_predictions),
      'correct',     coalesce(board.correct,  ps.correct_predictions),
      'accuracy',    coalesce(board.accuracy, ps.accuracy_pct)
    ) as row
    from u
    left join auth.users au               on au.id = u.uid
    left join ev                          on ev.uid = u.uid
    -- Cast BOTH sides: user_preferences and prediction_stats have no create script in this
    -- repo (their DDL lives in the Supabase dashboard, see add_user_active_guard.sql), so
    -- their key type is not knowable from here. 150 rows makes the lost index free.
    left join public.user_preferences p    on p.user_id::text = u.uid::text
    left join push                        on push.uid = u.uid
    left join rem                         on rem.uid = u.uid
    left join fb                          on fb.uid = u.uid
    left join roles                       on roles.uid = u.uid
    left join picks                       on picks.uid_text = u.uid::text
    left join board                       on board.uid_text = u.uid::text
    left join public.prediction_stats ps   on ps.user_id::text = u.uid::text
  ) r;

  return result;
end;
$$;

-- === grant / revoke a role ===================================================
--
-- The write path for user_roles. A function rather than a browser insert for the reason the
-- fan-award writer exists: the panel sets a row for SOMEBODY ELSE, and routing that through
-- one guarded entry point means the role name is validated and the grant recorded in one
-- place instead of at every call site.
--
-- Plain insert ... on conflict, not a PostgREST .upsert(). This table does have a select
-- policy so an upsert would in fact work, but see CLAUDE.md's trap: a table the browser must
-- not read cannot be upserted into, and keeping the habit costs nothing here.
create or replace function public.admin_set_user_role(
  target  uuid,
  want    text,
  granted boolean,
  why     text default null
) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not public.is_site_owner() then
    raise exception 'admin_set_user_role: not authorized' using errcode = '42501';
  end if;

  if granted then
    insert into public.user_roles (user_id, role, note)
    values (target, want, why)
    on conflict (user_id, role)
      do update set note = coalesce(excluded.note, public.user_roles.note);
  else
    delete from public.user_roles where user_id = target and role = want;
  end if;

  return true;
end;
$$;

-- === grants ==================================================================
-- Revoke the default public execute first, so an unauthenticated caller does not even reach
-- the guard. The guard is the boundary; this is the belt.
revoke all on function public.admin_user_roster(int, text)                   from public;
revoke all on function public.admin_set_user_role(uuid, text, boolean, text) from public;

grant execute on function public.admin_user_roster(int, text)                   to authenticated;
grant execute on function public.admin_set_user_role(uuid, text, boolean, text) to authenticated;
