-- suzu narasaki plays for new york
-- Created 2026-09-06. Applied by scripts/migrate.mjs.
--
-- The same bug as 20260906180357_emi_saiki_plays_for_new_york, off the same box score, the
-- same night. Found by auditing every player's roster club against the club she last actually
-- played for; these two were the only disagreements in the league.
--
-- Suzu Narasaki was genuinely traded. She batted for Los Angeles on Aug 12, 14 and 15 and has
-- played for New York on Aug 27, Aug 30, Sep 3 and Sep 4. Her team changes read:
--
--   Aug 27  LA -> NY  name-match  WITH a feed id    <- the real trade, correctly seen
--   Sep 5   NY -> LA  name-match  NO feed id        <- where she was left
--
-- The Sep 5 row is from LA at BOS, a game New York is not in, and it is timestamped 23:40
-- alongside the identical bad move for Emi Saiki. That box score carried anonymous entries for
-- both of them under Los Angeles, and `tradeMatch` read each as a trade because the names are
-- spelled exactly and belong to nobody else in the league.
--
-- The difference between the two rows above is the whole fix: a real trade carries the new
-- player_id the league mints for it, and an anonymous entry carries nothing. See `anonymous` in
-- supabase/functions/wpbl-ingest/names.ts, deployed before this ran.
--
-- Verified after deploying: re-ingesting that exact game moved nobody, and a forced correction
-- pass over all 29 recent finals left the league's team-change count at 27 and the roster at
-- 118. Before the deploy, that same game is what moved these two.
--
-- Guarded the same way, on the rule the audit used: only move her if she is still on Los
-- Angeles, and only if the newest box-score line she owns says New York.
do $$
declare
  suzu     uuid := 'c2c0093d-4394-48a7-9cca-e2fd2b82133b';
  played   text;
  moved    int;
begin
  select l.team_id into played
  from (
    select team_id, game_id from wpbl_batting_lines  where player_id = suzu
    union all
    select team_id, game_id from wpbl_pitching_lines where player_id = suzu
  ) l
  join wpbl_games g on g.id = l.game_id
  order by g.game_date desc
  limit 1;

  if played is distinct from 'NY' then
    raise notice 'suzu narasaki: last played for %, not New York. Leaving the roster row alone.', played;
    return;
  end if;

  update wpbl_players
     set team_id = 'NY',
         -- Left where it is, for the reason given in the Saiki migration: `team_as_of` is a
         -- floor on evidence, not a claim about when she joined.
         team_as_of = team_as_of
   where id = suzu and team_id = 'LA';

  get diagnostics moved = row_count;
  raise notice 'suzu narasaki: % row moved to New York', moved;
end $$;
