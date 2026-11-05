# Priorities: every roadmap in one order

> Set **Oct 16, 2026**; realigned **Nov 1, 2026** around the site becoming women's baseball. One
> list across the four roadmaps, so nobody has to merge them in their head:
> [ROADMAP-WPBL.md](ROADMAP-WPBL.md) (WPBL, plus the site-wide ops list and search),
> [ROADMAP.md](ROADMAP.md) (MLB), [ROADMAP-WOMENS-BASEBALL.md](ROADMAP-WOMENS-BASEBALL.md) (the World
> Cup, the site's direction and beyond), [ROADMAP-UI.md](ROADMAP-UI.md) (the visual overhaul), and the
> one plan that lives in `docs/`, [PHOTO_TAGGING.md](docs/PHOTO_TAGGING.md). Each item names where its
> detail is; the detail stays there and is not copied here.
>
> **This file is the order; the four roadmaps are the reasoning.** When an item ships, tick it here
> and in its roadmap. `/admin` → Roadmap (`roadmap_items`) was seeded on Oct 13 from ROADMAP-WPBL's
> priorities and does not know about the World Cup, the UI overhaul or photo tagging; reseed it from
> this file or retire it, rather than keep two orders.

## The rules that set the order

1. **The 2027 WPBL season outranks everything.** The WPBL is the site's audience (WPBL sessions ran
   about 20 to 1 over MLB in the season). Anything that could break on its first game is done by
   March, whatever else is half built.
2. **The site is women's baseball** (decided Nov 1, 2026). The WPBL is the anchor, the World Cup is
   the next competition, and a player has one career across all of them. MLB stays visible, one
   league in the list a reader can click to, no longer half the site. *ROADMAP-WOMENS-BASEBALL, "The direction".*
3. **Winter work is durable or it is nothing.** No guessing at the 2027 feed; season-locked work is
   built in the spring against the real one.
