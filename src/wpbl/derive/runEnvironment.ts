// The season's run environment as one small record: the linear weights the Stats tab takes from
// the league's own run-expectancy table. Priced on a schedule by
// scripts/compute-wpbl-run-environment.ts and stored in `wpbl_run_environment`, so a reader no
// longer downloads and walks the whole play log for a dozen numbers. The migration says why.
//
// ONE DEFINITION FOR BOTH SIDES: the job prices with `priceRunEnvironment` and the browser decides
// whether to trust the stored copy with `runEnvironmentCurrent`, both counting finals the same
// way, which is the only thing keeping the two from drifting apart. No runtime imports beyond
// pure derive modules, so the job's esbuild bundle never reaches the supabase client or an asset.
import { countsInStandings } from '../season'
import { buildRunExpectancy, playRunValues, type RunValueGame } from './runExpectancy'
import { wobaWeights, fipWeights, type WobaWeights } from './linearWeights'
import type { FipWeights } from '../stats'
import type { WpblGame, WpblRunValuePlay } from '../types'

/** The play columns run expectancy reads. Shared with fetchWpblAllRunValuePlays in api.ts. */
export const RUN_VALUE_PLAY_SELECT =
  'game_id,sequence,inning,half,team_id,batter_id,batter_name,pitcher_id,pitcher_name,'
  + 'outs,first_base,second_base,third_base,event_type,runs_scored,narrative,pitch_sequence'

export interface WpblRunEnvironment {
  scope: 'regular'
  woba_weights: WobaWeights | null
  fip_weights: FipWeights | null
  /** Regular-season games final when this was priced: how a reader knows it is current. */
  final_games: number
  plays: number
  computed_at?: string
}

/** Regular-season games that are final, counted exactly as the job counts them. */
export function regularFinals(games: Pick<WpblGame, 'id' | 'status' | 'game_type' | 'counts_in_standings'>[]): number {
  return games.filter(g => g.status === 'final' && countsInStandings(g)).length
}

/** What the job stores: the same three calls StatsView made in the browser. */
export function priceRunEnvironment(plays: WpblRunValuePlay[], games: RunValueGame[]): WpblRunEnvironment {
  const values = playRunValues(plays, games, buildRunExpectancy(plays, games))
  return {
    scope: 'regular',
    woba_weights: wobaWeights(values),
    fip_weights: fipWeights(values),
    final_games: regularFinals(games),
    plays: plays.length,
  }
}

/** Whether a stored record describes the schedule the reader holds. Not while a game is live,
 *  whose plays the browser's own pricing would include and the stored record cannot. */
export function runEnvironmentCurrent(
  env: WpblRunEnvironment | null,
  games: Pick<WpblGame, 'id' | 'status' | 'game_type' | 'counts_in_standings'>[],
): boolean {
  if (!env || games.length === 0) return false
  if (games.some(g => g.status === 'live' && countsInStandings(g))) return false
  return env.final_games === regularFinals(games)
}
