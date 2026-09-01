# WPBL Roadmap

> Living document: a menu of ideas, not a contract. Reorder/drop freely.
> Companion doc: **[ROADMAP.md](ROADMAP.md)**: the MLB section, which runs on its own
> calendar and its own priorities. Nothing here blocks anything there.
> Tags: 🎯 casual · 🔬 serious fan · 🎮 fun/game · ⚙️ infra
> Last checked against production: **Sep 1, 2026** (25 of 30 regular-season games final, 5 left,
> and the feed carries no postseason row yet; the clock below is counted from the live schedule,
> not from memory).
> Last realigned: **Sep 1, 2026**, when the desktop rebuild (#0) finished and shipped as v1.58.0,
> which empties the top of the list five days before the regular season ends. Before that
> **Aug 20, 2026**, against traffic data for the first time (see "What the traffic says"), revised
> again later the same day when 1b turned out not to be blocked (see its entry). The bracket came
> out from behind the experiments flag and is live for everyone; the seeding race is still behind
> it; before that Aug 17, 2026. Teams tab, Settings and an accessibility pass shipped
> as v1.45.0 (see the shipped log); favourite-team + theming remains built and parked (see
> "Parked, with reasons"); before that, split out of `ROADMAP.md` and reprioritized around
> the season clock (see the realignment log at the end).

---

## The clock: read this before prioritizing anything

**5 games left. The last regular-season game is Sep 6, 2026, five days out, and the postseason
runs Sep 9 to Sep 22** (schedule in Background, below). Then the league's feed goes quiet and
this section has no new data until spring 2027.

**As of Sep 1 the mirror holds 30 rows and every one of them reads `game_type: regular`,
`counts_in_standings: true`.** No postseason game exists in the feed yet, so the one dependency
#1 and #1b both isolate is still unanswered, and it stays unanswered until the semifinals appear
(the dates were published, the seeds are not set until Sep 6). Two things follow. Anything that
must behave differently in the postseason cannot be verified before it runs live, so it should
fail toward the regular-season reading rather than toward blank (`season.ts` already does; new
code has to be written the same way). And **the day the first semifinal row lands is a
scheduled task, not a surprise**: read `game_type` and `counts_in_standings` on it before
trusting any season total on the site.

So the real deadline is Sep 22, not Sep 6, and the last two weeks of it are the highest-stakes
baseball the league will play. A season-locked feature that only just misses Sep 6 may still be
worth finishing; one that misses Sep 22 is a year late.

That single fact should grade every item below:

- **Season-locked**: needs live games to be worth building, and has three weeks to earn its
  keep, of which only five days still have regular-season baseball in them. Build it now or
  lose a year.
- **Durable**: still worth something on Oct 1. Safe to build late, but the *data* some of
  it needs must be captured while the season is running.

The section has spent the season accumulating features that only work when games are being
played. Nothing yet exists that makes `/wpbl` worth opening in November.

---

## Where the section stands

**Live surfaces:** Home (scoreboard strip, last-game recap card, next-game card + countdown,
standings, leaders, MVP race, bracket, Discord invite) ·
Schedule · Standings (W/L/PCT/GB/L10/STRK/DIFF, H2H tiebreak) · Stats, one row of board tabs
(Players, a ranked list on a phone and the full table on a desktop, with a Sort sheet, a
Filters sheet and a team cut · Teams · Pitch by pitch · Run value · Tracked,
hidden until the league publishes radar again · Draft) · Teams (ranked club cards with
record, form, run differential and next game, plus a head-to-head grid) → team pages (record,
results, opponent splits, season totals, leaders, roster with inline stats, lineup-history
and pitching-usage grids, all under a pinned club switcher) · Game Center (recap, with a win
probability graph any moment of the game can be read off, box score, play-by-play, pitch data) ·
Player pages at `/wpbl/players/<slug>` (batting/pitching/fielding cards, game log,
pitch-location maps, shareable links that unfurl) · search · live polling · push reminders · a fan Discord integration
(board, final-score box scores, YouTube highlight reels and Shorts, `/player` slash command,
giveaway draw, shop restock and auction-lot watchers).

**Data:** the `wpbl-ingest` edge function mirrors the league's public feed
(`stats.womensprobaseballleague.com/v1`) into Supabase on a 2-minute cron: games,
box-score lines, play-by-play, TrackMan pitch tracking, ingest-health rows. Public-read
RLS, service-role writes. Birth dates come from a community sheet
(`scripts/ingest-wpbl-birthdays.mjs`), not the feed. The league's scoring has errors in it and
the league is not reachable to fix them at source, so a nightly job checks the play-by-play
against the rules of baseball and our own corrections are applied as a read-time overlay
(`wpbl_play_corrections`), never written into the mirror.

**What it does NOT have:** predictions/pick'em on the site itself (the Discord game is not the
same thing), a season WPA leaderboard or any ranking of games by how much they moved (the win
model that would feed both is live, and `excitement` is computed on every game and drawn
nowhere), any credit for baserunning in a player's season value (the MVP race prices the plate
and the mound and a steal is neither), daily standouts, a league primer or stat glossary, series records anywhere but the
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
more than it looks. *(#5 was dropped on Sep 1 as a card the section already has. The reasoning
in this paragraph survived it and became #5b, which is the same aim at a fraction of the cost:
Home's one player name currently opens a box score.)* The primer (#4) and SEO (#3) hold, aimed at a cold audience returning at
12 to 20%.

---

## Next: in priority order

**Read this first, Sep 1.** #0 shipped, which empties the top of the list with five regular-season
days left. The numbers below are stable references and are not renumbered; the order to work them
in now is:

1. ~~**#1c, today or not at all.**~~ ✅ *Done Sep 1: the flag came off and the card was audited
   against a real browser on the way out, which found four scale bugs the desktop rebuild's sweep
   could not have found, because a flagged card never renders. See the log.*
2. ~~**#1b's open half, before Sep 9.**~~ ✅ *Done Sep 1: series records on the schedule and in
   Game Center, and series-aware recap, Discord and Bluesky wording. See the log.*
3. ~~**The postseason arrival check** (#1, and the note in the clock).~~ ✅ *Done Sep 1, as a job
   rather than as a diary note: `wpbl-postseason-check` compares the published calendar against
   the feed's own marking four times a day through the postseason and fails loudly on a
   disagreement. The answer to what the feed actually sends still arrives on Sep 9; what changed
   is that it now arrives as an email rather than as somebody remembering to look.*
4. ~~**#5 daily standouts.**~~ ❌ *Dropped Sep 1: this league plays one game a day, so the day's
   standouts and that game's stars are the same three players, and `LastGameCard` already draws
   them. See the entry. What it was really reaching for became **#5b**.*
5. **#5b: Home's one player name should open the player.** Two lines, and it is the only item on
   this list aimed straight at the measured retention gradient.
6. **#2 the archive**, scoped Sep 1 and smaller than it looked: the mirror is already complete
   against the feed, so there is no capture pass to write and the whole build can wait for the
   winter. Its one dated half, a verified export of the season, ~~cannot wait~~ ✅ *shipped
   Sep 1*. See the scope under #2.
7. **#4 the primer**, cheap, durable, and aimed at an audience that is entirely first-time
   visitors.

### 5b. Home's star name opens the game, not the player 🎯

Split out of #5 when that was dropped, because it is the half of it that was right.
`LastGameCard` renders one star and passes `onClick={() => onOpenGame(game)}`, so the single
player name on `/wpbl` opens a box score. `GameRecapView` two hundred lines up does it correctly,
passing `onOpenPlayer(p)`, so the wiring and the lookup from a `RecapStar` back to a
`WpblPlayer` both already exist. Worth checking at the same time whether the card should show
all three stars rather than one: it shows one because of a layout constraint (it shares a
stretched row with Leaders), which is a real reason and may still be the right answer.

### 0. The desktop rebuild: Home, and the 1.4x zoom that shaped it 🎯⚙️: ✅ **shipped Aug 31, 2026 as v1.58.0** (see the log)

Started and finished Aug 31, in five phases plus the shell. Kept in full rather than cut down to a
log entry, because the three kinds of fixed length it establishes (rem for boxes holding type,
`chromePx()` for structure, raw px for ornament) now bind everything new in the section, and the
reasoning for which is which is here rather than in the diff. `/mlb` still runs the 1.4 zoom on
its own subtree and takes its turn separately; that is the deliberate price recorded below.

What it was. A Home redesign and the retirement of the desktop `zoom` are one job rather
than two, because the zoom is what forced most of Home's layout decisions in the first place:
`HOME_WIDE_W` exists only to break back out of a column the zoom had already shrunk, and the
scoreboard's placement, its edge fades and the bracket's connector have each been wrong at
least once for the same underlying reason.

**What the zoom is.** `zoom: 1.4` on the app root at `md` and up, covering `/mlb` and `/wpbl`
together (`DESKTOP_ZOOM` in `mlb/constants.ts`). It was a one-line answer to a real problem:
a 720px mobile-first column reads tiny and lost on a 1440 monitor. It is not a browser
compatibility problem, and `zoom` has been standard since Firefox 126. This is a
maintainability job with an accessibility payoff attached.

**What it costs.** It splits the app into two pixel units that nothing in the type system tells
apart. CSS lengths, `scrollLeft` and `offsetHeight` are layout pixels; `getBoundingClientRect`,
viewport units and media queries are visual pixels, 1.4x larger. Every line crossing between
them has to divide by `--app-zoom`, and forgetting is silent: no error, no failing test. As of
Aug 31 that is 14 lines across 6 files that exist only to divide it back out (7 in WPBL, 5 in
the shared shell, 2 in MLB), sitting on top of 51 rect and scroll call sites in 8 WPBL files
that live in the same hazard. It has produced at least five shipped bugs: `--app-header-h`
twice in opposite directions, the scoreboard anchor, the scoreboard fade, and `PlayerDetail`
having to write `lg` where it means `md`. Two more artefacts: the page pops 40% larger in one
step when a window crosses 900px, and the zoom multiplies with the reader's own browser zoom,
so someone already at 125% because they need it lands at 175%.

**THE SHELL DECISION, TAKEN Aug 31: the wrapper moves DOWN onto the MLB view, it does not move
away.** The header, search, bell and account menu are inside the same wrapper and shared with
`/mlb`, so nothing can happen to the zoom on one section without happening to them on both.
Un-zooming the shell only on `/wpbl` is a one-liner and is worse than the bug it fixes: the
header would change size when you toggle MLB and WPBL, on a control that lives in the header.
Doing both sections at once is the only fully coherent end state and roughly doubles the work.
So the shell is retuned once at real scale and serves both, MLB keeps its 1.4x on its own
subtree, and `/mlb` reads slightly top-light until it takes its turn. That last part is the
price, and it is deliberate.

**WHAT A TYPE RAMP DOES AND DOES NOT COST, MEASURED Aug 31 RATHER THAN ASSUMED.** The obvious
replacement is to drop the zoom and raise the root font size instead, which scales the 454 `rem`
font sizes in `src/wpbl` for free. The first version of this entry said a blanket px-to-rem
conversion of all 156 fixed sizes was therefore "the job", on the strength of the note in
`AccessibilityContext.tsx` calling 1.125 the largest step the dense tables hold. Both halves of
that were wrong, and the correction is what shaped phase 2.

**Wrong the first way: a blanket conversion would break the Large text setting rather than
free it.** That setting exists precisely to scale TYPE and leave layout alone; its own note
rejects browser zoom because zoom reflows the wide grids into something other than what the
reader had. Put every dimension in `rem` and the setting becomes browser zoom. So the fixed
sizes are not one pile. They are three, and only the first belongs in `rem`:

- **Boxes reserving room for a string or a number.** A rank column, a club-name column, a
  scoreboard chip. These MUST grow with the type or they clip, and growing them is not
  "scaling the layout", it is the box doing its job.
- **Art and tap targets.** Badges, avatars, the dashed placeholder circle, a 24px close
  control, the `minHeight: 48` touch minimum. These are not holding type and must not follow
  it. A tap target that grows with the text size is a worse tap target.
- **Layout constants.** The scoreboard's 24px edge fades, its 40px hover zones, the sheet
  grabber. Nothing to do with type at any scale.

**Wrong the second way: the 1.125 ceiling is a caution, not a measurement.** Scanning every
leaf element on the Stats board at 1024px wide for overflow: **nothing clips at 1.125, and
nothing clips at 1.25.** The first thing in the whole section to overflow its box is the
`width: 18` rank column, and it goes at **1.375**, needing 20px for a two-digit rank. Three
call sites (`StatsView` twice, `ui.tsx` once). With those three in `rem` the scan is clean
through 1.625, which is as far as it was taken.

So the accessibility payoff is real but far smaller and far more targeted than first written:
it is a handful of narrow numeric columns, not 156 values. What actually justifies the phase is
the first bullet above, because a type-only desktop ramp in phase 3 only works if the boxes
holding type follow it.

**The phases.** Each leaves the site working; none is a long-lived branch.

1. **Move the wrapper, retune the shell.** `zoom` comes off the app root and goes onto the MLB
   view. Retune the toolbar at real scale: logo, the `BRAND_WORDMARK_MIN` raw-px threshold
   (tuned against the zoomed toolbar), the three `70vh` menu caps, and the `--app-header-h`
   publisher. Five compensation sites become dead and get deleted. Visible on `/mlb`, not on
   `/wpbl`.
2. **Put the text-sized boxes in rem, and only those.** Not 156 values: the subset that
   reserves room for a string or a number, judged per site against the three kinds above. Do it
   with the zoom STILL ON, so every file can be checked against a rendering that must not move
   at the default text size, and land it grouped by file rather than as one sweep. The check
   that matters is the overflow scan at 1, 1.25 and 1.375, not eyeballing.
   *Done Aug 31, 47 sites across 14 files.* `Home`, `PlayoffBracket`, `StatsView`, `ui`,
   `TeamPage`, `GameDetail`, `PlayerDetail`, `GamePreview`, `WpblApp`, `TeamsGrid`, `RecapCard`,
   `DraftValue`. Three kinds of site the first pass would have missed, all found by sweeping the
   rendered page rather than by reading the source: **glyph boxes** whose font was already in rem
   while the box was in px (the winner caret, the recap medal, which was the first thing on Home
   to overflow); **`tableLayout: 'fixed'` columns** in the standings, where a cell wider than its
   column does not push it out, it spills; and **budgets measured against type**, like the player
   band's `maxWidth: 200` form strip, which is sized against the bio line beside it and so has to
   scale with it.

   Sweep result, every leaf element checked for overflow at 1024 and 1440: Home, Schedule,
   Standings, Stats and the player page are clean through **150%**. Teams still truncates two
   club names at 137.5%, and that one is correct: they are `flex` + `ellipsis` with no fixed
   width, so the container is the constraint and the ellipsis is the designed backstop.

   What stayed in px, deliberately: every dot, badge, avatar and icon square; the `minHeight: 48`
   touch minimum; the scoreboard's 24px fades and 40px hover zones; the sheet grabber; the page
   column caps, which are phase 3's business.
3. **Set the desktop ramp, move the caps, flip the zoom off.** ✅ *Done Aug 31, settled at 1.25.*

   **TWO SCALES, NOT ONE, AND THEY CARRY DIFFERENT DEPENDENCIES.** `--app-type` is spent on the
   root font size, so it moves every `rem`: the type, and the boxes phase 2 taught to follow it.
   It multiplies with `--sd-text-scale`, because a reader who wants larger text on a desktop
   wants it larger than desktop already is. `--app-chrome` is spent on everything measured in px
   that is not type: MUI's whole spacing scale (one `spacing` function in the theme, since
   nothing reads `theme.spacing()` in JS), badges and portraits (one calc each in `TeamBadge`
   and `PlayerPortrait`, covering all 43 call sites), and the toolbar logo. It deliberately
   excludes `--sd-text-scale`: Large text scales type and leaves structure alone, and a tap
   target that grows with the text size is a worse tap target.

   Both are set at md+ on `:root[data-app-scale='wpbl']`, an attribute App.tsx sets per route.
   **MLB must stay out of it**: it still runs the zoom, and a root font-size ramp on top of a
   1.4 zoom compounds. Exactly one section is mounted at a time, so the two never overlap.

   `AccessibilityContext` had to stop setting `font-size` directly and publish its factor
   instead, because an inline style beats the stylesheet: left as it was, a reader on Large text
   would have got the MOBILE type size on a desktop. It also turned out `--sd-text-scale` was
   already being published for "the fixed-width numeric columns that have to grow with their
   contents", with a comment pointing at usages that never existed. Phase 2 did that job with
   rem instead.

   Caps re-derived, all stopping their `/ var(--app-zoom)`: `HOME_WIDE_W` 900 to **1260**,
   `FULL_BLEED_W` 1100 to **1540**, `BAR_W` to match, the section column 720 to **1008**. Each
   is the old layout number times the 1.4 it was rendered at, so every column is the same width
   on screen it has always been.

   **The ramp is at 1.4, which reproduces today's rendering exactly, and that was the point of
   landing it there**: it makes the flip verifiable rather than a matter of taste. Verified at
   1728: no `zoom` anywhere, root font size 22.4px, Home column 1260, scoreboard chip 190.4px,
   toolbar logo 44.8px, all identical to the zoomed rendering. Sticky offsets meet exactly
   (header bottom 56.98, control bar top 56.98). Zero overflow on Home, Schedule, Standings,
   Teams and Stats at both text scales, including the new combined maximum of 1.4 x 1.125.
   The wordmark threshold needed a second value (960 unscaled, 1350 scaled) because the same
   lockup is 1.4x wider in viewport pixels on a scaled route.

   **Settled at 1.25**, after landing at 1.4 to prove the flip and then moving it. 1.4 was
   never a desktop decision: it was the number that stopped a phone column looking lost, and it
   magnified everything equally, margins included. With the column caps now set independently
   the scale only has to size the CONTENT inside them, and 1.25 puts body copy at 16px. At 1728
   that is seven scoreboard games instead of six and two more cards above the fold, in the same
   pixels. Lower starts to read as small on a page where a lot of the type is 0.6-0.8rem by
   design.

   **Two kinds of column, and the difference is what the content can do with width.** The
   section column (Schedule, Standings, Teams) is a READING column: it tracks the scale via
   `chromePx(720)`, because what a text column is measured against is its own type. Pinning it
   at a fixed screen width, which it was for one commit, made every row 12% wider than the
   words in it: a club name on the left of a Teams card with its record marooned at the right,
   a schedule row with a gulf between the matchup and the time. Home and the stats table BREAK
   OUT of that column and keep fixed widths (1260 and 1540) on purpose, because they have
   somewhere to put the extra room: another scoreboard chip, more stat columns.

   The number lives in one place, `WPBL_DESKTOP_SCALE` in App.tsx, published as
   `--app-scale-desktop`. CSS keeps the breakpoint, because a media query is the one thing JS
   should not be deciding. The toolbar's second wordmark threshold is DERIVED from it rather
   than written down, since a hardcoded pair would drift the first time the scale moved and the
   symptom would be a wordmark ellipsising into the search box in one narrow band of widths
   nobody thinks to check.

3b. **The shared toolbar, scaled on both sections.** ✅ *Done Aug 31.* Until this, switching
   WPBL to MLB shrank the whole bar 25%, because only WPBL's root carried the scale. A third
   variable, `--app-shell`, scales the `AppBar` on its own and only where the root is not
   already doing it. It spends it as `zoom`, which is the right tool for a chrome bar and the
   wrong one for a section: see the CLAUDE.md entry. Two raw px in the bar had to become
   structure for the two paths to agree, the `Toolbar` minHeight and the search box width.
   Measured on both routes: bar 61px, logo 40px, search box 325px, wordmark within 1.7%. The
   only residual is MUI's own hardcoded 5px `IconButton` padding, worth 2.5px on a 40px control,
   left alone rather than chased with a global theme override.

4. **Delete the compensations.** ✅ *Done Aug 31.* Every `--app-zoom` division in the section is
   gone: the scoreboard's anchor placement is plain subtraction again, the nav-height publisher
   hands over its rect, `PINNED_CHROME` spends the sum as it arrives. `PlayerDetail` drops back
   from `lg` to `md`, which it only used because `md` meant 900px of screen but 643px of layout
   inside the zoom. CLAUDE.md's trap is rewritten rather than patched: the old one described two
   pixel units, which is no longer the hazard.

   **The regression this phase caught.** Phase 3 re-derived the page columns and missed every
   structural length INSIDE them: a `maxWidth: 840` that used to render at 1176 rendered at 840
   against type that was still larger. The player dialog wrapped a name onto two lines. Found by
   opening the page, which is the only thing that finds it. `chromePx()` in `ui.tsx` now carries
   that kind, and the three kinds are written up in CLAUDE.md.
**Verification, because nothing in the suite can catch this.** All 1,009 tests pass at 1.4 or
at 1: jsdom has no layout engine and none of them measure anything. Every zoom bug so far was
found by a person looking at the page, so that has to be the plan rather than the accident.
A screenshot pass over the five tabs plus the four detail screens, at 640, 1024 and 1440, in
both themes. Plus three measured invariants checked in a real browser, all three being known
regressions: the header and nav sticky offsets meeting with no crack, the scoreboard anchor
landing on a chip boundary at max scroll, and the bracket connector's stubs hitting the box
centres.

**On the timing.** This was scoped for after Sep 22, when the feed stops and the data freezes,
because phase 2's whole safety net is "the rendering did not change" and that net is weaker
while the scoreboard updates every two minutes. Brought forward deliberately on Aug 31 and
folded into the Home redesign. What that costs: the before-and-after screenshots are being
taken against moving data, so phase 2 needs more care per file than it would have in October,
and phase 3 lands during the run-up to the postseason. Worth knowing if something looks off in
mid-September.

### 1. Postseason data hygiene ⚙️: ✅ **shipped Aug 20, 2026** (see the log). Kept here until the first postseason game confirms what the feed sends

**Dates published Aug 24** and now carried on the bracket card (`POSTSEASON_SCHEDULE` in
`derive/bracket.ts`): Semifinal A Sep 9, 11, 13* · Semifinal B Sep 10, 12, 14* · Championship
Sep 16, 17, 19, 20*, 22*. They are a constant rather than rows, because a game row needs two
clubs and the seeds are not set until Sep 6.

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

**The last of those is now watched rather than remembered** (Sep 1, see the log).
`scripts/check-wpbl-postseason.ts` reads the league's published dates out of
`POSTSEASON_SCHEDULE` and the feed's marking through `countsInStandings`, and fails when they
disagree in either direction. It runs four times a day through September and October and is the
one job in the repo that is MEANT to go red. What it must never become is a filter: a
regular-season game postponed into the Sep 7-8 gap would vanish from the standings, which is why
the date raises an alarm a person reads and never decides what counts.

### 1b. Series state 🎯: ✅ **the bracket shipped Aug 20, 2026 and is now live for everyone** (see the log). The rest is open

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
**The flag came off**, and what took it off was the odds rather than a decision to be braver: a
bare projected bracket is a third view of the standings, and the same boxes carrying a price on
each series are the section's one forward-looking surface. The hedge moved into the card's own
footnote, which is what a bracket-shaped guess needs and what a switch almost nobody flips never
was. Reasoning is in the header comment of `PlayoffBracket.tsx`.

**Odds, added Aug 24** (see the log): the bracket card now prices each series and the title from
season run differential, with an elimination flag, which is the "something new" the postseason
needed rather than a third view of the standings. `derive/seriesOdds.ts`.

**The rest shipped Sep 1** (see the log). `derive/series.ts` answers the question every surface
other than the bracket has, which is the opposite way round from `buildBracket`: given ONE game,
what series is it, which game of it, and what is the record. The schedule carries "Semifinal ·
Game 2 · Firebells lead 1-0", Game Center adds what a win would settle, and the recap engine
takes the series as an optional argument so the site card, the Discord embed and the Bluesky post
all say a championship was won on the night one is.

**Still open**: nothing on this item that is not waiting on Sep 9. The clinched/eliminated state
is carried by the bracket's flag and by Game Center's "Winner takes the series"; a club knocked
OUT is not named as such anywhere, which is a wording gap rather than a missing derive.

**The one real dependency**, now isolated: the feed must mark postseason games at all, through
`game_type` or `counts_in_standings`. If it marks neither, those games read as regular season,
the bracket stays empty and every season total is wrong, which is the exposure #1 already
carries (see `season.ts`) rather than a new one. Confirm it the day the first semifinal lands.

### 1c. The seeding race 🎯: ✅ **shipped Aug 20, 2026; live for everyone Sep 1** (see the log)

All four clubs qualify, so a clinch tracker is pointless and stays parked. **Seeding is not
pointless**: the standings order sets the semifinals 1v4 and 2v3, and it is the only thing
the remaining games decide. Nothing on the section said so, and Standings presented itself
as a race for a title already conceded to everyone. Shipped as a card under the table: seed
number, the cushion over the seed below, a magic number to lock a seed, and the semifinal
each seed would draw. All derived from `computeStandings`, so it needed no new data and no
new request. **Opt-in from Settings**: it is the first thing on the section to make a
forward-looking claim rather than report a result, and a number like "8 to lock 1st" is worth
being wrong in front of a handful of volunteers first.

**THE FLAG CAME OFF ON SEP 1, with five games left to live** (v1.59.0, see the log). The argument
was the expiry: the bracket (1b) is durable through Sep 22 and beyond, and a card whose whole
subject is what the remaining REGULAR-season games decide is worth nothing after Sep 6. An
experiment nobody can see is not being tested, it is just unread. The magic numbers were checked
against the live table before the switch and the arithmetic holds: SF need 2 to lock first, LA
and NY 2 apiece for second and third, BOS 5 to climb to third, which is every game both clubs
have left.

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

#### Scoped Sep 1, 2026, and the first bullet above is mostly wrong

The item has been carrying a deadline it does not have. Audited against the live feed and the
live mirror, field by field:

**THE MIRROR IS ALREADY COMPLETE AGAINST THE FEED.** Every field the feed publishes on a game,
a box-score line or a play has a column in `wpbl_games` / `wpbl_batting_lines` /
`wpbl_pitching_lines` / `wpbl_fielding_lines` / `wpbl_game_plays`, down to `pitch_sequence`,
`pitch_events`, `fouls`, `balls`, `strikes`, `home_lob`, `sf`, `sh`, `ibb`, `gdp`, `tb`. Today
that is 30 games, 610 batting lines, 142 pitching lines, 469 fielding lines and 2,358 plays. The
ingest has been snapshotting continuously since August; there is no separate capture pass to
write. Three things in the feed are NOT mirrored and none is worth a column: the venue's postal
address (one venue, all season), each club's and player's `profile_url` on the league's own site
(which dies with the site either way), and the `wins/losses/record/streak` fields on `/teams`,
which the league publishes empty and we compute ourselves anyway.

**SO EVERY HEADLINE FEATURE OF THIS ITEM IS RECOMPUTABLE FOREVER**, and none of it has to be
built before Sep 22. Frozen leaderboards, single-season and single-game records, the complete
game log, the Hall of Firsts, run expectancy, win probability, the MVP race, `excitement`, each
club's arc: all of it derives from stored plays and stored box lines. Nothing reads live state
that is not also written to the play log. The archive is a build-whenever job.

**WHAT IS ACTUALLY AT RISK, in order.** Not the feed's own data. The things AROUND it, all of
them partial and all of them owned by somebody else:

- **TrackMan: 2 of 25 finals.** 766 pitch rows, from a batch the league published once and
  stopped. Not a coverage gap we can close, and `wpbl-tracking-watch` runs daily **year-round**
  (checked: no season window), so a resumption in November is still caught. Nothing to do.
- **RetroWPBL: 20 of 25 finals**, a stranger's hand transcription, incomplete, and **no licence,
  so all rights reserved by default**. `wpbl-retro-sync` is also year-round. The licence is the
  problem, not the clock: it can be read to check our own rows and cannot be republished, which
  bars it from an archive that is meant to be the public record. Asking the author is the only
  path and it is not a September job.
- **YouTube: 20 of 25 finals have a linked video**, plus 112 unlinked clips. We hold ids and
  titles, never the video, and rehosting is neither possible nor right. Channel deletion is the
  rot and it cannot be mitigated. What CAN be checked is whether the metadata we keep reads as a
  record on its own once the embed is dead.
- **Five finals have no video and no Retro detail at all.** The box score is the whole record of
  those games. Worth knowing before someone promises "the definitive record".
- **One of 119 players has no bundled portrait**, and 118 do. Team logos are bundled too, so the
  art does not depend on anyone else's server.

**AND THE ONE REAL DEADLINE, WHICH WAS NOT ON THIS LIST AT ALL** (built Sep 1, see the log). Everything above says the
inaugural season survives as long as the mirror does. The mirror is one Supabase project. When
the feed goes quiet on Sep 22 there is no longer a source to re-ingest from, so from that date
the database stops being a cache of someone else's data and becomes **the only copy of the
WPBL's first season that we control**, and a dropped table or a lapsed project takes it with no
recovery path. A verified export is worth more than every feature in this entry and is a fraction of the
work. **That was the September job, and it is done**: `npm run archive` writes the season to
`archive/wpbl-2026/` and a weekly job commits it when it moved. Everything else here can wait
for the winter, which is also when it has an audience.

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

### 5. Daily standouts: Home card 🎯: ❌ **dropped Sep 1, 2026. It is a card the section already has**

A "top performers" card for the latest game day, built from box lines Home already fetches,
mirroring the MLB TopPerformers/Spotlight pattern. Cheap, durable past Sep 6, and it kept moving
up this list on the strength of the retention gradient.

**The premise was imported from MLB and does not survive contact with this schedule.** A daily
standouts card is worth building where a game day holds fifteen games and nobody can watch them
all, so a digest of the day beats any one box score. This league plays **one game a day**: 24 of
the 27 game days to Sep 1 had exactly one, all five remaining regular-season days have one, and
every postseason date has one by construction, since the bracket never runs two series on the
same night. So "the standouts of the day" and "the stars of that game" are the same three
players, computed from the same box lines, and `LastGameCard` on Home is already drawing them
from `buildRecap`. It would have been a second card restating the first, and the MLB pattern it
mirrors is the reason that was not obvious.

**What was actually right about it, and is now its own job.** The reason it kept climbing was the
traffic finding above: a browser that opens a player page returns at 76.5%, against 7.8% for one
that opens neither a player page nor Game Center, and Home is where most of them are lost. The
card was a means to putting a tappable player name in front of them. Home HAS one and it does not
go to the player: `LastGameCard` renders `recap.stars[0]` alone, and its name and portrait are
wired to `onOpenGame`, so the one player name on the section's landing page opens a box score
instead of the page the gradient is about. That is a two-line fix and a much better use of the
same reasoning than a new card, so it is filed as its own item rather than lost with this one.

### 6. Win probability in Game Center 🔬

✅ *built Aug 23, 2026, readable play by play by holding a finger on it, and live for everyone
from the same day: see the log.*

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
player/team pages) · player-page splits vs each opponent as the sample grows · ~~WPBL recents
in the empty-query search dropdown~~ ✅ *shipped Aug 24, 2026 (see the log)*.

