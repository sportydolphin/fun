import { Box, Typography } from '@mui/material'
import { CARD_LINK_SX, FOCUS_RING, NewTag, RailArrow, RailScroller, TextGhost, TYPE_SCALE, chromePx, useRailPaging } from '../ui'
import { isModified, navigate } from '../../nav'
import { wpblWatchVideoPath } from '../routes'
import { VideoCreditLine, VideoThumb, PLAYABLE_HOVER, videoDateLabel } from '../Highlights'
import { ClipCaption } from '../Watch'
import { videoCredit, videoKindName } from '../videoChannels'
import { typePx } from '../../ui/scale'
import type { WpblVideo } from '../types'

// The pieces the Watch page's front and its shelves share.

/**
 * A real link to a video's page. `queue` is what plays after it when the shelf is showing a chosen
 * list; it rides on the history entry rather than the URL, so the address stays the one to share and
 * a reload or a Back keeps the list.
 */
export function videoLink(v: WpblVideo, queue?: string[]) {
  const to = wpblWatchVideoPath(v.video_id)
  return {
    component: 'a' as const,
    href: to,
    onClick: (e: React.MouseEvent) => {
      if (isModified(e)) return
      e.preventDefault()
      navigate(to, { watchFrom: 'shelf', ...(queue ? { watchQueue: queue } : null) })
    },
  }
}

export const CARD_LINK = { display: 'block', color: 'inherit', textDecoration: 'none' } as const

export function GroupHeading({ children }: { children: React.ReactNode }) {
  return (
    <Typography component="h2" sx={{
      fontSize: TYPE_SCALE.micro, fontWeight: 800, textTransform: 'uppercase', letterSpacing: typePx(0.6),
      color: 'text.secondary', mb: 1,
    }}>{children}</Typography>
  )
}

/**
 * One row of the front page: a heading, a link to the whole shelf, and a strip that runs to the
 * screen's edges on a phone so the card cut off at the side is what says there is more.
 */
export function Rail({ title, label, count, onAll, children }: {
  title: string
  /** What the strip holds, for its arrows' names. */
  label: string
  /** What changes when the contents do, so the arrows re-measure. */
  count: number
  /** The shelf this is a taste of. */
  onAll?: { href: string; go: () => void }
  children: React.ReactNode
}) {
  const { scrollRef, canPrev, canNext, syncEdges, page } = useRailPaging(count)
  return (
    <Box component="section" sx={{ mt: 2.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1 }}>
        <GroupHeading>{title}</GroupHeading>
        {onAll && (
          <Box component="a" href={onAll.href}
            onClick={(e: React.MouseEvent) => { if (!isModified(e)) { e.preventDefault(); onAll.go() } }}
            sx={CARD_LINK_SX}>All ›</Box>
        )}
      </Box>
      <Box sx={{ position: 'relative', mx: { xs: 'calc(50% - 50vw)', sm: 0 } }}>
        <RailScroller scrollRef={scrollRef} onScroll={syncEdges} phoneInset={2}>{children}</RailScroller>
        <RailArrow dir="left" show={canPrev} onClick={() => page(-1)} label={label} />
        <RailArrow dir="right" show={canNext} onClick={() => page(1)} label={label} />
      </Box>
    </Box>
  )
}

const TILE_16_9 = 280
const TILE_9_16 = 130

/**
 * A video in a rail, or its empty shape while the list loads. A Short is a tall poster with its title
 * on the picture, as on YouTube's own shelf; anything else is 16:9 with the title under it, because
 * the poster's foot holds the length.
 */
export function PosterTile({ video, vertical, queue, isNew, badge }: {
  video?: WpblVideo
  vertical?: boolean
  queue?: string[]
  isNew?: boolean
  /** Drawn in the corner of a tall poster: its club. */
  badge?: React.ReactNode
}) {
  const tall = vertical ?? video?.is_short === true
  const width = chromePx(tall ? TILE_9_16 : TILE_16_9)
  const outer = { flexShrink: 0, width, scrollSnapAlign: 'start', minWidth: 0 } as const
  if (!video) {
    return (
      <Box sx={outer}>
        <Box sx={{ width: '100%', aspectRatio: tall ? '9 / 16' : '16 / 9', borderRadius: 2, bgcolor: 'action.hover' }} />
        {!tall && (
          <Box sx={{ mt: 0.5 }}>
            <Typography sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 700, lineHeight: 1.25 }}><TextGhost>The Entire WPBL Season</TextGhost></Typography>
            <Typography sx={{ mt: 0.25, fontSize: TYPE_SCALE.micro, fontWeight: 700 }}><TextGhost>Podcast · Sep 22</TextGhost></Typography>
          </Box>
        )}
      </Box>
    )
  }
  const credit = videoCredit(video)
  return (
    <Box sx={outer}>
      <Box {...videoLink(video, queue)} aria-label={`Play${isNew ? ' new' : ''}: ${video.title}`}
        sx={{ ...CARD_LINK, borderRadius: 2, ...PLAYABLE_HOVER, ...FOCUS_RING }}>
        <Box sx={{ position: 'relative', borderRadius: 2, overflow: 'hidden' }}>
          <VideoThumb video={video} vertical={tall} badge={tall ? 30 : 34} />
          {tall && <ClipCaption title={video.title} lines={3} />}
          {isNew && <NewTag />}
          {badge && <Box sx={{ position: 'absolute', top: 5, right: 5, pointerEvents: 'none', lineHeight: 0 }}>{badge}</Box>}
        </Box>
        {!tall && (
          <Box sx={{ mt: 0.5 }}>
            <Typography sx={{
              fontSize: TYPE_SCALE.meta, fontWeight: 700, lineHeight: 1.25,
              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
            }}>{video.title}</Typography>
            <Typography sx={{ mt: 0.25, fontSize: TYPE_SCALE.micro, fontWeight: 700, color: 'text.secondary' }}>
              {`${videoKindName(video)} · ${videoDateLabel(video)}`}
            </Typography>
          </Box>
        )}
      </Box>
      {credit && !tall && <VideoCreditLine credit={credit} />}
    </Box>
  )
}
