// Opens a postseason series from its ADDRESS, /mlb/postseason/<season>/<slot>, the way GameRoute
// opens a game: a shared link, Forward onto an entry a series sheet once had, the shell's navigate().
// A sheet opened from a bracket card holds the same address itself, and this stands aside for it.
//
// The landing entry is RESEATED as Standings with the sheet's entry pushed on top, for GameRoute's
// reason: left as it was, Back would close the sheet onto the same address and this would open it
// again. Standings because that is where the full bracket lives.
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { fetchBracket } from '../postseason'
import type { Bracket } from '../postseason'
import { openSheetCount, sheetOpenAt } from '../state/sheetHistory'
import { mlbSeriesFromPath, mlbSeriesPath, MLB_VIEW_PATHS } from '../routes'
import type { MlbSeriesRef } from '../routes'
import { useForegroundInterval } from '../../lib/foregroundInterval'

const SeriesSheet = lazy(() => import('./SeriesSheet'))

export function SeriesRoute({ onPlayerClick, onTeamClick }: {
  onPlayerClick: (id: number) => void
  onTeamClick:   (id: number) => void
}) {
  const [open, setOpen] = useState<{ ref: MlbSeriesRef; bracket: Bracket } | null>(null)
  const pending = useRef<string | null>(null)

  const show = useCallback((ref: MlbSeriesRef) => {
    const url = mlbSeriesPath(ref.season, ref.id)
    if (pending.current === url || sheetOpenAt(url)) return
    const st = window.history.state as Record<string, unknown> | null
    if (window.location.pathname === url && !(st?.mlbSheet != null && st.mlbSheetUrl === url)) {
      window.history.replaceState({ view: 'standings' }, '', MLB_VIEW_PATHS.standings)
      window.history.pushState({ view: 'standings', mlbSheet: openSheetCount() + 1, mlbSheetUrl: url }, '', url)
    }
    pending.current = url
    fetchBracket(ref.season).then(b => {
      if (pending.current !== url) return
      pending.current = null
      // Off the address by now (a tab tapped while it loaded): the reader chose another page.
      if (window.location.pathname !== url) return
      if (b) setOpen({ ref, bracket: b })
      // No bracket that season, or not one in the shape the sheet reads: step off onto Standings.
      else window.history.back()
    })
  }, [])

  useEffect(() => {
    const check = () => {
      const ref = mlbSeriesFromPath(window.location.pathname)
      if (ref == null) { pending.current = null; return }
      show(ref)
    }
    check()
    window.addEventListener('popstate', check)
    return () => window.removeEventListener('popstate', check)
  }, [show])

  // Fresh while a game in the series is on, as the bracket card keeps its own sheet.
  const live = !!open?.bracket.series[open.ref.id].live
  useForegroundInterval(() => {
    if (!open) return
    fetchBracket(open.ref.season, true).then(b => { if (b) setOpen(o => o && o.ref === open.ref ? { ...o, bracket: b } : o) })
  }, live ? 30_000 : null)

  if (!open) return null
  return (
    <Suspense fallback={null}>
      <SeriesSheet s={open.bracket.series[open.ref.id]} bracket={open.bracket} onClose={() => setOpen(null)}
        onTeamClick={onTeamClick} onPlayerClick={onPlayerClick} />
    </Suspense>
  )
}
