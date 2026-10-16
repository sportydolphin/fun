# Women's Baseball Roadmap

> The slow move from "the WPBL and MLB" toward **women's baseball, all of it**. Scoped Oct 15, 2026.
> Companion docs: [ROADMAP-WPBL.md](ROADMAP-WPBL.md) (the league this grows out of) and
> [ROADMAP.md](ROADMAP.md) (MLB). Nothing here outranks the 2027 WPBL work.

## The approach

One person, so: **grow from the players outward, one competition at a time, and stop at any
step that does not earn the next.** The first step is the smallest useful one: a WPBL player's
page shows what they did for their national team. Each later phase has a decision point with a
measurement attached, and "stop here" is always an acceptable answer.

Three constraints shape every phase:

- **Storage.** The database is about 305 MB against what is probably a 500 MB ceiling (the
  Oct 10 audit in ROADMAP-WPBL). Nothing in this plan writes to Supabase until a phase proves it
  must (see [Storage](#storage)).
- **Effort.** Every competition added is a source that can break. Depth on the players we already
  cover beats breadth across leagues nobody here follows yet.
- **Navigation.** No new section in the nav until there is more than one thing to put in it (see
  [Navigation](#navigation)).

---

## What data exists (probed Oct 15, 2026)

| Source | What it has | Years | Form | Verdict |
|---|---|---|---|---|
| **WBSC Women's Baseball World Cup** | Box scores, line scores, attendance, duration, and a play log; **pitch by pitch from 2023 on**, plate appearances only in 2018 | 2016, 2018, 2023, 2024, 2026 (and 2027) | JSON embedded in each wbsc.org game page (`data-page`, an Inertia app), not a published API | **Yes, pending terms** |
| WBSC continental championships (Pan Am, Asian Cup, Europe) | Probably the same system; the event keys were not found in the probe | 2025 cycle | Unverified | Check in phase 3 |
| Japan's Venus League, national championships (AUS, CAN, US) | Nothing machine-readable found | | | No, until a source appears |
| AAGPBL (1943–54) | Season lines on Baseball-Reference's Bullpen, sourced from the AAGPBL Players Association; a printed record book (copyrighted) | 1943–54 | HTML, print | Maybe, only with permission |
| RetroWPBL | Hand-transcribed WPBL scoring, already used for game duration | 2026 | | Already in use |

**What one World Cup game looks like.** USA at Korea, Jul 22, 2026 (game 201054): 211 play rows,
177 of them pitches with the count, runner movement on every base, the scorer's narrative
("BAUM Jamie Parkinson walks."), the batter and pitcher ids, and a UTC timestamp. Batting,
pitching and fielding lines per player. No hit location or velocity (the fields exist, always 0).
That is the same depth as the WPBL feed minus TrackMan, which means the neutral engines in
`src/league/` (bests, the finder, run expectancy) can run on it.

**The 2026 group stage, all 30 games.** Rockford (Jul 22–26): USA 5–0, Australia 4–1, Canada 3–2
advance. Tainan (Aug 25–27, after two rained-out days): Japan 5–0, Venezuela 4–1, Chinese Taipei
3–2 advance. The Finals are reported for Rockford, **Jul 19–25, 2027**. 239 players on 12 rosters,
3,827 play rows.

**The overlap with the WPBL: 32 of the WPBL's 118 players** played in the 2026 group stage, by
name match (hand verification still needed): 8 USA, 8 Australia, 8 Canada, 5 Mexico, 2 Korea,
1 Great Britain. **None of the WPBL's nine Japanese players** was on Japan's roster, which is
drawn from the domestic game. So the first feature covers about a quarter of the league, and most
of the clubs' best-known names.

**Two facts that shape the build:**

- **WBSC player ids are per tournament.** Kelsie Whitmore is 23026 in 2018, 310867 in 2023 and
  764325 in 2026. There is no persistent id to join on, so the link between a WBSC row and a WPBL
  player is ours to keep: a hand-checked crosswalk, one row per player per tournament. Never name
  matching at runtime (WBSC writes full legal names: "Kelsie Ann-Gamboa WHITMORE").
- **The source is a web page, not an API.** The data rides in the page's props and can change
  shape on any WBSC deploy. The import must validate what it reads and fail loudly, the same rule
  as the archive export.

**Still unknown: the terms.** No terms-of-use link was found in the page markup. Before anything
ships, email WBSC (media or communications) saying what the site is, what it would show, and that
it links every game back to wbsc.org. Ask; do not assume.

---

## Storage

**Finished events are immutable, so they are files, not rows.** A World Cup that has ended never
changes. Each event becomes one trimmed JSON file in the repo (like `archive/`), served from
Cloudflare's cache, read by the browser. Supabase is not touched.

Sizes, measured on the 2026 group stage:

- Raw WBSC payloads: about 700 KB a game, 21 MB for 30 games. **Never committed.**
- Trimmed to the fields we read: about 630 KB for the whole 30-game play log, plus the box lines.
- Every World Cup since 2016 (about 190 games) trims to an estimated 5 to 8 MB of files, all of it
  static. For scale, the WPBL's 2026 season in `archive/` is 6 MB.

Rules for the audit, enforced rather than remembered:

1. A size budget in CI for the event files, like a bundle budget: a new event that blows it fails
   the build instead of quietly growing the deploy.
2. The import writes only an allow-list of fields; a new WBSC field does not ride along.
3. The crosswalk (WBSC tournament player id to WPBL player id) is a small checked-in file.
4. The only data that ever needs a live path is the 2027 Finals while it is being played (phase 4),
   and even that can be a cached proxy rather than a table.

---

## Navigation

Three stages, each earned by the one before. Nothing in the first two changes the nav.

1. **A row on the player page.** "International" under the WPBL lines: the country flag or code,
   the event, the line (G, PA, AVG/OPS or IP, ERA, K), linking to the game on wbsc.org. Shows only
   for players who have one, so 86 of 118 pages look exactly as they do now.
2. **Event pages, reached from the player rows and from search.** `/world-cup/2026`: standings by
   group, results, each game's box score, leaders, and the WPBL players in the field highlighted.
   A top-level route (two `_redirects` lines, `routes.ts`, `seo.ts`, the sitemap) because it is
   not the WPBL's and should not live under `/wpbl`. It is also search traffic nobody else
   answers well: "women's baseball world cup stats" has no good result today.
3. **Only if earned: the site becomes "women's baseball".** WPBL and the World Cup as siblings in
   the shell, MLB moved aside (kept, spun off to its own domain, or frozen; a separate decision).
   Designed alongside the UI overhaul in flight (the `ui-roadmap` branch), not before it.

---

## Phases and timeline

| When | Phase | Done when |
|---|---|---|
| **Oct–Nov 2026** | **0. Permission, and the back end built behind it.** Email WBSC, Baseball Prospectus and RetroWPBL. Meanwhile build the importer and the crosswalk, with the data kept out of git ([docs/WBSC_INGEST.md](docs/WBSC_INGEST.md)). | A reply from WBSC, all 30 group games passing validation, and the 32 name matches checked. |
| **Nov 2026–Jan 2027** | **1. International row on WPBL player pages**, from the 2026 group stage. An import script (`scripts/`, run by hand) writes the trimmed file; the player page reads it. | The 32 players' pages show their World Cup line, linked to wbsc.org. |
| **Jan–Mar 2027** | **2. The back catalog and the event pages.** 2016, 2018, 2023, 2024 for the same players (an international career line), then `/world-cup/2026` and `/world-cup/2024`. | A player's page shows every World Cup they played; two event pages are live and in the sitemap. |
| **April 2027** | **Decision point.** Read `events`: do people open the International row and the event pages, and does search bring anyone to them? | Go, smaller, or stop. Written here. |
| **May–Jun 2027** | **3. Ready for the Finals**, only on a go. Pre-build `/world-cup/2027` from the schedule; check the continental championships' data while there. | The page exists with the schedule and rosters before Jul 19. |
| **Jul 19–25, 2027** | **4. The Finals, results within the hour.** A job that re-imports during event week only, then freezes. Not a live Game Center: the 2027 WPBL season is running at the same time and gets the attention. | Every Finals game on the site within an hour of the last out; frozen to a file after. |
| **Late 2027 on** | **5. Maybe.** Navigation stage 3. The continental qualifiers. AAGPBL history with the Players Association's blessing. A domestic league if one publishes data. | Each is its own decision, not a commitment made here. |

Rough effort, for one person: phase 0 is an afternoon plus waiting; phase 1 is a weekend; phase 2
is two or three; phase 4 is mostly unattended once phase 3 is done.

---

## Risks

- **Terms.** The biggest one. A "no" from WBSC ends phases 1 to 4 for their data; the crosswalk
  and the design would still serve a different source.
- **The page shape changes.** The import validates and fails; nothing reads WBSC at runtime until
  phase 4.
- **A wrong crosswalk row** puts someone else's line on a player's page. Hand-checked, and a player
  page shows the WBSC name it matched so a reader can spot a mistake.
- **The Finals overlap the 2027 WPBL season.** Some WPBL players will be away from their clubs that
  week, which is worth a line on the WPBL side too (availability, not just stats).
- **Scope creep.** The phase table is the scope. A new competition goes through the data table
  above first.
