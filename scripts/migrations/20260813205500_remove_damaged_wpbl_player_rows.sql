-- Remove the roster rows a bad decode forked, and stop the table accepting another one.
--
-- U+FFFD is the replacement character: what a UTF-8 decoder emits for bytes it cannot
-- read. Twice in August 2026 the WPBL feed's response reached wpbl-ingest with the bytes
-- for one accented letter damaged, and because the ingest's name matching treated those
-- characters as ordinary letters, the player matched nothing on her own roster and was
-- inserted again as a new person:
--
--   'Maïka Dumais'    (BOS) → a second row created 2026-08-05, no api_id, no stat lines
--   'Ela Day-Bédard'  (SF)  → a second row created 2026-08-07, no api_id, no stat lines
--
-- Both duplicates are active, so they show in the roster and in search as a mangled,
-- portrait-less entry. The ingest side is fixed in supabase/functions/wpbl-ingest (a
-- damaged name now matches its roster player, and is never inserted as a new one); this
-- clears what the old behaviour left behind.

-- Only ever the damaged, unreconciled, unreferenced rows. api_id is null on all of them
-- because the ingest inserts a feed id when it has one, and the real player already holds
-- hers under a unique index. The NOT EXISTS guards matter because three of the child
-- tables cascade on delete: if any row here turns out to carry real data, this deletes
-- nothing rather than quietly taking that data with it.
delete from wpbl_players p
where p.name like '%' || chr(65533) || '%'
  and p.api_id is null
  and not exists (select 1 from wpbl_batting_lines  b where b.player_id = p.id)
  and not exists (select 1 from wpbl_pitching_lines t where t.player_id = p.id)
  and not exists (select 1 from wpbl_fielding_lines f where f.player_id = p.id)
  and not exists (select 1 from wpbl_game_plays gp where gp.batter_id = p.id or gp.pitcher_id = p.id)
  and not exists (select 1 from wpbl_plays pl where pl.batter_id = p.id or pl.pitcher_id = p.id or pl.runner_id = p.id)
  and not exists (
    select 1 from wpbl_games g
    where p.id in (g.runner_first, g.runner_second, g.runner_third, g.away_pitcher_id, g.home_pitcher_id)
  );

-- Defence in depth for the same fault arriving through some other path. A replacement
-- character in a player's name is never real data, so refuse it at the table: an ingest
-- that somehow tries again fails loudly on that one insert (and skips that player's lines
-- for that run, which the next clean run backfills) instead of forking the roster
-- permanently. Guarded so the migration is safe to re-run.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'wpbl_players'::regclass and conname = 'wpbl_players_name_not_damaged'
  ) then
    alter table wpbl_players
      add constraint wpbl_players_name_not_damaged
      check (name not like '%' || chr(65533) || '%');
  end if;
end $$;
