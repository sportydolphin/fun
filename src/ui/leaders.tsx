import React from 'react'
import { Box, Skeleton, Typography } from '@mui/material'
import { SectionCard, CardLink, TYPE_SCALE } from './card'
import { FOCUS_RING } from './interaction'
import { chromePx } from './scale'
import { useLineNameFit, nameAtStage } from './names'

// ONE LEADER CARD FOR BOTH STATS TABS. Until Oct 2026 MLB drew three tall raised cards of ten with
// medals, a gradient header and a different accent per value, and WPBL a grid of bare cards of five
// with plain ranks, so the same board read as two products across the league switch. Agreed then:
// five rows, ranks as numbers with the top three in the accent and "T-2" for a shared place, no
// medals (an emoji in a section whose every other label is text, and a podium WPBL never had).
//
// The frame and the row are shared; what a row SHOWS is the section's own, the way the Compare
// frame is (src/ui/compare.tsx): MLB's headshot and club logo, WPBL's portrait and badge, each
// section's player link. Neither section imports the other, both import this.

/** Five, in both sections. Ten is the Players table again, card after card. */
export const LEADERS_SHOWN = 5

// A card's narrowest width: the row's type (the rank column, a value like "1.752", and an "F. Last"
// as long as "P. Crow-Armstrong") in rem, plus its structure (card and row padding, the face, the
// club badge, the gaps) in chrome px. Four across at 1440 left a name 79px at Large text, so
// "M. Meidlinger" was cut even after shortening; a fixed column count cannot know the text size,
// the same reason names are never shortened by character count.
const CARD_MIN = `calc(12.25rem + ${chromePx(124)})`

/** The board's grid: as many cards across as fit `CARD_MIN`. Three on a desktop (the page column
 *  caps the width, so 1920 is three too), two at Large text up to about 1280. The second term, a
 *  quarter of the row less a gap, stops a fifth if the column is ever widened. */
export const LEADER_GRID_SX = {
  display: 'grid', gap: 1.5,
  gridTemplateColumns: {
    xs: '1fr',
    sm: `repeat(auto-fill, minmax(min(100%, max(${CARD_MIN}, calc(25% - ${chromePx(12)}))), 1fr))`,
  },
} as const

/** Both sections' accent, for the top three ranks. A rank is text, so the foreground-safe var. */
const RANK_ACCENT = 'var(--wpbl-accent-fg)'

export interface LeaderItem {
  key: string
  /** Competition rank: 1, 1, 3. */
  rank: number
  tied: boolean
  name: string
  /** A round face, `PORTRAIT_PX` across. */
  portrait: React.ReactNode
  /** The club's mark, beside the name. */
  badge?: React.ReactNode
  value: string
  /** A quiet word after the value, at caption size: Find's tally puts "of 11" there, so a count
   *  reads against the player's appearances. */
  valueNote?: string
  /** The player's link, spread onto the row (an `<a>` with its href, from the section's helper). */
  linkProps?: object
}

/** The face's size, in chrome px, for the section drawing it. */
export const PORTRAIT_PX = 32

// One row's box, shared by the loaded row and the skeleton's so the two cannot drift.
const ROW_SX = {
  display: 'flex', alignItems: 'center', gap: 1.25, px: 0.5, py: 0.85,
  borderRadius: 1, textDecoration: 'none', color: 'inherit',
} as const
// "T-10" is the widest thing it holds; five rows never get there, "T-5" is.
const RANK_SX = {
  width: '1.75rem', flexShrink: 0, textAlign: 'center', whiteSpace: 'nowrap',
  fontSize: TYPE_SCALE.meta, fontWeight: 800, fontVariantNumeric: 'tabular-nums', lineHeight: 1,
} as const
const NAME_SX = {
  fontSize: TYPE_SCALE.body, fontWeight: 700, lineHeight: 1.25, minWidth: 0,
  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
} as const
const VALUE_SX = {
  flexShrink: 0, fontSize: TYPE_SCALE.heading, fontWeight: 800, fontVariantNumeric: 'tabular-nums', lineHeight: 1,
} as const
const rule = (i: number) => ({ borderTop: i === 0 ? 'none' : '1px solid', borderColor: 'divider' })
/** Two columns under `when`, filled down the first and then the second, so the ranking still
 *  reads in order. */
const splitSx = (when: string | undefined, half: number) => when ? {
  [when]: {
    display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', columnGap: 3,
    gridAutoFlow: 'column', gridTemplateRows: `repeat(${half}, auto)`,
  },
} : undefined
/** The second column's first row heads its column, so it has no rule above it. */
const splitRule = (when: string | undefined, i: number, half: number) =>
  when && i === half ? { [when]: { borderTop: 'none' } } : {}

