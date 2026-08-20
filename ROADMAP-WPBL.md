# WPBL Roadmap

> Living document: a menu of ideas, not a contract. Reorder/drop freely.
> Companion doc: **[ROADMAP.md](ROADMAP.md)**: the MLB section, which runs on its own
> calendar and its own priorities. Nothing here blocks anything there.
> Tags: 🎯 casual · 🔬 serious fan · 🎮 fun/game · ⚙️ infra
> Last realigned: **Aug 20, 2026**, against traffic data for the first time (see
> "What the traffic says"); before that Aug 17, 2026. Teams tab, Settings and an accessibility pass shipped
> as v1.45.0 (see the shipped log); favourite-team + theming remains built and parked (see
> "Parked, with reasons"); before that, split out of `ROADMAP.md` and reprioritized around
> the season clock (see the realignment log at the end).

---

## The clock: read this before prioritizing anything

**17 games left. The last regular-season game is Sep 6, 2026, three weeks out, and the
postseason runs Sep 9 to Sep 22** (schedule in Background, below). Then the league's feed goes
quiet and this section has no new data until spring 2027.

So the real deadline is Sep 22, not Sep 6, and the last two weeks of it are the highest-stakes
baseball the league will play. A season-locked feature that only just misses Sep 6 may still be
worth finishing; one that misses Sep 22 is a year late.

That single fact should grade every item below:

- **Season-locked**: needs live games to be worth building, and has ~3 weeks to earn its
  keep. Build it now or lose a year.
- **Durable**: still worth something on Oct 1. Safe to build late, but the *data* some of
  it needs must be captured while the season is running.

The section has spent the season accumulating features that only work when games are being
played. Nothing yet exists that makes `/wpbl` worth opening in November.

---

## Where the section stands

**Live surfaces:** Home (scoreboard strip, last-game recap card, next-game card + countdown,
standings, leaders, highlights rail, reading rail, archive rail, Discord invite) ·
Schedule · Standings (W/L/PCT/GB/L10/STRK/DIFF, H2H tiebreak) · Stats (hitting / pitching /
tracking / draft, sortable, team filter, qualified toggle) · Teams (ranked club cards with
record, form, run differential and next game, plus a head-to-head grid) → team pages (record,
results, opponent splits, season totals, leaders, roster with inline stats, lineup-history
and pitching-usage grids, all under a pinned club switcher) · Game Center (recap, box score, play-by-play, pitch data) ·
Player pages (batting/pitching/fielding cards, game log, pitch-location maps, shareable
links that unfurl) · search · live polling · push reminders · a fan Discord integration
(board, final-score box scores, YouTube highlight reels, `/player` slash command, giveaway
draw).

**Data:** the `wpbl-ingest` edge function mirrors the league's public feed
(`stats.womensprobaseballleague.com/v1`) into Supabase on a 2-minute cron: games,
box-score lines, play-by-play, TrackMan pitch tracking, ingest-health rows. Public-read
RLS, service-role writes. Birth dates come from a community sheet
(`scripts/ingest-wpbl-birthdays.mjs`), not the feed. The league's scoring has errors in it and
the league is not reachable to fix them at source, so a nightly job checks the play-by-play
against the rules of baseball and our own corrections are applied as a read-time overlay
(`wpbl_play_corrections`), never written into the mirror.

**What it does NOT have:** predictions/pick'em, win probability, daily standouts, a league
primer or stat glossary, any postseason handling, and anything at all that survives Sep 22.

---

## What the traffic says (Aug 20, 2026)

Read from `events` over the 14 days to Aug 19, which is the first time this list has been
prioritized against measurement rather than judgement. Counting rules in
[`docs/ADMIN_ANALYTICS.md`](docs/ADMIN_ANALYTICS.md): "browsers" are localStorage ids, not people.

- **The section is the site.** 18,213 WPBL events across 2,036 browsers, against 768 MLB
  events across 33. Whatever the next three weeks are spent on, it is not `/mlb`.
- **Growth is real and accelerating.** Aug 19 was the biggest day on record at 548 browsers,
  against 55 to 76 a day in the first week of measurement.
- **Opening a player page is the retention event.** Return rate by what a browser did on
  its first day: neither Game Center nor a player page, 7.8% (n=1,354) · Game Center only,
  35.7% (n=476) · **both, 76.5% (n=162)**. Correlation, not proof of cause, but a tenfold
  gradient is not noise, and nothing on the list was aimed at it.
- **Home is where they are lost.** 670 of 2,037 browsers fired exactly one event, and for
  554 of them that event was the Discord card's own impression. They landed, the card
  rendered, they left. Note the card was retired on Aug 19, so that bounce is now
  **unmeasured**: anything new on Home should carry its own impression event.
- **Retention is falling as reach grows.** Aug 5-9 cohorts returned at 41-54%; Aug 13-18
  cohorts at 12-20%. Acquisition is outrunning conversion, which is what strangers off a
  search result look like.
- **They come for the numbers.** First tab a session opens: stats 206, schedule 196,
  standings 122, teams 62. Stats is the most-used surface in the section.
- **Swipe earned its keep.** 3,020 pill taps to 1,141 swipes: 27% of all tab changes.
- **Teams landed.** 703 browsers saw the "new" dot, 139 tapped it, a 20% click-through, and
  the tab now runs 588 views from a standing start.
- **Discord is the durable channel; push is not.** 137 of 1,780 browsers who saw the invite
  joined (7.7%). Against that: 12 push subscriptions across 11 users, and one per-game
  reminder row in the whole table.
- **The media shelf is seen and not used.** 575 browsers saw Reading, 39 clicked through, 3
  opened a photo. Whatever it is, it is not the retention lever.

