-- wpbl_roster_moves trades: one asset per row, picks on their own, and a push marker.
--
-- WHY ONE ASSET PER ROW. Until now a trade row was a player, and `draft_round` on it meant a pick
-- going the OTHER way, back to the club that gave the player up. That could not hold a pick-for-
-- pick deal, two picks, or a pick going the same way as a player, and it made every reader
-- remember the reversal. Now a traded row is one thing moving from `from_team_id` to `team_id`:
-- a player (player_id, or player_name for someone not in wpbl_players yet, like a draft pick), or,
-- with neither, the pick `draft_round` (and `draft_pick` once the order is set). A trade's rows
-- share `trade_id`. The one trade so far is rewritten to that shape below.
--
-- PUSHED_AT. Trades are recorded by hand from /admin, and the browser cannot send a push. The
-- Instagram watch pushes each traded row with no `pushed_at` to readers with notify_wpbl_resigns
-- and stamps it, so a trade reaches phones within one run of being recorded, once. Every row that
-- exists now is stamped: the Nov 21 trade was news when it happened, not after this migration.

alter table public.wpbl_roster_moves add column if not exists pushed_at timestamptz;
update public.wpbl_roster_moves set pushed_at = now() where pushed_at is null;

-- Neither a player nor a name is fine for a traded pick; everything else still names someone.
alter table public.wpbl_roster_moves drop constraint if exists wpbl_roster_moves_check;
alter table public.wpbl_roster_moves add constraint wpbl_roster_moves_check
  check (player_id is not null or nullif(trim(player_name), '') is not null
         or (kind = 'traded' and draft_round is not null));

alter table public.wpbl_roster_moves drop constraint if exists wpbl_roster_moves_trade_check;
alter table public.wpbl_roster_moves add constraint wpbl_roster_moves_trade_check
  check (case when kind = 'traded'
              then from_team_id is not null and from_team_id <> team_id
                   -- A player row carries no pick: the pick is its own row.
                   and (player_id is null and nullif(trim(player_name), '') is null) = (draft_round is not null)
              else from_team_id is null end);

-- The Nov 21, 2026 trade in the new shape: Zettlemoyer New York to Boston, and Boston's 6th-round
-- pick Boston to New York, one trade_id.
do $$
declare t public.wpbl_roster_moves;
begin
  for t in select * from public.wpbl_roster_moves where kind = 'traded' and player_id is not null and draft_round is not null loop
    update public.wpbl_roster_moves set draft_round = null, draft_pick = null where id = t.id;
    insert into public.wpbl_roster_moves
      (season, kind, player_id, player_name, team_id, from_team_id, trade_id, draft_round, draft_pick, announced_on, source_url, pushed_at)
    values
      (t.season, 'traded', null, null, t.from_team_id, t.team_id, t.trade_id, t.draft_round, t.draft_pick, t.announced_on, t.source_url, t.pushed_at);
  end loop;
end $$;

-- The watch now files a trade post as 'trade', to flag it once and never record from it.
alter table public.wpbl_instagram_posts drop constraint if exists wpbl_instagram_posts_kind_check;
alter table public.wpbl_instagram_posts add constraint wpbl_instagram_posts_kind_check
  check (kind in ('resign', 'trade', 'other'));

-- The three Nov 21 trade posts were stored as 'other'. The watch re-classifies every post in view
-- on each run, so they would come back as unannounced trades and ping Discord about a trade that
-- is already recorded. Filed as trades, already announced.
update public.wpbl_instagram_posts set kind = 'trade', announced_at = coalesce(announced_at, now())
 where media_id in ('17964891219000396', '18404490610165257', '18069727658619160');
