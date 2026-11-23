-- instagram watch every five minutes during the window
-- Created 2026-11-19. Applied by scripts/migrate.mjs.
--
-- Readers were relying on the re-signing pushes by Nov 19, 2026, and fifteen minutes behind a
-- club's post was too slow. pg_cron now ticks every five minutes; the gate inside the nudge
-- lets a dispatch through every four minutes until the window closes (Nov 20, 11:59pm ET, the
-- same instant as RESIGN_WINDOW.closes in src/wpbl/offseason2027.ts), then goes back to
-- fourteen by itself, so a run every fifteen minutes resumes with nobody remembering to undo
-- this. `create or replace` keeps the revokes from the original migration.

create or replace function public.wpbl_nudge_instagram_watch()
returns boolean
language sql
set search_path = public
as $$
  select public.wpbl_dispatch_workflow(
    'wpbl-instagram-watch', '',
    case when now() <= timestamptz '2026-11-21 04:59:59+00' then interval '4 minutes' else interval '14 minutes' end
  )
$$;

-- cron.schedule replaces a job of the same name.
select cron.schedule('wpbl-instagram-watch-nudge', '*/5 * * * *', $$ select public.wpbl_nudge_instagram_watch(); $$);
