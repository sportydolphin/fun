import { useEffect, useMemo, useRef, useState } from 'react'
import { Box, Typography } from '@mui/material'
import { WPBL_COMPARE_BASE, wpblComparePath } from '../routes'
import { UNSTYLED_LINK } from '../../nav'
import { SectionCard, TeamBadge, PlayerPortrait, TAPPABLE, hoverOnly, FOCUS_RING, TYPE_SCALE } from '../ui'
import { wpblQualifiers, plateAppearances, fmtRate,
  type WpblBatSeason,
} from '../stats'
import { trackImpression, EVENTS } from '../../lib/analytics'
import type { WpblTeam, WpblPlayer } from '../types'
import { typePx } from '../../ui/scale'
import { trackedLinkTo } from './shared'

// Home's second column points at the compare tool, the one thing in that column a reader cannot
// reach any other way from Home. It costs NO reads: `batSeasons`, `teams` and `players` are
// already in hand, and the pick is pure client-side selection over them.
//
// A DIFFERENT PAIR EACH VISIT, NOT EACH RENDER. The seed is drawn once per mount, so the pair
// holds steady while the reader is on the page and rotates on the next visit. Choosing in the
// render body would reshuffle on every repaint, and the every-two-minutes score poll is a
// repaint: the card would deal a new pair mid-read.

/** Two eligible hitters chosen from `seed`. Anchored anywhere in the OPS order and partnered
 *  within a small window of it, so the two are a real argument rather than the best bat against
 *  the worst. Null until the league has two qualified hitters. `pool` is OPS-sorted. */
function pickComparePair(pool: WpblBatSeason[], seed: number): readonly [WpblBatSeason, WpblBatSeason] | null {
  const n = pool.length
  if (n < 2) return null
  const anchor = Math.floor(seed * n) % n
  // A second draw off the same seed, in [1, min(4, n-1)], added with wraparound so the partner
  // is always in range and never the anchor. The window keeps the pair close in the ranking on
  // all but the few anchors near the end, where the wrap pairs a low bat with a high one, which
  // is variety rather than a bug.
  const step = 1 + (Math.floor(seed * 997) % Math.min(4, n - 1))
  return [pool[anchor], pool[(anchor + step) % n]] as const
}

/**
 * The compare card: two hitters, two stats, a way into the tool.
 *
 * FILL. On desktop it is the shorter card in a subgrid row whose height is set by Last game, so
 * its body is a `flex: 1` column that spreads the heads and the stats through the slack (see the
 * `space-evenly` note inside) rather than pooling it in one place. Below md the grid falls back
 * to a flex column and the card takes its own, much shorter, content height, with nothing to
 * distribute, so the one layout reads at both heights.
 */
