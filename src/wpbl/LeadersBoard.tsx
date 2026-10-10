import { useState } from 'react'
import { Box } from '@mui/material'
import { PlayerPortrait, TeamBadge, useWpblName } from './ui'
import { useWpblPlayerLink } from './LinkContext'
import { LeaderCard, LeaderCardSkeleton, LEADER_GRID_SX, LEADERS_SHOWN, PORTRAIT_PX, printedRanks } from '../ui/leaders'
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

/** Which columns get a card, in reading order, and the card's title. Keys are the Players board's.
 *  Titles are MLB's `leaderLabel`s word for word (src/mlb/constants.ts), in title case, so the two
 *  boards' cards read alike across the league switch. Runs and FIP have no MLB card; they follow the
 *  same style. The strikeout rate names the reader's basis ("K per 7"), as MLB's says "K per 9". */
export const LEADER_CARDS: Record<'hitting' | 'pitching', { key: string; title?: string }[]> = {
  hitting: [
    { key: 'avg', title: 'Batting Average' }, { key: 'obp', title: 'On-Base %' },
    { key: 'ops', title: 'OPS' }, { key: 'hr', title: 'Home Runs' },
    { key: 'rbi', title: 'RBIs' }, { key: 'r', title: 'Runs' },
    { key: 'h', title: 'Hits' }, { key: 'sb', title: 'Stolen Bases' },
  ],
  pitching: [
    { key: 'era', title: 'ERA' }, { key: 'whip', title: 'WHIP' },
    { key: 'so', title: 'Strikeouts' }, { key: 'w', title: 'Wins' },
    { key: 'sv', title: 'Saves' }, { key: 'ip', title: 'Innings Pitched' },
    { key: 'k9' }, { key: 'fip', title: 'FIP' },
  ],
}

/** A card with no title of its own takes its column's label, spelled out: "K/7" reads "K per 7". */
const titleFor = (card: { title?: string }, col: { label: string }) => card.title ?? col.label.replace('/', ' per ')

/** The rows a card shows: qualified first for a rate, best end first, ties broken toward the bigger
 *  sample, and a dash never ranked. Ranks are competition ranks on the number AS PRINTED, the
 *  Players board's rule, so two hitters at .400 share a place. */
export function leadersFor<T extends WpblBattingTotals | WpblPitchingTotals>(
  seasons: LeaderSeason<T>[], col: LeaderCol<T>, side: 'hitting' | 'pitching',
  qual: { active: boolean; minPa: number; minOuts: number },
): { player: WpblPlayer; text: string; rank: number; tied: boolean }[] {
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
    .slice(0, LEADERS_SHOWN)
  const texts = pool.map(x => (col.display ? col.display(x.s.totals) : String(col.value(x.s.totals))))
  const ranks = printedRanks(texts)
  return pool.map((x, i) => ({ player: x.s.player, text: texts[i], ...ranks[i] }))
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
  // The same short form LeaderRow uses: 18 characters, so a card's name column shows whole names.
  const shortName = useWpblName(18)
  const playerLink = useWpblPlayerLink()
  const [hover, setHover] = useState<string | null>(null)
  return (
    <Box sx={LEADER_GRID_SX} onMouseLeave={() => setHover(null)}>
      {LEADER_CARDS[side].map(card => {
        const col = byKey.get(card.key)
        if (!col) return null
        return (
          <LeaderCard key={card.key} title={titleFor(card, col)}
            seeAll={{ href: seeAllHref(card.key), onClick: () => onSeeAll(card.key) }}
            hoverKey={hover} onHover={setHover}
            items={leadersFor(seasons, col, side, qual).map(r => ({
              key: r.player.id, rank: r.rank, tied: r.tied, name: shortName(r.player.name), value: r.text,
              portrait: <PlayerPortrait name={r.player.name} teamId={r.player.team_id} size={PORTRAIT_PX} />,
              badge: r.player.team_id ? <TeamBadge team={{ id: r.player.team_id, abbr: r.player.team_id }} size={16} /> : undefined,
              linkProps: playerLink(r.player, onOpenPlayer),
            }))} />
        )
      })}
    </Box>
  )
}

/** The board before the season's lines have landed: the real titles over ghost rows. Hitting,
 *  because that is the side the tab opens on. */
export function LeadersBoardSkeleton() {
  return (
    <Box aria-hidden sx={LEADER_GRID_SX}>
      {LEADER_CARDS.hitting.map(card => <LeaderCardSkeleton key={card.key} title={card.title ?? card.key} />)}
    </Box>
  )
}
