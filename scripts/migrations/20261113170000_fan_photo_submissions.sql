-- fan photo submissions
-- Created 2026-11-13. Applied by scripts/migrate.mjs.
--
-- Phase 2 of docs/FAN_UPLOADS.md: a signed-in fan submits photos, they wait in a private bucket,
-- and the owner approves or rejects each one. This is the database half; the bytes go through
-- functions/api/fan-submission.ts.
--
-- WRITE PATH. The browser writes its own rows through definer functions on the caller's own JWT
-- (the first of the three paths in scripts/migrations/CLAUDE.md, the footing of the award votes
-- and the tag suggestions). The endpoint calls them with the fan's token, never a service key, so
-- this adds no fourth path. Nobody but the owner can write the table directly.
--
-- A ROW CAN EXIST WITHOUT ITS BYTES. wpbl_submit_photo is callable by any signed-in account, so a
-- caller skipping the endpoint can file a row with nothing uploaded behind it. The cost is a
-- broken thumbnail in the owner's queue, capped by the same daily limit, so it is not worth a
-- second round trip to close.

-- ─── The terms a fan agrees to, by version ────────────────────────────────────
-- The exact wording is stored, not just a number in code, so the permission a contributor record
-- points at can be produced later word for word. A new wording is a new row; old rows never change.
create table if not exists public.wpbl_photo_upload_terms (
  version    int         primary key,
  body       text        not null,
  created_at timestamptz not null default now()
);
insert into public.wpbl_photo_upload_terms (version, body) values (1,
  'I took these photos. I give sportydolphin.fun permission to show them on its website, credited '
  || 'to the name I entered. This permission is for the website only: not social media, not print. '
  || 'I can remove any of my photos at any time. I am at least 13 years old.')
on conflict (version) do nothing;

-- ─── Submissions ──────────────────────────────────────────────────────────────
create table if not exists public.wpbl_photo_submissions (
  id             uuid        primary key default gen_random_uuid(),
  user_id        uuid        not null references auth.users (id) on delete cascade,
  -- Of the ORIGINAL bytes, as the owner's uploader and the ingest hash it, so a photo already in
  -- the library, or already waiting, is refused as a duplicate.
  sha256         text        not null check (sha256 ~ '^[0-9a-f]{64}$'),
  -- The key prefix in the PRIVATE bucket (R2_SUBMISSIONS_BUCKET): `sub/<sha256>`.
  storage_path   text        not null,
  width          int         check (width between 1 and 10000),
  height         int         check (height between 1 and 10000),
  credit_name    text        not null check (char_length(btrim(credit_name)) between 1 and 60),
  -- A note to the owner, never rendered as markup and never published as it stands.
  note           text        check (char_length(note) <= 500),
  -- Who the fan says is in it: the same [{player|figure|team: id}] shape the tag suggester takes.
  -- Becomes suggestions on approval, never tags.
  subjects       jsonb       not null default '[]'::jsonb check (jsonb_typeof(subjects) = 'array'),
  terms_version  int         not null references public.wpbl_photo_upload_terms (version),
  status         text        not null default 'pending'
                 check (status in ('pending', 'approved', 'rejected', 'removed')),
  reject_reason  text        check (char_length(reject_reason) <= 300),
  photo_id       uuid        references public.wpbl_fan_photos (id) on delete set null,
  created_at     timestamptz not null default now(),
  decided_at     timestamptz
);
create index if not exists wpbl_photo_submissions_user_idx on public.wpbl_photo_submissions (user_id, created_at desc);
create index if not exists wpbl_photo_submissions_status_idx on public.wpbl_photo_submissions (status, created_at);
-- One live copy of a photo: a second fan sending the same file while the first waits is a duplicate.
create unique index if not exists wpbl_photo_submissions_pending_sha
  on public.wpbl_photo_submissions (sha256) where status = 'pending';

-- Blocks, by account. The owner adds and removes them from /admin through the owner policy.
create table if not exists public.wpbl_photo_upload_blocks (
  user_id    uuid        primary key references auth.users (id) on delete cascade,
  note       text,
  created_at timestamptz not null default now()
);

