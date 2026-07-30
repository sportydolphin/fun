-- Run this once in your Supabase SQL editor, on an existing WPBL install (created
-- before these columns existed). Fresh installs get them baked into create_wpbl.sql.
--
-- Enriches wpbl_players with the fields the league's roster/draft data provides:
-- age, hometown, signing status, and draft round/pick. All nullable and idempotent.
-- (jersey_number stays but is unused for now — the draft data carries no jerseys.)

alter table wpbl_players add column if not exists age         int;
alter table wpbl_players add column if not exists hometown    text;
alter table wpbl_players add column if not exists status      text;   -- 'Signed' | 'Drafted'
alter table wpbl_players add column if not exists draft_round int;
alter table wpbl_players add column if not exists draft_pick  int;

-- Natural-key unique index so roster seeds (scripts/seed_wpbl_rosters.sql) can use
-- `on conflict (team_id, name) do nothing` and stay safely re-runnable.
create unique index if not exists wpbl_players_team_name_idx on wpbl_players (team_id, name);
