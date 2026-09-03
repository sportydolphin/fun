import { useEffect, useMemo, useRef } from 'react'
import { Box, Typography } from '@mui/material'
import { SectionCard, PlayerPortrait, TeamBadge, useWpblDark, FittedName, CARD_BORDER, TAPPABLE, TYPE_SCALE } from './ui'
import { wpblAccent, relativeDayShort, WPBL_TEAMS } from './constants'
import { useWpblPlayerLink } from './LinkContext'
import { fmtMvpRuns, type MvpCandidate, type MvpRace as MvpRaceData } from './derive/mvpRace'
import { countsInStandings } from './season'
import { fmtRate, type WpblBatSeason, type WpblPitSeason } from './stats'
import { outsToIp } from './innings'
import { useEraBasis } from './EraBasisContext'
import { track, EVENTS } from '../lib/analytics'
import type { WpblGame, WpblPlayer } from './types'

/**
 * Two players, one number, and the season it took to get there.
 *
 * WHY A RACE AND NOT A LEADERBOARD. There is already a board that ranks everybody by run
 * value, one tab away, and a sixth ranked list on Home would be the section's fourth way to
 * sort the same names. What no surface here does is tell a STORY across the season, and a
 * two-horse race is the smallest thing that has one: a lead, a margin, and the dates it
 * changed hands. The chart is the point of the card, not decoration on top of it.
 *
 * WHY TWO AND NOT FIVE. A five-name list is a leaderboard again, and the curves would be
 * unreadable at this size. Two curves can be told apart at 84px tall on a phone; four cannot,
 * and the fill between them, which is the margin and the single most legible thing in the
 * chart, only has a meaning while there are exactly two.
 *
 * EVERY NAME IS A REAL `<a href>` to her page. The traffic read says opening a player page is
 * the retention event and that Home is where readers are lost, so a Home card whose whole
 * subject is two players has to be two links, not two divs with click handlers. See
 * LinkContext.tsx.
 *
 * IT CARRIES ITS OWN IMPRESSION EVENT, because the last thing measured on Home was a card
 * being seen and not used, and the card that told us so has since been retired. Anything new
 * here has to be able to answer the same question about itself.
 */

/** Chart height in px. Tall enough to separate two curves that spend a season within a few
 *  runs of each other, short enough that the card does not push the page down a screen. */
const CHART_H = 84

/** Below this the chart is noise: two curves off three data points is not a race, it is two
 *  line segments. The card hides itself rather than drawing a shape it cannot support. */
const MIN_DATES = 5

/** Games left in the regular season, league-wide. The card's one forward-looking number, and
 *  the thing that decides whether a 3.9-run lead is safe or nothing at all. */
function gamesLeft(games: WpblGame[]): number {
  return games.filter(g => g.status !== 'final' && countsInStandings(g)).length
}

/** Season box-score totals by player id, so a row can print the stat line a reader already
 *  knows without re-aggregating anything. Home has both arrays in hand for the Leaders card;
 *  handing them over rather than recomputing here is also what guarantees the two cards cannot
 *  disagree about the same player, which is the bug this replaced. */
export interface MvpStatLookup {
  bat: Map<string, WpblBatSeason>
  pit: Map<string, WpblPitSeason>
}

/** Build it once per render of the card, not once per row. */
export function mvpStatLookup(bat: WpblBatSeason[], pit: WpblPitSeason[]): MvpStatLookup {
  return {
    bat: new Map(bat.map(s => [s.player.id, s])),
    pit: new Map(pit.map(s => [s.player.id, s])),
  }
}