### 8. Cross-cutting leftover ⚙️

Settings accent-color picker (the last open item from the Aug 6 "Sprint C"; shared with the
MLB section).

---

## Where new things go (decided Aug 27, 2026)

The section has four nouns: games, clubs, players, and **the league itself**. The fourth has
never had a home, which is why the media shelf sits on Home and the archive, the primer, the
glossary and the map have nowhere to be. Two containers, decided rather than drifted into:

- **Findings**, a chip on the Stats tab, for anything computed from the play log that ends in an
  answer: the steal economy, what a play is worth, what a count is worth, spray tendencies. One
  chip, however many cards. Shipped Aug 27. Rules for its cards are in the log entry above.
- **`/wpbl/league`**, for the durable half that is not a number: where the 118 players come
  from, the primer and glossary (#4), the inaugural-season archive (#2), the media shelf
  **moved off Home**, this-day, the awards ballot, the puzzle. All of it still works in
  February, which is more than the rest of the section can say. **Built and held back on Aug
  27**, not shipped: the page and the move both work, and the page wants another pass first.

**The league page gets no nav pill yet, deliberately.** It ships as a real path with real
sub-URLs, linked from the footer and one card on Home, and earns a sixth pill from the events or
does not get one. Two reasons: the top pills are already the least reachable place on an 812px
phone and the sixth used to sit off-screen entirely (see the note in
[`BottomNav.tsx`](src/wpbl/BottomNav.tsx)), and the footer is a proven crawl path, since it is
how Google found `/privacy` and `/terms` while `/mlb` sat undiscovered for months. Promoting it
later costs four lines; demoting it after it disappoints costs a redirect and an apology.

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
  none, which feeds SEO (#3). **Coverage recheck Aug 27: `hometown` is on all 118 and
  `birth_date` on 106**, and the tail is the story: USA 64, Canada 18, then Mexico, Australia
  and Japan on 9 each, South Korea 4, and one player each from Venezuela, the UK, France,
  Puerto Rico and Curacao. Ages 18 to 40, median 24.
- **Rolling form** 🎯. A last-5-game OPS sparkline per player. Nothing on the section answers
  "who is hot right now".
- **Fielding in the Stats tab** 🔬. 303 fielding lines, computed in `stats.ts` already, surfaced
  only on player and team pages. Also unlocks a catcher board from `sba` / `cs`. (Same item as
  #7, restated here because the data audit reached it independently.)
- **Errors behind the pitcher** 🔬. Unearned runs and errors charged while each pitcher was on,
  from fielding lines plus narratives. Nobody else covering this league will have it.
- **What every kind of play is worth** 🔬. The league's own linear weights, already computed by
  `playRunValues` and never shown: home run +1.55, double +0.82, single +0.54, walk +0.34,
  groundout -0.43, strikeout -0.52, double play -0.97, and the sacrifice bunt at **-0.00 runs
  across 14 attempts**. One small table settles "should they bunt" and "is a strikeout worse
  than a groundout" for this league rather than by analogy to the majors. (Data audit, Aug 27.)
- **What a single pitch is worth** 🔬🎯. Counts reconstruct cleanly from `pitch_sequence`, 5,657
  pitches, and nothing uses them: after 1-0 a hitter reaches base 48.4% of the time, after 0-1
  37.2%. **Eleven points of on-base on one pitch.** League first-pitch strike rate is 53.6%,
  and per-pitcher it separates (Kelsie Whitmore 72.0%, Gigi Schiano 43.2%), though only nine
  pitchers have faced 60 batters. `derive/pitches.ts` decodes the letters already and stops
  short of the count. (Data audit, Aug 27.)
- **Direction on every batted ball, from the prose** 🔬. 973 of 1,489 plate appearances name a
  fielder or a field in the narrative ("grounded out to 3b", "singled through the left side"),
  which crossed with `event_type` (groundout / flyout / popup / lineout) is a batted-ball
  profile for the whole season with no new ingest. Ground rates separate pitchers cleanly:
  Jill Albayati 69.2% on the ground, Raine Padgham 34.4%. Per batter it is thin, ~26 located
  balls for a regular, so this is a pitcher and team surface before it is the spray chart
  above. (Data audit, Aug 27.)
- **One ballpark, all season** 🎯. Worth confirming and then saying somewhere: the feed names a
  venue on 2 of 30 rows and RetroWPBL names one park on all 15 it covers, and they are the same
  Springfield ground. If that holds, "home" in this league means batting last and nothing else,
  which is context for every home/away number on the section. The record is consistent with it:
  the home side is 8-21 and scores fewer runs, 7.33 to 7.57. (Data audit, Aug 27.)
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

- **Name-mangling audit.** ✅ *Esthela Segovia corrected Aug 24, 2026* (was "Estheoa";
  migration `20260824120000_fix_estheoa_segovia_name.sql`). She was a seed-only row with no
  feed id and no games, so a guarded `UPDATE` was safe and the ingest will not revert it.
  Watch for the next such case: same family as the issues
  [`names.ts`](supabase/functions/wpbl-ingest/names.ts) handles.
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
at one hub venue (Robin Roberts Stadium, Springfield IL). **Seven-inning games**, but ERA is
computed over **9**, because the league publishes it that way and so does everyone reprinting
it (see the Aug 26 log entry; a reader can switch to 7 in Settings, and nothing that leaves the
site does). **Postseason:** all four teams qualify · semifinals best-of-3 ·
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

**The Discord watch parties for all eleven are already up**, named for the slot rather than
the clubs (`Semifinal A Game 1`), because an event is only worth having if it exists early
enough to RSVP to and nobody knows the matchups yet. `wpbl-discord-postseason` renames each
one as the bracket fills in, follows a first pitch that moves, and deletes the asterisked
games a clinched series never plays. See [`docs/DISCORD.md`](docs/DISCORD.md).

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

### Sep 1, 2026: the season, in files, because on Sep 22 there is nothing to re-ingest from

Written while scoping #2, which turned out to be a much smaller item than filed with one part
of it that was not on the list at all.

**THE MIRROR IS ALREADY COMPLETE AGAINST THE FEED**, checked field by field: every field the
feed publishes on a game, a box line or a play has a column, down to `pitch_sequence`,
`pitch_events`, `fouls`, `balls`, `strikes`, `lob`, `sf`, `sh`, `ibb`, `gdp`, `tb`. So the
entry's "capture during the season" half is mostly imaginary, the ingest has been doing it since
August, and every headline feature of the archive derives from stored plays and stored box lines
and is recomputable in 2030. The full scope is under #2.

**What that leaves is a category nobody had written down.** Until Sep 22 these tables are a
CACHE: every row is re-fetchable from the league, and losing the database costs a re-ingest.
After Sep 22 there is nothing to re-ingest from, and the same tables become the only copy of the
league's first season we control, with no announcement and no visible change. A dropped table or
a bad migration on Sep 23 is unrecoverable and looks like any other Tuesday.

`npm run archive` writes it to `archive/wpbl-2026/`, one plain JSON file per table, and a weekly
job commits it when the data moved. Git is the store because it is versioned, already mirrored
off-site, keeps every past export reachable, and shows in a diff exactly what changed.

**IT READS THROUGH THE ANON KEY, AND THAT IS A SECURITY PROPERTY RATHER THAN A SHORTCUT.** The
files go in a repository, so the one thing the export must be incapable of is picking up a row
that was not already public. Reading as the anonymous client hands that decision to RLS, using
the same policies that decide what the website serves: a table with no public policy exports
empty, and a table added to the list by mistake cannot leak. A service-role key would have
exported `events`, `feedback` and `wpbl_predict_*`. The cost of the choice is that this is NOT a
database backup and must never be described as one; auth, analytics, feedback, push and the
prediction game are outside it, and project-level backups are a separate Supabase decision.

**The failure an archive cannot survive is the short read**, because it looks exactly like
success. PostgREST caps a bare select at 1000 rows silently, so every table is paged over its
own PRIMARY KEY (half of them key on the feed's id rather than a uuid, so this could not be
assumed) and the run FAILS rather than writing a plausible partial file over a complete one.

**And it is verified rather than assumed.** `--check` re-reads every table and compares it
against both the file on disk and the digest in the manifest, so it catches a truncated file, a
hand-edit, and a database that has moved on. Tested by deleting a row from an exported file and
confirming it reports ALTERED, then restoring it and confirming it goes green: an untested
backup is a rumour, and a verifier that has never failed is the same rumour with more steps.

**One thing found on the way and deliberately left out of the export.**
`wpbl_player_team_changes` holds **13,644 rows encoding 18 distinct facts about 3 players**, and
grows about 2,900 rows a day, forever, because the ingest re-reads old box scores continuously
and the insert is not idempotent. It was half the archive by bytes and would have churned 4.7MB
into git every week for no new information, long after the season ended. The fact it records is
archive-worthy and the table will go in once it has a unique index on
(player_id, game_id, from_team_id, to_team_id) and has been collapsed. Nothing is lost meanwhile:
the resolved outcome lives on `wpbl_players` (`api_ids`, `team_as_of`) and is archived.

4,689 rows across 13 tables, 4.55MB. The four that ARE the season are `wpbl_games`,
`wpbl_batting_lines`, `wpbl_pitching_lines` and `wpbl_game_plays`: rows rather than computed
standings, because a derived number preserves one reading of the season and the rows preserve
all of them.

### Sep 1, 2026: the postseason is series-shaped, and so is the section now

Eight days before the first semifinal. Two things, and the small one is the more important.

**THE SMALL ONE: a job that is meant to fail.** `countsInStandings` fails OPEN by design, and
the price of that design has always been a dated one: if the feed marks a semifinal as nothing in
particular, the site folds up to eleven postseason games into every leaderboard, every player
page, the OG cards and the Discord `/player` card, the bracket sits empty while the games it
draws are being played, and **nothing anywhere goes red**. The plan for that was a note in this
file saying to look on Sep 9. `wpbl-postseason-check` replaces the note. It compares the league's
own published dates, read out of `POSTSEASON_SCHEDULE` rather than restated, against the feed's
marking read through `countsInStandings` itself, and exits 1 when the two disagree in either
direction: a postseason game we are counting, or a regular-season game we are not. Four times a
day through September and October.

It is the only job in the repo whose red X is the product. The play-by-play validator next to it
reports 57 known findings a night and therefore always exits 0, because a job that is red every
morning is a job nobody reads; this one is silent all season and goes red once. Both policies are
right and the difference between them is worth keeping straight, so each file says why it has the
one it has.

**And it must never become a filter.** The obvious move the day it fires is to have the app treat
the date as authoritative. That would drop a rained-out regular-season game made up in the Sep 7-8
gap out of the standings with no evidence it was ever there, which is the single-venue league's
most likely schedule accident. A date is good enough to raise an alarm a person then reads. It is
not good enough to decide what counts.

**THE LARGE ONE: `derive/series.ts`.** Postseason baseball is series-shaped and almost nothing in
the section was. "SF leads 2-1" is the unit a fan tracks, and a best-of-five clincher would have
been recapped to a public Discord channel and a public Bluesky feed as "the Firebells top the
Queens", on the night the league crowned its first champion.

`buildBracket` already grouped postseason games by pairing, but it answers "draw me the bracket"
and takes the standings to do it. Every other surface has the opposite question: given ONE game,
which series, which game of it, what is the record. So the format definitions moved DOWN into a
module that needs only a schedule, and bracket.ts now imports them rather than the other way
about. `BEST_OF` stated twice is how a semifinal ends up needing three wins on one screen and two
on another.

- **No series id, still.** The pair of team ids identifies a series uniquely inside a four-club
  bracket, which is what unblocked this item in the first place. The ROUND needs no id either and
  no dates: a club that reaches the championship plays in two pairings and one knocked out in the
  semifinals plays in one, so the championship is the pairing both of whose clubs appear twice.
  Dates were the obvious alternative and are the wrong one, because a postseason game is
  rescheduled far more often than a regular-season one and a semifinal that slid past the
  championship's published start would relabel itself.
- **A final reports the series INCLUDING itself and a preview EXCLUDING itself**, which is what a
  box score and a schedule row respectively mean, off one slice with no second code path.
- **Schedule** carries "Semifinal · Game 2" and the record. The record only: what a win would
  clinch is broadcast copy and belongs where there is room for it. **Game Center** has that room
  and carries both, so an unplayed decider reads "Winner takes the series" rather than naming one
  club as if only it had something at stake.
- **The recap engine takes the series as an OPTIONAL argument**, unlike the season aggregates
  where an omitted schedule silently over-counts and the parameter is therefore required. The
  worst a missing series does here is leave a sentence unsaid. The sentence closes the blurb,
  which is the highest-leverage place to put it: the site card, the Discord embed and the Bluesky
  post all render the blurb, so one change reached all three. A clinched series also goes to the
  FRONT of the feats, ahead of a three-homer game, which is the one night it outranks one.
- **The Deno fast path words it too.** `announce-final` inside `wpbl-ingest` usually posts before
  the hourly job and owns the message, so leaving the series to the job would have meant every
  postseason recap being silently corrected by an edit minutes later. That put `series.ts` and
  `season.ts` into the Deno import graph, and `denoGraph.test.ts` now names both so a refactor
  cannot quietly take the `.ts` extension check with them.
- **Nothing changes for a regular-season game, and that is pinned.** `recapMessageFingerprint`
  is the whole rendered message, so a footer that grew unconditionally would have re-edited all
  thirty already-posted recaps on the next pass. A test renders one both ways and compares.

Everything fails toward the regular-season reading, as anything written before Sep 9 has to:
with no game marked postseason, every function returns null and every surface renders exactly as
it does today.

**Verified against a simulated postseason**, since there is no real one to look at: three real
club pairings temporarily marked as series, then the schedule and Game Center read at 320, 390
and 1440, both themes, text scale 1 and 1.125. No clipping, no row taller than its neighbours, no
horizontal page scroll. 1,095 tests pass, 28 of them new.

One thing deliberately left alone: `gameNumber` is not clamped to `bestOf`. "Game 4 of 3" on
screen means the pairing has picked up a game that is not part of the series, which in this mirror
means a duplicated row, and the same duplication is inflating the record beside it. Clamping
would hide a real fault behind a plausible number.

### Sep 1, 2026: the seeding race comes out from behind the flag, and what an unrendered card hides (v1.59.0)

Built Aug 20, opt-in ever since, and with five regular-season games left the caution had stopped
being caution. The bracket on Home had already come out; this had not, and the two are not
symmetric: the bracket is worth something through Sep 22 and into the archive, while a card whose
subject is *what the remaining regular-season games decide* is worth nothing on Sep 7. An
experiment nobody can see is not being tested.

**THE AUDIT IS THE PART WORTH RECORDING, because it is a fault line the desktop rebuild could not
have caught.** Phase 2 of that rebuild worked by rendering each surface and looking for boxes
whose content had outgrown them, which is the only method that finds this class of bug. A card
behind the experiments flag never renders, so this one was not in the sweep's fourteen files and
kept raw px around type that is now 25% larger on a desktop. Four separate failures, all
invisible to `tsc` and to all 1,059 tests:

- The cushion column, 132px holding a string that wants 140, and 156 at the reader's Large text
  setting. Set `nowrap`, so it spilled left into the record beside it rather than wrapping.
- The status column, 116px holding "Can still reach 3rd" at 121. That one wrapped, which made
  the bottom row 2.5px taller than the other three and left its cell ragged.
- The header's badge spacer, a bare `width: 26` against a `TeamBadge` that scales itself through
  `--app-chrome` to 32.5. So the CLUB header sat 6.5px left of the club names for the whole life
  of the card.
- The semifinal column on a phone, where the 18px letter chip squeezed the opponent until
  "vs BOS" ellipsised to "vs B...". BOS is the league's only three-letter abbreviation, so
  exactly one row of four looked broken.

**And one worse thing that only shows at 320px: the club names were gone entirely.** Five fixed
columns left the flex club column 5px, so the rows rendered as a seed number, a record and a
matchup with no club attached. An ellipsis at least says something was cut. Fixed by dropping the
record column below `sm`, which costs nothing: this card renders directly under the standings
table, which carries the same four records in the same order a finger's width above it.

Every width is now in rem, sized against its longest possible string measured rather than
guessed, so the whole set holds at the desktop scale times the reader's text scale at once.
Verified at 320, 390, 1024 and 1440, in both themes, at both text scales: no overflow anywhere,
all four rows exactly equal height.

**Two changes to what the card says, both from reading it rather than from measuring it.**

The bottom club's cell read "Can still reach 3rd", a sentence in a column of numbers, answering a
different question from the three rows above it. It now reads **"5 to reach 3rd"**, priced by the
same `magicOver` the other rows use, just asked about `bestPossible` instead of the seed held.
Two formulas for "what does this club still need" would eventually disagree in front of a reader.
The ordinal came off the other three at the same time ("2 to lock", not "2 to lock 2nd"): the
seed being defended is the number at the left end of the same row, so the row was saying it twice.

**And the card now names the game that decides it**, which is the one thing a column of magic
numbers structurally cannot say. `swingGames()` returns the remaining fixtures between two clubs
who are ADJACENT in the table and whose order is still open in the same outright, no-tiebreak
sense the magic numbers use. Today that is exactly one, and the line reads "Thu, Sep 3: Heights
at Queens is the only game left between two clubs still disputing a seed." Both conditions exist
to keep games OFF that line: adjacency because ranking a 1-versus-3 game against the rest needs a
win model this does not have, and openness because the last week is mostly dead rubbers as far as
the ORDER goes, and naming one of those is worse than naming nothing.

Also: once the order is final the "To lock" column is removed rather than turned into four
identical "Seed set" cells under a header that has stopped asking anything, and the footnote's
sentence about the A and B labels renders only where those labels do, since the letters are
hidden on the narrowest phones so the opponent can stay whole.

### Aug 31, 2026: the section is drawn at its real size on a desktop (v1.58.0)

Item 0 above carries the phases and the measurements. What shipped, in one place:

**`zoom: 1.4` is gone from `/wpbl`.** It moved down onto the MLB view, which still runs it, and
two CSS variables replaced it on this side. `--app-type` is spent on the root font size, so it
moves every `rem`, and it multiplies with the reader's Large text setting. `--app-chrome` is
spent on px that is not type: MUI's whole spacing scale, badges, portraits, the toolbar logo,
and every structural length through `chromePx()`. It deliberately excludes the text scale,
because a tap target that grows with the text size is a worse tap target.

**The scale landed at 1.4 to prove the flip, then moved to 1.25.** 1.4 was never a desktop
decision: it was the number that stopped a phone column looking lost on a monitor, and it
magnified the margins along with the content. With the page columns now set independently
(`HOME_WIDE_W` 1260, `FULL_BLEED_W` 1540, the section column `chromePx(720)`), the scale only
has to size what is inside them. 1.25 puts body copy at 16px, which is seven scoreboard games
instead of six and two more cards above the fold in the same pixels. One constant,
`WPBL_DESKTOP_SCALE` in App.tsx.

**The shared toolbar had to be solved separately, and it is the one place `zoom` is right.**
The bar is shared with `/mlb`, and the two sections are scaled by different mechanisms, so
neither could reach it without reaching the other. `--app-shell` scales the `AppBar` alone and
only where the root is not already doing it. Measured on both routes afterwards: bar 61px,
logo 40px, search box 325px. Before this, switching to MLB shrank the whole bar 25%, on a
control that lives in that bar.

**Two things this cost, both worth knowing in September.** The before-and-after screenshots
were taken against live data rather than a frozen season, because the phase was pulled forward
from October deliberately. And `/mlb` now reads slightly top-light, since the shell is retuned
at real scale while that section keeps its 1.4 on its own subtree. That is the price of not
splitting the header in two, and it was taken knowingly.

**Nothing in the suite can catch any of this.** All 1,009 tests pass at 1.4 and at 1: jsdom has
no layout engine, so not one of them measures anything. Every bug in this whole track was found
by opening the page, including the one phase 4 caught, where a `maxWidth: 840` that used to
render at 1176 rendered at 840 against type that had stayed large, and the player dialog wrapped
a name onto two lines.

### Aug 31, 2026: every Short the league posts, in the highlights channel

The league publishes single-play vertical clips ("FIRST WPBL WALK-OFF", "Denae Benites GRAND
SLAM") and none of them reached Discord. The reason is the interesting part: **a Short is
identified by its shape, and the shape is not in the title.** `classify()` reads titles, and a
walk-off clip carries no keyword that a three-hour full-game replay and a sit-down feature do
not equally lack. Any keyword rule wide enough to catch the clips eventually drops a replay into
the channel. The one exact signal is the URL, since `youtube.com/shorts/<id>` answers 200 for a
Short and redirects to `/watch` for everything else, so the sync probes it once per upload into
`wpbl_videos.is_short`.

**Null in that column means undetermined, never no.** YouTube bot-gates this repo from GitHub's
IPs, so a 429 or a consent interstitial has to leave the column unanswered for a later run
rather than record a no. The poster requires `is_short = true`, which makes an undetermined
video a quiet miss instead of a wrong post. The probe also only runs where there is no stored
answer: the sync sees the same videos twenty times a day and the upsert rewrites every column it
names, so re-probing into a gated null would erase a Short already identified correctly.

**Seeding is per stream, and a job-wide flag would have flooded the channel.** The safety rule
is that a stream the job has never posted gets its newest item posted and the rest recorded as
handled. Reels had been posting for a fortnight, so "have we ever posted anything" would have
answered yes and emptied four days of Shorts at once.
`wpbl_discord_highlight_posts.stream` is what remembers, asked with one `limit(1)` per stream:
that table gains a row per video forever, and once the first 1000 rows are all reels, a bare
select would decide we had never posted a Short and re-seed a stream that had been running for
a year. Same PostgREST cap as everywhere else on this page.

### Aug 31, 2026: the merch watcher learns a second shop, where every lot is one of one

The league sells in two places, and the second is a marketplace rather than a shop. That
difference decided the design: the 190 lots on The Realest are game-used bases, game-worn
jerseys, nameplates and lineup cards, each unique, so nothing can ever come back into stock and
a restock diff is dead code against it. The only event worth a message is **a lot id nobody has
seen before**, which is why it got its own table and its own pass rather than a second flavour
of the Shopify one.

**Hourly, not every ten minutes**, because lots arrive in batch drops weeks apart, and because
`api.therealest.com/robots.txt` is `Disallow: /`. On an API subdomain that normally means "stay
out of the index" and their site allows `/`, but it is still their stated wish, so the watcher
asks as rarely as it usefully can, identifies itself, and has an off switch that is one
repository variable and no deploy: `WPBL_AUCTION_WATCH=off` the day they ask.

**The two sources must not be able to answer for each other.** `wpbl_shop_watch_runs` grows a
`source` column and every health query filters on it, because a Shopify check succeeding every
ten minutes would otherwise cover for an auction watcher that died in July, which is the one
thing that table exists to make visible. Their API carries both traps this repo keeps meeting:
`limit` caps at 100 with the real total in `pagination.total`, so a short read errors rather
than degrading into a channel that reads as a slow month, and prices are decimal strings, so a
round "250" read as an integer quotes a game-used base at $2.50.

### Aug 31, 2026: Home spends the desktop it is on, and the next game earns its card (v1.57.0)

Measured before anything was touched, at 1440x900 and at 375px, in the running app.

**The finding under most of the rest: Home was 1,008px wide on every monitor.** WpblApp caps the
section at `maxWidth: 720` LAYOUT px and the desktop `zoom: 1.4` renders that as 1,008, so the
page never widened past a 1024px window: 216px of dead margin per side at 1440, **456px at
1920**. Two 496px columns, a bracket that could not be drawn at a bracket's proportions, and a
leaders board whose names had to be shortened, all of it downstream of one number. Home now
breaks out with the same device StatsView's table already uses, `min(900px, calc(100vw /
var(--app-zoom,1) - 24px))`, capping at 1,260 rendered px. The viewport term makes it a no-op at
1024 and below, so it widens only where there is margin to spend. **Applied to the whole page,
not the grid alone**: the scoreboard and the h1 share the cards' column, and a grid 250px wider
than the strip above it reads as a mistake. Other tabs are untouched, so /wpbl and /wpbl/teams
now differ in width; widening the section is the obvious follow-up and was deliberately not done
here.

**The four cards were paired by HEIGHT, not by meaning, and it cost the page its best card.**
Next game (314) sat with Leaders (264) purely because they fit; Last Game (382) with the MVP race
(390). At 1440x900 row 2 begins at y=734, so the MVP race, the only card on Home that cannot be
got from another tab, rendered entirely below the fold. It now leads the right column and Leaders
follows it. That only works because both short cards were given something to do (below), and the
two are keyed in a two-element array rather than rendered in sequence: the race's play log is
fetched last on purpose, so the two swap slots about a second after first paint, and without keys
React reconciles by position, sees a different component type in slot 1 and **remounts Leaders**,
resetting the reader's pill selection under them. Rows now match exactly: 495/495 and 358/358,
zero injected stretch, against 58px before.

**Next game went from a countdown to a preview.** A form strip (the section's own `FormDots`,
moved from TeamsGrid into `ui.tsx` so there is one of them: green solid for a win, a red RING for
a loss, which survives the eight percent of men who cannot separate the two hues) and a three-row
cut of `WpblGamePreview` behind a new `compact` prop. **`FORM_DOTS = 15` is a WIDTH, not a fact
about the schedule**: at 320px, 32px of page gutter and 32px of card padding leave 256, the club
abbreviation and the streak take 78 with their gaps, and 178 remain, which at a 9px dot on a 3px
pitch is `12n - 3 <= 178`, so 15. Change the dot or the gap and redo that. The row ends in the
streak rather than the W-L, because at 15 dots the W-L became a straight duplicate of the record
three lines above it in the same right-hand column. The card is 495px against the MVP race's 390
natural, and the race's chart absorbs the difference, which is what its `fill` is for.

**`LEADER_ROWS` is 3 on a phone and 5 from md up, and the split is not a preference.** Leaders
against Last Game at three names is a 118px hole; at five it is 45. The board is built at five and
CSS drops rows 4 and 5 below md, so there is no breakpoint state to get wrong on first paint, the
ranks are numbered off the full list either way, and all five player links stay in the page for a
crawler. This constant has now gone 5 -> 3 -> both; it follows the pairing, and the pairing is in
the note beside it.

**Three columns of leaders does not fit, and the measurement is why.** Asked for and not shipped.
A compact leader row needs ~105px for the name (125 for "Andréanne Leblanc") plus ~117px of rank,
badge, sample and value. The card body is 412 LAYOUT px at 1440: three columns give **129px
each**, which clips every name, and two give 200px, which fits only by dropping the "50 PA"
sample that stops a 12-AB cameo topping a rate board. Buying the room means a wider cap
(`HOME_WIDE_W` 900 -> 1050 gives 157px per column) and even that only reaches two.

**The bracket's right half was blank for 365px, about half the card.** The two semifinals stack to
~465px against one 95px championship box, and the 183px title-odds strip sat in a band underneath
the whole thing. The strip moved into that column. **`1fr auto 1fr` is the whole trick and a flex
column with the strip appended is not the same thing**: the connector's elbow points at 50% of the
column, so appending the strip to a centred column rides the championship box up by half the
strip's height and the hairline lands in mid-air. Equal `fr` rows put it back on centre whatever
the strip measures (verified: champ centre 1520.0 against semis centre 1519.5), and an `fr` row
floors at its content, so an oversized strip grows the card rather than overlapping. One copy,
not two behind a `display` switch: on a phone that column is simply the next block, so the strip
lands where it already was. 764px -> 647px.

**The bracket starts folded on a phone, with its answer in the subtitle.** 709px at 57% scroll
depth on a page where 670 of 2,037 browsers fire exactly one event. What collapses is the drawing;
the subtitle carries "Firebells 75% to win it all" while it is shut, and the choice persists.
`noSsr` on the media query, because the alternative is a 709px first paint that snaps closed a
frame later.

**Two real bugs found on the way, both invisible and both about pixels that are not the same
pixel.** The scoreboard's placement subtracted a `getBoundingClientRect` value (visual px) from
`scrollLeft` (layout px), which inside the zoom wrapper undershot the scroll by a factor of 1.4:
the same trap as `--app-header-h`, one axis over, and it is why the strip opened with 51px of the
older game showing against the 32 the code asked for. It divides by `--app-zoom` now. And the
edge fade was a fixed 24px stopping 6px above the bottom, which over a 51px clipped chip left the
score column legible and a bright corner of it floating below the mask. The fade is now measured
against the chip it has to cover (`leadClip`) and runs the full height.

**Where it ended.** Desktop 1,008 -> 1,260 wide, 2,193 -> 2,224 tall with both rows exact. Phone
**2,381 -> 1,871px, 2.93 screens -> 2.30**, having ADDED the form strip and the season comparison.

### Aug 31, 2026: the feed list was truncating, and a whole game fell through it

**A game went missing from the site while the ingest reported perfect health.** Aug 30, NY@SF.
Our first diagnosis was wrong and is worth recording as wrong: the ingest was polling every two
minutes with `ok: true` and zero errors, the copy of the game we could see sat frozen at "Not
Started" from thirty-five minutes before first pitch, and the conclusion drawn was "the league
is not publishing, nothing to fix on our side." **The league published it.** SF 11-9, full line
score, at 02:08Z, to a record we never read.

**`GET /v1/games` caps at 50 rows and does not say so.** It returns a short array beside a
`count` field carrying the real total. The feed held 56; we read 50; the six withheld included
`gstfxmwv1zkcza31`, the only copy of that game the league ever finished. The row count grows at
roughly twice the schedule because of the timezone twins, so the season simply crossed the cap
mid-August and games began falling off the end.

Same failure as the PostgREST 1000-row cap the app already guards with `fetchAllPaged`, and it
fails the same way: no error, just less. Now in `CLAUDE.md` traps.

**The fix passes `?limit=1000` and checks the answer against `count`, erroring on a short
read** rather than continuing. Erroring is the deliberate part: a partial schedule here does not
degrade, it deletes. The phantom-suppression pass reasons about which copies of a matchup exist,
so a missing real copy makes a played game look like an unplayed phantom beside nothing, and
phantoms get their rows removed.

Deployed at 03:24Z; the 03:26 pass went from 25 games to 30, dropped the stale row as a phantom
and ingested the real one in full: 24 batting lines, 6 pitching, 19 fielding, 94 plays, and the
recap engine wrote "Firebells walk off Heights" off the back of it.

**What this says about the stale-feed notice shipped hours earlier (v1.55.0).** It fired on this
game and blamed the league, and the league was not at fault. Its rule is "our clock fresh plus
theirs stale means theirs", and that is sound only while we are polling the RIGHT record. Here
we were faithfully rewriting a row the league had abandoned, so our clock looked healthy by
construction. The notice is still correct for a genuine upstream stall and stays, but it cannot
detect a game we never discovered, and nothing else can either.

**Still open, and now clearly the bigger gap**: `wpbl_ingest_runs` reports on what the ingest
DID, never on what it should have found. A run that silently sees six fewer games than exist is
indistinguishable from a healthy one. Worth a check comparing the feed's `count` against our own
row count per date before the postseason.


### Aug 30, 2026: the page says whose silence it is (v1.55.0)

**A stale-feed notice, written from a live outage.** At 23:30Z the NY@SF game passed first
pitch and nothing moved. Diagnosis: `wpbl_ingest_runs` firing every two minutes, `ok: true`,
`error_count: 0`, last run seconds earlier; the league's own boxscore frozen at
`source_updated_at == fetched_at == 21:54:31Z`, thirty-five minutes BEFORE a first pitch it
never acknowledged, and nothing in the whole 50-game feed updated since. The league's own
website agreed. **Our stack was working perfectly and every reader was being told, by
omission, that it was not.**

`derive/feedHealth.ts` + `FeedDelayNote.tsx`, on Home's next-game card and in Game Center.
Three things to keep:

- **It reads OUR clock before theirs, and that ordering is the feature.** `updated_at` is
  written on every ingest pass whether or not anything changed, so a fresh one proves our cron
  is alive; `source_updated_at` is the league's own stamp. Only "ours fresh, theirs stale"
  licenses pointing upstream. Check theirs first and the notice blames the league every time
  our own cron dies: confidently wrong, aimed at somebody else, and reassuring to the one
  person who could fix it. There is a test named for exactly that.
- **First pitch is the gate and it is not optional.** A game three days out has a month-old
  `source_updated_at` by construction, because nothing has touched the row since the schedule
  was published. Without the gate every future game on the calendar reports a broken feed.
- **It names the source and the timestamp rather than making a claim.** "No update from the
  WPBL feed since 2:54 PM, 2h 04m ago" lets a reader work out where the silence is without
  being told how to feel about it, and the second sentence exists to stop them refreshing. When
  it is ours it says "Our data is behind" in the same slot with the same weight: a notice that
  can only ever blame somebody else is a disclaimer, and readers learn to discount it.

Amber, not red, and no warning triangle: the page is working, the data is late, and there is
nothing for the reader to do. It ticks its own 30-second clock, because the entire state is
"nothing is arriving" and nothing else would ever re-render it into view.

21 tests: 14 on the logic in `__tests__/feedHealth.test.ts`, 7 pinning the copy in
`__tests__/feedDelayNote.test.tsx`.

**Still open**: nothing surfaces this league-wide (a feed stalled between games shows nowhere),
and the ingest's own health has no reader-facing surface at all. Worth settling before the
postseason, when a stalled feed costs more than a regular-season Sunday.

### Aug 30, 2026: Home gets shorter, and the standings table comes off it (v1.56.0)

Measured first, on a 375px phone. Home was **2,423px, three full screens**: Road to the title
709 (29%), MVP race 341, Last Game 257, Leaders 241, Next game 239, Standings 224, scoreboard
113, league card 96, Discord 76.

**The standings table is removed rather than moved.** It is a whole tab, two taps away in a nav
that is on screen the entire time, and Home was redrawing it in miniature underneath: 224px
spent on the one card every reader already knows where to find. `StandingsCard` is deleted;
`computeStandings` is still called in Home for the bracket, so the postseason card is unchanged.

**The MVP race takes the quadrant.** On desktop it pairs with Next game across the subgrid and
with Leaders down the column, which is the column headed "the season's numbers" and the same
kind of claim about the same season. On mobile it moves from fifth on the page to third.

**A CARD IN THAT GRID PAYS FOR ITS HEIGHT TWICE, which is the thing to know before adding
another one.** The two columns share row boundaries through subgrid, so the taller card in a row
sets the row and its neighbour is stretched to match. Dropped in at its full-width height of
341px, the MVP race made row 1 341 against row 2's 256 and left Next game (214 natural) holding
**127px of dead space**. It is not a bug in either card and no amount of `fill` fixes it: `fill`
only decides where slack lands inside a card, and the card that sets the row gets none. The fix
was to make the tall card shorter, at 338px wide, which is what it is actually drawn at in there
and not the width it was designed against:

- the subtitle to one line ("Runs added at the plate and on the mound"), since "Full board" eats
  about 55px of the header and leaves it ~243
- the summary to one line, dropping "in the season", which carried nothing
- the provenance line dropped outright: the run-value explainer is one card on one board now
  (v1.54.0) and this card's own header links to it
- portraits 38/32 to 32/28 and the row padding in

**341px to 279px, against a 256px row 2**, and then the pairing itself was wrong. The MVP race
sat in row 1 beside Next game, which is the SHORTEST card in the grid (214 natural), so it still
set the row and still left ~65px of visible dead air in the middle of Next game.

**Sorting the pairs by height fixes it with no squeezing at all.** Leaders moved up to row 1 and
the MVP race down to row 2, and `LEADER_ROWS` went back to **3**: it had been raised to 5 only
because Leaders used to sit beside Last Game and came up ~90px short, a premise that the move
deletes. Measured after: **row 1 = 224/224 (Next game, Leaders), row 2 = 279/279 (Last Game, MVP
race)** at 1280. Both rows match to the pixel. The `LeaderStatSkeleton` turns out to have drawn a
hero plus two rows all along, so at three it now reserves exactly the loaded height instead of
under-reserving it.

**The cost, and it is real**: mobile is one column in DOM order, so the MVP race moves from third
on the page to fourth, behind Leaders. Fixing that would need `order` at one breakpoint, and the
layout note in `Home.tsx` rejects that explicitly (a second numbering scheme to keep in step with
DOM order by hand, which is what removing `order` from this grid was worth). Not worth reopening
for one slot.

**Two trims on the next-game card, both mobile-first.** The countdown was a headline row under
the team names and is now in the card's subtitle beside the start time: "Today · 4:30 PM ·
15h 32m" is one fact in three parts, and the note previously defending that row was arguing
against the header's top-right CHIP slot, which is not where it went. `SectionCard.subtitle` is a
`ReactNode` for it. The reminder row had a title over a hint in every state, and in the ordinary
ones the hint restated the switch beside it. One line now; the second appears only for something
a switch cannot say (blocked, unsupported, unconfigured, signed out).

**Result: 2,423px to 2,087px, 2.98 screens to 2.57**, with nothing hidden behind a tap.

**Still the biggest thing on the page: Road to the title at 709px**, untouched here. Collapsing
it on mobile, compacting its series boxes, or moving it to Standings beside the seeding race are
all still open, and it is worth settling before Sep 9 turns it from a projection into a record.


### Aug 30, 2026: the MVP race, and one number a hitter and a pitcher can share (v1.54.0)

**Also this release: run value explains itself in one place.** The explanation was in two
halves on two boards and neither was whole. Run value carried the 24-situation grid and a
paragraph of fine print; Findings carried the leadoff anchor, one play worked through in a
ledger, and the formula in words. Neither mentioned the other, so a reader who wanted to know
where a number came from got the table without the arithmetic on one tab and the arithmetic
without the table on the other. It is one idea and it is now one shut card on Run value, in the
order the idea is built: **(1)** every situation is already worth something, with the grid as
its evidence rather than as a spreadsheet with a caption, **(2)** a play is worth what it
changed, with the formula set as three named terms, **(3)** one real play, with those same
three terms as a ledger. The term labels are one constant (`TERMS`) read by both the formula
and the ledger, because they were two hand-written copies and had already drifted: matching
them is the entire lesson. Findings keeps its sixteen measurements and links across, and the
link opens the card rather than dropping the reader on a leaderboard with the answer folded
away.

**The worked example did not add up, and now does.** Its three terms print to a hundredth and
the total was rounded from full precision, so +1.00, +1.18 and −1.63 sat under a total reading
+0.56. Both numbers were right and the reader had no way to know that, which on the one card
whose job is being checkable is the worst possible place for it. The total is now the sum of
the rounded terms. Every board still shows `fmtRunValue(v.value, 2)`; only this ledger trades
the last digit for adding up.

A Home card drawing the top two by **runs added: runs created at the plate plus runs saved on
the mound**, both off `playRunValues` and so off the league's own run-expectancy table.
`derive/mvpRace.ts` (pure) plus `MvpRace.tsx`, 18 tests in `__tests__/mvpRace.test.ts`.

**The metric was the whole decision, and the cheap version was rejected on purpose.** Home
already holds every box-score line, so a run estimator built from those would have needed no
new fetch at all. It was prototyped: a Base Runs fit, calibrated so the model's league total
matches the 365 runs actually scored, which is the honest way to derive linear weights for a
run environment nobody else's table covers. It lands close but not on top of the truth. Against
the league's own play-derived weights it prices a home run at **+1.33 against +1.55**, a single
at +0.46 against +0.54, a walk at +0.27 against +0.34; the double is nearly exact at +0.84
against +0.82. Shipping it would have put **two "runs added" figures for the same player on the
same site**, ten to twenty percent apart, with neither of them wrong: the exact failure the ERA
basis note in `stats.ts` exists to prevent, one board disagreeing with the page it opens. So
the card pays for the play log instead and reads the number the Run value board already
publishes. Verified against production: the board's hitting rows and the card's `bat` figures
agree to the digit.

**It brings play-by-play back to Home, which is the cost and it is deliberate.** That read came
off when the Hall of Firsts did, and it was the most expensive one on the section. It returns
as a SEPARATE effect that blocks nothing: 2,265 rows, ~80KB gzipped, on the same session-cached
fetcher the Run value tab uses, so a reader who opens both pays once. Home's first paint is
untouched and the card simply is not there until its data is. It carries `wpbl_mvp_shown` and
`wpbl_mvp_player` precisely so the trade is answerable later, since the last thing measured on
Home was a card being seen and not used and the card that told us so has been retired.

**What it found.** Kelsie Whitmore is **second** in runs created (+18.4 to Denae Benites'
+18.6) and has saved +4.4 more on the mound, so on the combined number she leads +22.8 to
+18.6. Every leaderboard on the section reads one side of the ball and undercounts her; this is
the first surface that reads both, and it is the argument for the metric rather than a
by-product of it. The race also has a real shape: Benites led from Aug 1 to Aug 27 and Whitmore
passed her on Aug 28, one lead change with six games left.

**What it is not, and the card says so.** No replacement level, no positional adjustment, no
fielding: this is not WAR and must never be labelled as such. Baserunning is out too, and not
by choice, since a steal is a play row with no pitch sequence and so belongs to no plate
appearance and is credited to nobody. In a league running as much as this one that is a real
omission rather than a rounding one, and the natural next piece of work.

**Still open**: it is regular-season only (both engine functions run their input through
`regularSeasonLines`, so the postseason cannot leak in), which means from Sep 9 the card
freezes on the final regular-season standing. Whether it should then become "the 2026 MVP" and
move into the archive (#2), or start a second postseason race, is undecided and wants deciding
before Sep 9.

### Aug 29, 2026: showing the working, and eleven countries that fold (v1.53.0)

Two surfaces that were correct and unreadable, plus the one line that tells a reader a setting
is theirs to undo.

**"How this is worked out", on the play-value card.** The card prices sixteen kinds of play in
runs and said nothing about where any of it came from, which is the shape a number has to be in
before somebody decides the site is guessing. It now carries a disclosure at its foot with a
real play worked through: the inning, the feed's own sentence for it, and the three terms as a
ledger with both situations named in words. `workedExample()` picks it, and the picking is the
part that matters: it takes the play NEAREST ITS OWN EVENT'S AVERAGE, so the sum lands within a
hundredth of the row above it and a reader can see the single play and the season number are
the same thing. A grand slam is the better story and the worse lesson. It also requires a play
that scored, so all three terms are non-zero and the arithmetic on screen is the whole formula
rather than a two-term version of it.

Everything in it is computed. A hand-picked play with its numbers pasted into the copy is a lie
waiting to happen: the expectancy table shifts with every game ingested, so a written-down 1.15
quietly stops matching the table the rest of the card is drawn from, and nothing anywhere would
report it. Five tests in `__tests__/runExpectancy.test.ts` pin the picker (typical over biggest,
no scoreless play, no steal, same play for every reader on a tie, null before the season has
one). `PlayRunValue` gained `afterBases` / `afterOuts` for it, so a surface can NAME the state
it prices instead of only showing its number.

**The bars on that card now take the whole row, which is also a phone measurement.** Beside a
reserved 88px number column the track was 213px of a 309px card, and a bar drawn from the
centre spends half of whatever it is given, so the entire chart lived in 106px on a 375px
screen: fifteen plays a few pixels apart, which is a decoration rather than a reading. The
number moved up beside the label and the bar took the row: 309px of track and 154px of swing on
a phone, 654px on the desktop card. No zero line, and one was tried: every bar starts at the
centre, so the shared edge running down all fifteen rows already is the axis, and a tick drawn
over it either cuts the fill or paints in the card's own colour and vanishes.

**A disclosure rather than a tooltip, and that is about the phone.** The obvious build is an
info glyph on the heading. `TapTip`'s touch path closes itself after four seconds, which puts a
reading deadline on the only explanation the card offers, and this is four sentences and a
ledger rather than the definition of a word.

**No other league in it.** [`RunValueView.tsx`](src/wpbl/RunValueView.tsx) settled the same
question in the same words ("say where they come from, not what they are unlike") and the card's
own lead sentence has stopped comparing too. A fan of this league can do nothing with a
comparison to the majors, and it invites the section to be read as a measurement of another
league rather than a record of this one.

**The eleven countries on /wpbl/league fold, and they open by default.** Collapsed-by-default
was the obvious call and it is wrong twice over: the roster IS the page, and six of the eleven
countries hold four players or fewer, so folding them saves a reader nothing and costs a tap.
What is actually long is the USA at 64, and a per-country toggle plus "Collapse all" hands that
reader the short version in one press (5,500px to 1,929px).

**A closed country is hidden, never unmounted, and that is load-bearing.** This page is 118
player anchors and the crawl path they make is the reason it exists; returning `null` for a
closed country deletes them from the document a crawler reads while looking identical to
anybody who opened the page. `display: none` keeps them. The fold state holds the CLOSED set
rather than the open one, so a twelfth country arriving in a trade renders open like the rest
instead of being silently hidden. `__tests__/leaguePage.test.tsx` pins both.

**The ERA note now says the choice is reversible.** The per-7 half of the notice above the
pitching board is the branch a reader only reaches by having changed something, and the notice
is dismissible and retires on the badge store's expiry. A reader who switched and then lost the
line was left on numbers that disagree with the league's own site, with nothing on screen saying
where that came from or how to undo it. It names Settings now.

### Aug 27, 2026: the rate qualifier counts trips to the plate, not at-bats

The bar for a batting rate title was `AB >= 2.0 x team games`. AB is the wrong unit and had
been all season: it throws away every walk, so gating OPS on it charges a patient hitter for
the half of the stat that is OBP. Two hitters twenty games in, one with 38 AB and 20 BB and
one with 45 AB and none: the first has played more, and the old bar qualified only the second.
The pitching side never had this problem, because outs are outs.

So the bar is plate appearances now, and the number is MLB's rather than one of ours:
3.1 PA per team game scaled to a seven-inning game, `3.1 x 7/9 = 2.4`, with a floor of 6.
That is the same rule the pitching bar already used (`1.0 IP x 7/9`, the 0.8 IP behind
`QUALIFY_OUTS_PER_GAME`), so the two sides finally come from one place. The check on 2.4 is
that it is the same share of full-time play MLB's is: a team gets roughly 30 PA in seven
innings, a lineup slot is worth about 3.3 a game, and 2.4 is 73% of that, which is what 3.1
is of a nine-inning slot's 4.2.

It is a redistribution rather than a loosening. For a hitter walking at the league rate the
line moves up about 6% in AB terms; for a high-walk hitter it moves down, and for someone who
never walks it moves up hard. That is the correction, not a side effect.

**PA has one definition now, and it includes sac bunts.** Three call sites had each derived
their own `ab + bb + hbp + sf`, copied from OBP's denominator, and all three had therefore
dropped `sh`, which the feed does report and OBP excludes on purpose. `plateAppearances()` in
[`stats.ts`](src/wpbl/stats.ts) is the one copy, `sh` rides on the batting totals to feed it,
and the Stats PA column, the K% percentile and both qualifier checks read it. The column was
under-reporting bunters by a trip or two a season; the K% denominator was too, which read as
a shade high a strikeout rate on exactly the players least likely to have one.

The two `2.4`s in the constants are a coincidence of units, one PA and one OUTS, and there is
a comment saying so: folding them into a single constant would make the next change to either
silently move both. `__tests__/qualifiers.test.ts` pins the bar, the floor, the min-games
gate, both sacrifice cases and the walker the old bar excluded.

### Aug 27, 2026: /wpbl/league, and the map that is not a map (v1.52.1)

The fourth noun gets its page. Everything in the section is a game, a club or a player, so the
league as a subject had nowhere to be: the media shelf ended up on Home and the primer, the
glossary, the archive and this had nowhere at all.

**First tenant: where the 118 players are from.** `hometown` is filled in on every one of them,
which makes it the most complete column the feed publishes and the only one that still says
something in February. Sixty-four from the USA, 18 from Canada, 9 each from Mexico, Australia
and Japan, 4 from South Korea, and one each from Venezuela, the UK, France, Puerto Rico and
Curacao. Youngest 18, oldest 40, median 24.

**It is not a map, and that is a decision.** There are no coordinates anywhere in the payload
and no honest way to invent them: "Ontario, California, USA" and "Oakville, Ontario, Canada"
share a word and are 2,000 miles apart, so any lookup keyed on this string eventually puts a
player in the wrong hemisphere on a picture that looks authoritative. A ranked list of countries
carries the same fact, reads on a phone, and is text a crawler can index, which a projected SVG
is not. If real coordinates ever arrive, the derive layer is already the right shape for it.

**118 anchors is the other half of the point.** Same argument as
[`PlayersIndex.tsx`](src/wpbl/PlayersIndex.tsx): a player page is reached in-app through a tab
and a modal, which is no link at all to a crawler. This is a second flat page of real `<a>`
elements pointing at every player, and its h2/h3 structure gives each country a heading of its
own.

**No nav pill, per the decision above.** Footer link only, which is the door Google actually
used for `/privacy` and `/terms`. Spelled in all five places a non-tab route has to be:
`routes.ts`, `_redirects` (200 and the trailing-slash 301), `seo.ts`, `build-sitemap.ts`, and
the footer, with a `routes.test.ts` block pinning every one of them, since the tab loops that
keep the others honest skip it by design. Verified against the real thing rather than the dev
server: `npx wrangler pages dev dist` answers 200 for `/wpbl/league`, 301 for the trailing
slash, and **404 for `/wpbl/leagues`**, which is the soft-404 hole staying shut.

**Second tenant, the same day: the media shelf moved here off Home.** Reading, Highlights and
the archive are about the league rather than about today's games, none of them needs a live
feed, and on Home they were the bottom three screens of the page: **575 browsers saw the shelf
and 39 clicked it.** They sit above the roster here, because 118 rows is a wall and anything
under it is unreachable in practice.

What Home keeps is **one line**, and it carries its own impression event
(`wpbl_league_card_shown` / `wpbl_league_card_open`). That is not boilerplate: the Discord card
was retired on Aug 19 and took its own impression with it, so the 554 browsers whose only event
was that card became unmeasurable the same day. This move is a bet and the events are how it
gets read. **If the card is shown as often as the shelf was and opened less, the move was wrong
and the shelf comes back**, rather than the link being made louder.

It also does the thing the traffic actually asked for. 670 of 2,037 browsers fired exactly one
event on Home; a page in that state needs to get shorter before it gets anything else, and every
previous idea for Home has added to it.

Next tenants, in order: the primer and glossary (#4), then the archive (#2), then this-day.

### Aug 27, 2026: a Findings board, and the steal that does not pay (v1.52.1)

The section had no answer to a question anyone watching this league asks by the third inning:
they run constantly, is it working? A stolen-base percentage cannot answer it. 82% sounds like
a lot and says nothing about whether the attempt was a good idea, because that depends on what
a base is worth against what an out costs, and this league's run environment is not the one
those instincts were built in.

Priced on the league's own run-expectancy table: a steal is worth **+0.12 runs**, a caught
stealing **-0.76**, so the break-even success rate here is **86%**, against roughly 72% in the
majors. Outs are dear when a half-inning is worth 1.08 runs. The league runs at 82%, so the
season's running game is **-2.4 runs**: +7.4 from 60 steals, -9.9 from 13 caught.

That is the first thing on the section that is genuinely an *analysis* rather than a
presentation of the feed, and it is only computable because the run-value table exists, which
is the argument for having built it. The card carries no jargon at all (no "run expectancy",
no "linear weights", no "break-even rate" as a phrase), states the two prices in runs, and
draws the two rates against each other so the shortfall is visible before the words are read.
Hitting side only: the catcher's half of the same story wants the fielding lines and a
different sentence.

**AND IT IS A BOARD, NOT A CARD ON ANOTHER BOARD.** It shipped inside Run value and moved out
within the hour, because the Stats row had started carrying two different kinds of thing.
Players, Teams, Pitch by pitch, Run value and Tracked are one axis, *how do you want the numbers
cut*: they sort, they filter, and they mean nothing the day the feed stops. A finding is the
other kind: one question, one answer, read once, still true in February. Giving each finding its
own chip is what would break that row, on a phone first, so there is **one chip for all of them
and it never grows again**. Six chips is the width the row already reached whenever Tracked
showed.

**The steal card went out behind the experiments switch, and the play-value card went to
everyone.** That split is most of the argument for a container rather than a chip per finding:
one is a table of measurements a reader can check against a game they watched, the other is a
verdict about how the league plays drawn from 73 attempts, 13 of them caught, and only one of
those needs to sit for a while. Neither decision moved anything in the row above. Play values
lead the board for the same reason: the prices should be seen before the argument built on them.

Three rules for anything that lands there, all three from the traffic rather than from taste:
**name players and make them tappable** (return rate runs 7.8% / 35.7% / 76.5% by whether a
browser opened a player page and Game Center on day one, so a card that states a fact and names
nobody is doing half its job); **no jargon, ever**; and **not on Home** (the reading rail was
seen by 575 browsers and clicked by 39, and Home needs to get shorter rather than longer).

Second card in with it: **what every kind of play is worth**, the league's own linear weights,
home run +1.55 down to caught stealing -0.76, with the two surprises stated in a sentence that
is assembled from the rows rather than written into the copy, since both are facts about a
season still being played. A strikeout costs 0.09 of a run more than a groundout. The sacrifice,
14 of them, has been worth 0.0 runs all season.

`stealEconomy()` and `topRunners()` are in
[`derive/runExpectancy.ts`](src/wpbl/derive/runExpectancy.ts). The runner list comes from the
box scores' `sb`/`cs` rather than the play log, so a player's number here matches the Players
board exactly, and the play log's own attempt count (a double steal is one row and one price)
never appears next to it.

### Aug 27, 2026: Run value comes out from behind the flag (v1.52.0)

The board [shipped Aug 22](#aug-22-2026-what-every-play-was-worth) behind the
experimental-features switch while its numbers settled. They have. Five days of the table
holding steady against the season's own plays, and the one thing the flag was actually
protecting against is not something a flag fixes: every figure on it is "runs" in a sense
nobody uses at the ballpark, and a reader who takes +19.0 for runs scored has been misled by
us. That is a job for the sentence above the table, which is there, rather than for a switch
almost nobody flips. Same reasoning that brought the [postseason
bracket](#aug-24-2026-the-postseason-gets-odds-not-another-standings-table) out.

So the `useExperiments()` gate in `StatsView` is gone and the board is the fifth tab in the
row for everyone, which is also what the row's comment has claimed for a while. The
`ExperimentalChip` on the board goes with it.

**The "new here" dot moved with it, and there is still only one.** It was on Pitch by pitch
(`pitches-v147`, shipped Aug 21); it is on Run value now (`runs-v152`). Both dots draw twice,
on the Stats pill and on the chip inside the tab, and both retire on reaching the BOARD rather
than the tab, so keeping both would have put two dots on the same pill saying the same thing.
The old registration in [`lib/seen.ts`](src/lib/seen.ts) went with its call site, per the rule
in that file, so nothing is left behind that could light it up again. Expiry is Sep 22 with
the postseason: a dot advertising a stats board is stale the moment the feed stops producing
stats for it.

The impression/click events (`NEW_BADGE_SHOWN` / `NEW_BADGE_CLICKED`) carry the badge key, so
the pitches numbers stay comparable rather than being overwritten by the new one.

**And the table it prices everything off was 4% high, which the flag would never have caught.**
Asked whether the blanket "drop every game's last half-inning" rule could be sharper, the
answer turned out to be that the rule was not merely conservative, it was biased. Whether a
half-inning ends a game is not independent of the runs scored in it: a top of the 7th ends the
game only if the side batting failed to catch up, and a bottom of the 7th is followed by
another inning only if the game was still level after it. So the old sample kept the top 7ths
that scored (0.75 runs against 0.38 for the ones it dropped) and, for bottom 7ths, kept exactly
two half-innings from the whole season, both scoreless by construction, to represent every
bottom of the 7th played.

The fix is not a cleverer condition, it is to stop conditioning: measure every half-inning
whose runs are all present, last or not. "All present" is a reconciliation rather than a guess,
totalling the log's runs per side and comparing them with the published score, which is what
separates the game that ends in the bottom of the 6th on a fly ball with nobody out (missing
rows, no missing runs, perfectly measurable) from the two games whose logs are a run short of
their own box score. A walk-off is still excluded, stated as "the home side was beaten" so a
game called early with the home side up falls out for the same reason.

**And the same check found rows the table should never have been measuring.** Reconciling every
log against its box score turned up two games that do not add up, and RetroWPBL's independent
transcription said exactly what each was missing.

**Aug 15, LA at Boston** was a run short because the 3rd-inning row read "Lexi Hastings stole
second; Beth Greenwood stole home" with `runs_scored = 0`. Before a correction could be written
the league re-scored it as "scored on a fielding error" with the run on it, the mirror picked
that up on its next pass, and the game reconciled by itself. The correction that was about to be
written would have been laid over the new reading and made it a two-run play. That is now the
standing warning in [`docs/PLAY_VALIDATION.md`](docs/PLAY_VALIDATION.md) §9: re-read the row
immediately before correcting it, and prefer waiting a day on anything the league might re-score.

**Aug 20, New York at Boston** is the real damage: from the middle of the 5th the feed's rows go
blank, no batter, no event, no narrative, outs frozen at 0, fourteen of them. Read as plate
appearances they were fourteen observations of "nobody on, nobody out, no runs followed" in the
cell the whole board leans on. A row that names no batter is no longer a plate appearance, which
disposes of those.

The missing RUN is a different question, and the answer is the line score, which the feed
publishes per inning per side and which nothing here had used. **The reconciliation is per
half-inning now, not per game:** a half-inning short of its own line-score cell is out, a side
short by runs no inning will own up to takes that side of that game with it, and everything else
in a damaged game stays. Across the whole season that excludes exactly one half-inning, the top
of the 7th on Aug 20. An earlier draft dropped both games entirely and cost 119 honest plate
appearances to place two runs.

265 measured half-innings became 283 and 1,407 plate appearances became 1,467. Bases loaded and
nobody out went from 3.20 to 3.00, the league's runs per half-inning from 1.13 to 1.08, and every
player's season total moved with them. None of it is baked into a build: the reconciliation runs
in the browser over corrected plays, so a re-ingest or a correction puts a half-inning back with
no code change, which is exactly what Aug 15 did while this was being written.

### Aug 26, 2026: every page says what it is, and the recaps point at one (v1.51.1)

The two loose ends the [linking audit](#aug-26-2026-the-section-stops-being-a-place-with-no-links-in-it-v1510)
left, both of them the same shape: a page that exists and does not identify itself.

**No page drawn as a modal had a heading of its own.** A player page, a team page and now a
game page are real pages with their own URL, title, canonical and sitemap entry, drawn over
whichever tab they were opened from. The tab underneath kept rendering its `<h1>`, and the
modal rendered none, so **139 of the sitemap's 168 URLs** answered "what is this page about"
with "Women's Pro Baseball League", and the player's own name was not a heading of any level.
That is the first thing a screen reader announces on arrival and near the top of what a
crawler reads.

The fix is **not a second `<h1>`**. It is that the tab stops claiming to be the page when it
is not: [`PageHeading.tsx`](src/wpbl/PageHeading.tsx) holds one flag, the five tab titles
render as a plain `div` while a modal owns the page (keeping every pixel of their styling),
and the modal supplies the one heading. Verified at every step of tab → team → player and
back: exactly one `h1`, always naming the page you are on.

Game Center's is **deliberately not drawn**. It shows no written headline on purpose, because
the line score sits at the top of the sheet with the winner in bold and "Hunters beat Queens"
above it would spend 87px of a phone restating it (the reasoning is in
[`RecapCard.tsx`](src/wpbl/RecapCard.tsx), next to the omission). That is right for the design
and left the page with no heading at all, so it gets a clipped one matching its `<title>` word
for word. Clipped rather than `display: none`, which would take it back out of the
accessibility tree and undo the point of it.

**The recap posters were still on the old URL.** Bluesky and Discord both posted
`/wpbl?game=<uuid>`, which since the morning only reaches the game through a 301. The Bluesky
half is the one that matters: those posts are public and crawlable, so each finished game is
an inbound link to a distinct page, and inbound links are the one input
[§3](#3-seo-follow-through-️-the-code-half-is-done-links-are-the-brake) says cannot be
shipped. Spent on a redirect they are worth less than they cost to make.

`buildRecapMessage` and `buildBlueskyPost` now take the URL as a **required** argument rather
than building it. Built there it could only ever be the uuid form, since the canonical slug
needs the whole schedule to know it is unambiguous and a wording function has no business
holding a schedule. Required rather than optional because a caller that forgot it would go on
posting a URL that still resolves, and so would never look broken.

**One trap this walked into, now pinned.** `routes.ts` entered the Deno import graph for the
first time (the ingest's announce step builds the game's URL), carrying an extensionless
`import { slugifyName } from './slug'`. Deno resolves a local specifier literally, so that is
a file that does not exist, and it would have failed at import time in a job nobody watches
while Vite, esbuild and `npm run test` all stayed green. Deno is not a dev dependency, so
there is no local reproduction either.
[`__tests__/denoGraph.test.ts`](src/wpbl/__tests__/denoGraph.test.ts) now walks the graph from
the ingest entry and fails on any extensionless runtime import, which is the check that rule
in `CLAUDE.md` never had.

### Aug 26, 2026: the section stops being a place with no links in it (v1.51.0)

Found by auditing the live site rather than by reading the roadmap, which is the only reason
it was found at all: nothing about it is visible in a browser.

**Not one page on the section linked to a player page.** Zero `a[href^="/wpbl/players/"]` on
Home, on Stats, on Schedule. Every player name was a `<div>` with an `onClick`, which fails in
three directions at once and none of them show up when you use the site yourself. Googlebot
does not fire click handlers, so 118 player URLs sat in the sitemap with nothing pointing at
them. A `<div>` is not focusable, so the Stats board had 33 player rows and 15 tab stops, all
of them site chrome. And no href means no open-in-new-tab, no middle click, no copy link.

This is the failure `CLAUDE.md` already carries a rule about, from the time `/mlb` went
undiscovered by Google for months while `/privacy` and `/terms`, which the footer links
properly, were found. The rule was written and then not applied to the section that is the
site. `linkTo()` in [`App.tsx`](src/App.tsx) had never once been used inside `src/wpbl/`.

**And the one page that did it right was an orphan.** `/wpbl/players` carries a real anchor to
all 118, and its own `h1`, and is in the sitemap. Nothing linked to *it* either: no Players
tab in the nav, no footer entry. Home's 28 anchors were site chrome, the five tabs, and
**thirteen outbound links to a Substack**. The section linked out to somebody else's blog
thirteen times from its front page and to its own 119 player pages zero times.

**Games had no URL at all.** Game Center was deep-linkable as `?game=<uuid>` from the start,
which is not the same thing as being a page: [`seo.ts`](src/seo.ts) canonicalises a query back
to the tab underneath on purpose, so a hundred shared game links do not read as a hundred
near-duplicates of Schedule. The consequence was that every recap the section has ever
rendered was, by design, unindexable, and the schedule cards were bare `onClick` divs because
there was no href to give them. That is 41 pages a season, each with a unique title and a
final score, on a section whose stated remaining constraint is inbound links, and it is the
part of the [inaugural-season archive](#2-the-inaugural-season-archive-) that survives Sep 22.

**What shipped.** [`LinkContext.tsx`](src/wpbl/LinkContext.tsx), one provider, two hooks:
`playerLink(player, onOpen)` and `gameLink(game, onOpen)`, each returning the props that turn
any Box into a real anchor. Applied to Home's leaders, the Stats table and its mobile list,
team rosters and leader lists, the box score, play-by-play, the shared `LeaderRow` behind the
Pitches and Run value boards, every schedule card, the scoreboard chips, Next game, Last game
and Full recap. Plus a `WPBL players` link in the footer, which is the door that worked last
time.

Games got the player-page treatment in full: `/wpbl/games/2026-08-23-queens-at-hunters`, a
real 404 at the edge for a slug naming no game, per-game `og:` tags, a 301 from the old
`?game=<uuid>`, and one sitemap entry per game that has been PLAYED.

Four things here are worth not undoing:

- **The link helper is a CONTEXT, not a prop.** Both slug rules need the whole list to judge
  whether one is ambiguous. A team page linking with its own 30-name roster would happily mint
  a bare slug for a name a player on another club also holds, which is the silent wrong-player
  URL the slug rules exist to prevent. One provider holding the one roster and the one
  schedule is what keeps that impossible.
- **It stops propagation before the modifier check.** Several of these anchors sit inside a row
  that also opens the same thing. Without it a plain click pushes two history entries, the
  second a dead Back, and a cmd-click opens a new tab AND the modal in the tab you were reading.
- **A player opened from a game keeps the PLAYER's path**, with the game left on the query.
  The edge's `?game=` redirect is deliberately the last thing in the handler for that reason:
  run it earlier and `/wpbl/players/<slug>?game=<uuid>` bounces to the game, throwing away the
  page somebody shared.
- **Before the data lands, the element stays a plain onClick** rather than shipping an href
  that might name the wrong subject. A crawler waits for the render; a reader clicking that
  fast still gets the modal.

**Still open from the same audit**, in rough order: player and team pages have no `h1` of
their own (a player page currently renders Home's, "Women's Pro Baseball League", and the
player's name is not a heading at all, on 119 of the sitemap's 148 URLs); same-day games
reorder between loads because [`api.ts`](src/wpbl/api.ts) sorts the schedule by `game_date`
alone and `start_time` is right there; and the notification badge leaves a bare "0" in the
accessibility tree.

### Aug 26, 2026: ERA per 9, because the league says so (v1.50.0)

A WPBL game is seven innings and this site divided ERA by seven, which is defensible and,
until now, wrong for the only reason that matters.

**What the sources actually say.** Every other seven-inning competition scales to its own game
length: NCAA softball (checked against the ACC's own 2026 cumulative stats, Florida State 159
ER in 400.1 IP printed as 2.78, which is only per 7), Athletes Unlimited, and, decisively for
the "but this is baseball" objection, seven-inning **high school baseball** on MaxPreps (3 ER
in 1.0 IP printed as 21.00). Little League scales to 6. The two exceptions are MLB, which kept
per 9 through its 2020 and 2021 seven-inning doubleheaders, and **the WPBL itself**, which
publishes per 9 (Albayati, 2 ER in 10.0 IP, printed 1.80). So the honest denominator is 7 and
the published one is 9.

**We follow the league.** Not because it is more correct, but because the alternative is
losing the argument in public: every WPBL number a fan meets anywhere else is per 9, so 2.58
here against an official 3.32 makes us the source that looks broken rather than the source
that is right. There is a second reason worth keeping: scaling to 7 is the *softball*
convention, and the league publishes per 9 precisely because it is positioning itself on
baseball's scale. Adopting per 7 quietly files a pro baseball league under the wrong
scoreboard.

**The setting exists because per 7 is still the better stat.** Settings → App → WPBL ERA
basis. It reaches the Stats board, team pages, player pages, the percentile strip and the game
comparison card, and renames the strikeout column K/7 or K/9 with it.

Three things hold this together and are worth not undoing:

- **The stored number is per 9, always** (`ERA_BASIS_CANONICAL` in
  [`stats.ts`](src/wpbl/stats.ts)). Rescaling happens at DISPLAY time via `scaleToBasis`. The
  moment two aggregates each carry their own basis, a leaderboard and the player page it opens
  can disagree and neither is wrong.
- **Nothing that leaves the site asks.** OG share cards and the Discord `/player` card read the
  stored value and have no parameter to opt in. Their reader never chose anything and is
  holding the league's number.
- **Rescaling can never move an order.** Both stats are linear in the basis, so every pitcher
  scales by the same factor. `__tests__/eraBasis.test.ts` pins that: same ranks, same
  percentiles, only the printed figure moves, and WHIP and K/BB (no denominator to rescale)
  do not move at all.

The one-line notice above the pitching board is deliberately **not** a dialog. The change is
worth telling a returning reader about, since their ace's ERA moved by a third overnight, but
a modal on tab-open makes everyone dismiss something before reaching the board, including the
majority who never saw the old number. It carries the setting itself rather than a link to
Settings, expires with the feed via [`lib/seen.ts`](src/lib/seen.ts), and a reader who picks
per 7 gets "ERA per 7" in the board's footer permanently, since from then on their number
disagrees with the league's.


### Aug 25, 2026: the player page stops being a data dump

Measured on a 375px phone before touching anything, because the complaint was about mobile and
the page had never been measured there. The sheet scrolled 1287px against 654px of visible
height, and three rows clipped horizontally with no scrollbar, no fade and nothing to say they
scrolled: the batting counting-stat line was 408px of content in a 307px box, so **SB and TB
were invisible on a phone**, cut mid-row. Silent data loss is the worst shape a layout bug can
take, because nobody reports it. That is fixed by construction rather than by a scroll hint:
the counting stats are a wrapping grid now, and a grid cannot clip. The game logs got
responsive cell padding, which drops a thirteen-column hitting log from 401px to inside a
375px screen with room over.

**The roles are tabs.** Four stat blocks stacked down one scroll gave a two-way player two
hero cards, two game logs and two sets of table chrome for the same nine games, and gave all
four blocks the same visual weight, so a fielding percentage over nine games sat as tall as a
.400 average. Batting and Pitching are a `SegNav` now, the same control Game Center uses, with
only the active role mounted. The control appears **only** for a genuine two-way player: a
cameo still folds into the primary pane as a one-line summary, so an occasional-hitting pitcher
and a real two-way player do not end up in the same shape. Fielding is a collapsed line that
opens on tap. Jill Albayati's page went from 1287px to 953px while *gaining* the strip below.
The two roles also **page under a finger**, the same `SwipeableViews` in `mode="pane"` that
Game Center's tabs use: two panes is exactly where a swipe earns its keep, since the pill bar
is a 40px target at the top of a sheet and the thing a reader wants next is the other half of
the same player. That is what pinned the identity band, which the pager needed a definite
height beside, and pinning it turned out to pay for itself twice: whose numbers these are stays
on screen at any scroll depth, and the sheet's grab surface stops scrolling out of reach.

**And the sheet could not be pushed back down, which the restructure caused.** The page grew
past the height of the sheet (1069px of content in a 654px pane on a 375px phone), so its body
became a real scroller where it used to fit, and a scroller owns a touch before the drag
handler can: the gesture decided at 10px, which is past the platform's ~8px slop, so
`preventDefault` was a no-op and `touchcancel` ended the drag. It worked perfectly against
synthetic touch events the whole time. `useSheetDrag` now splits the CLAIM from the COMMIT:
at 4px it takes the touch off the browser if the gesture could be a dismissal (downward,
vertical, over a scroller already at its top, where there is nothing to scroll anyway), and
still decides at 10px whether to drag or hand it back. A card can also mark a block
`data-sheet-drag` to make it a grab surface with the chrome's `touch-action: none`, which the
identity band does.

**Nothing on the page used to know whether the numbers were good.** A .406 average and a 1.40
ERA sat there uncontextualised on a site that has every box-score line in the league already
cached. Each pane leads with two stats, each carrying its OWN rank on its own line: OPS then
AVG for a hitter, ERA then WHIP for a pitcher. The first cut led with a `.406/.513/.688` slash
line under one floating `6th of 33` pill, which never said which of the three it ranked, gave
hero weight to OBP and SLG while OPS (their sum) sat in the grey line underneath, and printed
games and at-bats twice: once in that line and again as the first two chips of the grid below.
Below the pair, every pane carries a percentile strip, from
a new pure [`percentiles.ts`](src/wpbl/percentiles.ts). Three things in it are load-bearing:

- **Ranked against QUALIFIED players only**, reusing `wpblQualifiers` rather than inventing a
  second definition that could disagree with the Stats tab about who leads the league. Against
  everyone with a line, a pinch-hitter who is 1-for-1 is the best hitter in the WPBL. A player
  below the bar gets no strip and a sentence saying why, because there is no honest percentile
  for nine at-bats and a short bar would claim she is bad rather than that we do not know.
- **Every "lower is better" stat is a RATE.** The first cut ranked raw strikeouts with `low`
  better, and Albayati came back 17th of 33 on four strikeouts: the bar was rewarding not
  playing, since a hitter with 20 at-bats beats one with 40 before either swings. It is K% now.
  HR stays a count, because rewarding playing time is what a counting stat is for.
- **The population is printed under every strip.** "82nd percentile" borrows the authority of a
  Statcast page built on thousands of batted balls; this is a four-club league playing about 40
  games, where one good week moves a bar a long way. The strip says "against the 33 qualified
  batters this season" and the bars are position-only, never coloured good-to-bad.

Two things the first cut got wrong, both caught on a real phone. The rank beside each hero
stat was drawn in the TEAM ACCENT, so "31st of 33" rendered in Boston green read as good news
about a bad number, and a Firebells hitter leading the league would have got her rank in red:
the colour was editorialising, at random, by club. It is neutral now. And the percentile bar
put a tied block at the BOTTOM of its own range rather than the middle, so a hitter with 0 HR
in a league where most of the field also has 0 drew a completely empty bar next to the text
"13th of 33" — the bar said last and the number said mid-pack, about the same player, on the
same row. Ties sit at their midpoint now, which that 0 HR row reads as a 31% bar.

**And the sheet drag was broken on real phones, for a reason no emulator can show you.** The
handler cannot call `preventDefault` on the first touchmove: it waits `DRAG_LOCK_PX` to tell a
dismissal from a scroll, because preventing before the axis is settled would kill scrolling on
every touch that starts near the top. But a real browser decides what a gesture is during those
same first pixels, and once it has handed the touch to the compositor as a scroll or an
overscroll, every later touchmove arrives `cancelable: false` and `preventDefault` is a no-op.
Synthetic touch events are always cancelable, so the drag tested perfectly and did nothing on
the device.

Two declarations remove the race rather than trying to win it. The chrome (handle plus title
bar) is `touch-action: none` on a phone, so the browser never claims a touch that starts there
and the handler still owns it at 10px — safe for the reason `useSheetDrag` already gives for
treating the chrome as always-draggable, and taps are unaffected because touch-action governs
panning, not clicks. The scroll pane is `overscroll-behavior: contain`, so a downward drag at
the top stops chaining out to Android's pull-to-refresh and iOS's rubber-banding, which is the
other half of why dragging the CONTENT did nothing. `SwipeableViews` had `touch-action: pan-y`
for exactly this reason all along; the sheet chrome was the one gesture surface in the section
without a declaration.

**`ModalShell` also lost its second source of truth about being a sheet.** Whether the card
LOOKS like one (bottom-anchored, rounded top corners, grab handle) is a CSS breakpoint in `sx`;
whether it could be DRAGGED away was a separate `useMediaQuery` hook holding a copy of the same
600px threshold. When those two disagree the failure is silent and points one way: the sheet
still looks like a sheet, still shows a grab handle, and cannot be grabbed. They can disagree,
because `useMediaQuery` is JS state that has to be told to update and was measured not
re-evaluating on a live viewport change during this work. The width test now lives inside the
gesture, read off `matchMedia` at the moment the finger lands, where it cannot go stale. This
touches every sheet in the section, Game Center included.

The identity block is the club's own colours now: a band on the team PRIMARY (all four are
near-black, so white text clears 12:1 on every one) washing toward the secondary across the
right, with a 3px stripe of the secondary at full strength along the bottom, which is where
each club's actual hue lives. The portrait is an 84px rounded square rather than a 72px circle,
because a circle crops a head-and-shoulders shot to the face and at this size there is room for
the shoulders and the uniform. One size at both widths on purpose: it was briefly a
`useMediaQuery`, which is a JS media query and does not re-render on a live window resize the
way the CSS breakpoints on the same band do, so dragging a desktop window narrow left a 92px
portrait beside phone-sized padding until the next navigation.

`fetchWpblAllLines` is cached, deduped and already prefetched when the section lands on Home,
so for most readers the ranks cost nothing; if the read fails they simply never appear and the
page is what it was. `wpbl_player_role` records the tab switch, because whether anyone ever
taps through to the second role is the question this restructure raises and the tab is the only
place it can be answered.

**Then the same page was measured on a desktop, where it had never been measured either.** It
was a 640px dialog on a 1440px screen holding 1143px of content in a scroller showing ~310px of
it: the phone column, rendered verbatim, with ~800px of empty screen either side of it and the
game log below the fold on every machine. At `lg` the dialog is 840 wide and the pane is two
columns, season facts left and the record of the games right, which is also the split that
keeps the growing half on its own: the game log gains a row a day until Sep 6 and the left rail
does not grow at all. The same content is ~600px tall now instead of 1143.

`lg` and not `md`, because the section runs under a 1.4x `zoom` on desktop and a media query is
answered in real viewport pixels: `md` means 900px of screen but only 643px of layout to spend
inside the zoom, which is narrower than the single column already is. The left rail is 340 so
that the widest game log (the eleven-column hitting line, which measures 403px) always clears
the ~430 beside it and never falls back to its horizontal scroll.

The headline pair moved onto the club band, which was a gradient running most of the way across
to nothing: a portrait at one end and empty space at the other, while the two numbers a reader
opened the page for sat below it in the scroller. That needed the band's own background fixed
first. As a plain gradient its right-hand end was the secondary at 25% alpha over *whatever sat
behind the card*, which in light mode is white, so the band faded to near-white exactly where
the numbers now sit; the secondary washes over an opaque primary instead, which keeps every
point on it dark enough for white text and, as a side effect, is the first time the club's
actual hue is visible in light mode. A two-way player's band follows her tab. Fielding moved up
beside the other season facts, where it can be seen: under the game log it was 1100px down the
phone's scroll. And the counting-stat grid picks a column count that DIVIDES the item count, so
ten batting chips are two rows of five rather than 6 + 4 with two dead cells.

Two columns then made their own problem, which is that they can end at different places. Denae
Benites has five posts written about her, and in the right rail that was 346px of article cards
under the game log against a 337px left rail: the columns finished 360px apart, so most of a
screen of empty page sat beside the fielding line. The reading list runs UNDER both columns
now, two cards across, which is also the right shape for it: it is neither a season fact nor a
game, and its length is set by how often someone happened to write about her. The other half of
the same problem is the game log, the one block here that grows on its own: ten rows today,
about forty by Sep 6, which is ~1200px against a left rail that stays ~340 whatever happens. It
is capped at `lg` and scrolls itself with its header pinned. That header needs its rule drawn as
an inset shadow rather than a border, because a `border-collapse: collapse` table hands its cell
borders to the row boundary and a sticky cell leaves them behind. The pane is 513px now.

The log's rows then became the thing they had always looked like: **each row opens that game**,
and each carries the **position she played that day**. POS is the RAW box-score line rather than
`displayPosition`, which answers the season-long question and is already on the band above:
Kylee Lahners is filed 3B, and the column is what shows she has actually DH'd six times, played
first twice, and moved from one to the other in the opener. The rows are `pressable` rather than
anchors, which is the one deliberate departure from the house rule about real hrefs, and it is
for the rule's own reason: a game is `?game=` query state that seo.ts canonicalises back to the
tab, so these are the one thing here meant NOT to be indexed separately. Two things this cost.
The phone's cell padding had to come from 0.4 to 0.3, because fourteen columns at 0.4 measure
345px against the 341px a 375px sheet leaves, and those four pixels are the whole TB column,
silently. And Back out of a game opened this way landed on the player's URL with the game still
on screen: `WpblApp`'s popstate handler gated on `wpblViewFromPath`, which is null for
`/wpbl/players/<slug>`, so every pop that LANDED on a player page was dropped. That was already
true of any Forward onto a player; the game log is just the first common way to reach it. One
predicate, `wpblAppOwnsPath`, now serves both that handler and App.tsx's mount test.

The log also runs **newest first** now. Oldest-first reads down the season the way it was
played, which is the better argument at ten games and the wrong one at forty: it buries last
night at the bottom of a scroll, and it is also what decides which thirteen rows the desktop cap
shows without scrolling, since the cap clips the bottom of the list.

Then back to the phone, which the desktop pass had not touched. Two things a screenshot showed
at 412px. The hero's rank is right-aligned with `ml: auto`, which is right in the band's 216px
box and wrong the moment the hero has a whole pane to spread across: it put **189px of nothing**
between "OPS" and "1st of 33", so the two read as unrelated things at opposite ends of the sheet.
The hero now carries its own measure, the same 216 at every size, and the gap is 27px. And the
counting grid was pinned at four columns on the phone on the claim that five 3-character chips do
not fit a 375px one. Measured on one, they do, and so do six: the ten batting chips went from
three ragged rows to two full ones (138px to 90px) and the six pitching chips to a single row
(90px to 45px), nothing clipping or wrapping at either size. The column count is one rule now,
"the widest count that DIVIDES the item count", so no stat grid ends in dead cells at any width.

Capping the hero turned out to only move that problem: a 216px group left-aligned in a 378px
pane leaves all 162px of the slack on one side, under a grid and a percentile strip that both
run the full width, so the headline read as shunted into the corner of the block it is meant to
be the top of. It is centred below `lg` now, 81px a side, on the same axis the grid's columns
are symmetric about. The band's copy stays left-aligned in its own column: there it is one half
of a two-part row and its axis is the right edge it shares with the card.

The last piece to look wrong was the sample line under it, and for the same kind of reason. The
two stat rows are a three-column arrangement with three hard vertical lines (values right-align
at one edge, labels start at the next, ranks right-align at the last), and "10 G · 29 AB" was
block-level and left-aligned, so it began at the hero's own left edge: 16px left of the headline
number, 65px left of the one under it, and level with nothing at all. One element in four
aligned to a line no other element uses reads as a mistake, and it is the line the eye lands on
last, which is why it survived the fix above it. It is centred now, on the axis the block is
already centred on. Centred rather than joined to one of the three columns because its length
varies more than anything else here ("10 G · 29 AB" against "6 G · 19.0 IP · 1-0 · 1 SV", which
needs 135px): tied to the 104px value column the second would wrap, centred it grows either side.

**Team names in Game Center open their club.** Three places, covering every state a game can be
in: the score lines at the top of an unplayed game, the box score's own team rows on a played or
live one, and the preview card's legend chips. `pressable` rather than anchors, like every other
team target in the section, because a club page is history state on /wpbl/teams rather than a URL
of its own. `openTeam` from a game closes the game as it goes, so Back walks off the club and
lands on the game again, the same stack the game log builds. Two things deliberately left OUT of
the target: the SCORE on a score line, which is where a thumb rests while reading a live game,
and the rest of a box-score row, which is the innings and gets dragged sideways on a phone. The
away/home tabs inside the Box Score tab are also untouched: they already switch which side you
are reading, and a second meaning on the same control would be worse than no link at all.

**The two-way role pills stopped being welded to the pane.** They were `pt: 2, pb: 0`, which is
backwards on both counts: the pill belongs to the chrome above it, not the content below, and
with no bottom padding its edge sat flush against the scroller's clip line. On a phone, scrolled,
that put a row of stat chips sliced through the middle directly under the control with nothing
between them, which reads as a broken layout rather than as content that continues. Now `pt:
0.75, pb: 1`, which is Game Center's tab bar exactly: same control, same job, over the same kind
of pager. 6px above and 8px below, and the sheet gets back the 16px the old top padding was
spending on nothing.

Making the box score's team names pressable cost the badges their vertical centring for about
an hour, and the reason is worth writing down: the shrink-wrapped tap target was `inline-flex`,
and an inline-level box sits on the row's text baseline, so it picks up the line box's descender
space and the badge rides high of the cell's centre (the row also grew from 33px to 37px). `flex`
plus `width: fit-content` shrink-wraps the same way with no baseline to sit on. Badge centre and
row centre now agree to within a rounding error.

## Aug 26, 2026: people thought I was mary mustard

Reported, and true: readers were coming away from Home believing the person who writes the
mirrored Substack is the person who runs this site. Two things were doing it, and neither was the
byline being too big.

The shelf's subtitle was the bare masthead. "towards a more perfect game" sat directly under our
own "More from the league" heading with nothing to say whose it was, which reads as this site's
tagline. The other two segments never had the problem because they say "Game recaps from the WPBL
channel" and "Women's baseball on Wikimedia Commons" out loud. Hers now says "towards a more
perfect game, by mary mustard".

The byline printed her bio verbatim, in the first person, with no lead-in: "I am a writer and
amateur baseball player from Albany." A first-person sentence inside somebody's card is read as
that site's author speaking. So the framing does the work now rather than the size: **"Written
by"** gives the sentence a subject before her name appears, her bio is **in quotation marks** so
the "I" is unmistakably hers, and the publication line says **"her Substack"**, which is the fact
a confused reader was actually missing. Smaller too, since the point is a credit and not a
masthead: the avatar is 40 (was 52) and every line dropped a step.

Worth being clear about why this matters more than it looks. It misattributes her writing and it
misrepresents us, in both directions at once, and the whole point of the Reading surface is to
send people to her.

## Aug 26, 2026: the best game in each column, and a band that shows the club

The game log marks the best value in each column it can. Which columns is the whole design: it
has to be one where MORE IS BETTER, which drops SO from the batting log (marking a hitter's worst
game in the same colour as her best is the kind of thing nobody notices until it is pointed at)
and drops H, R, ER, BB and HR from the pitching log, since those are what she gave up. And it has
to be an ACHIEVEMENT rather than an opportunity or a workload, which drops AB and a pitcher's
pitch count. BB is left out of the batting list on a softer call: a walk is a good outcome, but
nobody scans a game log for the most of them, and every mark spent there competes with the
four-hit night. That leaves R, H, 2B, 3B, HR, RBI, SB, TB and, for a pitcher, IP and SO.

A column also declines to have a best three ways, all of them about not spending colour on
nothing: a max of zero (ten marked zeros for a stat she has not managed all season), a single
game (it cannot have a best), and a max held by more than a third of the rows. That last one is
the important one. A hitter with 1 HR in five of ten games would get five marks picking out
nothing, which is worse than none, because it teaches a reader the colour means nothing and then
they stop seeing it on the games where it does. Denae Benites lands on 12 marks over a 10x12
grid, which is about right: three four-hit games, the two-homer night, the five-RBI game.

The club band was too black-heavy, and on the two clubs it was worst on for a reason: LA's
primary is literally `#000000` and New York's is `#091b47`. The wash held the flat primary to
42% and reached only 25% secondary at the far edge, so the band read as black with a hint of
something in one corner. It starts at 26% now and ramps through 25% to 40%.

**40% is a ceiling rather than a taste**, and it took four text colours up with it. White text has
to survive every point of that band, and the binding case each time is New York's pale sky blue:
the hometown and draft lines went 0.62 → 0.75 (they measured 3.7:1), the band hero's stat label
0.72 → 0.80 (4.4:1) and its sample line 0.62 → 0.76 (3.7:1). Every one of them now clears 4.5:1
on all four clubs, with LA at 7 to 9:1. Anyone raising the wash past 40% has to move those four
again or the smallest text on the card quietly stops being readable on one club.

Home's Discord invite was off the same grid, and measurably: every SectionCard on that page
indents its content 17px and rounds its corners at 12px, and the invite was doing 11px and 8px
while sitting directly between the Scoreboard and Next Game. Six pixels and four pixels are each
too small to look like a bug and plenty to look wrong, because the eye reads the left edges of a
vertical stack as one line and this was the only card breaking it. It is on `px: 2` and radius 3
now, still a slim strip (the vertical padding stays tighter; the row's height is the 34px avatar
either way). The dismiss ✕ is pulled back out of the padding by half its own slack, since an 8px
mark centred in a 22px thumb target otherwise sits 24px from the edge against the avatar's 17.

The dev gear grew a **WPBL Home** section with a "Show Discord invite" button, because the ✕
writes a localStorage flag with no reader-facing way back (correct: an invite you can re-summon
is not dismissed) and that leaves one look at the card per browser profile, on a card that only
renders at phone widths, where clearing site data is most annoying. The undo dispatches an event
as well as clearing the key, since Home reads the flag once in a `useState` initialiser and a
silent no-op until the next reload reads as a broken card rather than a button that missed. It
lives in its own short [`discordInvite.ts`](src/wpbl/discordInvite.ts) rather than in Home:
App.tsx imports the dev menu eagerly while `WpblApp` is `lazy()`, so importing the undo from
Home would have pulled Home and its whole import graph into the main chunk for every visitor of
every section, in production, to serve a dev button. Verified against a real build: Home's
strings appear only in `WpblApp-*.js`, and `sd:dev-show-discord` in no chunk at all.

The invite also had no space under it, and the cause was not the invite. Home's stack is a plain
block with no gap, so every child carries its own margin, and the two-column feed grid carried
none: it was spaced only by the scoreboard's `mb`, which worked exactly until something was
inserted between the two. The invite was, and it collected that margin on the way past, leaving
12px above it and nothing at all between it and Next game. The grid states its own `mt: 1.5`
now. A block that depends on its neighbour for its own spacing breaks the next time it gets a
new neighbour, and margins collapse, so dismissing the invite still leaves 12px rather than 24.
Every gap down that column measures 12 in both states.

### Aug 25, 2026: the section stops assuming a tall screen

A phone turned sideways is WIDE, and every rule that mattered was written about width. So a
landscape phone took the desktop branch everywhere: 812x375 got the desktop stats grid, the
desktop sticky toolbar, and 375px of screen to hold both.

**The stats table came out 115px tall.** Its cap is `100dvh - 260px`, where 260 is everything
standing above it, which means "tall enough that nothing has to scroll" and is the right answer
whenever the screen can afford it. In landscape it left the column header and TWO of
thirty-three rows. Below 560dvh the page now scrolls instead and the cap becomes what fits in
the gap the PINNED chrome leaves, asked for through `--app-header-h` and `--wpbl-nav-h` rather
than assumed. The louder fix is wrong and was measured before being discarded: at
`100dvh - 60px` the box is 315px trying to live in a 240px gap, so it can never be scrolled
fully into view and its sticky header parks behind the nav at y=-94, which costs the reader
the column labels for the whole board. The gap is a ceiling, not a suggestion.

**And the top bar pinned 44px of that 375.** It is static under 600px WIDE, which is why it
scrolls away in portrait, so the one screen that could least afford a permanent bar was the one
screen that kept it. It now also goes static under 560px TALL, in CSS rather than beside the
`isDesktop` hook, because the two have to agree and `useMediaQuery` is JS state that an
orientation change is the worst moment to trust. `--app-header-h` reads the computed position
and re-publishes on resize, so the stats cap followed this on its own. Landscape went 115px and
two rows to 275px and seven.

### Aug 25, 2026: the four surfaces nobody was counting

An audit of every `track()` call against every interactive surface in the section, run
because the next three weeks of decisions are all going to be argued from `events` and it
is worth knowing which questions the table cannot answer. Four gaps, and each one made an
existing number less useful than it looked:

**Highlights had no events at all.** Reading and Archive each carry an impression, a
click-through and an off-site click; the third segment of the same card carried none. So the
one question the media shelf exists to answer, whether folding three rails into one buried
the other two, could not be asked: a segment with no denominator cannot be compared to the
two that have one. `wpbl_highlights_shown` / `_played` / `_youtube` complete the set, and
`played` carries `from` so the Home shelf is separable from the card inside a box score.

**Team pages were counted only when opened from two widgets.** `wpbl_seeding_team` and
`wpbl_bracket_team` were the whole record, which measured two cards rather than the surface:
the Teams grid, the standings table, the Stats table and the header search all reached a team
page unseen. `wpbl_team_opened` now fires from `selectTeam`, the one funnel every open goes
through, with `from` for the surface. The two card events stay because they carry the seed, so
a bracket click lands in both on purpose; that is written down in `analytics.ts` and in
`docs/ADMIN_ANALYTICS.md` because it is exactly the kind of overlap someone will add together.

**Search was entirely unmeasured**, on a control that sits in the header of every page in the
section. `wpbl_searched` fires once per settled query (a debounce plus a per-mount set of
queries already logged, so backspacing through a word cannot re-fire it) and
`wpbl_search_picked` records whether a typed result or a recent did the work. The typed text
is kept only when the query matched nothing: that case is the only list on the dashboard that
names a specific thing to go and fix, and a query that did match is already described by the
row the reader picked.

**Two existing events were lying about where readers came from.** `wpbl_player_opened` took
`from` off the current tab, so every player opened from the header search reported whichever
tab happened to be behind it, and opening a player page is the retention event. And
`game_center_opened` carried no `from` at all, so the busiest modal in the section was one flat
count that could not say whether Home, the schedule or a team page feeds it. Both fixed.
`wpbl_game_tab` goes one level further in, for the same reason `wpbl_stats_board` exists: the
Recap / Box Score / Play-by-Play / Pitch Data axis never touches the URL, so nothing said
whether Pitch Data, the newest board in the section, is ever opened on purpose.

The read side is two RPCs
([`20260825065648`](scripts/migrations/20260825065648_add_admin_wpbl_entry_point_and_search_rpcs.sql),
same owner-gated `security definer` model as the other seven) and two cards on `/admin`: how
readers reach a player, a team or a game, and the search funnel with the missed queries.

And the dashboard itself got the same treatment, because instrumenting a surface and then
burying its answer under cards nobody reads is half a job. `/admin`'s Audience group lost the
Discord funnel (retired Aug 19; impressions frozen, joins still climbing from the footer link,
so its rates were heading past 100%) and dropped its headline row from five tiles to three:
"Events" was a number a deploy moves rather than an audience, and "Active today" / "Active 30d"
were two tiles holding three numbers that the range chips do not touch. It gained a **Today**
range, deliberately named for what it is: `days_back = 1` is midnight-to-now, and because its
previous window is a full yesterday the change arrows stand down on that range rather than
reading negative every morning. A one-day series also stops pretending to be a chart.

**Deliberately not done:** `/mlb`, which the same traffic read says is 768 events across 33
browsers against the section's 18,213 across 2,036, so instrumenting its twenty-odd unmeasured
views would be work spent on a rounding error. And impressions for Home's Next game, Last game
and Standings cards, which sit above the fold on every visit and would count arrivals rather
than sightings.

### Aug 24, 2026: player links unfurl as a card, not as a cropped face

`og:image` on a player page was the bundled 512 headshot, with `twitter:card` set to
`summary` to ask for it as a small square thumbnail. That request only reaches the
platforms that read `twitter:` tags. Bluesky reads `og:` alone and puts whatever it is
handed into one banner at roughly 1.91:1, so the square arrived centre-cropped to its
middle 52%: cap clipped, chest gone, and no way to tell it from a mistake.

Every player now has a real 1200x630 card, generated by
[`scripts/make-wpbl-share-cards.py`](scripts/make-wpbl-share-cards.py): the club's colour
lifted off black where it has to be, its mark ghosted behind, the headshot as a white tile,
and the name, position and club set beside it. Stats stay in `og:description`, which the
edge still writes per request, so nothing on the art can go stale except the club, and that
is what the rerun-after-a-trade note is for. A tile rather than a cut-out figure because
only 53 of the 118 headshots are cut out; the other 65 are the same photograph on opaque
white and would have landed on the plate as a white rectangle.

Two things fell out of it: `estheoa-segovia.webp` was a typo for `esthela-segovia`, which
means the site had never been able to resolve Esthela Segovia's headshot at all, and the
size tags the function used to delete are now true and stay.

### Aug 24, 2026: finished games post themselves to Bluesky

The Discord recap has existed for a while; this is the same engine on a public timeline, which
turns out not to be the same job. `wpbl-bluesky-recaps` posts the recap as text and the box score
as a rendered image. It is the only job in the repo that publishes to a third-party platform, it
posts to our own account only, and the mention watcher's rule is untouched: that one finds threads
and never replies to them, and nothing here may reply, quote or mention anybody.

**Bluesky has no edit, and that changed the design rather than the transport.** The Discord job
leans on editing: it re-renders every recent final on every run and PATCHes the ones whose text
moved, so a late scoring correction fixes itself in the channel and nobody sees it happen. Here a
post is published or deleted, in public, with nothing in between. So this one never re-sends, and
waits instead: it records when it FIRST saw a game final and publishes on a later run, 45 minutes
on. `wpbl_play_corrections` exists precisely because the league's scoring has errors in it, and
the recap wording is derived and changed under us the same day. Publishing the instant a game ends
is how a permanent public post ends up carrying numbers the site itself no longer agrees with.

**The box score had to become a picture.** Discord's is a space-padded table inside a code fence.
Bluesky has no monospace and no fences, so that exact string is ragged nonsense there: the box
score is not a smaller version of the Discord one, it is a different artefact. `blueskyRecap.ts`
draws it as SVG, pure and tested, and the sender rasterises it with resvg, subsetting Inter per
card to exactly the characters that card draws. That last part is not fussiness: a glyph missing
from a subset renders as **nothing at all** rather than as a box, so an accented name would
silently vanish from a card that otherwise looked perfect.

Two smaller traps worth keeping. A post is capped at **300 graphemes**, counted the way
`Intl.Segmenter` counts and not the way `String.length` does, and the server rejects anything
longer outright, so it is trimmed by measurement: 18 of the 20 finals to date fit untouched, two
did not. And a link needs a facet carrying **UTF-8 byte** offsets, which differ from string
indices the moment a name like Maïka or a "·" appears earlier in the post. Get that wrong and the
post still publishes, with the underline sitting a few characters left of the URL and half a
player's name inside the link. Nothing errors.

It never backfills: the first run recorded all 20 existing finals as handled and posted none of
them.

### Aug 24, 2026: recaps that do not all sound the same

Four clubs play the same six matchups all season, so a recap engine with one verb per game
shape produces one sentence per game shape, and the section had spent August saying "Firebells
top Queens". Every branch is now a small pool: 11 of the 20 finals had used `top`, and 2 do now.
The pick is **seeded on the game id**, never random, because the same recap is built by the
site, by the ingest's Deno announce and by the nightly job, which compares them by content hash:
a recap that reworded itself on each build would leave that job editing the same Discord message
every night forever, and would rewrite the sentence under a reader on any re-render.

Extra innings got a verb of their own (`outlast`), ahead of the margin checks. It is the only
addition that carries a fact rather than a synonym, since a score cannot say the game went long.

**The thresholds were also wrong, and rendering all 20 finals is what showed it.** `closeMargin`
was set to the league's MEAN winning margin, which makes about half of every season "close" by
construction: a 9-4 read as "the Heights held on for a 9-4 win". Close is a tail, not the middle,
so it is now one SD *below* the mean, symmetric with the blowout cutoff at one SD above. On this
league that is 2 rather than 5.

That exposed a second thing: `closeMargin` had been doing two unrelated jobs, and they pull
opposite ways. It also decided whether an inning was big enough to call the decisive swing, where
tightening it to 2 would have produced "pulled ahead with a 2-run 4th". Split into
`bigInningRuns`, which keeps the old formula because an inning worth naming really is about the
size of a whole typical winning margin.

### Aug 24, 2026: the half of Reddit that search cannot see

The mention watcher shipped with a hole it documented honestly: Reddit's search indexes link
posts and not comments, so *"wait, where can I watch this?"*, asked as a reply inside somebody
else's game thread, went past unseen. That is not a corner case. It is the likeliest shape of
the exact moment the job exists to catch, and the version that is a post of its own is the rarer
one. `searchRedditComments` now sweeps the comment listings of a short list of subreddits on the
same credential, registered as its own source so post search and the sweep fail separately.

**The interesting part is that a comment cannot be judged the way a post is**, and the rule has
two halves that pull against each other. The subject is allowed to come from the parent post's
title, because the comment worth finding names no league at all: the post classifier returns null
for it. But the intent has to come from the comment's own text, and **a comment can never be a
plain mention**. Drop that half and every one of four hundred comments under the same game thread
inherits the league from the title, one busy night buries a week of real questions, and the
channel is muted by morning. `classifyComment` is separate from `classify` for that reason, with
13 tests holding both halves down.

**A comment listing also cannot be asked for a time range**: it hands back the newest hundred, so
a subreddit busier than the page budget is one the sweep only ever sees a slice of, and a full
page that reaches back ninety seconds looks exactly like a healthy one. It is measured instead of
assumed. A short sweep *with a cursor still left over* names the sub and says how far back it got;
a quiet sub, short for the innocent reason and holding no cursor, is deliberately silent, because
an alarm that fires every fifteen minutes forever is an alarm nobody reads. A sub that is gone,
private or has banned us is skipped by name, and every sub refusing is raised as a real failure.

The subreddit list is the tuning knob and is short on purpose. A bad entry there costs nothing
visible: it quietly spends the page budget and starts missing the sub that mattered.

### Aug 24, 2026: finding the people who are already asking

Two Facebook posts got real traction, and the pattern underneath them is a recurring question in
both groups: *where can I see live updates?* That is the single best moment this site has to be
mentioned, and it was being caught by luck, in whichever tab happened to be open.
`wpbl-mention-watch` (every 15 minutes) searches Reddit and Bluesky for it and digests the
threads worth answering into a private Discord channel, sorted question, then anyone naming the
site, then plain league chatter.

**It finds threads and never answers them.** The only place it posts is our own webhook, and it
holds no credential that could reply anywhere else. An automated reply in somebody else's
community is spam, and it would get the account banned from exactly the communities worth being
in. Every digest ends with a line saying so, which is not decoration.

**Facebook, where the traction actually is, is deliberately absent**: the Groups API was
withdrawn in 2024, group posts are in no search API, and scraping them breaks the terms whichever
account does it. The durable fix there is not automation but a **pinned resource link or a
Featured entry**, which turns the recurring question into a standing answer;
[`docs/BACKLINKS.md`](docs/BACKLINKS.md) now carries the ask, written out, as the highest-leverage
item in the file.

Two things about the sources are worth remembering, because both were checked by hand and both
surprised us. **Reddit has no anonymous mode left**: `search.json`, `old.reddit.com` and
`/r/<sub>/new.json` all answer 403 to a residential IP with an honest user-agent, so the OAuth
token is required rather than a nicety. And **Bluesky's post search is the one public-AppView
endpoint that needs a token**: `getProfile` and `searchActors` answer without one, while
`searchPosts` returns a CDN 403 HTML page that does not read as an auth failure at all. A source
with no credentials is skipped with an actionable log line rather than failing the run.

The matching (`classify`, 21 tests) has two ways to be useless and they pull opposite ways. Too
loose and the channel is a firehose that gets muted inside a day, so the real question lands
where nobody is looking: that is why intent is matched as phrases ("where can I watch") and never
single words, and why club nicknames are not subject terms on their own, since "Queens",
"Heights" and "Hunters" are ordinary English words. Too tight and it never arrives at all. Seeing
and announcing are also separate: the search looks back a week, so everything found is recorded
at once but only eight per run are announced, and anything still queued after three days is
dropped unposted rather than dribbling out for a fortnight.

### Aug 24, 2026: the postseason gets odds, not another standings table

The bracket and seeding cards report records and seed order, which the standings already do, so
the postseason experiment was a re-skin of a table the section has twice over. This is the thing
it was missing: the first FORWARD-LOOKING, PROBABILISTIC surface in the section. The bracket card
now carries a win-probability bar under each series, an elimination flag when a club is a loss
from going home, and a "chance to win it all" strip ranked by title probability rather than by
record.

It is the series analogue of the in-game win chart, and honest for the same reason: every link
in the chain is standard rather than guessed. `derive/seriesOdds.ts` (pure, 11 tests) reads each
club's season runs into a **pythagenpat** rating (exponent `((RF+RA)/G)^0.287`, chosen over a
fixed 1.83 because this league scores ~15 runs a game and the exponent is meant to track exactly
that), turns two ratings into a single game's odds via **log5**, enumerates the best-of-3 and
best-of-5 from the current game count, and propagates the semifinal odds into a final whose
opponent is a distribution until both semifinals are done. No new data, no new request: it reads
the same standings rows the bracket was already built from.

Three things it states plainly rather than hiding. **It is not the standings**: a club ranks by
its chance to win the title, so a stronger lower seed can sit above a weaker higher one. On
production today the 3 seed (Heights, 15%) edges the 2 seed (Queens, 13%) behind a 70% Firebells,
because Heights matches up better against the club they would meet in the final even though their
own semifinal is a coin flip. **It is soft**: 15 games is a small sample, and the card says to
read the numbers as a lean, not a lock. **There is no home-field term** (`HOME_EDGE = 0`): one hub
venue, no park to defend, one constant to change if that ever stops being true. It began behind the
experiments switch (it draws a matchup that does not exist yet) and came out to everyone once the
head-to-head blend turned it from a bare projected bracket into a forward-looking surface; the
footnote carries the hedge a bracket-shaped guess needs, which a flag almost nobody flips did not.

**Head-to-head blend, same day.** The first cut priced a game from run differential alone; it now
blends in how the two clubs actually fared against each other, regressed toward the model by
`n / (n + 10)`. A four-club league plays the same pairing 10-15 times, a sample a 30-club league
never produces, so the real record deserves weight, but 12 games is still noisy, so at a full-
season series it lands ~55% record / ~45% model and with two meetings almost all model. Each
series box now shows the season series that feeds it ("Season series SF 2-0"). This is what moved
the top seed from 92% to 94% in its semifinal (SF swept Boston) and reshuffled the title strip.

### Aug 24, 2026: Esthela Segovia, not "Estheoa"

A real player's name had rendered wrong since the seed. She is a seed-only row (no feed id, no
games), so `wpbl-ingest` never touched her and a guarded one-row `UPDATE`
(`20260824120000_fix_estheoa_segovia_name.sql`) was safe and will not be reverted. Her canonical
URL moved to `/wpbl/players/esthela-segovia` with it, since the slug derives from the name.

