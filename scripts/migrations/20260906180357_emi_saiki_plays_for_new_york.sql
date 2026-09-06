-- emi saiki plays for new york
-- Created 2026-09-06. Applied by scripts/migrate.mjs.
--
-- Emi Saiki's roster row said Los Angeles. She has never played a game for Los Angeles: all
-- six of her batting lines and both of her pitching lines say New York, and on Sep 4 she threw
-- six innings and took the win in the Heights' 14-2 over San Francisco.
--
-- She was not traded. She was FLAPPING. wpbl_player_team_changes holds eleven moves for her,
-- in pairs, one club each way per game:
--
--   Sep 3, NY at LA   feed-id    LA -> NY     and   name-match  NY -> LA
--   Sep 4, SF at NY   feed-id    LA -> NY
--   Sep 5, LA at BOS  name-match NY -> LA     <- where she was left
--
-- The `feed-id` half is her, resolved by the id the league gave her, out of a New York box
-- score. The `name-match` half is an entry named "Emi Saiki" in a LOS ANGELES box score that
-- the feed gave NO id to, which `tradeMatch` read as a trade because the name is spelled
-- exactly and belongs to nobody else in the league. Whichever the ingest loop happened to read
-- last won the day, and on Sep 5 that was Los Angeles, off a game New York was not even in.
--
-- What it cost, and why this is worth a migration rather than a shrug: a box-score line carries
-- a player_id and nothing else, so Game Center resolved names against the two clubs' rosters,
-- and she was on neither. The winning pitcher of that Sep 4 game rendered as "—" on the
-- decision line, as a Star of the Game under a blank portrait, and in the pitching table.
--
-- The ingest side is fixed in supabase/functions/wpbl-ingest/: an entry the feed gave no id to
-- can no longer be read as a trade, can no longer move anybody's club, and can no longer be
-- inserted as a new player. See `anonymous` in names.ts for the evidence behind that rule (of
-- 118 players, the 49 with no feed id have no box-score line between them). Without it this
-- row would be moved straight back to Los Angeles by the next pass that reads a Los Angeles
-- box score, so DEPLOY THE FUNCTION BEFORE RUNNING THIS.
--
-- The display side is fixed in src/wpbl/GameDetail.tsx, which now resolves names against the
-- whole league; that one stands on its own, because any traded player's older games read the
-- same way.
--
-- Guarded twice: it only moves her if she is still on Los Angeles, and only if every
-- box-score line she owns still says New York. If either has changed since this was written,
-- the situation is not the one described above and this is a no-op.
do $$
declare
  saiki   uuid := '2f152cdb-59b0-4174-954a-33fcf0ca635e';
  clubs   text[];
  moved   int;
begin
  select array_agg(distinct team_id) into clubs
  from (
    select team_id from wpbl_batting_lines  where player_id = saiki
    union all
    select team_id from wpbl_pitching_lines where player_id = saiki
  ) l;

  if clubs is null or clubs <> array['NY']::text[] then
    raise notice 'emi saiki: lines say %, not New York alone. Leaving the roster row alone.', clubs;
    return;
  end if;

  update wpbl_players
     set team_id = 'NY',
         -- Left at the date the bad move used, deliberately. `team_as_of` is a FLOOR on
         -- evidence, not a claim about when she joined: raising it would make the ingest
         -- ignore any older game, and lowering it would let one move her again. The club is
         -- what was wrong; the floor was doing its job.
         team_as_of = team_as_of
   where id = saiki and team_id = 'LA';

  get diagnostics moved = row_count;
  raise notice 'emi saiki: % row moved to New York', moved;
end $$;