/** How the line under a name reads.
 *
 *  IT USED TO COUNT PLATE APPEARANCES AND IT MUST NOT AGAIN. This card derives its number from
 *  the PLAY LOG, so its idea of a plate appearance is "a play naming this batter" — while every
 *  other surface on Home counts the BOX SCORE, via `plateAppearances()`. Those two disagree
 *  wherever the league's play log is damaged, and on Sep 1, 2026 they disagreed on screen: this
 *  card said Denae Benites had 54 plate appearances and the Leaders card 200px below said 56,
 *  both correct by their own definition, neither able to say so. The Aug 20 game is missing
 *  eighteen of its plays at the source (docs/PLAY_VALIDATION.md §9) and it is New York's, so
 *  every Heights hitter reads short here and nowhere else.
 *
 *  So the line carries the season the READER already knows instead: her actual stat line, taken
 *  from the same box-score aggregates the Leaders card is built on, which cannot disagree with
 *  them because it IS them. It is also the better line on its own merits, since a run-value
 *  total says nothing about how it was earned.
 *
 *  A pure hitter still says nothing about the mound and a pure pitcher nothing about the plate:
 *  printing "arm +0.0" for someone who has never thrown a pitch invents a zero that is really an
 *  absence, and it is the two-way line that has to stand out, so the one-sided rows must not be
 *  dressed to look like it. */
function statLabel(c: MvpCandidate, stats: MvpStatLookup, fmtEra: (v: number | null) => string): string {
  // The split IS the highlight for a two-way player: it is the whole reason the metric adds
  // the two halves up, and no batting line can say it.
  if (c.twoWay) return `${fmtMvpRuns(c.bat)} bat · ${fmtMvpRuns(c.arm)} arm`

  const pitcherFirst = c.bf > 0 && (c.pa === 0 || Math.abs(c.arm) > Math.abs(c.bat))
  const id = c.player?.id
  const bat = id ? stats.bat.get(id) : undefined
  const pit = id ? stats.pit.get(id) : undefined

  const line = pitcherFirst
    ? pitchingLine(pit, fmtEra) ?? battingLine(bat)
    : battingLine(bat) ?? pitchingLine(pit, fmtEra)

  // No season line to show means the roster could not resolve her, or every game she appears
  // in is a postseason one the aggregates exclude. Her club is the one fact still in hand, and
  // it is the same thing the Leaders card puts here for its own top row.
  return line ?? (c.teamId ? WPBL_TEAMS[c.teamId]?.name ?? '' : '')
}

/** Three facts, chosen the way the recap's statline chooses them: lead with the rate everyone
 *  reads a hitter by, then only what is actually true. A hitter with no home runs gets her
 *  doubles rather than "0 HR", because a zero printed as a highlight is a worse line than the
 *  next real thing. */
function battingLine(s: WpblBatSeason | undefined): string | null {
  if (!s || s.totals.ab === 0) return null
  const t = s.totals
  const parts = [fmtRate(t.avg)]
  if (t.hr) parts.push(`${t.hr} HR`)
  if (t.rbi) parts.push(`${t.rbi} RBI`)
  if (!t.hr && t.doubles) parts.push(`${t.doubles} 2B`)
  if (parts.length < 3 && t.sb) parts.push(`${t.sb} SB`)
  if (parts.length < 3 && t.r) parts.push(`${t.r} R`)
  return parts.slice(0, 3).join(' · ')
}

/** ERA through `fmtEra`, never `t.era` raw: the stored number is per NINE innings and a reader
 *  who has set the site to a seven-inning basis must see the same figure here as on the board
 *  this card links to. See ERA_BASIS_CANONICAL in stats.ts. */
function pitchingLine(s: WpblPitSeason | undefined, fmtEra: (v: number | null) => string): string | null {
  if (!s || s.totals.outs === 0) return null
  const t = s.totals
  const parts: string[] = []
  if (t.w || t.l) parts.push(`${t.w}-${t.l}`)
  if (t.era != null) parts.push(`${fmtEra(t.era)} ERA`)
  if (t.so) parts.push(`${t.so} K`)
  if (parts.length < 3) parts.push(`${outsToIp(t.outs)} IP`)
  return parts.slice(0, 3).join(' · ')
}

