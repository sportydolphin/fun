-- restore hunters roster
-- Created 2026-09-04. Applied by scripts/migrate.mjs.
--
-- WHAT WENT WRONG. On Sep 3, 2026 at 22:16 UTC, one `wpbl-ingest` pass moved SEVENTEEN Boston
-- Hunters onto the Los Angeles Queens in a single flush. The site showed it exactly: the
-- Hunters' team page listed one player under a roster card reading "1 players", beside a
-- lineup grid and a leaderboard full of names the players index had filed under Los Angeles,
-- whose roster had grown to 47 against New York's 30 and San Francisco's 29.
--
-- The feed published a second, never-played copy of that night's LA game (game_id
-- sq38zkgwktwktgu1, tagged Eastern against the real copy's Central, "Not Started", staged
-- ~26 minutes before first pitch) whose Los Angeles side listed Boston's roster by NAME with
-- no player ids on it. `tradeMatch` is the ingest's one matcher that reaches across clubs, and
-- a bare name on a strange club is exactly what it is built to read as a trade, so it read
-- seventeen of them at once. Nothing stopped it: `datedEvidence` asked only whether the game
-- was in the past, which is the right question for the staged games three weeks out that it
-- was written for and no question at all for a staged game happening tonight. The phantom was
-- suppressed and deleted later that evening once the real copy went final, which is why every
-- row it left in `wpbl_player_team_changes` carries a null `game_id`.
--
-- The code fix is in supabase/functions/wpbl-ingest/ (`usableEvidence`, and `played` on
-- GameCtx): a box score is evidence about a PERSON only once the game has been played. This
-- migration repairs the rows that pass already wrote, because nothing else will: the ingest
-- only ever moves a player FORWARD, so Boston's roster would have stayed wrong until their
-- next game, two days before the regular season ends.

-- ─── 1. Put the seventeen back ────────────────────────────────────────────────
-- Off the ingest's own audit log rather than a name list, so this fixes precisely what that
-- pass did and silently does nothing if it is ever run twice or against a repaired database.
-- The pass is uniquely identifiable: a cross-club move whose revealing game no longer exists.
update public.wpbl_players p
   set team_id = c.from_team_id
  from public.wpbl_player_team_changes c
 where c.player_id = p.id
   and c.game_id is null
   and c.game_date = date '2026-09-03'
   and c.from_team_id = 'BOS'
   and c.to_team_id = 'LA'
   and p.team_id = 'LA';

-- ─── 2. Re-derive every club from the box scores ──────────────────────────────
-- A roster row's `team_id` is a summary; the box-score line is the fact, because it carries
-- the club the game was actually played FOR. So rather than trust step 1's restored value,
-- take each player's club from the newest FINAL game she has a line in, which is the rule the
-- ingest is meant to implement. This also catches Emi Saiki, who the same evening's real game
-- left on Los Angeles after she had batted for New York in it (the feed lists her on both
-- sides, and she flipped twice inside two minutes).
--
-- `clubs = 1` is the safety: a player whose newest game shows two clubs has evidence that
-- contradicts itself, and an unattended repair must leave that for a person. No row in the
-- table is in that state today; the guard is here so a future re-run cannot invent an answer.
-- `team_as_of` comes down with it, because it is a floor on later evidence and a floor set
-- from a game nobody played is the bug this is cleaning up.
with box_lines as (
  select l.player_id, l.team_id, g.game_date
    from (
      select player_id, team_id, game_id from public.wpbl_batting_lines
      union all
      select player_id, team_id, game_id from public.wpbl_pitching_lines
    ) l
    join public.wpbl_games g on g.id = l.game_id
   where g.status = 'final'
     and l.team_id is not null
),
newest as (
  select player_id, max(game_date) as game_date
    from box_lines
   group by player_id
),
club as (
  select n.player_id,
         n.game_date,
         min(l.team_id)          as team_id,
         count(distinct l.team_id) as clubs
    from newest n
    join box_lines l
      on l.player_id = n.player_id
     and l.game_date = n.game_date
   group by n.player_id, n.game_date
)
update public.wpbl_players p
   set team_id = c.team_id,
       team_as_of = c.game_date
  from club c
 where p.id = c.player_id
   and c.clubs = 1
   and (p.team_id is distinct from c.team_id or p.team_as_of is distinct from c.game_date);

-- ─── 3. Drop the floors that came from plans ──────────────────────────────────
-- A player who has never appeared in a final box score has no honest `team_as_of`: every one
-- currently set on such a row was read off a staged lineup, and each is a floor that would
-- block the first real game from correcting her club. Her `team_id` is left alone; the draft
-- board is the only thing that knows it, and it is right for everyone step 1 did not touch.
update public.wpbl_players p
   set team_as_of = null
 where p.team_as_of is not null
   and not exists (
     select 1
       from public.wpbl_batting_lines l
       join public.wpbl_games g on g.id = l.game_id
      where l.player_id = p.id and g.status = 'final')
   and not exists (
     select 1
       from public.wpbl_pitching_lines l
       join public.wpbl_games g on g.id = l.game_id
      where l.player_id = p.id and g.status = 'final');

-- ─── 4. Un-say it in the audit log ────────────────────────────────────────────
-- The log's whole purpose is that a person can go and read what the heuristic did unattended
-- (see the Sep 1 dedupe migration). Seventeen trades that never happened, left in it, are not
-- history; they are the log agreeing with the bug. The real moves it recorded that evening,
-- which have a surviving game behind them, are untouched.
delete from public.wpbl_player_team_changes
 where game_id is null
   and game_date = date '2026-09-03'
   and from_team_id = 'BOS'
   and to_team_id = 'LA';
