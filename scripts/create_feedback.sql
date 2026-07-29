-- Run this once in your Supabase SQL editor (Dashboard → SQL Editor)
--
-- User feedback: a short message anyone can send from the site footer. Signed-in
-- or anonymous, with an optional email for a reply. Read them in the Supabase
-- dashboard (Table editor → feedback), newest first.
--
-- Writes are open to everyone (anon + authenticated) so a visitor doesn't have to
-- make an account to send a note. Reads are closed to clients: RLS with only an
-- insert policy denies every select by default, so the messages are visible only
-- through the service role / dashboard.

create table if not exists feedback (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id    uuid,               -- null for anonymous senders
  email      text,               -- optional reply-to the sender typed in
  message    text not null,
  path       text,               -- route/view the sender was on (e.g. /mlb?view=home)
  user_agent text                -- browser UA string, for reproducing layout bugs
);

-- Owner reads newest-first in the dashboard.
create index if not exists feedback_created_idx on feedback (created_at desc);

alter table feedback enable row level security;

-- Anyone may submit (no user check) — this is a public "leave a note" box.
create policy "Anyone can submit feedback"
  on feedback for insert
  with check (true);

-- No select/update/delete policy on purpose: with RLS enabled and no permissive
-- read policy, client reads are denied. Only the service role (dashboard) sees rows.
