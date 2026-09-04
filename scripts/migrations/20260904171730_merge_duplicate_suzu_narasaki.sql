-- merge duplicate suzu narasaki
-- Created 2026-09-04. Applied by scripts/migrate.mjs.
--
-- Suzu Narasaki was listed twice on the site, once per club, and one of the two had no stats.
--
-- She was traded: she batted for Los Angeles through Aug 15, 2026 and has been a Heights
-- player since Aug 27. The duplicate was born on the day of the trade. At 22:18 UTC that
-- evening, an hour before first pitch, the ingest read a STAGED lineup for LA at NY that
-- carried her twice, spelled two different ways: "Suzu Narasaki" under New York, which is
-- her, and "Suzu Naraski" under Los Angeles, which is a typo the league later fixed. Today's
-- final box score for that game spells her correctly on both sides.
--
-- Every matcher except one is scoped to a single club, and the one that reaches across clubs
-- (`tradeMatch`) demands the name be spelled exactly, deliberately: it is the only rule that
-- could merge two genuinely different people. A misspelling on the far club is therefore the
-- exact shape it cannot see, so the ingest did the only other thing it can and inserted a new
-- roster row. It landed with no feed id, no position, no status, no draft history and no
-- birthday, because a box-score entry is all the feed gave it.
--
-- The ingest side is fixed in supabase/functions/wpbl-ingest/index.ts: a box score for a game
-- nobody has played can no longer INSERT a player, for the same reason it can no longer move
-- one. A staged lineup is a plan, and this is what believing one costs when the plan has a
-- typo in it. Scanned the whole 119-row roster afterwards: this was the only near-duplicate
-- pair and the only id-less row created since the draft seed.
--
-- Guarded so this is a no-op rather than an error if the pair was already merged by hand.
do $$
declare
  keep uuid := 'c2c0093d-4394-48a7-9cca-e2fd2b82133b';  -- Suzu Narasaki, seeded (NY)
  dupe uuid := 'c0836216-7f23-44c6-bb69-dafb8dec0489';  -- Suzu Naraski, feed-inserted (LA)
begin
  if not exists (select 1 from wpbl_players where id = dupe) then
    raise notice 'wpbl: Narasaki duplicate % already gone, nothing to merge', dupe;
    return;
  end if;

  -- Keep the older row without needing to argue about it: it holds all seven of her games,
  -- both feed ids, the draft position, the birthday and the spelling the league uses, and it
  -- is the id every existing link, share card and Discord post already points at. The
  -- duplicate has nothing to contribute but its uniform number, and it wore that for the club
  -- she had already left, so `coalesce` in wpbl_merge_players correctly keeps her 16.
  perform wpbl_merge_players(keep, dupe);
end;
$$;

-- Her club is not in question and is deliberately not touched here: `team_id` is already NY,
-- which is what her newest box-score line says, and `team_as_of` is already past the trade.
