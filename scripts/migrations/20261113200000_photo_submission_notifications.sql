-- photo submission notifications
-- Created 2026-11-13. Applied by scripts/migrate.mjs.
--
-- The last part of docs/FAN_UPLOADS.md: the owner hears when a fan submits, and the fan hears when
-- the owner decides. scripts/notify-photo-submissions.mjs sends the pushes; this file records who
-- has been told and wakes that job.
--
-- WHY A WORKFLOW AND NOT AN EDGE FUNCTION. Postgres cannot sign a Web Push, so something outside it
-- must send. The repo already wakes GitHub workflows from the database (wpbl_dispatch_workflow, the
-- same token and gate the shop, game-start and health nudges use), and a workflow ships with a
-- merge where an edge function needs a hand deploy. A push lands within a minute or two.

alter table public.wpbl_photo_submissions
  add column if not exists owner_notified_at timestamptz,
  add column if not exists fan_notified_at   timestamptz;

-- Wake the sender on a new submission and on a decision. Definer, because the owner may change a
-- row directly through the update policy, as `authenticated`, and that role cannot read the Vault
-- token. A failure is a warning, never an error: a missed push must not undo a fan's upload or the
-- owner's decision, and the sweep below retries.
create or replace function public.wpbl_photo_submission_nudge()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  begin
    -- One minute between wakes, so ten photos sent together wake the job once; the job reads every
    -- row nobody has been told about, so nothing in the burst is lost.
    perform public.wpbl_dispatch_workflow('photo-submissions', '', interval '1 minute');
  exception when others then
    raise warning 'wpbl_photo_submission_nudge: %', sqlerrm;
  end;
  return null;
end;
$fn$;
revoke all on function public.wpbl_photo_submission_nudge() from public, anon, authenticated;

drop trigger if exists wpbl_photo_submission_nudge on public.wpbl_photo_submissions;
create trigger wpbl_photo_submission_nudge
  after insert or update of status on public.wpbl_photo_submissions
  for each row execute function public.wpbl_photo_submission_nudge();

-- The net under the one-minute gate: a photo sent seconds after a wake finds the gate shut, and
-- would otherwise wait for the next submission to be noticed. Every ten minutes, if anyone is
-- still owed a notice, wake the job again. Reads two partial indexes, so an idle queue costs
-- nothing.
create index if not exists wpbl_photo_submissions_owner_unnotified
  on public.wpbl_photo_submissions (created_at) where status = 'pending' and owner_notified_at is null;
create index if not exists wpbl_photo_submissions_fan_unnotified
  on public.wpbl_photo_submissions (decided_at) where status in ('approved', 'rejected') and fan_notified_at is null;

create or replace function public.wpbl_photo_submission_sweep()
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if not exists (select 1 from public.wpbl_photo_submissions where status = 'pending' and owner_notified_at is null)
     and not exists (select 1 from public.wpbl_photo_submissions
                      where status in ('approved', 'rejected') and fan_notified_at is null
                        and decided_at > now() - interval '7 days')
  then return false; end if;
  return public.wpbl_dispatch_workflow('photo-submissions', '', interval '9 minutes');
end;
$fn$;
revoke all on function public.wpbl_photo_submission_sweep() from public, anon, authenticated;

select cron.schedule('photo-submissions-sweep', '*/10 * * * *', $$ select public.wpbl_photo_submission_sweep(); $$);
