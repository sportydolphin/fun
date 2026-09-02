# WPBL play-by-play validation and corrections

The league's scoring has errors in it, and the league is not reachable to get them fixed at
source. So we find them mechanically instead of by watching fourteen games back, and we keep
our own corrections next to the mirror rather than in it.

Two separate things live here and they are easy to confuse:

- **Validation** finds candidate errors. It never changes any data.
- **Corrections** are our fixes, applied as a read-time overlay. Nothing writes them
  automatically; a human decides, usually after checking the video.

**Built Aug 17, 2026.**

---

## 1. The shape of it

| Piece | File |
|---|---|
| The validator | [`scripts/validate-wpbl-pbp.mjs`](../scripts/validate-wpbl-pbp.mjs) (`npm run validate-pbp`) |
| Accepted findings | [`scripts/wpbl-pbp-baseline.json`](../scripts/wpbl-pbp-baseline.json) |
| Nightly job | [`.github/workflows/wpbl-pbp-validation.yml`](../.github/workflows/wpbl-pbp-validation.yml) |
| Corrections table | [`scripts/migrations/20260817190000_add_wpbl_play_corrections.sql`](../scripts/migrations/20260817190000_add_wpbl_play_corrections.sql) |
| Run-health table | [`scripts/migrations/20260817200000_add_wpbl_pbp_validation_runs.sql`](../scripts/migrations/20260817200000_add_wpbl_pbp_validation_runs.sql) |
| The overlay | `applyPlayCorrections` in [`src/wpbl/api.ts`](../src/wpbl/api.ts) · tests in [`playCorrections.test.ts`](../src/wpbl/__tests__/playCorrections.test.ts) |
| Runs semantics | `runsOnPlay` in [`src/wpbl/derive/playByPlay.ts`](../src/wpbl/derive/playByPlay.ts) |
| Admin indicator | `WpblValidationChip` in [`src/AdminPanel.tsx`](../src/AdminPanel.tsx) · [`adminValidationChip.test.tsx`](../src/__tests__/adminValidationChip.test.tsx) |

Needs `SUPABASE_DB_URL`, the same session-pooler connection string the migration runner uses.
The checks are window functions and full-table joins across four tables, which is SQL's job
rather than something to reimplement over PostgREST.

---

## 2. Why it does not diff the box score against the play log

That is the obvious design and it does not work. Measured over the first 14 games, 291
player-games appear in both views and only 5 disagree, all of them on at-bats, with hits, home
runs, walks and strikeouts matching exactly.

The two views are generated from the same scoring input, so they inherit the same mistakes.
Credit a hit to the wrong player and both views agree with each other, and both are wrong.
Anything built on "do our two copies match" is dead on arrival.

What works instead is **baseball's own rules**, which hold regardless of what the scorer typed:
the batting order is strict, a half-inning ends on the third out, runs have to add up. A
violation of those is a real problem in the data rather than a disagreement between two copies
of it.

Every check points at one game, half-inning and lineup slot. That is the whole value: it turns
"watch fourteen games" into "check about thirty moments". **Read the output as candidates for a
video pass, not as a list of confirmed errors.**

---

## 3. The checks

| Check | Severity | What a hit means |
|---|---|---|
| `missingBatters` | high | The box score gives a batter plate appearances and the play log has nothing for them at all. The strongest check, and the one that found real errors first time out. |
| `battingOrder` | high | Consecutive plate appearances for one side must advance exactly one slot, 9 wrapping to 1. A jump repeated 3+ times means a whole slot is missing all game; a single one is likelier a mis-attribution. |
| `paCounts` | medium | The batter is in the log but short or long a trip. Catches what `missingBatters` cannot, since that one is all-or-nothing. |
| `outs` | medium | A half-inning that never reaches a two-out state, so the third out has nothing before it. |
| `runs` | medium | Runs in the play log against the final score. |
| `homeRuns` | medium | A home run whose `runs_scored` does not equal the number of occupied bases. The field excludes the batter, so those two have to agree. |
| `pitchers` | low | A pitcher in one view and not the other. |

