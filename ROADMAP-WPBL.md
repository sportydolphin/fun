# WPBL Roadmap

> Living document: a menu of ideas, not a contract. Reorder/drop freely.
> Companion doc: **[ROADMAP.md](ROADMAP.md)**: the MLB section, which runs on its own
> calendar and its own priorities. Nothing here blocks anything there.
> Tags: 🎯 casual · 🔬 serious fan · 🎮 fun/game · ⚙️ infra
> Last checked against production: **Aug 22, 2026** (18 of 30 regular-season games final;
> the clock below is counted from the live schedule, not from memory).
> Last realigned: **Aug 20, 2026**, against traffic data for the first time (see
> "What the traffic says"), and revised again later the same day when 1b turned out not to be
> blocked (see its entry). The seeding race and the bracket are both opt-in behind the
> experiments flag; before that Aug 17, 2026. Teams tab, Settings and an accessibility pass shipped
> as v1.45.0 (see the shipped log); favourite-team + theming remains built and parked (see
> "Parked, with reasons"); before that, split out of `ROADMAP.md` and reprioritized around
> the season clock (see the realignment log at the end).

---

## The clock: read this before prioritizing anything

**12 games left. The last regular-season game is Sep 6, 2026, just over two weeks out, and the
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
Schedule · Standings (W/L/PCT/GB/L10/STRK/DIFF, H2H tiebreak) · Stats, one row of board tabs
(Players, a ranked list on a phone and the full table on a desktop, with a Sort sheet, a
Filters sheet and a team cut · Teams · Pitch by pitch · Run value, experiments only · Tracked,
hidden until the league publishes radar again · Draft) · Teams (ranked club cards with
record, form, run differential and next game, plus a head-to-head grid) → team pages (record,
results, opponent splits, season totals, leaders, roster with inline stats, lineup-history
and pitching-usage grids, all under a pinned club switcher) · Game Center (recap, box score, play-by-play, pitch data) ·
Player pages at `/wpbl/players/<slug>` (batting/pitching/fielding cards, game log,
pitch-location maps, shareable links that unfurl) · search · live polling · push reminders · a fan Discord integration
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

**What it does NOT have:** predictions/pick'em on the site itself (the Discord game is not the
same thing), win probability (the Run value board is the run half of it; the win model is what
is missing), daily standouts, a league primer or stat glossary, series records anywhere but the
bracket, and almost nothing that survives Sep 22 (the Commons archive gallery and the Run value
board are the two exceptions, and neither is a reason to visit twice).

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

### 1. Postseason data hygiene ⚙️: ✅ **shipped Aug 20, 2026** (see the log). Kept here until the first postseason game confirms what the feed sends

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

**Scope** (done): thread game context into the four aggregation functions and their 23 call
sites; audit every `status === 'final'` filter for whether it means "counts toward the
season record" or "has been played"; confirm what the feed actually puts in `game_type` for
a postseason game (unknown until the first one lands, and the semis start right after
Sep 6).

### 1b. Series state 🎯: ✅ **the bracket shipped Aug 20, 2026, behind the experiments flag** (see the log). The rest is open

Postseason baseball is series-shaped and **almost nothing in the section models a series**.
The schedule, recaps and the Discord poster are all single-game shaped. "SF leads 2–1" is the
unit fans track, and as it stands a best-of-5 clincher gets recapped as "the Firebells won
4–2" with no notion that a championship was just won.

**THIS ITEM WAS FILED AS BLOCKED AND WAS NOT.** The entry used to end "depends on knowing how
the feed represents a series (game number? series id?), which is unknown until the first
postseason game lands." That premise was wrong, and it had parked the whole item behind a date
we do not control. A series needs no id: the postseason is the only part of the schedule
`countsInStandings` rejects, and **within it an unordered pair of team ids identifies a series
uniquely**, because the semifinals are 1v4 and 2v3, the championship is the two winners, and
no two of those three pairings can be the same two clubs. Grouping postseason games by their
team pair reconstructs every series record with no new field, whatever the feed calls them.

**Done**: `derive/bracket.ts` (pairings from the standings order, series records from grouped
postseason games, championship slot, champion) and the Home card that draws it. Before Sep 6
it is a projection that moves with the standings; from Sep 9 the same boxes carry real series.
**Opt-in from Settings**, so turning it on is the remaining step, exactly as it was for 1c.
Note the flag has to earn its keep faster here than it did there: an opt-in card is seen by
almost nobody, and this one has three weeks before the thing it draws stops being a projection.

**Still open**: series records on the schedule and Game Center, series-aware recap and Discord
wording, and a clinched/eliminated state. None of these are blocked either, by the same
argument.

**The one real dependency**, now isolated: the feed must mark postseason games at all, through
`game_type` or `counts_in_standings`. If it marks neither, those games read as regular season,
the bracket stays empty and every season total is wrong, which is the exposure #1 already
carries (see `season.ts`) rather than a new one. Confirm it the day the first semifinal lands.

### 1c. The seeding race 🎯: ✅ **shipped Aug 20, 2026, behind the experiments flag** (see the log)

All four clubs qualify, so a clinch tracker is pointless and stays parked. **Seeding is not
pointless**: the standings order sets the semifinals 1v4 and 2v3, and it is the only thing
the remaining games decide. Nothing on the section said so, and Standings presented itself
as a race for a title already conceded to everyone. Shipped as a card under the table: seed
number, the cushion over the seed below, a magic number to lock a seed, and the semifinal
each seed would draw. All derived from `computeStandings`, so it needed no new data and no
new request. **Opt-in from Settings**: it is the first thing on the section to make a
forward-looking claim rather than report a result, and a number like "8 to lock 1st" is worth
being wrong in front of a handful of volunteers first. Turning it on is the remaining step,
and it now shares that step with the bracket (1b), since both sit behind the same switch.

The flag did come off briefly on Aug 20 and went back on the same day. Worth recording only
because the argument for taking it off still stands and will have to be answered again: an
opt-in card is seen by almost nobody, so the caution buys little signal, and there are three
weeks left for either card to be worth anything. Whatever settles that, it should settle it
for both at once rather than one at a time.

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

### 3. SEO follow-through ⚙️: *the code half is done; links are the brake*

**Search Console is verified** (it was recorded as open here and in `CLAUDE.md` until Aug 21,
2026, and both were wrong). The plumbing is all built and shipped: robots, a sitemap on a daily
cron, per-route meta and JSON-LD, real `<a href>` links, one path per tab, a page per player,
and real 404s for everything else (see the Aug 21 entries in the log). **Pre-rendering was
cancelled rather than built**: URL Inspection confirmed Googlebot renders the JS completely, so
it would have bought nothing.

