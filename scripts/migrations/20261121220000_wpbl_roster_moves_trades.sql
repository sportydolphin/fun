-- wpbl_roster_moves takes trades.
--
-- WHY. On Nov 21, 2026 the league announced that New York, before the re-signing window closed,
-- traded Alyssa Zettlemoyer (already announced as re-signed by New York) to Boston for Boston's
-- 6th-round pick. The table had no way to say that, so the player stayed on New York's list.
--
-- A trade row is one player moving: `team_id` is the club that gets the player, `from_team_id` the
-- club that gives them up. When a draft pick went back, `draft_round` and `draft_pick` describe that
-- pick (the receiving club's own, as in every trade so far); a player going back is a second trade
-- row. The earlier re-signing row stays: both things happened, and the rosters read the trade on top.

alter table public.wpbl_roster_moves
  add column if not exists from_team_id text references public.wpbl_teams(id);

alter table public.wpbl_roster_moves drop constraint if exists wpbl_roster_moves_kind_check;
alter table public.wpbl_roster_moves add constraint wpbl_roster_moves_kind_check
  check (kind in ('re-signed', 'drafted', 'signed', 'released', 'traded'));

-- A trade always names a known player and two different clubs; nothing else carries a from club.
alter table public.wpbl_roster_moves drop constraint if exists wpbl_roster_moves_trade_check;
alter table public.wpbl_roster_moves add constraint wpbl_roster_moves_trade_check
  check (case when kind = 'traded'
              then player_id is not null and from_team_id is not null and from_team_id <> team_id
              else from_team_id is null end);

-- One move of a kind per player per season still holds, except trades: a player can be moved twice
-- in one offseason, and the index would refuse the second.
drop index if exists public.wpbl_roster_moves_one_per_player;
create unique index wpbl_roster_moves_one_per_player
  on public.wpbl_roster_moves (season, kind, player_id) where player_id is not null and kind <> 'traded';
