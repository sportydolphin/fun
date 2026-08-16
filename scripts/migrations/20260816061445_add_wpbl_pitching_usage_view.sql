-- wpbl_pitching_usage — one row per pitcher per appearance, with the things a usage chart
-- needs that a box score doesn't carry: who she faced, and how long she'd been resting.
--
-- The companion to wpbl_lineup_history. That view answers "how is the manager filling out
-- the card"; this one answers "who's been worked, and who's available tonight" — the read
-- Fangraphs' bullpen usage chart exists for.
--
-- days_rest is the point of the view. It's the gap between a pitcher's consecutive
-- APPEARANCES, computed with lag() over her own game dates, so it survives the thing that
-- makes this awkward to do in the client: a pitcher's appearances are scattered across a
-- team's schedule, and the gap that matters is between the games she actually pitched in,
-- not between calendar days or between roster entries. Null on a first appearance — there
-- is no previous outing to measure from, which is different from "no rest".
--
-- Back-to-back days show as days_rest = 1. Note the league sometimes plays two games on one
-- date; a second outing the same day lands as 0, which is a genuine signal, not a glitch.
--
-- pitches is nullable: one line in 76 has no pitch count (a pitcher who recorded no outs
-- and faced nobody). Left null rather than coerced to 0, so the grid can render "appeared,
-- count unknown" instead of claiming she threw nothing.

create or replace view wpbl_pitching_usage as
select
  l.game_id,
  l.team_id,
  l.player_id,
  g.game_date,
  g.status                                       as game_status,
  case when g.home_team_id = l.team_id then g.away_team_id else g.home_team_id end
                                                 as opponent_team_id,
  l.gs = 1                                       as started,
  l.outs,
  l.pitches,
  l.bf,
  l.er,
  l.so,
  l.bb,
  l.decision,
  -- Days since this pitcher's previous outing, by her own appearance history.
  (g.game_date - lag(g.game_date) over (
     partition by l.player_id order by g.game_date, l.game_id
   ))                                            as days_rest
from wpbl_pitching_lines l
join wpbl_games g on g.id = l.game_id;

comment on view wpbl_pitching_usage is
  'Per-appearance pitcher usage: outs, pitches, opponent, and days_rest since that '
  'pitcher''s previous outing (null on her first).';

grant select on wpbl_pitching_usage to anon, authenticated;
