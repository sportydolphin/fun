import type { League, PitchKind } from '../league/types'
import { MLB_QUALIFY_IP_PER_GAME, MLB_QUALIFY_PA_PER_GAME } from './qualify'

// MLB's rules, for the league-neutral engines in src/league/. Nothing reads this yet: the engines
// need every game line and play, and those arrive with the MLB mirror (ROADMAP item 6, steps 3
// and 4). It is written now so the mirror is built against a contract rather than a guess, and
// so the tests can run each engine at nine innings before anything depends on it.

/**
 * StatsAPI's pitch result codes (`playEvents[].details.code`), one letter each.
 *
 * THE MIRROR WRITES ONE CHARACTER PER PITCH. StatsAPI has a two-character code for a ball in the
 * dirt (`*B`), which the mirror stores as `B`; everything else here is already one letter.
 *
 * NOT YET CHECKED AGAINST OUR OWN DATA, because there is none: step 4 of the roadmap item is the
 * first time a season of these passes through `readSequence`, and the coverage line's unknown
 * count is what will show a letter missing from this table. The automatic balls and strikes of
 * the pitch clock are left out on purpose until that count shows how StatsAPI spells them.
 *
 * Note `P`: a pitchout here, a ball put in play in WPBL. That one letter is why the alphabet is a
 * league's and not an engine's.
 */
export const MLB_PITCH_CODES: Readonly<Record<string, PitchKind>> = {
  B: 'ball',      // ball (and `*B`, in the dirt)
  I: 'ball',      // intentional ball
  P: 'ball',      // pitchout
  C: 'called',    // called strike
  S: 'swinging',  // swinging strike
  W: 'swinging',  // swinging strike, blocked
  M: 'swinging',  // missed bunt
  Q: 'swinging',  // swinging pitchout
  // A foul tip is a strike at any count, so it is a swinging strike for both the whiff rate (as
  // Savant counts it) and the two-strike counter, where a foul would stop at two.
  T: 'swinging',
  F: 'foul',      // foul
  L: 'foul',      // foul bunt
  R: 'foul',      // foul pitchout
  X: 'inplay',    // in play, out(s)
  D: 'inplay',    // in play, no out
  E: 'inplay',    // in play, run(s)
  H: 'hbp',       // hit by pitch
}

/** League pitches per plate appearance, roughly, for setting the bars below. */
const PITCHES_PER_PA = 3.9

export const MLB_LEAGUE: League = {
  id: 'mlb',
  regulationInnings: 9,
  pitchCodes: MLB_PITCH_CODES,
  // The same shape as WPBL's bars, in MLB's units: a pitcher at 0.8 of the ERA title's innings,
  // a batter a little under the batting title's plate appearances, so a regular on the box-score
  // boards is a regular on these. About 4.3 batters faced per inning.
  pitchBars: {
    pitcherPerGame: Math.round(0.8 * MLB_QUALIFY_IP_PER_GAME * 4.3 * PITCHES_PER_PA),
    batterPerGame: Math.round((MLB_QUALIFY_PA_PER_GAME - 0.6) * PITCHES_PER_PA),
    pitcherFloor: 40,
    batterFloor: 25,
  },
  // The mirror stores every run the play scored, batter included, so the column is the answer.
  // WPBL's feed is the one that needs a correction here.
  runsOnPlay: p => p.runs_scored ?? 0,
}
