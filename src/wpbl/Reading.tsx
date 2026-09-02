import { useCallback, useMemo, useState } from 'react'
import { Box, Typography } from '@mui/material'
import { ModalShell, TeamBadge, CARD_BORDER, useRailPaging, RailArrow, RailScroller, chromePx, hoverOnly } from './ui'
import { readMinutes, authorPhoto, AUTHOR_BIO, AUTHOR_NAME, PUBLICATION_NAME, PUBLICATION_URL } from './derive/articles'
import type { WpblArticle, WpblTeam } from './types'
import { track, EVENTS } from '../lib/analytics'

// The WPBL reading surface: a mirror of an independent writer's coverage of the league,
// read from the wpbl_articles table (populated by scripts/sync-wpbl-substack.ts). Four
// consumers share this file: the Home "Reading" rail, the story card on a finished game,
// the "written about" lists on a player and a team page, and the full archive modal.
//
// EVERY CARD HERE LEAVES THE SITE. There is no lightbox and no in-app reader, which is the
// one way this deliberately differs from the highlights rail next to it. The highlights
// lightbox exists because an embedded player genuinely beats bouncing to YouTube; there is
// no equivalent win for prose, and rendering someone's article inside our own chrome is the
// copyright problem wearing a hat. The whole point of the feature is to send readers to her.

/** Where every card points, and how it points there. `noopener` is not optional on a
 *  target=_blank link: without it the opened page gets a handle on ours through
 *  window.opener. */
const linkProps = { target: '_blank', rel: 'noopener noreferrer' } as const

/** Which surface a click came from. The breakdown is the point of tracking this at all:
 *  it is what says whether the story card on a game and the list on a player page earn
 *  their keep, or whether the Home rail is doing all the work. */
export type ReadingSource = 'rail' | 'archive' | 'game' | 'player'

/** One click through to her writing.
 *
 *  Safe to fire from an anchor's onClick without preventDefault: these links open in a new
 *  tab, so this page is never unloaded and the fire-and-forget insert has time to land. A
 *  same-tab navigation would need a beacon instead. */
function trackOpen(article: WpblArticle, from: ReadingSource): void {
  track(EVENTS.WPBL_ARTICLE_OPENED, {
    postId: article.post_id,
    slug: article.slug,
    from,
    minutes: readMinutes(article.word_count, article.video_count),
  })
}

