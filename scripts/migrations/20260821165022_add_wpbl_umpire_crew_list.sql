-- wpbl_game_details.umpire_crew: everyone who umpired the game, resolved to names.
--
-- WHY, WHEN THERE ARE ALREADY FOUR POSITIONAL COLUMNS. Because the positional columns come
-- from the event file's `info` records, and those are the assignment AT FIRST PITCH. Crews
-- move. NYH's Aug 8 game carries
--
--   com,"umpchange,6,umphome,monaa701"
--   com,"umpchange,6,ump1b,chare601"
--
-- so Annie Monachello moved behind the plate in the 6th and Emma Charlesworth-Seiler came in
-- at first. Reading the `info` records alone, that game had two umpires; it had three, and the
-- one the `info` record names as the plate umpire only worked five innings there. The four
-- columns stay as what they are (the starting assignment, no interpretation), and this is the
-- complete list, which is what a reader is actually being shown.
--
-- WHY NOT A JOIN TABLE. Seven officials work this entire league and nothing yet asks a
-- question about one of them across games. When something does (a called-strike-rate board by
-- plate umpire is the obvious one, and the pitch-code layer already computes the rate), the
-- shape it wants is per-inning plate assignments, which is a different table from this and not
-- one either representation here would have saved any work towards.
alter table public.wpbl_game_details
  add column if not exists umpire_crew text[];

comment on column public.wpbl_game_details.umpire_crew is
  'Every umpire who worked the game, starting crew first, then anyone who came in mid-game '
  '(the event file''s umpchange comments). Names, not ids. The ump_home/first/second/third '
  'columns beside it are the assignment at first pitch only.';