Three of these were wrong when first written, and the reasons are worth keeping:

- **`outs` counted out events.** That undercounts badly: a double play is one row worth two
  outs, and a sacrifice retires the batter without being an "out" event. Written that way it
  flagged 50 half-innings, nearly all of them fine, which would have buried every real finding.
  It now uses the `outs` column, which is the state **before** a play, so a completed
  half-inning must contain a play that started with two away. The last half-inning of a game is
  exempt, since it ends when the winning run scores and is often not played at all.
- **`runs` was systematically biased.** Every gap it measured was negative, 1 to 3 short across
  15 of 28 team-games and never once over. "Has a gap" therefore said nothing. The cause was the
  runs semantics below; fixing that took it from 15 flagged team-games to 1, and that one is a
  real lead.
- **`homeRuns` claimed a feed bug that was not one, twice.** See below.

`battingOrder` deliberately excludes two benign cases: the same slot twice in a row, which is a
substitution taking over mid-slot, and slot 10, where the feed parks pitchers who never bat.

---

## 4. The runs semantics, which have caught every reader so far

**`runs_scored` from the feed counts the RUNNERS who crossed, and never the batter.** A solo
home run reads 0, a two-run homer reads 1, a grand slam reads 3.

This is a consistent rule and not corruption. Measured over 1,352 plays, `runs_scored` equals
the number of "X scored" clauses in the narrative on every single row. Nothing else needs
adjusting either: wild pitches, errors and fielder's choices all carry their runs correctly,
because there the run belongs to a runner and the feed counts it.

It is also a trap, and it has caught every piece of code that read the field:

- The **validator** flagged 15 of 28 team-games as having lost runs. Crediting the batter took
  that to 1.
- The **play-by-play badge** in Game Center showed nothing on a solo home run, and the comment
  above it blamed wild pitches and fielder's choices. That explanation was never right: no play
  with `runs_scored = 0` mentions anyone scoring, on any of the 1,352 rows. Home runs were the
  whole gap.
- The **validator's home-run check** reported ten rows as a feed bug for carrying
  `runs_scored = 0` while their own narrative read "homered ... RBI". The data was
  self-consistent and the check was wrong. It was then rewritten to flag the `is_scoring_play`
  label on those same rows, and **that was the same mistake wearing a different hat.** Measured
  Sep 1, 2026 across every stored play, `is_scoring_play` is exactly `runs_scored > 0` with zero
  exceptions: it is a restatement of the field, not an independent flag the league can get
  wrong, so "home run not flagged as a scoring play" only ever meant "solo home run". Seventeen
  were in the findings by then and ten had been accepted into the baseline as real. The check now
  compares `runs_scored` with the number of occupied bases, which is the arithmetic the field
  actually claims, and finds nothing.
- **`firsts.ts` mis-dated a first RBI.** The Hall of Firsts tested `runs_scored > 0`, so a solo
  home run did not count as an RBI even though it credits the batter with one. Claire
  O'Sullivan's first RBI showed as an Aug 16 sacrifice when it was actually an Aug 15 solo home
  run, whose narrative says "RBI" in the feed's own words.

That last one is the argument for `runsOnPlay()` existing. `firsts.ts` had the rule written out
correctly in a comment on its grand-slam branch, twelve lines above the RBI check that got it
wrong. **Knowing the rule is not enough; it has to be callable.** Everything that needs runs on
a play now calls `runsOnPlay()`, and it has its own test.

The Hall of Firsts is the most attribution-sensitive surface in the app: a first is awarded
once and then reads as settled league history, so a wrong batter does not just mislabel one row,
it hands somebody else's milestone to them permanently.

---

## 5. The baseline and the nightly job

Run unattended, the validator reports 57 things and would report 57 things tomorrow. A job
wired to "fail when anything is flagged" therefore fails every night and is ignored inside a
week.

So the job runs against a **committed baseline** of findings already seen, and reports only what
is new.

```bash
npm run validate-pbp -- --baseline scripts/wpbl-pbp-baseline.json
```