/** "Aug 16" for a card, from the post's publish time. */
function dateLabel(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

/** "4 min read", the one piece of metadata worth putting on a card that is asking someone
 *  for five minutes of their attention. Counts the embedded clips as well as the words: her
 *  posts carry up to five, and a short video-heavy piece takes far longer than its word
 *  count suggests. See readMinutes(). */
const readLabel = (a: WpblArticle) => `${readMinutes(a.word_count, a.video_count)} min read`

// The little arrow that marks a card as leaving the site. Drawn rather than pulled from an
// icon font, matching how the play triangle and the disclosure chevron are done in this
// section.
function ExternalMark() {
  return (
    <Box component="span" aria-hidden sx={{ fontSize: '0.7rem', color: 'text.disabled', ml: 0.4, flexShrink: 0 }}>↗</Box>
  )
}

// The badges on a card: the clubs the post is about, or nothing at all. A post can be about
// the league generally (a schedule release, a "who should I root for") and those genuinely
// have no club, so the row collapses rather than inventing a label for them.
function TeamBadges({ article, teamById }: { article: WpblArticle; teamById: Map<string, WpblTeam> }) {
  const teams = article.team_ids.map(id => teamById.get(id)).filter((t): t is WpblTeam => !!t)
  if (teams.length === 0) return null
  return (
    <>
      {teams.slice(0, 3).map(t => <TeamBadge key={t.id} team={t} size={20} />)}
    </>
  )
}

// ─── The Home rail ───────────────────────────────────────────────────────────────

// One card in the Home rail: cover image, the clubs it is about, the date, the headline,
// and what it will cost you to read it. Sized to match the highlights card beside it, so
// the two rails read as a pair rather than two unrelated strips.
function RailCard({ article, teamById }: { article: WpblArticle; teamById: Map<string, WpblTeam> }) {
  return (
    <Box
      component="a"
      href={article.url}
      {...linkProps}
      onClick={() => trackOpen(article, 'rail')}
      aria-label={`Read: ${article.title}, ${readLabel(article)}, opens in a new tab`}
      sx={{
        display: 'block', textDecoration: 'none', color: 'inherit',
        flexShrink: 0, width: { xs: 232, sm: 248 }, scrollSnapAlign: 'start',
        borderRadius: 2, overflow: 'hidden', border: '1px solid', borderColor: CARD_BORDER,
        bgcolor: 'background.paper', transition: 'transform 0.1s, border-color 0.15s',
        ...hoverOnly({ borderColor: 'text.disabled' }),
        '&:active': { transform: 'scale(0.985)' },
        '&:focus-visible': { outline: '2px solid', outlineColor: 'text.primary', outlineOffset: 2 },
      }}
    >
      {/* Fixed 16:9 with objectFit cover. Most of her covers are 1920x1080, but a few are
          square, and letting those set their own height would make the rail's cards
          different heights and break the snap alignment. */}
      <Box sx={{ position: 'relative', width: '100%', aspectRatio: '16 / 9', bgcolor: 'action.hover' }}>
        {article.cover_url && (
          <Box component="img" src={article.cover_url} alt="" loading="lazy"
            sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
        )}
      </Box>
      <Box sx={{ p: 1, pt: 0.85 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5, minHeight: 22 }}>
          <TeamBadges article={article} teamById={teamById} />
          <Box sx={{ flex: 1 }} />
          <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, color: 'text.disabled' }}>
            {dateLabel(article.published_at)}
          </Typography>
        </Box>
        <Typography sx={{
          fontSize: '0.78rem', fontWeight: 600, lineHeight: 1.3,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>
          {article.title}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', mt: 0.5 }}>
          <Typography sx={{ fontSize: '0.66rem', fontWeight: 600, color: 'text.disabled' }}>
            {readLabel(article)}
          </Typography>
          <ExternalMark />
        </Box>
      </Box>
    </Box>
  )
}

// Collapsed state is remembered per browser, matching the highlights rail's own key and for
// the same reasons set out there: a per-device layout choice, needed on the very first
// paint, and the section is usable signed out. Storage is wrapped because it throws in
// private mode and inside some in-app browsers.
/**
 * The credit under the Reading rail, and the one block on Home that is about a person who is
 * not us.
 *
 * She is someone writing this for love rather than a syndication partner, so the credit is a
 * face and a sentence in her own words rather than a line of fine print, and the whole row is
 * the link: it is the only door here that leads somewhere other than a single article.
 *
 * IT HAS TO SAY SO, and until Aug 26, 2026 it did not. It showed her photo at 52px, her name,
 * and then her own bio verbatim, "I am a writer and amateur baseball player from Albany.",
 * with no lead-in at all, inside one of our cards. A first-person sentence in a card on
 * somebody's site is read as that site's author speaking, and it was: readers came away
 * thinking the person who runs sportydolphin.fun is mary mustard. That is worse than a
 * cosmetic problem. It misattributes her writing and it misrepresents us, in both directions
 * at once.
 *
 * Three changes, and the framing is doing the work rather than the size. "Written by" gives
 * the sentence a subject before her name appears. Her bio is in quotation marks, so the "I"
 * is unambiguously hers and not ours. And the publication line says "her Substack", which is
 * the fact a confused reader is actually missing. The shelf's own subtitle names her too, so
 * the attribution is there before this card is even reached (see MediaShelf).
 *
 * Smaller as well, since the point is a credit rather than an author bio: this is not the
 * masthead of the page, it is a thank-you and a door to her writing.
 *
 * On the photo size, which is down from 52/40 but still larger than a 3-line block wants: her
 * Substack profile photo is a wide shot of her on a ballfield rather than a head-and-shoulders
 * portrait, and the source is already square, so there is no crop available that finds her
 * face: Substack's CDN has Cloudinary's face gravity disabled (`g_face` 404s), leaving only a
 * centred fill of the whole frame. If she ever sends a portrait this can go smaller again and
 * will read better for it.
 */
export function AuthorByline({ compact, from }: { compact?: boolean; from: ReadingSource }) {
  const size = compact ? 34 : 40
  return (
    <Box
      component="a"
      href={PUBLICATION_URL}
      {...linkProps}
      onClick={() => track(EVENTS.WPBL_AUTHOR_OPENED, { from })}
      aria-label={`Written by ${AUTHOR_NAME} for her Substack, ${PUBLICATION_NAME}, opens in a new tab`}
      sx={{
        display: 'flex', alignItems: 'center', gap: 1.25, textDecoration: 'none', color: 'inherit',
        p: 1, borderRadius: 2, border: '1px solid', borderColor: CARD_BORDER,
        transition: 'border-color 0.15s, background 0.15s',
        ...hoverOnly({ borderColor: 'text.disabled', bgcolor: 'action.hover' }),
        '&:focus-visible': { outline: '2px solid', outlineColor: 'text.primary', outlineOffset: 2 },
      }}
    >
      {/* Requested at 2x the display size for a retina screen, and no larger: see
          authorPhoto() for why that number is worth caring about.

          NOT lazy, unlike the cover images on the cards. It is ~3 KB and always visible in
          its own context, so lazy buys nothing, and it actively broke inside the archive
          modal: mounted there the intersection check never fired and the avatar sat blank
          forever, having made no request at all. The covers keep `loading="lazy"` because
          there are a dozen of them, they are large, and they sit in a horizontal scroller
          that genuinely starts them off-screen. */}
      <Box
        component="img"
        src={authorPhoto(size * 2)}
        alt=""
        sx={{ width: size, height: size, borderRadius: '50%', flexShrink: 0, objectFit: 'cover', bgcolor: 'action.hover' }}
      />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography sx={{ fontSize: '0.76rem', color: 'text.secondary', lineHeight: 1.3 }}>
          Written by{' '}
          <Box component="span" sx={{ fontWeight: 700, color: 'text.primary' }}>{AUTHOR_NAME}</Box>
        </Typography>
        {/* HER words, in quotation marks. The quotes are the whole point: the sentence is
            first person, and unquoted under our heading it reads as ours. */}
        <Typography sx={{ fontSize: '0.7rem', color: 'text.disabled', lineHeight: 1.35, fontStyle: 'italic' }}>
          “{AUTHOR_BIO}”
        </Typography>
        <Typography sx={{ fontSize: '0.68rem', fontWeight: 600, color: 'text.disabled', mt: 0.2 }}>
          {PUBLICATION_NAME} · her Substack ↗
        </Typography>
      </Box>
    </Box>
  )
}

/**
 * The Reading strip, as one segment of Home's media shelf.
 *
 * Bare on purpose: no SectionCard, no collapse, no title. Those belong to the shelf now, which
 * is what lets Reading, Highlights and Archive share one card instead of stacking three
 * near-identical strips down the left column (see MediaShelf.tsx).
 *
 * The byline stays here rather than moving up to the shelf. It is the credit for THIS
 * segment's content, and hoisting it would leave her name sitting over a rail of YouTube
 * thumbnails whenever somebody switched to Highlights.
 */
export function ReadingStrip({ articles, teams }: { articles: WpblArticle[]; teams: WpblTeam[] }) {
  const teamById = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])
  const [archiveOpen, setArchiveOpen] = useState(false)
  // Newest first (the query already orders this way). Capped so the strip stays glanceable;
  // "See all" opens the rest.
  const shown = useMemo(() => articles.slice(0, 12), [articles])
  const { scrollRef, canPrev, canNext, syncEdges, page } = useRailPaging(shown.length)

  const openArchive = useCallback(() => {
    track(EVENTS.WPBL_READING_ARCHIVE, { count: articles.length })
    setArchiveOpen(true)
  }, [articles.length])

  if (shown.length === 0) return null
  return (
    <>
      <Box sx={{ position: 'relative' }}>
        <RailScroller scrollRef={scrollRef} onScroll={syncEdges}>
          {shown.map(a => <RailCard key={a.post_id} article={a} teamById={teamById} />)}
        </RailScroller>
        <RailArrow dir="left" show={canPrev} onClick={() => page(-1)} label="articles" />
        <RailArrow dir="right" show={canNext} onClick={() => page(1)} label="articles" />
      </Box>
      <Box sx={{ mt: 1.25 }}><AuthorByline from="rail" /></Box>
      {/* Always offered, not just once the strip overflows. She files about twice a week, so a
          "more than twelve" gate would leave the archive unreachable for months; and the
          archive is not merely "the rest", it is the same posts with their deks showing. */}
      <Box sx={{ mt: 1 }}>
        <Box
          onClick={openArchive}
          role="button"
          tabIndex={0}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openArchive() } }}
          sx={{
            display: 'inline-block', fontSize: '0.72rem', fontWeight: 700,
            color: 'text.secondary', cursor: 'pointer', px: 0.5, borderRadius: 1,
            '&:hover': { color: 'text.primary' },
            '&:focus-visible': { outline: '2px solid', outlineColor: 'text.primary', outlineOffset: 2 },
          }}
        >
          All {articles.length} posts
        </Box>
      </Box>
      {archiveOpen && (
        <ReadingArchive articles={articles} teamById={teamById} onClose={() => setArchiveOpen(false)} />
      )}
    </>
  )
}