### Aug 24, 2026: recents in the empty search box

The header search did nothing until you typed two characters, so tapping it on a phone showed
an empty box and a keyboard. It now remembers the players and teams you opened from it and
lists them the moment it is focused, newest first, which puts a tappable player entry point on
the one control the traffic section says has none (opening a player page is the retention
event, and Home is where new visitors are lost). Cleared with a Clear affordance on the card.

**Deliberately not the MLB recents store.** That path (`user_preferences.recent_searches`,
`mlb/storage/recentSearches.ts`) is keyed on numeric StatsAPI ids and renders from the MLB
team-color map and mlbstatic headshot URLs; WPBL ids are string uuids and its avatars are its
own. Sharing the store would either corrupt MLB recents or render WPBL rows blank, so the
section keeps its own tiny localStorage list (`src/wpbl/recentSearches.ts`) storing only
`{type, id, name}` and rebuilds each row's avatar and subtitle from the LIVE roster at render
time, so a traded player carries her current tint and team rather than a stale one. The rows
reuse the same self-describing `SearchResultRow` / `ToolbarResultRow` path the typed WPBL
results already ride, so the always-loaded toolbar draws them without importing the section's
lazy chunk. localStorage only: no cross-device sync, which the MLB column would have given but
cannot hold WPBL ids.

