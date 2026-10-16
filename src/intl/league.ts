import type { League, PitchKind } from '../league/types'

// The WBSC Women's Baseball World Cup's rules, for the league-neutral engines in src/league/.
// Nothing renders from this yet: the data stays off the site until WBSC says yes (see
// docs/WBSC_INGEST.md). It is here so the importer's output is proven against the engines now,
// in a test, rather than discovered not to fit when the page is built.

/**
 * The importer's own alphabet (src/intl/wbsc/codes.ts writes it from WBSC's numeric codes), so
 * every letter here is one we chose and none is a guess about someone else's feed.
 */
export const WBSC_PITCH_CODES: Readonly<Record<string, PitchKind>> = {
  B: 'ball',
  C: 'called',
  S: 'swinging',
  F: 'foul',
  X: 'inplay',
  H: 'hbp',
}

export const WBSC_LEAGUE: League = {
  id: 'wbsc',
  // Seven, and the tie-break runner on second starts the eighth. Run expectancy already leaves
  // every inning past regulation out, which is exactly what keeps that free runner out of the
  // table: an eighth inning with a runner placed on second is not baseball the table describes.
  regulationInnings: 7,
  pitchCodes: WBSC_PITCH_CODES,
  // PROVISIONAL, from the 2026 group stage alone: 3.61 pitches per plate appearance, and 5.1
  // innings per side per game, because the run rule ended 24 of the 30 early. WPBL's bars (12 and
  // 8, set at seven innings and 3.8 pitches) scaled to that game length. Re-measure once the back
  // catalog is in, and before any board shows them.
  pitchBars: {
    pitcherPerGame: 9,
    batterPerGame: 6,
    pitcherFloor: 25,
    batterFloor: 15,
  },
  // WBSC's `runs` counts every run the play put on the board, the batter's included: a three-run
  // homer reads 3. Read as it stands, as MLB's is, and unlike WPBL's.
  runsOnPlay: p => p.runs_scored ?? 0,
}
