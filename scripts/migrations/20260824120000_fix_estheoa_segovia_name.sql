-- A real player's name has been rendering wrong since the seed: we hold "Estheoa Segovia",
-- and she is Esthela (Liliana Esthela Segovia Arredondo, SF, from Tijuana). "Estheoa" is a
-- transcription typo in scripts/seed_wpbl_rosters.sql, not a feed value: aa8742df… carries
-- api_id null, no api_ids and zero box-score lines, so wpbl-ingest has never matched or
-- touched her. That is exactly why this is a plain UPDATE and safe: the ingest only writes
-- players it links to a feed id, so nothing will revert the fix, and there is no feed row to
-- fold in (a search for any Segovia returns this one row).
--
-- Her slug is derived from the name at read time (slugifyName), so this also moves her
-- canonical URL from /wpbl/players/estheoa-segovia to /wpbl/players/esthela-segovia. The old
-- spelling was in the sitemap but has near-zero traffic and named nobody real, so no redirect
-- is warranted; `npm run sitemap` will re-emit the corrected URL on its daily cron.
--
-- Guarded on the old name so a re-run is a no-op rather than clobbering a later correction.
do $$
declare
  pid uuid := 'aa8742df-a02f-461a-a266-94565b5e19d3';
begin
  update wpbl_players
     set name = 'Esthela Segovia'
   where id = pid
     and name = 'Estheoa Segovia';

  if not found then
    raise notice 'wpbl: Segovia name already corrected (or row % gone), nothing to do', pid;
  end if;
end;
$$;