### Aug 23, 2026: win probability, and a way to read it with a thumb

The model is in `derive/winProbability.ts` and the argument for it is in its header: an
empirical win-probability table is out of reach here by three orders of magnitude, but nothing
has to be looked up. The run-expectancy walk already measures how many runs follow each
base-out state, and keeping that as a histogram rather than a mean gives the two distributions
a win model needs; from there it is exact dynamic programming backwards from the last out. No
simulation, no seed, so the same game always draws the same chart.

The card is `WinProbView.tsx`, at the top of the recap, and not gated: it shipped straight to
everyone, since the thing behind the experiments switch is the Run value BOARD, whose numbers a
reader has to take on trust, while this draws a line whose headline claim they can check against
the score at the top of the same sheet. Every box
in it is a FIXED height, reserved from the first paint, because it needs the league's whole play
log rather than this game's and therefore lands a second late: unreserved, it shoved the rest of
the recap 310px down the screen on arrival.

**The readout is one shape in both states, and it always names a play.** Three rows: what this
moment is and the win probability at it, the play itself, and the score it left (at rest, the
hint that the chart can be read at all). Resting, the card sits on the play that won the game;
holding the plot moves that same readout along the line, which teaches the gesture better than
the hint does. The first cut had a second layout for a rout, where the card dropped the play
entirely and printed prose about there being no swing, which is a non-answer in the most
valuable 64px on the card. `SWING_FLOOR` survives, but it now decides the WORDING rather than
whether a reader gets a play: "swing of the game" where one play really turned it, "biggest
moment" where nothing did, and never "swing" for a game with no winner to have swung to. The
17-3 on Aug 14 reads "Biggest moment · 1st, SF 56% → 64%", which is honest and is still an
answer.

