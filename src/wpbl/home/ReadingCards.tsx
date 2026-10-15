import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Typography } from '@mui/material'
import {
  fetchWpblArticles, getCachedWpblArticles,
} from '../api'
import { WPBL_READING_PAGE } from '../routes'
import { readMinutes, sourceOf, SOURCES } from '../derive/articles'
import { ReadingCard } from '../Reading'
import { linkTo } from '../../nav'
import { SectionCard, CARD_BORDER, CARD_FILL, hoverOnly, FOCUS_RING, TYPE_SCALE, CARD_LINK_SX } from '../ui'
import { track, trackImpression, EVENTS } from '../../lib/analytics'
import { useNewSince } from '../newSince'
import type { WpblTeam, WpblArticle } from '../types'
import { typePx } from '../../ui/scale'
import { CardSkeleton, READING_CARD_SKELETON_H } from './Skeletons'

/**
 * The latest post from either writer the section mirrors, as one line, and a door to all of them.
 * The eyebrow names whichever writer it is, looked up from the row, so a new post from one is never
 * credited to the other.
 *
 * ONE LINE, NOT A RAIL. A shelf of her work sat on Home once and was seen far more than it was
 * opened (575 browsers, 39 click-throughs), so what comes back is the smallest thing that still
 * answers "is there anything new to read": her newest headline, which opens the post, and a link
 * to /wpbl/reading for the rest. Named as hers in the eyebrow, because readers have mistaken her
 * for the person who runs this site (see AuthorByline in Reading.tsx). Renders nothing until
 * there is a post.
 */
