# WBSC ingest: the World Cup, in files

Importing the WBSC Women's Baseball World Cup, the first step of
[ROADMAP-WOMENS-BASEBALL.md](../ROADMAP-WOMENS-BASEBALL.md). Planned Oct 16, 2026, and steps 1 to 3
of the build order built the same day. Everything here was measured on the 30 games of the 2026
group stage and one game each from 2016, 2018, 2023 and 2024.

## The gate: built now, published after permission

WBSC has been asked whether the site may show its data; there is no answer yet. **This repository
is public**, so committing WBSC's data to it is publishing it, the same as putting it on the site.
Until WBSC says yes:

- **Code and tests are committed.** The importer, the parser, the code tables, the validation. The
  test fixture is a synthetic game written by hand in WBSC's shape, never copied WBSC rows.
- **Data is not.** The raw cache (`.wbsc-cache/`) and the output (`archive/wbsc/`) are both
  gitignored and stay on the machine that ran the import. Nothing reads them at runtime and
  nothing deploys them.
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
| 2016 World Cup | `2016-womens-baseball-world-cup` | 44 | Plate appearances only, no pitches |
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
   - Players become one row per tournament: the WBSC id, the name as WBSC writes it (surname out
     of capitals, given names whole: "Kelsie Ann-Gamboa Whitmore"), the IOC code, the uniform.
   - **Ids are namespaced strings**: `wbsc:g:201054` for a game, `wbsc:p:2826:764325` for a player
     in a tournament (WBSC's player ids restart every event: Kelsie Whitmore is 23026 in 2018,
     310867 in 2023, 764325 in 2026). Teams are their IOC codes, which do persist.
5. **Write** one folder per event, `archive/wbsc/<event-key>/`, in the WPBL archive's format: one
   JSON file per table (games, players, batting, pitching and fielding lines, plays), rows with
   sorted keys, and a `manifest.json` with counts and digests.

## The crosswalk

The link from a WBSC player to a WPBL player is the whole point and the riskiest data, so it is
never computed at read time. Not built yet (step 4 below).

- `archive/wbsc/crosswalk.json`: one row per WBSC tournament player who is also a WPBL player:
  the namespaced WBSC id, the WPBL player id, the name as each side writes it, who checked it and
  when.
- `npm run wbsc -- --propose` writes candidates to a review file by name (first name, last name,
  accents folded), the way the Commons photos land unapproved. A person confirms each one, and
  only confirmed rows reach the crosswalk. The 2026 group stage proposes 32. WBSC's given names
  include middle names, so the WPBL's "Rosi del Castillo" is WBSC's "Rosa Maria Del Castillo
  Alarcon": exactly the case a person has to confirm.
- A player in several events is several rows, one per event. Their international career is the
  rows that share a WPBL id.

What the player page will eventually read is one derived file, `international.json`, keyed by
WPBL player id: each event's batting and pitching totals and the games behind them. Small, and the
only file the WPBL section ever needs.

## The league binding

[`src/intl/league.ts`](../src/intl/league.ts), a third `League` beside `src/wpbl/league.ts` and
`src/mlb/league.ts` (`League.id` gained `'wbsc'`):

- `regulationInnings: 7`. Run expectancy already leaves every inning past regulation out, which is
  what keeps the tie-break runner on second (from the eighth) out of the table.
- `pitchCodes`: the alphabet above.
- `runsOnPlay`: reads `runs` as it is.
- `pitchBars`: **provisional**, from the 2026 groups alone: 3.61 pitches per plate appearance and
  5.1 innings per side per game, because the run rule ended 24 of the 30 early. Re-measure once
  the back catalog is in, before any board shows them.

## Storage

Nothing goes into Supabase. Measured on the 2026 group stage: about 800 KB of cached game data
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
4. **The crosswalk proposal** and the hand check of the 32.
5. **The back catalog**: 2024 and 2023 (pitch by pitch), then 2018 and 2016 (plate appearances
   only: no `pitch_sequence`, so the pitch boards skip them). Expect new codes in the validation.
6. **`international.json`** for the player page, which stays unbuilt until permission.

## Open questions

- Whether **2016 and 2018** carry runner movement on their plate-appearance rows.
- What the **2027 Finals** need: results within the hour means a scheduled re-run of stages 1 to 5
  during event week only. Decide by April 2027 (see the roadmap).
