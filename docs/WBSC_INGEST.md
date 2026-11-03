# WBSC ingest: the World Cup, in files

Importing the WBSC Women's Baseball World Cup, the first step of
[ROADMAP-WOMENS-BASEBALL.md](../ROADMAP-WOMENS-BASEBALL.md). Planned Oct 16, 2026, and steps 1 to 4
of the build order built the same day. Everything here was measured on the 30 games of the 2026
group stage and one game each from 2016, 2018, 2023 and 2024.

## The gate: built now, published after permission

WBSC has been asked whether the site may show its data; there is no answer yet. **This repository
is public**, so committing WBSC's data to it is publishing it, the same as putting it on the site.
Until WBSC says yes:

- **Code and tests are committed.** The importer, the parser, the code tables, the validation. The
  test fixture is a synthetic game written by hand in WBSC's shape, never copied WBSC rows.
- **Data is not.** The raw cache (`.wbsc-cache/`) and the output (`archive/wbsc/`) are both
  gitignored and stay on the machine that ran the import. Nothing deploys them. The one exception
  is the owner's preview: `--upload` copies `international.json` into `wbsc_world_cup_lines`,
  which only the site owner can read (see "The owner's preview" below), and `npm run dev` serves
  the same file to this machine alone.
- **Permission flips one line**: `archive/wbsc/` comes out of `.gitignore`, and the first commit
  of it is the publication. The cache stays ignored for good. A "no" means deleting two local
  folders and keeping the code for a different source.

## The source

Each game page on wbsc.org is an Inertia app: the whole game rides in the page as JSON (the
`data-page` attribute). Asked with the headers `X-Inertia: true` and `X-Inertia-Version: <the
page's version>`, the same URL returns the JSON alone (about 860 KB rather than 1.5 MB of HTML).
The version changes with every WBSC deploy and a stale one gets a 409, so the importer reads the
version from the schedule page's HTML each run and falls back to parsing a game's HTML if the JSON
request fails. `robots.txt` allows everything.

Two pages per event:

- `/en/events/<event-key>/schedule-and-results`: every game in `props.games`, with ids, teams (IOC
  codes), scores, start time and timezone, status.
- `/en/events/<event-key>/schedule-and-results/box-score/<game-id>`: `props.viewData.original`
  holds `gameData` (line score to 15 innings, attendance, duration, venue, umpires),
  `boxScore` (per team, per batting spot: batting, pitching and fielding in one row), and
  `gamePlays.all` (the play log, by inning and half).

| Event | Key | Games | Play log |
|---|---|---|---|
| 2016 World Cup | `2016-womens-baseball-world-cup` | 44 | Pitch by pitch, written as prose (`legacy`, see below) |
| 2018 World Cup | `2018-womens-baseball-world-cup` | 50 | Plate appearances only, no pitches |
| 2023 groups A, B | `2023-ix-womens-baseball-world-cup-group-a`, `-group-b` | 15 + 15 | Pitch by pitch |
| 2024 Finals | `2024-ix-womens-baseball-world-cup-finals` | 17 | Pitch by pitch |
| 2026 groups | `2026-x-womens-baseball-world-cup-group-stage-rockford`, `-tainan` | 15 + 15 | Pitch by pitch |
| 2027 Finals | not published yet | about 17 | Expected pitch by pitch |

The continental championships (Pan Am, Asian Cup, Europe) are probably the same system; their
keys were not found and they are out of scope for the first build.

## What a play row holds

One row per event in the game: a pitch, a pickoff attempt, a substitution, a stolen base. The
fields that matter:

- **Who and when**: `inning`, the half (the `top` or **`bot`** array it sits in), `playorder`,
  `batterid`, `pitcherid`, `lineupslot`, and the count and outs **before** the row (`balls`,
  `strikes`, `outs`).
- **The pitch**: `result1` (2 ball, 4 called strike, 5 swinging strike, 6 foul, 9 in play, 3 hit
  by pitch, 1 intentional walk), plus `pitchheight` and `pitchoutside`, a location in the zone.
  `pitch_pitches` is 1 on a pitch thrown and 0 on a penalty ball awarded for a clock violation.