function CandidateRow({ c, rank, color, dashed, stats, fmtEra, onOpenPlayer }: {
  c: MvpCandidate; rank: number; color: string; dashed: boolean
  stats: MvpStatLookup
  fmtEra: (v: number | null) => string
  onOpenPlayer: (p: WpblPlayer) => void
}) {
  const playerLink = useWpblPlayerLink()
  // A candidate the play log named but the roster cannot resolve still gets a row, because
  // dropping her would silently reorder the race. She just is not a link.
  const link = c.player ? playerLink(c.player, onOpenPlayer) : {}
  return (
    <Box {...link} sx={{
      display: 'flex', alignItems: 'center', gap: 1, py: 0.3, px: 0.5, mx: -0.5,
      borderRadius: 1, cursor: c.player ? 'pointer' : 'default',
      ...(c.player ? TAPPABLE : {}),
    }}>
      {/* The swatch ties the row to its curve below, and is the chart's only legend. Matches
          the stroke exactly, dash included, because when both candidates play for the same
          club the colours are identical and the dash is the whole distinction. */}
      <Box aria-hidden sx={{
        width: 3, alignSelf: 'stretch', borderRadius: 2, flexShrink: 0,
        ...(dashed
          ? { backgroundImage: `repeating-linear-gradient(to bottom, ${color} 0 4px, transparent 4px 7px)` }
          : { bgcolor: color }),
      }} />
      <PlayerPortrait name={c.name} teamId={c.teamId} size={rank === 1 ? 32 : 28} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, minWidth: 0 }}>
          {/* MEASURED, NOT BUDGETED. This was `wpblFeatureName(c.name, 18)`, a character budget,
              and "Kelsie Whitmore" is 15 characters: it passed the budget untouched and CSS then
              clipped it to "Kelsie Whit…" — on the rank-1 row, which is the one row that also
              carries the TWO-WAY badge, and on either row once a reader turns Large text on. The
              leader's name is the one thing this card exists to say. `FittedName` steps down to
              "K. Whitmore" instead, which is a name rather than a shrug. */}
          <FittedName name={c.name} wrapperSx={{ minWidth: 0 }} sx={{
            fontSize: rank === 1 ? TYPE_SCALE.title : TYPE_SCALE.body, fontWeight: rank === 1 ? 800 : 700,
            lineHeight: 1.15,
          }} />
          {/* The one badge worth spending width on. A player carrying both halves of this
              number is the reason the metric adds them up, and nothing else on the row says
              so: her total looks like any other total.

              EXCEPT ON THE NARROWEST PHONE, where the name outranks it. Below 360px the row
              cannot hold a name, this badge and the total at once, and the badge is the half
              that can be spared: the line directly underneath is "+18.1 bat · +4.3 arm",
              which IS the two-way case written out, so nothing is actually lost. Without this
              the name spends its last stage and still gets cut, and "K. Whit…" is a worse
              thing to know about the league's best player than that she also pitches. */}
          {c.twoWay && (
            <Typography sx={{
              flexShrink: 0, fontSize: TYPE_SCALE.caption, fontWeight: 800, letterSpacing: 0.4,
              textTransform: 'uppercase', px: 0.5, py: '1px', borderRadius: 0.75,
              border: '1px solid', borderColor: color, color,
              '@media (max-width: 359px)': { display: 'none' },
            }}>Two-way</Typography>
          )}
        </Box>
        <Typography sx={{
          fontSize: TYPE_SCALE.micro, fontWeight: 600, color: 'text.secondary', lineHeight: 1.25,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {statLabel(c, stats, fmtEra)}
        </Typography>
      </Box>
      <Typography sx={{
        fontSize: rank === 1 ? TYPE_SCALE.display : TYPE_SCALE.title, fontWeight: 900, flexShrink: 0,
        fontVariantNumeric: 'tabular-nums', color: rank === 1 ? 'text.primary' : 'text.secondary',
      }}>
        {fmtMvpRuns(c.total)}
      </Typography>
    </Box>
  )
}

