# Women's Baseball Roadmap

> The move from "the WPBL and MLB" to **women's baseball, all of it**. Scoped Oct 15, 2026; the
> direction decided and the plan rewritten **Nov 1, 2026**. Companion docs:
> [ROADMAP-WPBL.md](ROADMAP-WPBL.md) (the league this grows out of), [ROADMAP.md](ROADMAP.md) (MLB),
> and [docs/WBSC_INGEST.md](docs/WBSC_INGEST.md) (how the World Cup import works). Nothing here
> outranks the 2027 WPBL work; where each step sits against the rest is
> [ROADMAP-PRIORITIES.md](ROADMAP-PRIORITIES.md).

## The direction (decided Nov 1, 2026)

**The site becomes a women's baseball site.** The WPBL is the anchor and the default. The World Cup
is the next competition. A player has **one career across every competition**, on one page, which
nobody offers today. **MLB stays, as one league in the list**: always visible and one click away,
but the site no longer presents itself as half MLB, and every `/mlb` URL keeps working.

What this replaces: the old plan held the change of identity back as "navigation stage 3, only if
earned", after an April read of the World Cup's traffic. The identity is now decided. The April read
still happens, and it now sets how far and how fast stage 5 goes, not whether the site is women's
baseball. The traffic already argues for it: WPBL sessions ran about 20 to 1 over MLB in the season.

## Where it stands (Nov 1, 2026)

Stage 0 is half done: the back end is built and waiting on WBSC's permission and the owner's review.

