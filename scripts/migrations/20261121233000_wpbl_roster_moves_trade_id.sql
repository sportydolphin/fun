-- wpbl_roster_moves.trade_id: the rows of one trade share it.
--
-- WHY. A trade row is one player moving, so a player-for-player deal is two rows, and without a
-- link Home's transactions list could only show two unrelated "Traded from" lines with nothing to
-- say who went the other way. Every traded row carries one; nothing else may.

alter table public.wpbl_roster_moves add column if not exists trade_id uuid;

update public.wpbl_roster_moves set trade_id = gen_random_uuid() where kind = 'traded' and trade_id is null;

alter table public.wpbl_roster_moves drop constraint if exists wpbl_roster_moves_trade_id_check;
alter table public.wpbl_roster_moves add constraint wpbl_roster_moves_trade_id_check
  check ((kind = 'traded') = (trade_id is not null));
