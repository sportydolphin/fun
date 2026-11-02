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

/** Every `event_type` the importer writes on a row that ends a plate appearance (codes.ts, legacy.ts). */
const PA_EVENTS = new Set([
  'single', 'double', 'triple', 'home_run', 'walk', 'intent_walk', 'hit_by_pitch', 'catcher_interference',
  'strikeout', 'groundout', 'flyout', 'lineout', 'popup', 'foul_out', 'sacrifice', 'fielders_choice',
  'field_error', 'out',
])

export const WBSC_LEAGUE: League = {
  id: 'wbsc',
  // Seven, and the tie-break runner on second starts the eighth. Run expectancy already leaves
  // every inning past regulation out, which is exactly what keeps that free runner out of the
  // table: an eighth inning with a runner placed on second is not baseball the table describes.
  regulationInnings: 7,
  pitchCodes: WBSC_PITCH_CODES,
  // WPBL's bars (12 and 8 per game, floors 40 and 25, set at seven innings and 3.8 pitches per
  // plate appearance) scaled to the World Cup as measured on every event, Nov 2, 2026: 3.63
  // pitches per plate appearance over 2016 to 2026, and 6.0 innings per side per game, because the
  // run rule ends about half of them early. 6.0/7 x 3.63/3.8 = 0.82. The first measure, on the
  // 2026 groups alone, read 5.1 innings: Tainan ended all 15 early, and the bars came out 15% low.
  pitchBars: {
    pitcherPerGame: 10,
    batterPerGame: 7,
    pitcherFloor: 33,
    batterFloor: 20,
  },
  // WBSC's `runs` counts every run the play put on the board, the batter's included: a three-run
  // homer reads 3. Read as it stands, as MLB's is, and unlike WPBL's.
  runsOnPlay: p => p.runs_scored ?? 0,
  // By the event, not the pitch sequence: 2018 recorded no pitches and 2016 left them out of 440
  // plate appearances, and every one of those is still a trip to the plate.
  isPlateAppearance: p => PA_EVENTS.has(p.event_type ?? ''),
}