Other useful forms:

```bash
npm run validate-pbp -- --game 2026-08-01
```

```bash
npm run validate-pbp -- --json > report.json
```

**Triaging a finding** means either correcting it (§6) or accepting it. To accept:

```bash
npm run validate-pbp -- --baseline scripts/wpbl-pbp-baseline.json --update-baseline
```

then commit the baseline file. Anything not in it counts as new and shows in the admin panel.

A finding's identity is its check plus its whole row. Rows are aggregates of stable facts (date,
team, player, inning), so the same underlying problem fingerprints identically run to run, and a
genuinely new one cannot collide with an accepted one.

### The job does not fail on findings, on purpose

`wpbl-pbp-validation.yml` runs at 08:00 UTC, the small hours Central, by which point every game
of the previous day has long since gone final and nothing is mid-flight. It passes `--record`,
which writes a row to `wpbl_pbp_validation_runs` and **always exits 0**, including when the run
itself throws. A run that dies still has something to say: without that, the admin panel would
show the last good run and look healthy while the job had been broken for a week.

There is no Discord alert. One was written and removed: it needed a fourth webhook secret that
does not exist, and its condition read a variable from the step's own `env` block, which is not
available to that step's `if`, so it would never have fired.

---

## 6. Corrections: a read-time overlay

**Corrections cannot live in `wpbl_game_plays`.** That table is a mirror, and `wpbl-ingest`
treats it as one: it deletes every play for a game and reinserts them on each pass. An edit
written there survives until the next cron tick and then vanishes, silently, with no trace that
it was ever there.

So `wpbl_play_corrections` is a separate table, laid over the mirror on the way out.

**Keyed on `(game_id, sequence)`**, never the play's uuid, which is regenerated on every
reinsert and so identifies a row for minutes. `sequence` alone is not enough because it restarts
at 1 in every game, and the Hall of Firsts hands the overlay a whole season in one array.

**One row per corrected field**, not per play. A play can be wrong in more than one way (wrong
batter *and* wrong event), those are usually found at different times and by different means,
and one may be reverted without the other. `old_value` is kept so a correction can be audited
later against what the feed actually said, and so we can notice when the feed has since changed
its mind and the correction is stale.

Correctable fields are constrained by a check constraint: `batter_id`, `batter_name`,
`pitcher_id`, `pitcher_name`, `event_type`, `runs_scored`, `is_hit`, `is_scoring_play`,
`narrative`. An open string would invite corrections to fields the overlay does not apply, which
would then look applied and would not be. Values are text regardless of the column's real type;
the overlay casts on the way out.

`source` records how we know: `video` (strongest and slowest), `derived` (a rule in the validator
concluded it), `external` (a second transcription agreed), or `league`.

### Which reads apply corrections

| Read | Surface | Corrected |
|---|---|---|
| `fetchWpblGamePlays` | Game Center play-by-play | yes |
| `fetchWpblAllPlays` | (no surface: the Hall of Firsts card it fed was retired) | yes |
| `fetchWpblGameRecapPlays` | Home "Last Game" card, recap engine | yes |

The corrections table is tiny and usually empty, so the per-game reads fetch it alongside the
plays rather than after them, and the season-wide read takes the whole table rather than paging
it.

### Writing one

There is **no UI for this**, and RLS grants `select` only. Writes go through a direct psql
session or the service role. That is deliberate for now: a correction is a considered act backed
by video, not something to click. If a UI is ever wanted, the table needs an owner insert/update
policy adding, which it does not currently have despite what the migration's comment implies.

```sql
insert into wpbl_play_corrections (game_id, sequence, field, old_value, new_value, reason, source)
values ('<game uuid>', 214, 'batter_name', 'Wrong Name', 'Right Name',
        'Video at 1:42:10 shows the batter was Right Name.', 'video');
```

---

## 7. The admin indicator

`/admin` shows the check's health next to the feed mirror's own freshness, modelled on
`WpblFreshnessChip`.

