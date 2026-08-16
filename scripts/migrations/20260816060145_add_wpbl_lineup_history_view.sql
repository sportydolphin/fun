-- wpbl_lineup_history — one row per player per team-game, saying where she hit and where
-- she played, and whether she was in the lineup at first pitch or came in later.
--
-- This is what the "last N lineups" grid reads (a Fangraphs Roster Resource-style view of
-- how a manager has actually been filling out the card).
--
-- THE PROBLEM THIS SOLVES. wpbl_batting_lines carries batting_order and position for every
-- line, but when a manager substitutes, two or more players share one lineup slot in the
-- same game — up to four, in one observed case. The box score's row order encodes who
-- started, but that order is not preserved at ingest (every row in a game lands with an
-- identical created_at from the bulk insert) and the sub_out column has never been
-- populated. So "who started?" cannot be answered from wpbl_batting_lines alone.
--
-- THE FIX. wpbl_game_plays is sequenced, so the first plate appearance each player takes is
-- known. Within a contested slot the starter is simply whoever batted first. Two rules,
-- in this order:
--   1. batting_order from the box score is authoritative for WHICH slot (it is present on
--      100% of lines; deriving slots from play order alone matches it only 89% of the time,
--      because an early substitution shifts everyone after it).
--   2. Play sequence breaks ties WITHIN a slot — earliest first PA is the starter.
-- Across the 13 games in hand this resolves 25 of 26 team-games to a clean 1-9. The
-- twenty-sixth (NY) is missing slot 7 in the source box score itself, not here.
--
-- A player who never batted has no play row; `nulls last` keeps her behind anyone who did,
-- which is right — if she never came to the plate she did not start ahead of someone who did.
--
-- Batting slot 10 is NOT a lineup spot. It is where the feed parks pitchers who never bat
-- (38 such rows, 0.08 AB apiece against 3.37 for slot 1), so it is excluded from the
-- lineup grid entirely rather than rendering as a phantom tenth hitter.

create or replace view wpbl_lineup_history as
with first_pa as (
  select game_id, batter_id as player_id, min(sequence) as first_seq
  from wpbl_game_plays
  where batter_id is not null
  group by 1, 2
)
select
  b.game_id,
  b.team_id,
  b.player_id,
  g.game_date,
  g.status                                       as game_status,
  b.batting_order                                as lineup_spot,
  b.position,
  -- Rank within the slot: 1 = started there, 2+ = came in later.
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
where b.batting_order between 1 and 9;

comment on view wpbl_lineup_history is
  'Per-game lineup slot + position per player, with started/sub resolved via play sequence. '
  'Batting slot 10 (non-batting pitchers) is excluded.';

-- The view inherits the row-level security of wpbl_batting_lines / wpbl_games underneath,
-- both of which are public-select, so an anon read of the view returns the same rows a
-- direct read of those tables would. Granting select is what makes it visible to PostgREST.
grant select on wpbl_lineup_history to anon, authenticated;
