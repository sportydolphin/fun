import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box } from '@mui/material'
import { SectionCard, PillGroup } from './ui'
import { ReadingStrip } from './Reading'
import { HighlightsStrip } from './Highlights'
import { PhotosStrip } from './Photos'
import { AUTHOR_NAME, PUBLICATION_NAME } from './derive/articles'
import type { WpblArticle, WpblVideo, WpblPhoto, WpblTeam } from './types'
import { track, EVENTS } from '../lib/analytics'

// Home's media shelf: reading, video and photography in ONE full-width card, switched by a
// segmented control, sitting under the two-column feed.
//
// WHY THIS REPLACED THREE STACKED RAILS. They were three separate cards in Home's left
// column, and measured at 1440px they came to 1415px between them: 67% of that column, against
// a right column of 838px total. So the page had 1286px of dead space running down one side
// while the other ran on for three screens. They are also the same UI doing the same job (a
// sideways-scrolling shelf of thumbnail cards), and three of those stacked vertically reads as
// repetition rather than as three offers.
//
// Full width rather than back in a column, because a horizontal strip is the one thing on this
// page that genuinely converts width into content: the same card height shows five or six
// cards instead of three.
//
// WHAT IT COSTS. Only the active segment paints, so Highlights and Archive lose the free
// impression they used to get. That is the actual trade and it is worth naming: the events
// below measure it, and if the archive's open rate collapses, the answer is to change which
// segment leads rather than to go back to three rails.

type Segment = 'reading' | 'highlights' | 'archive'

/** Remembered per browser, like the collapse state it sits beside. A reader who comes for the
 *  highlights should not have to re-pick them every visit. */
const SEGMENT_KEY = 'wpbl_shelf_segment'
const COLLAPSE_KEY = 'wpbl_shelf_collapsed'

// The three rails each had their own collapse key (wpbl_reading_collapsed,
// wpbl_highlights_collapsed, wpbl_photos_collapsed). Those are dead now and deliberately not
// migrated: they recorded "hide this rail", and there is no honest way to turn three of those
// into one answer about a card that did not exist when they were written. Anyone who had
// collapsed a rail gets the shelf open once, and can collapse it again.

function readSegment(): Segment | null {
  try {
    const v = localStorage.getItem(SEGMENT_KEY)
    return v === 'reading' || v === 'highlights' || v === 'archive' ? v : null
  } catch { return null }
}
function readCollapsed(): boolean {
  try { return localStorage.getItem(COLLAPSE_KEY) === '1' } catch { return false }
}

