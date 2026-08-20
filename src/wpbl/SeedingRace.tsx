import { useEffect, useMemo, useRef } from 'react'
import { Box, Typography } from '@mui/material'
import { SectionCard, TeamBadge, pressable, FOCUS_RING, useWpblDark } from './ui'
import { wpblAccentFg, wpblFullName } from './constants'
import { seedingRace, semifinalLabel, bracketIsSet } from './derive/seeding'
import type { WpblSeedRow } from './derive/seeding'
import { ExperimentalChip } from '../ExperimentsContext'
import { track, EVENTS } from '../lib/analytics'
import type { WpblGame, WpblStandingRow, WpblTeam } from './types'

/**
 * What the remaining regular-season games actually decide.
 *
 * All four clubs go to the postseason, so the Standings table has been presenting a race for
 * a place nobody can miss. The real stake is the ORDER: it sets the semifinals 1v4 and 2v3,
 * and it is the only thing the last games settle. Nothing on the section said so until this
 * card, which is the gap it exists to close, and it is why a clinch tracker and a playoff-odds
 * board stay parked, since in a four-of-four field they have nothing to report.
 *
 * Every number comes from `computeStandings` by way of `derive/seeding`, so there is no new
 * column, no new request, and no way for this to contradict the table it sits under.
 *
 * ONE row per club, not a ladder plus a bracket. The first version drew the four clubs twice,
 * as two bracket boxes and then as a list, so the same badges and names were said over again
 * while each row carried a name at the left margin, a number at the right, and a hand's width
 * of nothing in between. The matchup is a column now, which removes the second copy and puts
 * something worth reading in the middle of the row.
 */

const ORDINALS = ['', '1st', '2nd', '3rd', '4th']
const ordinal = (n: number) => ORDINALS[n] ?? `${n}th`

/** Column widths, shared by the header and every row so the cells line up as a table without
 *  being one. Named because the alignment breaks silently the moment two of them disagree. */
const W_SEED = { xs: 14, sm: 18 }
const W_BADGE = 26
const W_RECORD = { xs: 42, sm: 52 }
const W_CUSHION = 132
const W_STATUS = { xs: 92, sm: 116 }
const W_SEMI = { xs: 58, sm: 112 }

/** How far clear of the seed below, named: "0.5 ahead of Queens". A bare games-back figure in
 *  a cell always begs "behind whom?", and the club it means is never the one the Standings
 *  table's own GB column measures against, so the answer has to be in the cell rather than in
 *  a header. */
function cushionLabel(s: WpblSeedRow, below: WpblSeedRow | undefined): string {
  if (!below) return ''
  const gb = s.aheadOfNext ?? 0
  if (gb === 0) return `level with ${below.team.name}`
  return `${gb % 1 === 0 ? gb : gb.toFixed(1)} ahead of ${below.team.name}`
}

/** The one thing worth saying about a club's seed, in priority order: settled beats a floor
 *  beats a countdown beats a ceiling. Never more than one, because four rows of hedged
 *  clauses is a paragraph, and a fan reads this to learn one fact per club.
 *
 *  The magic number is split from its label so the figure carries the weight. Four rows all
 *  reading "8 to lock Nth" is the shape this column has for most of a season, and setting the
 *  whole phrase at one size made the only part that differs the hardest part to find. */
function seedStatus(s: WpblSeedRow): { count: number | null; text: string; strong: boolean } {
  if (s.bestPossible === s.worstPossible) return { count: null, text: `${ordinal(s.seed)} seed set`, strong: true }
  // magic 0 means it cannot fall below where it sits, but can still climb.
  if (s.magic === 0) return { count: null, text: `No worse than ${ordinal(s.seed)}`, strong: true }
  if (s.magic != null) return { count: s.magic, text: `to lock ${ordinal(s.seed)}`, strong: false }
  // Bottom seed, still able to climb: it has nothing to defend, so the only live fact is how
  // high it can still get.
  return { count: null, text: `Can still reach ${ordinal(s.bestPossible)}`, strong: false }
}

