# Priorities: every roadmap in one order

> Set **Oct 16, 2026**; realigned **Nov 1, 2026** around the site becoming women's baseball; the November list reset
> **Nov 6** while the redesign waits on Figma; the three large items set in order **Nov 8**. One
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
6. **Three large items, one after another** (set Nov 8, 2026): the redesign, then the World Cup in
   public, then the apps (Android and iOS). Each starts once the one before it is on `main`. The
   season's deadlines (rule 1, item 8, the live field) still outrank all three.

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
- ✅ **World Cup stage 0's data** (Nov 2): every event since 2010 imported (2010 from IBAF's archived
  pages, 2012 and 2014 added Nov 3), the crosswalk and the same-person review confirmed and backed up
  off this machine, `international.json` built. *ROADMAP-WOMENS-BASEBALL, stage 0.*
- ✅ **World Cup stage 1 as an owner-only preview** (Nov 2): `people.json`, one person across every
  competition, and the World Cup rows on WPBL player pages (#183, #184, #182).
- ✅ **World Cup stage 2's pages, dev only** (Nov 2 and 3): editions, games with our own play by play,
  a page for every player, navigation, search and the indexable threshold (#187 to #194).
- ✅ **Search ranked and accent-blind, answered from the browser** (Nov 2, v1.207.0, #186).
- ✅ **`wpbl-postseason-check`** is green: every run through Oct 31 passed, and its schedule only
  covers September and October.

## Now: November, while the Figma file is finished

Set Nov 6, 2026. The `redesign` branch (`../fun-redesign`) is paused on the owner's Figma pass, so
this list is work that does not touch what it is rebuilding: Home, the score strip, the section and
heading components, the shared UI in `src/ui/`. A WPBL page the redesign has not reached yet is fine
to change only if the change is small; anything larger waits so it is not built twice.

1. ~~**The Stats phone bar, landed once.**~~ ✅ Nov 6: #198 merged; the other copy is parked in a stash.
2. ~~**#195 into `redesign` conflicts.**~~ ✅ Nov 6: #195 is mergeable into `redesign` again.
3. ~~**The World Cup goes public.**~~ Moved to after the redesign (decided Nov 7, 2026): it
   publishes once the redesign is on `main`, so its pages launch in the new look and are not
   restyled in public. See Winter, item 11. *ROADMAP-WOMENS-BASEBALL, stage 2, "What is left".*
4. ~~**The feed rehearsal**~~ ✅ Nov 6 as `npm run rehearse` (#200); see Winter, item 8.
5. ~~**Google Play release.**~~ Moved to after the World Cup (decided Nov 8, 2026), with iOS as one
   apps phase. See Winter, item 12.
6. **The Figma file, finished**, including the women's baseball shell: the league list (MLB in it,
   after the women's competitions) and whether `/` earns a front page. Then the redesign resumes at
   Home's step 1, the in-season and postseason Home. Owner. *ROADMAP-UI.md, "Handoff";
   ROADMAP-WOMENS-BASEBALL, stage 3.*
7. ~~**Past seasons frozen as static JSON** (also the open-data download) and a `size-limit` bundle
   budget in CI.~~ ✅ Nov 7: `archive/` published at `/data/wpbl/`, the budgets in
   `.size-limit.js`. *ROADMAP-WPBL, engineering backlog P2.*

**Small, any time this month:**

- ~~Photo tagging: confirm `ip_hash` is filling on the first real suggestions.~~ ✅ Nov 7: the one
  suggestion so far (Oct 21) carries it. *docs/PHOTO_TAGGING.md.*
- The backup's private key into a password manager. Owner. *docs/BACKUPS.md.*
- **MLB as one league among several**: read "MLB: what gets used" on `/admin` and decide what MLB
  keeps on its own pages. *ROADMAP.md, "Handoff" and item 7 of the second pass.*
- `/admin` → Roadmap: reseed it from this file or retire it.
- **Search examples from use**, from late November, once "Offered nothing for" has a few weeks of
  v1.207.0 in it. *ROADMAP-WPBL, "Search: what's next" item 13.*
- ~~The dupe and orphan audit of players and games~~ ✅ Nov 7, clean: 40 finals, each with a box
  score and plays; 118 players, no shared names or feed ids; every line, play and fielding row
  names a known player and game. Rerun once the 2027 feed starts adding rows. Left: the
  portrait-rights ask to the league (owner).
  *ROADMAP-WPBL, "Ongoing hygiene & ops".*

**Not now, because the redesign would redo it:** the live field's drawing (its engine is
under way, Nov 8: docs/LIVE_FIELD.md), the live files on the type
scale, the World Cup's loading states, sweep and public switch, and anything on Home or the WPBL
Stats controls.

## Winter: December to March, all of it before the 2027 season

8. **Spring readiness**, the one block that cannot slip past March:
   - ~~the feed rehearsal~~ ✅ built Nov 6 as `npm run rehearse`: the whole feed through the ingest's
     own transforms, diffed with `archive/` and no database writes. 2026 matches row for row; TrackMan's
     `/activity` now wants an API key. Run it again when the feed wakes;
   - ~~`wpbl-postseason-check` failing on missing secrets~~ ✅ Nov 6;
   - ~~a feed contract in `wpbl-ingest`, `summary.errors` meaning failure, and a Discord freshness
     alarm~~ ✅ done Oct 17, deployed Oct 20;
   - ~~the column-partition test for `LIVE_GAME_COLUMNS` and the line column lists~~ ✅ done Oct 17;
   - every Trap in CLAUDE.md re-verified against the 2027 feed once it speaks.
   *ROADMAP-WPBL, ops item 7, Priorities P0 and P2, engineering backlog.*
9. **UI overhaul, phases 2 and 3** (first of the three large items): the `redesign` branch is this
   work, resumed once the Figma file is done. Home first, then WPBL page by page while its feed is
   quiet, then MLB; it merges to `main` in one piece as v1.208.0. Stops in March so the sweep
   baselines are settled before the season. *ROADMAP-UI.md, "Handoff", Phases 2 and 3.*
10. **The women's baseball shell (stage 3)**, built with phase 3 in February and March: the
    league list, with MLB one click away in it. Hard stop on Mar 15; if it is not settled by then it waits
    for October 2027 rather than land under the season. *ROADMAP-WOMENS-BASEBALL, "The plan",
    stage 3.*
11. **The World Cup goes public, in four phases, independent of the redesign** (Nov 13, 2026, replacing
   the Nov 7 order below): WPBL player pages first, then the national team across the WPBL, the
   section unindexed, then search and indexing. Phase 1 shipped Nov 13; no notice goes to WBSC (owner).
   *ROADMAP-WOMENS-BASEBALL, "The rollout in phases".*
   The Nov 7 plan, kept for its list: **the World Cup goes public, after the redesign** (second of the three; decided Nov 7, 2026). It publishes
   on implied permission, the footing the WPBL feed is on: WBSC's reply is no longer the gate, and
   a "no" still ends it. In order, once the redesign is on `main`: the pages in the new look, their
   loading states and the sweep, the audit's polish (the gray "TPE" badge, leader portraits, a
   title per page, small header contrast), then the public switch rebuilt on `main` from its list
   (`archive/wbsc/` into git with a size budget, `_redirects`, `_routes.json` and their 404 guards,
   `seo.ts`, the sitemap reading `indexable`, the dev flags removed), with the safeguards: our own
   play text only, every game credited and linked to wbsc.org, no WBSC video, photos or marks, and
   a Sources entry with a takedown contact. No notice goes to WBSC (owner, Nov 13, 2026).
   2004 to 2008 as results-only editions ✅ Nov 7, 2026.
   *ROADMAP-WOMENS-BASEBALL, "The plan", stage 2.*
12. **The apps, Android and iOS** (third of the three; after the World Cup, decided Nov 8, 2026).
    Android first: the code is done and only Play's own process is left (account, upload, listing,
    then 12 testers for 14 days, the long pole). Owner. iOS is a much bigger build: the home-screen
    PWA on a real iPhone first (it might end the project), then the Team ID, the auth rewrite with
    Sign in with Apple, the Capacitor build on a Mac, APNs, Live Activities. If it cannot ship
    before the season, it waits rather than land under it (rule 1). *ROADMAP-WPBL ops item 9;
    docs/ANDROID.md; docs/IOS.md.*
13. **The live field**, in Game Center on both leagues, before MLB's Opening Day in late March: an
    animated diamond with runners, the count and pitch location. It runs on its date, not in the
    queue above: built on the redesigned Game Center, on MLB first, because spring training is live
    from late February while the WPBL feed is quiet; WPBL wires to it against the 2027 feed.
    The engine, apart from the drawing, started Nov 8 (docs/LIVE_FIELD.md).
    *ROADMAP-WPBL, "From the Nov 1, 2026 brainstorm".*
13a. **Live notes** (decided Nov 10, 2026): every first, record, milestone and streak a game produces,
    all of them in /admin and the top few for readers. The engine and its backtest first (works on the
    frozen 2026 files), then the owner console this winter, then the readers' strip on the redesigned
    Game Center beside the live field. WPBL only. *ROADMAP-WPBL, "Live notes".*

## Spring 2027

14. **The 2027 calendar into the code**: `POSTSEASON_SCHEDULE`, `PICKEM_SEASON` and the award
    constants, once the league publishes. *ROADMAP-WPBL, Priorities P0, "Left for spring".*
15. **The Bluesky rethink**, before the posters wake with the season. *ROADMAP-WPBL, the clock.*
16. **A weekly email digest: decide before the season.** Push drew 12 subscriptions; Discord
    converted 7.7%. Decide whether email is the third channel, not whether to build it now.
    *ROADMAP-WPBL, "From the Nov 1, 2026 brainstorm".*
17. **The pick'em, decided for Opening Day** (parked until then). *ROADMAP-WPBL, Parked.*
18. **The live files onto the type scale** (WPBL's `Live` and `LiveGameView`, MLB's live and
    postseason files), when they return. *ROADMAP.md, Oct 15 audit item 2.*
19. **World Cup read (April)**: `events` on the World Cup rows, the event pages and the
    person pages. It sets how much of stage 5 goes ahead, not whether the site is women's baseball.
    Then `/world-cup/2027` built before Jul 19 and the Finals within the hour, Jul 19 to 25.
    *ROADMAP-WOMENS-BASEBALL, "The plan", stage 4.*

## When the league announces a second season

Started by the announcement (teams, cities, dates), not by the calendar: each needs the real shape
of 2027. Reports say the four clubs move to their home cities and two expansion clubs join; none of
that is confirmed. Detail in *ROADMAP-WPBL, "From the Nov 1, 2026 brainstorm".*

**Home's 2027 Rosters card** ([`home/RostersCard.tsx`](src/wpbl/home/RostersCard.tsx), shipped Nov 9,
2026 for the re-signing window) grows one phase at a time, each only once the league publishes it:
the draft and combine dates (`DRAFT_DATE` / `COMBINE_DATE` in `offseason2027.ts`, null until then);
the draft itself (a `drafted` move kind in /admin, picks by round, each club's count toward 20); free
agency (a `signed` kind, same count); then the schedule, when the card becomes Opening Day and
`offseasonByCalendar` starts turning Home back.

20. **The home-park era** (build): park factors from our own run-expectancy table, home and road
    splits, a page per venue, road trips. None of it could exist while every game was in Springfield.
21. **The press box** (build): game notes before every game, the pack a club hands broadcasters and
    writers. The links it earns are the SEO brake.
22. **Fantasy** (to explore): a free season-long game scored by run value. Only with enough players
    to draft from.
23. **Projections and a season simulator** (to explore): WPBL projections with heavy regression and
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
- The embeddable standings and box-score widget (ops item 8; `/wpbl/data` shipped Nov 8), then a DuckDB-WASM
  sandbox over the frozen season files.
- The rest of the engineering backlog's P3: prefetch on hover, `html2canvas` replaced, virtualized tables, `fast-check` tests for `derive/`.
- MLB Draft board; Tracked on MLB, if ever.
- Search: the rest of spans (a series, a doubleheader, extra innings; months and date ranges ✅ Nov 10,
  v1.226.0) and a player's own firsts. Firsts ✅ (Nov 9, v1.216.0; runners' plays Nov 10, v1.232.0).
- The Visuals list, the data-mining backlog, portrait rights. *ROADMAP-WPBL.*
- UI overhaul phases 4 (motion) and 5 (styling engine).

## Parked, and why

- **Call the Play**: the owner does not rate it; stashed. Ask before picking it up.
- **Favorite-team theming**: color alone did not justify the ask (branch `wpbl-favorite-team`).
- **"This day in the inaugural season"**: nothing to replay until August 2027.
- **Rolling form, WPBL streaks and milestones**: need games, and more than one season of them.
- **Road to Springfield**: dropped for good; do not rebuild.
