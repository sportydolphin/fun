-- photo reject without notifying
-- Created 2026-11-14. Applied by scripts/migrate.mjs.
--
-- The owner can reject a fan's photo without telling them: a duplicate, or a photo that is fine
-- but not needed, is not worth a push saying "declined". The fan still sees the decision on their
-- own submissions list; only the bell line and the push are held back.
--
-- fan_notify is read by the bell (photoDecidedSource). The push job reads fan_notified_at, which a
-- quiet rejection sets at once, so scripts/notify-photo-submissions.mjs needs no change and an old
-- copy of it running mid-deploy cannot push a quiet rejection either.

alter table public.wpbl_photo_submissions
  add column if not exists fan_notify boolean not null default true;

-- Dropped rather than replaced: a third parameter with a default beside the two-argument version
-- would make every two-argument call ambiguous. The drop loses the old grants, so they are restated.
drop function if exists public.wpbl_reject_photo_submission(uuid, text);

create or replace function public.wpbl_reject_photo_submission(p_id uuid, p_reason text, p_notify boolean default true)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  if not public.is_site_owner() then raise exception 'not the owner'; end if;
  update public.wpbl_photo_submissions
     set status = 'rejected', reject_reason = nullif(left(btrim(p_reason), 300), ''), decided_at = now(),
         fan_notify = coalesce(p_notify, true),
         fan_notified_at = case when coalesce(p_notify, true) then fan_notified_at else now() end
   where id = p_id and status = 'pending';
end;
$fn$;

revoke all on function public.wpbl_reject_photo_submission(uuid, text, boolean) from public, anon;
grant execute on function public.wpbl_reject_photo_submission(uuid, text, boolean) to authenticated;
