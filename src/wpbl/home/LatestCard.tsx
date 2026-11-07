import { useEffect, useMemo, useRef, useState } from 'react'
import { Box, Skeleton, Typography } from '@mui/material'
import {
  fetchWpblArticles, getCachedWpblArticles, fetchWpblVideos, getCachedWpblVideos,
  fetchWpblRecaps, getCachedWpblRecaps,
} from '../api'
import { wpblWatchVideoPath } from '../routes'
import { sourceOf } from '../derive/articles'
import { videoCredit, videoKindName } from '../videoChannels'
import { linkTo } from '../../nav'
import { SectionCard, TYPE_SCALE, AGATE_SX, TITLE_SX, titleSize } from '../../ui/card'
import { hoverOnly, FOCUS_RING } from '../../ui/interaction'
import { track, trackImpression, EVENTS } from '../../lib/analytics'
import type { WpblArticle, WpblGameRecap, WpblVideo } from '../types'
import { localeDate } from '../../lib/dateFormat'

/**
 * HOME'S HEADLINE LIST (Nov 4, 2026, docs/design-references/ANALYSIS.md). Eleven of the fourteen
 * baseball front pages studied run a text-only list of what is new beside or under the lead, and
 * Home had none: its first screen was one story, and nothing in it changed between visits in the
 * offseason. Everything new in the section, newest first, as a newspaper's index: the league's
 * videos, the two writers' posts, This is Women's Baseball's recaps, and the week's clips as one line.
 *
 * TEXT ONLY, ON PURPOSE. The pictures are Watch's and Reading's job further down; a list is the
 * densest way to put six ways in on one screen, and readers scan its first words and move on.
 */

/** Rows drawn. The slots are fixed (see ROW_SX), so the section's height is known before any read
 *  lands. Four, so a third of the news row ends level with Spotlight and the leaders beside it at
 *  1440 (six ran about 200px past them), and two columns of two between md and lg. */
export const LATEST_COUNT = 4
/** At most this many of one kind, so a week of uploads cannot push the writing off the list. */
const PER_KIND = 3
/** The clips row counts the Shorts of the last week. */
const CLIP_WINDOW_MS = 7 * 86_400_000

export interface LatestItem {
  key: string
  kind: 'video' | 'reading' | 'recap' | 'clips'
  title: string
  /** What and whose: "Compilation", "Reading · The Rising Fastball". */
  label: string
  at: string
  href: string
  external: boolean
  onOpen?: () => void
  /** A league video's id, so Watch's Videos shelf can leave out what this list already runs. */
  videoId?: string
}

/** Emoji off a title, for a list set as headlines; the Watch page keeps the uploader's own text. */
export function headlineText(title: string): string {
  return title.replace(/\p{Extended_Pictographic}|\p{Emoji_Modifier}|\u{FE0F}|\u{200D}/gu, '').replace(/\s+/g, ' ').trim()
}

