-- Move the analytics rows written by TEST RUNS out of `events`, and keep any more from landing.
--
-- Vitest loads the real .env, so until Sep 24, 2026 every component test that fired `track()`
-- inserted a real row: 5,235 sessions and 41,100 events since Aug 25, and on Sep 24 about 600 of
-- the day's 806 sessions. /admin read it as a traffic spike.
--
-- THE SIGNATURE IS path = '/'. jsdom's location is '/', and the live app never tracks there: the
-- root redirects to /wpbl before anything fires. Measured before writing this: every session that
-- ever recorded '/' recorded ONLY '/', none was signed in, and every event in them is one a
-- component test renders. No real session has a single '/' row.
--
-- A SEPARATE TABLE, NOT A FLAG. Fifteen admin_* functions read `events`; a flag column would need
-- a filter in each of them and in every one written later, and the one that forgets puts the test
-- rows back into the numbers without a sign. Moving the rows needs no reader to change and is
-- just as reversible: `insert into events select id, created_at, user_id, session_id, event,
-- props, path from events_test` puts them back.
--
-- THE TRIGGER is what keeps it clean. The client now skips `track()` under Vitest
-- (src/lib/analytics.ts), but a checkout or worktree without that change still writes, and so
-- would any future bug of the same shape. Rows are diverted, never dropped: if the app ever does
-- track on '/', they are all in events_test.

create table if not exists public.events_test (
  id          bigint primary key,
  created_at  timestamptz not null,
  user_id     uuid,
  session_id  text,
  event       text,
  props       jsonb,
  path        text,
  moved_at    timestamptz not null default now()
);

-- Owner-only by having no policies at all: nothing in the browser reads or writes it, and the
-- trigger below writes through security definer. Same footing as events' own reads (see
-- docs/ADMIN_ANALYTICS.md section 2).
alter table public.events_test enable row level security;
revoke all on public.events_test from anon, authenticated;

insert into public.events_test (id, created_at, user_id, session_id, event, props, path)
select id, created_at, user_id, session_id, event, props, path
from public.events
where path = '/'
on conflict (id) do nothing;

delete from public.events e
where e.path = '/'
  and exists (select 1 from public.events_test t where t.id = e.id);

create or replace function public.divert_test_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.events_test (id, created_at, user_id, session_id, event, props, path)
  values (new.id, new.created_at, new.user_id, new.session_id, new.event, new.props, new.path)
  on conflict (id) do nothing;
  return null;
end;
$$;

revoke all on function public.divert_test_event() from public;

drop trigger if exists divert_test_event on public.events;
create trigger divert_test_event
  before insert on public.events
  for each row
  when (new.path = '/')
  execute function public.divert_test_event();