// ─── The archive ────────────────────────────────────────────────────────────────

// A row in the full archive: wider than a rail card, so the dek gets to do its job. Several
// of her deks are the best line in the piece ("Let us stand athwart convention and start,
// instead, at the end"), which is exactly what earns a click.
function ArchiveRow({ article, teamById }: { article: WpblArticle; teamById: Map<string, WpblTeam> }) {
  return (
    <Box
      component="a"
      href={article.url}
      {...linkProps}
      onClick={() => trackOpen(article, 'archive')}
      aria-label={`Read: ${article.title}, ${readLabel(article)}, opens in a new tab`}
      sx={{
        // `stretch`, not `flex-start`. Her headlines are long and good ("I Cannot Overstate
        // to You How Good Denae Benites is Playing WPBL Baseball Right Now") so they wrap to
        // anywhere between two and four lines, and rows run 81px to 113px tall. A
        // fixed-height 16:9 thumbnail top-aligned in that left 27 to 59px of dead air
        // underneath it, different on every row, which is what made the list look ragged.
        // Clamping the titles instead would even the rows out at the cost of the headline,
        // and the headline is the entire product here.
        display: 'flex', gap: 1.25, alignItems: 'stretch', textDecoration: 'none', color: 'inherit',
        p: 1.25, borderRadius: 2, border: '1px solid', borderColor: CARD_BORDER,
        bgcolor: 'background.paper',
        transition: 'border-color 0.15s, background 0.15s',
        ...hoverOnly({ borderColor: 'text.disabled', bgcolor: 'action.hover' }),
        '&:focus-visible': { outline: '2px solid', outlineColor: 'text.primary', outlineOffset: 2 },
      }}
    >
      {/* Fixed width, height taken from the row. `minHeight` keeps the shortest rows from
          squeezing the cover into a letterbox slot. */}
      <Box sx={{
        position: 'relative', width: chromePx(96), flexShrink: 0, minHeight: chromePx(62),
        borderRadius: 1.5, overflow: 'hidden', bgcolor: 'action.hover',
      }}>
        {article.cover_url && (
          <Box component="img" src={article.cover_url} alt="" loading="lazy"
            sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
        )}
      </Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography sx={{ fontSize: '0.85rem', fontWeight: 700, lineHeight: 1.3 }}>{article.title}</Typography>
        {article.subtitle && (
          <Typography sx={{
            fontSize: '0.75rem', color: 'text.secondary', lineHeight: 1.35, mt: 0.25,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>
            {article.subtitle}
          </Typography>
        )}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 0.5 }}>
          <TeamBadges article={article} teamById={teamById} />
          <Typography sx={{ fontSize: '0.68rem', fontWeight: 600, color: 'text.disabled' }}>
            {dateLabel(article.published_at)} · {readLabel(article)}
          </Typography>
          <ExternalMark />
        </Box>
      </Box>
    </Box>
  )
}

