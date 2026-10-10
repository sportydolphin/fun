import React from 'react'
import { Box, Skeleton, Typography } from '@mui/material'
import { SectionCard, CardLink, TYPE_SCALE } from './card'
import { FOCUS_RING } from './interaction'
import { chromePx } from './scale'

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

/** The board's grid. Four across on a wide screen: eight cards fill two rows. */
export const LEADER_GRID_SX = {
  display: 'grid', gap: 1.5,
  gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' },
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

export function LeaderCard({ title, seeAll, items, empty = 'Nobody yet', hoverKey, onHover }: {
  title: string
  /** The full ranking for this stat: a real address, and the in-app move on a plain click. */
  seeAll: { href: string; onClick: () => void }
  items: LeaderItem[]
  empty?: string
  /** The player pointed at, on any card: their row lights and every other row dims, so one
   *  player's place across the whole board reads at a glance. Hover devices only. */
  hoverKey?: string | null
  onHover?: (key: string | null) => void
}) {
  return (
    <SectionCard bare title={title} action={<CardLink label="See all ›" href={seeAll.href} onClick={seeAll.onClick} />}>
      {items.length === 0
        ? <Typography sx={{ py: 1.5, color: 'text.secondary', fontSize: TYPE_SCALE.meta }}>{empty}</Typography>
        : items.map((it, i) => {
            const lit = hoverKey === it.key
            const dimmed = hoverKey != null && !lit
            return (
              <Box key={it.key} {...it.linkProps}
                onMouseEnter={onHover ? () => onHover(it.key) : undefined}
                sx={{
                  ...ROW_SX, ...rule(i), ...FOCUS_RING,
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
                  <Typography sx={NAME_SX}>{it.name}</Typography>
                  {it.badge}
                </Box>
                <Box sx={VALUE_SX}>{it.value}</Box>
              </Box>
            )
          })}
    </SectionCard>
  )
}

/** The card before its rows have landed: the real title, which needs no data, over ghost rows of
 *  the loaded row's box, so nothing moves when the names arrive. */
export function LeaderCardSkeleton({ title }: { title: string }) {
  return (
    <SectionCard bare title={title} action={<CardLink label="See all ›" onClick={() => {}} />}>
      {Array.from({ length: LEADERS_SHOWN }, (_, i) => (
        <Box key={i} sx={{ ...ROW_SX, ...rule(i) }}>
          <Box sx={RANK_SX}>&nbsp;</Box>
          <Skeleton variant="circular" width={chromePx(PORTRAIT_PX)} height={chromePx(PORTRAIT_PX)} sx={{ flexShrink: 0 }} />
          <Typography sx={{ ...NAME_SX, flex: 1 }}><Skeleton width="60%" /></Typography>
          <Box sx={VALUE_SX}><Skeleton width="2.5rem" /></Box>
        </Box>
      ))}
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