**What is actually left is not code.** As of Aug 21 the site had 3 indexed pages against ~128
submitted, and near-zero inbound links, which is the one input we cannot ship our way out of.
[`docs/BACKLINKS.md`](docs/BACKLINKS.md) is the list of who to approach and the drafts to send;
working that list is the item. Also open and cheap: `www.sportydolphin.fun` is NXDOMAIN.
Indexing lag is measured in weeks and search volume for "WPBL standings / stats / roster"
collapses after Sep 22, so the send-the-emails half is the part with a deadline.

### 4. League primer + stat glossary 🎯: *cheap, overdue, and feeds #3*

A short "what is the WPBL" explainer (four teams, one hub venue at Robin Roberts Stadium
in Springfield IL, inaugural Aug–Sep 2026, seven-inning games, link to the official site)
plus a glossary of the stat abbreviations. Every visitor to a brand-new league is a
first-time visitor. Doubles as indexable prose, which the section currently has almost
none of.

### 5. Daily standouts: Home card 🎯

A "top performers" card for the latest game day, built from box lines Home already fetches.
Mirrors the MLB TopPerformers/Spotlight pattern. Low effort, and there are 12 games
left for it to pay off.

### 6. Win probability in Game Center 🔬

✅ *built Aug 23, 2026, behind the experiments switch: see the log.*

The fiddly part was supposed to be a credible model for a seven-inning league with no
history, and it turned out the run-value work had already paid for it. An empirical
win-probability table is out of reach by three orders of magnitude (about 7,000 cells against
1,820 plays), but nothing has to be looked up: the run-expectancy walk already measures how
many runs follow each base-out state, and keeping that as a histogram instead of a mean gives
the two distributions a win model needs. From there it is exact dynamic programming backwards
from the last out, no simulation and no sampling noise.

Still open on top of it: a season WPA leaderboard, and ranking games by how much they moved
(the excitement number is computed already and nothing draws it).

### 7. Incremental depth 🔬

Fielding columns in the Stats tab (already computed in `stats.ts`, only surfaced on
player/team pages) · player-page splits vs each opponent as the sample grows · WPBL recents
in the empty-query search dropdown.

### 8. Cross-cutting leftover ⚙️

Settings accent-color picker (the last open item from the Aug 6 "Sprint C"; shared with the
MLB section).

---

## The data-mining backlog (Aug 20, 2026)

Everything above was scoped from what the section is *missing*. This list came from the other
direction: reading the schema and querying production to find what is already **stored and
unread**. It is a menu to work through over the rest of the season and into the winter, not a
one-off, so nothing here gets deleted when it ships. It gets a ✅ and a pointer to the log.

Numbers are real, taken from the live DB on Aug 20, 2026 (16 final games, 1,527 plays, 393
batting lines, 766 tracking rows). Where a probe says "in the sample" it read 1,000 rows,
which is all PostgREST returns without paging.

> Re-run any of these with the anon key: `curl "$VITE_SUPABASE_URL/rest/v1/<table>?select=…"
> -H "apikey: $VITE_SUPABASE_ANON_KEY"`. Public-read RLS means the whole mirror is queryable
> from the shell in one line, which is how this list got its numbers.

### The three underused assets

**1. `pitch_events` / `pitch_sequence`: a pitch-level dataset nothing reads.** ✅ *shipped as
the Pitches board, Aug 20, 2026 (see the log)*. Six codes, 2,801 pitches in the sample: `B`
ball 1139 · `K` called strike 553 · `P` in play 542 · `F` foul 392 · `S` swinging strike 151 ·
`H` hbp 24. That is roughly 4,300 pitches across every final game, against TrackMan's 766 rows
across **two**. Three findings that made it cheap: `pitch_sequence` is the same data as a
string and agreed with `pitch_events` on all 739 rows that had both, so the string is the
whole read; both are null on exactly the plays that are not plate appearances (steals, wild
pitches, subs), so a row with a sequence is one completed PA with no double counting; and
`batter_id` / `pitcher_id` are only 2.4% and 1.4% null, so the play log keys on our own player
ids after all. **The feed's own `type` labels are wrong** and this is the trap: `K` arrives as
`"unknown"` and `P` as `"pitchout"`. Decode the code letter locally, never the label.

**2. Hit direction is in the narrative text, at near-total coverage.** 475 of 522 balls in
play in the sample name a fielder or a field (`ss` 69, `3b` 58, `lf` 53, `2b` 46, `cf` 44,
`rf` 39, …), and the 47 misses were "up the middle" and "to p" / "to c" phrasings the probe
regex did not cover rather than plays with no direction. That is a league-wide spray dataset
for **every** game, with no radar involved, sitting in a column already fetched for other
reasons.

**3. Base-out state plus `runsOnPlay()` gives run expectancy for free.** ✅ *shipped as the Run
value board, Aug 23, 2026, behind the experiments switch: see the log*. Every play stores outs and all three bases, and
summing runs chronologically reconstructs the score at each play. So RE24, and a WPA-shaped
leverage number, are derivable from our own 1,527 plays with no new field and no new table.
The table it produced is itself the finding: nobody on and nobody out is worth **1.13 runs** in
this league against roughly 0.5 in the majors, which is what makes a borrowed table unusable
here.

### The list

Tags as above: 🎯 casual · 🔬 serious fan · 🎮 fun/game · ⚙️ infra.