export default function SeedingRace({ rows, games, onOpenTeam }: {
  /** Standings rows, in order, from `computeStandings`: the same array the table above renders. */
  rows: WpblStandingRow[]
  games: WpblGame[]
  onOpenTeam?: (t: WpblTeam) => void
}) {
  const dark = useWpblDark()
  const seeds = useMemo(() => seedingRace(rows, games), [rows, games])
  const settled = bracketIsSet(seeds)
  // Each remaining game sits on two clubs' cards, so the sum double-counts. Rounded rather
  // than halved outright: a scheduled game against a club missing from `rows` would otherwise
  // put half a game on the screen.
  const left = Math.round(seeds.reduce((n, s) => n + s.remaining, 0) / 2)

  // One impression per mount, not per render. The Standings pane stays mounted once visited,
  // so a ref is enough and an effect keyed on the numbers would re-fire every time a score
  // came in mid-poll. `wpbl_tab_viewed` can say a reader reached Standings and nothing else
  // can say whether this card was under the fold or on screen.
  const logged = useRef(false)
  useEffect(() => {
    if (logged.current || seeds.length === 0) return
    logged.current = true
    track(EVENTS.WPBL_SEEDING_SHOWN, { settled, gamesLeft: left })
  }, [seeds.length, settled, left])

  if (seeds.length === 0) return null

  // Every club here is a tap through to a team page. Player pages are the section's retention
  // event and Standings is the surface with no route to one, so where the rows land matters
  // more than the card's own numbers do.
  const openTeam = (s: WpblSeedRow) => onOpenTeam
    ? () => { track(EVENTS.WPBL_SEEDING_TEAM, { teamId: s.team.id, seed: s.seed }); onOpenTeam(s.team) }
    : undefined

  const micro = {
    fontSize: '0.58rem', fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase' as const,
    color: 'text.disabled', whiteSpace: 'nowrap' as const, flexShrink: 0,
  }

  return (
    <SectionCard
      title={settled ? 'The bracket' : 'Seeding race'}
      // The card is behind the experiments flag and looks exactly like the shipped cards it
      // sits between, so it has to say which one it is. Someone who turned the switch on weeks
      // ago should not have to remember.
      action={<ExperimentalChip />}
      subtitle={settled
        ? 'The order is final. Semifinals are best-of-three, the championship best-of-five.'
        : `All four clubs reach the postseason, so the last ${left} game${left === 1 ? '' : 's'} only decide the bracket.`}
    >
      {/* Micro-headers rather than none. The two right-hand columns say things a reader has no
          prior for on this section, a magic number and a matchup that does not exist yet, and
          one 9px line of label is cheaper than explaining either in prose underneath. */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 0.5, pb: 0.5 }}>
        <Box sx={{ width: W_SEED, flexShrink: 0 }} />
        <Box sx={{ width: W_BADGE, flexShrink: 0, display: { xs: 'none', sm: 'block' } }} />
        <Typography sx={{ ...micro, flex: 1, minWidth: 0 }}>Club</Typography>
        <Typography sx={{ ...micro, width: W_RECORD, textAlign: 'right' }}>W-L</Typography>
        <Box sx={{ width: W_CUSHION, flexShrink: 0, display: { xs: 'none', md: 'block' } }} />
        <Typography sx={{ ...micro, width: W_STATUS, textAlign: 'right' }}>
          {settled ? 'Seed' : 'To lock'}
        </Typography>
        <Typography sx={{ ...micro, width: W_SEMI, textAlign: 'right' }}>Semifinal</Typography>
      </Box>

      <Box sx={{ display: 'flex', flexDirection: 'column' }}>
        {seeds.map((s, i) => {
          const status = seedStatus(s)
          const semi = semifinalLabel(s.seed)
          const cushion = cushionLabel(s, seeds[i + 1])
          return (
            <Box
              key={s.team.id}
              {...pressable(openTeam(s))}
              sx={{
                display: 'flex', alignItems: 'center', gap: 0.75, px: 0.5, py: 0.85,
                borderTop: '1px solid', borderColor: 'divider',
                cursor: onOpenTeam ? 'pointer' : 'default',
                '&:hover': onOpenTeam ? { bgcolor: 'action.hover' } : undefined,
                ...FOCUS_RING,
              }}
            >
              <Typography sx={{
                fontSize: '0.82rem', fontWeight: 800, width: W_SEED, flexShrink: 0,
                color: 'text.secondary', fontVariantNumeric: 'tabular-nums',
              }}>{s.seed}</Typography>
              {/* The badge is the row's only colour and the one cell carrying no information
                  the row does not already state, so it is what goes when a phone has six
                  columns to fit into 375px. */}
              <Box sx={{ flexShrink: 0, display: { xs: 'none', sm: 'flex' } }}>
                <TeamBadge team={s.team} size={W_BADGE} />
              </Box>
              <Typography sx={{
                fontSize: '0.85rem', fontWeight: 600, flex: 1, minWidth: 0,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>{wpblFullName(s.team)}</Box>
                <Box component="span" sx={{ display: { xs: 'inline', sm: 'none' } }}>{s.team.name}</Box>
              </Typography>

              <Typography sx={{
                fontSize: '0.85rem', fontWeight: 700, width: W_RECORD, flexShrink: 0,
                textAlign: 'right', fontVariantNumeric: 'tabular-nums',
              }}>{s.wins}-{s.losses}</Typography>

              {/* The cushion over the seed below. First column to drop as the card narrows: it
                  is the one figure here a reader can approximate from the table above. */}
              <Typography sx={{
                fontSize: '0.72rem', width: W_CUSHION, flexShrink: 0, textAlign: 'right',
                color: 'text.disabled', whiteSpace: 'nowrap',
                display: { xs: 'none', md: 'block' },
              }}>{cushion || '—'}</Typography>

              <Box sx={{
                width: W_STATUS, flexShrink: 0, display: 'flex', alignItems: 'baseline',
                justifyContent: 'flex-end', gap: 0.5,
              }}>
                {status.count != null && (
                  <Typography sx={{
                    fontSize: '1rem', fontWeight: 800, lineHeight: 1,
                    color: wpblAccentFg(dark), fontVariantNumeric: 'tabular-nums',
                  }}>{status.count}</Typography>
                )}
                <Typography sx={{
                  fontSize: '0.7rem', textAlign: 'right', lineHeight: 1.25,
                  fontWeight: status.strong ? 700 : 500,
                  color: status.strong ? 'var(--wpbl-pos)' : 'text.secondary',
                }}>{status.text}</Typography>
              </Box>

              {/* The two clubs of a semifinal are never adjacent on a list ordered by seed, so
                  the letter is the only thing pairing them. The opponent is spelled out where
                  there is room and left to the letter plus the 1v4 / 2v3 rule where there is not. */}
              <Box sx={{
                width: W_SEMI, flexShrink: 0, display: 'flex', alignItems: 'center',
                justifyContent: 'flex-end', gap: 0.75, minWidth: 0,
              }}>
                {s.opponent && (
                  <Typography sx={{
                    fontSize: '0.72rem', color: 'text.secondary', whiteSpace: 'nowrap',
                    overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>vs {s.opponent.name}</Box>
                    <Box component="span" sx={{ display: { xs: 'inline', sm: 'none' } }}>vs {s.opponent.abbr}</Box>
                  </Typography>
                )}
                {semi && (
                  <Box sx={{
                    width: 18, height: 18, borderRadius: 0.75, flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    bgcolor: 'action.selected',
                  }}>
                    <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, color: 'text.secondary', lineHeight: 1 }}>
                      {semi}
                    </Typography>
                  </Box>
                )}
              </Box>
            </Box>
          )
        })}
      </Box>

      <Typography sx={{ fontSize: '0.66rem', color: 'text.disabled', mt: 1.25, lineHeight: 1.45 }}>
        {settled
          ? 'Semifinals begin Sep 9. A and B are our labels for the two pairings, not the league’s.'
          : 'A club’s number counts its own wins plus its rivals’ losses: at zero that seed is locked outright, with no tiebreak needed. Semifinals begin Sep 9, pairing seeds 1v4 and 2v3.'}
      </Typography>
    </SectionCard>
  )
}
