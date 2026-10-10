import type { League, PitchKind } from '../league/types'
import { REGULATION_INNINGS } from './innings'
import { runsOnPlay } from './derive/playByPlay'

// WPBL's rules, for the league-neutral engines in src/league/. Every number an engine needs that
// is a fact about this league rather than about baseball is here, and nowhere in an engine.

// ── The six codes ────────────────────────────────────────────────────────────────
// Verified against the whole league play log: B, K, P, F, S, H and nothing else. An
// unrecognised letter is counted separately rather than guessed at, so the day the feed adds
// a seventh (a pitchout or an intentional ball would be the obvious ones) it shows up as a
// number on the coverage line instead of quietly inflating "ball".
//
// THE EVIDENCE FOR THE TWO THE FEED MISLABELS, because both are load-bearing and neither can
// be checked against anything the league publishes. `pitch_events` carries the feed's own
// `type` for each pitch, and two of the six are wrong there; those two are 39% of every pitch
// thrown in the league, so trusting the labels would drop a called strike and a ball in play
// into an unclassified bucket and halve every rate on the pitch boards without erroring. `P`
// carries `{"code":"P","type":"pitchout","description":"Pitchout"}` on all 1,563 of them, which
// would make this a league where a fifth of every pitch thrown is a pitchout; it is the last
// pitch of 1,560 of the sequences that contain one and the plate appearance ends in a batted
// ball, which a real pitchout cannot do. `K` arrives as `"unknown"` and is the called strike: on
// 3-0 it is 49% of pitches while `S` is 1%, and on 2-2 swings are 68% of the strikes thrown.
// Nobody swings 3-0 and everybody swings 2-2, so the letter that vanishes at 3-0 is the swung one
// and the letter that does not is the taken one. This is the only test there is; keep it here.
//
// THIS IS THE ONE PLACE THE LETTERS ARE DEFINED. `countValue.ts` coarsens this table rather
// than restating it, which is what stops a correction to `K` landing in one module and not
// the other.
export const PITCH_CODES: Readonly<Record<string, PitchKind>> = {
  B: 'ball',      // taken outside the zone
  K: 'called',    // taken for a strike. The feed labels this one "unknown"
  S: 'swinging',  // swung through
  F: 'foul',      // swung, contacted, foul
  P: 'inplay',    // put in play; always the last pitch of the sequence. Labelled "pitchout"
  H: 'hbp',       // hit by pitch; also terminal
}

export const WPBL_LEAGUE: League = {
  id: 'wpbl',
  regulationInnings: REGULATION_INNINGS,
  pitchCodes: PITCH_CODES,
  // Set against the box-score qualifiers in stats.ts at the league's measured 3.8 pitches per
  // plate appearance, rather than invented. The batter figure is 2.0 AB per team game (8
  // pitches), a little under the 2.4 PA rate-title bar, so a hitter who qualifies there clears
  // this one too and the two Stats boards do not disagree about who is a regular. Floors keep an
  // early-season board from being one reliever.
  pitchBars: {
    pitcherPerGame: 12,   // 0.8 IP ≈ 3.2 batters faced ≈ 12 pitches
    batterPerGame: 8,     // 2.0 AB ≈ 8 pitches seen
    pitcherFloor: 40,
    batterFloor: 25,
  },
  // The feed's `runs_scored` leaves the batter out: a solo home run reads 0. See CLAUDE.md.
  runsOnPlay,
}
