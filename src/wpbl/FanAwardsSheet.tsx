import { useEffect, useMemo, useState } from 'react'
import FanVoteCard from './FanVote'
import {
  fetchWpblAllPlayers, getCachedWpblAllPlayers, fetchWpblAllLines, getCachedWpblAllLines,
  fetchWpblAllRunValuePlays, getCachedWpblAllRunValuePlays,
} from './api'
import { buildRunExpectancy, playRunValues } from './derive/runExpectancy'
import { mvpRace } from './derive/mvpRace'
import type { WpblTeam, WpblPlayer, WpblGame, WpblBattingLine, WpblPitchingLine, WpblRunValuePlay } from './types'

/**
 * /wpbl/awards once the ballot card has come off Home (AWARDS_RESULTS_UNTIL).
 *
 * The sheet used to exist only inside that card, so past the date the address (indexed, in the
 * sitemap, and in every link anyone shared) drew Home with no ballot under a title promising one.
 * Closed, the ballot is the results, and they do not expire.
 *
 * MOUNTED BY WpblApp, NOT BY HOME, so it opens on the first frame: Home waits on the schedule
 * before it mounts at all, and its own reads wait on Home. Every read here is the same
 * session-cached fetcher Home and the Run value board use, so nobody pays twice, and the sheet
 * draws its results empty until they land (see `settled` on FanVoteCard).
 *
 * Only mounted while the URL asks for it, which keeps the lines and the play log, the two
 * heaviest reads in the section, off every other offseason visit.
 */
export default function FanAwardsSheet({ teams, games, scheduleSettled, onOpenPlayer, onOpenTeam, onOpen, onClose }: {
  teams: WpblTeam[]
  games: WpblGame[]
  /** The section's teams and schedule have answered, whether or not they returned anything. */
  scheduleSettled: boolean
  onOpenPlayer: (p: WpblPlayer) => void
  onOpenTeam: (t: WpblTeam) => void
  onOpen: () => void
  onClose: () => void
}) {
  // Read here rather than taken from WpblApp, whose copy has no way to say it has answered: an
  // empty roster that is merely late would otherwise read as "nothing to draw" for a moment.
  const [players, setPlayers] = useState<WpblPlayer[]>(() => getCachedWpblAllPlayers() ?? [])
  const [lines, setLines] = useState<{ batting: WpblBattingLine[]; pitching: WpblPitchingLine[] }>(
    () => getCachedWpblAllLines() ?? { batting: [], pitching: [] })
  const [plays, setPlays] = useState<WpblRunValuePlay[]>(() => getCachedWpblAllRunValuePlays() ?? [])
  const [readsSettled, setReadsSettled] = useState(false)
  useEffect(() => {
    let cancelled = false
    Promise.allSettled([fetchWpblAllPlayers(), fetchWpblAllLines(), fetchWpblAllRunValuePlays()]).then(([r, l, p]) => {
      if (cancelled) return
      if (r.status === 'fulfilled') setPlayers(r.value)
      if (l.status === 'fulfilled') setLines(l.value)
      if (p.status === 'fulfilled') setPlays(p.value)
      setReadsSettled(true)
    })
    return () => { cancelled = true }
  }, [])

  // The MVP race seeds the MVP and Pitcher shortlists; the same two passes Home runs.
  const race = useMemo(() => {
    if (plays.length === 0 || players.length === 0) return null
    return mvpRace(playRunValues(plays, games, buildRunExpectancy(plays, games)), players, games)
  }, [plays, players, games])

  return (
    <FanVoteCard sheetOnly settled={scheduleSettled && readsSettled}
      players={players} teams={teams} games={games}
      batting={lines.batting} pitching={lines.pitching} race={race} plays={plays}
      onOpenPlayer={onOpenPlayer} onOpenTeam={onOpenTeam}
      open onOpen={onOpen} onClose={onClose} />
  )
}
