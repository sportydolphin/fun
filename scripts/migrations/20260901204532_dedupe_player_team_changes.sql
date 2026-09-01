-- dedupe player team changes
-- Created 2026-09-01. Applied by scripts/migrate.mjs.
--
-- WHAT WAS WRONG. `wpbl_player_team_changes` is the trade log: one row per "this player turned
-- up under a new club in this box score". The detection is correct and the WRITE was not
-- idempotent, so the same finding was inserted again on every pass that re-read the same old
-- box score. `wpbl-ingest` re-reads them constantly (the 2-minute cron, `force`, the TrackMan
-- backfill, mode `all`), which made the log grow without bound while learning nothing.
--
-- Measured on Sep 1, 2026, three weeks after the table was created:
--
--   13,644 rows, encoding 18 distinct facts about 3 players,
--   growing by roughly 2,900 rows a day, forever, including long after the season ends.
--
-- Nothing on the site reads the table, which is why it was invisible: it is written by the
-- ingest and read by a person looking into a specific trade. So the cost was not a wrong
-- number on a page, it was an audit log too noisy to audit with, and 4.7MB of near-identical
-- rows that kept the table out of the season archive (see scripts/export-wpbl-archive.ts).
--
-- WHY EARLIEST-WINS. A row's `detected_at` is when we noticed, and its `game_date` is the game
-- that revealed the move. Of thousands of identical detections the honest one is the FIRST:
-- that is the moment this data could first have known, and the ones after it are the loop
-- coming back round, not new evidence.
--
-- Runs in a transaction (the runner's default), so the delete and the constraint that stops it
-- happening again land together or not at all.

-- ─── 1. Collapse ──────────────────────────────────────────────────────────────
-- Keep the earliest detection of each distinct move, `id` breaking a tie so the result does not
-- depend on which row Postgres happens to visit first.
with ranked as (
  select id,
         row_number() over (
           partition by player_id, game_id, from_team_id, to_team_id
           order by detected_at asc, id asc
         ) as rn
    from public.wpbl_player_team_changes
)
delete from public.wpbl_player_team_changes t
 using ranked r
 where t.id = r.id
   and r.rn > 1;

-- ─── 2. Stop it coming back ───────────────────────────────────────────────────
-- NULLS NOT DISTINCT is load-bearing rather than tidiness. `game_id` is nullable (the game it
-- points at is `on delete set null`) and so is `from_team_id` (a player's first club has no
-- "from"). Under the default rule two NULLs never collide, so a move with either column null
-- would go straight back to inserting a fresh row on every pass, which is exactly the bug,
-- surviving in the one corner nobody would think to re-check. Postgres 15+; the database is 17.
create unique index if not exists wpbl_player_team_changes_move_uidx
  on public.wpbl_player_team_changes (player_id, game_id, from_team_id, to_team_id)
  nulls not distinct;

-- ─── 3. Teach the merge tool about the new constraint ─────────────────────────
-- `wpbl_merge_players(keep, dupe)` re-points this table's rows at the kept player. With the
-- index above that update can now COLLIDE: both players logging the same move out of the same
-- box score is precisely what a mergeable pair looks like, and re-pointing the duplicate's row
-- would make it identical to one that already exists, failing the whole merge. Left unfixed it
-- would not surface until the next merge, which is a rare, manual, hard-to-rehearse operation
-- and the worst possible place to meet a new constraint.
--
-- The added block is the pattern the function already uses for `wpbl_discord_birthday_posts`:
-- drop the duplicate's colliding rows, then re-point what is left. `is not distinct from` and
-- not `=`, to match the NULLS NOT DISTINCT index above; with plain `=` a null game_id would
-- compare as unknown, the delete would skip the row, and the update would hit the constraint
-- the delete was there to avoid.
--
-- The rest of the body below is reproduced verbatim from the deployed function
-- (pg_get_functiondef, Sep 1 2026), because CREATE OR REPLACE has no partial form. If it has
-- drifted from 20260822090000_add_wpbl_player_trade_support.sql, THIS is the live one.

CREATE OR REPLACE FUNCTION public.wpbl_merge_players(keep uuid, dupe uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if keep = dupe then
    raise exception 'wpbl_merge_players: keep and dupe are the same row (%)', keep;
  end if;
  if not exists (select 1 from wpbl_players where id = keep) then
    raise exception 'wpbl_merge_players: keep row % does not exist', keep;
  end if;
  if not exists (select 1 from wpbl_players where id = dupe) then
    raise exception 'wpbl_merge_players: dupe row % does not exist', dupe;
  end if;

  -- Box-score lines are unique on (game_id, player_id). Both rows holding a line for the SAME
  -- game would mean the feed listed the player twice in one box score, which is a feed bug
  -- rather than a trade; drop the duplicate instead of failing, because an unmergeable pair is
  -- worse than losing a line that should not exist.
  delete from wpbl_batting_lines d
   where d.player_id = dupe
     and exists (select 1 from wpbl_batting_lines k where k.player_id = keep and k.game_id = d.game_id);
  delete from wpbl_pitching_lines d
   where d.player_id = dupe
     and exists (select 1 from wpbl_pitching_lines k where k.player_id = keep and k.game_id = d.game_id);
  delete from wpbl_fielding_lines d
   where d.player_id = dupe
     and exists (select 1 from wpbl_fielding_lines k where k.player_id = keep and k.game_id = d.game_id);

  update wpbl_batting_lines  set player_id = keep where player_id = dupe;
  update wpbl_pitching_lines set player_id = keep where player_id = dupe;
  update wpbl_fielding_lines set player_id = keep where player_id = dupe;

  -- wpbl_game_plays is a mirror that wpbl-ingest rewrites, so these two are cosmetic until
  -- the next pass. Done anyway, so the table is right in the meantime and so merging a player
  -- whose games will never be re-ingested still lands.
  update wpbl_game_plays set batter_id  = keep where batter_id  = dupe;
  update wpbl_game_plays set pitcher_id = keep where pitcher_id = dupe;

  update wpbl_plays set batter_id           = keep where batter_id           = dupe;
  update wpbl_plays set pitcher_id          = keep where pitcher_id          = dupe;
  update wpbl_plays set runner_id           = keep where runner_id           = dupe;
  update wpbl_plays set runner_first_after  = keep where runner_first_after  = dupe;
  update wpbl_plays set runner_second_after = keep where runner_second_after = dupe;
  update wpbl_plays set runner_third_after  = keep where runner_third_after  = dupe;

  update wpbl_games set home_pitcher_id = keep where home_pitcher_id = dupe;
  update wpbl_games set away_pitcher_id = keep where away_pitcher_id = dupe;
  update wpbl_games set runner_first    = keep where runner_first    = dupe;
  update wpbl_games set runner_second   = keep where runner_second   = dupe;
  update wpbl_games set runner_third    = keep where runner_third    = dupe;

  -- Primary-keyed on (player_id, birthday_on): a greeting already posted under the kept row
  -- on the same day wins, so a merge can never make the bot post twice.
  delete from wpbl_discord_birthday_posts d
   where d.player_id = dupe
     and exists (select 1 from wpbl_discord_birthday_posts k
                  where k.player_id = keep and k.birthday_on = d.birthday_on);
  update wpbl_discord_birthday_posts set player_id = keep where player_id = dupe;

  -- Unique on (player_id, game_id, from_team_id, to_team_id) since the Sep 1 dedupe, so
  -- re-pointing the duplicate's rows can now COLLIDE with the kept player's: both logging the
  -- same move out of the same box score is precisely what a mergeable pair looks like. Same
  -- shape as the birthday block above, and for the same reason: an unmergeable pair is worse
  -- than losing a log line that says what a surviving line already says.
  delete from wpbl_player_team_changes d
   where d.player_id = dupe
     and exists (select 1 from wpbl_player_team_changes k
                  where k.player_id = keep
                    and k.game_id is not distinct from d.game_id
                    and k.from_team_id is not distinct from d.from_team_id
                    and k.to_team_id = d.to_team_id);
  update wpbl_player_team_changes set player_id = keep where player_id = dupe;

  -- Article tagging is an array, so swap the element and de-duplicate.
  update wpbl_articles
     set player_ids = (select array_agg(distinct x) from unnest(array_replace(player_ids, dupe, keep)) x)
   where player_ids @> array[dupe];

  -- Absorb the duplicate's identity. Every feed id it held comes across (that is the whole
  -- point: pitch tracking is keyed on them), and any field the kept row is missing is taken
  -- from it rather than lost.
  update wpbl_players k
     set api_ids = (select coalesce(array_agg(distinct a), '{}'::text[])
                      from unnest(k.api_ids || d.api_ids || array[k.api_id, d.api_id]) a
                     where a is not null and a <> ''),
         position          = coalesce(k.position,          d.position),
         bats              = coalesce(k.bats,              d.bats),
         throws            = coalesce(k.throws,            d.throws),
         jersey_number     = coalesce(k.jersey_number,     d.jersey_number),
         age               = coalesce(k.age,               d.age),
         hometown          = coalesce(k.hometown,          d.hometown),
         bio               = coalesce(k.bio,               d.bio),
         birth_date        = coalesce(k.birth_date,        d.birth_date),
         birth_date_source = coalesce(k.birth_date_source, d.birth_date_source),
         draft_round       = coalesce(k.draft_round,       d.draft_round),
         draft_pick        = coalesce(k.draft_pick,        d.draft_pick)
    from wpbl_players d
   where k.id = keep and d.id = dupe;

  delete from wpbl_players where id = dupe;
end;
$function$