/** "Today", "Yesterday", or the date in the house's short form ("Nov 3"), with the year when it is not this one. */
export function latestWhen(iso: string, now = Date.now()): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const day = (t: Date) => new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime()
  const today = new Date(now)
  const diff = Math.round((day(today) - day(d)) / 86_400_000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  return localeDate(d, 'en-US', d.getFullYear() === today.getFullYear()
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' })
}

/** The list, newest first, from the three reads. Pure, so the mix can be tested without a page. */
export function latestItems(articles: readonly WpblArticle[], videos: readonly WpblVideo[], recaps: readonly WpblGameRecap[], now = Date.now()): LatestItem[] {
  const items: LatestItem[] = []
  for (const v of videos.filter(v => v.is_short !== true).slice(0, PER_KIND)) {
    const credit = videoCredit(v)
    items.push({
      key: `v:${v.video_id}`, kind: 'video', at: v.published_at,
      title: headlineText(v.title) || videoKindName(v),
      label: credit ? `${videoKindName(v)} · ${credit.name}` : videoKindName(v),
      href: wpblWatchVideoPath(v.video_id), external: false, videoId: v.video_id,
    })
  }
  for (const a of articles.slice(0, PER_KIND)) {
    items.push({
      key: `a:${a.post_id}`, kind: 'reading', at: a.published_at, title: a.title,
      label: `Reading · ${sourceOf(a.source).publicationName}`, href: a.url, external: true,
      onOpen: () => track(EVENTS.WPBL_ARTICLE_OPENED, { postId: a.post_id, slug: a.slug, from: 'home-latest' }),
    })
  }
  for (const r of recaps.slice(0, PER_KIND)) {
    items.push({
      key: `r:${r.game_id}`, kind: 'recap', at: r.published_at, title: r.title,
      label: "Recap · This is Women's Baseball", href: r.url, external: true,
      onOpen: () => track(EVENTS.WPBL_RECAP_OPENED, { gameId: r.game_id, url: r.url }),
    })
  }
  // The week's clips as one row headed by the newest, with the count in its label. As "3 new clips"
  // it was the one row with no headline, a lone line in a two-line slot.
  const clips = videos.filter(v => v.is_short === true && now - new Date(v.published_at).getTime() < CLIP_WINDOW_MS)
  if (clips.length > 0) {
    const newest = clips[0]
    items.push({
      key: 'clips', kind: 'clips', at: newest.published_at,
      title: headlineText(newest.title) || (clips.length === 1 ? 'New clip' : `${clips.length} new clips`),
      label: clips.length === 1 ? 'Clip' : `Clip · ${clips.length} this week`,
      href: wpblWatchVideoPath(newest.video_id), external: false,
    })
  }
  return items
    .sort((a, b) => b.at.localeCompare(a.at) || a.key.localeCompare(b.key))
    .slice(0, LATEST_COUNT)
}

const TITLE_SIZE = titleSize(TYPE_SCALE.title)
const TITLE_LH = 1.25
/** A fixed slot per row: two lines of headline and one of meta, whether the headline needs one line
 *  or two. A newspaper index sets its items to a grid; here it also means the section has the same
 *  height loading as loaded, at every width, so nothing under it moves when the reads land. */
// The slot is the row's, not the headline's: held under a one-line headline it opened a gap between
// the headline and its own date. Two lines of headline, the 2px gap and a line of meta, with a
// shorter row centered in it, so the room is split above and below rather than left as a hole
// under one row.
const ROW_SX = {
  display: 'flex', flexDirection: 'column', justifyContent: 'center', py: 1, minWidth: 0, boxSizing: 'content-box',
  minHeight: `calc(${TITLE_SIZE} * ${TITLE_LH * 2} + 2px + ${TYPE_SCALE.meta} * 1.3)`,
} as const
/** The rows as one column, or two between md and lg, where the list spans the row above Spotlight
 *  and the leaders and one column would run its headlines 900px wide. A hairline over every row but
 *  the first of each column. */
const LIST_SX = {
  listStyle: 'none', m: 0, p: 0, mt: -1,
  display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))', lg: 'minmax(0, 1fr)' },
  columnGap: 4, gridAutoFlow: { md: 'column', lg: 'row' },
  gridTemplateRows: { md: `repeat(${LATEST_COUNT / 2}, auto)`, lg: 'none' },
  '& > *': { borderTop: '1px solid', borderColor: 'divider' },
  '& > :first-of-type': { borderTop: 'none' },
  [`& > :nth-of-type(${LATEST_COUNT / 2 + 1})`]: { borderTop: { md: 'none', lg: '1px solid' }, borderColor: 'divider' },
} as const
const META_SX = { ...AGATE_SX, fontSize: TYPE_SCALE.meta, fontWeight: 500, color: 'text.secondary', lineHeight: 1.3 } as const

/** The list, read once for the page: Home hands it to LatestCard and its video ids to Watch, which
 *  would otherwise run the same two videos again a screen lower. Null until all three reads answer;
 *  a failed read counts as answered with nothing. */
