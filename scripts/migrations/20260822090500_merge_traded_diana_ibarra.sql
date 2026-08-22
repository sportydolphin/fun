-- The one duplicate the Aug 21, 2026 trade left behind, folded back into one player.
--
-- 7254031e… is the seeded row: New York, feed id moizfkn9dtrm4vno, eight games of season on
-- it. 71171e49… is what wpbl-ingest inserted when she turned up in the Aug 21 SF-at-LA box
-- score under a brand new feed id (27svefz41ds4k58k) — one game, no birthday, no draft
-- history, and a second entry under her name everywhere the site lists players.
--
-- Keep the older row: it holds the season, the birth date, the draft position and the id that
-- every existing link, share card and Discord post already points at. The new row contributes
-- its feed id (pitch tracking is keyed on that, so her LA pitches need it) and her Los Angeles
-- uniform number, and then goes away.
--
-- Guarded so this is a no-op rather than an error if the pair was already merged by hand.
do $$
declare
  keep uuid := '7254031e-8d7b-4383-abac-38b93d9367db';  -- Diana Ibarra, seeded (NY)
  dupe uuid := '71171e49-6a83-4449-a3eb-4584a1b2d57e';  -- Diana Ibarra, feed-inserted (LA)
begin
  if not exists (select 1 from wpbl_players where id = dupe) then
    raise notice 'wpbl: Ibarra duplicate % already gone, nothing to merge', dupe;
    return;
  end if;

  perform wpbl_merge_players(keep, dupe);

  -- She is a Queen now. team_as_of is the date of the game that proved it, which is what stops
  -- a later re-read of one of her New York games from moving her back.
  update wpbl_players
     set team_id    = 'LA',
         api_id     = '27svefz41ds4k58k',
         team_as_of = date '2026-08-21'
   where id = keep;

  insert into wpbl_player_team_changes (player_id, from_team_id, to_team_id, game_id, game_date, feed_api_id, reason)
  select keep, 'NY', 'LA', g.id, g.game_date, '27svefz41ds4k58k', 'name-match'
    from wpbl_games g
   where g.api_game_id = 'awbrugq1q63c3uph';   -- SF at LA, Aug 21, 2026: her first game as a Queen
end;
$$;
