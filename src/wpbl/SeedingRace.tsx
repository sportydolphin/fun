import { useEffect, useMemo, useRef } from 'react'
import { Box, Typography } from '@mui/material'
import { SectionCard, TeamBadge, pressable, FOCUS_RING, chromePx, useWpblDark, tappableIf } from './ui'
import { wpblAccentFg, wpblFullName, relativeDayLabel } from './constants'
import { seedingRace, semifinalLabel, bracketIsSet, swingGames } from './derive/seeding'
import type { WpblSeedRow } from './derive/seeding'
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
 *
 * The drawn bracket lives on Home instead (PlayoffBracket.tsx), where there is no list beside
 * it for it to repeat. The two are deliberately different readings of the same four rows: this
 * one is per club and quantitative, a magic number and a cushion; that one is per series and
 * spatial. Which is why this card is no longer titled "The bracket" when the order settles,
 * even though it once was: there is a real bracket on the section now, and only one thing can
 * carry that name. The bracket came out from behind the experiments flag first and this
 * followed on Sep 1, five days before the race it describes stops existing: an opt-in card is
 * seen by almost nobody, and a countdown nobody sees is not a cautious countdown, it is an
 * unread one.
 */

const ORDINALS = ['', '1st', '2nd', '3rd', '4th']
const ordinal = (n: number) => ORDINALS[n] ?? `${n}th`

/** Column widths, shared by the header and every row so the cells line up as a table without
 *  being one. Named because the alignment breaks silently the moment two of them disagree.
 *
 *  IN REM, BECAUSE EVERY ONE OF THEM RESERVES ROOM FOR A STRING. This card was written before
 *  the desktop rebuild and was invisible to its sweep, because the sweep worked by rendering
 *  each surface and looking at it, and this one was behind the experiments flag. So it kept
 *  raw px around type that now renders 25% larger on a desktop, and every column was a little
 *  too small in exactly the way that trap describes: the cushion overflowed its box by 8px,
 *  the status cell wrapped "Can still reach 3rd" onto two lines and made one row taller than
 *  the other three, and the header's badge spacer sat 6.5px left of the badges it was spacing
 *  for, since the badge scales and a bare number does not. At the reader's Large text setting
 *  the same three were out by 24, 19 and more.
 *
 *  The badge is the exception and is not here: `TeamBadge` scales its own px through
 *  --app-chrome, so the header's spacer has to be `chromePx(W_BADGE)` to match it rather than
 *  a rem width that would follow the type instead. */
const W_SEED = '1rem'
const W_BADGE = 26
const W_RECORD = '2.4rem'
const W_CUSHION = '8rem'
const W_STATUS = '5.2rem'
const W_SEMI = { xs: '3rem', sm: '6.2rem' }