export function LatestReadingCard() {
  const [articles, setArticles] = useState<WpblArticle[]>(() => getCachedWpblArticles() ?? [])
  useEffect(() => {
    let live = true
    fetchWpblArticles().then(a => { if (live) setArticles(a) }).catch(() => { /* renders nothing */ })
    return () => { live = false }
  }, [])
  const latest = articles[0]
  const shown = useRef(false)
  useEffect(() => {
    if (shown.current || !latest) return
    shown.current = true
    trackImpression(EVENTS.WPBL_READING_SHOWN, { count: articles.length, from: 'home' }, 'home')
  }, [latest, articles.length])
  if (!latest) return null

  const all = linkTo(WPBL_READING_PAGE, () => track(EVENTS.WPBL_READING_ARCHIVE, { count: articles.length, from: 'home' }))
  const date = new Date(latest.published_at)
  const when = Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString([], { month: 'short', day: 'numeric' })
  return (
    <Box sx={{
      border: '1px solid', borderColor: CARD_BORDER, borderRadius: 3, bgcolor: CARD_FILL,
      px: 2, py: 1.5, display: 'flex', flexDirection: 'column', gap: 0.5,
    }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
        <Typography sx={{
          flex: 1, minWidth: 0, fontSize: TYPE_SCALE.micro, fontWeight: 800, letterSpacing: typePx(0.6),
          textTransform: 'uppercase', color: 'text.secondary',
        }}>Latest from {sourceOf(latest.source).authorName}</Typography>
        <Box {...all}
          sx={{
            flexShrink: 0, fontSize: TYPE_SCALE.meta, fontWeight: 800, color: 'var(--wpbl-accent-fg)',
            textDecoration: 'none', ...hoverOnly({ textDecoration: 'underline' }), ...FOCUS_RING,
          }}>All {articles.length} posts ›</Box>
      </Box>
      <Box component="a" href={latest.url} target="_blank" rel="noopener noreferrer"
        onClick={() => track(EVENTS.WPBL_ARTICLE_OPENED, { postId: latest.post_id, slug: latest.slug, from: 'home' })}
        aria-label={`Read: ${latest.title}, opens in a new tab`}
        sx={{ textDecoration: 'none', color: 'text.primary', borderRadius: 1, ...hoverOnly({ textDecoration: 'underline' }), ...FOCUS_RING }}>
        <Typography sx={{ fontSize: TYPE_SCALE.title, fontWeight: 800, lineHeight: 1.3, color: 'inherit' }}>
          {latest.title} <Box component="span" aria-hidden sx={{ color: 'text.disabled', fontWeight: 600 }}>↗</Box>
        </Typography>
      </Box>
      <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.disabled' }}>
        {[when, `${readMinutes(latest.word_count, latest.video_count)} min read`, `on ${sourceOf(latest.source).publicationName}`].filter(Boolean).join(' · ')}
      </Typography>
    </Box>
  )
}

/** How many posts the offseason Reading card shows: one row of three on a desktop. */
const READING_HOME_COUNT = 3

/**
 * The newest posts for the offseason Reading card, newest first, with each writer's latest
 * guaranteed a place. Straight recency would let whichever writer filed last fill the row, and
 * the card exists to put both in front of a reader who has nothing else new to look at.
 */
export function readingHomePicks(articles: WpblArticle[], n = READING_HOME_COUNT): WpblArticle[] {
  const firsts = SOURCES
    .map(src => articles.find(a => sourceOf(a.source).key === src.key))
    .filter((a): a is WpblArticle => !!a)
  const picked = [...firsts, ...articles.filter(a => !firsts.includes(a))].slice(0, n)
  return picked.sort((a, b) => b.published_at.localeCompare(a.published_at) || b.post_id - a.post_id)
}

/**
 * Reading, in the offseason: the newest posts from both writers as cards, above Watch.
 *
 * WHY NOT THE ONE LINE. LatestReadingCard was sized for a season, where it sat under a page of
 * games and only had to answer "is there anything new". With no games left, the gallery, the
 * videos and the writing are the whole of what changes on Home, and a single headline at the foot
 * of the page undersold the one of the three that is still being written.
 *
 * THE CREDIT LINE IS NOT DECORATION. Readers have mistaken mary mustard for the person who runs
 * this site (docs/READING.md §1), so the footer names each writer with their publication, and every
 * card names its writer too (ReadingCard). Renders nothing until there is a post.
 */
export function ReadingHomeCard({ teamById }: { teamById: Map<string, WpblTeam> }) {
  // Null until the read answers, which is not the same as no posts: see the placeholder below.
  const [loaded, setLoaded] = useState<WpblArticle[] | null>(() => getCachedWpblArticles())
  useEffect(() => {
    let live = true
    fetchWpblArticles().then(a => { if (live) setLoaded(a) }).catch(() => { if (live) setLoaded([]) /* renders nothing */ })
    return () => { live = false }
  }, [])
  const articles = useMemo(() => loaded ?? [], [loaded])
  const picks = useMemo(() => readingHomePicks(articles), [articles])
  const stamped = useMemo(() => loaded?.map(a => ({ id: String(a.post_id), at: a.published_at })) ?? null, [loaded])
  const { isNew, markOpened } = useNewSince('reading', stamped)
  const writers = useMemo(
    () => SOURCES.filter(src => articles.some(a => sourceOf(a.source).key === src.key)),
    [articles],
  )
  const shown = useRef(false)
  useEffect(() => {
    if (shown.current || picks.length === 0) return
    shown.current = true
    trackImpression(EVENTS.WPBL_READING_SHOWN, { count: articles.length, from: 'home' }, 'home')
  }, [picks.length, articles.length])
  // HOLDS ITS HEIGHT WHILE THE READ IS IN FLIGHT, as the gallery above it does (FanPhotoHomeCard's
  // `reserve`). It sits above Watch and the season card, so rendering nothing and then 400px of
  // cards pushed the page down under a reader on any load where the articles answered after Home
  // mounted: measured once at 0.23 of layout shift on a phone, over twice Google's "poor" line.
  if (loaded === null) return <CardSkeleton minHeight={READING_CARD_SKELETON_H} titleWidth="4.5rem" lines={0} />
  if (picks.length === 0) return null

  const all = linkTo(WPBL_READING_PAGE, () => track(EVENTS.WPBL_READING_ARCHIVE, { count: articles.length, from: 'home' }))
  return (
    <SectionCard title="Reading" fill action={
      <Box {...all}
        sx={CARD_LINK_SX}>All {articles.length} posts ›</Box>
    }>
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
      {/* Rows at every width: the card shares its row with Watch, and three covers on top in half a
          row would be stamps. */}
      {/* Unboxed rows with a rule between them (see ReadingCard's `rows`), pulled out by their own
          padding so a cover lines up with the card's title rather than sitting a step in from it. */}
      <Box sx={{
        display: 'grid', gap: 0, gridTemplateColumns: '1fr', mx: -1,
        // Doubled &&: each row's own `border: none` is one class too, and this has to outrank it.
        '&& > * + *': { borderTop: '1px solid', borderColor: 'divider' },
      }}>
        {picks.map(a => <ReadingCard key={a.post_id} article={a} teamById={teamById} from="home" rows
          isNew={isNew(String(a.post_id), a.published_at)} onOpen={() => markOpened(String(a.post_id))} />)}
      </Box>
      <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.disabled', mt: 'auto' }}>
        Written by {writers.map((w, i) => (
          <Fragment key={w.key}>
            {i > 0 && (i === writers.length - 1 ? ' and ' : ', ')}
            {w.authorName} for <Box component="span" sx={{ fontStyle: 'italic' }}>{w.publicationName}</Box>
          </Fragment>
        ))}, featured with permission.
      </Typography>
    </Box>
    </SectionCard>
  )
}