export function useLatestItems(): LatestItem[] | null {
  const [articles, setArticles] = useState<WpblArticle[] | null>(() => getCachedWpblArticles())
  const [videos, setVideos] = useState<WpblVideo[] | null>(() => getCachedWpblVideos())
  const [recaps, setRecaps] = useState<WpblGameRecap[] | null>(() => getCachedWpblRecaps())
  useEffect(() => {
    let live = true
    fetchWpblArticles().then(a => { if (live) setArticles(a) }).catch(() => { if (live) setArticles([]) })
    fetchWpblVideos().then(v => { if (live) setVideos(v) }).catch(() => { if (live) setVideos([]) })
    fetchWpblRecaps().then(r => { if (live) setRecaps(r) }).catch(() => { if (live) setRecaps([]) })
    return () => { live = false }
  }, [])
  const settled = articles !== null && videos !== null && recaps !== null
  return useMemo(
    () => settled ? latestItems(articles, videos, recaps) : null,
    [settled, articles, videos, recaps])
}

export function LatestCard({ items }: { items: LatestItem[] | null }) {
  const shown = useRef(false)
  useEffect(() => {
    if (shown.current || !items?.length) return
    shown.current = true
    trackImpression(EVENTS.WPBL_LATEST_SHOWN, { count: items.length, from: 'home' }, 'home')
  }, [items])
  // Answered, and there is nothing new anywhere: no section rather than an empty one.
  if (items && items.length === 0) return null

  if (!items) return <LatestSkeleton />
  return (
    <SectionCard title="Latest" fill>
      <Box component="ul" sx={LIST_SX}>
        {items.map(item => <LatestRow key={item.key} item={item} />)}
      </Box>
    </SectionCard>
  )
}

/** The list before its reads land, in the loaded section's own box: the heading and the fixed row
 *  slots. Also the offseason Home skeleton's copy of it (Skeletons.tsx), so the two cannot differ. */
export function LatestSkeleton() {
  return (
    <SectionCard title="Latest" fill>
      <Box aria-hidden sx={LIST_SX}>
        {Array.from({ length: LATEST_COUNT }, (_, i) => (
          <Box key={i} sx={ROW_SX}>
            <Skeleton variant="text" width={['90%', '75%', '85%', '70%'][i % 4]} sx={{ fontSize: TITLE_SIZE, lineHeight: TITLE_LH }} />
            <Skeleton variant="text" width="40%" sx={{ fontSize: TYPE_SCALE.meta, lineHeight: 1.3 }} />
          </Box>
        ))}
      </Box>
    </SectionCard>
  )
}

function LatestRow({ item }: { item: LatestItem }) {
  const opened = () => { track(EVENTS.WPBL_LATEST_OPEN, { kind: item.kind }); item.onOpen?.() }
  const link = item.external
    ? { component: 'a' as const, href: item.href, target: '_blank', rel: 'noopener noreferrer', onClick: opened }
    : linkTo(item.href, opened)
  const when = latestWhen(item.at)
  return (
    <Box component="li" sx={ROW_SX}>
      <Box {...link} aria-label={item.external ? `${item.title}, opens in a new tab` : undefined} sx={{
        color: 'text.primary', textDecoration: 'none', borderRadius: 1, ...FOCUS_RING,
        ...hoverOnly({ '& .latest-title': { textDecoration: 'underline' } }),
      }}>
        <Box sx={{ mb: '2px' }}>
          <Typography className="latest-title" sx={{
            ...TITLE_SX, fontSize: TITLE_SIZE, lineHeight: TITLE_LH,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>
            {item.title}
            {item.external && <Box component="span" aria-hidden sx={{ color: 'text.secondary', fontFamily: 'inherit', ml: '0.25em' }}>↗</Box>}
          </Typography>
        </Box>
        <Typography noWrap sx={META_SX}>{when ? `${item.label} · ${when}` : item.label}</Typography>
      </Box>
    </Box>
  )
}
