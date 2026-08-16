-- Adds the opposing starter's NAME to wpbl_lineup_history, alongside her throwing hand.
--
-- Why: the grid headers previously read "vs L" / "vs R", which is the Fangraphs convention
-- but is genuinely ambiguous outside it — every game has several pitchers, so a bare hand
-- reads as if it might describe the whole staff rather than the one pitcher the manager
-- wrote the card against. A name can only be one person, so showing it removes the
-- ambiguity that the hand alone creates.
--
-- Same derivation as opp_starter_throws: wpbl_pitching_lines.gs marks the starter, and the
-- min() over the starter set keeps this one row per game even if a feed ever flagged two.
-- The name and hand are taken together in that aggregate so they can never come from
-- different pitchers.

drop view if exists wpbl_lineup_history;

create view wpbl_lineup_history as
with first_pa as (
  select game_id, batter_id as player_id, min(sequence) as first_seq
  from wpbl_game_plays
  where batter_id is not null
  group by 1, 2
),
starters as (
  -- distinct on keeps name and hand from the SAME pitcher; two independent min()s could
  -- pair one starter's name with another's hand if a game ever had two flagged starts.
  select distinct on (l.game_id, l.team_id)
    l.game_id, l.team_id, p.name as starter_name, p.throws
  from wpbl_pitching_lines l
  join wpbl_players p on p.id = l.player_id
  where l.gs = 1
  order by l.game_id, l.team_id, p.name
)
select
  b.game_id,
  b.team_id,
  b.player_id,
  g.game_date,
  g.status                                       as game_status,
  case when g.home_team_id = b.team_id then g.away_team_id else g.home_team_id end
                                                 as opponent_team_id,
  opp.starter_name                               as opp_starter_name,
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
left join starters opp on opp.game_id = b.game_id and opp.team_id <> b.team_id
where b.batting_order between 1 and 9;

comment on view wpbl_lineup_history is
  'Per-game lineup slot + position per player, with started/sub resolved via play sequence '
  'and the opposing starter''s name and throwing hand. Batting slot 10 excluded.';

grant select on wpbl_lineup_history to anon, authenticated;