/** The two cumulative curves, with the margin between them shaded.
 *
 *  `preserveAspectRatio="none"` stretches the box to the card's width, which is what lets the
 *  curves use the whole row. Everything drawn in here has to survive that: strokes opt out
 *  with `vectorEffect`, and the end-of-line markers are HTML dots positioned in percentages
 *  rather than SVG circles, which would come out as ellipses. Same reasoning, and the same
 *  fix, as the win-probability chart. */
function RaceChart({ race, colors, dashed, fill }: {
  race: MvpRaceData; colors: [string, string]; dashed: boolean
  /** Grow into whatever height the card has spare, rather than sitting at CHART_H. */
  fill?: boolean
}) {
  const [a, b] = race.top
  const n = race.dates.length

  const { path, x, y, lo, hi } = useMemo(() => {
    const all = [...a.curve, ...b.curve, 0]
    const min = Math.min(...all), max = Math.max(...all)
    // Pad so a curve never runs along the very edge of the box, and guard the degenerate case
    // where every value is identical and the span is zero.
    const span = Math.max(max - min, 1)
    const lo = min - span * 0.12, hi = max + span * 0.12
    const x = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * 100)
    const y = (v: number) => 100 - ((v - lo) / (hi - lo)) * 100
    const path = (c: number[]) => c.map((v, i) => `${x(i)},${y(v)}`).join(' ')
    return { path, x, y, lo, hi }
  }, [a.curve, b.curve, n])

  // The margin, as a closed shape: down one curve and back along the other. This is the
  // single most readable thing in the chart, because the race IS the gap, and it pinches to nothing
  // exactly where the lead changed hands. Neutral rather than either club's colour on
  // purpose: it belongs to both of them, and colouring it would assert an owner that flips
  // mid-season.
  const gap = `${a.curve.map((v, i) => `${x(i)},${y(v)}`).join(' L ')} L ${b.curve.map((v, i) => `${x(i)},${y(v)}`).reverse().join(' L ')} Z`

  return (
    <Box sx={{
      position: 'relative', mt: 0.75,
      // `flexGrow` rather than `flex: 1`, deliberately. SectionCard's filled body sets
      // `flexShrink: 0` on every direct child so a leader board cannot be squashed, and
      // `flex: 1` would be asking for a shrink it is not going to get while also zeroing the
      // basis. Growing from a real basis needs neither. The SVG is 100% x 100% with
      // `preserveAspectRatio="none"` and the end markers are positioned in percentages, so
      // every part of this scales to whatever height it ends up with.
      ...(fill
        ? { flexGrow: 1, flexBasis: CHART_H, minHeight: CHART_H }
        : { height: CHART_H }),
    }}>
      <Box component="svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden
        sx={{ display: 'block', width: '100%', height: '100%', overflow: 'visible' }}>
        <path d={`M ${gap}`} fill="currentColor" opacity={0.14} />
        {/* Zero, drawn only when it is actually in frame. A season where both candidates have
            been above water throughout has no use for a line at the bottom of the box, and
            drawing one there would read as an axis the curves are sitting on. */}
        {lo < 0 && hi > 0 && (
          <line x1={0} x2={100} y1={y(0)} y2={y(0)} stroke="currentColor" strokeOpacity={0.3}
            strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
        )}
        {race.lastLeadChange != null && (
          <line x1={x(race.lastLeadChange)} x2={x(race.lastLeadChange)} y1={0} y2={100}
            stroke="currentColor" strokeOpacity={0.35} strokeWidth={1}
            vectorEffect="non-scaling-stroke" />
        )}
        <polyline points={path(b.curve)} fill="none" stroke={colors[1]} strokeWidth={2}
          strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke"
          {...(dashed ? { strokeDasharray: '5 3' } : {})} />
        <polyline points={path(a.curve)} fill="none" stroke={colors[0]} strokeWidth={2.5}
          strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </Box>
      {/* Where each curve has got to. HTML, not SVG: see the note above the component. */}
      {[a, b].map((c, i) => (
        <Box key={c.key} aria-hidden sx={{
          position: 'absolute', left: '100%', top: `${Math.min(Math.max(y(c.curve[n - 1]), 4), 96)}%`,
          transform: 'translate(-50%, -50%)',
          width: i === 0 ? 9 : 7, height: i === 0 ? 9 : 7, borderRadius: '50%',
          bgcolor: colors[i], border: '2px solid', borderColor: 'background.paper',
        }} />
      ))}
    </Box>
  )
}