**Reading it is a hold, not a hover, and that changed where the answer goes.** The MLB
section's equivalent chart is `onMouseMove` with a floating tooltip, which on a phone means
the feature does not exist. Here the gesture is native touch handlers on the plot: a press
commits to scrubbing once it has held still for 220ms or moved sideways past 8px, and a finger
heading up or down the page is released instantly, because this is 150px of a tab people
scroll through and swallowing that gesture would be worse than the feature is good. Once it
has the gesture it `preventDefault`s, which is why the listeners are native and non-passive:
React registers `touchmove` on its root as passive and drops the call.

The readout goes in the caption box, which is already there and already that size, rather than
in a floating window that would cover the chart and sit under the hand pointing at it. **And
the box moved above the plot**, which is the part worth remembering. Game Center is a sheet,
and between the line score, the highlight reel, the tab row and the recap's opening line, the
Recap pane hands this card about 220px of a 690px screen. With the readout last, the only part
that answers the question was below the fold, along with the hint advertising that the chart
can be held at all. Above the plot it is on screen from the moment the card is, and a finger
on the chart is no longer on top of it. The same pass found the box clipping its own third
line at 375px, a 110-character sentence in a box built for less, which is what settled the
shape it has now: three rows, the play held to ONE of them with the batter's name giving way
first (`useWpblName`, as everywhere else in the section), and a height sized to that worst
case. 64px, down from 74, and the plot gives up 18px on a phone as well. The card went 299px
to 275px while gaining the readout, and fits whole in the pane it lives in.