- **Play of the game / biggest swings of the season** 🔬🎮. ✅ *the engine shipped Aug 23, 2026
  behind the experiments switch; the biggest-swings list itself was built and cut, see the log*. Build the run-expectancy table from our own play log,
  rank every play by its RE change. It is also the honest half of win probability (#6) without
  needing a credible seven-inning win model, and every entry is a tappable name, which the
  traffic section says is the retention lever. **Still open**, and all of it now cheap because
  `derive/runExpectancy.ts` is pure and the values are already computed: a Game Center badge on
  the game's biggest play (the per-game play rows are already fetched there, so it costs no new
  request), a Home "swing of the day" card, which is the half of this that only works while
  games are being played, and the permanent top-10 in the archive (#2).
  The `batter_id` worry in the original entry is gone: 18 of 1,725 plays are missing one and
  every one of those is a pickoff or reached-on-error row rather than a plate appearance.
- **Spray charts on player pages** 🎯🔬. A fan diagram per hitter from asset 2, with
  pull/middle/oppo percentages, and the inverse for a pitcher. Lands on the surface that
  correlates with return visits.
- **Daily "Call the Play" puzzle on the site** 🎮. [`derive/trivia.ts`](src/wpbl/derive/trivia.ts)
  is already written, pure and seeded, and only Discord can reach it. Seed it from the date so
  everyone gets the same play, add a shareable result grid. ~980 usable plate appearances is
  about three years of daily puzzles, and it needs no live feed. **The strongest durable item
  on this page after the archive.**
- **This day in the inaugural season** 🎯. A dated card replaying that day's recap, box,
  highlight reel and article. Everything is already mirrored (75 videos, 20 articles). Turns
  the archive from a static page into a daily surface.
- **Fan awards ballot** 🎮🎯. Every player in the league is a rookie and nobody has voted on
  anything. MVP, best pitcher, play of the year seeded from the leverage list. Uses the
  existing browser-writes-through-RLS path, and it *peaks after Sep 22* rather than dying with
  the feed.
- **Who owns whom: the batter-vs-pitcher board** 🔬. Four teams and six pairings means a
  hitter faces the same pitcher 10 to 15 times in one season, a sample a 30-team league never
  produces. [`derive/matchups.ts`](src/wpbl/derive/matchups.ts) already computes the lines and
  nothing surfaces a league-wide "biggest edges" board.
- **Season series pages** 🎯. Six rivalry pages: running series record, the H2H grid, the
  matchup edges, every game log. Six durable indexable pages from data already held.
- **Where they come from** 🎯. `hometown` on 118 players and `birth_date` on 65: a league map,
  an age curve, youngest and oldest. Indexable prose and images for a section that has almost
  none, which feeds SEO (#3).
- **Rolling form** 🎯. A last-5-game OPS sparkline per player. Nothing on the section answers
  "who is hot right now".
- **Fielding in the Stats tab** 🔬. 303 fielding lines, computed in `stats.ts` already, surfaced
  only on player and team pages. Also unlocks a catcher board from `sba` / `cs`. (Same item as
  #7, restated here because the data audit reached it independently.)
- **Errors behind the pitcher** 🔬. Unearned runs and errors charged while each pitcher was on,
  from fielding lines plus narratives. Nobody else covering this league will have it.
- **The season in 30 seconds** 🎯. Each club's W-L path and run differential over time as one
  chart, from 30 game rows. Makes a good share image.

## Parked, with reasons

- **Game predictions / pick'em (+ bots)** 🎮: *demoted from "the marquee open item",
  where it sat unstarted from Aug 4 to Aug 16.* With 12 games left, a Wilson-ranked
  leaderboard over ≤12 picks is statistical noise, and it is the largest build on the list
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
- **Ingest play-level `batter_id` / `pitcher_id` backfill**: ✅ **answered by measurement,
  Aug 22, 2026, and it was never as bad as this entry assumed.** The premise was that
  `resolveName` being exact-only leaves these null on any name variant. Counted over the whole
  play log: `batter_id` is null on **18 of 1,725** plays and `pitcher_id` on none, and all 18
  are `event_type: 'unknown'` rows (pickoffs, reached-on-error) rather than plate appearances.
  The Run value board reads the linkage directly and needs no name fallback. Nothing to unpark:
  win probability (#6) can assume the ids are there.
- **Game duration**: ✅ **unparked and shipped Aug 21, 2026**, from a source outside the feed.
  The original finding still stands for the league's own feed: no duration or first-pitch
  field, `completed_at` is a processing timestamp, plays carry no timestamps at all. RetroWPBL
  records `starttime` and `timeofgame` by hand and we now have permission to use it (see the
  log). Available only for games somebody has transcribed, which trails the schedule.
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
  **Closed Aug 21, 2026, and not by the permission.** Permission was granted, and re-checking
  the biofile against production the case had evaporated anyway: our own coverage is 106 of 118
  now, not 65, the biofile agrees on 104 of them, and it fills **zero** gaps, because the 12
  players we have no date for it has no date for either. One row disagrees (Luciana Moreno: we
  hold 2006-09-09 marked `doc-unsettled`, they hold 2006-09-06), which is a judgement call
  about two weak sources rather than a reason to ingest anything.

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

### Aug 23, 2026: the Stats tab, rebuilt around a phone

The table was sixteen columns behind a frozen 150px name column, which on a 375px screen shows
four of them at once, so the one thing anyone opens a stats page to do (rank the league by a
stat) meant scrolling sideways to hunt for a column and tapping its header. Three rounds of
work here had all been maintenance on that: a pinned sort column, a seam cover under it, a
scroll-into-view for the sorted header.

So on a phone the board is a list instead: rank, portrait, name, the ranked stat large on the
right, three more under the name, ten rows and a tap for the rest. An explicit Sort sheet
replaces header-tapping, with every stat's name written out; a Filters sheet holds the team cut
and the qualified toggle and says what qualified means. The five boards became one row of tabs
(Players, Teams, Pitch by pitch, Run value, Draft), which is what let the control bar go from
three rows and thirteen controls to two rows and four, in a shape that no longer changes as you
move between boards. Draft value stopped being a card pinned under two different boards. PA is
a column now, and the line under each name changes with the sort: a rate gets PA and
production, a counting stat gets the rates.

Two bugs came out of it that were nothing to do with the redesign. The nav published its height
as `offsetHeight`, which rounds: 43.8px reported itself as 44, so anything sticking below it sat
a fifth of a pixel low and the page scrolled through the crack all the way down. And the
league switch lit its WPBL label on an exact path match, so every WPBL tab that became a real
URL slid the rainbow across and left the label in unselected grey on top of it.

### Aug 22, 2026: what every play was worth

The third of the three underused assets, and the one that needed no new column at all. Every
row in `wpbl_game_plays` carries the outs and all three bases, and they are the state BEFORE
the play, so a walk forward through a half-inning gives both halves of run expectancy: what
each of the 24 base-out states goes on to produce, and what each play was worth as the
difference between the state it started in and the one it left.

**The table is the finding.** Nobody on, nobody out is worth **1.13 runs** in this league,
against roughly 0.5 in the majors, because the WPBL has scored 15.2 runs a game across seven
innings. That single number is why the board builds its own table instead of borrowing one:
priced against major-league expectancy every WPBL play would read as roughly twice the event
it was. Measured off 1,229 plate appearances in 18 games, and every cell carries its own count
on the page, because "bases loaded, nobody out" has been seen ten times and "nobody on, nobody
out" 248, and a grid of tidy two-decimal numbers would imply those are equally well known.

Three things the data settled, none of them guessable from the types:

- **The state after a play is the next row's state**, so nothing parses a narrative to find
  out where the runners ended up. The only row with no successor is the last of a half-inning,
  and an inning that is over is worth nothing by definition.
- **A half-inning that ended the GAME is dropped from the table and still valued.** Its runs
  are censored by the final out of the game rather than by the inning, so averaging it in drags
  every state it contains down, but the walk-off itself is a real play and must not vanish from
  the board that exists to rank exactly that. Two different questions, two different rules.
- **On a steal or a wild pitch the feed fills `batter_name` with whoever is standing at the
  plate**, not the runner who did the thing. Those rows shape the run-expectancy table (they
  move the state, and their runs are real) and are kept out of the per-player totals, or a
  leaderboard row would carry the wrong name and, worse, the wrong tappable link.

Validation, since a derived number that nobody can check is a number nobody should trust:
summing `runsOnPlay()` over every play reproduces the box-score total exactly on 16 of 18
games and is one short on the other two, 272 runs against 274.

Shipped as a Run value board on the Stats tab, beside Players and Pitch by pitch: runs added /
runs prevented per player, following the tab's Hitting/Pitching side, with one play worked
through beside it and the run-environment table folded shut underneath. A second list, the ten
biggest swings of the season with each play written out, was built and then cut: it was the
most interesting thing on the board to a reader who already knew what run value was and the
least useful to everyone else, and the worked example teaches what it was being asked to imply. The
engine is `src/wpbl/derive/runExpectancy.ts`, pure and tested like the rest of the derive layer,
so the Game Center badge and the Home "swing of the day" card are drawing work rather than
computing work.

### Aug 22, 2026: the league started trading, and the feed did not tell us

Diana Ibarra went from New York to Los Angeles and became two players. The league feed issues
a **new** `player_id` when someone changes club, flags both records ACTIVE, and leaves
`career_id` empty on each: there is nothing in the payload that says they are one person. The
ingest's roster matching is scoped to a single team, which is exactly right for the spelling
variants it was built for and exactly wrong here, so the Los Angeles id matched nothing and it
inserted a second Diana Ibarra.

The interesting part is what a duplicate does downstream, because it is not just a stray row.
Her season split 8 games to 1, so every leaderboard she was on undercounted her twice over.
The slug rule from Aug 21 did precisely what it was written to do with a shared name and
declared it ambiguous, which meant her canonical `/wpbl/players/diana-ibarra` — indexed, in
the sitemap, one day old — started answering a real 404. The Discord bot began offering a "did
you mean" list for a player who exists once. That is the case the Aug 21 log called "no live
example"; it took a day to get one, and it arrived from a direction nobody was watching.

What shipped:

- **`api_ids`** on `wpbl_players`: every feed id a person has held, `api_id` being the current
  one. Not cosmetic — `wpbl_pitch_tracking` is keyed on the FEED id, so a traded pitcher's
  work before the trade is only reachable through the old one.
- **`team_as_of`**: the date of the newest box score that placed her on `team_id`. The ingest
  re-reads old games constantly and each of those is honest evidence of where she was *then*,
  so without a date guard her club would be whichever game the loop last touched.
- **`tradeMatch` / `teamMoveWins`** in the ingest's `names.ts`, so the two new rules are plain
  functions the app's test runner can pin. The trade rule is the only matcher that reaches
  across teams and so the only one that could ever merge two different people: it wants the
  full name, at least two parts, exact after accent folding, and unique league-wide. Two
  players who really do share a name fail it and neither is touched.
- **`wpbl_player_team_changes`**, because a heuristic that runs unattended every two minutes
  needs somewhere you can go and see what it did.
- **`wpbl_merge_players(keep, dupe)`** for the duplicates no rule will ever catch: `names.ts`
  has documented the non-prefix nicknames (Gabby/Gabriella) since it was written.
- **Read paths that were quietly assuming nobody moves.** A team page aggregated its stats
  against its CURRENT roster, so a departed player's July would have vanished from the club
  she earned it for. A player's game log worked out the opponent from her current club, so her
  old games would have read "@ NY" for games she played *for* New York. The Hall of Firsts
  badged milestones with the roster row rather than the play. All three now take the club off
  the line or the play, which is the only place that knows which one it was.

### Aug 21, 2026: a page per player

118 of them, at `/wpbl/players/denae-benites` rather than `?player=<uuid>` hanging off
whichever tab you happened to open her from. A uuid tells a reader nothing and a search
engine less, and the same player reachable under five URLs was five near-duplicate pages
competing with each other. Now there is one canonical URL per person, and the old form 301s
onto it at the edge, which also hands over whatever ranking signal it had.

`/wpbl/players` is new and exists mostly to be crawled: a player is otherwise reachable only
from a stat-leader row (top five only) or a team roster behind a tab and a team selection,
which is a long way in from `/wpbl`. One flat page of real anchors puts every player one hop
from a page Google already has.

The slug rule has a case with no live example, which is why it is the one under test: no two
players share a name today, so when two do, BOTH take an id-suffixed URL and the bare name
resolves to neither. Serving a 404 for a genuinely ambiguous URL is recoverable; quietly
serving the wrong player is not. `npm run sitemap` warns loudly when it happens.

The sitemap is generated now ([`scripts/build-sitemap.ts`](scripts/build-sitemap.ts)), 128
URLs. Hand-maintaining five was fine; hand-maintaining a hundred and twenty was not, and the
old file was also claiming `changefreq: hourly` for pages that had not changed in a week.

Two things this needed that were not obvious. `/wpbl/players/*` is the only wildcard in
`_redirects`, because valid slugs are database rows; what stops it being a soft-404 hole is
the Pages Function resolving the slug and 404ing first, and Cloudflare's `*` matches across
slashes, so `/wpbl/players/a/b` needed rejecting too. And `openFromLink` was seating a base
history entry unconditionally, which was right for a pasted link and wrong from the new
index: it replaced the index entry, so Back from a player returned to the section root
instead of the list the reader came from.

### Aug 21, 2026: one URL per tab, so the section can be found at all

Search Console said the site had three indexed pages, and one of them was `/wpbl),and` — a
mangled link someone pasted, which Pages had happily answered with a 200 and the app shell.
Google had never heard of `/mlb`. Two silent causes, both now fixed:

- **Nothing linked anywhere.** Every internal navigation in `App.tsx` was a `Box` with an
  `onClick`, and Googlebot does not click. The only crawlable links on the site were the
  three real anchors in the footer, which is exactly the set Google had found. `linkTo()`
  makes them anchors that still route client-side.
- **Every path answered 200.** `public/_redirects` now lists the app's routes explicitly and
  sends everything else to a real `public/404.html`, which is what makes the file an
  allow-list and therefore load-bearing.

Then the tabs themselves: `?view=standings` became `/wpbl/standings`, and Schedule, Stats and
Teams likewise. A query string is one URL to a search engine, so the whole section had shared
a single title, description and canonical, and there was literally no page for "WPBL
standings" to rank. Each tab now has its own, and the old spelling 301s at the edge.

Googlebot's rendered HTML (via URL Inspection) settled the question that was holding up the
plan: **it renders the JS completely** — scoreboard, standings, leaders, recap prose. So
pre-rendering was cancelled rather than built.

Two traps worth remembering, both of which fail without a symptom: rewrites must target `/`
and never `/index.html` (Pages canonicalises the latter with a 308, turning every route into a
redirect to the home page), and `_routes.json` can only narrow function routing, never widen
it — the player share-card rewrite needed a catch-all file once the tabs moved.

Next: player pages at `/wpbl/players/<slug>`, which is where the long-tail volume actually is.

### Aug 21, 2026: the facts the league does not publish

RetroWPBL (`github.com/exu6jh/RetroWPBL`) is one person transcribing this season into
Retrosheet format by hand. We now have **explicit permission to use it**, which was the thing
missing in August, and the interesting part turned out not to be the thing we wanted it for
then. Their event files open with `info` records, and four of them exist nowhere in the league
feed: **`starttime`**, **`timeofgame`**, the **umpiring crew** and the **weather**.

`timeofgame` is the point. Game duration has been parked all season as investigated and not
derivable, and that finding was right about the feed: no duration field, no first-pitch field,
`completed_at` is a processing timestamp, plays carry no timestamps at all. This is simply a
different source, and it has both ends of the clock.

**Shipped**: `wpbl_game_details` (migration), [`scripts/sync-wpbl-retro.mjs`](scripts/sync-wpbl-retro.mjs)
on a daily Action, and a line under the Game Center scoreboard reading
`FIRST PITCH 6:30PM · LENGTH 2h 29m · WEATHER 78°F sunny · UMPIRES Janet Thomas McKeen, Kelly
Elliott Dine`, with the credit and a link beneath it. 14 tests over the parser.

**Its own table, not columns on `wpbl_games`.** That row is the feed's mirror and `wpbl-ingest`
rewrites it every two minutes, so a duration written there would appear, survive one cron tick
and vanish with no trace it had been there. Same reasoning as `wpbl_play_corrections`.

**Absence is the normal case, so absence renders nothing.** 11 games transcribed against 16
finals on the day it shipped, roughly six days behind, and it is hand work so it always will
be. The newest game in the section is therefore the one least likely to carry this, which
makes an empty state saying "not transcribed yet" the thing most readers would see, on the
game they most wanted. The block is simply not drawn.

**The play records are deliberately not mirrored.** We already hold the play-by-play from the
feed in more depth, and a second copy would be two truths about the same at-bats with no way
for a reader to tell which one they were looking at. Its value as an INDEPENDENT transcription
is as a check on ours, which is a different job.

**Two things the first version got wrong, both caught by looking at the rendered page.** A
game showed `UMPIRES Janet Thomas McKeen, herpe701`: the name lookup read
`umpires/UMPIRES2026.txt`, which lists five officials and is stale, and Emilie Herpick debuted
on Aug 12 without being added to it. The lookup now reads `biodata/biofile.csv` (everyone,
maintained) with the umpires file as a fallback, and **never substitutes an id for a name**:
an unresolved official is dropped and counted in the run log, because an id on a page is worse
than a shorter list. It also picks up Emma Charlesworth-Seiler, whose id sits in the coach
range because she is one, and who has umpired a game anyway.

Second: the `info` records are the crew **at first pitch**, and crews move. NYH's Aug 8 game
carries `com,"umpchange,6,umphome,monaa701"`, so that game had three officials and the page
listed two. `umpire_crew` (new column) is everyone who worked, and the four positional columns
stay as what they honestly are.

**Names render short, and the id is what makes that safe.** Both name files put "Thomas
McKeen" and "Elliott Dine" in the LAST column, so a page read `UMPIRES Janet Thomas McKeen`.
Those are middle or maiden names. A Retrosheet id is four letters of the SURNAME plus the
first initial, so `mckej701` says the surname is McKeen and `dinek701` says Dine, and
reporting on this crew calls her Kelly Dine. `surnameFromId` uses that rather than a rule like
"take the last word", which would turn a genuine two-word surname into the wrong name, and it
falls back to the whole field whenever the id proves nothing: rendering a name in full is a
much smaller error than rendering the wrong part of it.

**First pitch is stored and not shown.** It matched our own `wpbl_games.start_time` exactly on
all 11 games checked, one of them played through drizzle, so it is the scheduled start rather
than the moment of the first pitch. Showing a number we already hold, under a label claiming
more precision than it has, and crediting a source for it, would be three small wrongs. The
column stays: it anchors the duration, and a future transcription that does record a delayed
start would show up as this disagreeing with ours.

**Permission is the whole licence.** The repository carries no licence file, so the credit is
the consideration: it renders in the UI wherever the data does, and links out.


### Aug 21, 2026: twenty times the pitches, from a string we already had (v1.47.0)

The Stats tab's only pitch-level surface was Tracked, and the league has published TrackMan for
**two games**. Meanwhile every plate appearance of every game carries `pitch_sequence`, one
letter per pitch, and the only thing reading it was a decorative strip in Game Center. Decoding
it gives 4,356 pitches across all 16 finals against the tracked 766, and it needed no ingest
change, no new table and no new column.

**Shipped**: [`derive/pitches.ts`](src/wpbl/derive/pitches.ts) (pure, 17 tests) and
[`PitchView.tsx`](src/wpbl/PitchView.tsx), as a third **source** chip on the Stats tab beside
Season and Tracked. It reads the same Hitting/Pitching side as everything else on that bar.
Pitching gets swing-and-miss, strike throwers and put-away rate; hitting gets contact per swing,
pitches seen per PA and two-strike survival. Each board prints the league's own number beside
the title, because a 10.8% swinging-strike rate means nothing until you know the league is at
5.6%. `LeaderRow` moved out of TrackingView into [`ui.tsx`](src/wpbl/ui.tsx), now that two
boards draw one.

**The trap, and it is a live one.** The feed ships a decoded `type` for every pitch inside
`pitch_events`, and **two of the six are wrong**: `K` (called strike) arrives as `"unknown"` and
`P` (in play) as `"pitchout"`. Between them that is 39% of every pitch thrown in the league.
Reading the label instead of the letter would have put a called strike and a ball in play into
an unclassified bucket and halved every rate on the board, with no error anywhere. The six-code
map in `pitches.ts` is the contract; an unrecognised letter is counted as unknown and reported
on the coverage line rather than guessed at.

**Two things the live data caught that the tests could not.** The first board put a hitter at a
flat 100% contact on **15 swings all season**, because the qualifier was on pitches seen and
contact is measured per swing. So `rankBy` now applies the sample bar to each rate's *own*
denominator, scaled off the league, and breaks ties toward the bigger sample: in a 16-game
season a board's top rows are mostly ties, and the one who has been tested most should lead.
Both are pinned by tests now.

**The one-line explainer under each board title took three passes.** It started as a formula
("Strikes per pitch"), which is not even what the number is: "per" is a ratio of unlike units,
which is what "pitches per plate appearance" two boards along actually means. The fix for that
was "Strikes as a share of every pitch", which is correct and reads like a statistics textbook.
What it says now is how a person would say it out loud: **"How often a pitch is a strike"**,
"How often a swing makes contact", "How rarely two strikes turns into a strikeout". Anyone who
wants the formula can read the number beside it. Row subtitles got the same treatment: the whiff
board names its own denominator ("25.7% of 105 swings missed") rather than pairing a per-swing
rate with a pitch total, which was both the wrong number to sit beside it and the reason the
line would not fit a phone.

**The Stats tab's source chips were reordered, renamed, and one of them now hides itself.**
The board shipped as the middle chip, labelled **Pitches**, which collided with the SIDE named
**Pitching** one row above it: with Hitting selected, a chip called Pitches read as "you are
about to leave the hitters", the opposite of what it does. It is **Pitch by pitch** now, and
the chips are ordered by how much of the season each can speak for: Season, Pitch by pitch,
Tracked. The internal value stays `'pitches'`, so the board-usage analytics keep one name
across the rename.

**Tracked is data-gated rather than deleted.** The league published TrackMan for two games in
early August and stopped. Two games of radar ranked as season leaderboards, one chip away from
a board covering all sixteen, invites a comparison that is not there. `trackingWorthShowing`
(in [`tracking.ts`](src/wpbl/tracking.ts), tested) needs four games AND a quarter of the finals,
read from the `wpbl_tracking_watch` row the daily watcher already maintains: one row and one
integer, so the chip row decides before paying for the tracking scan that would answer the same
question. **The chip comes back on its own** the day the feed wakes up, which is the thing the
retired Home teaser could not do. Two escape hatches: a `?view=tracking` link opens the board
regardless, and once a session has been on it the chip stays for the rest of that session
rather than stranding the reader somewhere they had just been.

**A leaderboard is a table, and tables on this tab do not use the raised fill.** Standings and
the season stats table are both drawn as a border on the page background. `SectionCard` uses
`background.paper`, which in dark mode is a lifted grey, so the two Stats boards read as a
different surface from the tables sitting one chip away from them. `SectionCard` takes a `bare`
prop now that drops the fill and keeps the border, and both Tracked and Pitches pass it. Default
is unchanged, because a card holding prose or mixed content (Home's, the team pages') does want
the raised fill that separates it from the page.

**Touch devices do not un-hover.** `LeaderRow` tinted on `:hover` unconditionally, so scrolling
a leaderboard with a finger left whichever row the scroll started on lit for the rest of the
scroll: a selection nobody made, on the row nobody was looking at. Hover now sits behind
`@media (hover: hover)`, the guard the Stats table already used, and the fix lands on Tracked
at the same time since both boards draw the same row.

**Postseason-safe by construction.** `aggregatePitchCodes` takes the schedule as a **required**
argument for the same reason `sumBatting` does: a play row carries a `game_id` and nothing else,
so it cannot say whether it belongs in a season total. It filters through `regularSeasonLines`,
excluding by the known-postseason ids, so a partial schedule over-counts rather than rendering
an empty board.

**The header was rewritten twice on the way out.** First pass opened with a tinted paragraph
explaining the coverage, three stat tiles and a titled card around the mix bar: about 300px
before the first leaderboard row on a phone, on a board that is nothing but leaderboards. The
prose was the problem, not the numbers, so the numbers stayed and grew (four tiles: pitches,
per PA, strike rate, swing rate) and the paragraph moved to the footnote.

**The four headline numbers are one divided block, not four tinted cards.** They shipped as
cards with a blue gradient wash and the number set in the same blue on top of it, which muddied
the one thing on the block that should be legible from across the room and spent the accent on
decoration. The accent now means something everywhere it appears here (a rank, a leaderboard
value, the swung-at half of the chart) and the numbers are simply the most contrast on the page
at the biggest size, inside one bordered box divided by hairlines, the way the season table and
Standings are drawn. Two by two at every width including desktop, where there is room for four
across and it is still wrong: the block shares its row with the chart there, so four columns
land at about 80px each and every subtitle truncates to "across all...".

**The header is two columns from `md` up.** Stacked full width, the four tiles and the outcome
chart each ran the page's whole measure for a line and a half of content apiece, which is a lot
of empty space on a desktop and a first leaderboard pushed down for nothing. Side by side they
read as one header block at half the height. A phone still stacks them.

**The six-colour stacked bar went too.** It asked a reader to hold a colour key in their head
and then read six widths off one line, the widest slice of which was 1%. It is now a ranked bar
per outcome, labelled in words on its own row, grouped by the one split that explains all six:
the batter either offered or did not. Colour carries that single fact instead of six arbitrary
ones, so the legend is two words rather than a key. The labels are spelled out, "Called strike"
and "Swinging strike" rather than "Called" and "Swinging", because both are strikes and that is
the whole reason they are listed apart from Ball. Titled **Pitch outcomes**, which is what the
block is, rather than the sentence it used to be titled with.

**Ordering: two descending runs under a heading that names the group and sizes it.** Grouped but
unheaded, which is what the first version shipped, the six bars read as one broken sort (long,
medium, tiny, medium) because nothing marked where the takes ended. Sorting all six by size
instead would drop "In play" between "Hit by pitch" and "Foul" and scatter the colour grouping
for no gain. Every bar, group headings included, is on one scale set by the bigger group, so a
group's bar reads as the sum of the bars indented under it. The light-mode palette is not the dark one:
the raw accent is 2.3:1 on light surfaces, which `constants.ts` already says is fine for a fill
and not for anything that has to be read, and a bar whose length is the information counts as
something that has to be read.

**Cheap on the wire**: `pitch_sequence` is the same data as `pitch_events` in a fraction of the
bytes (verified identical on every row carrying both), the narratives are not fetched at all,
and the rows without a sequence are dropped at the database. Paged, with a deterministic order,
for the reason on `fetchWpblAllPlays`.


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

### Aug 20, 2026: who goes where, drawn

- 🎯 **A postseason bracket on Home**, behind the experiments flag (`derive/bracket.ts`,
  `PlayoffBracket.tsx`). Two
  semifinals into a championship, drawn: 1v4 and 2v3 from the standings order, the higher seed
  always on top, every club a tap through to its page. Before Sep 6 it is a projection that
  moves with the table; from Sep 9 the same three boxes carry the real series; after that it
  names the champion. One card for all of September, because the interesting thing about a
  bracket is watching a provisional one harden, and only the subtitle changes.
- 🔍 **The blocker on 1b was imaginary, and that is the finding worth keeping.** The
  item had been parked on "we need to see how the feed represents a series", i.e. on a date we
  do not control. But a series needs no id from anybody: postseason games are the only ones
  `countsInStandings` rejects, and inside that set an unordered **pair of team ids** names a
  series uniquely, because no two of the three pairings in a four-club bracket can be the same
  two clubs. Series records fall straight out of grouping. **Worth re-reading the other blocked
  items with this in mind**: "blocked on the feed" was an assumption here, not a finding.
- ⚠️ What is genuinely still unknown, now isolated to one line: whether the feed marks
  postseason games at all. If `game_type` and `counts_in_standings` both come back looking like
  a regular-season row, the bracket stays empty AND every season total is wrong. That is the
  exposure `season.ts` already documents; the bracket just gives it a second symptom. Check it
  the day the first semifinal lands.
- 🔄 **The seeding race came out from behind the experiments flag and went back behind
  it**, both on Aug 20. The case for taking it off was that an opt-in card is seen by almost
  nobody, so the flag buys little signal, and three weeks of season is not long to wait; the
  case for putting it back is that it and the bracket are two readings of the same four rows
  and should be judged together rather than one at a time. Net effect on the shipped site:
  none. Both cards are opt-in, and the flag also still gates the mobile bottom nav.
- ✏️ The seeding card is no longer titled "The bracket" when the order settles. There is a
  real bracket on the section now and only one thing can carry that name; the card is "Final
  seeding" instead. This outlives the flag churn above: both cards are behind the same switch,
  so anyone who turns it on sees the pair together, which is exactly the case the naming has
  to survive. The two are deliberately different readings of the same four rows: the card
  is per club and quantitative, the bracket is per series and spatial.
- 🧪 29 tests. The derivation covers the pairings, series reconstruction, the
  championship slot and the champion; the render tests cover the two things drawing gets wrong
  on its own, a column of zeroes before a ball is thrown (which reads as a series finished
  nil-nil) and a championship box that resizes the card when a semifinal ends. Geometry was
  measured in a real browser, since jsdom does no layout.

### Aug 20, 2026: the Discord predictions game, which runs itself

- 🎮 **"Call It Early" ships**, the mod-hosted in-game game the schema had been sitting in
  production for since Aug 17 with no code behind it. A mod runs `/predict open` during the
  break between innings, the channel answers "how many runs" with four buttons (0/1/2/3+), and
  the league's own play-by-play settles it. One winner a game.
- ⏱️ **Picks close themselves**, on whichever comes first of the round's timer and the target
  half-inning starting. The second is checked **on the button press**, not only on the ingest's
  two-minute pass: a round whose inning started ninety seconds ago still reads "open" in the
  table, and anyone watching the game could otherwise see a run cross and then click.
- 🏆 **The game ends itself too**, crowned on the same not-final to final transition that posts
  the box score. `/predict winner` stays as the override for a watch party that breaks up
  early. Both claim `wpbl_predict_winners` by primary key, so it can never be announced twice.
- 🪤 **The trap it is built around:** nothing in the feed says *when* a play happened, so a
  voting window can never be closed before the event it asks about. Asking about a half-inning
  nobody has played removes the problem instead of managing it. `/predict open` refuses a half
  that is already under way, reading whichever of the play log and the feed's live situation is
  further along, because between innings the two disagree.
- ⚙️ **One rulebook, two runtimes.** The rules and the cards are pure and unit tested
  (31 tests); the I/O and the settle pass are plain `fetch` against PostgREST, so the
  Cloudflare Pages function and the Deno edge function run the same grading rather than two
  copies that drift.

### Aug 20, 2026: auth links have to say something when they land

- 🐛 **The reset link opened nothing.** `PASSWORD_RECOVERY` is emitted from a `setTimeout`
  inside the supabase client's initialize, once, to whoever is subscribed at that instant, and
  is never replayed. Whether React had mounted by then was a race against one network round
  trip. Lose it and the link silently did nothing, which looks exactly like a broken link.
- ✅ **Email confirmation now says so**, which is the other half of the same bug and had been
  true since the site launched. `SIGNED_IN` does fire for a confirmation link, but the
  reload-and-toast is gated on having been *confirmed signed out* first, and it never is:
  `INITIAL_SESSION` is emitted on a microtask after initialize while `SIGNED_IN` waits for a
  macrotask, so the session is already known by the time `SIGNED_IN` lands. Confirming your
  email showed nothing at all. There is now a dialog.
- 🔑 **Both are driven from `getSession()`**, which awaits the same initialize that consumes
  the link, so it can neither resolve too early nor be missed. The events stay as a fast path.
  The link type is read at MODULE scope, one line after the client is constructed: the client
  wipes the fragment as soon as its first network call returns, so anything that waits for
  React finds an empty URL.
- ⌛ **A third dead-link shape**, tokens present but no longer redeemable, now explains itself
  too. It is not the `#error=` shape `takeUrlAuthError` catches, and it was the case that sat
  on a blank page.
- 🧪 [`authLinks.test.tsx`](src/__tests__/authLinks.test.tsx) covers arriving on each link type
  and **never emits either event**, so it fails if this regresses to relying on one.
- 📌 **Deploy note:** every origin a reset can be requested from has to be in the project's
  redirect allow-list, or supabase silently substitutes the Site URL. The dev server picks a
  random port (`autoPort`), so a local reset link lands on production unless the allow-list
  carries a `http://localhost:*` entry.

### Aug 20, 2026: a way back into an account

- ✅ **Password reset**, which the site has never had: a "Forgot password?" link under the
  sign-in password field, and the set-a-new-password dialog the emailed link lands on. Google
  accounts can use it too, and end up with a password as well as the button.
- 🔒 **The confirmation is worded the same whether or not the address has an account.** A reset
  form that answers "no account with that email" is a free membership check for anyone holding
  a list of addresses. supabase deliberately does not say which, and neither does this.
- 🪤 **The trap this flow sits on:** [`AuthContext`](src/AuthContext.tsx) reloads the page on
  `SIGNED_IN`, to strip OAuth callback params from the URL. A recovery link IS a sign-in, so
  that reload would throw the reader straight back out of the flow. It does not, because
  supabase emits `PASSWORD_RECOVERY` **instead of** `SIGNED_IN` for a recovery redirect. That
  is load-bearing and invisible, so [`passwordReset.test.tsx`](src/__tests__/passwordReset.test.tsx)
  pins it: the dialog opens on the event and nothing calls `location.replace`.
- ⌛ **A dead link now says so.** An expired or reused link comes back as `#error=...` rather
  than a session, and supabase clears that fragment only on the success path, so it is still
  there to read. Previously the page just loaded signed-out with no explanation. Now it opens
  the reset form with the reason. Guarded on the fragment carrying an error, so it can never
  race away the tokens on a link that actually worked.
- 🧪 The set-password half is reachable only from an inbox, so it cannot be checked by opening
  a browser. Six tests cover it instead: mismatch, too-short, the successful save, and the
  no-reload guarantee.

### Aug 20, 2026: what the last games are actually for

- ✅ **Item #1c shipped**: a **Seeding race** card under the Standings table. The section had
  spent the season showing a four-team race for four postseason places, which is not a race.
  The stake is the ORDER, because it sets the semifinals 1v4 and 2v3, and nothing anywhere
  said so.
- 🧮 [`derive/seeding.ts`](src/wpbl/derive/seeding.ts) is pure and takes `computeStandings`
  rows as given, so the card cannot contradict the table it sits under. Per club: seed,
  games remaining, the gap to the adjacent seeds, a magic number, and the range of seeds
  still reachable.
- 🔒 **The magic number deliberately ignores the head-to-head tiebreak.** At zero it means the
  seed is locked OUTRIGHT, which is a claim a fan can repeat without qualification; leaning on
  a tiebreak would make it depend on a series not yet played. It therefore reads a touch
  conservative in the last week, which is the safe direction for a number people quote at each
  other. Same "outright" rule for the reachable range, which is why two clubs finishing level
  both land on the lower of their two seeds: the standings sort has already broken that tie by
  the time the card sees it.
- 📐 **One row per club, six columns.** The first pass drew the four clubs twice, as two
  bracket boxes and then as a list, and each row put a name at the left margin, a number at the
  right and a hand's width of nothing between them. Folding the matchup into a column killed
  the second copy and gave the middle of the row something to hold. The card lost a third of
  its height in the process.
- 🏷️ **The cushion cell names the club it measures against**: "0.5 ahead of Queens". A bare
  games-back figure always begs "behind whom?", and the club it means here is never the one the
  Standings table's own GB column uses, so the answer has to be in the cell rather than in a
  header. It is also the first column to drop as the card narrows, being the one figure a
  reader can approximate from the table above.
- 🔤 **A and B letter chips pair the two clubs of a semifinal**, which are never adjacent on a
  list ordered by seed. Our labels, not the league's, which names its games by date.
- 🚪 **Every club on the card is a tap through to a team page.** Standings was a surface with
  no route to a player page, and the traffic says opening one is the retention event.
- 📊 Carries its own impression (`wpbl_seeding_shown`) plus `wpbl_seeding_team` on a tap, since
  `wpbl_tab_viewed` cannot tell a reader who reached Standings from one who reached this.
- 🧪 **Behind the experiments flag**, so the shipped Standings tab is unchanged. The card
  carries an `ExperimentalChip` in its header, which is new: everything the flag gated before
  this announced itself by replacing something (the bottom tab bar is impossible to miss),
  while a CARD arrives looking exactly like the shipped cards either side of it. Without the
  chip, a bug report about an experiment is indistinguishable from a bug report about the site.
  The chip and its `--experimental-fg` colour are app-wide, not `--wpbl-` prefixed, so MLB can
  use them.
- 📌 **Not** a bracket feature: series state (#1b) still waits on the first postseason row,
  because how the feed represents a series is unknown until Sep 9. The card knows the format
  and the dates; it does not yet know a series score.

### Aug 20, 2026: the postseason cannot reach the season numbers either

- ✅ **Item #1 is done.** The standings half shipped Aug 19; this is the aggregation half. All
  four functions in [`stats.ts`](src/wpbl/stats.ts) now take the schedule as a **required**
  argument and filter their input through `regularSeasonLines()`. Required rather than
  optional on purpose: a defaulted parameter makes forgetting it silent, and silence was the
  entire failure mode. `tsc` named all 23 call sites, which is the first time this class of
  bug has been catchable by the compiler rather than by noticing a wrong number.
- ✅ **`countsInStandings` moved to [`season.ts`](src/wpbl/season.ts)**, which imports nothing
  but types. `stats.ts` is bundled into the Cloudflare Pages Functions behind the OG cards and
  the Discord `/player` command, so importing the predicate from `api.ts` would have dragged
  the whole supabase client to the edge. Both bundles verified clean afterwards.
- ✅ **Two more of the same bug, found on the way.** `computeWpblTeamStats` kept its own copy
  of "games played" and would have divided regular-season runs by a total including playoff
  games; and the qualifier thresholds scale off games played, so the postseason would have
  raised the bar for a rate title mid-October and dropped players off leaderboards they had
  already earned. Both now share one filtered helper.
- ✅ **The edge surfaces carry the schedule too.** The `/player` card reads it from the bot's
  existing roster cache, which already refreshes once a game; the unfurl card fetches three
  narrow columns over about forty rows. The Discord cache tolerates an entry written before
  the field existed by treating it as an empty schedule, which excludes nothing.
- 📌 **Still unknown, and unknowable until Sep 9:** what the feed actually puts in `game_type`
  for a postseason game. Every row today reads `regular` / `counts_in_standings: true`. That
  is exactly why the predicate is matched loosely and fails open, and why the shape landing
  now matters more than the values: come Sep 9 only the predicate should need revisiting.

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
