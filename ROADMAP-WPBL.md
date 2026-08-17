# WPBL Roadmap

> Living document — a menu of ideas, not a contract. Reorder/drop freely.
> Companion doc: **[ROADMAP.md](ROADMAP.md)** — the MLB section, which runs on its own
> calendar and its own priorities. Nothing here blocks anything there.
> Tags: 🎯 casual · 🔬 serious fan · 🎮 fun/game · ⚙️ infra
> Last realigned: **Aug 17, 2026** — favourite-team + theming built and parked (see
> "Parked, with reasons"); before that, split out of `ROADMAP.md` and reprioritized around
> the season clock (see the realignment log at the end).

---

## The clock — read this before prioritizing anything

**17 games left. The last regular-season game is Sep 6, 2026 — three weeks out.**
Then the league's feed goes quiet and this section has no new data until spring 2027.

That single fact should grade every item below:

- **Season-locked** — needs live games to be worth building, and has ~3 weeks to earn its
  keep. Build it now or lose a year.
- **Durable** — still worth something on Oct 1. Safe to build late, but the *data* some of
  it needs must be captured while the season is running.

The section has spent the season accumulating features that only work when games are being
played. Nothing yet exists that makes `/wpbl` worth opening in November.

---

## Where the section stands

**Live surfaces:** Home (scoreboard strip, last-game recap card, next-game card + countdown,
standings, leaders, Hall of Firsts, tracking highlights, highlights rail, Discord invite) ·
Schedule · Standings (W/L/PCT/GB/L10/STRK/DIFF, H2H tiebreak) · Stats (hitting / pitching /
tracking / draft, sortable, team filter, qualified toggle) · Teams → team pages (record,
results, opponent splits, season totals, leaders, roster with inline stats, lineup-history
and pitching-usage grids) · Game Center (recap, box score, play-by-play, pitch data) ·
Player pages (batting/pitching/fielding cards, game log, pitch-location maps, shareable
links that unfurl) · search · live polling · push reminders · a fan Discord integration
(board, final-score box scores, YouTube highlight reels, `/player` slash command, giveaway
draw).

**Data:** the `wpbl-ingest` edge function mirrors the league's public feed
(`stats.womensprobaseballleague.com/v1`) into Supabase on a 2-minute cron — games,
box-score lines, play-by-play, TrackMan pitch tracking, ingest-health rows. Public-read
RLS, service-role writes. Birth dates come from a community sheet
(`scripts/ingest-wpbl-birthdays.mjs`), not the feed.

**What it does NOT have:** predictions/pick'em, win probability, daily standouts, a league
primer or stat glossary, any postseason handling, and anything at all that survives Sep 6.

---

## Next — in priority order

### 1. Postseason data hygiene ⚙️ — *hard deadline, nothing else on this list has one*

**Format** (confirmed Aug 16): all four teams qualify · semifinals **best-of-3** ·
finals **best-of-5**. So **7–11 postseason games** land on top of a 30-game regular season,
and a team that reaches the finals plays up to **8 more games on top of its 15 — a 53%
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

