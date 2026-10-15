import { useState } from 'react'
import { Box } from '@mui/material'
import { PlayerPortrait } from './ui'
import { useWpblPlayerLink } from './LinkContext'
import { LeaderCard, LeaderCardSkeleton, LEADER_GRID_SX, LEADERS_SHOWN, PORTRAIT_PX, printedRanks } from '../ui/leaders'
import { plateAppearances, type WpblBattingTotals, type WpblPitchingTotals, type WpblFieldingTotals } from './stats'
import { compareRows } from './leaderOrder'
import type { WpblPlayer } from './types'
import type { WpblValueTotals } from './derive/playerValue'

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

export type LeaderSide = 'overall' | 'hitting' | 'pitching' | 'fielding'
type LeaderTotals = WpblBattingTotals | WpblPitchingTotals | WpblFieldingTotals | WpblValueTotals
/** The qualifiers this board reads, in each side's unit (stats.ts, `wpblQualifiers`). */
export interface LeaderQual { active: boolean; minPa: number; minOuts: number; minG: number }

/** Which columns get a card, in reading order, and the card's title. Keys are the Players board's.
 *  Titles are MLB's `leaderLabel`s word for word (src/mlb/constants.ts), in title case, so the two
 *  boards' cards read alike across the league switch. Runs and FIP have no MLB card; they follow the
 *  same style. The strikeout rate names the reader's basis ("K per 7"), as MLB's says "K per 9". */
export const LEADER_CARDS: Record<LeaderSide, { key: string; title?: string }[]> = {
  // The whole game in one board, one question: who was best. WAR first, then its two halves, then
  // the runs it is made of. Wins added is not here: it prices plays by the score, so beside WAR it
  // read as a rival total rather than a different question. It is the last column on Players and
  // has its boards on Run value. MLB has no equivalent board, so these titles follow the house
  // style rather than a counterpart.
  overall: [
    { key: 'war', title: 'WAR' }, { key: 'batWar', title: 'Position Player WAR' },
    { key: 'pitWar', title: 'Pitching WAR' }, { key: 'bat', title: 'Batting Runs' },
    { key: 'bsr', title: 'Baserunning Runs' }, { key: 'fld', title: 'Fielding Runs' },
    { key: 'rng', title: 'Range Runs' }, { key: 'pit', title: 'Pitching Runs' },
  ],
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
  // One row of four. Errors and the catcher's columns are left off: a fewest-errors card is led by
  // whoever played least, and a catcher's card ranks four people.
  fielding: [
    { key: 'fpct', title: 'Fielding %' }, { key: 'a', title: 'Assists' },
    { key: 'po', title: 'Putouts' }, { key: 'dp', title: 'Double Plays' },
  ],
}

/** A card with no title of its own takes its column's label, spelled out: "K/7" reads "K per 7". */
const titleFor = (card: { title?: string }, col: { label: string }) => card.title ?? col.label.replace('/', ' per ')

/** The rows a card shows: qualified first for a rate, best end first, ties broken toward the bigger
 *  sample (then the name, leaderOrder.ts), and a dash never ranked. Ranks are competition ranks on the number AS PRINTED, the
 *  Players board's rule, so two hitters at .400 share a place. */
export function leadersFor<T extends LeaderTotals>(
  seasons: LeaderSeason<T>[], col: LeaderCol<T>, side: LeaderSide, qual: LeaderQual,
): { player: WpblPlayer; text: string; rank: number; tied: boolean }[] {
  // Fielding ties break on chances and qualifies on games, the Players board's rules for the side.
  // Overall breaks on the whole of a player's playing time, trips to the plate and batters faced.
  const sample = (t: T) => side === 'pitching' ? (t as WpblPitchingTotals).outs
    : side === 'fielding' ? (t as WpblFieldingTotals).tc
    : side === 'overall' ? (t as WpblValueTotals).pa + (t as WpblValueTotals).outs
    : plateAppearances(t as WpblBattingTotals)
  const qualifies = (t: T) => !qual.active || (side === 'pitching' ? sample(t) >= qual.minOuts
    : side === 'fielding' ? (t as WpblFieldingTotals).g >= qual.minG : sample(t) >= qual.minPa)
  const pool = seasons
    .filter(s => !col.rate || qualifies(s.totals))
    .map(s => ({ s, v: col.value(s.totals) }))
    .filter((x): x is { s: LeaderSeason<T>; v: number } => x.v != null && Number.isFinite(x.v))
    // A counting stat nobody has any of is not a lead. Zero saves at the top of Saves in April
    // would print five names under a number that ranks nobody.
    .filter(x => col.rate || x.v > 0)
    .sort((a, b) => compareRows(a.v, b.v, !!col.lowerBetter, sample(a.s.totals), sample(b.s.totals), a.s.player.name, b.s.player.name))
    .slice(0, LEADERS_SHOWN)
  const texts = pool.map(x => (col.display ? col.display(x.s.totals) : String(col.value(x.s.totals))))
  const ranks = printedRanks(texts)
  return pool.map((x, i) => ({ player: x.s.player, text: texts[i], ...ranks[i] }))
}

export function LeadersBoard<T extends LeaderTotals>({ side, cols, seasons, qual, onOpenPlayer, onSeeAll, seeAllHref }: {
  side: LeaderSide
  cols: LeaderCol<T>[]
  seasons: LeaderSeason<T>[]
  qual: LeaderQual
  onOpenPlayer: (p: WpblPlayer) => void
  onSeeAll: (key: string) => void
  /** The Players board sorted by `key`, as a real address, so "See all" is a link a crawler can follow. */
  seeAllHref: (key: string) => string
}) {
  const byKey = new Map(cols.map(c => [c.key, c]))
  // The same short form LeaderRow uses: 18 characters, so a card's name column shows whole names.
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
              key: r.player.id, rank: r.rank, tied: r.tied, name: r.player.name, value: r.text,
              // No club badge beside the name: the portrait's ring is already the club's colour, and in
              // a league of four the badge said it twice on every row of every card.
              portrait: <PlayerPortrait name={r.player.name} teamId={r.player.team_id} size={PORTRAIT_PX} />,
              linkProps: playerLink(r.player, onOpenPlayer),
            }))} />
        )
      })}
    </Box>
  )
}

/** The board before the season's lines have landed: the real titles over ghost rows, for the side
 *  the address asks for (Hitting, unless it says otherwise). */
export function LeadersBoardSkeleton({ side = 'hitting' }: { side?: LeaderSide }) {
  return (
    <Box aria-hidden sx={LEADER_GRID_SX}>
      {LEADER_CARDS[side].map(card => <LeaderCardSkeleton key={card.key} title={card.title ?? card.key} />)}
    </Box>
  )
}
