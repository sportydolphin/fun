-- photo tagging open by default
-- Created 2026-10-21. Applied by scripts/migrate.mjs.
--
-- The owner's call (Oct 21, 2026): every photo in review is open to public tagging, now and on
-- upload, and tagging is shared. The owner's tags and the crowd's suggestions work the same photos
-- until the owner publishes one. 20261020200000 made opening a separate deliberate step and took a
-- photo out of the queue at its first tag; both are reversed here. What is unchanged: a suggestion
-- is still never a tag, a report still pulls a photo at once, and the owner can still close any one
-- photo from /admin (open_for_tagging stays the per-photo switch).
--
-- WHY THE DEFAULT RATHER THAN THE UPLOADERS: rows arrive from two places (the /admin uploader and
-- scripts/ingest-fan-photos.mjs), and a column default covers both and any third without either
-- having to remember.

alter table public.wpbl_fan_photos alter column open_for_tagging set default true;

update public.wpbl_fan_photos set open_for_tagging = true
 where not approved and not open_for_tagging;

-- ─── The queue ────────────────────────────────────────────────────────────────
-- Now "in review" (not approved) rather than "unnamed": a photo the owner has tagged stays in, with
-- its tags handed out (`tagged`) so the page shows who is already named and offers only the rest.
-- Unnamed photos come first, then the fewest suggesters. The return type changes, hence the drop.
drop function if exists public.wpbl_photos_to_tag(text, int, uuid[]);
create function public.wpbl_photos_to_tag(p_key text, p_limit int default 10, p_skip uuid[] default '{}')
returns table (
  id uuid, card_url text, full_url text, width int, height int, credit text,
  open_count int, named_count int, tagged jsonb
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
         count(*) filter (where exists (select 1 from public.wpbl_photo_subjects s where s.photo_id = p.id))::int
    into v_open, v_named
    from public.wpbl_fan_photos p
   where p.open_for_tagging and not p.approved and p.category_key is null;

  return query
  select p.id, p.card_url, p.full_url, p.width, p.height, p.credit, v_open, v_named,
         coalesce((select jsonb_agg(case when s.player_id is not null then jsonb_build_object('player', s.player_id)
                                         when s.team_id is not null then jsonb_build_object('team', s.team_id)
                                         else jsonb_build_object('figure', s.figure_key) end)
                     from public.wpbl_photo_subjects s where s.photo_id = p.id), '[]'::jsonb)
    from public.wpbl_fan_photos p
   where p.open_for_tagging
     and not p.approved
     and p.category_key is null
     and not exists (select 1 from public.wpbl_photo_reports r where r.photo_id = p.id and r.resolved_at is null)
     and not exists (select 1 from public.wpbl_photo_tag_suggestions g where g.photo_id = p.id and g.suggester_key = p_key)
     and not exists (select 1 from public.wpbl_photo_reports r where r.photo_id = p.id and r.suggester_key = p_key)
     and not (p.id = any (coalesce(p_skip, '{}')))
   order by exists (select 1 from public.wpbl_photo_subjects s where s.photo_id = p.id),
            (select count(distinct coalesce(g.ip_hash, g.suggester_key))
               from public.wpbl_photo_tag_suggestions g where g.photo_id = p.id and g.status <> 'rejected'),
            random()
   limit p_limit;
end;
$fn$;

-- ─── Suggesting ───────────────────────────────────────────────────────────────
-- A full replace of 20261020200000's function with two changes: "still in the queue" is now "in
-- review" rather than "unnamed", and a subject the photo is already tagged with is dropped rather
-- than queued for the owner to accept a second time.
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

  -- Still in the queue: open, in review, unreported.
  if not exists (
    select 1 from public.wpbl_fan_photos p
     where p.id = p_photo and p.open_for_tagging and p.category_key is null
       and not p.approved
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
    select p_photo, v_player, v_item ->> 'figure', v_item ->> 'team', p_key, v_ip, auth.uid()
     where not exists (select 1 from public.wpbl_photo_subjects s
                        where s.photo_id = p_photo
                          and s.player_id is not distinct from v_player
                          and s.figure_key is not distinct from (v_item ->> 'figure')
                          and s.team_id is not distinct from (v_item ->> 'team'))
    on conflict do nothing;
  end loop;
  return 'ok';
end;
$fn$;

revoke all on function public.wpbl_photos_to_tag(text, int, uuid[]) from public;
grant execute on function public.wpbl_photos_to_tag(text, int, uuid[]) to anon, authenticated;