export default function MediaShelf({ articles, videos, photos, teams }: {
  articles: WpblArticle[]
  videos: WpblVideo[]
  photos: WpblPhoto[]
  teams: WpblTeam[]
}) {
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [chosen, setChosen] = useState<Segment | null>(readSegment)

  // Only segments that actually have something to show. A feed can be empty (pre-migration, a
  // quiet week, a sync that has not run), and an empty tab is worse than a missing one: it
  // promises content and then explains itself.
  const available = useMemo(() => {
    const out: { value: Segment; label: string; subtitle: string }[] = []
    // Every subtitle here NAMES ITS SOURCE, and Reading's has to as much as the other two.
    // It used to be the bare masthead, which put "towards a more perfect game" directly under
    // our own "More from the league" heading with nothing to say whose it was, and readers
    // duly took it for this site's tagline and mary mustard for the person writing this site.
    // The other two segments never had that problem because they say "the WPBL channel" and
    // "Wikimedia Commons" out loud. Hers now does too.
    if (articles.length > 0) out.push({ value: 'reading', label: 'Reading', subtitle: `${PUBLICATION_NAME}, by ${AUTHOR_NAME}` })
    if (videos.length > 0) out.push({ value: 'highlights', label: 'Highlights', subtitle: 'Game recaps from the WPBL channel' })
    if (photos.length > 0) out.push({ value: 'archive', label: 'Archive', subtitle: "Women's baseball on Wikimedia Commons" })
    return out
  }, [articles.length, videos.length, photos.length])

  // Reading leads where it can. A piece of writing is the thing a reader would not have found
  // on their own; the league's own reels are a click away wherever else they look. Falls back
  // to whatever exists, so the shelf is never pointed at an empty segment.
  const active: Segment | null = useMemo(() => {
    if (available.length === 0) return null
    if (chosen && available.some(s => s.value === chosen)) return chosen
    return available[0].value
  }, [available, chosen])

  const toggleCollapsed = useCallback(() => {
    setCollapsed(prev => {
      const next = !prev
      track(EVENTS.WPBL_SHELF_COLLAPSED, { collapsed: next })
      try { localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0') } catch { /* choice just isn't remembered */ }
      return next
    })
  }, [])

  const selectSegment = useCallback((v: string) => {
    const seg = v as Segment
    setChosen(seg)
    // The switcher lives in the header, which stays visible while the card is collapsed, so
    // a pill can be pressed with nothing below it to change. Picking a segment is a request
    // to see it: open the card rather than silently re-pointing a card nobody can see.
    setCollapsed(false)
    try { localStorage.setItem(COLLAPSE_KEY, '0') } catch { /* choice just isn't remembered */ }
    track(EVENTS.WPBL_SHELF_SEGMENT, { segment: seg })
    try { localStorage.setItem(SEGMENT_KEY, seg) } catch { /* choice just isn't remembered */ }
  }, [])

  // One impression per segment per mount, and only while the shelf is actually open. This is
  // the denominator the click-through rates need, and it is stricter than what the three rails
  // logged: they counted a render even when collapsed, which a reader never saw.
  const logged = useRef<Set<Segment>>(new Set())
  useEffect(() => {
    if (!active || collapsed || logged.current.has(active)) return
    logged.current.add(active)
    if (active === 'reading') track(EVENTS.WPBL_READING_SHOWN, { count: articles.length, collapsed: false })
    if (active === 'highlights') track(EVENTS.WPBL_HIGHLIGHTS_SHOWN, { count: videos.length, collapsed: false })
    if (active === 'archive') track(EVENTS.WPBL_PHOTOS_SHOWN, { count: photos.length, collapsed: false })
  }, [active, collapsed, articles.length, videos.length, photos.length])

  if (!active) return null
  const current = available.find(s => s.value === active)!

  // One offer is not a choice: with a single segment the control would be a lone pill that
  // does nothing, so the strip just gets the card to itself and the subtitle already says
  // what it is.
  const switcher = available.length > 1 ? (
    <PillGroup
      options={available.map(s => ({ value: s.value, label: s.label }))}
      value={active}
      onChange={selectSegment}
    />
  ) : null

  return (
    <SectionCard
      title="More from the league"
      subtitle={current.subtitle}
      collapsed={collapsed}
      onToggleCollapse={toggleCollapsed}
      // In the header rather than on a row of its own. The header row was carrying a title, a
      // subtitle and a chevron across the full page width with nothing in the middle, while
      // the control below it cost a whole band of vertical space on the page's longest card.
      // Nothing is lost by folding one into the other: the subtitle already names the active
      // segment, so the two were describing the same thing on two lines.
      //
      // Header placement is sm and up only. At 375px the row is title + three pills + chevron,
      // which is where the title starts wrapping, so phones keep the control under the header.
      action={switcher ? <Box sx={{ display: { xs: 'none', sm: 'flex' } }}>{switcher}</Box> : undefined}
    >
      {switcher && <Box sx={{ display: { xs: 'block', sm: 'none' }, mb: 1.25 }}>{switcher}</Box>}
      {/* Only the active strip is mounted. Mounting all three and hiding two would keep three
          scrollers, three sets of lazy images and (for Highlights) a YouTube facade alive for
          a reader looking at one of them. */}
      {active === 'reading' && <ReadingStrip articles={articles} teams={teams} />}
      {active === 'highlights' && <HighlightsStrip videos={videos} teams={teams} />}
      {active === 'archive' && <PhotosStrip photos={photos} />}
    </SectionCard>
  )
}