/*  Each of the five is the widest string it will ever hold plus a little, measured rather than
 *  guessed: the record 2.4 against 2.1 for a two-digit "11-4", the status 5.2 against 4.9 for
 *  "5 to reach 3rd", the semifinal 6.2 against 5.8 for "vs Firebells" plus its letter, the
 *  cushion 8 against 7.6 for "1.5 ahead of Firebells". They were all a size larger to begin
 *  with, and the slack came out of the CLUB column, which is the flex one: at the desktop scale
 *  times the reader's Large text setting the four fixed columns had squeezed it to 187px against
 *  the 210 "San Francisco Firebells" needs, so the longest club name in the league ellipsised.
 *  The phone has its own version of that fight and it is settled a column at a time rather than
 *  a pixel at a time: the badge goes below sm, the cushion below md, the record below sm.
 *  Since every width here is in rem, that budget holds at every text scale at once. */

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
  if (s.bestPossible === s.worstPossible) return { count: null, text: 'Seed set', strong: true }
  // magic 0 means it cannot fall below where it sits, but can still climb.
  if (s.magic === 0) return { count: null, text: `No worse than ${ordinal(s.seed)}`, strong: true }
  // "to lock", not "to lock 2nd": the seed this club is defending is the number at the left end
  // of the same row, so the ordinal was the row saying its own seed twice. It is kept in the
  // two states where it is NOT the club's current seed and so is really telling you something:
  // the floor a club has already secured, and the climb below.
  if (s.magic != null) return { count: s.magic, text: 'to lock', strong: false }
  // Bottom seed, still able to climb: it has nothing to defend, so the live fact is what it
  // would take to climb out. A NUMBER rather than the sentence this used to print ("Can still
  // reach 3rd"), for two reasons. It was the one cell in the column that answered a different
  // question in a different shape, so the column could not be read down. And it was the longest
  // string on the card by a distance, which is what made it the first thing to wrap when the
  // desktop scale arrived.
  if (s.climbMagic != null) return { count: s.climbMagic, text: `to reach ${ordinal(s.bestPossible)}`, strong: false }
  // Unreachable in a four-club league: no climb and no seed to defend means the range has
  // already closed, which the first branch catches. Here so the shape is total.
  return { count: null, text: `${ordinal(s.seed)} seed set`, strong: true }
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
  const swings = useMemo(() => swingGames(seeds, games), [seeds, games])
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
      title={settled ? 'Final seeding' : 'Seeding race'}
      subtitle={settled
        ? 'The order is final. Semifinals are best-of-three, the championship best-of-five.'
        : `All four clubs reach the postseason, so the last ${left} game${left === 1 ? '' : 's'} only decide the bracket.`}
    >
      {/* Micro-headers rather than none. The two right-hand columns say things a reader has no
          prior for on this section, a magic number and a matchup that does not exist yet, and
          one 9px line of label is cheaper than explaining either in prose underneath. */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 0.5, pb: 0.5 }}>
        <Box sx={{ width: W_SEED, flexShrink: 0 }} />
        <Box sx={{ width: chromePx(W_BADGE), flexShrink: 0, display: { xs: 'none', sm: 'block' } }} />
        <Typography sx={{ ...micro, flex: 1, minWidth: 0 }}>Club</Typography>
        <Typography sx={{ ...micro, width: W_RECORD, textAlign: 'right', display: { xs: 'none', sm: 'block' } }}>W-L</Typography>
        <Box sx={{ width: W_CUSHION, flexShrink: 0, display: { xs: 'none', md: 'block' } }} />
        {/* The whole column goes once the order is final, rather than turning into four
            identical "Seed set" cells under a header that has stopped asking anything. What is
            worth reading then is who plays whom, and the club column takes the freed room. */}
        {!settled && <Typography sx={{ ...micro, width: W_STATUS, textAlign: 'right' }}>To lock</Typography>}
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
                ...tappableIf(onOpenTeam),
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

              {/* OFF THE PHONE, and it is the one column here that can go without losing
                  anything: this card renders directly under the standings table, which carries
                  the same four records in the same order a finger's width above it. At 320px
                  the five fixed columns left the flex club column 5px, so the rows rendered
                  with no club names at all, which is a worse failure than any missing column:
                  an ellipsis tells you something was cut, an empty cell does not. */}
              <Typography sx={{
                fontSize: '0.85rem', fontWeight: 700, width: W_RECORD, flexShrink: 0,
                textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                display: { xs: 'none', sm: 'block' },
              }}>{s.wins}-{s.losses}</Typography>

              {/* The cushion over the seed below. First column to drop as the card narrows: it
                  is the one figure here a reader can approximate from the table above. */}
              <Typography sx={{
                fontSize: '0.72rem', width: W_CUSHION, flexShrink: 0, textAlign: 'right',
                color: 'text.disabled', whiteSpace: 'nowrap',
                display: { xs: 'none', md: 'block' },
              }}>{cushion || '—'}</Typography>

              <Box sx={{
                width: W_STATUS, flexShrink: 0, display: settled ? 'none' : 'flex',
                alignItems: 'baseline', justifyContent: 'flex-end', gap: 0.5,
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
                    // A box around a letter, so rem: left at 18 raw px it kept its mobile size
                    // against type a quarter larger, and squeezed the club abbreviation beside
                    // it until "vs BOS" ellipsised to "vs B...". BOS is the league's only
                    // three-letter abbreviation, so exactly one row looked broken.
                    width: '1.15rem', height: '1.15rem', borderRadius: 0.75, flexShrink: 0,
                    // AND IT IS THE LAST THING TO GO ON A NARROW PHONE, ahead of the opponent
                    // beside it. The letter exists to pair two rows that a seed-ordered list
                    // never puts together, and on four rows each naming its opponent a reader
                    // can already do that pairing. The opponent cannot be reconstructed from
                    // anything on the card, so at 320px the letter pays for it.
                    display: { xs: 'none', sm: 'flex' }, alignItems: 'center', justifyContent: 'center',
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

      {/* WHEN it gets decided, which is the one thing a column of magic numbers cannot say.
          Four rows of "2 to lock Nth" tell a reader what each club needs and leave them with no
          idea which night to watch, and in a four-club league the answer is usually a single
          date: the two clubs arguing over a seat play each other. Sits above the footnote and
          below the table, because it is a reading OF the table rather than a note about how to
          read it. Silent when there is no such game left, which is the common case in a week
          made of cross-matchups, rather than reaching for a second-best game to fill the line. */}
      {!settled && swings.length > 0 && (() => {
        const first = swings[0]
        const home = seeds.find(s => s.team.id === first.game.home_team_id)
        const away = seeds.find(s => s.team.id === first.game.away_team_id)
        if (!home || !away) return null
        const when = relativeDayLabel(first.game.game_date)
        const fixture = `${away.team.name} at ${home.team.name}`
        return (
          <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary', mt: 1.25, lineHeight: 1.5 }}>
            <Box component="span" sx={{ fontWeight: 700, color: 'text.primary' }}>{when}: {fixture}</Box>
            {swings.length === 1
              ? ' is the only game left between two clubs still disputing a seed.'
              : ` is the first of ${swings.length} games left between clubs still disputing a seed.`}
          </Typography>
        )
      })()}

      <Typography sx={{ fontSize: '0.66rem', color: 'text.disabled', mt: 1, lineHeight: 1.45 }}>
        {settled
          ? 'Semifinals begin Sep 9.'
          : 'A club’s number counts its own wins plus its rivals’ losses: at zero that seed is locked outright, with no tiebreak needed. Semifinals begin Sep 9, pairing seeds 1v4 and 2v3.'}
        {/* Only where the letters are. They are hidden on the narrowest phones so the opponent
            abbreviation can stay whole, and a footnote explaining a mark that is not on the
            screen reads as a rendering fault rather than as a note. */}
        <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
          {' '}A and B are our labels for the two pairings, not the league’s.
        </Box>
      </Typography>
    </SectionCard>
  )
}