**What this reorders.** Daily standouts (#5) and the seeding race (#1c) move up, not because
they are cheap but because they are the only two items that put a player-page entry point on
the screen where the audience is currently lost. Anything that makes a name tappable is worth
more than it looks. The primer (#4) and SEO (#3) hold, aimed at a cold audience returning at
12 to 20%.

---

## Next: in priority order

### 1. Postseason data hygiene ⚙️: *hard deadline, nothing else on this list has one*

**Format** (confirmed Aug 16): all four teams qualify · semifinals **best-of-3** ·
finals **best-of-5**. So **7–11 postseason games** land on top of a 30-game regular season,
and a team that reaches the finals plays up to **8 more games on top of its 15, a 53%
increase on its season**.

**Not a bracket feature.** A clinch tracker or playoff-odds board is pointless when four of
four qualify, and that idea stays parked. This item is about the numbers those 7–11 games
will silently corrupt.

**The aggregation layer cannot exclude them.** In [`stats.ts`](src/wpbl/stats.ts):

```
sumBatting(lines)                  // lines only
sumPitching(lines)                 // lines only
aggregateBatting(players, lines)   // no games argument at all
aggregatePitching(players, lines)  // no games argument at all
```

No game context reaches these functions, so there is no parameter through which a
postseason line could be filtered. Every line in the DB gets summed. The first semifinal
box score silently changes every season number on the site.

**Uneven is worse than inflated.** A finalist's hitter gains up to 8 extra games of
counting stats; a team swept in the semis gains 2. HR / RBI / strikeout leaderboards would
reorder by how far a team went rather than how a player performed. `wpblQualifiers` scales
its thresholds off games played, so the qualified filter drifts too.

**Standings have the same hole, one layer up.** `game_type` and `counts_in_standings` are
both ingested and stored
([`wpbl-ingest/index.ts:652`](supabase/functions/wpbl-ingest/index.ts)) but **no consumer
reads either**. `computeStandings` ([`api.ts:467`](src/wpbl/api.ts)) filters on
`status === 'final'` alone.

**Blast radius**: everything reading those four functions. Stats tab, home leaders, team
pages, player pages, the Draft tab's draft-value analysis, the Discord `/player` command,
and the OG cards on shared links. **The season archive (#2) is built on these numbers**, so
leaving this unfixed makes the permanent record of the inaugural season wrong.

**Scope:** thread game context into the four aggregation functions and their ~15 call
sites; audit every `status === 'final'` filter for whether it means "counts toward the
season record" or "has been played"; confirm what the feed actually puts in `game_type` for
a postseason game (unknown until the first one lands, and the semis start right after
Sep 6).

### 1b. Series state 🎯: *the postseason feature that is actually worth building*

Postseason baseball is series-shaped and **nothing in the section models a series**. The
schedule, standings, recaps, and the Discord poster are all single-game shaped. "SF leads
2–1" is the unit fans track, and as it stands a best-of-5 clincher gets recapped as "the
Firebells won 4–2" with no notion that a championship was just won. Wants: series records
on the schedule and Game Center, series-aware recap and Discord wording, and a
clinched/eliminated state. Depends on knowing how the feed represents a series (game
number? series id?), which is unknown until the first postseason game lands.

### 1c. The seeding race 🎯: *the frame the last 17 games actually have*

All four clubs qualify, so a clinch tracker is pointless and stays parked. **Seeding is not
pointless**: the standings order sets the semifinals 1v4 and 2v3, and it is the only thing
the remaining games decide. Nothing on the section says so. Standings still presents itself
as a race for a title that is already conceded to everyone. Wants: seed number, games ahead
of the seed below, a magic number to lock a seed, and who each seed would draw. All of it
derives from `computeStandings`, so it needs no new data and no new request.

### 2. The inaugural-season archive 🔬🎯: *the only durable item on this list*

On Sep 7 this section becomes a static site with no reason to visit. The one asset worth
building is **the definitive record of the WPBL's inaugural season**: frozen final
leaderboards, single-season and single-game records, the complete game log, the Hall of
Firsts promoted from a home-page card to a permanent artifact, and a season-in-review page
with each team's arc.

Two reasons to start now rather than in September:

- Some of it needs **capture during the season**: anything derived from live state, or
  from feed fields that may not persist, has to be snapshotted while the games are running.
- It is the natural home for the multi-season support that has been deferred since Phase 3
  (see Parked). Building the archive is what makes 2027 a second season rather than a reset.

Worth noting as evidence of demand: `github.com/exu6jh/RetroWPBL` is a stranger
hand-transcribing WPBL play-by-play into Retrosheet format, game by game, from the same
public feed we already mirror in far more depth. People want the historical record.

**Partly answered as of Aug 19**, from the other end: the Commons archive gallery (see the
shipped log) is durable content that needed no season capture at all. It does not replace this
item, which is about *this* season's record. It does mean `/wpbl` is no longer completely empty
of reasons to visit in November, so the deadline pressure here is about the snapshotting, not
about having something to show.

### 3. Google Search Console + SEO follow-through ⚙️

Still unverified: there is no verification token anywhere in the repo, and `CLAUDE.md`
flags it as an open TODO. Search volume for "WPBL standings / stats / roster" peaks during
the season and collapses afterwards. The SEO plumbing (robots, sitemap, per-route meta,
JSON-LD, the edge-rewritten OG tags) is already built; being unindexed through the only
three weeks anyone is searching wastes it.

### 4. League primer + stat glossary 🎯: *cheap, overdue, and feeds #3*

A short "what is the WPBL" explainer (four teams, one hub venue at Robin Roberts Stadium
in Springfield IL, inaugural Aug–Sep 2026, seven-inning games, link to the official site)
plus a glossary of the stat abbreviations. Every visitor to a brand-new league is a
first-time visitor. Doubles as indexable prose, which the section currently has almost
none of.

### 5. Daily standouts: Home card 🎯

A "top performers" card for the latest game day, built from box lines Home already fetches.
Mirrors the MLB TopPerformers/Spotlight pattern. Low effort, and there are 17 game days
left for it to pay off.

### 6. Win probability in Game Center 🔬

A win-prob line for live and final games from a generic score / inning / base-out model.
Medium effort; the fiddly part is a credible model for a seven-inning league with no
history. Would also be the first feature to need play→player linkage, which is currently
deferred (see Parked).

### 7. Incremental depth 🔬

Fielding columns in the Stats tab (already computed in `stats.ts`, only surfaced on
player/team pages) · player-page splits vs each opponent as the sample grows · WPBL recents
in the empty-query search dropdown.

### 8. Cross-cutting leftover ⚙️

Settings accent-color picker (the last open item from the Aug 6 "Sprint C"; shared with the
MLB section).

---

## Parked, with reasons

- **Game predictions / pick'em (+ bots)** 🎮: *demoted from "the marquee open item",
  where it sat unstarted from Aug 4 to Aug 16.* With 17 games left, a Wilson-ranked
  leaderboard over ≤17 picks is statistical noise, and it is the largest build on the list
  (pick UI + grading + boards precompute + a daily bot Action). Its value decayed past its
  cost for *this* season. Revisit for **2027 Opening Day**, when it gets a full season to
  accumulate against. Or ship a stripped "pick today's winner + running record, no
  leaderboard" if the appetite is for something now.
- **Multi-season support**: deferred since Phase 3; folds naturally into the archive (#2)
  rather than being its own project.
- **Followed players / teams + notifications**: dropped as low-value for a four-team
  league. The per-game and all-games push reminders already cover the real need.
- **Favourite team + team colour theming** ⚙️🎯: *built Aug 17, 2026, parked the same day
  on branch `wpbl-favorite-team`.* Working end to end, not shipped: the theming isn't
  settled. What's on the branch: a one-shot Home prompt that never shares a screen with
  the Discord card, a ★ toggle on each team page, "no favourite" as a real answer that
  never re-prompts, and a section that takes the team's colour (solid nav chip, radial
  masthead, ~4% card wash, tinted card hairline, and `theme-color` for the phone's browser
  chrome). Contrast is measured per team rather than assumed, since a fixed white nav label
  fails WCAG AA on **seven of the eight** team/theme pairs.
  **Why it's parked, and the thing to solve first:** in a 30-game season, anything that
  prioritises your club takes more away than it gives, because every game is a big slice of the
  whole. That is why the pick only ever *adds* colour and never hides, reorders, or
  demotes the other three. That constraint leaves colour doing all the work, and colour
  alone didn't feel like enough to justify the ask. Two concrete problems to fix before
  unparking: **Heights blue (`#5bb2ec`) is nearly the league default (`#60a5fa`)**, so a
  quarter of the audience picks a team and sees almost nothing change; and a team page
  still shows its *own* club's colours in the body while only the chrome follows your
  favourite, which is defensible but was never actually decided.
  The DB column (`user_preferences.wpbl_favorite_team_id`) **is already on main and applied
  to production**: it shipped alone because it had been applied before the feature was
  parked. It is nullable and nothing reads it.
- **Ingest play-level `batter_id` / `pitcher_id` backfill**: the play log's `resolveName`
  is still exact-only, so name variants leave these null. Nothing reads them today (Hall of
  Firsts resolves by name instead). Would need a redeploy + `mode=all` re-ingest. Unpark
  only if win probability (#6) or a "biggest hits" feed needs the linkage.
- **Game duration**: investigated thoroughly and not derivable, because the feed has no
  duration or first-pitch field, `completed_at` is a processing timestamp, and plays carry
  no timestamps at all. TrackMan `occurred_at` is the only wall clock and is absent for
  untracked games. Unpark only if the feed exposes a real first-pitch / final-out stamp.
- **Streak report cards, Milestone Watch, WPBL Streak Survivor** 🎁: the remaining fun
  MLB mechanics. All want more season history than a six-week inaugural year provides.

---

## Ongoing hygiene & ops

- **Name-mangling audit.** We store **"Estheoa Segovia"**; her name is **Esthela**
  (Liliana Esthela Segovia Arredondo). Same family as the issues
  [`names.ts`](supabase/functions/wpbl-ingest/names.ts) handles. Two-minute fix on a live
  page showing a real player's name wrong.
- **Portrait rights.** Ask the league for permission to republish player headshots. Open
  since the portrait work, and more pressing now that shared player links unfurl with them.
- **Triage the nightly scoring check.** `wpbl-pbp-validation` runs at 08:00 UTC and records
  its health to `/admin` (Clean / N new / Stale / Failed). It deliberately never fails the
  job, so nothing shouts: the state to act on is **Stale**, meaning the run went missing.
  New findings get either a correction in `wpbl_play_corrections` or a baseline update.
  57 findings are currently accepted as known. See
  [`docs/PLAY_VALIDATION.md`](docs/PLAY_VALIDATION.md).
- **Periodic dupe / orphan audit** of players and games; the ingest has produced duplicate
  roster rows before (bad decode, tz-twin games) and each was caught by hand.
- **Birth dates: 65 of 118 players.** The community sheet does not cover everyone.
  *Evaluated and declined (Aug 16):* RetroWPBL's `biofile.csv` would fill 37 of the 53
  gaps, but it carries no license (all rights reserved by default), 6 of its dates are
  year-only, and 13 disagree with our sheet, 5 of those as clean day/month transpositions,
  meaning one of the two sources has ambiguous date formatting. Not worth ingesting.
  Revisit only if we get explicit permission *and* a way to adjudicate the conflicts.

---

## Background: architecture and locked decisions

**The league.** Inaugural season Aug 1 – Sep 6, 2026, postseason Sep 9 – Sep 22. Four teams
(Boston Hunters, LA Queens, NY Heights, SF Firebells), 30 regular-season games (15 each), all
at one hub venue (Robin Roberts Stadium, Springfield IL). **Seven-inning games**: ERA is
computed over 7, not 9. **Postseason:** all four teams qualify · semifinals best-of-3 ·
finals best-of-5, so 7–11 games follow Sep 6 (up to 8 more for a finalist).

**The published postseason schedule.** Every game 7:30 p.m. ET on ESPN+. An asterisk is
if-necessary. **The feed stores start times in Central** (`WPBL_TZ` in
[`constants.ts`](src/wpbl/constants.ts)), so 7:30 ET arrives as `6:30 PM`, identical to the
regular-season slot: nothing keyed on the clock needs moving, and the cron windows already
cover it.

| Date | Round | | Date | Round |
|---|---|---|---|---|
| Wed Sep 9 | Semifinal A, G1 | | Wed Sep 16 | Championship, G1 |
| Thu Sep 10 | Semifinal B, G1 | | Thu Sep 17 | Championship, G2 |
| Fri Sep 11 | Semifinal A, G2 | | Sat Sep 19 | Championship, G3 |
| Sat Sep 12 | Semifinal B, G2 | | Sun Sep 20 | Championship, G4\* |
| Sun Sep 13 | Semifinal A, G3\* | | Tue Sep 22 | Championship, G5\* |
| Mon Sep 14 | Semifinal B, G3\* | | | |

Note the two dark days, Sep 15 and Sep 18, and that Championship G3 skips Friday. Anything
that infers "the season is over" from a gap in the schedule has to survive a two-day one.

**Architecture, pivoted twice.** It began as owner hand-entry with Supabase as the source
of truth. In Aug 2026 the league published a public JSON feed at
`stats.womensprobaseballleague.com/v1`, so the model flipped to a **feed mirror**: the
`wpbl-ingest` edge function pulls on a cron and upserts games, box-score lines,
play-by-play and TrackMan tracking; the public reads the mirror. Hand-entry (`GameEntry.tsx`)
is retired.

**Locked decisions:**
- **WPBL-native components.** Lean components built for a small dataset, rather than forcing
  WPBL data into StatsAPI-shaped types. Borrow the site's *conventions* (team-color map,
  modal pattern, compact tabular-nums tables) so it still feels like one site.
- **The section is self-contained.** `src/wpbl/` has no MLB coupling; the shell (auth,
  search, notifications, theme, units) is the only shared surface.
- **Two write paths only**: browser-through-RLS for user rows, service-role for everything
  ingested or derived. See `CLAUDE.md`.

**Live gotchas worth remembering:**
- The recap engine (`derive/recap.ts`, `derive/discordRecap.ts`) is loaded by three builds
  including **Deno**, so its runtime imports need explicit `.ts` extensions and it must
  never import `constants.ts`. See `CLAUDE.md`.
- A **vendor-chunk split** (`manualChunks` splitting MUI/React) was tried and **reverted**:
  it produced a circular import that blanked the page on a fresh load. Any retry must keep
  React + MUI + emotion in one chunk and be browser-verified first.
- TrackMan coverage is partial and radar-based: home runs leave the park and often go
  unmeasured, so an absent HR on a distance board is a data gap, not a bug.

---

## Shipped log

### Phases 0–2 (Jul 29 – Aug 4, 2026)

- **Phase 0** ✅: schema + RLS + public read; teams, rosters (all 118 draft-board players),
  the 30-game schedule; the `/wpbl` shell behind the toolbar MLB | WPBL toggle.
- **Phase 1** ✅ (v1.23.0): box-score read view, player pages, season totals, the shared
  `ui.tsx` design language, real colors and logos, public launch.
- **Feed pivot** ✅: `wpbl-ingest` + cron mirror; Game Center with line score,
  play-by-play, TrackMan, live in-game state; hand-entry retired.
- **Phase 2** ✅ (v1.24 → v1.27): rich Home, the sortable Stats tab, redesigned player
  pages, Hall of Firsts, live-updating schedule/scoreboard/leaders.

### Phase 3: hardening and depth (Aug 4 – Aug 10, 2026)

- ✅ **Ingest hardening**: name-variant resolution (nickname/accent/edit-distance),
  server-side duplicate-game dedup, an ingest-health log table, the TrackMan "Unknown
  pitcher" fix, and the tracking backfill that re-fetches recently-final games from the
  uncapped `/activity` endpoint (which also lifted the old 200-row/game cap).
- ✅ **Loose ends**: browser back-stack via `history.state`, confirmed team secondaries,
  off-roster filtering (`status === 'Signed'` + anyone with a stat line), ingest freshness
  moved into the Admin panel.
- ✅ **Team pages**, ✅ **search integration**, ✅ **richer standings** (PCT/GB/L10/STRK +
  H2H tiebreak), ✅ **velocity / TrackMan leaderboards** (the Tracking tab).
- ✅ **Aug 9–10**: WPBL made the site default; pitch-location maps; swipeable tabs; the
  ERA-over-7-innings correction; schedule polish; per-game push reminders; the auth
  return-to-page fix; and a performance pass (session cache for bulk reads, column-projected
  the heaviest play fetch).

### Aug 12–16, 2026: the Discord era, recaps, and team-page depth

Roughly 60 commits and v1.33 → v1.43. Not previously logged here; the doc's last
realignment was Aug 10.

- ✅ **Auto game recaps** (v1.38.0): a headline, a narrative account, stars of the game,
  decisions and the R/H/E line, built from the box score and play log, with league-relative
  wording (a "rout" is calibrated to how the WPBL actually scores). Home gained a Last Game
  card.
- ✅ **The fan Discord integration**: the board with persisted message ids, box scores
  posted when a game goes final (and corrected in place), YouTube highlight reels posted as
  playable embeds, a **`/player` slash command** with forgiving name matching and
  autocomplete, and a giveaway draw. Documented in [`docs/DISCORD.md`](docs/DISCORD.md).
- ✅ **Shareable links**: every game and player has its own URL, and a shared player link
  unfurls with their name, club, season line and headshot via a Cloudflare Pages Function.
- ✅ **Stats tab restructured**: two axes (hitting / pitching / tracking / draft) instead
  of four tabs that were never peers, with a pinned control bar. Added a **Draft tab**
  plotting season production against draft position.
- ✅ **Team-page depth** (v1.42.0): lineup-history and pitching-usage grids (last six
  games, opposing starter and handedness per column, short-rest flagged), opponent splits,
  and stat columns that say something the record above doesn't.
- ✅ **Play-by-play rewritten** (v1.43.0): one shape per play, about a quarter less text,
  substitutions demoted to their own quiet line, pitch sequences decoded into pips.
- ✅ **Box scores fit a phone**: every column, no sideways scroll, names shortened rather
  than clipped; innings that were never played are no longer printed.
- ✅ **Birth dates + zodiac**: `scripts/ingest-wpbl-birthdays.mjs` pulls a community sheet
  into `wpbl_players.birth_date`, reconciling the sheet's two halves and flagging conflicts.
- ✅ **Reminders became a standing setting** (v1.42.1): one switch for every game, and the
  MLB pick reminder was split into its own opt-in so WPBL fans stopped receiving it.
- ✅ **Infra**: a real **migration runner** (`scripts/migrate.mjs` + `scripts/migrations/`,
  replacing hand-run SQL), `CLAUDE.md` onboarding doc, an experimental-features switch, a
  changelog split out of the entry chunk, `functions/` type-checking, and a cold-load
  payload reduction.
- ✅ **Game Center swipe + card polish** (v1.44.0): `SwipeableViews` gained a **`pane`
  scroll mode** so the Game Center's tabs page by the same gesture as the section's own,
  despite being a modal with a locked body and inner scrollers rather than the
  window-scrolled page the pager was built for (`scrollbar-gutter: stable` on the panes is
  load-bearing: without it a taller tab grows a scrollbar the shorter one lacks and the
  whole pane jerks sideways on commit). Alongside it: the lineup/pitching grids now fill a
  desktop card and show up to 12 games instead of 6; `GameGrid` owns **measured** name
  fitting, fixing names that were cut mid-word because `useWpblName`'s *character* budget
  was being asked to predict a fixed *pixel* column; the home scoreboard dates its finished
  games; and the recap's stars share the row's full width so a stat line is never truncated.

---

### Aug 17, 2026: the Teams tab, Settings, and an accessibility pass

v1.45.0.

- ✅ **Teams tab rebuilt** ([`src/wpbl/TeamsGrid.tsx`](src/wpbl/TeamsGrid.tsx)): the four
  cards were a badge and a name, a near-duplicate of Home's Teams card, so a whole nav slot
  bought nothing. Each club now carries record, PCT, a five-result form strip, run
  differential and its next fixture, in standings order. All derived from `teams` + `games`
  already in memory, so it costs no request. `computeStandings` gained a `recent` field for
  the strip.
- ✅ **Head-to-head grid**, under the cards. Makes the previously-dead `headToHead()` in
  [`derive/matchups.ts`](src/wpbl/derive/matchups.ts) load-bearing, so it also gained a test.
  It is the one artifact a four-team league can have that a thirty-team league cannot.
- ✅ **Pinned team header** with a four-club switcher on team pages. The page runs thousands
  of pixels on a phone, and nothing said whose roster you were in. Swiping between clubs was
  considered and rejected: horizontal swipe already means "change tab" section-wide, so a
  second meaning inside one tab would fight learned behaviour.
- ✅ **Settings reorganised by league.** WPBL is the default landing section, yet Settings
  was entirely MLB-shaped: a 30-club picker and two prediction-game switches, with the two
  settings a WPBL-only reader actually uses (units, experimental) presented as global
  boilerplate above them. Now a WPBL / MLB switch seeded from the section you came from. The
  standing WPBL game reminder, which lived only on a Home card, is in Settings too. Also
  fixed a nesting bug that had "Stop all push" rendering inside the game-start row's label
  column, and re-skinned the dialog onto `ModalShell` like every other modal.
- ✅ **Accessibility pass.** Site-wide `prefers-reduced-motion` (CSS plus a
  [`lib/motion.ts`](src/lib/motion.ts) helper, since `scroll-behavior` cannot override an
  explicit `scrollTo({ behavior: 'smooth' })`), a Large text setting that scales root
  font-size, and a switch to turn off swipe navigation. Both new prefs live in
  [`AccessibilityContext`](src/AccessibilityContext.tsx).
- ✅ **Contrast audit, measured rather than guessed.** Suspicions about `CARD_BORDER` and
  dark-mode `text.disabled` were wrong (both pass comfortably); light mode was much worse
  than expected. Fixed: light `text.disabled` 2.65 → 5.22, the section accent as text
  2.2 → 4.9+, white on the accent fill 2.37 → 5.75 (which failed in **both** themes, since
  contrast is absolute), medals, run-differential green/red, and three of four team accents
  whose light variants were documented as tuned for text and were not. Semantic tokens now
  live in `styles.css` (`--wpbl-pos`, `--wpbl-neg`, `--wpbl-medal-*`, `--wpbl-accent-fg`,
  `--wpbl-accent-solid`).

### Aug 17, 2026: finding the league's scoring errors mechanically

- ✅ **A play-by-play validator**
  ([`scripts/validate-wpbl-pbp.mjs`](scripts/validate-wpbl-pbp.mjs), `npm run validate-pbp`).
  The obvious design was tried and abandoned: diffing the box score against the play log finds
  almost nothing, because both views are generated from the same scoring input and inherit the
  same mistakes. Of 291 player-games in both, only 5 disagree. What works is baseball's own
  rules, which hold whatever the scorer typed. Seven checks, each pointing at one game,
  half-inning and lineup slot, which is what turns "watch fourteen games" into "check about
  thirty moments". First run found 5 batters with box-score plate appearances and no plays at
  all, worth 16 at-bats and 6 hits, plus 6 team-games missing a whole lineup slot.
- ✅ **The runs semantics written down once**, as `runsOnPlay()` in
  [`derive/playByPlay.ts`](src/wpbl/derive/playByPlay.ts) with a test. `runs_scored` counts the
  runners who crossed and never the batter, so a solo home run reads 0 by design. Every reader
  of that field had got it wrong: the validator flagged 15 of 28 team-games as having lost runs
  (fixing it left 1, a real lead), Game Center's badge showed nothing on a solo homer, and the
  Hall of Firsts dated one player's first RBI to a sacrifice the following day. `firsts.ts` had
  the rule stated correctly in a comment twelve lines above the check that broke it, which is
  the whole argument for one callable function.
- ✅ **A nightly Action with a baseline.** Unattended the validator reports 57 things and would
  report 57 tomorrow, so a job wired to fail on findings fails every night and is ignored inside
  a week. It compares against a committed baseline, reports only what is new, and always exits
  0. Health goes to `wpbl_pbp_validation_runs` and shows at `/admin` as Clean / N new / Stale /
  Failed, modelled on the existing freshness chip. **Stale is the state that matters**: findings
  are expected, a missing run is not.
- ✅ **`wpbl_play_corrections`, applied as a read-time overlay.** Corrections cannot live in
  `wpbl_game_plays`: `wpbl-ingest` deletes and reinserts every play for a game on each pass, so
  an edit written there survives until the next cron tick and then vanishes without trace. Keyed
  on `(game_id, sequence)` rather than the play uuid, which is regenerated on every reinsert.
  Applied to Game Center, the Hall of Firsts and the recap card alike, since a mis-attributed
  batter matters most exactly where a milestone gets awarded once and then reads as history.
- 📄 Written up in [`docs/PLAY_VALIDATION.md`](docs/PLAY_VALIDATION.md), including what this
  design **cannot** catch: two players swapped consistently through a game keeps the order
  legal and the outs adding up. That needs an independent transcription, and the one that
  exists carries no licence.

### Aug 20, 2026: measuring the tab nobody could see into

- ✅ **The Stats tab is instrumented.** It is the most-opened tab in the section and was the
  only one whose contents were invisible: the axes (Hitting/Pitching × Season/Tracked,
  Players/Teams, Draft) are component state and never touch the URL, so neither
  `wpbl_tab_viewed` nor Cloudflare's path counts could tell which of six boards anyone was
  reading. Three events now do: `wpbl_stats_board` (which board, and whether a tap or a
  default put it there), `wpbl_stats_sorted` (the column readers rank by, which is the input
  the archive's frozen leaderboards need) and `wpbl_stats_filtered` (whether a four-team
  league needs a team filter, and whether Qualified earns its space on a phone).
- 🐛 **Caught in verification: every return to Stats was logging as a first open.** The tab
  pager unmounts the pane on the way out, so the flag saying "we have already counted an
  arrival" was born false on each visit. It lives at module scope now. Same unmount is why a
  return reports the *default* board rather than the one that reader left, which is written
  down beside the other counting rules rather than left to be rediscovered as a mystery in
  the data.
- ✅ **`/admin` split into three groups**: Audience, Health, Tools. It had grown to seventeen
  stacked cards mixing three unrelated jobs, with the range and league filters at the top
  implying they governed all of it. The four pipeline states are one card now instead of four
  single-line Sections, and a summary strip carries them above every other group, because
  they are the only thing on that page that is ever urgent and they had ended up furthest
  from the top. Thresholds moved into pure functions with tests: none of the four jobs fails
  loudly, so a threshold that reads "Fresh" for a job that died on Tuesday is
  indistinguishable from a healthy site.

### Aug 19, 2026: the postseason would have broken the standings

- 🐛 **Every playoff game would have counted in the regular-season record.**
  `computeStandings` filtered on `status === 'final'` and nothing else, and a playoff game is a
  real final with a real score. Simulated against live data, a single 12-0 championship game
  swings SF's run differential from +23 to +35 and Boston's from -17 to -29, with W/L, streak,
  last-10 and the head-to-head tiebreak wrong to match, and nothing on screen to say so.
- ✅ **`countsInStandings()` is now the one definition**, used by `computeStandings` and by
  Home's season-series line. Two independent signals, because no postseason row has arrived yet
  and we cannot know which the feed will use: `counts_in_standings === false`, or a
  postseason-looking `game_type`.
- ⚙️ **It FAILS OPEN, deliberately.** It excludes only on positive evidence and counts anything
  it does not recognise. The inverse ("count only what looks regular") drops every game the day
  the feed renames a type, rendering four clubs at 0-0, which reads as an outage rather than a
  bug. Wrong by a couple of games is visible and recoverable; blank is neither. Pinned by tests,
  including that the bare word "final" must not trigger it: `status` is `'final'` for every
  completed game, and "Semifinal" and "Championship" both contain it.
- ✅ **Timing needed nothing.** The published schedule is 7:30 p.m. ET, and the feed stores
  Central, so it arrives as `6:30 PM`: the same slot the regular season uses, 23:30 UTC. The
  `3-10` cron windows already cover through Sep 22.
- ⏭️ **Postseason stats are still folded into the season leaders.** `fetchWpblAllLines`
  aggregates every line regardless of round, so a championship 4-for-4 will move a season OPS.
  Separating it means threading the schedule into `aggregateBatting`/`aggregatePitching` (four
  call sites, and `DraftValue` has no games list), and deciding what `wpblQualifiers` should do
  when playoff games inflate the games-played count that arms the 5 AB / 3 IP threshold. Its own
  change, before Sep 9.

### Aug 19, 2026: Home's cards line up, and Next game earns its height

The shelf pass above squared the two columns as *totals*, 627 against 625. It did not square
them anywhere a reader looks: the cards inside them still ended wherever their content ran out,
so the row boundaries were ragged and the full-width shelf underneath made the notch under the
shorter column impossible to miss. This pass fixed the alignment, then dealt with the empty space
that aligning things creates.

- ✅ **The two columns share row boundaries, via CSS subgrid.** The parent grid declares two
  rows; each column spans both and re-uses them, so row 1 is `max(Next game, Standings)` in
  both columns and row 2 is `max(Last Game, Leaders)`. The bottom edge is flush by
  construction rather than by luck of the content. Measured: **333/333 and 358/358**.
- ⚙️ **Subgrid rather than four bare grid items, to keep `order` out of the layout.** Four
  items in one grid would align rows for free, but the single mobile column would then read
  Next game, Standings, Last Game, Leaders, and fixing that needs `order` at one breakpoint:
  the second numbering scheme the entry above was pleased to have deleted. Real column
  elements mean mobile is plain DOM order and the columns just fall back to flex below `md`.
  Chrome 117 / Safari 16 / Firefox 71; where it is missing the declaration is dropped and each
  column falls back to its own rows, which is the ragged edge this replaced.
- ⚙️ **Stretching a card only moves the ragged edge inside it**, so every card in the grid
  takes a `fill` prop and the shorter one in each row places the difference deliberately:
  leader rows share it out between them, standings rows grow into it (a table absorbs height
  as taller rows, 48px to 59px, with the rules still attached to the rows they belong to), and
  Next game splits it above and below the matchup.
- 🐛 **`fill` originally set `height: 100%`, which squashed Last Game by 32px on a phone.**
  Below `md` the container is a flex column, and a percentage height resolves against the
  column's own height, making every card in it the same size. A grid item already stretches to
  its row, so the declaration was redundant where it worked and harmful where it did not.
- ✅ **The Reading / Highlights / Archive switcher moved into the shelf's header.** That header
  was carrying a title, a subtitle and a chevron across the full page width with nothing in the
  middle, while the control below it cost a whole band on the page's longest card. The subtitle
  already names the active segment, so the two were describing the same thing on two lines.
  Header placement is `sm` and up; at 375px the row is title plus three pills plus chevron,
  which is where the title starts wrapping. Picking a segment while the card is collapsed now
  opens it, since the switcher stays visible when the body does not.
- ✅ **Leader boards list five, not three.** Three names left the card about 90px short of the
  one beside it, and two more leaders is the only filling for that gap worth a reader's time.
  The board reserves the tallest category's height so stepping between categories does not jolt
  the card, so a short category is already sitting in a box built for five: rows only share out
  the slack when the board is **full**, since spreading two rows across it would put eighty
  pixels between them.
- ✅ **Next game was the weakest card on the page and is now built on Last Game's skeleton**,
  tier for tier: two team rows, one line at headline weight, one quieter line of context, a
  rule, then the row you can act on. Same badge, same name size, same trailing number in the
  same slot at the same size. The only honest difference is that one card's number is a final
  score and the other's is a record.
- ✅ **Records and the season series** are the new content. Records come from
  `computeStandings`, not a local count, so the two numbers on those rows are the same two the
  Standings card renders beside them. The series line is filtered the same way, decisive finals
  only, for the same reason. It renders nothing before two clubs have met, which is a real
  state early in a season and reads better than "0–0".
- ✅ **The countdown moved out of the header chip into the headline slot.** The top-right of a
  card is where it puts an afterthought, and the clock is the only thing Next game knows that
  nothing else on the page does. `tabular-nums` is scoped to the digits, so the sentence does
  not twitch sideways once a second.
- ⚙️ **The record's width tipped "San Francisco Firebells" onto a second line at 320px**, so
  the name takes an ellipsis as its final net. Last Game's otherwise identical row does not
  need one: its trailing number is one or two digits against this one's four glyphs. At 375px
  every club name still fits in full.
- ✅ **One gap in both directions, and it is Home's gap.** The grid ran a 20px column gap
  against 12px everywhere else on the page: between the scoreboard and the grid, between the
  grid and the shelf, and between the two cards stacked in each column. With the cards now
  sharing row boundaries the mismatch became visible, a wide vertical channel crossing narrow
  horizontal ones, which reads as two grids rather than one. Both are 12px. The columns gain
  4px each as a side effect, which is free width for the leader names.
- ❌ **Not done: swapping Leaders above Standings.** It measures better, cutting the leftover
  from 135px to 48px and the column by 41px, but it drops Standings from third card to fourth
  on a phone. That is an editorial call about what a reader wants first, not a layout one.

### Aug 19, 2026: Home rearranged around one media shelf, and the Discord card retired

- ✅ **Reading, Highlights and the Archive are now one full-width card** with a segmented
  control ([`src/wpbl/MediaShelf.tsx`](src/wpbl/MediaShelf.tsx)), sitting under the two-column
  feed instead of stacked down the left of it.
- **The measurement that forced it**, at 1440px: the left column ran to **2125px across six
  cards** and the right to **838px across three**, so the right was 39% of the left and
  **1286px of empty space** ran down one side of the page. The three rails alone were 1415px
  of that, 67% of the column. They are also the same UI doing the same job, and three
  sideways-scrolling strips stacked vertically read as repetition rather than as three offers.
- **Result:** columns at **627 vs 625**, page height **2779px to 1800px**, and Home down from ten cards to four plus the shelf. On mobile the three
  rails were about 1180px of the single column and the shelf is 462px.
- ✅ **Full width is the point, not a side effect.** A horizontal strip is the one thing on
  this page that converts width into content: the same card height shows five or six cards
  across the page instead of three in a column.
- ✅ **The Discord promo card is retired**, after several weeks on the home screen. That is
  long enough for anyone who wanted the fan server to have joined it; what is left is the
  standing link, not the pitch. It moved to the WPBL footer beside "API for developers", still
  firing `discord_joined` so the one number worth keeping survives. The `/admin` funnel is
  labelled retired, because `shown` is now frozen while `joined` keeps climbing and the rate
  would otherwise drift past 100% and read as a bug.
- ✅ **Column ratio 1.4fr to 1fr 1fr**, in two steps: the 1.4 existed to give the media rails
  room, and with them gone it was starving the side that needed it (the leaders card was
  ellipsising player names at 1440px). Even tracks at 490px clip nothing.
- ✅ **Batting and Pitching leaders became one card**, switched by its own control. That is
  what first squared the columns: **627 against 625, a 2px difference**, down from 211px. They
  were the same card twice, three rows each, differing only in which categories they offered.
  Switching halves resets the category, since "HR" has no counterpart on the pitching side and
  carrying the index across would land on whatever happened to sit third. The control started
  on a row of its own, because sharing one with the chips as a **single** five-pill strip with
  two of them lit reads as one broken control rather than as two questions. Later the same day
  the two went back onto one row as two **separate** groups at opposite ends, which says the
  same thing about them being different questions and costs one band instead of two (see the
  alignment pass below).
- ❌ **Two other ways to close that gap were tried and rejected.** Three-up for the season
  cards balances perfectly and is 187px shorter, but at 317px each the standings table clips
  every club name and both leader boards clip every player name. A full-width standings row is
  worse still: its stat columns are fixed at 32/32/48px, so at 1008px the numbers strand
  themselves an inch from the names. No column ratio helps either, tested at 0.85fr and 1.4fr:
  these cards are sized by their content structure, not by text wrap, so a narrower track does
  not make them taller.
- ⚙️ **Both mobile-ordering mechanisms are gone.** The layout used to collapse its column
  wrappers to `display: contents` on mobile and re-sequence every card with CSS `order`: two
  numbering schemes kept in step by hand. That existed so Standings could interleave into the
  middle of the left column's rails. The rails are in the shelf and the Discord card is gone,
  so the mobile order is just left column then right column, which is DOM order.
- ⚠️ **What it costs:** only the active segment paints, so Highlights and Archive lose the
  free impression they used to get. Reading still leads, for the reason already written into
  the old layout. `wpbl_shelf_segment` and the two `*_SHOWN` events measure it, and the latter
  are now true impressions for the first time: the old rails logged a render even when the
  reader had the card collapsed.

### Aug 19, 2026: the archive gallery, and the first thing here that survives Sep 6

- ✅ **"From the archive": freely licensed women's baseball photography** from Wikimedia
  Commons, as a Home rail plus a full gallery
  ([`src/wpbl/Photos.tsx`](src/wpbl/Photos.tsx), `wpbl_photos`,
  [`scripts/sync-wpbl-commons.mjs`](scripts/sync-wpbl-commons.mjs) weekly on Sundays).
  **The feature that was asked for was photographs of current WPBL players, and Commons cannot
  support it**: its WPBL category held 8 files, and all 118 rostered players searched by name
  returned 0 real matches. What it does hold is the AAGPBL, the World Cup and the pioneers,
  227 files reachable from three seed categories, largely public domain via Florida Memory and
  the Library of Congress. So the feature turned into the archive, which is the better version
  anyway: it is the **only thing on the section today that still has something to show in
  November**, and the first item to actually answer "The clock" above rather than race it.
- ✅ **An approval gate, in RLS rather than in the query.** Rows land `approved = false` and
  the `select` policy is `using (approved)`, making `wpbl_photos` the one WPBL table whose rows
  are not public simply by existing. Necessary because Commons category membership is
  crowd-maintained and returns whatever somebody filed: `Category:Women's baseball` legitimately
  reaches 67 photos of a Japanese high school exhibition game and 27 Victorian cigarette cards.
  The sync omits `approved`, `caption` and `sort_order` from its upsert payload, so a weekly
  re-run can neither publish something new nor resurrect something rejected. 16 photographs are
  approved; 211 sit in the review queue.
- ✅ **Attribution designed in, not appended.** A real share of the pool is CC BY or CC BY-SA,
  which oblige naming the creator and the licence and linking the source, so the credit line is
  on every card in every surface: the licence is engaged the moment the rail paints, not when
  someone clicks. Commons serves descriptions and credits as uploader-authored HTML, which the
  sync strips to plain text; nothing on `WpblPhoto` is ever rendered as markup.
- ✅ **Library cataloguing unpicked into captions.** Most of this pool has a catalogue record
  where a caption should be ("Local call number: c009836 Title: […] Date: Photographed on April
  22, 1948. Physical descrip: 1 photoprint…"), so `deriveCaption()` extracts the title,
  unbrackets it and drops the general material designation. Without it nearly every card on the
  rail opened with a call number. A `caption` column overrides it where the result still reads
  badly, which is expected rather than a failure.
- ⚙️ **Commons serves thumbnails only at a fixed ladder of widths** (250, 500, 960, 1280,
  1920) and 400s anything else. The first cut of the sync picked 640 and 1600, so every image
  would have shipped broken. It now asks the API once per width instead of swapping the number
  in a URL, which also covers the two rules underneath that one: Commons will not upscale, and
  past a filename-length limit it renames the render to a literal `500px-thumbnail.jpg`. Both
  would have defeated a constructed URL. The two passes also let archival TIFF scans in, which
  Commons renders to JPEG and which are sixteen of the better photographs in the pool.
- ⚙️ **Wikimedia's rate limit is real.** A first pass that looked up 118 player names one
  request at a time was blocked within two minutes. The sync walks categories with a generator
  (fifty files and their imageinfo per request), sends a contact-carrying user-agent because
  the API requires one, and retries a throttle with a widening backoff rather than bailing and
  leaving the table half-written.
- 📄 Written up in [`docs/COMMONS_PHOTOS.md`](docs/COMMONS_PHOTOS.md): the survey, the
  review query, and what the sync will not do.

### Aug 19, 2026: shared player links were a trap

- 🐛 **Fixed: a player or game opened from a pasted link could not be closed.** The X, the
  backdrop and Escape all route through `closeTop`, which is `window.history.back()`, so that
  closing a modal and the browser Back button can never disagree. But a deep link opened its
  modal with `replaceState`, so the entire session history was a single entry that already had
  the modal open: `back()` had nothing to walk to and either did nothing or left the site.
  Every shared player link, which is exactly the link the Discord `/player` command and the
  unfurl-friendly cards exist to produce, dropped the reader into a modal they could not leave.
- The fix seats a modal-less entry underneath before pushing the modal on top, in the same
  synchronous block so the address bar never flickers back to a bare `/wpbl` and a link copied
  mid-load never loses its player. `?game=X&player=Y` (what the address bar holds once you open
  a player from a game) seats that base once, since the two arrive as independent effects
  racing on two different fetches.

### Aug 19, 2026: listed positions follow the season, not the roster

- ✅ **A player's listed position is now the one she has actually been playing**
  ([`src/wpbl/positions.ts`](src/wpbl/positions.ts)). The roster is filed once, before a ball
  is thrown, and the season disagrees with it: Alyssa Zettlemoyer was listed at catcher and has
  played third in all six games she has fielded; Natsuki Yonetani was listed in left and has
  played right seven times out of seven; Ticara Geldenhuis was listed as the un-helpful "OF".
  **15 of 118 players are relabelled**, and the other 103 keep what the league filed.
- ✅ **Majority, not plurality, over at least four fielded games.** A strict `> 50%` share
  guarantees a single winner, so a tie can never be broken by whatever the sort happened to put
  first (Samantha Gutierrez has caught twice and played third twice, and neither is the answer),
  and genuine utility players are not relabelled off a 40% share. Four games is the floor on
  evidence against a 15-game season: it clears Elodie Ciamarro at 3 of 4, and it ignores Kylee
  Lahners, who has DH'd four times and played first twice.
- ✅ **DH, PH and PR count for nothing and toward nothing.** They are batting roles rather than
  places on the field, so a catcher who DHs half the time is still a catcher, and her catching
  share is measured against the games she actually fielded.
- ✅ **The two vocabularies are reconciled.** The roster writes handedness on pitchers ("RHP")
  where a box score only writes "p", so reading them as different would have relabelled every
  pitcher in the league. Buckets ("IF", "OF", "UTL") are deliberately NOT treated as agreement:
  sharpening "OF" into "LF" is the most useful thing this does.
- ✅ **One rule, three runtimes.** The site, the Cloudflare Pages function behind a shared
  link's unfurl card, and the Discord `/player` command (including its autocomplete) all import
  the same pure module, because three copies of "which position counts" would disagree the first
  time one was fixed. The bot's roster cache gained a third narrow read for it, cached on the
  same window, so it is one read per window rather than one per keystroke.
- 🔍 **What it deliberately does not change:** which stat block leads a player page. That
  still reads the filed position. A two-way player filed RHP who has spent more games at first is
  still someone whose pitching is the headline, and the player page shows "3B · listed C" so the
  original is never silently lost.

### Aug 19, 2026: the tracking teaser goes, and something actually watches the feed

- ❌ **Removed the "Ballpark tracking" Home card.** It was gated on `!trackingStale`, hiding
  itself once the league's radar publishing fell more than three days behind the schedule. The
  league published TrackMan for **two games** (through Aug 2) and stopped; the last final is
  Aug 16, so the feed is **14 days behind** and the card had been rendering never. That took
  8,060 characters out of `Home.tsx` along with `TeaserRowSkeleton`, `TeaserTile`, the
  `trackingBoard` and `latestGameIds` memos, the `trackingStale` gate, and the units imports
  that only it used.
- ✅ **A nightly watcher replaced it**
  ([`scripts/watch-wpbl-tracking.mjs`](scripts/watch-wpbl-tracking.mjs), `wpbl_tracking_watch`,
  daily at 08:30 UTC). **The card hiding itself was the actual bug**: the only thing watching
  for the feed's return was a component that had already disappeared, so the feed could have
  come back at any point and nobody would have found out. The watcher keeps a watermark of how
  far tracking reaches and posts to Discord when it moves.
- ✅ **A watermark, not a row-per-game log.** The league publishes in batches that land days
  late and cover several games at once, so the news is "the feed moved", once per batch. The
  `wpbl_discord_recap_posts` shape would have turned one twelve-game backfill into twelve
  messages. The watcher also fires on the count growing, not just the date, so a backfill that
  fills in games *behind* the front edge still counts.
- ✅ **A TrackMan row on `/admin`**, so the state is somewhere you can look without waiting to
  be told. Deliberately grey rather than red while the feed is behind: red for the expected
  state trains the eye to ignore the row over the weeks it will sit there. Green is the news.
- 🔍 **The visitor-facing cue was left alone.** `NewTrackingBanner` still tells a reader
  when the tracked set has grown since their browser last saw it. That is per-browser
  localStorage and only fires if somebody visits; the watcher fires whether or not anyone is
  looking. They answer different questions and neither replaces the other.

---

## Realignment log

**Aug 16, 2026: split out of `ROADMAP.md`; reprioritized around the season clock.**
The WPBL section had outgrown living as an appendix to the MLB roadmap, and that doc's WPBL
entries had gone six days stale while v1.33 → v1.43 shipped. Changes to the plan, not just
the filing:

1. **Postseason data hygiene promoted to #1**: from "deferred, low stakes" to the lead
   item, and reframed. The old reasoning judged the *drama* of a bracket where everyone
   qualifies, and on that it was right, and a clinch tracker stays parked. But it never asked
   whether the code works, and it doesn't: the season-stat aggregation takes lines with no
   game context, so it *cannot* exclude a postseason game, and `counts_in_standings` is
   stored and never read. With semis best-of-3 and finals best-of-5 (format confirmed
   Aug 16), that's 7–11 games, up to 8 for a finalist against a 15-game season, landing
   unevenly on every leaderboard on the site. Only item here with a date we don't control.
   Split out **1b, series state**, as the postseason feature that does earn its keep.
2. **The season archive promoted to #2**: the section has no answer for Sep 7 onward, and
   parts of the answer must be captured while games are still being played.
3. **Predictions / pick'em demoted to parked**: it held the "marquee open item" label for
   twelve days without being started, which is itself a signal. Three weeks of games is not
   enough runway for a leaderboard, and it's the biggest build on the list.
4. **Search Console and the league primer moved up**: both are cheap, both are worth
   most during the season, and the primer feeds the SEO work.