4. **Measure before building more.** Items below that wait on a read of `events` say so.
5. **One person.** Owner-only work (Figma, Play's console, the crosswalk review, outreach) runs beside
   the code, not in its place.

## Done since Oct 16

- ✅ **Crash triage** (Oct 20): all five reader crashes were one bug, the stale-build reload's own
  `vite:preloadError` cancel. *ROADMAP-WPBL, Oct 10 audit, ops item 2.*
- ✅ **The worst layout shifts** (Oct 20): the MLB player page went from 0.39 on a phone to about
  0.03; WPBL's p75 is 0.013. *ROADMAP-WPBL, Priorities P1; ROADMAP.md, "From the Oct 10 audit".*
- ✅ **Photo tagging, first version** (Oct 21). Left: confirm `ip_hash` is filling on the first real
  suggestions. *docs/PHOTO_TAGGING.md, "Launching".*
- ✅ **The largest WPBL files split** (Oct 17): `FanVote.tsx` and `SeasonPage.tsx`.
- ✅ **Database backup outside Supabase** (Oct 31). Left, for the owner: put the private key in a
  password manager. *docs/BACKUPS.md.*
- ✅ **MLB's offseason** (v1.203.0 to v1.205.0): the offseason Home, division winners, winter boards,
  the Hot Stove order.

## Now: November

1. **World Cup stage 0: permission and a complete local dataset.** All done but the permission
   (Nov 2, 2026): every event since 2016 imported, the crosswalk and the same-person review
   confirmed and backed up off this machine, `international.json` built. Owner: chase WBSC (no reply
   recorded since the October email; the second email is due by Nov 10). All still gitignored.
   *ROADMAP-WOMENS-BASEBALL, "The plan", stage 0.*
2. **Google Play release.** Only Play's own process is left. Owner. *ROADMAP-WPBL ops item 9;
   docs/ANDROID.md.*
3. **UI overhaul, phase 1**, now including the women's baseball shell: the league list
   (MLB in it, after the women's competitions) and whether `/` earns a front page. The direction is
   set in code since Nov 3, on the `redesign` branch: WPBL Home is done as the precedent (Nov 4).
   The shell is still open. Handed off on Nov 4: where the branch stands and what is next is
   ROADMAP-UI.md, "Handoff".
   *ROADMAP-UI.md, Phases 1; ROADMAP-WOMENS-BASEBALL, stage 3.*
4. **MLB as one league among several.** Read "MLB: what gets used" on `/admin` and decide what MLB
   keeps on its own pages now that it is no longer half the site. *ROADMAP.md, "Handoff" and item 7 of the second pass.*
5. **Search examples from use**, once "Offered nothing for" has a few weeks in it.
   *ROADMAP-WPBL, "Search: what's next" item 13.*

## Winter: December to March, all of it before the 2027 season

6. **Spring readiness**, the one block that cannot slip past March:
   - ~~the feed rehearsal~~ ✅ built Nov 6 as `npm run rehearse`: the whole feed through the ingest's
     own transforms, diffed with `archive/` and no database writes. 2026 matches row for row; TrackMan's
     `/activity` now wants an API key. Run it again when the feed wakes;
   - ~~`wpbl-postseason-check` failing on missing secrets~~ ✅ Nov 6;
   - ~~a feed contract in `wpbl-ingest`, `summary.errors` meaning failure, and a Discord freshness
     alarm~~ ✅ done Oct 17, deployed Oct 20;
   - ~~the column-partition test for `LIVE_GAME_COLUMNS` and the line column lists~~ ✅ done Oct 17;
   - every Trap in CLAUDE.md re-verified against the 2027 feed once it speaks.
   *ROADMAP-WPBL, ops item 7, Priorities P0 and P2, engineering backlog.*
7. **World Cup stages 1 and 2**: one person across every competition (the person registry and the
   World Cup rows on WPBL player pages: built Nov 2, 2026 as an owner-only preview), then
   `/world-cup` with every event since 2016 and a page for every player in them (Jan to Mar; the
   same-player review it needs is done). Built either way; published on WBSC's yes only. *ROADMAP-WOMENS-BASEBALL, "The plan", stages 1 and 2.*
8. **The live field**, in Game Center on both leagues, before MLB's Opening Day in late March: an
   animated diamond with runners, the count and pitch location. Built on MLB first, because spring
   training is live from late February while the WPBL feed is quiet; WPBL wires to it against the
   2027 feed. *ROADMAP-WPBL, "From the Nov 1, 2026 brainstorm".*
9. **iOS.** A much bigger build than Play, done before the season. *docs/IOS.md.*
10. **UI overhaul, phases 2 and 3**: tokens and type on MUI, then the house components, migrating
    WPBL page by page while its feed is quiet, then MLB. Colors are on tokens and Home is migrated
    (Nov 3 and 4, on `redesign`). Stops in March so the sweep baselines are
    settled before the season. *ROADMAP-UI.md, Phases 2 and 3.*
11. **The women's baseball shell (stage 3)**, built with phase 3 in February and March: the
    league list, with MLB one click away in it. Hard stop on Mar 15; if it is not settled by then it waits
    for October 2027 rather than land under the season. *ROADMAP-WOMENS-BASEBALL, "The plan",
    stage 3.*
12. **Cheap engineering**: past seasons frozen as static JSON (which is also the open-data download),
    a `size-limit` bundle budget in CI. *ROADMAP-WPBL, engineering backlog P2.*

## Spring 2027

13. **The 2027 calendar into the code**: `POSTSEASON_SCHEDULE`, `PICKEM_SEASON` and the award
    constants, once the league publishes. *ROADMAP-WPBL, Priorities P0, "Left for spring".*
14. **The Bluesky rethink**, before the posters wake with the season. *ROADMAP-WPBL, the clock.*
15. **A weekly email digest: decide before the season.** Push drew 12 subscriptions; Discord
    converted 7.7%. Decide whether email is the third channel, not whether to build it now.
    *ROADMAP-WPBL, "From the Nov 1, 2026 brainstorm".*
16. **The pick'em, decided for Opening Day** (parked until then). *ROADMAP-WPBL, Parked.*
17. **The live files onto the type scale** (WPBL's `Live` and `LiveGameView`, MLB's live and
    postseason files), when they return. *ROADMAP.md, Oct 15 audit item 2.*
18. **World Cup read (April)**: `events` on the World Cup rows, the event pages and the
    person pages. It sets how much of stage 5 goes ahead, not whether the site is women's baseball.
    Then `/world-cup/2027` built before Jul 19 and the Finals within the hour, Jul 19 to 25.
    *ROADMAP-WOMENS-BASEBALL, "The plan", stage 4.*

## When the league announces a second season

Started by the announcement (teams, cities, dates), not by the calendar: each needs the real shape
of 2027. Reports say the four clubs move to their home cities and two expansion clubs join; none of
that is confirmed. Detail in *ROADMAP-WPBL, "From the Nov 1, 2026 brainstorm".*

19. **The home-park era** (build): park factors from our own run-expectancy table, home and road
    splits, a page per venue, road trips. None of it could exist while every game was in Springfield.
20. **The press box** (build): game notes before every game, the pack a club hands broadcasters and
    writers. The links it earns are the SEO brake.
21. **Fantasy** (to explore): a free season-long game scored by run value. Only with enough players
    to draft from.
22. **Projections and a season simulator** (to explore): WPBL projections with heavy regression and
    World Cup lines as a prior, projected standings, "sim this matchup".

## Later, when there is room

- **The lineage (P2)**: the AAGPBL (1943–54) and earlier women's pro baseball, history pages and
  "this day in women's baseball", with the Players Association's blessing. *ROADMAP-WOMENS-BASEBALL,
  stage 5.*
- The rest of stage 5: the WPBL developmental league, the continental championships, national
  leagues as sources appear. *ROADMAP-WOMENS-BASEBALL.*
- **MLB depth**: plays and pitches mirrored (2026 alone, measured against the database
  ceiling first), Pitch by pitch and Run value on MLB, fielding lines for Find; the Hot Stove
  follow-up after December's read. *ROADMAP.md, second pass item 6; "From the Oct 10 audit".*
- `/wpbl/data` and the embeddable standings and box-score widget (ops item 8), then a DuckDB-WASM
  sandbox over the frozen season files.
- The rest of the engineering backlog's P3: prefetch on hover, MLB line tables to R2 before the
  ceiling, `html2canvas` replaced, virtualized tables, `fast-check` tests for `derive/`.
- MLB Draft board; Tracked on MLB, if ever.
- Search: spans and splits (needs a date range on Find); firsts (needs a page to link).
- The Visuals list, the data-mining backlog, portrait rights. *ROADMAP-WPBL.*
- UI overhaul phases 4 (motion) and 5 (styling engine).

## Parked, and why

- **Call the Play**: the owner does not rate it; stashed. Ask before picking it up.
- **Favorite-team theming**: color alone did not justify the ask (branch `wpbl-favorite-team`).
- **"This day in the inaugural season"**: nothing to replay until August 2027.
- **Rolling form, WPBL streaks and milestones**: need games, and more than one season of them.
- **Road to Springfield**: dropped for good; do not rebuild.