| State | Meaning |
|---|---|
| **Clean** | Ran recently, nothing outside the baseline. |
| **N new** | Findings not in the baseline. Triage them. |
| **Stale** | No run in 26 hours. |
| **Failed** | The run itself errored. |

**Stale is the state that matters.** Findings are expected and the job is designed not to shout
about them, so the only thing needing attention is the run going missing. 26 hours rather than
24 because GitHub's cron is best-effort and a run slipping an hour under load is not a problem.

The thresholds are tested. The page itself was not verified end to end, since `/admin` needs an
owner sign-in.

---

## 8. What this cannot catch

Everything above tests the data against the rules of baseball. That catches plays that are
missing, duplicated, or attributed to a batter who breaks the order.

**It cannot catch two players swapped consistently through a game.** The order stays legal, the
outs add up, and both box lines look ordinary. Nothing that reads only the feed will ever see
it, which is why the answer had to come from outside the feed.

**Closed, partly, on Sep 2, 2026.** Closing it needs a second, independently produced
transcription of the same game, and `scripts/check-wpbl-retro-stats.mjs` now runs one nightly:
it derives per-batter PA, AB, H, 2B, 3B, HR, BB, SO and HBP from RetroWPBL's event files and
diffs them against our box-score lines. A consistent swap shows up as exactly the shape it is,
one batter short a plate appearance and another long one, in the same game. The Aug 27 NY at LA
game is the first it found: a strikeout we charged to Amira Hondras and they charged to Mo'ne
Davis, with the plate appearance moving the same way.

It is partial on purpose. It compares the counting stats whose Retrosheet event maps to them
without a judgement call, so it can see a plate appearance credited to the wrong batter but not
a fielding play credited to the wrong glove, and it says nothing about pitching. 18 disagreements
across 24 games are accepted in `scripts/wpbl-retro-stats-baseline.json`; the job reports only
what is new.

Baseball Reference added the WPBL to its register in Aug 2026 and would be the obvious third
opinion. It is not usable as one: the whole Sports Reference network answers 403 to an automated
fetcher and their terms forbid automated collection. There is also a question of what it would
prove, since the league's games carry `provider: "presto"` and BR's register data may come from
the same upstream, in which case agreement would show two parties ingesting one feed the same
way rather than the feed being right. RetroWPBL is the only source here that is genuinely not
downstream of it.

**The terms it runs under have not changed, and they are the reason it reads rather than
mirrors.** `github.com/exu6jh/RetroWPBL` is hand-written Retrosheet `.EVW` files with a batter id
on every plate appearance. **It carries no licence, so it is all rights reserved by default and
must not be ingested or republished.** Reading it to check our own rows is a different act from
redistributing it; the author granted permission for our use on Aug 21, 2026 (ARCHITECTURE §10),
and `sync-wpbl-retro` mirrors only the `info` records. The play records stay unmirrored on
purpose: their value is as a check, and a second copy of the play-by-play would be a second
truth.

---

## 9. What the RetroWPBL check has found (Aug 27, re-run Sep 1, 2026)

Run as a check rather than a mirror, on the two games whose play-log runs disagree with their
own box score. Both were found by totalling the log per side and comparing it with the published
score, which is a stronger check than anything in §3 because it needs no rule about baseball at
all, and both were then explained line by line against RetroWPBL.

**Aug 15, LA at Boston. Found, diagnosed, and then fixed by the league before anything was
written.** The 3rd-inning row read *"Lexi Hastings stole second; Beth Greenwood stole home"* and
carried `runs_scored = 0`, leaving BOS on 3 in the box score and 2 in the log; RetroWPBL scores
the same moment `SBH;SB2`, a run. Within the hour the same row read *"Lexi Hastings stole
second; Beth Greenwood scored on a fielding error"* with `runs_scored = 1`, and the game
reconciled on its own.

**That is the standing lesson about corrections, not a footnote to this one.** `wpbl_game_plays`
is a mirror rewritten every couple of minutes (§6), so the league re-scoring a play reaches us
by itself. A correction written against the old reading would have survived the rewrite, been
laid over the new one, and made a one-run play into a two-run play, in a table nobody looks at
twice. **Re-read the row immediately before writing a correction for it**, and prefer waiting a
day on anything the league might re-score itself. The overlay is for what the feed will not
fix, not for what it has not fixed yet.