export function ReadingArchive({ articles, teamById, onClose }: {
  articles: WpblArticle[]
  teamById: Map<string, WpblTeam>
  onClose: () => void
}) {
  return (
    // The count belongs in the eyebrow, next to the section name, the same shape the team
    // page's full-season modal uses ("Boston Hunters · 15 games"). It replaces a sentence
    // that sat above the list saying the list was a list: the byline already says whose
    // writing this is, the dates already say it runs newest first, and "everything mary has
    // written about the league, newest first" wrapped to two lines to say neither.
    <ModalShell
      eyebrow={`Reading · ${articles.length} post${articles.length === 1 ? '' : 's'}`}
      onClose={onClose}
      maxWidth={640}
      zIndex={1600}
    >
      <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {/* The byline leads here rather than trailing. On Home the rail is the point and she
            is the credit under it; in her own archive she is the point. */}
        <AuthorByline compact from="archive" />
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {articles.map(a => <ArchiveRow key={a.post_id} article={a} teamById={teamById} />)}
        </Box>
      </Box>
    </ModalShell>
  )
}

// ─── The story on a game ─────────────────────────────────────────────────────────

/** The strip shown at the top of GameDetail for a final that a post recaps. Deliberately
 *  the same shape as GameHighlightCard, which sits directly above it: watch it, then read
 *  about it. */
