-- notification state sync
-- Created 2026-11-21. Applied by scripts/migrate.mjs.
--
-- The bell's read and dismissed marks, per account, so reading or dismissing a notification in one
-- browser reaches every other browser the reader is signed in on. Until now they lived only in each
-- browser's localStorage, so a phone and a laptop each kept their own unread count, and something
-- dismissed on one came back on the other.
--
-- One row per account and notification id. The ids already carry their occasion
-- (`picks_ready:2026-08-21`, `wpbl_game_start:<gameId>`), so a mark never reaches tomorrow's item.

create table if not exists public.notification_state (
  user_id         uuid        not null references auth.users (id) on delete cascade,
  notification_id text        not null check (length(notification_id) between 1 and 200),
  read_at         timestamptz,
  dismissed_at    timestamptz,
  updated_at      timestamptz not null default now(),
  primary key (user_id, notification_id)
);

-- The bell pulls rows newer than its 14-day window on every refresh.
create index if not exists notification_state_user_updated
  on public.notification_state (user_id, updated_at);

alter table public.notification_state enable row level security;

-- Read only. Writes go through notification_state_mark below, never a browser upsert: an upsert
-- would let a device that has not yet pulled overwrite another device's dismissal with null.
drop policy if exists notification_state_select_own on public.notification_state;
create policy notification_state_select_own on public.notification_state
  for select to authenticated using (user_id = (select auth.uid()));

-- Marks only ever move forward: read stays read, dismissed stays dismissed, and the earliest time
-- wins. That is what makes two devices writing at once safe in either order.
--
-- Definer because the table has no insert or update policy. It writes only the caller's own rows
-- (auth.uid()), refuses anon, and caps the batch at the bell's own 50-item size with room to spare.
create or replace function public.notification_state_mark(ids text[], dismiss boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'notification_state_mark: not signed in' using errcode = '42501';
  end if;
  if ids is null or cardinality(ids) = 0 then return; end if;
  if cardinality(ids) > 200 then
    raise exception 'notification_state_mark: too many ids' using errcode = '22023';
  end if;

  insert into public.notification_state as s (user_id, notification_id, read_at, dismissed_at, updated_at)
  select me, i, now(), case when dismiss then now() end, now()
    from (select distinct unnest(ids) as i) u
   where length(i) between 1 and 200
  on conflict (user_id, notification_id) do update
    set read_at      = coalesce(s.read_at, excluded.read_at),
        dismissed_at = coalesce(s.dismissed_at, excluded.dismissed_at),
        updated_at   = now();
end;
$fn$;
revoke all on function public.notification_state_mark(text[], boolean) from public, anon;
grant execute on function public.notification_state_mark(text[], boolean) to authenticated;

-- Nothing older than the bell's 14-day window can still be on screen anywhere; a month is margin.
select cron.schedule('notification-state-prune', '23 4 * * *',
  $$ delete from public.notification_state where updated_at < now() - interval '30 days'; $$);
