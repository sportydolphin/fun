import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { VizView } from '../views/VizView'
import { CURRENT_SEASON } from '../constants'

// The FIRST render of the report cards page, before any effect has run. Effects are where the reads start
// and the `loading` flags go true, and React can paint before running them (it does when the view
// mounts out of a cold lazy chunk, which is CI's runner and not usually a dev machine), so whatever
// this frame draws is on screen for a moment. It drew "No active streaks" in every player card,
// a third of the skeleton's height, and the layout sweep caught the second row of cards jumping
// 141px only on the runs slow enough to look in that gap. Server rendering runs no effects, so it
// is exactly that frame, every time.

const props = {
  show: 'report-card' as const, boardTabs: null, isDesktop: true, setVizSeason: () => {}, teamSummaries: [], loadingViz: true,
  nameMap: new Map<number, string>(), handleVizNavigate: () => {}, handleLbPlayerClick: () => {}, canHover: true,
}

describe('Report cards first frame', () => {
  it('draws the current season as skeletons, never an empty card', () => {
    const html = renderToStaticMarkup(<VizView {...props} vizSeason={CURRENT_SEASON} />)
    expect(html).toContain('Hitless Streaks')
    expect(html).not.toContain('No active streaks')
  })
})