export function ComparePreviewCard({ batSeasons, qual, teams, players, loading }: {
  batSeasons: WpblBatSeason[]
  qual: ReturnType<typeof wpblQualifiers>
  teams: WpblTeam[]
  players: WpblPlayer[]
  loading: boolean
}) {
  // One seed for the life of the mount. A stable KEY on this card in Home keeps it from
  // remounting when the two cards in the column swap slots, so the pair does not re-deal then.
  const [seed] = useState(() => Math.random())
  const teamById = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])

  // Qualified hitters, OPS-sorted. The pool the pair is drawn from.
  const pool = useMemo(() =>
    batSeasons
      .filter(s => plateAppearances(s.totals) > 0
        && (!qual.active || plateAppearances(s.totals) >= qual.minPa)
        && s.totals.ops != null)
      .sort((a, b) => (b.totals.ops ?? 0) - (a.totals.ops ?? 0)),
    [batSeasons, qual])

  // WHICH TWO is memoised on the eligible id list, not on the pool array: the score poll rebuilds
  // `batSeasons` (and so `pool`) every two minutes with the same players, and re-picking there
  // would swap the pair under the reader. Their LIVE seasons are then looked up by id below, so
  // the numbers stay current even though the choice does not move.
  const poolKey = pool.map(s => s.player.id).join(',')
  const pairIds = useMemo(() => {
    const picked = pickComparePair(pool, seed)
    return picked ? [picked[0].player.id, picked[1].player.id] as const : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poolKey, seed])
  const pair = useMemo(() => {
    if (!pairIds) return null
    const a = batSeasons.find(s => s.player.id === pairIds[0])
    const b = batSeasons.find(s => s.player.id === pairIds[1])
    return a && b ? [a, b] as const : null
  }, [pairIds, batSeasons])

  // One impression once the data has settled, so this card has the denominator every other card
  // in the feed carries. `hasPair` separates "shown with a real preview" from the empty early-
  // season state, which are different things to a reader deciding whether to tap through.
  const shown = useRef(false)
  useEffect(() => {
    if (shown.current || loading) return
    shown.current = true
    trackImpression(EVENTS.WPBL_COMPARE_SHOWN, { hasPair: !!pair })
  }, [loading, pair])

  const head = (s: WpblBatSeason) => {
    const team = s.player.team_id ? teamById.get(s.player.team_id) : undefined
    return (
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.6, textAlign: 'center' }}>
        <PlayerPortrait name={s.player.name} teamId={s.player.team_id} size={64} />
        <Typography noWrap sx={{ fontSize: TYPE_SCALE.title, fontWeight: 700, lineHeight: 1.2, maxWidth: '100%' }}>
          {s.player.name}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4, maxWidth: '100%' }}>
          {team && <TeamBadge team={team} size={14} />}
          <Typography noWrap sx={{ fontSize: TYPE_SCALE.micro, color: 'text.secondary', minWidth: 0 }}>
            {team ? team.name : 'Free agent'}
          </Typography>
        </Box>
      </Box>
    )
  }

  // One stat, both sides, with the leader's whole cell washed the same way the compare tool does
  // (--wpbl-compare-lead). `leadA` / `leadB` are null on a tie, so neither is marked.
  const statRow = (label: string, aText: string, bText: string, leadA: boolean, leadB: boolean) => {
    // Each value cell GROWS to a full column (Stathead shades the whole column, not a chip round
    // the glyph), so the two numbers use the card's width instead of huddling in a capped strip
    // with margins either side. The label sits at its natural width between them, centred.
    const valCell = (text: string, lead: boolean) => (
      <Box sx={{
        flex: 1, minWidth: 0, alignSelf: 'stretch', borderRadius: 1,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        bgcolor: lead ? 'var(--wpbl-compare-lead)' : 'transparent',
      }}>
        <Typography sx={{ fontSize: TYPE_SCALE.body, fontWeight: lead ? 800 : 600, fontVariantNumeric: 'tabular-nums' }}>
          {text}
        </Typography>
      </Box>
    )
    return (
      <Box key={label} sx={{
        display: 'flex', alignItems: 'center', gap: 1, py: 0.35,
        borderBottom: '1px solid', borderColor: 'divider', '&:last-of-type': { borderBottom: 'none' },
      }}>
        {valCell(aText, leadA)}
        <Typography sx={{ flex: '0 0 auto', px: 1.5, textAlign: 'center', fontSize: TYPE_SCALE.micro, fontWeight: 800, letterSpacing: typePx(0.6), textTransform: 'uppercase', color: 'text.secondary' }}>
          {label}
        </Typography>
        {valCell(bText, leadB)}
      </Box>
    )
  }

  const cta = (
    <Box {...trackedLinkTo(WPBL_COMPARE_BASE, EVENTS.WPBL_COMPARE_OPENED, { from: 'home', pair: false })} sx={{
      ...UNSTYLED_LINK, fontSize: TYPE_SCALE.meta, fontWeight: 700, color: 'var(--wpbl-accent-fg)',
      flexShrink: 0, ...hoverOnly({ textDecoration: 'underline' }), ...FOCUS_RING,
    }}>
      Try it →
    </Box>
  )

  return (
    <SectionCard title="Compare tool" fill action={cta}>
      {loading || !pair ? (
        <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.secondary', py: 1 }}>
          Two players to put side by side, once games are played.
        </Typography>
      ) : (() => {
        const [a, b] = pair
        // A rate compares null-safe (a hitter with no at-bats has no average, not the worse one);
        // a count is always a number here and higher is the leader.
        const rate = (label: string, av: number | null, bv: number | null): [string, string, string, boolean, boolean] =>
          [label, fmtRate(av), fmtRate(bv), av != null && bv != null && av > bv, av != null && bv != null && bv > av]
        const count = (label: string, av: number, bv: number): [string, string, string, boolean, boolean] =>
          [label, String(av), String(bv), av > bv, bv > av]
        // Five stats, a spread rather than a slash line: contact, overall, power, production,
        // speed. Enough to fill the desktop card and read as a real line without turning the
        // preview into the tool it links to.
        const rows: [string, string, string, boolean, boolean][] = [
          rate('AVG', a.totals.avg, b.totals.avg),
          rate('OPS', a.totals.ops, b.totals.ops),
          count('HR', a.totals.hr, b.totals.hr),
          count('RBI', a.totals.rbi, b.totals.rbi),
          count('SB', a.totals.sb, b.totals.sb),
        ]
        return (
          // The whole comparison is one link to these two in the tool; the header's "Pick two"
          // opens the picker. Two separate anchors, siblings not nested, so the markup is valid.
          <Box {...trackedLinkTo(wpblComparePath(a.player, b.player, players), EVENTS.WPBL_COMPARE_OPENED, { from: 'home', pair: true })} sx={{
            // `space-evenly` rather than `center`: on the tall desktop row this spreads the heads
            // and the stat block through the body instead of pooling the slack above and below a
            // tight group; on a phone the card is its own (short) height with no slack, so the two
            // read the same distance apart there. `gap` is the floor the distribution never crosses.
            ...UNSTYLED_LINK, flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-evenly',
            gap: 1.5, borderRadius: 2, p: 0.5, mx: -0.5, ...TAPPABLE, ...FOCUS_RING,
          }}>
            {/* FULL WIDTH, not a capped strip. Each head is its own half and each stat value its own
                column, so the content uses the card's whole width; a cap pulls everything into the
                middle and leaves the left and right thirds of the card empty. */}
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, width: '100%' }}>
              {head(a)}
              <Typography aria-hidden sx={{ alignSelf: 'center', px: 0.5, fontSize: TYPE_SCALE.micro, fontWeight: 800, letterSpacing: typePx(0.6), textTransform: 'uppercase', color: 'text.disabled' }}>
                vs
              </Typography>
              {head(b)}
            </Box>
            <Box sx={{ width: '100%' }}>
              {rows.map(r => statRow(...r))}
            </Box>
          </Box>
        )
      })()}
    </SectionCard>
  )
}