**The header was the other half of the problem, and the reel paid for it.** Game Center's fixed
header (line score, conditions, highlight reel, tab row) came to more than half a 690px phone
screen, and every tab underneath was living on what was left. The reel moved to the foot of the
Recap tab, where it is a fine thing to find after reading what happened and costs the other tabs
nothing: the Recap pane went from 306px to 397px, which is the difference between the win
probability card being clipped and fitting whole. `GameDetail` keeps one copy of the reel in the
no-box-score branch, since a final game with no lines draws no tabs and would otherwise lose its
video.

**Three handlers already owned touches in that sheet, and the chart is the fourth.** Game
Center is the busiest gesture surface in the section, so the rules are worth writing down:

| gesture, starting on the chart | who takes it |
| --- | --- |
| Drag down, no hold, pane at its top | the sheet: it dismisses, exactly as from anywhere else |
| Drag down, no hold, pane scrolled | the pane: it scrolls, nothing is prevented |
| Drag down after a 220ms hold | the scrub, and only the scrub |
| Drag sideways | the scrub. The pager is out (`data-swipe-lock`) |
| Drag sideways on any other recap content | the pager, as before |
| Tap | the scrub, as a peek |
| Escape with a readout up | the scrub closes it; the sheet stays open |
| Escape with no readout | the sheet closes |

