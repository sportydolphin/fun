-- public photo tagging
-- Created 2026-10-20. Applied by scripts/migrate.mjs.
--
-- Anyone, signed in or not, can say who is in a fan photo the owner has opened for tagging. The
-- plan of record is docs/PHOTO_TAGGING.md; read it first. The short version: every untagged fan
-- photo is unpublished, so this shows unpublished photographs to strangers and asks them for names,
-- and every decision here follows from that.
--
-- WHAT A STRANGER CAN DO, AND ALL THEY CAN DO: read the open queue through one function that
-- returns a narrow column list, suggest names from a closed list through a second, and report a
-- photo through a third. A suggestion is never a tag. Nothing reaches a reader until the owner
-- accepts it in /admin, so the worst a determined abuser achieves is noise in a review queue, and
-- the guards below exist to keep that noise small and cheap to clear.
--
-- THE GUARDS, because a per-browser key is free to mint again:
--   * A closed vocabulary. A suggestion is a player id, a figure key or a club id that exists. There
--     is no free text anywhere, so there is nothing to moderate and nothing that renders as markup.
--   * Limits keyed on the caller's IP as well as the key, as a salted hash (the raw address is
--     never stored): per key and per IP an hour, per photo per key and per IP, and one global
--     ceiling an hour so a botnet cannot bury the queue whatever it rotates. Over a limit the call
--     records nothing and says so.
--   * The owner's agreement count is distinct IPs, not distinct keys, so a private window does not
--     add a vote.
--   * Blocks, by key or by IP hash, set from /admin. A blocked caller is told the call worked and
--     nothing is stored, so there is no signal to rotate on.
--   * A report pulls a photo from the queue at once (one person can hide a photo, cheap to undo,
--     and can never publish one), capped per IP a day so the whole queue cannot be hidden.
--
-- NOT A FOURTH WRITE PATH (scripts/migrations/CLAUDE.md): the browser writes its own rows through
-- definer functions, the same footing as wpbl_cast_award_vote. None of the new tables has a policy
-- for anon or authenticated, so the functions are the only door, and nothing here goes on the edge
-- cache list (every answer depends on the caller's key).

-- ─── The owner's gate ─────────────────────────────────────────────────────────
-- Opening a photo is, in effect, publishing its image: the renders are public to anyone holding the
-- URL and the queue hands the URL out. So it is a separate, deliberate step from Publish, and the
-- screen before it is the screen before publishing (docs/FAN_PHOTOS.md: crowds, children, scope).
alter table public.wpbl_fan_photos
  add column if not exists open_for_tagging boolean not null default false;
create index if not exists wpbl_fan_photos_open_idx
  on public.wpbl_fan_photos (id) where open_for_tagging;

-- ─── The salt behind the IP hash ──────────────────────────────────────────────
-- One row, readable by nobody but the definer functions (RLS on, no policy). Without a secret salt
-- an IPv4 hash is reversible by trying all four billion addresses.
create table if not exists public.wpbl_photo_tag_secret (
  id   boolean primary key default true check (id),
  salt text not null
);
alter table public.wpbl_photo_tag_secret enable row level security;
insert into public.wpbl_photo_tag_secret (salt)
  values (encode(extensions.gen_random_bytes(32), 'hex'))
  on conflict (id) do nothing;

-- ─── Suggestions ──────────────────────────────────────────────────────────────
create table if not exists public.wpbl_photo_tag_suggestions (
  id            uuid primary key default gen_random_uuid(),
  photo_id      uuid not null references public.wpbl_fan_photos (id) on delete cascade,
  player_id     uuid references public.wpbl_players (id) on delete cascade,
  figure_key    text references public.wpbl_photo_figures (key) on update cascade on delete cascade,
  team_id       text references public.wpbl_teams (id) on delete cascade,
  suggester_key text not null check (char_length(suggester_key) between 16 and 64),
  -- The caller's address, salted and hashed (see wpbl_photo_tag_caller()). Null when the request
  -- carried none, which only a direct database session does.
  ip_hash       text,
  user_id       uuid,
  status        text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  decided_at    timestamptz,
  created_at    timestamptz not null default now(),
  constraint wpbl_photo_tag_suggestions_one_subject check (num_nonnulls(player_id, figure_key, team_id) = 1)
);
-- One row per (photo, key, subject): a repeat is ignored, not counted twice.
create unique index if not exists wpbl_photo_tag_suggestions_uidx
  on public.wpbl_photo_tag_suggestions
  (photo_id, suggester_key, coalesce(player_id::text, ''), coalesce(figure_key, ''), coalesce(team_id, ''));
create index if not exists wpbl_photo_tag_suggestions_photo_idx  on public.wpbl_photo_tag_suggestions (photo_id);
create index if not exists wpbl_photo_tag_suggestions_key_idx    on public.wpbl_photo_tag_suggestions (suggester_key, created_at);
create index if not exists wpbl_photo_tag_suggestions_ip_idx     on public.wpbl_photo_tag_suggestions (ip_hash, created_at) where ip_hash is not null;
create index if not exists wpbl_photo_tag_suggestions_time_idx   on public.wpbl_photo_tag_suggestions (created_at);
create index if not exists wpbl_photo_tag_suggestions_player_idx on public.wpbl_photo_tag_suggestions (player_id) where player_id is not null;

alter table public.wpbl_photo_tag_suggestions enable row level security;
drop policy if exists "Owner reviews photo tag suggestions" on public.wpbl_photo_tag_suggestions;
create policy "Owner reviews photo tag suggestions" on public.wpbl_photo_tag_suggestions
  for all using (public.is_site_owner()) with check (public.is_site_owner());

-- ─── Reports ──────────────────────────────────────────────────────────────────
create table if not exists public.wpbl_photo_reports (
  id            uuid primary key default gen_random_uuid(),
  photo_id      uuid not null references public.wpbl_fan_photos (id) on delete cascade,
  suggester_key text not null check (char_length(suggester_key) between 16 and 64),
  ip_hash       text,
  reason        text not null check (reason in ('private_person', 'child', 'not_wpbl', 'other')),
  resolved_at   timestamptz,
  created_at    timestamptz not null default now()
);
create unique index if not exists wpbl_photo_reports_uidx on public.wpbl_photo_reports (photo_id, suggester_key);
create index if not exists wpbl_photo_reports_open_idx on public.wpbl_photo_reports (photo_id) where resolved_at is null;
create index if not exists wpbl_photo_reports_key_idx  on public.wpbl_photo_reports (suggester_key, created_at);
create index if not exists wpbl_photo_reports_ip_idx   on public.wpbl_photo_reports (ip_hash, created_at) where ip_hash is not null;

alter table public.wpbl_photo_reports enable row level security;
drop policy if exists "Owner resolves photo reports" on public.wpbl_photo_reports;
create policy "Owner resolves photo reports" on public.wpbl_photo_reports
  for all using (public.is_site_owner()) with check (public.is_site_owner());

-- ─── Blocks ───────────────────────────────────────────────────────────────────
create table if not exists public.wpbl_photo_tag_blocks (
  kind       text not null check (kind in ('key', 'ip')),
  value      text not null check (char_length(value) between 16 and 128),
  created_at timestamptz not null default now(),
  primary key (kind, value)
);
alter table public.wpbl_photo_tag_blocks enable row level security;
drop policy if exists "Owner manages photo tag blocks" on public.wpbl_photo_tag_blocks;
create policy "Owner manages photo tag blocks" on public.wpbl_photo_tag_blocks
  for all using (public.is_site_owner()) with check (public.is_site_owner());

-- ─── Who is calling ───────────────────────────────────────────────────────────
-- The salted hash of the caller's address, from the headers PostgREST hands every request.
-- `cf-connecting-ip` first: Cloudflare, in front of Supabase, overwrites any copy a client sends,
-- where the FIRST entry of x-forwarded-for is whatever the client claimed. Null outside an HTTP
-- request. Internal: only the definer functions below call it.
create or replace function public.wpbl_photo_tag_caller()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  h  json;
  ip text;
begin
  begin
    h := nullif(current_setting('request.headers', true), '')::json;
  exception when others then
    h := null;
  end;
  if h is null then return null; end if;
  ip := coalesce(
    nullif(trim(h ->> 'cf-connecting-ip'), ''),
    nullif(trim(h ->> 'x-real-ip'), ''),
    nullif(trim(split_part(h ->> 'x-forwarded-for', ',', 1)), ''));
  if ip is null or char_length(ip) > 64 then return null; end if;
  return encode(extensions.digest(ip || (select salt from public.wpbl_photo_tag_secret), 'sha256'), 'hex');
end;
$fn$;
revoke all on function public.wpbl_photo_tag_caller() from public, anon, authenticated;

-- Blocked: told it worked, nothing stored. Internal, like the one above.
create or replace function public.wpbl_photo_tag_blocked(p_key text, p_ip text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (select 1 from public.wpbl_photo_tag_blocks b
                  where (b.kind = 'key' and b.value = p_key) or (b.kind = 'ip' and b.value = p_ip));
$fn$;
revoke all on function public.wpbl_photo_tag_blocked(text, text) from public, anon, authenticated;

-- ─── The queue ────────────────────────────────────────────────────────────────
-- Photos open for tagging that nothing yet names (no subject, no category), carry no open report,
-- and this key has not already answered. Effort spreads: fewest distinct suggesters first, random
-- among ties. Returns only what the page draws, never contributor_id, storage_path or the curator
-- fields, and the queue's progress on every row so one call is the whole page.
create or replace function public.wpbl_photos_to_tag(p_key text, p_limit int default 10, p_skip uuid[] default '{}')
returns table (
  id uuid, card_url text, full_url text, width int, height int, credit text,
  open_count int, named_count int
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_open  int;
  v_named int;
begin
  if p_key is null or char_length(p_key) not between 16 and 64 then return; end if;
  p_limit := least(greatest(coalesce(p_limit, 10), 1), 20);
  if coalesce(cardinality(p_skip), 0) > 500 then p_skip := p_skip[1:500]; end if;

  select count(*)::int,
         count(*) filter (where p.category_key is not null
           or exists (select 1 from public.wpbl_photo_subjects s where s.photo_id = p.id))::int
    into v_open, v_named
    from public.wpbl_fan_photos p
   where p.open_for_tagging;

  return query
  select p.id, p.card_url, p.full_url, p.width, p.height, p.credit, v_open, v_named
    from public.wpbl_fan_photos p
   where p.open_for_tagging
     and p.category_key is null
     and not exists (select 1 from public.wpbl_photo_subjects s where s.photo_id = p.id)
     and not exists (select 1 from public.wpbl_photo_reports r where r.photo_id = p.id and r.resolved_at is null)
     and not exists (select 1 from public.wpbl_photo_tag_suggestions g where g.photo_id = p.id and g.suggester_key = p_key)
     and not exists (select 1 from public.wpbl_photo_reports r where r.photo_id = p.id and r.suggester_key = p_key)
     and not (p.id = any (coalesce(p_skip, '{}')))
   order by (select count(distinct coalesce(g.ip_hash, g.suggester_key))
               from public.wpbl_photo_tag_suggestions g where g.photo_id = p.id and g.status <> 'rejected'),
            random()
   limit p_limit;
end;
$fn$;

-- ─── Suggesting ───────────────────────────────────────────────────────────────
-- p_subjects is a JSON array of {"player": uuid} | {"figure": key} | {"team": id}, at most ten.
-- Returns a word rather than raising, so the page can say what happened:
--   'ok'       recorded (or silently dropped for a blocked caller, on purpose)
--   'closed'   the photo is no longer in the queue (named, reported or closed meanwhile)
--   'invalid'  a malformed call or a subject that does not exist; nothing is recorded
--   'limited'  over a rate limit; nothing is recorded
create or replace function public.wpbl_suggest_photo_tags(p_photo uuid, p_key text, p_subjects jsonb)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_ip     text := public.wpbl_photo_tag_caller();
  v_n      int;
  v_item   jsonb;
  v_player uuid;
begin
  if p_photo is null or p_key is null or char_length(p_key) not between 16 and 64 then return 'invalid'; end if;
  if p_subjects is null or jsonb_typeof(p_subjects) <> 'array' then return 'invalid'; end if;
  v_n := jsonb_array_length(p_subjects);
  if v_n < 1 or v_n > 10 then return 'invalid'; end if;

  -- Still in the queue: open, unnamed, unreported.
  if not exists (
    select 1 from public.wpbl_fan_photos p
     where p.id = p_photo and p.open_for_tagging and p.category_key is null
       and not exists (select 1 from public.wpbl_photo_subjects s where s.photo_id = p.id)
       and not exists (select 1 from public.wpbl_photo_reports r where r.photo_id = p.id and r.resolved_at is null)
  ) then return 'closed'; end if;

  -- Every subject well formed and real, before anything is written.
  for v_item in select * from jsonb_array_elements(p_subjects) loop
    if jsonb_typeof(v_item) <> 'object' or (select count(*) from jsonb_object_keys(v_item)) <> 1 then return 'invalid'; end if;
    if v_item ? 'player' then
      if jsonb_typeof(v_item -> 'player') <> 'string'
         or (v_item ->> 'player') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return 'invalid'; end if;
      if not exists (select 1 from public.wpbl_players where id = (v_item ->> 'player')::uuid) then return 'invalid'; end if;
    elsif v_item ? 'figure' then
      if jsonb_typeof(v_item -> 'figure') <> 'string'
         or not exists (select 1 from public.wpbl_photo_figures where key = v_item ->> 'figure') then return 'invalid'; end if;
    elsif v_item ? 'team' then
      if jsonb_typeof(v_item -> 'team') <> 'string'
         or not exists (select 1 from public.wpbl_teams where id = v_item ->> 'team') then return 'invalid'; end if;
    else
      return 'invalid';
    end if;
  end loop;

  if public.wpbl_photo_tag_blocked(p_key, v_ip) then return 'ok'; end if;

  -- The limits, counted before this call's rows: on this photo, in the last hour, and the site's hour.
  if (select count(*) from public.wpbl_photo_tag_suggestions where photo_id = p_photo and suggester_key = p_key) + v_n > 10
  then return 'limited'; end if;
  if v_ip is not null and (select count(*) from public.wpbl_photo_tag_suggestions where photo_id = p_photo and ip_hash = v_ip) + v_n > 20
  then return 'limited'; end if;
  if (select count(*) from public.wpbl_photo_tag_suggestions
       where suggester_key = p_key and created_at > now() - interval '1 hour') + v_n > 300
  then return 'limited'; end if;
  if v_ip is not null and (select count(*) from public.wpbl_photo_tag_suggestions
       where ip_hash = v_ip and created_at > now() - interval '1 hour') + v_n > 600
  then return 'limited'; end if;
  if (select count(*) from public.wpbl_photo_tag_suggestions where created_at > now() - interval '1 hour') + v_n > 5000
  then return 'limited'; end if;

  for v_item in select * from jsonb_array_elements(p_subjects) loop
    v_player := case when v_item ? 'player' then (v_item ->> 'player')::uuid end;
    insert into public.wpbl_photo_tag_suggestions (photo_id, player_id, figure_key, team_id, suggester_key, ip_hash, user_id)
    values (p_photo, v_player, v_item ->> 'figure', v_item ->> 'team', p_key, v_ip, auth.uid())
    on conflict do nothing;
  end loop;
  return 'ok';
end;
$fn$;

-- ─── Reporting ────────────────────────────────────────────────────────────────
-- 'ok' | 'closed' | 'invalid' | 'limited', as above. Ten reports a day per key and per IP.
create or replace function public.wpbl_report_photo(p_photo uuid, p_key text, p_reason text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_ip text := public.wpbl_photo_tag_caller();
begin
  if p_photo is null or p_key is null or char_length(p_key) not between 16 and 64 then return 'invalid'; end if;
  if p_reason is null or p_reason not in ('private_person', 'child', 'not_wpbl', 'other') then return 'invalid'; end if;
  if not exists (select 1 from public.wpbl_fan_photos where id = p_photo and open_for_tagging) then return 'closed'; end if;
  if public.wpbl_photo_tag_blocked(p_key, v_ip) then return 'ok'; end if;
  if (select count(*) from public.wpbl_photo_reports
       where suggester_key = p_key and created_at > now() - interval '1 day') >= 10
  then return 'limited'; end if;
  if v_ip is not null and (select count(*) from public.wpbl_photo_reports
       where ip_hash = v_ip and created_at > now() - interval '1 day') >= 10
  then return 'limited'; end if;

  insert into public.wpbl_photo_reports (photo_id, suggester_key, ip_hash, reason)
  values (p_photo, p_key, v_ip, p_reason)
  on conflict (photo_id, suggester_key) do nothing;
  return 'ok';
end;
$fn$;

revoke all on function public.wpbl_photos_to_tag(text, int, uuid[]) from public;
revoke all on function public.wpbl_suggest_photo_tags(uuid, text, jsonb) from public;
revoke all on function public.wpbl_report_photo(uuid, text, text) from public;
grant execute on function public.wpbl_photos_to_tag(text, int, uuid[]) to anon, authenticated;
grant execute on function public.wpbl_suggest_photo_tags(uuid, text, jsonb) to anon, authenticated;
grant execute on function public.wpbl_report_photo(uuid, text, text) to anon, authenticated;

-- ─── Extend wpbl_merge_players to repoint suggestions ─────────────────────────
-- MUST ship with the table above (docs/FAN_PHOTOS.md trap 1): the function hand-lists every table
-- holding a player_id, and a table it has not been taught about silently loses the merged player's
-- rows. A full replace of the LIVE definition (read with pg_get_functiondef on Oct 20, 2026) with
-- one block added before the player row is merged: a dupe's suggestion the kept player already has
-- from the same key on the same photo is deleted first, since the unique index would refuse it.
CREATE OR REPLACE FUNCTION public.wpbl_merge_players(keep uuid, dupe uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if keep = dupe then
    raise exception 'wpbl_merge_players: keep and dupe are the same row (%)', keep;
  end if;
  if not exists (select 1 from wpbl_players where id = keep) then
    raise exception 'wpbl_merge_players: keep row % does not exist', keep;
  end if;
  if not exists (select 1 from wpbl_players where id = dupe) then
    raise exception 'wpbl_merge_players: dupe row % does not exist', dupe;
  end if;

  delete from wpbl_batting_lines d
   where d.player_id = dupe
     and exists (select 1 from wpbl_batting_lines k where k.player_id = keep and k.game_id = d.game_id);
  delete from wpbl_pitching_lines d
   where d.player_id = dupe
     and exists (select 1 from wpbl_pitching_lines k where k.player_id = keep and k.game_id = d.game_id);
  delete from wpbl_fielding_lines d
   where d.player_id = dupe
     and exists (select 1 from wpbl_fielding_lines k where k.player_id = keep and k.game_id = d.game_id);

  update wpbl_batting_lines  set player_id = keep where player_id = dupe;
  update wpbl_pitching_lines set player_id = keep where player_id = dupe;
  update wpbl_fielding_lines set player_id = keep where player_id = dupe;

  update wpbl_game_plays set batter_id  = keep where batter_id  = dupe;
  update wpbl_game_plays set pitcher_id = keep where pitcher_id = dupe;

  update wpbl_plays set batter_id           = keep where batter_id           = dupe;
  update wpbl_plays set pitcher_id          = keep where pitcher_id          = dupe;
  update wpbl_plays set runner_id           = keep where runner_id           = dupe;
  update wpbl_plays set runner_first_after  = keep where runner_first_after  = dupe;
  update wpbl_plays set runner_second_after = keep where runner_second_after = dupe;
  update wpbl_plays set runner_third_after  = keep where runner_third_after  = dupe;

  update wpbl_games set home_pitcher_id = keep where home_pitcher_id = dupe;
  update wpbl_games set away_pitcher_id = keep where away_pitcher_id = dupe;
  update wpbl_games set runner_first    = keep where runner_first    = dupe;
  update wpbl_games set runner_second   = keep where runner_second   = dupe;
  update wpbl_games set runner_third    = keep where runner_third    = dupe;

  delete from wpbl_discord_birthday_posts d
   where d.player_id = dupe
     and exists (select 1 from wpbl_discord_birthday_posts k
                  where k.player_id = keep and k.birthday_on = d.birthday_on);
  update wpbl_discord_birthday_posts set player_id = keep where player_id = dupe;

  -- Unique on (player_id, game_id, from_team_id, to_team_id) since the Sep 1 dedupe, so
  -- re-pointing the duplicate's rows can now COLLIDE with the kept player's: both logging the
  -- same move out of the same box score is precisely what a mergeable pair looks like. Same
  -- shape as the birthday block above, and for the same reason: an unmergeable pair is worse
  -- than losing a log line that says what a surviving line already says.
  delete from wpbl_player_team_changes d
   where d.player_id = dupe
     and exists (select 1 from wpbl_player_team_changes k
                  where k.player_id = keep
                    and k.game_id is not distinct from d.game_id
                    and k.from_team_id is not distinct from d.from_team_id
                    and k.to_team_id = d.to_team_id);
  update wpbl_player_team_changes set player_id = keep where player_id = dupe;

  -- Photo tags are unique on (photo_id, player_id): if both rows tag the same photo, drop the
  -- duplicate before repointing, the same shape as the box-score lines above. Miss this block
  -- and a merge orphans every fan photo of the merged player.
  delete from wpbl_photo_subjects d
   where d.player_id = dupe
     and exists (select 1 from wpbl_photo_subjects k where k.player_id = keep and k.photo_id = d.photo_id);
  update wpbl_photo_subjects set player_id = keep where player_id = dupe;

  update wpbl_articles
     set player_ids = (select array_agg(distinct x) from unnest(array_replace(player_ids, dupe, keep)) x)
   where player_ids @> array[dupe];

  -- Clip tags hold players in an array, like wpbl_articles above. Miss this and a merge leaves
  -- the merged player's clips pointing at a row that no longer exists: gone from the player page
  -- and the clips filter until the next --relink rebuilds them, and a manual tag never comes back.
  update wpbl_video_tags
     set player_ids = (select array_agg(distinct x) from unnest(array_replace(player_ids, dupe, keep)) x)
   where player_ids @> array[dupe];

  delete from wpbl_photo_tag_suggestions d
   where d.player_id = dupe
     and exists (select 1 from wpbl_photo_tag_suggestions k
                  where k.player_id = keep and k.photo_id = d.photo_id and k.suggester_key = d.suggester_key);
  update wpbl_photo_tag_suggestions set player_id = keep where player_id = dupe;

  update wpbl_players k
     set api_ids = (select coalesce(array_agg(distinct a), '{}'::text[])
                      from unnest(k.api_ids || d.api_ids || array[k.api_id, d.api_id]) a
                     where a is not null and a <> ''),
         position          = coalesce(k.position,          d.position),
         bats              = coalesce(k.bats,              d.bats),
         throws            = coalesce(k.throws,            d.throws),
         jersey_number     = coalesce(k.jersey_number,     d.jersey_number),
         age               = coalesce(k.age,               d.age),
         hometown          = coalesce(k.hometown,          d.hometown),
         bio               = coalesce(k.bio,               d.bio),
         birth_date        = coalesce(k.birth_date,        d.birth_date),
         birth_date_source = coalesce(k.birth_date_source, d.birth_date_source),
         draft_round       = coalesce(k.draft_round,       d.draft_round),
         draft_pick        = coalesce(k.draft_pick,        d.draft_pick)
    from wpbl_players d
   where k.id = keep and d.id = dupe;

  delete from wpbl_players where id = dupe;
end;
$function$;