**Blast radius** — everything reading those four functions: Stats tab, home leaders, team
pages, player pages, the Draft tab's draft-value analysis, the Discord `/player` command,
and the OG cards on shared links. **The season archive (#2) is built on these numbers**, so
leaving this unfixed makes the permanent record of the inaugural season wrong.

**Scope:** thread game context into the four aggregation functions and their ~15 call
sites; audit every `status === 'final'` filter for whether it means "counts toward the
season record" or "has been played"; confirm what the feed actually puts in `game_type` for
a postseason game (unknown until the first one lands, and the semis start right after
Sep 6).

### 1b. Series state 🎯 — *the postseason feature that is actually worth building*

Postseason baseball is series-shaped and **nothing in the section models a series**. The
schedule, standings, recaps, and the Discord poster are all single-game shaped. "SF leads
2–1" is the unit fans track, and as it stands a best-of-5 clincher gets recapped as "the
Firebells won 4–2" with no notion that a championship was just won. Wants: series records
on the schedule and Game Center, series-aware recap and Discord wording, and a
clinched/eliminated state. Depends on knowing how the feed represents a series (game
number? series id?), which is unknown until the first postseason game lands.

### 2. The inaugural-season archive 🔬🎯 — *the only durable item on this list*

On Sep 7 this section becomes a static site with no reason to visit. The one asset worth
building is **the definitive record of the WPBL's inaugural season**: frozen final
leaderboards, single-season and single-game records, the complete game log, the Hall of
Firsts promoted from a home-page card to a permanent artifact, and a season-in-review page
with each team's arc.

Two reasons to start now rather than in September:

- Some of it needs **capture during the season** — anything derived from live state, or
  from feed fields that may not persist, has to be snapshotted while the games are running.
- It is the natural home for the multi-season support that has been deferred since Phase 3
  (see Parked). Building the archive is what makes 2027 a second season rather than a reset.

Worth noting as evidence of demand: `github.com/exu6jh/RetroWPBL` is a stranger
hand-transcribing WPBL play-by-play into Retrosheet format, game by game, from the same
public feed we already mirror in far more depth. People want the historical record.

### 3. Google Search Console + SEO follow-through ⚙️

Still unverified — there is no verification token anywhere in the repo, and `context.md`
flags it as an open TODO. Search volume for "WPBL standings / stats / roster" peaks during
the season and collapses afterwards. The SEO plumbing (robots, sitemap, per-route meta,
JSON-LD, the edge-rewritten OG tags) is already built; being unindexed through the only
three weeks anyone is searching wastes it.

### 4. League primer + stat glossary 🎯 — *cheap, overdue, and feeds #3*

A short "what is the WPBL" explainer (four teams, one hub venue at Robin Roberts Stadium
in Springfield IL, inaugural Aug–Sep 2026, seven-inning games, link to the official site)
plus a glossary of the stat abbreviations. Every visitor to a brand-new league is a
first-time visitor. Doubles as indexable prose, which the section currently has almost
none of.

### 5. Daily standouts — Home card 🎯

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

- **Game predictions / pick'em (+ bots)** 🎮 — *demoted from "the marquee open item",
  where it sat unstarted from Aug 4 to Aug 16.* With 17 games left, a Wilson-ranked
  leaderboard over ≤17 picks is statistical noise, and it is the largest build on the list
  (pick UI + grading + boards precompute + a daily bot Action). Its value decayed past its
  cost for *this* season. Revisit for **2027 Opening Day**, when it gets a full season to
  accumulate against — or ship a stripped "pick today's winner + running record, no
  leaderboard" if the appetite is for something now.
- **Multi-season support** — deferred since Phase 3; folds naturally into the archive (#2)
  rather than being its own project.
- **Followed players / teams + notifications** — dropped as low-value for a four-team
  league. The per-game and all-games push reminders already cover the real need.
- **Favourite team + team colour theming** ⚙️🎯 — *built Aug 17, 2026, parked the same day
  on branch `wpbl-favorite-team`.* Working end to end, not shipped: the theming isn't
  settled. What's on the branch — a one-shot Home prompt that never shares a screen with
  the Discord card, a ★ toggle on each team page, "no favourite" as a real answer that
  never re-prompts, and a section that takes the team's colour (solid nav chip, radial
  masthead, ~4% card wash, tinted card hairline, and `theme-color` for the phone's browser
  chrome). Contrast is measured per team rather than assumed — a fixed white nav label
  fails WCAG AA on **seven of the eight** team/theme pairs.
  **Why it's parked, and the thing to solve first:** in a 30-game season, anything that
  prioritises your club takes more away than it gives — every game is a big slice of the
  whole — which is why the pick only ever *adds* colour and never hides, reorders, or
  demotes the other three. That constraint leaves colour doing all the work, and colour
  alone didn't feel like enough to justify the ask. Two concrete problems to fix before
  unparking: **Heights blue (`#5bb2ec`) is nearly the league default (`#60a5fa`)**, so a
  quarter of the audience picks a team and sees almost nothing change; and a team page
  still shows its *own* club's colours in the body while only the chrome follows your
  favourite, which is defensible but was never actually decided.
  The DB column (`user_preferences.wpbl_favorite_team_id`) **is already on main and applied
  to production** — it shipped alone because it had been applied before the feature was
  parked. It is nullable and nothing reads it.
- **Ingest play-level `batter_id` / `pitcher_id` backfill** — the play log's `resolveName`
  is still exact-only, so name variants leave these null. Nothing reads them today (Hall of
  Firsts resolves by name instead). Would need a redeploy + `mode=all` re-ingest. Unpark
  only if win probability (#6) or a "biggest hits" feed needs the linkage.
- **Game duration** — investigated thoroughly and not derivable: the feed has no
  duration or first-pitch field, `completed_at` is a processing timestamp, and plays carry
  no timestamps at all. TrackMan `occurred_at` is the only wall clock and is absent for
  untracked games. Unpark only if the feed exposes a real first-pitch / final-out stamp.
- **Streak report cards, Milestone Watch, WPBL Streak Survivor** 🎁 — the remaining fun
  MLB mechanics. All want more season history than a six-week inaugural year provides.

---

## Ongoing hygiene & ops

- **Name-mangling audit.** We store **"Estheoa Segovia"**; her name is **Esthela**
  (Liliana Esthela Segovia Arredondo). Same family as the issues
  [`names.ts`](supabase/functions/wpbl-ingest/names.ts) handles. Two-minute fix on a live
  page showing a real player's name wrong.
- **Portrait rights.** Ask the league for permission to republish player headshots — open
  since the portrait work, and more pressing now that shared player links unfurl with them.
- **Periodic dupe / orphan audit** of players and games; the ingest has produced duplicate
  roster rows before (bad decode, tz-twin games) and each was caught by hand.
- **Birth dates: 65 of 118 players.** The community sheet does not cover everyone.
  *Evaluated and declined (Aug 16):* RetroWPBL's `biofile.csv` would fill 37 of the 53
  gaps, but it carries no license (all rights reserved by default), 6 of its dates are
  year-only, and 13 disagree with our sheet — 5 of those as clean day/month transpositions,
  meaning one of the two sources has ambiguous date formatting. Not worth ingesting.
  Revisit only if we get explicit permission *and* a way to adjudicate the conflicts.

---

## Background — architecture and locked decisions

**The league.** Inaugural season Aug 1 – Sep 6, 2026. Four teams (Boston Hunters, LA
Queens, NY Heights, SF Firebells), 30 regular-season games (15 each), all at one hub venue
(Robin Roberts Stadium, Springfield IL). **Seven-inning games** — ERA is computed over 7,
not 9. **Postseason:** all four teams qualify · semifinals best-of-3 · finals best-of-5,
so 7–11 games follow Sep 6 (up to 8 more for a finalist).

**Architecture — pivoted twice.** It began as owner hand-entry with Supabase as the source
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
- **Two write paths only** — browser-through-RLS for user rows, service-role for everything
  ingested or derived. See `context.md`.

**Live gotchas worth remembering:**
- The recap engine (`derive/recap.ts`, `derive/discordRecap.ts`) is loaded by three builds
  including **Deno**, so its runtime imports need explicit `.ts` extensions and it must
  never import `constants.ts`. See `context.md`.
- A **vendor-chunk split** (`manualChunks` splitting MUI/React) was tried and **reverted** —
  it produced a circular import that blanked the page on a fresh load. Any retry must keep
  React + MUI + emotion in one chunk and be browser-verified first.
- TrackMan coverage is partial and radar-based: home runs leave the park and often go
  unmeasured, so an absent HR on a distance board is a data gap, not a bug.

---

## Shipped log

### Phases 0–2 (Jul 29 – Aug 4, 2026)

- **Phase 0** ✅ — schema + RLS + public read; teams, rosters (all 118 draft-board players),
  the 30-game schedule; the `/wpbl` shell behind the toolbar MLB | WPBL toggle.
- **Phase 1** ✅ (v1.23.0) — box-score read view, player pages, season totals, the shared
  `ui.tsx` design language, real colors and logos, public launch.
- **Feed pivot** ✅ — `wpbl-ingest` + cron mirror; Game Center with line score,
  play-by-play, TrackMan, live in-game state; hand-entry retired.
- **Phase 2** ✅ (v1.24 → v1.27) — rich Home, the sortable Stats tab, redesigned player
  pages, Hall of Firsts, live-updating schedule/scoreboard/leaders.

### Phase 3 — hardening and depth (Aug 4 – Aug 10, 2026)

- ✅ **Ingest hardening** — name-variant resolution (nickname/accent/edit-distance),
  server-side duplicate-game dedup, an ingest-health log table, the TrackMan "Unknown
  pitcher" fix, and the tracking backfill that re-fetches recently-final games from the
  uncapped `/activity` endpoint (which also lifted the old 200-row/game cap).
- ✅ **Loose ends** — browser back-stack via `history.state`, confirmed team secondaries,
  off-roster filtering (`status === 'Signed'` + anyone with a stat line), ingest freshness
  moved into the Admin panel.
- ✅ **Team pages**, ✅ **search integration**, ✅ **richer standings** (PCT/GB/L10/STRK +
  H2H tiebreak), ✅ **velocity / TrackMan leaderboards** (the Tracking tab).
- ✅ **Aug 9–10** — WPBL made the site default; pitch-location maps; swipeable tabs; the
  ERA-over-7-innings correction; schedule polish; per-game push reminders; the auth
  return-to-page fix; and a performance pass (session cache for bulk reads, column-projected
  the heaviest play fetch).

### Aug 12–16, 2026 — the Discord era, recaps, and team-page depth

Roughly 60 commits and v1.33 → v1.43. Not previously logged here; the doc's last
realignment was Aug 10.

- ✅ **Auto game recaps** (v1.38.0) — a headline, a narrative account, stars of the game,
  decisions and the R/H/E line, built from the box score and play log, with league-relative
  wording (a "rout" is calibrated to how the WPBL actually scores). Home gained a Last Game
  card.
- ✅ **The fan Discord integration** — the board with persisted message ids, box scores
  posted when a game goes final (and corrected in place), YouTube highlight reels posted as
  playable embeds, a **`/player` slash command** with forgiving name matching and
  autocomplete, and a giveaway draw. Documented in [`docs/DISCORD.md`](docs/DISCORD.md).
- ✅ **Shareable links** — every game and player has its own URL, and a shared player link
  unfurls with their name, club, season line and headshot via a Cloudflare Pages Function.
- ✅ **Stats tab restructured** — two axes (hitting / pitching / tracking / draft) instead
  of four tabs that were never peers, with a pinned control bar. Added a **Draft tab**
  plotting season production against draft position.
- ✅ **Team-page depth** (v1.42.0) — lineup-history and pitching-usage grids (last six
  games, opposing starter and handedness per column, short-rest flagged), opponent splits,
  and stat columns that say something the record above doesn't.
- ✅ **Play-by-play rewritten** (v1.43.0) — one shape per play, about a quarter less text,
  substitutions demoted to their own quiet line, pitch sequences decoded into pips.
- ✅ **Box scores fit a phone** — every column, no sideways scroll, names shortened rather
  than clipped; innings that were never played are no longer printed.
- ✅ **Birth dates + zodiac** — `scripts/ingest-wpbl-birthdays.mjs` pulls a community sheet
  into `wpbl_players.birth_date`, reconciling the sheet's two halves and flagging conflicts.
- ✅ **Reminders became a standing setting** (v1.42.1) — one switch for every game, and the
  MLB pick reminder was split into its own opt-in so WPBL fans stopped receiving it.
- ✅ **Infra** — a real **migration runner** (`scripts/migrate.mjs` + `scripts/migrations/`,
  replacing hand-run SQL), `context.md` onboarding doc, an experimental-features switch, a
  changelog split out of the entry chunk, `functions/` type-checking, and a cold-load
  payload reduction.
- ✅ **Game Center swipe + card polish** (v1.44.0) — `SwipeableViews` gained a **`pane`
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

## Realignment log

**Aug 16, 2026 — split out of `ROADMAP.md`; reprioritized around the season clock.**
The WPBL section had outgrown living as an appendix to the MLB roadmap, and that doc's WPBL
entries had gone six days stale while v1.33 → v1.43 shipped. Changes to the plan, not just
the filing:

1. **Postseason data hygiene promoted to #1** — from "deferred, low stakes" to the lead
   item, and reframed. The old reasoning judged the *drama* of a bracket where everyone
   qualifies, and on that it was right — a clinch tracker stays parked. But it never asked
   whether the code works, and it doesn't: the season-stat aggregation takes lines with no
   game context, so it *cannot* exclude a postseason game, and `counts_in_standings` is
   stored and never read. With semis best-of-3 and finals best-of-5 (format confirmed
   Aug 16), that's 7–11 games — up to 8 for a finalist against a 15-game season — landing
   unevenly on every leaderboard on the site. Only item here with a date we don't control.
   Split out **1b, series state**, as the postseason feature that does earn its keep.
2. **The season archive promoted to #2** — the section has no answer for Sep 7 onward, and
   parts of the answer must be captured while games are still being played.
3. **Predictions / pick'em demoted to parked** — it held the "marquee open item" label for
   twelve days without being started, which is itself a signal. Three weeks of games is not
   enough runway for a leaderboard, and it's the biggest build on the list.
4. **Search Console and the league primer moved up** — both are cheap, both are worth
   most during the season, and the primer feeds the SEO work.