-- A fan's contributor record, made on their first approval and reused after. Unique, so two
-- approvals racing cannot make two records for one person.
alter table public.wpbl_photo_contributors
  add column if not exists user_id uuid unique references auth.users (id) on delete set null;

alter table public.wpbl_photo_upload_terms  enable row level security;
alter table public.wpbl_photo_submissions   enable row level security;
alter table public.wpbl_photo_upload_blocks enable row level security;

-- The wording is public: the submit page shows the current version.
drop policy if exists "Upload terms are public" on public.wpbl_photo_upload_terms;
create policy "Upload terms are public" on public.wpbl_photo_upload_terms for select using (true);

-- A fan reads their own rows ("Your submissions"); the owner reads all. No insert, update or
-- delete policy for anyone but the owner: every other write is a function below.
drop policy if exists "Submissions: own rows and the owner" on public.wpbl_photo_submissions;
create policy "Submissions: own rows and the owner" on public.wpbl_photo_submissions
  for select using (user_id = (select auth.uid()) or (select public.is_site_owner()));
drop policy if exists "Owner writes submissions (update)" on public.wpbl_photo_submissions;
create policy "Owner writes submissions (update)" on public.wpbl_photo_submissions
  for update using ((select public.is_site_owner()));
drop policy if exists "Owner writes submissions (delete)" on public.wpbl_photo_submissions;
create policy "Owner writes submissions (delete)" on public.wpbl_photo_submissions
  for delete using ((select public.is_site_owner()));

drop policy if exists "Owner manages upload blocks" on public.wpbl_photo_upload_blocks;
create policy "Owner manages upload blocks" on public.wpbl_photo_upload_blocks
  for all using ((select public.is_site_owner())) with check ((select public.is_site_owner()));

-- ─── Helpers (not callable from the browser) ──────────────────────────────────

-- The tag suggester's subject rules, as a predicate: at most ten, each one key, each real.
create or replace function public.wpbl_photo_subjects_valid(p_subjects jsonb)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_item jsonb;
begin
  if p_subjects is null or jsonb_typeof(p_subjects) <> 'array' or jsonb_array_length(p_subjects) > 10 then return false; end if;
  for v_item in select * from jsonb_array_elements(p_subjects) loop
    if jsonb_typeof(v_item) <> 'object' or (select count(*) from jsonb_object_keys(v_item)) <> 1 then return false; end if;
    if v_item ? 'player' then
      if jsonb_typeof(v_item -> 'player') <> 'string'
         or (v_item ->> 'player') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         or not exists (select 1 from public.wpbl_players where id = (v_item ->> 'player')::uuid) then return false; end if;
    elsif v_item ? 'figure' then
      if jsonb_typeof(v_item -> 'figure') <> 'string'
         or not exists (select 1 from public.wpbl_photo_figures where key = v_item ->> 'figure') then return false; end if;
    elsif v_item ? 'team' then
      if jsonb_typeof(v_item -> 'team') <> 'string'
         or not exists (select 1 from public.wpbl_teams where id = v_item ->> 'team') then return false; end if;
    else
      return false;
    end if;
  end loop;
  return true;
end;
$fn$;
revoke all on function public.wpbl_photo_subjects_valid(jsonb) from public, anon, authenticated;

