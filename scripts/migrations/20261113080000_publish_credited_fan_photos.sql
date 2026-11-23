-- publish credited fan photos
-- Created 2026-11-12. Applied by scripts/migrate.mjs.
--
-- The owner's call (Nov 12, 2026): a photo with a photographer on it is public in the gallery from
-- the moment it is uploaded, and tagging (the owner's in /admin, the public's on /wpbl/photos/tag)
-- happens on published photos rather than before them. 20261021000000 made the tag queue "in review"
-- (not approved), which kept 116 credited photos out of the gallery while they waited for names
-- nobody was supplying. Both halves are reversed here.
--
-- What does NOT change: `approved` is still the one gate the gallery reads (RLS `approved or owner`),
-- so the owner can still unpublish any photo, and withdrawing a photographer still unpublishes every
-- photo of theirs (updateFanPhotoContributor). The tag queue now requires `approved`, so a photo the
-- owner pulled, or a withdrawn photographer's, leaves the queue too: the queue never shows an image
-- the gallery would not.

-- ─── Publish what is credited ─────────────────────────────────────────────────
-- "Has a photographer" = a contributor on file who has not withdrawn, and a credit to print on the
-- card (FAN_PHOTOS.md: the credit is on every card, so a photo without one cannot be shown).
update public.wpbl_fan_photos p
   set approved = true, updated_at = now()
 where not p.approved
   and nullif(btrim(p.credit), '') is not null
   and exists (select 1 from public.wpbl_photo_contributors c
                where c.id = p.contributor_id and c.withdrawn_on is null);

-- Every photo is open to tagging; the per-photo switch in /admin still closes one.
update public.wpbl_fan_photos set open_for_tagging = true where not open_for_tagging;

-- ─── And on upload ────────────────────────────────────────────────────────────
-- A trigger rather than the two uploaders: rows arrive from the /admin uploader and from
-- scripts/ingest-fan-photos.mjs (both leave approved to its false default), and a trigger covers both
-- and any third. INSERT only: an update must never re-publish a photo the owner or a withdrawal took
-- down. Definer because it reads wpbl_photo_contributors, which is owner-only.
create or replace function public.wpbl_fan_photo_publish_credited()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if nullif(btrim(new.credit), '') is not null
     and exists (select 1 from public.wpbl_photo_contributors c
                  where c.id = new.contributor_id and c.withdrawn_on is null) then
    new.approved := true;
  end if;
  return new;
end;
$fn$;
revoke all on function public.wpbl_fan_photo_publish_credited() from public, anon, authenticated;

drop trigger if exists wpbl_fan_photo_publish_credited on public.wpbl_fan_photos;
create trigger wpbl_fan_photo_publish_credited
  before insert on public.wpbl_fan_photos
  for each row execute function public.wpbl_fan_photo_publish_credited();

-- ─── The queue: published, not "in review" ────────────────────────────────────
-- 20261021000000's function with `not p.approved` turned into `p.approved`, in the count and the
-- rows alike. Same signature and return type, so create or replace keeps the grants.
create or replace function public.wpbl_photos_to_tag(p_key text, p_limit int default 10, p_skip uuid[] default '{}')
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
   where p.open_for_tagging and p.approved and p.category_key is null;

  return query
  select p.id, p.card_url, p.full_url, p.width, p.height, p.credit, v_open, v_named,
         coalesce((select jsonb_agg(case when s.player_id is not null then jsonb_build_object('player', s.player_id)
                                         when s.team_id is not null then jsonb_build_object('team', s.team_id)
                                         else jsonb_build_object('figure', s.figure_key) end)
                     from public.wpbl_photo_subjects s where s.photo_id = p.id), '[]'::jsonb)
    from public.wpbl_fan_photos p
   where p.open_for_tagging
     and p.approved
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

-- ─── Suggesting: the same change to "still in the queue" ──────────────────────
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

  -- Still in the queue: open, published, unreported.
  if not exists (
    select 1 from public.wpbl_fan_photos p
     where p.id = p_photo and p.open_for_tagging and p.category_key is null
       and p.approved
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
