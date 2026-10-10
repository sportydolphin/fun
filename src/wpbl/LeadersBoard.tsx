import { Box, Skeleton } from '@mui/material'
import { SectionCard, LeaderRow, chromePx } from './ui'
import { CardLink } from '../ui/card'
import { WPBL_ACCENT } from './constants'
import { plateAppearances, type WpblBattingTotals, type WpblPitchingTotals } from './stats'
import type { WpblPlayer } from './types'

// THE STATS TAB'S FIRST BOARD: the top five in each headline stat, one card each. MLB's Stats tab
// opened on this shape and WPBL's on the full table, so a reader switching leagues on the same tab
// got two different first answers (the second alignment pass in ROADMAP.md). The two boards are two
// levels of one question: this is who leads everything, Players is one stat all the way down, and
// each card's "See all" opens Players sorted by its stat.
//
// NO ARITHMETIC OF ITS OWN. The rows are the season aggregates StatsView already builds, and every
// figure is printed by the Players board's own column (`display`), so ERA comes out on the reader's
// basis and wRC+ on the league's weights by construction. Two definitions of a leaderboard on one
// tab is how a card and the table under it come to disagree.
//
// RATES ARE GATED ON THE QUALIFIER AND COUNTING STATS ARE NOT, the rule `teamLeaders` uses: a .600
// average in ten trips is not a batting title, and nine home runs led the league whether or not the
// hitter batted enough to hold a rate title. The gate is plate appearances and outs, never at-bats
// (CLAUDE.md, "The rate-title bar").

/** The slice of a Players column this board needs. Structural, so StatsView's columns pass as-is. */
export interface LeaderCol<T> {
  key: string
  label: string
  value: (t: T) => number | null
  display?: (t: T) => string
  rate?: boolean
  lowerBetter?: boolean
}

export interface LeaderSeason<T> { player: WpblPlayer; totals: T }

/** Five, everywhere. Ten is the Players board again, card after card. */
const SHOWN = 5

/** Which columns get a card, in reading order, and the card's title. Keys are the Players board's.
 *  Short noun phrases, as every card title on the site is. The strikeout rate takes its column's
 *  own label, since its basis (K/7 or K/9) is the reader's setting. */
export const LEADER_CARDS: Record<'hitting' | 'pitching', { key: string; title?: string }[]> = {
  hitting: [
    { key: 'avg', title: 'Batting average' }, { key: 'obp', title: 'On-base percentage' },
    { key: 'ops', title: 'OPS' }, { key: 'hr', title: 'Home runs' },
    { key: 'rbi', title: 'Runs batted in' }, { key: 'r', title: 'Runs' },
    { key: 'h', title: 'Hits' }, { key: 'sb', title: 'Stolen bases' },
  ],
  pitching: [
    { key: 'era', title: 'ERA' }, { key: 'whip', title: 'WHIP' },
    { key: 'so', title: 'Strikeouts' }, { key: 'w', title: 'Wins' },
    { key: 'sv', title: 'Saves' }, { key: 'ip', title: 'Innings pitched' },
    { key: 'k9' }, { key: 'fip', title: 'FIP' },
  ],
}

const GRID_SX = {
  display: 'grid', gap: 1.5,
  gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' },
} as const

/** The rows a card shows: qualified first for a rate, best end first, ties broken toward the bigger
 *  sample, and a dash never ranked. Ranks are competition ranks on the number AS PRINTED, the
 *  Players board's rule, so two hitters at .400 are both 1. */
