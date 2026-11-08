# The live field

The animated diamond in Game Center, in both leagues: fielders, runners moving on each play, the
count and outs, pitch location, and a finished game you can step through. The plan and why it
comes now are in [ROADMAP-WPBL.md](../ROADMAP-WPBL.md), "From the Nov 1, 2026 brainstorm".

**What exists so far is the engine, with no drawing.** The drawing lands with the redesign
(ROADMAP-UI), so it is built once, in the new look. Nothing here is imported by the app yet.

## The pieces

| File | What it is |
|---|---|
| [`src/league/liveField.ts`](../src/league/liveField.ts) | The model (`FieldTimeline`, `FieldFrame`), `applyMoves`, and `checkTimeline`, the invariants every adapter must pass |
| [`src/mlb/liveField.ts`](../src/mlb/liveField.ts) | `buildMlbTimeline`: StatsAPI's `feed/live` as a timeline |
| [`scripts/record-mlb-feed.ts`](../scripts/record-mlb-feed.ts) | `npm run record-mlb-feed -- <gamePk>[:label] ... [--snapshots N]`: real games as trimmed, gzipped fixtures |
| [`src/mlb/__tests__/liveField.test.ts`](../src/mlb/__tests__/liveField.test.ts) | Every fixture through the invariants, against the feed's own after-the-play state, and mid-game snapshots against the final feed |

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

## Recording a game

Games from any finished season stay in the feed, and `?timecode=` replays it as it stood at any
moment, so fixtures need no live game. `--snapshots N` saves N mid-game copies as well. The trim
keeps only the fields `MlbLiveFeed` types: when the adapter reads a new field, add it to `trim`
and record the fixtures again.

## Left to build

1. `advance(previous, newerFeed)`: the timeline from a new poll, marking frames a review or a
   late-arriving move revised.
2. The WPBL adapter, from `wpbl_game_plays`, `live_state` and `wpbl_pitch_tracking`, run over
   every 2026 final.
3. A dev-only text view of a timeline, to read against the play-by-play.
4. The drawing, with the redesign.
