# Priorities: every roadmap in one order

> Set **Oct 16, 2026**. One list across the four roadmaps, so nobody has to merge them in their head:
> [ROADMAP-WPBL.md](ROADMAP-WPBL.md) (WPBL, plus the site-wide ops list and search),
> [ROADMAP.md](ROADMAP.md) (MLB), [ROADMAP-WOMENS-BASEBALL.md](ROADMAP-WOMENS-BASEBALL.md) (the World
> Cup and beyond), [ROADMAP-UI.md](ROADMAP-UI.md) (the visual overhaul), and the one plan that lives in
> `docs/`, [PHOTO_TAGGING.md](docs/PHOTO_TAGGING.md). Each item names where its detail is; the detail
> stays there and is not copied here.
>
> **This file is the order; the four roadmaps are the reasoning.** When an item ships, tick it here
> and in its roadmap. `/admin` → Roadmap (`roadmap_items`) was seeded on Oct 13 from ROADMAP-WPBL's
> priorities and does not know about the World Cup, the UI overhaul or photo tagging; reseed it from
> this file or retire it, rather than keep two orders.

## The rules that set the order

1. **The 2027 WPBL season outranks everything.** The WPBL is the site's audience (WPBL sessions ran
   about 20 to 1 over MLB in the season). Anything that could break on its first game is done by
   March, whatever else is half built.
2. **Winter work is durable or it is nothing.** No guessing at the 2027 feed; season-locked work is
   built in the spring against the real one.
