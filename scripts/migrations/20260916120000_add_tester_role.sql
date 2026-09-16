-- add tester role
-- Created 2026-09-16. Applied by scripts/migrate.mjs.

-- A third grantable role beside collaborator and moderator, for readers who get in-progress
-- features before they ship. Same model as the other two: cosmetic, read by the client to
-- decide what to draw (useIsTester), granting NOTHING on its own. Anything a tester UI can
-- write is still callable by anyone, and any real gate stays server-side on is_site_owner().
--
-- The CHECK is the only thing that would reject the new name, so it is the only thing to
-- change: SITE_ROLES in src/lib/adminUsers.ts mirrors this list, and admin_set_user_role
-- validates through it.
alter table public.user_roles drop constraint if exists user_roles_known;
alter table public.user_roles add constraint user_roles_known
  check (role in ('collaborator', 'moderator', 'tester'));
