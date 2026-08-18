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
| `homeRuns` | low | A home run with `is_scoring_play` not true. Label only; nothing downstream reads that flag for a total. |
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
- **`homeRuns` claimed a feed bug that was not one.** See below.

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
  self-consistent and the check was wrong. Only the `is_scoring_play` label survives as a
  finding.
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
outs add up, and both box lines look ordinary. Nothing in the current design will see it.

Closing that needs a second, independently produced transcription of the same game.
`github.com/exu6jh/RetroWPBL` is one: hand-written Retrosheet `.EVW` files with a batter id on
every plate appearance. **It carries no licence, so it is all rights reserved by default and
must not be ingested or republished.** Reading it to check our own rows is a different act from
redistributing it, but the clean move is to ask the author first.