3. **Measure before building more.** Three items below wait on a read of `events`, not on a decision.
4. **One person.** Owner-only work (Figma, Play's console, the crosswalk review, outreach) runs beside
   the code, not in its place.

## Now: the week of Oct 16 to 25

1. **Crash triage** from the build-tagged `app_error` rows, around Oct 18. Five suspects listed.
   *ROADMAP-WPBL, Oct 10 audit, ops item 2.*
2. **The worst layout shifts** from the attributed field reports, around Oct 18: `/wpbl/stats` and
   MLB Home on a desktop, which reproduce clean locally. *ROADMAP-WPBL, Priorities P1; ROADMAP.md,
   "From the Oct 10 audit".*
3. **Google Play release.** Only Play's own process is left. Owner. *ROADMAP-WPBL ops item 9;
   docs/ANDROID.md.*
4. **World Cup crosswalk review**, and a private copy of the decisions off this machine. Owner;
   needs no permission. *ROADMAP-WOMENS-BASEBALL, "Pick up here" steps 1 and 2.*

## Next: Oct 25 to the end of November

5. **Photo tagging, first version.** 115 fan photos sit unpublished for want of a name, so this
   turns into gallery content directly. Plan written. *docs/PHOTO_TAGGING.md.*
6. **The World Cup back catalog and `international.json`.** 2024, 2023, 2018, 2016 imported and
   validated, the provisional pitch-board bars re-measured, the per-player file built and tested, all
   still gitignored. *ROADMAP-WOMENS-BASEBALL, steps 3 to 5.*
7. **MLB after Nov 1.** The offseason Home switches itself on. Then: read "MLB: what gets used" on
   `/admin` and decide what moves into More; take Standings and the player card's `cards.tsx` off the
   type-scale legacy list once the bracket mode retires. *ROADMAP.md, "Handoff" and item 7 of the
   second pass.*
8. ✅ **Finish splitting the largest WPBL files** (Oct 17): `FanVote.tsx` and `SeasonPage.tsx`. *ROADMAP.md,
   "From the Oct 15 audit" item 6.*
9. **UI overhaul, phase 1 (Figma only).** Mood board, tokens in both themes, four screens on a phone
   and a desktop, the open questions decided. Owner; no code until a direction is picked.
   *ROADMAP-UI.md, Phases 1.*
10. **Search examples from use**, once "Offered nothing for" has a few weeks in it (early November).
    *ROADMAP-WPBL, "Search: what's next" item 13.*

## Winter: December to March, all of it before the 2027 season

11. **Spring readiness**, the one block that cannot slip past March:
    - the feed rehearsal: replay the archived 2026 feed into a scratch schema and diff it (also the
      real test of multiple seasons);
    - `wpbl-postseason-check` failing on missing secrets;
    - a feed contract in `wpbl-ingest` (valibot or zod), `summary.errors` meaning failure, and a
      Discord freshness alarm;
    - the column-partition test for `LIVE_GAME_COLUMNS` and the line column lists;
    - every Trap in CLAUDE.md re-verified against the 2027 feed once it speaks.
    *ROADMAP-WPBL, ops item 7, Priorities P0 and P2, engineering backlog.*
12. **iOS.** A much bigger build than Play, done before the season. *docs/IOS.md.*
13. **Cheap engineering**: past seasons frozen as static JSON (which is also the open-data download),
    a `size-limit` bundle budget in CI. *ROADMAP-WPBL, engineering backlog P2.*
14. **World Cup phases 1 and 2, on WBSC's yes only**: the International row on WPBL player pages
    (Nov to Jan), then the back catalog on the page and `/world-cup/2026` and `/2024` (Jan to Mar). On
    a no, delete the data and stop. *ROADMAP-WOMENS-BASEBALL, Phases.*
15. **UI overhaul, phases 2 and 3**: tokens and type on MUI, then the house components, migrating
    WPBL page by page while its feed is quiet, then MLB. Stops in March so the sweep baselines are
    settled before the season. *ROADMAP-UI.md, Phases 2 and 3.*
16. **MLB plays and pitches**: mirror 2026 alone and measure it against the database ceiling before
    any backfill, then Pitch by pitch and Run value on MLB; fielding lines in the mirror for Find.
    *ROADMAP.md, second pass item 6, steps 4 and 6.*
17. **Hot Stove follow-up**: read "MLB: what gets used" in December before building a page of its
    own or tracking the free-agent class. *ROADMAP.md, "From the Oct 10 audit".*

## Spring 2027

18. **The 2027 calendar into the code**: `POSTSEASON_SCHEDULE`, `PICKEM_SEASON` and the award
    constants, once the league publishes. *ROADMAP-WPBL, Priorities P0, "Left for spring".*
19. **The Bluesky rethink**, before the posters wake with the season. *ROADMAP-WPBL, the clock.*
20. **The pick'em, decided for Opening Day** (parked until then). *ROADMAP-WPBL, Parked.*
21. **The live files onto the type scale** (WPBL's `Live` and `LiveGameView`, MLB's live and
    postseason files), when they return. *ROADMAP.md, Oct 15 audit item 2.*
22. **World Cup decision point (April)**: read `events` on the International row and the event
    pages; go, smaller or stop. On a go, `/world-cup/2027` built before Jul 19, then the Finals
    within the hour, Jul 19 to 25, alongside the WPBL season. *ROADMAP-WOMENS-BASEBALL, Phases 3
    and 4.*

## Later, when there is room

- `/wpbl/data` and the embeddable standings and box-score widget (ops item 8), then a DuckDB-WASM
  sandbox over the frozen season files.
- The rest of the engineering backlog's P3: prefetch on hover, MLB line tables to R2 before the
  ceiling, `html2canvas` replaced, virtualised tables, `fast-check` tests for `derive/`.
- MLB Draft board; Tracked on MLB, if ever.
- Search: spans and splits (needs a date range on Find); firsts (needs a page to link).
- The Visuals list, the data-mining backlog, portrait rights. *ROADMAP-WPBL.*
- UI overhaul phases 4 (motion) and 5 (styling engine).
- The site as "women's baseball" (navigation stage 3), only if the World Cup earns it, designed with
  the UI overhaul.

## Parked, and why

- **Call the Play**: the owner does not rate it; stashed. Ask before picking it up.
- **Favourite-team theming**: colour alone did not justify the ask (branch `wpbl-favorite-team`).
- **"This day in the inaugural season"**: nothing to replay until August 2027.
- **Rolling form, WPBL streaks and milestones**: need games, and more than one season of them.
- **Road to Springfield**: dropped for good; do not rebuild.
