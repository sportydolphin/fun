import { Fragment, useState } from 'react'
import { Box, Typography } from '@mui/material'
import { TeamBadge, CARD_BORDER, CARD_FILL, chromePx, hoverOnly } from './ui'
import { readMinutes, sourceOf, sourcePhoto, coverAt, type SubstackSource } from './derive/articles'
import { recapThumb, PUBLICATION_NAME as RECAP_PUBLICATION } from './derive/recaps'
import type { WpblArticle, WpblGameRecap, WpblTeam } from './types'
import { track, EVENTS } from '../lib/analytics'

// The WPBL reading surface: a mirror of two independent writers' coverage of the league,
// read from the wpbl_articles table (populated by scripts/sync-wpbl-substack.ts). Four
// consumers share this file: the /wpbl/reading page (ReadingPage.tsx), Home's latest-post line,
// the story card on a finished game, and the "written about" lists on a player and a team page.
//
// EVERY CARD HERE LEAVES THE SITE. There is no lightbox and no in-app reader, which is the
// one way this deliberately differs from the highlights rail next to it. The highlights
// lightbox exists because an embedded player genuinely beats bouncing to YouTube; there is
// no equivalent win for prose, and rendering someone's article inside our own chrome is the
// copyright problem wearing a hat. The whole point of the feature is to send readers to the
// writer.
//
// EVERY CARD NAMES ITS WRITER, looked up from the row's `source` (SOURCES in derive/articles.ts).
// With two writers that stopped being optional: a headline with no name on it is credited to
// whichever writer the reader met first, or to us.

/** Where every card points, and how it points there. `noopener` is not optional on a
 *  target=_blank link: without it the opened page gets a handle on ours through
 *  window.opener. */
const linkProps = { target: '_blank', rel: 'noopener noreferrer' } as const

/** Which surface a click came from. The breakdown is the point of tracking this at all:
 *  it is what says whether the story card on a game and the list on a player page earn
 *  their keep, or whether the Reading page and Home's line are doing all the work. ('rail' and
 *  'archive' are the retired league-page shelf and its modal, and remain in the old events.) */
export type ReadingSource = 'page' | 'home' | 'game' | 'player'

/** One click through to the writer's work.
 *
 *  Safe to fire from an anchor's onClick without preventDefault: these links open in a new
 *  tab, so this page is never unloaded and the fire-and-forget insert has time to land. A
 *  same-tab navigation would need a beacon instead. */