export function leadersFor<T extends WpblBattingTotals | WpblPitchingTotals>(
  seasons: LeaderSeason<T>[], col: LeaderCol<T>, side: 'hitting' | 'pitching',
  qual: { active: boolean; minPa: number; minOuts: number },
): { player: WpblPlayer; text: string; rank: number }[] {
  const sample = (t: T) => side === 'pitching' ? (t as WpblPitchingTotals).outs : plateAppearances(t as WpblBattingTotals)
  const qualifies = (t: T) => !qual.active || (side === 'pitching' ? sample(t) >= qual.minOuts : sample(t) >= qual.minPa)
  const pool = seasons
    .filter(s => !col.rate || qualifies(s.totals))
    .map(s => ({ s, v: col.value(s.totals) }))
    .filter((x): x is { s: LeaderSeason<T>; v: number } => x.v != null && Number.isFinite(x.v))
    // A counting stat nobody has any of is not a lead. Zero saves at the top of Saves in April
    // would print five names under a number that ranks nobody.
    .filter(x => col.rate || x.v > 0)
    .sort((a, b) => (a.v !== b.v ? (col.lowerBetter ? a.v - b.v : b.v - a.v) : sample(b.s.totals) - sample(a.s.totals)))
    .slice(0, SHOWN)
  const text = (t: T) => (col.display ? col.display(t) : String(col.value(t)))
  const out: { player: WpblPlayer; text: string; rank: number }[] = []
  pool.forEach((x, i) => {
    const t = text(x.s.totals)
    out.push({ player: x.s.player, text: t, rank: i > 0 && out[i - 1].text === t ? out[i - 1].rank : i + 1 })
  })
  return out
}

export function LeadersBoard<T extends WpblBattingTotals | WpblPitchingTotals>({ side, cols, seasons, qual, onOpenPlayer, onSeeAll, seeAllHref }: {
  side: 'hitting' | 'pitching'
  cols: LeaderCol<T>[]
  seasons: LeaderSeason<T>[]
  qual: { active: boolean; minPa: number; minOuts: number }
  onOpenPlayer: (p: WpblPlayer) => void
  onSeeAll: (key: string) => void
  /** The Players board sorted by `key`, as a real address, so "See all" is a link a crawler can follow. */
  seeAllHref: (key: string) => string
}) {
  const byKey = new Map(cols.map(c => [c.key, c]))
  return (
    <Box sx={GRID_SX}>
      {LEADER_CARDS[side].map(card => {
        const col = byKey.get(card.key)
        if (!col) return null
        const rows = leadersFor(seasons, col, side, qual)
        return (
          <SectionCard key={card.key} bare title={card.title ?? col.label}
            action={<CardLink label="See all ›" href={seeAllHref(card.key)} onClick={() => onSeeAll(card.key)} />}>
            {rows.length === 0
              ? <Box sx={{ py: 1.5, color: 'text.secondary', fontSize: '0.8rem' }}>Nobody yet</Box>
              : rows.map(r => (
                  <LeaderRow key={r.player.id} rank={r.rank} player={r.player} name={r.player.name}
                    teamId={r.player.team_id} value={r.text} accent={WPBL_ACCENT} onOpen={onOpenPlayer} />
                ))}
          </SectionCard>
        )
      })}
    </Box>
  )
}

/** The board before the season's lines have landed: the real titles, which need no data, over five
 *  ghost rows each, so nothing moves when the names arrive. Hitting, because that is the side the
 *  tab opens on. A ghost row is a LeaderRow's box: 32px portrait, its padding and its rule. */
export function LeadersBoardSkeleton() {
  return (
    <Box aria-hidden sx={GRID_SX}>
      {LEADER_CARDS.hitting.map(card => (
        <SectionCard key={card.key} bare title={card.title ?? card.key}
          action={<CardLink label="See all ›" onClick={() => {}} />}>
          {Array.from({ length: SHOWN }, (_, i) => (
            <Box key={i} sx={{
              display: 'flex', alignItems: 'center', gap: 1.25, px: 0.5, py: 0.85,
              borderTop: i === 0 ? 'none' : '1px solid', borderColor: 'divider',
            }}>
              <Box sx={{ width: '1.125rem', flexShrink: 0 }} />
              <Skeleton variant="circular" width={chromePx(32)} height={chromePx(32)} sx={{ flexShrink: 0 }} />
              <Box sx={{ flex: 1, fontSize: '0.85rem' }}><Skeleton width="60%" /></Box>
              <Box sx={{ fontSize: '1.05rem' }}><Skeleton width="2.5rem" /></Box>
            </Box>
          ))}
        </SectionCard>
      ))}
    </Box>
  )
}