| Done | What | Where |
|---|---|---|
| Oct 15 | Scope, data probe of every World Cup since 2016, this roadmap | this file |
| Oct 16 | The importer: wbsc.org pages into validated files, all 30 games of the 2026 group stage passing | [sportydolphin/fun#122](https://github.com/sportydolphin/fun/pull/122), [docs/WBSC_INGEST.md](docs/WBSC_INGEST.md) |
| Oct 16 | The crosswalk proposer: 39 candidate WBSC-to-WPBL matches for a person to confirm | [sportydolphin/fun#123](https://github.com/sportydolphin/fun/pull/123) |
| Nov 1 | The direction decided; this plan | this file |
| Nov 2 | The back catalog: all seven events, 170 games; the crosswalk review page (`--review`) | [docs/WBSC_INGEST.md](docs/WBSC_INGEST.md) |

**Open as of Nov 2:** no reply from WBSC is recorded; the crosswalk review (134 candidates, every
event 2016 to 2026) is in progress in the review file, 130 marked and 4 open, with no reviewer named
and nothing confirmed, so `crosswalk.json` holds no links yet. Steps 1, 3 and 4 below are done on
this machine.

**Waiting on:** replies to the owner's outreach (WBSC for permission; Baseball Prospectus and
RetroWPBL as neighbors, see [Neighbors](#neighbors)). Record each reply here, with its date.

**Nothing is on the site, and no WBSC data is in git.** The repository is public, so committing
the data would publish it. Everything WBSC-derived lives in two gitignored folders on the machine
that ran the import: `.wbsc-cache/` (the downloaded pages) and `archive/wbsc/` (the output and the
crosswalk).

## Pick up here: stage 0

In order. Each step says what done looks like; the commands are in
[docs/WBSC_INGEST.md](docs/WBSC_INGEST.md).

1. **Restore the local data if this is a fresh machine.** Re-run the import for every event done so
   far (today the two 2026 groups: `npm run wbsc -- --list` prints the keys), about 30 requests per
   event, 1.5 s apart. Done when each event's folder is back in `archive/wbsc/`. The crosswalk
   cannot be re-downloaded: see the warning under step 2.
2. **Review the crosswalk.** `npm run wbsc -- --propose`, then in
   `archive/wbsc/crosswalk-review.json` put a name in `checked_by` and a `yes` or `no` on each
   candidate, then `npm run wbsc -- --confirm`. Or `npm run wbsc -- --review`, which does the same on a
   page with the facts beside each pair. Every event together proposes 134: 97 by full name, 37 by
   surname and something weaker (an initial, a middle name, a nickname, a near spelling), 11 in
   conflict with another. Done when the review file is empty.
   **The decisions are hand work held only in a gitignored file.** Until permission lets it into
   git, keep a private copy of `archive/wbsc/crosswalk.json` somewhere other than this machine.
3. ✅ **Import the back catalog** (Nov 2, 2026). `npm run wbsc -- --all` writes all seven events,
   170 games and 11,440 plays, every game checked against itself four ways; what it took (new
   codes, a reader for 2016's prose play log, eight games wrong at the source) is in
   [docs/WBSC_INGEST.md](docs/WBSC_INGEST.md#build-order).
4. ✅ **Re-measure the provisional numbers** (Nov 2, 2026): the pitch-board bars in
   `src/intl/league.ts`, now from every event.
5. **Build `international.json`**, the one file a WPBL player page will read: per WPBL player, each
   event's batting and pitching totals and the games behind them, from the confirmed crosswalk. It
   can be built and tested now; it stays gitignored like the rest.
6. **On permission** (and only then): take `archive/wbsc/` out of `.gitignore` (the cache stays
   ignored), add a size budget for it in CI, commit the data, and publish stage 1 below. On a "no":
   delete the two folders and keep the code for another source.

## The approach

One person, so: **grow from the players outward, one competition at a time.** Each competition
after the World Cup is its own decision with a measurement attached, and "not this one" is always
an acceptable answer. The identity of the site is no longer one of those decisions.

Three constraints shape every stage:

- **Storage.** The database was about 305 MB in October, against the Pro plan's 8 GB disk (the
  Oct 10 audit in ROADMAP-WPBL). Nothing in this plan writes to Supabase until a stage proves it
  must (see [Storage](#storage)).
- **Effort.** Every competition added is a source that can break. Depth on the players we already
  cover beats breadth across leagues nobody here follows yet.
- **The season.** The 2027 WPBL season outranks all of it. Anything that touches the shell lands by
  Mar 15 or waits until October 2027.

---

## What data exists (probed Oct 15, 2026)

| Source | What it has | Years | Form | Verdict |
|---|---|---|---|---|
| **WBSC Women's Baseball World Cup** | Box scores, line scores, attendance, duration, and a play log; **pitch by pitch from 2023 on, and in 2016 (written as prose)**, plate appearances only in 2018 | 2016, 2018, 2023, 2024, 2026 (and 2027) | JSON embedded in each wbsc.org game page (`data-page`, an Inertia app), not a published API | **Yes, pending terms** |
| WBSC continental championships (Pan Am, Asian Cup, Europe) | Probably the same system; the event keys were not found in the probe | 2025 cycle | Unverified | Check in stage 5 |
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

**The overlap with the WPBL: about 36 of the WPBL's 118 players** played in the 2026 group stage.
The first probe found 32 by exact name (8 USA, 8 Australia, 8 Canada, 5 Mexico, 2 Korea, 1 Great
Britain); the crosswalk proposer also finds the roster's nicknames and an O'Sullivan WBSC spells
"O ` SULLIVAN". Hand verification decides the final count. **None of the WPBL's nine Japanese players** was on Japan's roster, which is
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

Sizes, measured on the 2026 group stage by the built importer:

- Raw WBSC pages: about 700 KB a game. The importer caches only each game's data, gzipped: about
  800 KB for all 30. **Never committed.**
- Output: 1.5 MB for the 30 games, 1.3 MB of it the play log.
- Every World Cup since 2016 (about 190 games) comes to an estimated 8 to 10 MB of files, all of it
  static. For scale, the WPBL's 2026 season in `archive/` is 6 MB.

Rules for the audit, enforced rather than remembered:

1. A size budget in CI for the event files, like a bundle budget: a new event that blows it fails
   the build instead of quietly growing the deploy. Added with publication, when the files first
   enter git.
2. The import writes only an allow-list of fields; a new WBSC field does not ride along. (Built.)
3. The crosswalk (WBSC tournament player id to WPBL player id) is a small file beside the events,
   gitignored with them until permission. (Built.)
4. The only data that ever needs a live path is the 2027 Finals while it is being played (stage 4),
   and even that can be a cached proxy rather than a table.

---

## Neighbors

Almost nobody covers these stats, and the few who do are partners, not rivals. The one that
matters is the data's owner.

| Who | What they do | How we treat them |
|---|---|---|
| **WBSC** | Owns the box scores and play logs; sponsors and video rights on its pages | Ask first. Credit and link every game back to wbsc.org. Never use its video or photos. A "no" ends the World Cup part. |
| **Baseball Prospectus' women's baseball site** | Pitch and hit tracking from the 2019-era World Cup ([SABR piece](https://sabr.org/latest/ramos-bringing-tracking-data-to-womens-baseball)); may be dormant | Reach out; their tracking beside our box scores is a natural pairing. |
| **Baseball-Reference Bullpen** | Wiki pages with tournament line scores and rosters | Link to it, never copy from it. |
| **RetroWPBL** | A hand transcription of WPBL scoring, used here with permission | If it ever goes international, coordinate rather than race. |
| **The writers on Reading** | Analysis, not stats | The readers who most want this data; every new page can send people to them. |
| **National federations, MLB.com, local press** | News and recaps that link to WBSC box scores | Sources of links to us, not competition. |

What would be new: one player's career across competitions on one page. Nobody does that today.
The rules are the ones Reading already follows: ask first, credit and link on every row, take stats
and never media, and give back (publish the crosswalk as open data once it may be public).

---

## The plan (Nov 1, 2026)

Six stages. Stages 1 and 2 are code that runs on local files, so they are built whether or not WBSC
has answered; only publishing waits. Stage 3 does not depend on WBSC at all.

| When | Stage | Done when |
|---|---|---|
| **Nov 2026** | **0. Permission and a complete local dataset** | WBSC has answered or the fallback below is in motion; the crosswalk is reviewed; every World Cup since 2016 imports and validates; `international.json` is built and tested |
| **Dec 2026–Jan 2027** | **1. One person, every competition** | The person registry exists and the matched WPBL players' pages show every World Cup they played (locally, or live on a yes) |
| **Jan–Mar 2027** | **2. The World Cup as a competition of its own** | Every World Cup since 2016 has an event page, every name on them is a link, all in the sitemap |
| **Feb to Mar 15, 2027** | **3. The site becomes women's baseball** | A new reader lands on a women's baseball site with MLB one click away in the league list; an MLB reader still reaches it in one tap |
| **Apr 2027** | **The read** | `events` on stages 1 to 3, written here; it sizes stage 5 |
| **May to Jul 25, 2027** | **4. The 2027 Finals** (Rockford, Jul 19–25), on a yes | `/world-cup/2027` exists with schedule and rosters by Jul 1; every Finals game is on the site within an hour of the last out, then frozen |
| **Late 2027 on** | **5. Beyond the World Cup** | Each item is its own decision |

Rough effort, for one person: stage 0's code is a weekend (the rest is the owner's review and
email); stage 1 a weekend; stage 2 three; stage 3 two to three weeks including the Figma work;
stage 4 a weekend ahead of time and then mostly unattended.

### Stage 0. Permission and a complete local dataset (November)

The steps are under [Pick up here](#pick-up-here-stage-0). Two additions:

- **Chase the permission.** No reply is recorded from the October email. Send a second one by
  Nov 10 to a different WBSC contact (communications and the women's baseball commission), with
  screenshots of what the World Cup rows on a player page would show.
- **Silence is not a yes.** With no reply by Dec 1, keep building stages 1 and 2 behind the gate
  and widen the ask: a national federation with players in the WPBL (USA, Australia, Canada) is
  the likeliest introduction. Stage 3 goes ahead regardless. A "no" ends the WBSC data and leaves
  the registry, the shell and the design to serve the next source.

### Stage 1. One person, every competition (December to January)

This is the stage that makes "track a player across leagues" real, and every later source rides on
it, so it is designed for the developmental league and the AAGPBL as much as for the World Cup.

- **A person registry.** Our own id and slug per person, the display name, the country, and a list
  of identities in each competition: the WPBL player id (or ids, since the feed minted new ones for
  the postseason), and each WBSC tournament id through the hand-checked crosswalk. A static file
  generated by the import (`people.json`), like the event files, not a Supabase table: it changes
  only when a crosswalk decision or a new roster does. The WPBL's `players` table stays the WPBL's
  source of truth and is joined, not copied.
- **Never name matching at runtime**, the rule already in the importer. A person exists in the
  registry because a human said so.
- **The WPBL player page's career table gains World Cup rows** (decided Nov 2, 2026, over a
  separate section; see [docs/PLAYER_PAGE.md](docs/PLAYER_PAGE.md)): per event, the
  country, the event, the line (G, PA, AVG/OPS or IP, ERA, K), the WBSC name it matched (so a reader
  can spot a wrong row), and a link to the games on wbsc.org. It shows only for players who have one.
- **Done when** the registry has a test that every crosswalk row resolves to one person and no
  person holds two WPBL players, and the matched pages render the rows.

### Stage 2. The World Cup as a competition of its own (January to March)

- **`/world-cup`** (every edition) and **`/world-cup/<year>`**: standings by group and round,
  results, leaders, the WPBL players in the field marked. A top-level route, not under `/wpbl`:
  two `_redirects` lines, `routes.ts`, `seo.ts`, the sitemap.
- **A game page** per World Cup game: line score, box score and play by play. The neutral engines
  in `src/league/` (bests, the finder, run expectancy) run on it with `src/intl/league.ts`; the
  WPBL Game Center's components are reused where they are already league-neutral, and anything
  WPBL-only (TrackMan, clips) is simply absent.
- **A page for every player, not only WPBL players.** About 200 of the 2026 field's 239 never
  played in the WPBL. Without a page each of those names is a dead end, and opening a player page is
  the retention event the traffic data names. `/players/<slug>` from the registry. A WPBL player's
  canonical page stays `/wpbl/players/<slug>` through the 2027 season, since its search ranking is
  the site's; `/players/<slug>` redirects there for them.
- **Search** covers people and events. Thin pages (one tournament, a handful of PA) are a known
  SEO risk: decide `noindex` by a threshold when building, measured, not guessed.
- **The size budget in CI** for the event files, added as they enter git.
- **Done when** every World Cup since 2016 has its page and every name on them is a link.

### Stage 3. The site becomes women's baseball (February to Mar 15)

Designed in Figma with the UI overhaul's phase 1 (November), built with its phase 3, so the 2027
season opens in the new shell. If it is not settled by **Mar 15**, it waits until October 2027:
the season comes first.

- **The league list** in the shell: WPBL (the default), World Cup, and later competitions as they
  arrive, then MLB. Every league is always visible and one click away; the order and the default
  say the site is women's baseball, nothing is hidden.
- **MLB keeps everything it has**: its URLs, links, search results and the sitemap are unchanged.
  What changes is its billing, from one of two halves of the site to one league among several.
- **The name stays `sportydolphin.fun`.** The title, meta descriptions, share cards and the
  manifest's description say women's baseball; the manifest's `id` stays `/mlb` (functions/CLAUDE.md).
- **A front page at `/`**, only if the Figma work shows it earns one over today's redirect to
  `/wpbl`: in the WPBL season the WPBL is the answer, and in July the World Cup shares it.
- **When it ships**, CLAUDE.md's "What it is" and ARCHITECTURE's routes change with it.

### Stage 4. The 2027 Finals (Jul 19–25, Rockford), on a yes

- `/world-cup/2027` built ahead from the schedule and rosters by Jul 1. WBSC mints new player ids
  every tournament, so the 2027 rosters go through the crosswalk review before the first pitch.
- Results within the hour: a job that re-imports during event week only, then freezes the event to
  a file. Not a live Game Center; the WPBL gets the attention if its season is running.
- On the WPBL side, if the seasons overlap: which players are away at the Finals (availability,
  not just stats).

### Stage 5. Beyond the World Cup (late 2027 on)

In the order they extend the registry. Each is its own decision, made with the April read in hand;
a new source goes through the [data table](#what-data-exists-probed-oct-15-2026) first.

1. **The WPBL's developmental league**, reported for Springfield in 2027. If it publishes a feed,
   its players join the registry, and a WPBL rookie's page shows where they came from. Check when
   the league announces 2027. Expansion and draft picks read the same way.
2. **The continental championships** (the 2025 cycle: Asia, the Americas, Europe), through the same
   importer if WBSC's system has them.
3. **The lineage (P2)**: the AAGPBL (1943–54) and earlier women's pro baseball. History pages, the
   AAGPBL's players in the registry, "this day in women's baseball". Only with the Players
   Association's blessing; told as baseball, which it was by its last seasons.
4. **National leagues and championships** (Japan, Australia, Canada, the US) when a machine-readable
   source appears.
5. **One URL per person site-wide**: WPBL player pages move to `/players/<slug>` with 301s, after
   the 2027 season, if the registry has proven itself.

---

## Risks

- **Terms.** The biggest one. A "no" from WBSC ends the World Cup rows and stages 2 and 4
  for their data; the registry, the shell and the design still serve the next source.
- **The page shape changes.** The import validates and fails; nothing reads WBSC at runtime until
  stage 4.
- **A wrong crosswalk row** puts someone else's line on a player's page. Hand-checked, and a player
  page shows the WBSC name it matched so a reader can spot a mistake.
- **The Finals overlap the 2027 WPBL season.** Some WPBL players will be away from their clubs that
  week, which is worth a line on the WPBL side too (availability, not just stats).
- **The shell under the season.** Stage 3 is the one change that can break the WPBL's first game.
  The Mar 15 stop is the guard; a half-built shell waits.
- **An MLB reader cannot find their league.** MLB stays in the league list; check MLB's sessions
  against `events` the week the shell ships.
- **Thin player pages.** Most World Cup players have one tournament. Decide what gets indexed by a
  measured threshold.
- **Scope creep.** The plan's table is the scope. A new competition goes through the data table
  above first.