export function LeaderCard({ title, seeAll, items, empty = 'Nobody yet', hoverKey, onHover, splitWhen }: {
  title: string
  /** A media or container query under which the rows run down two columns rather than one. For a
   *  card stretched across a wide page (Find's tally under its table), where one column is a list
   *  of names with a screen of nothing between each and its number. */
  splitWhen?: string
  /** The full ranking for this stat: a real address, and the in-app move on a plain click. Left
   *  off where the card IS the whole ranking (Find's tally), so there is nowhere further to go. */
  seeAll?: { href: string; onClick: () => void }
  items: LeaderItem[]
  empty?: string
  /** The player pointed at, on any card: their row lights and every other row dims, so one
   *  player's place across the whole board reads at a glance. Hover devices only. */
  hoverKey?: string | null
  onHover?: (key: string | null) => void
}) {
  const half = Math.ceil(items.length / 2)
  return (
    <SectionCard bare title={title} action={seeAll && <CardLink label="See all ›" href={seeAll.href} onClick={seeAll.onClick} />}>
      {items.length === 0
        ? <Typography sx={{ py: 1.5, color: 'text.secondary', fontSize: TYPE_SCALE.meta }}>{empty}</Typography>
        : <Box sx={splitSx(splitWhen, half)}>
          {items.map((it, i) => {
            const lit = hoverKey === it.key
            const dimmed = hoverKey != null && !lit
            return (
              <Box key={it.key} {...it.linkProps}
                onMouseEnter={onHover ? () => onHover(it.key) : undefined}
                sx={{
                  ...ROW_SX, ...rule(i), ...FOCUS_RING,
                  ...splitRule(splitWhen, i, half),
                  cursor: it.linkProps ? 'pointer' : 'default',
                  opacity: dimmed ? 0.35 : 1,
                  transition: 'opacity 0.18s, background-color 0.18s',
                  '@media (hover: hover)': { '&:hover': it.linkProps ? { bgcolor: 'action.hover' } : {} },
                }}>
                <Box sx={{ ...RANK_SX, color: it.rank <= 3 ? RANK_ACCENT : 'text.disabled' }}>
                  {it.tied ? `T-${it.rank}` : it.rank}
                </Box>
                {it.portrait}
                <Box sx={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 0.75 }}>
                  <LeaderName name={it.name} />
                  {it.badge}
                </Box>
                <Box sx={VALUE_SX}>
                  {it.value}
                  {it.valueNote && (
                    <Box component="span" sx={{ fontSize: TYPE_SCALE.caption, fontWeight: 700, color: 'text.secondary', ml: 0.5 }}>
                      {it.valueNote}
                    </Box>
                  )}
                </Box>
              </Box>
            )
          })}
        </Box>}
    </SectionCard>
  )
}

/** A row's name, shortened to "F. Last" when the card is too narrow for it rather than cut off: four
 *  cards across a 1440 screen left "Ashton Lan…" on the hitting board, and longer names on every
 *  card at Large text. The ellipsis stays only as the net under the last stage (CLAUDE.md). */
function LeaderName({ name }: { name: string }) {
  const { ref, stage } = useLineNameFit<HTMLParagraphElement>([name])
  return <Typography ref={ref} title={stage > 0 ? name : undefined} sx={NAME_SX}>{nameAtStage(name, stage)}</Typography>
}

/** The card before its rows have landed: the real title, which needs no data, over ghost rows of
 *  the loaded row's box, so nothing moves when the names arrive. */
export function LeaderCardSkeleton({ title, rows = LEADERS_SHOWN, seeAll = true, splitWhen }: {
  title: string
  /** The rows the loaded card will have. */
  rows?: number
  /** Whether the loaded card has a "See all" link, so the title line is the same height. */
  seeAll?: boolean
  /** The loaded card's `splitWhen`, so the ghost takes two columns where it will. */
  splitWhen?: string
}) {
  const half = Math.ceil(rows / 2)
  return (
    <SectionCard bare title={title} action={seeAll ? <CardLink label="See all ›" onClick={() => {}} /> : undefined}>
      <Box sx={splitSx(splitWhen, half)}>
        {Array.from({ length: rows }, (_, i) => (
          <Box key={i} sx={{ ...ROW_SX, ...rule(i), ...splitRule(splitWhen, i, half) }}>
            <Box sx={RANK_SX}>&nbsp;</Box>
            <Skeleton variant="circular" width={chromePx(PORTRAIT_PX)} height={chromePx(PORTRAIT_PX)} sx={{ flexShrink: 0 }} />
            <Typography sx={{ ...NAME_SX, flex: 1 }}><Skeleton width="60%" /></Typography>
            <Box sx={VALUE_SX}><Skeleton width="2.5rem" /></Box>
          </Box>
        ))}
      </Box>
    </SectionCard>
  )
}

/** Competition ranks over values already in rank order, judged on the text AS PRINTED (two
 *  hitters at .400 share a place even if the fourth decimal differs), with the tie marked. */
export function printedRanks(texts: string[]): { rank: number; tied: boolean }[] {
  const out: { rank: number; tied: boolean }[] = []
  texts.forEach((t, i) => { out.push({ rank: i > 0 && texts[i - 1] === t ? out[i - 1].rank : i + 1, tied: false }) })
  out.forEach((r, i) => { r.tied = (i > 0 && out[i - 1].rank === r.rank) || (i + 1 < out.length && out[i + 1].rank === r.rank) })
  return out
}
