// Split out of StatsView.tsx so WpblApp can call it without importing the tab: the tab is its own
// chunk, loaded when it is first shown (WpblApp's lazy tabs), and these reads must not wait for it.
import {
  fetchWpblAllPlayers, fetchWpblAllLines, fetchWpblTrackedGameCount, fetchWpblAllRunValuePlays,
  fetchWpblRunEnvironment, fetchWpblAllFielding, fetchWpblSchedule, fetchWpblPlayerSeasons,
} from '../api'
import { currentSeason } from '../season'

/** Every read the Stats tab makes on mounting, started early. The tab cannot mount until the
 *  section's teams and schedule are in (WpblApp's `loading`), and none of these reads needs either
 *  of them to FETCH, only to aggregate, so a reader landing on /wpbl/stats waited one whole Supabase
 *  round trip (about 650ms) before the slowest reads on the site had even started. Each fetcher
 *  shares an in-flight request (`once` in api/core.ts), so the tab's own effects pick these up rather
 *  than asking twice. Failures are the tab's to handle when it asks; here they are dropped. */
export function warmStatsReads(picked: number | null): void {
  const drop = () => { /* the tab's own read reports it */ }
  fetchWpblAllPlayers().catch(drop)
  fetchWpblAllFielding().catch(drop)
  fetchWpblTrackedGameCount().catch(drop)
  // The year's stored seasons first (derive/playerSeasons.ts), which is all the boards the tab
  // opens on need when they are current: the box-score lines and the play log, the two heaviest
  // reads in the section, are started only when they are not. Both wait for the schedule (already
  // in flight for the section) to say which year that is when the address does not.
  fetchWpblSchedule()
    .then(async games => {
      const year = picked ?? currentSeason(games)
      if (year != null && (await fetchWpblPlayerSeasons(year)).current) return
      fetchWpblAllLines().catch(drop)
      // The priced row rather than the play log for the weights; the play log for the Overall side,
      // which the tab opens on.
      fetchWpblRunEnvironment().catch(drop)
      fetchWpblAllRunValuePlays(year).catch(drop)
    })
    .catch(drop)
}