function trackOpen(article: WpblArticle, from: ReadingSource): void {
  track(EVENTS.WPBL_ARTICLE_OPENED, {
    postId: article.post_id,
    source: article.source,
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
 *  for five minutes of their attention. Counts the embedded clips as well as the words: the
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

/**
 * The writer's credit at the head of the Reading page, and the one block in the section that is
 * about a person who is not us.
 *
 * The writer does this for love rather than as a syndication partner, so the credit is a face
 * and a sentence in the writer's own words rather than a line of fine print, and the whole row
 * is the link: it is the only door here that leads somewhere other than a single article.
 *
 * IT HAS TO SAY WHOSE WORDS THEY ARE. A first-person bio ("I am a writer and amateur baseball
 * player from Albany.") shown verbatim with no lead-in, inside one of our cards, is read as this
 * site's author speaking, and readers have come away thinking the person who runs
 * sportydolphin.fun is mary mustard. That is worse than a cosmetic problem. It misattributes the
 * writing and it misrepresents us, in both directions at once.
 *
 * So the framing does the work rather than the size. "Written by" gives the sentence a subject
 * before the name appears. The bio is in quotation marks, so the "I" is unambiguously the
 * writer's and not ours. And the publication line names whose Substack it is, which is the fact
 * a confused reader is actually missing. The page's standfirst names the writer too, so the
 * attribution is there before this card is even reached (see ReadingPage).
 *
 * Small as well, since the point is a credit rather than an author bio: this is not the
 * masthead of the page, it is a thank-you and a door to the writing.
 *
 * On the photo size, which is still larger than a 3-line block wants: the Substack profile photo
 * is a wide shot on a ballfield rather than a head-and-shoulders portrait, and the source is
 * already square, so there is no crop available that finds a face: Substack's CDN has
 * Cloudinary's face gravity disabled (`g_face` 404s), leaving only a centred fill of the whole
 * frame. A portrait would let this go smaller and read better for it.
 */
export function AuthorByline({ source, compact, from }: { source: SubstackSource; compact?: boolean; from: ReadingSource }) {
  const size = compact ? 34 : 40
  return (
    <Box
      component="a"
      href={`https://${source.host}`}
      {...linkProps}
      onClick={() => track(EVENTS.WPBL_AUTHOR_OPENED, { from, source: source.key })}
      aria-label={`Written by ${source.authorName} for their Substack, ${source.publicationName}, opens in a new tab`}
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
      its own context, so lazy buys nothing, and inside the archive modal it breaks:
      mounted there the intersection check never fires and the avatar sits blank forever,
      having made no request at all. The covers keep `loading="lazy"` because there are a
      dozen of them, they are large, and they sit in a horizontal scroller that genuinely
      starts them off-screen. */}
      <Box
        component="img"
        src={sourcePhoto(source, size * 2)}
        alt=""
        sx={{ width: size, height: size, borderRadius: '50%', flexShrink: 0, objectFit: 'cover', bgcolor: 'action.hover' }}
      />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography sx={{ fontSize: '0.76rem', color: 'text.secondary', lineHeight: 1.3 }}>
          Written by{' '}
          <Box component="span" sx={{ fontWeight: 700, color: 'text.primary' }}>{source.authorName}</Box>
        </Typography>
        {/* A first-person bio goes in quotation marks, which is the whole point: unquoted under
            our heading, "I am a writer..." reads as ours. A third-person one reads as a
            description and needs none. See `bioIsQuote`. */}
        {/* Not on a phone, where two stacked credits with their bios filled most of the first
            screen before a single headline. "Written by" and the publication line carry the
            attribution on their own; the bio is the nice-to-have. */}
        <Typography sx={{ display: { xs: 'none', sm: 'block' }, fontSize: '0.7rem', color: 'text.disabled', lineHeight: 1.35, fontStyle: source.bioIsQuote ? 'italic' : 'normal' }}>
          {source.bioIsQuote ? `“${source.bio}”` : source.bio}
        </Typography>
        <Typography sx={{ fontSize: '0.68rem', fontWeight: 600, color: 'text.disabled', mt: 0.2 }}>
          {source.publicationName} · <Box component="span" sx={{ whiteSpace: 'nowrap' }}>their Substack ↗</Box>
        </Typography>
      </Box>
    </Box>
  )
}

// ─── The Reading page ───────────────────────────────────────────────────────────

/** Each writer, date and cost as its own unbreakable run, so a narrow card wraps BETWEEN them.
 *  Left to the browser, a phone broke "7 min read" into "7" and "min read" on two lines. */
function MetaLine({ article, sx }: { article: WpblArticle; sx?: object }) {
  // "7 min" on a phone, "7 min read" from `sm` up: the full label was the one word that pushed a
  // phone row's meta onto a second line, on nearly every row.
  const cost = <>{readMinutes(article.word_count, article.video_count)} min<Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}> read</Box></>
  const parts = [sourceOf(article.source).authorName, dateLabel(article.published_at), cost].filter(Boolean)
  return (
    <Typography sx={{ fontSize: '0.68rem', fontWeight: 600, color: 'text.disabled', lineHeight: 1.4, ...sx }}>
      {/* The arrow rides inside the last run: as a sibling there is no break opportunity before
          it, so a full line pushed it past the card's edge and the card's overflow clipped it. */}
      {parts.map((p, i) => (
        <Fragment key={i}>
          {i > 0 && ' · '}
          <Box component="span" sx={{ whiteSpace: 'nowrap' }}>{p}{i === parts.length - 1 && <ExternalMark />}</Box>
        </Fragment>
      ))}
    </Typography>
  )
}

/** The cover, with the clubs laid over its corner. The badges used to share the meta line, and
 *  on a phone three of them left the writer, date and cost about 120px to wrap into, which they
 *  did across three lines. On the picture they cost no width at all.
 *
 *  A srcset rather than one fixed width because the same card draws its cover at ~104px on a
 *  phone and ~400px in the desktop grid: one size is either blurry on desktop or a large
 *  download for a thumbnail on a phone. Only offered for Substack's CDN, which can resize; any
 *  other URL passes through at whatever size it is (see coverAt). */
function Cover({ article, teamById, widths, sizes, lead, badge = 20, sx }: {
  article: WpblArticle; teamById: Map<string, WpblTeam>
  widths: number[]; sizes: string; lead?: boolean; badge?: number; sx?: object
}) {
  const url = article.cover_url
  const resizable = !!url && coverAt(url, widths[0]) !== url
  const teams = article.team_ids.map(id => teamById.get(id)).filter((t): t is WpblTeam => !!t).slice(0, 3)
  return (
    <Box sx={{ position: 'relative', flexShrink: 0, overflow: 'hidden', bgcolor: 'action.hover', ...sx }}>
      {url && (
        <Box component="img" alt=""
          src={coverAt(url, widths[widths.length - 1]) ?? undefined}
          srcSet={resizable ? widths.map(w => `${coverAt(url, w)} ${w}w`).join(', ') : undefined}
          sizes={resizable ? sizes : undefined}
          // The lead is the page's largest paint and always on screen, so it is neither lazy nor
          // left queued behind the grid's requests.
          loading={lead ? 'eager' : 'lazy'} decoding="async"
          {...(lead ? { fetchpriority: 'high' } : {})}
          sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
      )}
      {teams.length > 0 && (
        <Box sx={{ position: 'absolute', left: 6, bottom: 6, display: 'flex', gap: 0.4 }}>
          {teams.map(t => <TeamBadge key={t.id} team={t} size={badge} />)}
        </Box>
      )}
    </Box>
  )
}

const cardSx = {
  textDecoration: 'none', color: 'inherit', overflow: 'hidden',
  borderRadius: 2, border: '1px solid', borderColor: CARD_BORDER, bgcolor: CARD_FILL,
  transition: 'border-color 0.15s, background 0.15s',
  ...hoverOnly({ borderColor: 'text.disabled', bgcolor: 'action.hover' }),
  '&:active': { transform: 'scale(0.995)' },
  '&:focus-visible': { outline: '2px solid', outlineColor: 'text.primary', outlineOffset: 2 },
} as const

/** The newest post in view, drawn large at the head of /wpbl/reading. On a phone it is the one
 *  full-width picture on the page; on a desktop the cover and the headline sit side by side. The
 *  dek runs longer here than on a card because this is the one post the page is putting forward. */
export function ReadingLead({ article, teamById, from }: {
  article: WpblArticle; teamById: Map<string, WpblTeam>; from: ReadingSource
}) {
  return (
    <Box component="a" href={article.url} {...linkProps}
      onClick={() => trackOpen(article, from)}
      aria-label={`Read: ${article.title}, ${readLabel(article)}, opens in a new tab`}
      sx={{ ...cardSx, display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1.2fr 1fr' } }}
    >
      <Cover article={article} teamById={teamById} lead badge={26}
        widths={[480, 800, 1200]} sizes="(max-width: 899px) 100vw, 640px"
        sx={{ aspectRatio: '16 / 9' }} />
      <Box sx={{ p: { xs: 1.5, md: 2.25 }, display: 'flex', flexDirection: 'column', justifyContent: 'center', minWidth: 0 }}>
        <Typography sx={{ fontSize: '0.66rem', fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: 'text.secondary' }}>
          Latest
        </Typography>
        <Typography sx={{ fontSize: { xs: '1.15rem', md: '1.4rem' }, fontWeight: 800, lineHeight: 1.2, letterSpacing: '-0.2px', mt: 0.5 }}>
          {article.title}
        </Typography>
        {article.subtitle && (
          <Typography sx={{
            fontSize: { xs: '0.8rem', md: '0.88rem' }, color: 'text.secondary', lineHeight: 1.45, mt: 0.75,
            display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>
            {article.subtitle}
          </Typography>
        )}
        <MetaLine article={article} sx={{ mt: 1.25, fontSize: '0.72rem' }} />
      </Box>
    </Box>
  )
}

/** One post on /wpbl/reading. A compact row on a phone, where a list scans faster than a grid of
 *  pictures, and a cover-on-top card from `sm` up, where one column of 80px rows left most of a
 *  desktop screen empty. One component with a responsive layout rather than two, so the two
 *  cannot drift apart in what they say about a post. Several of the deks are the best line in the
 *  piece ("Let us stand athwart convention and start, instead, at the end"), which is exactly what
 *  earns a click, so both layouts keep it.
 *
 *  The phone row stretches its cover to the row rather than fixing its height: the headlines are
 *  long and good and wrap to between two and four lines, and a fixed cover top-aligned in a row
 *  that tall leaves a different band of dead air under every picture. */
export function ReadingCard({ article, teamById, from }: {
  article: WpblArticle; teamById: Map<string, WpblTeam>; from: ReadingSource
}) {
  return (
    <Box component="a" href={article.url} {...linkProps}
      onClick={() => trackOpen(article, from)}
      aria-label={`Read: ${article.title}, ${readLabel(article)}, opens in a new tab`}
      sx={{
        ...cardSx, display: 'flex', flexDirection: { xs: 'row', sm: 'column' }, alignItems: 'stretch',
        gap: { xs: 1.25, sm: 0 }, p: { xs: 1, sm: 0 }, height: '100%',
      }}
    >
      <Cover article={article} teamById={teamById} badge={18}
        widths={[240, 480, 720]} sizes="(max-width: 599px) 104px, (max-width: 1199px) 50vw, 400px"
        sx={{
          width: { xs: chromePx(104), sm: '100%' }, minHeight: { xs: chromePx(72), sm: 0 },
          aspectRatio: { xs: 'auto', sm: '16 / 9' }, borderRadius: { xs: 1.5, sm: 0 },
        }} />
      <Box sx={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', p: { xs: 0, sm: 1.25 } }}>
        <Typography sx={{ fontSize: { xs: '0.85rem', sm: '0.9rem' }, fontWeight: 700, lineHeight: 1.3 }}>{article.title}</Typography>
        {article.subtitle && (
          <Typography sx={{
            fontSize: '0.75rem', color: 'text.secondary', lineHeight: 1.4, mt: 0.35,
            display: '-webkit-box', WebkitLineClamp: { xs: 2, sm: 3 }, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>
            {article.subtitle}
          </Typography>
        )}
        {/* Pinned to the foot of a grid card, so the meta lines along a row of cards line up
            whatever length each headline runs to. */}
        <MetaLine article={article} sx={{ mt: { xs: 0.5, sm: 'auto' }, pt: { xs: 0, sm: 1 } }} />
      </Box>
    </Box>
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
      aria-label={`Read the story by ${sourceOf(article.source).authorName}: ${article.title}, opens in a new tab`}
      sx={{
        display: 'flex', alignItems: 'center', gap: 1.25, textDecoration: 'none', color: 'inherit',
        // Borderless in Game Center: this sits directly above the win-probability card, and two
        // bordered boxes stacked read as clutter (see the note in GameDetail's recap panel). The
        // hover tint alone carries the affordance; the row still indents 8px so the highlight has
        // air around it.
        p: 1, borderRadius: 2,
        transition: 'background 0.15s',
        ...hoverOnly({ bgcolor: 'action.hover' }),
        '&:active': { transform: 'scale(0.99)' },
        '&:focus-visible': { outline: '2px solid', outlineColor: 'text.primary', outlineOffset: 2 },
      }}
    >
      <Box sx={{ position: 'relative', width: chromePx(108), flexShrink: 0, aspectRatio: '16 / 9', borderRadius: 1.5, overflow: 'hidden', bgcolor: 'action.hover' }}>
        {article.cover_url && (
          <Box component="img" src={coverAt(article.cover_url, 280) ?? undefined} alt="" loading="lazy"
            sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
        )}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontSize: '0.7rem', fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: 'text.secondary' }}>
          Story
        </Typography>
        <Typography sx={{
          fontSize: '0.82rem', fontWeight: 600, lineHeight: 1.3, mt: 0.25,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>
          {article.title}
        </Typography>
        <Typography sx={{ fontSize: '0.68rem', color: 'text.disabled', mt: 0.25 }}>
          {sourceOf(article.source).authorName} · {readLabel(article)} ↗
        </Typography>
      </Box>
    </Box>
  )
}

/**
 * The recap link on a game, from This is Women's Baseball.
 *
 * A SECOND SOURCE, AND DELIBERATELY THE SAME SHAPE as `GameStoryCard` directly above it. They
 * are two independent people writing about the same game and there is no reason a reader should
 * have to learn two layouts to tell that; what has to differ is whose name is on it, which is
 * why the credit is the loudest thing on the card after the headline.
 *
 * THE PICTURE IS THEIRS AND STAYS THEIRS. `cover_url` points at their own CDN and is rendered
 * straight into an `<img src>`, so the bytes are served by them every time: this embeds their
 * title card, it does not keep a copy of it. `recapThumb` asks that CDN for the width actually
 * drawn, which is 248 KB down to 18 KB and is the only reason a thumbnail on a game page is
 * affordable at all.
 *
 * NO DEK, on purpose. Their feed offers the lede and these recaps are short enough that the lede
 * is close to half the article, so the card carries a headline and a link and nothing that could
 * stand in for reading it. See docs/RECAPS.md.
 */
export function GameRecapLinkCard({ recap }: { recap: WpblGameRecap }) {
  const thumb = recapThumb(recap.cover_url, 320)
  return (
    <Box
      component="a"
      href={recap.url}
      {...linkProps}
      onClick={() => track(EVENTS.WPBL_RECAP_OPENED, { gameId: recap.game_id, url: recap.url })}
      aria-label={`Read the recap by ${RECAP_PUBLICATION}: ${recap.title}, opens in a new tab`}
      sx={{
        display: 'flex', alignItems: 'center', gap: 1.25, textDecoration: 'none', color: 'inherit',
        // Borderless in Game Center: this sits directly above the win-probability card, and two
        // bordered boxes stacked read as clutter (see the note in GameDetail's recap panel). The
        // hover tint alone carries the affordance; the row still indents 8px so the highlight has
        // air around it.
        p: 1, borderRadius: 2,
        transition: 'background 0.15s',
        ...hoverOnly({ bgcolor: 'action.hover' }),
        '&:active': { transform: 'scale(0.99)' },
        '&:focus-visible': { outline: '2px solid', outlineColor: 'text.primary', outlineOffset: 2 },
      }}
    >
      <Box sx={{
        position: 'relative', width: chromePx(108), flexShrink: 0, aspectRatio: '16 / 9',
        borderRadius: 1.5, overflow: 'hidden', bgcolor: 'action.hover',
      }}>
        {thumb && (
          <Box component="img" src={thumb} alt="" loading="lazy"
            sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
        )}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        {/* A LABEL, NOT AN INSTRUCTION. It names the block so a reader can scan past it; the
            verb lives in the link's accessible name above, where it describes a destination.
            Its sibling `GameStoryCard` says "Story" for the same reason: the two sit one above
            the other and a reader should be able to tell them apart at a glance rather than by
            reading two near-identical sentences. */}
        <Typography sx={{ fontSize: '0.7rem', fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: 'text.secondary' }}>
          Recap
        </Typography>
        <Typography sx={{
          fontSize: '0.82rem', fontWeight: 600, lineHeight: 1.3, mt: 0.25,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>
          {recap.title}
        </Typography>
        {/* THEIR NAME, NOT OURS, and it is the whole reason this line exists. A headline and a
        thumbnail inside our chrome reads as our reporting unless something says otherwise;
        readers of the Reading rail have come away thinking its Substack writer ran this site.
        So the publication is named in full on every card. */}
        <Typography sx={{ fontSize: '0.68rem', color: 'text.disabled', mt: 0.25 }}>
          {RECAP_PUBLICATION} · {dateLabel(recap.published_at)} ↗
        </Typography>
      </Box>
    </Box>
  )
}

// ─── Written about (the player page) ─────────────────────────────────────────────

/** How many posts the list shows before "Show more". Three is what most players have in full,
 *  and past three a player page is spending its foot on links rather than on the player. */
const WRITTEN_ABOUT_INITIAL = 3

/** The "written about" list on a player page: headline, writer and date, no cover art.
 *
 *  A PLAIN LIST, NOT CARDS. It sits at the foot of a page of stat tables, and five bordered boxes
 *  two across were the heaviest block on it while being the least read. Rows with a hairline
 *  between them carry the same links in a third of the ink. On a desktop the byline sits on the
 *  right of the headline's row; on a phone, under it, where there is no room beside it.
 *
 *  Renders nothing when nobody has written about this player, which is the common case and
 *  should stay silent rather than showing an empty shell. */
export function WrittenAbout({ articles, title, limit = 8, from = 'player' }: {
  articles: WpblArticle[]
  /** e.g. "Written about Denae Benites". */
  title?: string
  /** The most the list will ever show, expanded. */
  limit?: number
  /** Which surface this list is on, for the click-through breakdown. */
  from?: ReadingSource
  /** Accepted and ignored: the list is one column at every width now. Kept so a caller from the
   *  two-across card layout does not have to change in the same commit. */
  wide?: boolean
}) {
  const [open, setOpen] = useState(false)
  const all = articles.slice(0, limit)
  if (all.length === 0) return null
  const shown = open ? all : all.slice(0, WRITTEN_ABOUT_INITIAL)
  const hidden = all.length - shown.length
  return (
    <Box sx={{ mt: title ? 2 : 0 }}>
      {title && (
        <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5, color: 'text.secondary', mb: 0.5 }}>
          {title}
        </Typography>
      )}
      <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {shown.map(a => (
          <Box component="li" key={a.post_id} sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
            <Box
              component="a"
              href={a.url}
              {...linkProps}
              onClick={() => trackOpen(a, from)}
              aria-label={`Read: ${a.title}, by ${sourceOf(a.source).authorName}, ${readLabel(a)}, opens in a new tab`}
              sx={{
                display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, alignItems: { sm: 'baseline' },
                columnGap: 2, rowGap: 0.2, py: 0.9, px: 0.5, mx: -0.5, borderRadius: 1,
                textDecoration: 'none', color: 'inherit',
                ...hoverOnly({ bgcolor: 'action.hover' }),
                '&:focus-visible': { outline: '2px solid', outlineColor: 'text.primary', outlineOffset: 1 },
              }}
            >
              <Typography sx={{ flex: 1, minWidth: 0, fontSize: '0.82rem', fontWeight: 600, lineHeight: 1.35 }}>
                {a.title}
              </Typography>
              <Typography sx={{ flexShrink: 0, fontSize: '0.68rem', color: 'text.disabled', whiteSpace: 'nowrap' }}>
                {sourceOf(a.source).authorName} · {dateLabel(a.published_at)} · {readMinutes(a.word_count, a.video_count)} min ↗
              </Typography>
            </Box>
          </Box>
        ))}
      </Box>
      {hidden > 0 && (
        <Box component="button" type="button" onClick={() => setOpen(true)}
          sx={{
            mt: 0.75, p: 0, border: 0, bgcolor: 'transparent', cursor: 'pointer', font: 'inherit',
            fontSize: '0.72rem', fontWeight: 800, color: 'text.secondary',
            ...hoverOnly({ color: 'text.primary' }),
            '&:focus-visible': { outline: '2px solid', outlineColor: 'text.primary', outlineOffset: 2, borderRadius: 1 },
          }}>
          Show {hidden} more
        </Box>
      )}
    </Box>
  )
}