-- Limits (docs/FAN_UPLOADS.md decision 7): 20 a day per account, 300 a day across the site.
-- Removed and rejected rows still count: they were uploads.
create or replace function public.wpbl_photo_submission_gate(p_user uuid, p_sha text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if p_user is null then return 'signin'; end if;
  if p_sha is null or p_sha !~ '^[0-9a-f]{64}$' then return 'invalid'; end if;
  if exists (select 1 from public.wpbl_photo_upload_blocks where user_id = p_user) then return 'blocked'; end if;
  if exists (select 1 from public.wpbl_fan_photos where sha256 = p_sha)
     or exists (select 1 from public.wpbl_photo_submissions where sha256 = p_sha and status = 'pending')
  then return 'duplicate'; end if;
  if (select count(*) from public.wpbl_photo_submissions
       where user_id = p_user and created_at > now() - interval '1 day') >= 20 then return 'limited'; end if;
  if (select count(*) from public.wpbl_photo_submissions
       where created_at > now() - interval '1 day') >= 300 then return 'limited'; end if;
  return 'ok';
end;
$fn$;
revoke all on function public.wpbl_photo_submission_gate(uuid, text) from public, anon, authenticated;

-- ─── The fan's calls ──────────────────────────────────────────────────────────

-- Asked by the endpoint BEFORE it stores any bytes. 'blocked' reaches the endpoint, which then
-- reports success without uploading; a blocked account calling this directly learns it is blocked,
-- which an account (unlike a tagging browser key) cannot cheaply rotate past.
create or replace function public.wpbl_check_photo_submission(p_sha text)
returns text
language sql
stable
security definer
set search_path = ''
as $fn$ select public.wpbl_photo_submission_gate(auth.uid(), p_sha) $fn$;

-- Filed after the bytes are in the private bucket. Every check runs again, since a direct caller
-- may never have asked. Returns 'ok', 'signin', 'invalid', 'duplicate' or 'limited'; a blocked
-- caller gets 'ok' and nothing is stored.
create or replace function public.wpbl_submit_photo(
  p_sha text, p_width int, p_height int, p_credit text, p_note text, p_subjects jsonb, p_terms_version int
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_gate text := public.wpbl_photo_submission_gate(v_user, p_sha);
begin
  if v_gate = 'blocked' then return 'ok'; end if;
  if v_gate <> 'ok' then return v_gate; end if;
  if p_credit is null or char_length(btrim(p_credit)) not between 1 and 60 then return 'invalid'; end if;
  if p_note is not null and char_length(p_note) > 500 then return 'invalid'; end if;
  if not public.wpbl_photo_subjects_valid(coalesce(p_subjects, '[]'::jsonb)) then return 'invalid'; end if;
  if not exists (select 1 from public.wpbl_photo_upload_terms where version = p_terms_version) then return 'invalid'; end if;
  if p_width is not null and p_width not between 1 and 10000 then return 'invalid'; end if;
  if p_height is not null and p_height not between 1 and 10000 then return 'invalid'; end if;

  insert into public.wpbl_photo_submissions
    (user_id, sha256, storage_path, width, height, credit_name, note, subjects, terms_version)
  values (v_user, p_sha, 'sub/' || p_sha, p_width, p_height, btrim(p_credit), nullif(btrim(p_note), ''),
          coalesce(p_subjects, '[]'::jsonb), p_terms_version)
  on conflict do nothing;
  return 'ok';
end;
$fn$;

-- The fan takes a photo down. Waiting: it leaves the queue (the bytes expire with the bucket's
-- 30-day rule). Published: it is unpublished, the same act as a withdrawal, and stays that way.
create or replace function public.wpbl_remove_my_photo_submission(p_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_row public.wpbl_photo_submissions%rowtype;
begin
  select * into v_row from public.wpbl_photo_submissions where id = p_id and user_id = auth.uid();
  if not found then return 'invalid'; end if;
  if v_row.status in ('removed', 'rejected') then return 'ok'; end if;
  if v_row.status = 'approved' and v_row.photo_id is not null then
    update public.wpbl_fan_photos set approved = false, open_for_tagging = false, updated_at = now()
     where id = v_row.photo_id;
  end if;
  update public.wpbl_photo_submissions set status = 'removed', decided_at = now() where id = p_id;
  return 'ok';
end;
$fn$;

-- ─── The owner's calls ────────────────────────────────────────────────────────

-- Called after the owner's browser has re-rendered the photo and put it in the PUBLIC bucket
-- through /api/fan-photo (docs/FAN_UPLOADS.md decision 3). Makes the fan's contributor record on
-- their first approval, the photo row (which the publish trigger publishes, since it now has a
-- photographer), and the fan's picks as suggestions keyed 'upload:<submission id>'.
create or replace function public.wpbl_approve_photo_submission(
  p_id uuid, p_storage_path text, p_card_url text, p_full_url text, p_width int, p_height int
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_sub     public.wpbl_photo_submissions%rowtype;
  v_contrib public.wpbl_photo_contributors%rowtype;
  v_photo   uuid;
  v_item    jsonb;
begin
  if not public.is_site_owner() then raise exception 'not the owner'; end if;
  select * into v_sub from public.wpbl_photo_submissions where id = p_id for update;
  if not found then raise exception 'no such submission'; end if;
  if v_sub.status <> 'pending' then raise exception 'submission is %', v_sub.status; end if;

  select * into v_contrib from public.wpbl_photo_contributors where user_id = v_sub.user_id;
  if not found then
    insert into public.wpbl_photo_contributors
      (display_name, permission_granted_on, permission_evidence, permission_scope, user_id)
    values (v_sub.credit_name, v_sub.created_at::date,
            format('Uploaded by account %s under upload terms v%s at %s', v_sub.user_id, v_sub.terms_version, v_sub.created_at),
            'site display', v_sub.user_id)
    returning * into v_contrib;
  elsif v_contrib.withdrawn_on is not null then
    raise exception 'this photographer has withdrawn';
  end if;

  insert into public.wpbl_fan_photos (sha256, storage_path, card_url, full_url, width, height, credit, contributor_id)
  values (v_sub.sha256, p_storage_path, p_card_url, p_full_url, p_width, p_height, v_contrib.display_name, v_contrib.id)
  returning id into v_photo;

  -- A pick is re-checked here rather than trusted from submission time: the picks are ids inside
  -- jsonb, which wpbl_merge_players cannot see, so a player merged away while the photo waited
  -- would fail the foreign key and the whole approval with it. A pick that no longer exists is
  -- dropped; the owner tags the photo anyway.
  for v_item in select * from jsonb_array_elements(v_sub.subjects) loop
    if not public.wpbl_photo_subjects_valid(jsonb_build_array(v_item)) then continue; end if;
    insert into public.wpbl_photo_tag_suggestions (photo_id, player_id, figure_key, team_id, suggester_key, user_id)
    values (v_photo,
            case when v_item ? 'player' then (v_item ->> 'player')::uuid end,
            v_item ->> 'figure', v_item ->> 'team',
            'upload:' || v_sub.id, v_sub.user_id)
    on conflict do nothing;
  end loop;

  update public.wpbl_photo_submissions
     set status = 'approved', photo_id = v_photo, decided_at = now()
   where id = p_id;
  return v_photo;
end;
$fn$;

create or replace function public.wpbl_reject_photo_submission(p_id uuid, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  if not public.is_site_owner() then raise exception 'not the owner'; end if;
  update public.wpbl_photo_submissions
     set status = 'rejected', reject_reason = nullif(left(btrim(p_reason), 300), ''), decided_at = now()
   where id = p_id and status = 'pending';
end;
$fn$;

-- Blocks the account and rejects everything it has waiting, so the queue clears in one action.
create or replace function public.wpbl_block_photo_uploader(p_user uuid, p_note text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  if not public.is_site_owner() then raise exception 'not the owner'; end if;
  insert into public.wpbl_photo_upload_blocks (user_id, note) values (p_user, p_note)
  on conflict (user_id) do update set note = excluded.note;
  update public.wpbl_photo_submissions
     set status = 'rejected', reject_reason = 'Blocked', decided_at = now()
   where user_id = p_user and status = 'pending';
end;
$fn$;

-- Signed-in callers only: anon has no account to file under. The owner's three check the owner
-- themselves; they are granted to authenticated because the owner is one.
revoke all on function public.wpbl_check_photo_submission(text) from public, anon;
revoke all on function public.wpbl_submit_photo(text, int, int, text, text, jsonb, int) from public, anon;
revoke all on function public.wpbl_remove_my_photo_submission(uuid) from public, anon;
revoke all on function public.wpbl_approve_photo_submission(uuid, text, text, text, int, int) from public, anon;
revoke all on function public.wpbl_reject_photo_submission(uuid, text) from public, anon;
revoke all on function public.wpbl_block_photo_uploader(uuid, text) from public, anon;
grant execute on function public.wpbl_check_photo_submission(text) to authenticated;
grant execute on function public.wpbl_submit_photo(text, int, int, text, text, jsonb, int) to authenticated;
grant execute on function public.wpbl_remove_my_photo_submission(uuid) to authenticated;
grant execute on function public.wpbl_approve_photo_submission(uuid, text, text, text, int, int) to authenticated;
grant execute on function public.wpbl_reject_photo_submission(uuid, text) to authenticated;
grant execute on function public.wpbl_block_photo_uploader(uuid, text) to authenticated;