- **The outcome**, on the row that ends a plate appearance (`pa` is 1): `result2` (below),
  `runs`, and `narrative`, the scorer's sentence, which carries the scorer's notation (`F9`,
  `FP3`, `SF9`). `result3` looks like that notation and is not (see below).
- **The bases**: `runner1`, `runner2`, `runner3` before the row and `runner1after` (and so on)
  after it, each holding a **lineup slot code**, never a player id: 1000 for the visitors or 2000
  for the home side, plus ten times the batting spot, plus the substitution count (2061 is the
  home side's sixth spot, first substitute). `runnerNtoM` is why a runner moved (34 stolen base,
  31 wild pitch, 32 passed ball, 33 balk, 51 an error on a throw), `runnerNout` who put one out.
- **The batted ball**: `hitdistance`, `hitpull`, `hitlaunch`, `hittype`. Scorer-estimated, not
  radar; sparse, and never to be presented as TrackMan. Not imported.

`runs` **includes the batter**: a three-run homer reads 3. So unlike the WPBL feed, this one needs
no `runsOnPlay` correction; the binding still goes through `League.runsOnPlay` so no engine reads
the column directly.

### `result2`, the plate-appearance outcome

Seen in the 2026 group stage, with the `event_type` each maps to (the WPBL vocabulary the neutral
engines read), in [`src/intl/wbsc/codes.ts`](../src/intl/wbsc/codes.ts):

