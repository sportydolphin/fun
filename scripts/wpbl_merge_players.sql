-- Run in the Supabase SQL editor whenever the ingest auto-creates a "shadow" player —
-- a feed row whose name differs from the seeded roster spelling/nickname, so it did not
-- match and got inserted fresh (api_id set, no bio/portrait). This merges each shadow
-- back into the seeded row that carries the bio + portrait: delete the shadow (frees its
-- api_id and cascades its stat lines), then stamp that api_id onto the seeded row. Re-run
-- the wpbl-ingest backfill ({"mode":"all"}) afterwards so the stats reattach.
--
-- NOTE: the ingest now auto-resolves most variants itself — accent/case/spacing, edit-
-- distance-1 spellings (Fox↔Foxx, Villareal↔Villarreal, Gabriella↔Gabrielle), AND prefix
-- nickname shortenings (Val↔Valerie, Alex↔Alexandra, Sam↔Samuel). Only NON-prefix
-- nicknames still slip through and need a manual pair here (e.g. Gabby↔Gabriella,
-- Kate↔Katherine, Liz↔Elizabeth). The pairs below are the historical merges already
-- applied; keep them as a record and add new non-prefix cases as they appear.
--
-- Find shadows to merge:
--   select team_id, name, api_id from wpbl_players
--   where api_id is not null and age is null and hometown is null and status is null;
-- Then confirm each has a seeded counterpart (same person, different spelling) and add a
-- pair below. The DELETE must run before the UPDATE so the api_id is free (it is unique).

begin;

-- Isabella Villarreal (LA) ← feed "Isabella Villareal"
delete from wpbl_players where team_id = 'LA' and name = 'Isabella Villareal';
update wpbl_players set api_id = 'tjwiwtd9nzc4y23e' where team_id = 'LA' and name = 'Isabella Villarreal';

-- Maggie Foxx (LA) ← feed "Maggie Fox"
delete from wpbl_players where team_id = 'LA' and name = 'Maggie Fox';
update wpbl_players set api_id = 'v4hgumauqrlhu8cl' where team_id = 'LA' and name = 'Maggie Foxx';

-- Valerie Perez (NY) ← feed "Val Perez"
delete from wpbl_players where team_id = 'NY' and name = 'Val Perez';
update wpbl_players set api_id = 'qpz463w9p8a43hmp' where team_id = 'NY' and name = 'Valerie Perez';

-- Gabrielle Haas (BOS) ← feed "Gabriella Haas"
delete from wpbl_players where team_id = 'BOS' and name = 'Gabriella Haas';
update wpbl_players set api_id = '893g5axrjgz1ve0t' where team_id = 'BOS' and name = 'Gabrielle Haas';

commit;
