import { useEffect, useState } from 'react'
import { Box, Typography, Skeleton, CircularProgress } from '@mui/material'
import { WPBL_ACCENT } from '../constants'
import { chromePx } from '../ui'
import { DetailPageBar } from '../../ui/DetailPageBar'
import {
  type WpblView,
} from '../routes'
import { SeasonMenu } from '../SeasonMenu'
import { TabTitle } from '../PageHeading'
import { ScoresSkeleton } from './ScoresTab'
import { TYPE_SCALE } from '../../ui/card'

// Shown while a modal's chunk loads. A tap should visibly do something immediately, so this
// paints the scrim the modal itself is about to paint, and the panel then fills in over it
// rather than the tap appearing to have missed.
/**
 * Nothing at all for the first moment, then a spinner if the chunk really is slow.
 *
 * React.lazy suspends for at least a tick even when the module is already in memory, so an
 * immediate fallback renders on EVERY open: a dimmed screen and a spinner for a few hundred
 * milliseconds, then a sheet sliding up, two unrelated movements for one tap.
 *
 * A delay is the right shape for this rather than deleting the fallback outright. The common
 * case is warm and instant and should show nothing; the rare cold one on a bad connection
 * still needs to say something is happening.
 */
const CHUNK_SPINNER_DELAY_MS = 400

export function ModalChunkFallback() {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    const t = window.setTimeout(() => setSlow(true), CHUNK_SPINNER_DELAY_MS)
    return () => window.clearTimeout(t)
  }, [])
  if (!slow) return null
  return (
    <Box sx={{
      position: 'fixed', inset: 0, zIndex: 1300,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      bgcolor: 'rgba(0,0,0,0.5)',
    }}>
      <CircularProgress size={28} sx={{ color: WPBL_ACCENT }} />
    </Box>
  )
}

/** The full game or player page while its chunk or the roster loads, in the page's own frame: its
 *  width, breaking out of the column the way the page does, and the real back bar over the card.
 *  It sat in the 720px column 36px low until Oct 12, 2026, so the page arrived wider and higher and
 *  moved everything on the screen. The bar is real but inert, so it holds the bar's exact height
 *  without a second focusable Back. */
export function DetailPageSkeleton({ width }: { width: string }) {
  return (
    <Box aria-hidden ref={(el: HTMLElement | null) => { el?.setAttribute('inert', '') }}
      sx={{ width, ml: `calc((100% - ${width}) / 2)` }}>
      <DetailPageBar onBack={() => {}} eyebrow={<Skeleton width="10rem" />} />
      <Skeleton variant="rounded" sx={{ height: chromePx(480), borderRadius: 3 }} />
    </Box>
  )
}

// SHOWN WHILE THE FIRST TEAMS/SCHEDULE READ IS IN FLIGHT, ONE PER TAB, and each is its tab drawn
// empty: the real title (TabTitle, which needs no data) over grey blocks the size of what replaces
// them, so the only change when the tab lands is grey turning into content. Home has its own
// (WpblHomeSkeleton) and so does Stats (StatsSkeleton, beside the full-bleed rule it shares).
//
// One generic dashboard shape served all four until Oct 2026 and matched none of them: no title,
// and its first block 20px below where every tab's title sits, so every cold load jumped. The
// schedule's is built from the schedule's own pieces (SectionLabel, the card's padding and badge);
// the rest are desktop measurements over the 1.25 scale, in chromePx, which holds on a phone too.
// Check any change with `?devSlow=2500` (src/dev/slowLoad.ts) against the loaded tab.
export function TabSkeleton({ view }: { view: WpblView }) {
  const block = (height: unknown, key?: number) => (
    <Skeleton key={key} variant="rounded" sx={{ height, borderRadius: 2 }} />
  )
  switch (view) {
    case 'schedule':
      return <ScoresSkeleton />
    case 'standings':
      return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TabTitle>WPBL Standings</TabTitle>
          <SeasonMenu label="season" sx={{ mb: -0.5 }} />
          {/* The table's caption, which says this before any data has arrived too. */}
          <Typography sx={{ mb: -1.25, fontSize: TYPE_SCALE.meta, fontWeight: 600, color: 'text.disabled' }}>
            Current standings
          </Typography>
          {block(chromePx(193))}
          {/* The chart card wraps its subtitle and summary lines on a phone, so it is taller there. */}
          {block({ xs: '388px', sm: chromePx(337) })}
        </Box>
      )
    case 'teams':
      return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TabTitle>WPBL Teams</TabTitle>
          <SeasonMenu label="season" />
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5 }}>
            {[0, 1, 2, 3].map(i => block(chromePx(96), i))}
          </Box>
          {/* Club profiles, at the height it has once its chart is drawn (TeamsGrid draws the
              chart's box grey until then), and Head to head. Taller on a phone, where the chart
              is near the card's full width and so near its full height. Both are there only once the season
              has a result, which every season since the first week has. */}
          {block({ xs: '404px', sm: chromePx(329.6) })}
          {block(chromePx(261))}
        </Box>
      )
    default:
      return null
  }
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <Box sx={{ textAlign: 'center', py: 6, px: 2, color: 'text.secondary' }}>
      <Typography sx={{ fontSize: TYPE_SCALE.heading, fontWeight: 700, mb: 0.5 }}>{title}</Typography>
      {hint && <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.disabled' }}>{hint}</Typography>}
    </Box>
  )
}
