-- A recorded trade moves the player: wpbl_players.team_id follows a 'traded' roster move.
--
-- WHY. The Zettlemoyer trade (Nov 21, 2026) went into wpbl_roster_moves and nothing else, so her
-- roster row still said New York: the player page, the portrait's club color, search and the share
-- card all read team_id, and the only writer of team_id is the ingest, which learns of a trade from
-- a box score. In the offseason there are no box scores, so a trade would sit unseen until spring.
--
-- team_as_of GOES TO THE ANNOUNCEMENT DATE. It is the ingest's floor (`teamMoveWins` in
-- wpbl-ingest/names.ts): only a game on or after it may move the player. Left at her last 2026 game,
-- any re-read of a 2026 New York box score would send her straight back. A 2027 game for any club
-- still wins, which is right: that is newer evidence than the announcement.
--
-- A player already moved by something newer than the announcement (team_as_of past it) is left
-- alone, for the same reason the ingest leaves older news alone.
--
-- Deleting or editing a trade row undoes the move only while it is still the trade's own: the player
-- on the receiving club with team_as_of at the announcement. Anything newer has replaced it.
--
-- Every move it makes is logged in wpbl_player_team_changes with reason 'roster move', the paper
-- trail that table exists for.

create or replace function public.wpbl_apply_trade()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- An edit that leaves the move itself alone (a corrected source link) moves nobody.
  if tg_op = 'UPDATE'
     and (old.kind, old.player_id, old.team_id, old.from_team_id, old.announced_on)
         is not distinct from (new.kind, new.player_id, new.team_id, new.from_team_id, new.announced_on) then
    return null;
  end if;

  -- Undo the old row's move first (an update or a delete), if it is still the one in force.
  if tg_op in ('UPDATE', 'DELETE') and old.kind = 'traded' then
    update public.wpbl_players p
       set team_id = old.from_team_id
     where p.id = old.player_id
       and p.team_id = old.team_id
       and p.team_as_of = old.announced_on;
    if found then
      insert into public.wpbl_player_team_changes (player_id, from_team_id, to_team_id, game_date, reason)
      values (old.player_id, old.team_id, old.from_team_id, old.announced_on, 'roster move undone');
    end if;
  end if;

  if tg_op in ('INSERT', 'UPDATE') and new.kind = 'traded' then
    insert into public.wpbl_player_team_changes (player_id, from_team_id, to_team_id, game_date, reason)
    select p.id, p.team_id, new.team_id, new.announced_on, 'roster move'
      from public.wpbl_players p
     where p.id = new.player_id
       and p.team_id is distinct from new.team_id
       and (p.team_as_of is null or p.team_as_of <= new.announced_on);

    update public.wpbl_players p
       set team_id = new.team_id,
           team_as_of = new.announced_on
     where p.id = new.player_id
       and (p.team_as_of is null or p.team_as_of <= new.announced_on);
  end if;

  return null;
end
$function$;

-- A trigger function is never called directly; nobody gets to.
revoke all on function public.wpbl_apply_trade() from public, anon, authenticated;

drop trigger if exists wpbl_roster_moves_apply_trade on public.wpbl_roster_moves;
create trigger wpbl_roster_moves_apply_trade
  after insert or update or delete on public.wpbl_roster_moves
  for each row execute function public.wpbl_apply_trade();

-- The trades already on file, the same two statements the trigger runs, oldest first.
insert into public.wpbl_player_team_changes (player_id, from_team_id, to_team_id, game_date, reason)
select p.id, p.team_id, m.team_id, m.announced_on, 'roster move'
  from public.wpbl_roster_moves m
  join public.wpbl_players p on p.id = m.player_id
 where m.kind = 'traded'
   and p.team_id is distinct from m.team_id
   and (p.team_as_of is null or p.team_as_of <= m.announced_on);

update public.wpbl_players p
   set team_id = m.team_id,
       team_as_of = m.announced_on
  from (select distinct on (player_id) player_id, team_id, announced_on
          from public.wpbl_roster_moves
         where kind = 'traded'
         order by player_id, announced_on desc, id desc) m
 where p.id = m.player_id
   and (p.team_as_of is null or p.team_as_of <= m.announced_on);