**Aug 20, New York at Boston (NY 9 in the box, 8 in the log).** From sequence 63, in the middle
of the 5th, the feed's rows go blank: no batter, no event type, no narrative, `outs` frozen at
0, fourteen of them across the 5th, 6th and 7th. RetroWPBL has all three innings in full,
including the 7th-inning hit-by-pitch with the bases loaded that is the missing run. **The
overlay cannot fix this one**: its correctable fields do not include `outs` or the bases, so the
base-out state of those rows is unrecoverable from our side. A re-ingest is the only fix, and
only if the feed has since filled them in.

This is also why the run-value table now reconciles per HALF-INNING against the line score
(`halfInningEndings` in [`runExpectancy.ts`](../src/wpbl/derive/runExpectancy.ts)) rather than
per game against the final score. The gap is in the top of the 7th and the line score says so,
so that one half-inning sits out and the other thirteen of a badly damaged game still count.
Fourteen blank rows carrying a pitch sequence were also being read as fourteen plate appearances
with nobody on and nobody out, in the most-populated cell on the board; a row that names no
batter is no longer a plate appearance.

**Both come back on their own if the feed fills them in.** The reconciliation runs in the
browser, over corrected plays, every time the board is opened: nothing is baked into a build, so
a re-ingest or a correction puts a half-inning back with no code change. Aug 15 is the proof.

**Aug 20 has NOT come back, and the damage is narrower than this entry first said.** Checked Sep 1
against the live feed, row by row across all 96 plays: the mirror is identical to it, so this is
what the league serves rather than something we lost. But only the tops of the **6th and 7th** are
ruined, 13 rows with no batter, no narrative and `outs` stuck at 0. The 5th's five batter-less rows
are ordinary substitution and baserunning events: they carry narratives ("Madison Willan scored."),
`outs` of 2, and 4 runs between them. Counting all 18 together overstates it. `event_type` on the
ruined rows is `unknown` rather than absent, which is the same value the feed uses for every
pickoff and substitution, so it cannot be used to tell the two apart.

### Aug 29, New York at LA (LA 10 in the box, 9 in the log). Found Sep 1, 2026.

A third one, and the cleanest yet: bottom of the 1st, two out, bases loaded, Caitlin Eynon
doubles down the left-field line for **2 RBI**. The row carries `runs_scored = 1`, and its
narrative ends:

> ... Sarah Edwards advanced to third; Jamie Mackay scored; Samaria Benitez Samaria Benitez.

The verb is missing from Benitez's clause, her name is printed twice in its place, and
`runs_scored` counts the "X scored" clauses (§4), so the feed counts one run where its own RBI
count says two. The next row's bases agree with the transcription and not with the
number: Benitez is gone from third.

RetroWPBL scores the same plate appearance `D7/L.3-H(RBI);2-H(RBI);1-3`. Two runners home, which
is the missing run, and it is a text-generation fault rather than a scoring judgement.

**Corrected on Sep 2, 2026**, and it is the first correction this project has written: two rows
in `wpbl_play_corrections` for `(game_id, sequence 10)`, one moving `runs_scored` from 1 to 2 and
one repairing the narrative's missing verb, both `source = 'external'`. With the overlay applied
the game reconciles exactly, LA reading 10 in the play log against 10 on the board.

The row was re-read against the live feed immediately before writing, five days after the game,
per the standing lesson above: Aug 15 fixed itself within the hour and a correction written
against the old reading would have survived the rewrite and doubled the run. This one had not
moved, and a duplicated name is a text-generation fault rather than a scoring judgement anyone
is going to revisit.

It does not quiet the validator, which reads `wpbl_game_plays` directly with no overlay, so the
finding stays in the baseline. That is the right behaviour: the mirror still carries the feed's
version, and the day the league fixes it at source is the day the finding should disappear on
its own.
