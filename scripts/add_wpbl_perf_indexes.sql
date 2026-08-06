-- WPBL performance indexes (run once in the Supabase SQL editor).
--
-- Context: the WPBL section's slow loads were mostly the home page's unfiltered
-- `select *` reads (whole pitch_tracking table, all lines, all plays) plus an
-- overloaded instance — neither of which an index fixes (an unfiltered scan reads
-- every row; a saturated CPU queues everything). The real lever there is compute
-- (see the upsize steps), not indexes.
--
-- The filtered access paths are ALREADY indexed:
--   wpbl_batting_lines / wpbl_pitching_lines : (game_id), (player_id), unique(game_id, player_id)
--   wpbl_game_plays                          : unique(game_id, sequence)
--   wpbl_pitch_tracking                      : (game_id), pk(activity_id)
--   wpbl_players                             : (team_id), unique(team_id, name)
--   wpbl_games                               : (game_date desc), unique(api_game_id)
--   wpbl_ingest_runs                         : (ran_at desc)
--
-- The one worthwhile addition: the Game Center's per-game tracking read is
--   ... where game_id = $1 order by occurred_at
-- which uses the (game_id) index but then sorts by occurred_at. A composite lets it
-- read in order and skip the sort. Marginal today, better as tracking grows.

create index if not exists wpbl_pitch_tracking_game_occurred_idx
  on wpbl_pitch_tracking (game_id, occurred_at);

-- Refresh planner stats so it picks the new index right away.
analyze wpbl_pitch_tracking;

-- ── Verify (optional) ─────────────────────────────────────────────────────────
-- List every index on the WPBL tables:
--   select tablename, indexname, indexdef
--   from pg_indexes
--   where tablename like 'wpbl_%'
--   order by tablename, indexname;
--
-- Row counts (to see which tables the unfiltered home reads actually scan):
--   select relname, n_live_tup
--   from pg_stat_user_tables
--   where relname like 'wpbl_%'
--   order by n_live_tup desc;