export function GameStoryCard({ article }: { article: WpblArticle }) {
  return (
    <Box
      component="a"
      href={article.url}
      {...linkProps}
      onClick={() => trackOpen(article, 'game')}
      aria-label={`Read the story: ${article.title}, opens in a new tab`}
      sx={{
        display: 'flex', alignItems: 'center', gap: 1.25, textDecoration: 'none', color: 'inherit',
        p: 1, borderRadius: 2, border: '1px solid', borderColor: CARD_BORDER, bgcolor: 'background.paper',
        transition: 'border-color 0.15s, background 0.15s',
        ...hoverOnly({ borderColor: 'text.disabled', bgcolor: 'action.hover' }),
        '&:active': { transform: 'scale(0.99)' },
        '&:focus-visible': { outline: '2px solid', outlineColor: 'text.primary', outlineOffset: 2 },
      }}
    >
      <Box sx={{ position: 'relative', width: chromePx(108), flexShrink: 0, aspectRatio: '16 / 9', borderRadius: 1.5, overflow: 'hidden', bgcolor: 'action.hover' }}>
        {article.cover_url && (
          <Box component="img" src={article.cover_url} alt="" loading="lazy"
            sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
        )}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontSize: '0.7rem', fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: 'text.secondary' }}>
          Read the story
        </Typography>
        <Typography sx={{
          fontSize: '0.82rem', fontWeight: 600, lineHeight: 1.3, mt: 0.25,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>
          {article.title}
        </Typography>
        <Typography sx={{ fontSize: '0.68rem', color: 'text.disabled', mt: 0.25 }}>
          {AUTHOR_NAME} · {readLabel(article)} ↗
        </Typography>
      </Box>
    </Box>
  )
}

// ─── Written about (player and team pages) ───────────────────────────────────────

/** The "written about" list on a player page and a team page. Headline, dek and cost, no
 *  cover art: it sits among dense stat blocks, and a column of thumbnails there competes
 *  with the numbers rather than supporting them.
 *
 *  Renders nothing when nobody has written about this subject, which is the common case for
 *  a player and should stay silent rather than showing an empty shell. */
export function WrittenAbout({ articles, title, limit = 5, from = 'player', wide }: {
  articles: WpblArticle[]
  /** e.g. "Written about Denae Benites". Omit where the surrounding card already carries
   *  the heading, as the team page's does: repeating it there reads as a stutter. */
  title?: string
  limit?: number
  /** Which surface this list is on, for the click-through breakdown. */
  from?: ReadingSource
  /** The list is running the full width of a desktop layout rather than sitting in a column,
   *  so lay the cards two across. Five 790px-wide cards down a single column is a lot of
   *  height spent on five links, and each card is mostly empty besides. */
  wide?: boolean
}) {
  const shown = articles.slice(0, limit)
  if (shown.length === 0) return null
  return (
    <Box sx={{ mt: title ? 2 : 0 }}>
      {title && (
        <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5, color: 'text.secondary', mb: 1 }}>
          {title}
        </Typography>
      )}
      <Box sx={wide
        ? { display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'repeat(2, 1fr)' }, gap: 0.75, alignItems: 'start' }
        : { display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        {shown.map(a => (
          <Box
            key={a.post_id}
            component="a"
            href={a.url}
            {...linkProps}
            onClick={() => trackOpen(a, from)}
            aria-label={`Read: ${a.title}, ${readLabel(a)}, opens in a new tab`}
            sx={{
              display: 'block', textDecoration: 'none', color: 'inherit',
              p: 1, borderRadius: 1.5, border: '1px solid', borderColor: CARD_BORDER,
              transition: 'border-color 0.15s, background 0.15s',
              ...hoverOnly({ borderColor: 'text.disabled', bgcolor: 'action.hover' }),
              '&:focus-visible': { outline: '2px solid', outlineColor: 'text.primary', outlineOffset: 2 },
            }}
          >
            <Typography sx={{
              fontSize: '0.8rem', fontWeight: 600, lineHeight: 1.3,
              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
            }}>
              {a.title}
            </Typography>
            <Typography sx={{ fontSize: '0.66rem', color: 'text.disabled', mt: 0.35 }}>
              {AUTHOR_NAME} · {dateLabel(a.published_at)} · {readLabel(a)} ↗
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  )
}
