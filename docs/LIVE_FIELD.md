# The live field

The animated diamond in Game Center, in both leagues: fielders, runners moving on each play, the
count and outs, pitch location, and a finished game you can step through. The plan and why it
comes now are in [ROADMAP-WPBL.md](../ROADMAP-WPBL.md), "From the Nov 1, 2026 brainstorm".

**What exists so far is the engine, with no drawing.** The drawing lands with the redesign
(ROADMAP-UI), so it is built once, in the new look. Nothing here is imported by the app yet.

## The pieces

| File | What it is |
|---|---|
| [`src/league/liveField.ts`](../src/league/liveField.ts) | The model (`FieldTimeline`, `FieldFrame`), `applyMoves`, `checkTimeline` (the invariants every adapter must pass), and `advance` for live polling |
| [`src/mlb/liveField.ts`](../src/mlb/liveField.ts) | `buildMlbTimeline`: StatsAPI's `feed/live` as a timeline |
| [`src/wpbl/liveField.ts`](../src/wpbl/liveField.ts) | `buildWpblTimeline`: one game's `wpbl_game_plays` (corrections applied), batting and pitching lines, and the player list |
| [`scripts/record-mlb-feed.ts`](../scripts/record-mlb-feed.ts) | `npm run record-mlb-feed -- <gamePk>[:label] ... [--snapshots N]`: real games as trimmed, gzipped fixtures |
| [`scripts/show-field.ts`](../scripts/show-field.ts) | `npm run field -- mlb <gamePk>` or `npm run field -- wpbl <game id prefix>`: a timeline as text, one frame a line, to read against the play-by-play |
| [`src/mlb/__tests__/liveField.test.ts`](../src/mlb/__tests__/liveField.test.ts) | Every fixture through the invariants, against the feed's own after-the-play state; mid-game snapshots and polling against the final feed |
| [`src/wpbl/__tests__/liveField.test.ts`](../src/wpbl/__tests__/liveField.test.ts) | All 40 finals of 2026 through the invariants and the line score; each game cut at three points and read as live |

## The model

A timeline is one frame per moment a reader would see something happen: each pitch, pickoff,
runner move between pitches, the automatic runner, and each stoppage's substitutions. A frame
holds the whole field after that moment (inning, outs, count, score, batter, pitcher, the
runner on each base, the nine fielders), plus what changed: the pitch, the batted ball, and the
runner moves. The current state is the last frame; the replay is all of them.

Units are the field's: pitch location in feet from the middle of the plate and above the
ground, a batted ball in feet from home plate. Each adapter converts its feed's units, so the
drawing never sees StatsAPI's 250-pixel hit chart.

`capabilities` says what a league's feed can show. WPBL has no batted-ball location and pitch
location only on the rare TrackMan games, and the drawing leaves those out rather than guess.

## What the MLB feed does, learned from the 2026 season

- **Bases, outs and score are not in the feed per moment.** They are the runner movements
  applied in order. The feed's own after-the-play state (`matchup.postOnFirst`, the play's score
  and outs) is kept out of the frames so the tests can check the frames against it.
- **One runner's trip can be several entries**, split where the reason changes (the single, then
  the throw). They are merged into one move per runner per event.
- **The automatic runner is an action** (`runner_placed`, with `base`), not a runner movement.
- **A rearrangement is several substitution events in a row**, with a position empty between
  them. They become one frame.
- **A pinch runner swaps a name on a base** with no move. **A pinch hitter** needs nothing; the
  next frame's batter is the new one.
- **Who is in the field** comes from the box score's starters and every substitution in order;
  `linescore.defense` is only the current alignment.
- **The ABS challenge** (2026) is marked on the pitch (`reviewDetails`); the call and count are
  already the final ones.
- **A pitch arrives before what it caused.** Mid-game, strike three is in the feed seconds
  before the out is. The newest frame of an open plate appearance can be one step behind, and
  the next poll catches it up.

## What the WPBL feed does, learned from the 2026 finals

- **A row's bases and outs are the state before its play**, by runner name. The state after is
  the next row in the half, so a play's moves are the difference between the two. The narrative
  says what became of a runner who left the bases ("scored", "out at second"); where it is silent,
  the play's runs (`runsOnPlay`) and outs decide it, lead runner first, marked `inferred`. In 2026
  that left 6 guesses in about 2,800 moves, all in the half rebuilt from RetroWPBL on Aug 20.
- **The last row of a half has no "after"**, so its outs are three when the game goes on, and
  whatever the narrative says when nothing follows (a walk-off, the live game's newest row).
- **The event type does not say whether a row is a plate appearance.** A batter reaching on an
  error is filed as `unknown` with no sequence, a runner thrown out between pitches as `out`, and
  a balk mid at-bat carries the pitches so far. Whose name the narrative starts with decides it.
- **A row between pitches often says how far the count had got** ("Amira Hondras to 2b (1-2
  KFB)"), which places it among the plate appearance's pitches.
- **Names differ between the narrative and the roster** ("Benitez", "Benítez"; "Suzu Naraski"),
  so names are compared with accents folded, and a substitution's name may be two letters off a
  player in the game's box score.
- **A corrected row has its play back but not its snapshot**, which stays at nobody on, nobody
  out; it is never read as an "after".
- **The feed loses names**: "/  for Michelle Roche" is a substitution row with the incoming
  player missing. It is a stoppage with nothing to draw.
- **One hole the league left**: Sep 9 (`e385b272`) empties left field in the 6th and never fills
  it, and its box score disagrees with its play log about who moved. The test names it.

## Recording a game

Games from any finished season stay in the feed, and `?timecode=` replays it as it stood at any
moment, so fixtures need no live game. `--snapshots N` saves N mid-game copies as well. The trim
keeps only the fields `MlbLiveFeed` types: when the adapter reads a new field, add it to `trim`
and record the fixtures again.

## Live polling

`advance(previous, next)` compares a new poll's timeline with the last one: `firstChange` is
where the drawing animates from, and `revised` says a frame the reader already saw now shows a
different field (a review, or the out that follows strike three), so the drawing jumps rather
than animates. A whole game rebuilds in about a millisecond, so every poll rebuilds from the feed
instead of patching frames, which cannot drift from it.

## Left to build

1. The drawing, with the redesign, on MLB's spring training from late February.
2. Run against the 2027 WPBL feed when it wakes (`npm run rehearse` first), including
   `live_state` for the newest moment and TrackMan's pitch location where it is published.