| Code | Meaning | `event_type` |
|---|---|---|
| 1, 2 | Strikeout looking, swinging | `strikeout` |
| 3 | Ground out | `groundout` |
| 4 | Every air out; the kind is the narrative's notation: F, FF/FP/FL (foul), P, L, SF | `flyout`, `foul_out`, `popup`, `lineout`, `sacrifice` |
| 5 | Grounded into a double play (WPBL files these under the batter's result too) | `groundout` |
| 11 | Fielder's choice | `fielders_choice` |
| 12 | Reached on error | `field_error` |
| 13 | Walk | `walk` |
| 14 | Intentional walk (no pitches, so kept apart from `walk`) | `intent_walk` |
| 15 | Hit by pitch | `hit_by_pitch` |
| 16 | Catcher's interference | `catcher_interference` |
| 18, 19, 20, 21 | Single, double, triple, home run | `single`, `double`, `triple`, `home_run` |
| 28 | The tie-break runner placed on second | none: not a plate appearance |
| 102, 108 | Out by rule (two-strike bunt foul, dropped infield fly) | `out` |

The table is a closed list in code. **A code not in it fails the import** for that game, with the
row printed, rather than becoming `unknown` and quietly skewing a board. The rarer outs will turn
up in the back catalog and get added one by one, each checked against its narrative.

## What the first run found

Built against the fixture, then run on the 30 real games, the importer failed all 30. Each failure
was the source being other than it looked, and each is now handled and tested:

- **The second half is keyed `bot`**, not `bottom`. Every home side's play log read as empty.
- **A player can have two box rows.** A fielder who moves to the mound costs the side its DH, and
  WBSC files the player under both the batting spot and 90, every count split between them.
  Eleven times in 30 games. The player's line is the sum (`playerLines`).
- **`result3` is not the notation.** It reads `F2` on a foul fly the narrative scores `FF2`, and
  `F3` on a pop-up scored `P3`. Trusting it filed all 340 air outs as fly outs, 131 wrongly. The
  kind of air out comes from the narrative (`airOut`).
- **One stale batter id.** In game 201087 a substitute's plate appearance carries the replaced
  player's batter id, while its lineup slot and narrative both name the substitute. The slot wins
  only when the narrative agrees, and the importer prints a note when it does (`batterOnRow`).
- **Catcher's interference** (`result2` 16) was not in the first table.

All 30 now pass every check. The output feeds the neutral engines unchanged: run over the real
files, best games put Ashton Lansdell (the group's MVP) first in total bases, run expectancy
measures 302 half-innings, and the pitch boards read 6,252 pitches with no unknown letter.

## The pipeline

[`scripts/import-wbsc.ts`](../scripts/import-wbsc.ts), run by hand, with the parsing in
[`src/intl/wbsc/`](../src/intl/wbsc/) so the tests cover it:

```bash
npm run wbsc -- 2026-x-womens-baseball-world-cup-group-stage-rockford
```

`--all` imports every event in its list, `--list` prints them, `--refresh` refetches cached games,
`--offline` reads the cache only, and `--check` compares with the files on disk and writes nothing.
Five stages per event:

1. **List.** Read the event's schedule page. Keep the game ids, and skip forfeits and
   postponements: the 2024 USA–Venezuela forfeit is a 7–0 with an empty status and no box.
2. **Fetch.** One request per game, 1.5 s apart, with a user agent naming the site. The game's
   data goes into the raw cache (`.wbsc-cache/<event>/<game>.json.gz`). A game in the cache is
   never fetched again unless `--refresh` says so. The whole back catalog is under 200 requests,
   once.
3. **Validate** (`validateGame`). Any failure stops that game with a report, and the event is not
   written at all:
   - The status is final.
   - The line score sums to the final; each team's box runs and hits equal it.
   - The play log's runs equal the line score inning by inning, and the final in total.
   - The play log's plate appearances, by batter, equal the box score's `pa`, with the batter
     taken from the lineup slot as above.
   - Every `result1`, `result2` and baserunning reason is in the code tables.
   - Every pitcher's `pitch_ip` parses as innings notation (`4.2` is 14 outs, never 4.67).
4. **Transform** (`transformGame`) into the neutral shapes in
   [`src/league/types.ts`](../src/league/types.ts), so the engines that already run on WPBL and MLB
   run on this unchanged:
   - Games become `LeagueGame` (with venue, attendance, duration, innings played), the line score
     holding only the halves that were played.
   - Box rows become `BattingGameLine`, `PitchingGameLine` (innings as outs) and
     `FieldingGameLine`, from each player's merged line.
   - Pitch rows fold into one `RunValuePlay` per plate appearance: the base-out state before it,
     with each runner named through the lineup slot, the `event_type` from the table, and
     `pitch_sequence` in our own alphabet (B, C, S, F, X, H), null for a game scored without
     pitches. Stolen bases, wild pitches, passed balls, balks, pickoffs, caught stealing and
     advances on errors between pitches become their own rows, as in the WPBL log.
   - Players become one row per tournament: the WBSC id, the name as WBSC writes it in
     `full_name` (surname out of capitals, given names whole: "Kelsie Ann-Gamboa Whitmore"), the
     name the site shows in `name` (no middle names: "Kelsie Whitmore"; `displayName` in
     `game.ts` keeps a two-word Taiwanese, Korean or Chinese given name whole), the IOC code, the
     uniform. The play log carries `name`. The crosswalk and the same-person rules match on
     `full_name`, since a middle name is sometimes the one a player goes by (Esthela).
   - **Ids are namespaced strings**: `wbsc:g:201054` for a game, `wbsc:p:2826:764325` for a player
     in a tournament (WBSC's player ids restart every event: Kelsie Whitmore is 23026 in 2018,
     310867 in 2023, 764325 in 2026). Teams are their IOC codes, which do persist.
5. **Write** one folder per event, `archive/wbsc/<event-key>/`, in the WPBL archive's format: one
   JSON file per table (games, players, batting, pitching and fielding lines, plays), rows with
   sorted keys, and a `manifest.json` with counts and digests.

## The crosswalk

The link from a WBSC player to a WPBL player is the whole point and the riskiest data: a wrong link
puts someone else's World Cup on a player's page. So names are matched once, to build a list a
person reviews, and never at read time. The logic is
[`src/intl/wbsc/crosswalk.ts`](../src/intl/wbsc/crosswalk.ts); both files below sit in
`archive/wbsc/` and are gitignored with the rest, since a link names a WBSC player.

```bash
npm run wbsc -- --propose
```

reads every imported event's players and the WPBL roster (`archive/wpbl/wpbl_players.json`) and
writes `archive/wbsc/crosswalk-review.json`: every plausible pair not already linked or ruled
out, with the national team beside the roster's hometown so there is a second fact to check. It
refuses to overwrite a review that holds decisions not yet confirmed. Each candidate is one of:

- **by name**: every word of the roster's name appears in WBSC's, given name first. WBSC writes
  every given name and both surnames, so "Kelsie Whitmore" is "Kelsie Ann-Gamboa Whitmore" and
  "Diana Ibarra" is "Diana Ibarra Muñoz".
- **by surname and initial**: the surname matches and the given names share only a first letter.
  That catches the nicknames the roster uses ("Allie" for Allison, "Jill" for Jillian, "Rosi" for
  Rosa Maria Del Castillo Alarcon), and also strangers who share a surname, which is why a person
  decides.
- **ambiguous**, on top of either: the same player has another candidate in the same event, so at
  most one is right.

To review:

```bash
npm run wbsc -- --review
```

It opens a page on `127.0.0.1` ([`scripts/wbsc-review.ts`](../scripts/wbsc-review.ts)), built from
the local files only, that groups the candidates by how hard to look: **Conflicts** (another
candidate claims the same player), **Check** (an initial-only match, or a national team that
differs from the hometown), then **Full name, same country**. Each row puts what the player did at
the event (games, PA, IP, positions, a link to a box score) beside the roster's position, bats and
throws, age at the event, hometown and player page ([`src/intl/wbsc/review.ts`](../src/intl/wbsc/review.ts)).
None of these facts decides: a Phoenix native plays for Mexico. They make a wrong pair look wrong.
Every click is written to the review file at once, so the tab can be closed and the review picked
up later; Confirm runs `--confirm`. The file can still be edited by hand (`checked_by`, and each
`decision` `yes`, `no` or empty), then:

```bash
npm run wbsc -- --confirm
```

A yes becomes a link in `archive/wbsc/crosswalk.json` (both ids, the name as each side writes it,
who checked it and when); a no becomes a rejection there, so the pair is never proposed again;
the undecided stay in the review file. All or nothing: no reviewer named, a decision that is not
yes or no, a player missing from either side, or a second link for one player, and nothing moves.

A player in several events is several links, one per event, because WBSC's ids are per
tournament. Their international career is the links that share a WPBL id.

**The 2026 group stage proposes 39**: 32 by name, 7 by surname and initial, 3 of them ambiguous.
Of the seven, four look like the roster's nicknames (Bebbere, Schroder, Albayati, del Castillo)
and three like Korean players who only share a surname with a WPBL player (two against Jaida Lee
of Newfoundland, one against Minseo Park). The reviewer decides each. One more WBSC spelling turned up here: an
O'Sullivan written "O ` SULLIVAN", a backtick between spaces, which every apostrophe variant now
folds to (`APOSTROPHE` in game.ts).

What the player page will read is one derived file, `archive/wbsc/international.json`, keyed by
WPBL player id: per event, the national team, the WBSC name the link matched, the batting and
pitching totals (counts only; the page computes the rates) and the games behind them with their
wbsc.org box scores. It is built from the confirmed crosswalk alone, never the review file:

```bash
npm run wbsc -- --international
```

All or nothing again ([`international.ts`](../src/intl/wbsc/international.ts)): a link to an event not
imported, a WBSC player not in that event, someone off the WPBL roster, or two WBSC players for one
WPBL player in one event, and nothing is written. A linked player on an event's roster who played
no game in it gets no row and a line in the run log. Run it again after every `--confirm`.

**The owner's preview.** `npm run wbsc -- --upload` puts the file into `wbsc_world_cup_lines`,
which RLS lets only the site owner read, replacing the whole table in one transaction. The WPBL
player page draws a World Cup section from it for the owner, signed in, and for nobody else
([`player/WorldCup.tsx`](../src/wpbl/player/WorldCup.tsx)). Under `npm run dev` there is no owner
session to read it with, so the dev menu's **Owner view** draws the owner UI and the section reads
`international.json` from the dev server instead ([`vite-plugin-wbsc-dev.mjs`](../scripts/vite-plugin-wbsc-dev.mjs),
serve only and loopback only). So after every `--confirm`:

```bash
npm run wbsc -- --international
npm run wbsc -- --upload
npm run wbsc -- --people
```

As confirmed on Nov 2, 2026: 121 links, 52 WPBL players, 121 event rows.

**`people.json`** ([`src/intl/people.ts`](../src/intl/people.ts)) is stage 1's registry: one person per
WPBL player, with every World Cup the crosswalk joins to them, and every World Cup player nobody has
linked as a person of their own. Ids are anchored (`person:wpbl:<id>`, else
`person:wbsc:<earliest tournament id>`), so a later link renumbers nobody. Nothing in it matches
names: on Nov 2, 2026 it holds 1,049 people, 931 of them World Cup rows with no WPBL link, and at
least 165 of those are one person playing several World Cups under the same name and flag, still
separate until a review joins them (stage 2).

**The same player across World Cups** ([`samePerson.ts`](../src/intl/wbsc/samePerson.ts)) is that
review, and it asks only what the crosswalk review's answers do not already settle. Both sides are
WBSC's own official names, which is what makes rules safe here where the crosswalk needed a person.
Yes when the full name, or one with a middle name added, a hyphen for a space, a common nickname, a
second given name gone by, or a long name one letter off, is for the same country with no rival in
either event. No when the given names are simply two names ("Jia Lee", "Ji Eun Lee"), when one side
was already ruled out as the other's WPBL player, or when the two people played the same World Cup.
Initials, a name cut short, a short name one letter off, a close name and half of a hyphenated name
go to the reviewer, one question per pair of people. Every decision, the rules' and the reviewer's,
is in `archive/wbsc/same-person.json` with what made it, so nothing is asked twice:

```bash
npm run wbsc -- --same
npm run wbsc -- --confirm-same
npm run wbsc -- --people
```

On Nov 2, 2026: 478 by rule, 6 asked (5 yes, 1 no), and 751 people.

## The league binding

[`src/intl/league.ts`](../src/intl/league.ts), a third `League` beside `src/wpbl/league.ts` and
`src/mlb/league.ts` (`League.id` gained `'wbsc'`):

- `regulationInnings: 7`. Run expectancy already leaves every inning past regulation out, which is
  what keeps the tie-break runner on second (from the eighth) out of the table.
- `pitchCodes`: the alphabet above.
- `runsOnPlay`: reads `runs` as it is.
- `pitchBars`: WPBL's scaled by the whole catalog (Nov 2, 2026): 3.63 pitches per plate
  appearance and 6.0 innings per side per game. The first measure, on the 2026 groups alone, read
  5.1 innings (Tainan ended all 15 games early) and set them 15% low.
- `isPlateAppearance`: by the event, not the pitch sequence. The engines read a sequence as the
  mark of a plate appearance, which is right for WPBL and MLB, and measured nothing at all of 2018
  (no pitches recorded) and missed 440 plate appearances of 2016. Now a `League` function.

## Storage

Nothing goes into Supabase but the owner-only preview table (`wbsc_world_cup_lines`, one row per
linked WPBL player, about 280 KB). Measured on the 2026 group stage: about 800 KB of cached game data
(gzipped, never committed) and 1.5 MB of output for 30 games, 1.3 MB of it the play log. The full
catalog, about 190 games, is estimated at 8 to 10 MB of output. A size budget in CI should fail the
build if an event's folder grows past what its game count explains, so a WBSC field that starts
riding along is caught rather than deployed; it belongs with publication, when the folder first
enters git.

## Build order

1. ✅ **The code table and the parser**, with a synthetic fixture (Oct 16, 2026).
2. ✅ **List, fetch and validate** for the 2026 group stage. All 30 games pass.
3. ✅ **Transform and write**, with the neutral engines (bests, the finder, run expectancy, the
   pitch boards) run on the output in a test.
4. ✅ **The crosswalk proposal** (Oct 16, 2026). The hand check is the reviewer's, and the one
   step here a script cannot do; `--review` (Nov 2, 2026) is the page for it.
5. ✅ **The back catalog** (Nov 2, 2026): all seven events, 170 games, 11,440 plays, 134
   candidates to review. What it took:
   - **Eight codes** the 2026 games never used, each read against the narrative and tested: the
     batter reaching on a third strike (`result2` 25, 26, 27, still a strikeout), three more outs
     by rule (101, 103, 104), errors on a pickoff (`runnerNtoM` 52, 53), and a runner thrown out
     after a wild pitch with no steal or pickoff in the notation (`other_out`).
   - **Three codes read wrong before**, found by the box-score checks below: a two-strike foul
     bunt (102) is a strikeout, as every box counts it, not a plain out; "reaches on strikeout
     fielders choice" (11) is a strikeout; and a groundout the narrative calls a "Sacrifice" (3) is
     `sacrifice`, as WPBL and 2016 file one.
   - **Two more checks on every game**: each side's batting against what the other side's pitchers
     allowed (plate appearances against batters faced, runs, hits, strikeouts, walks), and each
     batter's hits, home runs, strikeouts, walks and hit by pitches in the play log against the box
     score. They found the three codes above, two of the 2016 box quirks below, and two more
     2018 errors at the source.
   - **2018 writes a final with its innings** ("F/5", "F/10"). Read as anything but `F`, 48 of 50
     games were skipped as unplayed and the event was written with two (`isFinal`).
   - **2016 is WBSC's older system** (`legacy` on the event), and its box score differs three ways.
     Its pitchers' row (spot 90) beside a batting row is a whole copy of it, pitching included,
     which summed doubled five teams' runs and every two-way pitcher's line; it adds nothing. A
     pitcher with no batting row who batted did so from that row, and those four lines are kept
     (spot 90). A half the home side never batted is `-1` in the line score, which summed took a
     run off every home win. And it counts an intentional walk twice in PA, so that is taken back
     (two batters).
   - **2016's play log is prose**, read by [`legacy.ts`](../src/intl/wbsc/legacy.ts): all 44 games,
     2,977 plays, with base-out state and, on 2,537 plate appearances, the pitches. See below.
   - **Eight games are wrong at the source** and written as WBSC published them, each problem
     quoted exactly in `ACCEPTED` in the importer and recorded in the event's manifest. In 2016, a
     batter (O'Sullivan, Australia) bats in three games' play logs and is in none of their box
     scores; the plays keep the runner under the prose's name with no id, and that batter's line
     is exactly what each of those box scores is short. In 2018, three play logs credit a plate
     appearance to the wrong batter (one to a pinch hitter WBSC gave no player id, whose line is
     dropped), one has a single the box score lacks, and one box files a strikeout under the wrong
     batter. Anything else wrong in those games still fails the event.
   - **The proposer missed five people** who had played a World Cup under a name it did not
     try: two nicknames (Liz, Beth for Elizabeth), two who go by a middle name (Niki for Cody
     Nicole, Esthela for Liliana Esthela) and one surname WBSC spells a letter off. It now proposes
     those three kinds too (`MatchKind`); the search that found them turned up no other near miss.
   - The 2024 Finals hold one unplayed game (USA @ VEN), skipped as before.
6. ✅ **`international.json`** for the player page (Nov 2, 2026): `--international`, above. Built
   and tested; it stays gitignored.
7. ✅ **The owner's preview** (Nov 2, 2026): `--upload` into the owner-only table, and the World Cup
   section on WPBL player pages for the owner alone.
8. ✅ **The person registry** (Nov 2, 2026): `people.json`, `--people`.
9. ✅ **The same player across World Cups** (Nov 2, 2026): `--same` and `--confirm-same`, 478 pairs
   by rule and 6 by the owner.
10. ✅ **Names without middle names** (Nov 2, 2026): `name` is what the site shows, `full_name` what
    WBSC registered (step 4 above).
11. ✅ **Editions and the pages' files** (Nov 2, 2026): `--site` writes `archive/wbsc/site/`, one
    index and one file per edition ([`editions.ts`](../src/intl/wbsc/editions.ts): which events make
    an edition, groups, records, medals, every result linked to its box score; leaders and the WPBL
    players in the field from [`editionLeaders.ts`](../src/intl/wbsc/editionLeaders.ts), summed per
    person through `people.json`, so run `--people` first). Results and records
    only, no scorer sentences: these files are what publication will commit. 2016 and 2018 carry no
    group labels, so their opening-round groups are split by who played whom and lettered from
    `groupLetters` in `EDITIONS`, copied from WBSC's standings pages (game order got both wrong). The
    standings are WBSC's: a later round carries over the earlier games between two of its teams, ties
    go by head to head and then Team Quality Balance, and a forfeit the importer skips is counted from
    `forfeits` (2024's USA over Venezuela). Every table matched wbsc.org on Nov 2, 2026. `/world-cup` and `/world-cup/<year>` read
    them under `npm run dev` only (`WORLD_CUP_ROUTES` in App.tsx), and the build fails if the page
    reaches a production bundle (`vite-plugin-no-dev-code.mjs`).
12. ✅ **Game pages** (Nov 2, 2026): `--site` also writes `world-cup-game-<wbsc id>.json` per game
    ([`gameFile.ts`](../src/intl/wbsc/gameFile.ts)): the line score, the box score with pitchers in
    the order they pitched, and the play by play in our own words
    ([`playText.ts`](../src/intl/wbsc/playText.ts)), never the scorer's sentence. A runner is named
    only when the bases before and after the play say who; on all 11,440 plays, 1% fall back to a
    count ("1 run scored") and 0.2% to the event alone ("Caught stealing"). `/world-cup/<year>/games/<id>`,
    dev only like the rest.
13. ✅ **Player pages, and WPBL's pieces** (Nov 2, 2026): `--site` writes `world-cup-player-<slug>.json`
    for each of the 633 people who played a World Cup and have no WPBL page
    ([`personFile.ts`](../src/intl/wbsc/personFile.ts)); a WPBL player's World Cups stay on their WPBL
    page, and every link to them goes there. Every name on every World Cup page is a link, and one
    name per person (the roster's or the registry's), in the play text too. The pages are drawn with
    WPBL's league-neutral pieces in `src/ui` (the leader cards, the game center's box score and play
    by play, the player card's career tables), and the career tables are one component on both
    sections ([`WorldCupCareer.tsx`](../src/intl/WorldCupCareer.tsx)). A team's flag stands where a
    club's logo would ([`flags.ts`](../src/intl/flags.ts), from `flag-icons`, MIT); Chinese Taipei
    shows its code, since it plays under an Olympic flag no flag set carries. The names the display
    rule gets wrong are set by hand in [`nameFixes.ts`](../src/intl/wbsc/nameFixes.ts), by team and
    registered name; re-import with `--offline` after adding one, then `--people` and `--site`.
14. ✅ **Search** (Nov 2, 2026): `--site` also writes `world-cup-people.json`, every World Cup-only
    player cut to the search row, and the WPBL search lists them after its own rows, with the
    editions for "world cup" or "wbsc" ([`worldCupSearch.ts`](../src/intl/worldCupSearch.ts)). A year
    typed beside a name narrows to that edition. A WPBL player is found as a WPBL player only, since
    that is their one page. Dev only, like the pages: the production build fails if the rows ship.

## The 2016 play log

2016 was scored in WBSC's older system, which stored the scorer's sentence for each play and almost
none of the codes the later years carry:

```
GORTAREZ walked (3-1 SBBBB); GOMEZ advanced to second.
UNDERWOOD stole third, scored on a throwing error by c, unearned.
```

One clause per player, split on `;`; a name in capitals (with a given-name prefix when two share a
surname: "WEN Ya T" beside "WEN Ya Z"); then phrases split on `, `, each a batter's result, a move,
or a tag that moves nobody. The pitches are the letters in parentheses, in the scorer's alphabet,
where **K is a called strike** and S a swinging one. Every phrase is in a closed list, as every code
is in the later years, and an unknown one fails the game.

**Checked four ways, none of them the prose.** The runners are carried by name, and the result must
agree with: the outs WBSC stored before every row; each half's runs against the line score; each
team's runners left on base against the box score's LOB; and every batter's PA, hits by kind,
walks, strikeouts and hit by pitches against the box score. Two fields are deliberately NOT used:
the row's `runs` (0 on plays that scored two) and its "bases after" flags, which record the full
state for the visitors, only the players the row names for the home side, and keep a runner on
base after a pickoff. They match the prose on 98% of rows, and no rule makes the rest agree.

The name, not `batterid`, says who batted: some 2016 rows carry a batter id that is nobody in the
box score. Two runner advances have no reason in the prose and are written `other_advance`.

## Open questions

- What the **2027 Finals** need: results within the hour means a scheduled re-run of stages 1 to 5
  during event week only. Decide by April 2027 (see the roadmap).
