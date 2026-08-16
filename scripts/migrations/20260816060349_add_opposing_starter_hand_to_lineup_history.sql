-- Adds the opposing starting pitcher's throwing hand to wpbl_lineup_history.
--
-- This is the column that makes the lineup grid worth reading. A manager's card against a
-- lefty is a different card than against a righty, and without the hand the grid just looks
-- like unexplained shuffling — you can't tell a platoon from a slump. Fangraphs' Roster
-- Resource labels each of its "last N lineups" columns "vs. R" or "vs. L" for exactly this
-- reason.
--
-- Derivation: wpbl_pitching_lines.gs marks the starter (26 starts across 26 team-games, so
-- every game in hand resolves), and wpbl_players.throws carries the hand. The OPPOSING
-- starter is the one whose team_id differs from the batting team's.
--
-- min() over the starter set rather than a plain join: if a feed ever flagged two starters
-- for one team in one game, this stays one row per game instead of silently duplicating
-- every hitter's line. Nullable throughout — a game with no recorded starter yields null,
-- and the grid renders that as an unlabelled column rather than dropping the game.

-- Dropped and recreated rather than `create or replace`: Postgres refuses to replace a view
-- when the new column list inserts columns rather than appending them, and opponent/hand
-- belong next to the game they describe, not bolted onto the end.
drop view if exists wpbl_lineup_history;

create view wpbl_lineup_history as
with first_pa as (
  select game_id, batter_id as player_id, min(sequence) as first_seq
  from wpbl_game_plays
  where batter_id is not null
  group by 1, 2
),
starters as (
  select l.game_id, l.team_id, min(p.throws) as throws
  from wpbl_pitching_lines l
  join wpbl_players p on p.id = l.player_id
  where l.gs = 1
  group by 1, 2
)
select
  b.game_id,
  b.team_id,
  b.player_id,
  g.game_date,
  g.status                                       as game_status,
  case when g.home_team_id = b.team_id then g.away_team_id else g.home_team_id end
                                                 as opponent_team_id,
  opp.throws                                     as opp_starter_throws,
  b.batting_order                                as lineup_spot,
  b.position,
  row_number() over (
    partition by b.game_id, b.team_id, b.batting_order
    order by fp.first_seq nulls last
  ) = 1                                          as started,
  count(*) over (
    partition by b.game_id, b.team_id, b.batting_order
  ) > 1                                          as slot_shared,
  fp.first_seq,
  b.ab, b.h, b.hr, b.rbi, b.bb, b.so
from wpbl_batting_lines b
join wpbl_games g on g.id = b.game_id
left join first_pa fp on fp.game_id = b.game_id and fp.player_id = b.player_id
-- The starter on the other side: same game, different team.
left join starters opp on opp.game_id = b.game_id and opp.team_id <> b.team_id
where b.batting_order between 1 and 9;

grant select on wpbl_lineup_history to anon, authenticated;

comment on view wpbl_lineup_history is
  'Per-game lineup slot + position per player, with started/sub resolved via play sequence '
  'and the opposing starter''s throwing hand. Batting slot 10 (non-batting pitchers) excluded.';