export default function MvpRaceCard({ race, games, batSeasons, pitSeasons, onOpenPlayer, onViewBoard, fill }: {
  race: MvpRaceData
  games: WpblGame[]
  /** The same season aggregates the Leaders card is built from. See MvpStatLookup: the line
   *  under each name is her box-score stat line, and it comes from here so that it cannot
   *  disagree with the card below it. */
  batSeasons: WpblBatSeason[]
  pitSeasons: WpblPitSeason[]
  onOpenPlayer: (p: WpblPlayer) => void
  /** Through to the Run value board, which is where this number comes from and the only place
   *  a reader can see the rest of the field. */
  onViewBoard: () => void
  /** Take the height the container gives, for Home's paired columns. The slack goes to the
   *  chart: a race drawn taller is a race easier to read, which is not true of the rows above
   *  it or the sentence below. */
  fill?: boolean
}) {
  const dark = useWpblDark()
  const { fmtEra } = useEraBasis()
  const [a, b] = race.top
  const left = gamesLeft(games)
  const stats = useMemo(() => mvpStatLookup(batSeasons, pitSeasons), [batSeasons, pitSeasons])

  const colors = useMemo<[string, string]>(
    () => [wpblAccent(a?.teamId, dark), wpblAccent(b?.teamId, dark)], [a?.teamId, b?.teamId, dark])
  // Two clubmates would otherwise get the same stroke and the chart would be one colour with
  // two lines in it. The runner-up dashes instead. Compared as resolved colours rather than
  // team ids, because that is what actually collides on screen.
  const dashed = colors[0] === colors[1]

  // One impression per mount, with the shape of the race on it, so "was this card worth the
  // room" is answerable later from `events` rather than from an opinion.
  const sent = useRef(false)
  useEffect(() => {
    if (sent.current) return
    sent.current = true
    track(EVENTS.WPBL_MVP_SHOWN, {
      leader: a.player?.id ?? null, lead: Math.round(race.lead * 10) / 10,
      leadChanges: race.leadChanges, twoWay: a.twoWay || b.twoWay, gamesLeft: left,
    })
  }, [])

  const openPlayer = (p: WpblPlayer, rank: number) => {
    track(EVENTS.WPBL_MVP_PLAYER, { playerId: p.id, rank })
    onOpenPlayer(p)
  }

  // The caption is the card's sentence, and it says the one thing the chart cannot: what the
  // margin means against what is left to play. A lead of 3.9 with six games to go is a very
  // different claim from the same lead with one.
  const changed = race.lastLeadChange != null ? race.dates[race.lastLeadChange] : null
  const margin = race.lead === 0
    ? `${a.name.split(' ').pop()} and ${b.name.split(' ').pop()} are level`
    : `${a.name.split(' ').pop()} leads by ${fmtMvpRuns(race.lead).replace('+', '')}`
  // ONE LINE, at both widths this card is drawn at. In Home's two-column grid the card is
  // 338px and the caption gets ~306 of that; "…, with 6 games left in the season." ran to two
  // and every one of those 20px was charged twice, once here and once to the card stretched to
  // match this one's height. "in the season" was the part carrying no information.
  const caption = left > 0
    ? `${margin} with ${left} game${left === 1 ? '' : 's'} left.`
    : `${margin}. The regular season is over.`
  // Where the number comes from, kept out of the subtitle because it wrapped to three lines
  // there and squeezed the "Full board" link into a column two words wide. Down here it is
  // also nearer the thing it qualifies: the reader has seen the totals and the chart by now
  // and is in a position to want the provenance rather than to be handed it first.

  return (
    <SectionCard
      fill={fill}
      title="MVP race"
      /* SHORT ENOUGH FOR ONE LINE, and the width it has to fit is smaller than it looks: in
         Home's two-column grid this card is 338 CSS px wide, and the "Full board" link takes
         about 55 of them, so the subtitle gets ~243px. The long version wrapped to two lines
         and those 15px came straight off the card's neighbour, which is stretched to match it. */
      subtitle="Runs added at the plate and on the mound"
      action={
        <Typography
          onClick={e => { e.stopPropagation(); onViewBoard() }}
          sx={{
            fontSize: TYPE_SCALE.meta, fontWeight: 700, cursor: 'pointer', flexShrink: 0,
            color: 'var(--wpbl-accent-fg)', '&:hover': { textDecoration: 'underline' },
          }}
        >Full board</Typography>
      }
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
        <CandidateRow c={a} rank={1} color={colors[0]} dashed={false} stats={stats} fmtEra={fmtEra} onOpenPlayer={p => openPlayer(p, 1)} />
        <CandidateRow c={b} rank={2} color={colors[1]} dashed={dashed} stats={stats} fmtEra={fmtEra} onOpenPlayer={p => openPlayer(p, 2)} />
      </Box>

      <RaceChart race={race} colors={colors} dashed={dashed} fill={fill} />

      {/* The axis, such as it is: two dates and, when the lead has changed hands, the day it
          did. A full tick axis on an 84px chart would cost more room than it explains. */}
      <Box sx={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', mt: 0.5,
        fontVariantNumeric: 'tabular-nums',
      }}>
        <Typography sx={{ fontSize: TYPE_SCALE.micro, fontWeight: 700, color: 'text.disabled' }}>
          {relativeDayShort(race.dates[0])}
        </Typography>
        {changed && (
          <Typography sx={{ fontSize: TYPE_SCALE.micro, fontWeight: 700, color: 'text.secondary' }}>
            lead changed {relativeDayShort(changed)}
          </Typography>
        )}
        <Typography sx={{ fontSize: TYPE_SCALE.micro, fontWeight: 700, color: 'text.disabled' }}>
          {relativeDayShort(race.dates[race.dates.length - 1])}
        </Typography>
      </Box>

      {/* NO PROVENANCE LINE ANY MORE. It said where the number is priced from, which was worth
          a line while this card was the only place that explained itself; the run-value
          explainer now lives in one place and the "Full board" link in this card's own header
          is the way there. A second line repeating it cost 17px of a card whose height is paid
          for twice, once here and once in the card stretched to match it. */}
      <Typography sx={{
        mt: 1, pt: 1, borderTop: '1px solid', borderColor: CARD_BORDER,
        fontSize: TYPE_SCALE.meta, fontWeight: 600, color: 'text.secondary', lineHeight: 1.4,
      }}>
        {caption}
      </Typography>
    </SectionCard>
  )
}

/** Whether there is a race worth drawing at all.
 *
 *  Exported so Home can decide without building the card, and so the rule lives next to the
 *  card rather than in the page's JSX where the next person to edit the layout would have to
 *  reverse-engineer it. */
export function mvpRaceIsWorthDrawing(race: MvpRaceData | null): race is MvpRaceData {
  return !!race
    && race.top.length === 2
    && race.dates.length >= MIN_DATES
    // A "race" where the leader has cost her team runs is not one. Early in a season that is
    // a real state, and the honest response is to say nothing rather than to crown somebody.
    && race.top[0].total > 0
}

export { CHART_H as MVP_CHART_H, MIN_DATES as MVP_MIN_DATES }
