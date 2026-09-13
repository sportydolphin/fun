import type { MvpRace as MvpRaceData } from './derive/mvpRace'

// The standalone MVP race card was RETIRED on Sep 10, 2026 when the fan-awards ballot took its
// Home slot; the ballot still seeds its MVP and Pitcher shortlists from the same `race`, which
// is why this module survives as one predicate rather than a component. The card, its chart and
// its per-candidate rows are in git if it is ever brought back, along with the wpbl_mvp_shown /
// wpbl_mvp_player events (now retired in analytics.ts) that it carried.

/** Below this the race is noise: two curves off three data points is not a race, it is two line
 *  segments. The ballot hides the MVP shortlist rather than asserting a leader it cannot support. */
const MIN_DATES = 5

/** Whether there is a real two-horse race to draw or seed a shortlist from. A "race" where the
 *  leader has cost her team runs is not one; early in a season that is a real state, and the
 *  honest response is to say nothing rather than to crown somebody. */
export function mvpRaceIsWorthDrawing(race: MvpRaceData | null): race is MvpRaceData {
  return !!race
    && race.top.length === 2
    && race.dates.length >= MIN_DATES
    && race.top[0].total > 0
}