Two mechanisms hold that up. `data-swipe-lock` in `SwipeableViews` bails at `touchstart` for
any element inside it, unlike `ownsHorizontalScroll` beside it, which is about a scroller
having room left and is overridden by a hard flick; without it a drag across the chart paged
to the box score. And an ENGAGED scrub calls `stopPropagation` as well as `preventDefault`,
because `useSheetDrag` reads touchmove on the sheet itself: preventing the default stops the
browser scrolling and does nothing at all about another JavaScript handler, so a hold and a
drag down was throwing the whole modal off the screen while the reader thought they were
reading it. Both are scoped to a deliberate gesture, so every touch that merely passes over
the chart on its way somewhere still belongs to whoever it was going to.

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
### Aug 21, 2026: the batter in every play opens

Traffic says opening a player page is the retention event (7.8% return without one, 76.5%
with a player page and a Game Center together), so a name that renders as plain text is a
missed door. Every play in the play-by-play opens with a batter, already set in bold on its
own span, and it was not a link.

It resolves on `batter_id` rather than by matching the printed name, since the feed fills
that column on all but a couple of percent of plays and the name on screen has already been
through the shortener by then. `parsePlay` only fills its `who` when the narrative opens with
that play's own batter, so a runner-only play links nothing rather than linking the wrong
person.

Names inside the play narrative ("Jaida Lee advanced to third") stay plain on purpose: the
row's own batter is tappable now, and linkifying prose means splitting a sentence the section
already rewrites once for name shortening.


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
