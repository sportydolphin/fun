-- Run this once in your Supabase SQL editor (Dashboard → SQL Editor), AFTER
-- scripts/create_wpbl.sql. Safe to re-run (everything is guarded / create-or-replace).
--
-- WPBL LIVE SCORING (Phase 3) — turns the section into a live scorekeeping app.
-- The owner keeps score at-bat-by-at-bat from a phone; the public watches the score,
-- situation, box score, and play-by-play update in real time.
--
-- Model:
--   * wpbl_games gains a block of live-situation columns (inning/half/outs/count, the
--     three bases as runner player_ids, the per-side lineup pointer, and the current
--     pitcher per side). home_score/away_score double as the live score.
--   * wpbl_plays is the play-by-play log — one row per logged event. It stores both the
--     stat-relevant fields (so the box score can be recomputed from the log) AND a
--     snapshot of the resulting game state (so an "undo" restores the prior state
--     without re-simulating baserunning).
--   * wpbl_batting_lines / wpbl_pitching_lines keep accumulating live: the lineup writes
--     zeroed rows up front (carrying batting_order + position), and each play recomputes
--     the stat columns. sub_out marks a lineup slot's replaced player so the current
--     batter resolves to the active occupant.
--
-- Access mirrors create_wpbl.sql: public read, owner-only write via is_site_owner().

-- ─── Live-situation columns on wpbl_games ─────────────────────────────────────
-- All nullable / defaulted so existing rows are unaffected. A game is "live" purely
-- via status = 'live' (create_wpbl.sql already allows it); these track the situation.
alter table wpbl_games
  add column if not exists live_inning        int  not null default 1,
  add column if not exists live_half          text not null default 'top'
                                              check (live_half in ('top', 'bottom')),
  add column if not exists live_outs          int  not null default 0,
  add column if not exists live_balls         int  not null default 0,
  add column if not exists live_strikes       int  not null default 0,
  add column if not exists runner_first       uuid references wpbl_players (id) on delete set null,
  add column if not exists runner_second      uuid references wpbl_players (id) on delete set null,
  add column if not exists runner_third       uuid references wpbl_players (id) on delete set null,
  add column if not exists away_batting_order int  not null default 1,
  add column if not exists home_batting_order int  not null default 1,
  add column if not exists away_pitcher_id    uuid references wpbl_players (id) on delete set null,
  add column if not exists home_pitcher_id    uuid references wpbl_players (id) on delete set null,
  add column if not exists last_play_at       timestamptz;

-- ─── sub_out flag on batting lines ────────────────────────────────────────────
-- A lineup slot's original occupant is marked sub_out = true when pinch-hit for; the
-- active batter in that slot is the row with sub_out = false. Stats stay attributed to
-- each individual player (plays key on batter_id), so both keep their own box line.
alter table wpbl_batting_lines
  add column if not exists sub_out boolean not null default false;

-- Drop the old (game_id, player_id) uniqueness: a player could (rarely) occupy a slot,
-- be subbed out, and re-enter; and the recompute upserts per player anyway. Keep a plain
-- index for lookups. (Guarded — the constraint name is Postgres's default.)
alter table wpbl_batting_lines  drop constraint if exists wpbl_batting_lines_game_id_player_id_key;
alter table wpbl_pitching_lines drop constraint if exists wpbl_pitching_lines_game_id_player_id_key;
create unique index if not exists wpbl_batting_game_player_idx  on wpbl_batting_lines  (game_id, player_id);
create unique index if not exists wpbl_pitching_game_player_idx on wpbl_pitching_lines (game_id, player_id);

-- ─── Play-by-play log ─────────────────────────────────────────────────────────
-- outcome is the scorer's code (see src/wpbl/live.ts OUTCOMES). rbi/runs/outs_recorded
-- and scored_ids drive the box-score recompute; the *_after columns snapshot the game
-- state this play produced, so undo = delete last play + restore the prior snapshot.
create table if not exists wpbl_plays (
  id              uuid primary key default gen_random_uuid(),
  game_id         uuid not null references wpbl_games (id) on delete cascade,
  seq             int  not null,                 -- 1-based order within the game
  inning          int  not null,
  half            text not null check (half in ('top', 'bottom')),
  batting_team_id text references wpbl_teams (id) on delete set null,
  batter_id       uuid references wpbl_players (id) on delete set null,   -- null for SB/CS
  pitcher_id      uuid references wpbl_players (id) on delete set null,
  runner_id       uuid references wpbl_players (id) on delete set null,   -- SB/CS subject
  outcome         text not null,
  rbi             int  not null default 0,
  runs            int  not null default 0,
  outs_recorded   int  not null default 0,
  scored_ids      uuid[] not null default '{}',  -- players who crossed the plate
  description     text not null default '',       -- human-readable feed line
  -- Resulting-state snapshot (for undo + robustness):
  away_score_after int not null default 0,
  home_score_after int not null default 0,
  inning_after     int not null default 1,
  half_after       text not null default 'top',
  outs_after       int not null default 0,
  runner_first_after  uuid,
  runner_second_after uuid,
  runner_third_after  uuid,
  away_order_after int not null default 1,
  home_order_after int not null default 1,
  created_at      timestamptz not null default now()
);
create index if not exists wpbl_plays_game_idx on wpbl_plays (game_id, seq);

-- ─── RLS: public read, owner-only write ───────────────────────────────────────
alter table wpbl_plays enable row level security;
do $$ begin
  create policy "WPBL plays are public" on wpbl_plays for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Owner writes WPBL plays" on wpbl_plays for all
    using (public.is_site_owner()) with check (public.is_site_owner());
exception when duplicate_object then null; end $$;

-- ─── Realtime ─────────────────────────────────────────────────────────────────
-- Add the live tables to Supabase's realtime publication so viewers get pushed
-- updates. The client also polls as a fallback, so this is an enhancement, not a
-- requirement. Guarded: adding a table already in the publication raises.
do $$
declare t text;
begin
  foreach t in array array['wpbl_games', 'wpbl_plays', 'wpbl_batting_lines', 'wpbl_pitching_lines']
  loop
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null;
             when undefined_object then null;  -- publication doesn't exist on this project
    end;
  end loop;
end $$;
