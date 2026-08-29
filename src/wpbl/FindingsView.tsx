import { useEffect, useMemo, useState } from 'react'
import { Box, Typography, CircularProgress } from '@mui/material'
import {
  fetchWpblAllRunValuePlays, fetchWpblAllPlayers,
  getCachedWpblAllRunValuePlays, getCachedWpblAllPlayers,
} from './api'
import {
  buildRunExpectancy, describeState, eventValues, fmtRunValue, playRunValues, reOf,
  stealEconomy, topRunners, workedExample,
  type EventValue, type ReTable, type StealEconomy, type WorkedExample,
} from './derive/runExpectancy'
import { wpblAccentFg } from './constants'
import { SectionCard, pressable, FOCUS_RING, useWpblDark } from './ui'
import { useExperiments, ExperimentalChip } from '../ExperimentsContext'
import type { WpblBattingLine, WpblGame, WpblPlayer } from './types'

// The Findings board: things that are TRUE about this league, rather than another way to sort
// it.
//
// WHY IT IS ITS OWN BOARD. The row above it was carrying two different kinds of thing. Players,
// Teams, Pitch by pitch, Run value and Tracked are one axis, "how do you want the numbers cut":
// they sort, they filter, and they stop meaning anything the day the feed stops. What is on
// this board is the other kind: one question, one answer, read once, and still true in
// February. Adding those as more chips is what would actually break that row, so there is one
// chip for all of them and it never grows again.
//
// A CARD CAN SHIP BEHIND THE EXPERIMENTS SWITCH AND THE BOARD STILL WORKS, which is most of the
// value of having a container rather than a chip per finding: the steal card is a verdict and
// went out to the switch first, the play-value card is a table of measurements and went to
// everyone, and neither decision moved anything in the tab above.
//
// THREE RULES, ALL THREE FROM THE TRAFFIC RATHER THAN FROM TASTE.
//
// 1. NAME PLAYERS, AND MAKE THEM TAPPABLE. Return rate by what a browser did on its first day
//    runs 7.8% for neither a player page nor Game Center, 35.7% for Game Center alone and 76.5%
//    for both. Opening a player page is the retention event of the whole section, so a card
//    here that states a fact and names nobody is a card doing half its job.
// 2. NO JARGON, EVER. "Run expectancy", "linear weights" and "break-even rate" are all absent
//    on purpose. Every number is stated in runs, and every card says what its number means in
//    the sentence beside it.
// 3. NOT ON HOME. The reading rail was seen by 575 browsers and clicked by 39. A second rail of
//    things-to-read on the surface where people already leave would land the same way, and Home
//    needs to get shorter rather than longer.

/** Cards read; they do not span. The rest of this tab is full-bleed tables, and prose set to
 *  1,200px is prose nobody finishes. */
const READ_WIDTH = { maxWidth: 760 }

/**
 * THE CARD THAT ARGUES FOR THE BOARD, AND THE ONE STILL BEHIND THE SWITCH.
 *
 * A fan watching this league has the question by the third inning: they run constantly, is it
 * working? A stolen-base percentage cannot answer it, because how often it worked is not the
 * same question as whether it was worth trying, and the answer turns entirely on what an out
 * costs here. It takes the run-expectancy table to say, which is the argument for having built
 * one.
 *
 * BEHIND EXPERIMENTAL FEATURES WHILE IT SETTLES, which is what that switch is for and the same
 * road the bracket, the seeding race and the run-value board itself took. This one is a verdict
 * rather than a number: "your team's running game is costing it runs" is a claim about how the
 * league plays, drawn from 73 attempts, and 13 caught stealings is a thin base for the half of
 * it that does the work. The arithmetic is pinned by tests and the finding has held all season,
 * but it can afford to be read by a few hundred people before it is read by everyone.
 *
 * It carries the chip for the reason ExperimentsContext gives: a reader who turned the switch
 * on weeks ago has no way to tell which of the things in front of them is the one that may be
 * wrong tomorrow.
 */
function StealCard({ econ, runners, accent, onOpenPlayer }: {
  econ: StealEconomy
  runners: ReturnType<typeof topRunners>
  accent: string
  onOpenPlayer: (p: WpblPlayer) => void
}) {
  const { breakEven, successRate } = econ
  // Both rates or nothing: the card is a comparison, and half of one is not a smaller version
  // of it, it is a percentage with no point.
  if (breakEven == null || successRate == null) return null

  const worthIt = successRate >= breakEven
  const rate = (v: number) => `${Math.round(v * 100)}%`
  // The bar reads 60% to 100%: nobody attempts a steal they expect to lose, so the bottom half
  // of the axis is dead space that flattens the only gap the card is about.
  const LOW = 0.6
  const x = (v: number) => `${Math.min(100, Math.max(0, (v - LOW) / (1 - LOW) * 100))}%`

  return (
    <SectionCard title="They run constantly. Is it working?">
      <ExperimentalChip sx={{ mb: 1.25 }} />
      <Typography sx={{ fontSize: '0.9rem', lineHeight: 1.6, color: 'text.secondary' }}>
        A stolen base moves a team about {Math.abs(econ.perSteal).toFixed(2)} of a run closer to
        scoring. Getting thrown out costs about {Math.abs(econ.perCaught).toFixed(2)}, because
        outs are the thing a team runs out of. In a league that scores this much, running has to
        work <strong>{rate(breakEven)}</strong> of the time to be worth doing at all.
      </Typography>

      <Box sx={{ mt: 2.5, mb: 1 }}>
        <Box sx={{ position: 'relative', height: 10, borderRadius: 5, bgcolor: 'action.hover' }}>
          <Box sx={{
            position: 'absolute', inset: 0, right: 'auto', width: x(successRate),
            borderRadius: 5, bgcolor: worthIt ? accent : 'text.disabled',
          }} />
          {/* The break-even line, drawn over the fill so the shortfall is the visible gap. */}
          <Box sx={{
            position: 'absolute', top: -4, bottom: -4, left: x(breakEven),
            width: '2px', bgcolor: 'text.primary', borderRadius: 1,
          }} />
        </Box>
        <Box sx={{ position: 'relative', height: 34, mt: 0.75 }}>
          <Typography sx={{ position: 'absolute', left: 0, fontSize: '0.78rem', fontWeight: 800, color: worthIt ? accent : 'text.primary' }}>
            {rate(successRate)} of the time it works
          </Typography>
          <Typography sx={{
            position: 'absolute', left: x(breakEven), transform: 'translateX(-50%)', top: 16,
            fontSize: '0.72rem', color: 'text.disabled', whiteSpace: 'nowrap',
          }}>
            needs {rate(breakEven)}
          </Typography>
        </Box>
      </Box>

      <Typography sx={{ fontSize: '0.9rem', lineHeight: 1.6, color: 'text.secondary' }}>
        {worthIt
          ? `Which it does. The season's ${econ.steals + econ.caught} attempts have been worth
             ${fmtRunValue(econ.net)} runs.`
          : `Which it does not, quite. The ${econ.steals} that worked earned
             ${fmtRunValue(econ.gained)} runs and the ${econ.caught} that did not cost
             ${fmtRunValue(econ.lost)}, so the running game has been worth
             ${fmtRunValue(econ.net)} runs to the league this season.`}
      </Typography>

      {runners.length > 0 && (
        <Box sx={{ mt: 2 }}>
          <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.06em', color: 'text.disabled', mb: 0.75 }}>
            WHO RUNS
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
            {runners.map(r => (
              <Box key={r.name} {...(r.player ? pressable(() => onOpenPlayer(r.player!)) : {})} sx={{
                ...(r.player ? FOCUS_RING : null),
                px: 1.25, py: 0.5, borderRadius: 2, border: '1px solid', borderColor: 'divider',
                fontSize: '0.8rem', cursor: r.player ? 'pointer' : 'default',
                '&:hover': r.player ? { borderColor: accent } : undefined,
              }}>
                <Box component="span" sx={{ fontWeight: 700 }}>{r.name}</Box>
                <Box component="span" sx={{ color: 'text.disabled' }}> {r.sb} for {r.sb + r.cs}</Box>
              </Box>
            ))}
          </Box>
        </Box>
      )}
    </SectionCard>
  )
}

/**
 * What each kind of play is worth, which is the table every other number on this tab is priced
 * off and which nothing showed until now.
 *
 * THE LEAD SENTENCE IS COMPUTED, NOT WRITTEN. Two of these rows carry the whole point (a
 * strikeout costs more than a groundout, and the sacrifice is worth nothing at all) and both
 * are facts about a season in progress, so a hardcoded sentence is a sentence that goes wrong
 * in September without anyone noticing. It is assembled from the same rows the list draws, or
 * omitted if the season has not produced them yet.
 */
/** One line of the worked example: what the term is, which situation it prices, and the
 *  signed amount. Three columns rather than a sentence so the numbers line up under each
 *  other and the addition can be checked down the right-hand edge. */
function Ledger({ label, detail, amount }: { label: string; detail: string; amount: number }) {
  return (
    <Box sx={{
      display: 'grid', gridTemplateColumns: '1fr auto', gap: 1, alignItems: 'baseline', py: 0.35,
    }}>
      <Box sx={{ minWidth: 0 }}>
        <Typography component="span" sx={{ fontSize: '0.78rem', color: 'text.primary' }}>{label}</Typography>
        <Typography component="span" sx={{ fontSize: '0.72rem', color: 'text.disabled' }}> {detail}</Typography>
      </Box>
      <Typography sx={{
        fontSize: '0.82rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums',
        color: 'text.primary',
      }}>
        {/* Explicit signs on every line, including the positive ones: the reader is being asked
            to add three numbers, and a column where two terms are signed and one is not is a
            column that has to be re-read to see which way it goes. */}
        {amount >= 0 ? '+' : '−'}{Math.abs(amount).toFixed(2)}
      </Typography>
    </Box>
  )
}

function PlayValueCard({ rows, table, worked, workedDate, accent }: {
  rows: EventValue[]
  table: ReTable
  /** One real play with its arithmetic, or null before the season has produced one. */
  worked: WorkedExample | null
  /** The example's game, as a date. Looked up in the parent, which holds the schedule. */
  workedDate: string | null
  accent: string
}) {
  const [method, setMethod] = useState(false)
  if (rows.length < 4) return null
  const find = (e: string) => rows.find(r => r.event === e)
  const k = find('strikeout'), g = find('groundout'), sac = find('sacrifice')
  const widest = Math.max(...rows.map(r => Math.abs(r.per))) || 1
  const leadoff = reOf(table, 0, 0)

  return (
    <SectionCard title="What every kind of play is worth">
      <Typography sx={{ fontSize: '0.9rem', lineHeight: 1.6, color: 'text.secondary' }}>
        Every play leaves a team a little better or worse off.
        {k && g && k.per < g.per && ` A strikeout costs ${(g.per - k.per).toFixed(2)} of a run
          more than a groundout does, which is the case for putting the ball in play, in runs.`}
        {sac && Math.abs(sac.total) < 1 && ` The sacrifice, across ${sac.n} of them, has been
          worth almost exactly nothing: ${fmtRunValue(sac.total)} runs all season.`}
      </Typography>

      <Box sx={{ mt: 2 }}>
        {rows.map(r => {
          const good = r.per >= 0
          return (
            <Box key={r.event} sx={{
              py: 0.85, borderTop: '1px solid', borderColor: 'divider',
              '&:first-of-type': { borderTop: 0 },
            }}>
              {/* THE BAR GETS THE WHOLE ROW, and that is a phone measurement rather than a
                  taste. Beside a reserved 88px number column the track was 213px of a 309px
                  card, and a bar drawn from the centre spends half of whatever it is given, so
                  the entire chart lived in 106px on a 375px screen: sixteen plays separated by
                  a few pixels each, which is a decoration rather than a reading. Full width is
                  309px of track and 154px of swing, and the same change is worth 380px on the
                  desktop card. The number moves up beside the label, where it is still a column
                  to check the bars against. */}
              <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75, mb: 0.5 }}>
                <Typography component="span" sx={{ fontSize: '0.86rem', fontWeight: 700 }}>{r.label}</Typography>
                <Typography component="span" sx={{ fontSize: '0.75rem', color: 'text.disabled' }}>{r.n}</Typography>
                <Typography sx={{
                  ml: 'auto', fontSize: '0.86rem', fontWeight: 800,
                  fontVariantNumeric: 'tabular-nums', color: good ? accent : 'text.secondary',
                }}>
                  {fmtRunValue(r.per, 2)}
                </Typography>
              </Box>
              {/* The bar is the reading, the number is the check. Drawn from the centre so
                  the sign is a direction rather than a minus sign to notice. */}
              <Box sx={{ position: 'relative', height: 6, bgcolor: 'action.hover', borderRadius: 3 }}>
                <Box sx={{
                  position: 'absolute', top: 0, bottom: 0, borderRadius: 3,
                  left: good ? '50%' : `${50 - Math.abs(r.per) / widest * 50}%`,
                  width: `${Math.abs(r.per) / widest * 50}%`,
                  bgcolor: good ? accent : 'text.disabled',
                }} />
                {/* NO ZERO LINE, and it was tried. Every bar in the list starts at the
                    centre, so the shared edge running down all fifteen rows already IS the
                    axis, and a tick drawn on top of it either cuts the fill in half or paints
                    in the card's own colour and disappears. Which side of zero a row sits on is
                    said three ways over: the direction it grows, its colour, and its number. */}
              </Box>
            </Box>
          )
        })}
      </Box>
      <Typography sx={{ fontSize: '0.72rem', color: 'text.disabled', mt: 1.5, lineHeight: 1.5 }}>
        Runs gained or lost on an average one, this season, in this league. The small number is
        how many there have been.
      </Typography>

      {/* A DISCLOSURE, NOT A TOOLTIP, and the difference is the phone. The obvious build is an
          info glyph on the heading, and it is wrong twice here: this is four sentences and an
          arithmetic line rather than a definition of a word, and TapTip's touch path closes
          itself after four seconds, which is a reading deadline on the one explanation the card
          offers. Open it, read it at whatever pace, leave it open. Closed by default because
          the numbers are the card and the method is the follow-up question.
          NO JARGON, still (rule 2 at the top of this file): "run expectancy" and "linear
          weights" are the names for this and neither is on the page. The arithmetic is stated
          in runs, in words, which is the same thing without the vocabulary. */}
      <Box
        {...pressable(() => setMethod(m => !m))}
        aria-expanded={method}
        sx={{
          ...FOCUS_RING,
          mx: -2, mb: method ? 0 : -1.5, mt: 1.5, px: 2, minHeight: 44,
          display: 'flex', alignItems: 'center', gap: 0.75,
          borderTop: '1px solid', borderColor: 'divider',
          cursor: 'pointer', userSelect: 'none', WebkitTapHighlightColor: 'transparent',
          fontSize: '0.75rem', fontWeight: 800, color: 'var(--wpbl-accent-fg)',
          '@media (hover: hover)': { '&:hover': { bgcolor: 'action.hover' } },
        }}
      >
        <Box component="span" aria-hidden sx={{ fontSize: '0.85rem' }}>&#9432;</Box>
        How this is worked out
        <Box component="span" sx={{ ml: 'auto', fontSize: '0.66rem' }}>{method ? '▴' : '▾'}</Box>
      </Box>

      {method && (
        <Box sx={{
          mx: -2, mb: -1.5, px: 2, pt: 1.5, pb: 1.5, bgcolor: 'action.hover',
          fontSize: '0.78rem', lineHeight: 1.65, color: 'text.secondary',
        }}>
          {/* THE EXAMPLE IS THE EXPLANATION, and the formula is the footnote to it. An earlier
              version of this panel led with the formula in words, which is three abstractions
              stacked on each other for anyone who has not met run expectancy: the reader has to
              hold "what it left behind" as an idea before there is anything for it to mean. One
              named player in one real inning, with both situations spelled out and the sum
              landing on a number visibly on the row above, teaches the same thing without
              asking for any of that. Generalise afterwards, once it is concrete.
              NO JARGON, still (rule 2 at the top of this file). Every number in here is read
              off the same pass over the season as the rows above: nothing is written down. */}
          <Typography sx={{ fontSize: 'inherit', lineHeight: 'inherit', mb: 1.5 }}>
            Every situation a batter comes up in is already worth something before a pitch is thrown.
            {leadoff != null && ` Leading off an inning, the four clubs have gone on to score
              ${leadoff.toFixed(2)} runs before the third out, on average.`}
            {' '}What a play is worth is what it did to that.
          </Typography>

          {worked && (
            <Box sx={{
              border: '1px solid', borderColor: 'divider', borderRadius: 2,
              bgcolor: 'background.paper', px: 1.5, py: 1.25, mb: 1.5,
            }}>
              <Typography sx={{ fontSize: '0.7rem', color: 'text.disabled', mb: 0.25 }}>
                {worked.value.play.inning != null && `${worked.value.play.half === 'bottom' ? 'Bottom' : 'Top'}
                  ${worked.value.play.inning}`}
                {workedDate && ` · ${workedDate}`}
              </Typography>
              {/* The feed's own sentence for the play, which is the one thing on this panel
                  nobody has to be taught to read. */}
              <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, color: 'text.primary', mb: 1, lineHeight: 1.45 }}>
                {worked.value.play.narrative || `${worked.value.play.batter_name}, ${worked.event.label.toLowerCase()}`}
              </Typography>

              {/* A LEDGER, so the three terms are three lines a reader can check one at a time
                  rather than one sentence they have to parse in a single breath. The states are
                  named beside their prices, because "1.15" explains nothing on its own. */}
              <Ledger
                label="Runs it put on the board"
                detail={worked.value.runs === 1 ? 'a runner crossed' : `${worked.value.runs} runners crossed`}
                amount={worked.value.runs}
              />
              <Ledger
                label="What it left behind"
                detail={worked.value.afterBases == null || worked.value.afterOuts == null
                  ? 'the inning was over, so nothing'
                  : describeState(worked.value.afterBases, worked.value.afterOuts)}
                amount={worked.value.after}
              />
              <Ledger
                label="What it started with"
                detail={describeState(worked.value.bases, worked.value.outs)}
                amount={-worked.value.before}
              />
              <Box sx={{
                display: 'grid', gridTemplateColumns: '1fr auto', gap: 1, alignItems: 'baseline',
                borderTop: '2px solid', borderColor: 'divider', mt: 0.75, pt: 0.75,
              }}>
                <Typography sx={{ fontSize: '0.78rem', fontWeight: 800, color: 'text.primary' }}>
                  That {worked.event.label.toLowerCase()} was worth
                </Typography>
                <Typography sx={{
                  fontSize: '0.95rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums',
                  color: worked.value.value >= 0 ? accent : 'text.secondary',
                }}>
                  {fmtRunValue(worked.value.value, 2)}
                </Typography>
              </Box>
            </Box>
          )}

          <Typography sx={{ fontSize: 'inherit', lineHeight: 'inherit', mb: 1.5 }}>
            {worked
              ? `That is every number on this card: the runs a play scored, plus what it left
                 behind, minus what it started with. Do that for all ${worked.event.n}
                 ${worked.event.label.toLowerCase()}s this season and the average is
                 ${fmtRunValue(worked.event.per, 2)}, which is the row above.`
              : `Every number on this card is the runs a play scored, plus what it left behind,
                 minus what it started with, averaged over every play of its kind this season.`}
          </Typography>

          {/* NO OTHER LEAGUE IN HERE. The argument for building our own table is a comparison
              with the majors, and it is an argument for whoever wrote the code rather than for
              whoever is reading the card. RunValueView.tsx settled the same question the same
              way and says not to put it back. */}
          <Typography sx={{ fontSize: 'inherit', lineHeight: 'inherit' }}>
            What a situation is worth is measured from this league&rsquo;s own games and nowhere
            else: {table.pa.toLocaleString()} plate appearances this season, every one of them
            scored forward to the end of its inning. A kind of play needs ten of itself before
            it gets a row at all.
          </Typography>
        </Box>
      )}
    </SectionCard>
  )
}

export default function WpblFindingsView({ games, battingLines, onOpenPlayer }: {
  /** Required for the same reason every aggregate here takes it: a play carries a `game_id`
   *  and cannot say by itself whether its game counts. See derive/runExpectancy.ts. */
  games: WpblGame[]
  /** SB and CS live on the box score, not in the play log. Handed down from the Stats tab,
   *  which has already fetched them, so this board adds no request of its own. */
  battingLines?: Pick<WpblBattingLine, 'game_id' | 'player_id' | 'sb' | 'cs'>[]
  onOpenPlayer: (p: WpblPlayer) => void
}) {
  const [plays, setPlays] = useState(() => getCachedWpblAllRunValuePlays())
  const [players, setPlayers] = useState<WpblPlayer[]>(() => getCachedWpblAllPlayers() ?? [])
  const [loading, setLoading] = useState(() => getCachedWpblAllRunValuePlays() == null)

  // Same shape as the two boards beside it: paint from the session cache, then revalidate. The
  // bulk fetchers collapse anything inside their freshness window, so arriving here from Run
  // value does not re-run the season-wide play scan.
  useEffect(() => {
    let cancelled = false
    Promise.all([fetchWpblAllRunValuePlays(), fetchWpblAllPlayers()])
      .then(([p, pl]) => { if (!cancelled) { setPlays(p); setPlayers(pl); setLoading(false) } })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const accent = wpblAccentFg(useWpblDark())
  const experiments = useExperiments()
  const table = useMemo(() => (plays ? buildRunExpectancy(plays, games) : null), [plays, games])
  const values = useMemo(
    () => (plays && table ? playRunValues(plays, games, table) : []), [plays, games, table])
  const econ = useMemo(() => stealEconomy(values), [values])
  const rows = useMemo(() => eventValues(values), [values])
  const worked = useMemo(() => workedExample(values, rows), [values, rows])
  const workedDate = useMemo(() => {
    const g = worked && games.find(x => x.id === worked.value.play.game_id)
    return g ? new Date(`${g.game_date}T00:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' }) : null
  }, [worked, games])
  const runners = useMemo(
    () => topRunners(battingLines ?? [], games, players), [battingLines, games, players])

  if (loading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>
  }
  if (!table || table.pa === 0) {
    return (
      <Box sx={{ textAlign: 'center', py: 6, color: 'text.secondary' }}>
        <Typography sx={{ fontSize: '0.95rem', fontWeight: 700, mb: 0.5 }}>Nothing to say yet</Typography>
        <Typography sx={{ fontSize: '0.82rem', color: 'text.disabled' }}>
          These fill in from the play-by-play as games are played.
        </Typography>
      </Box>
    )
  }

  return (
    <Box sx={{ ...READ_WIDTH, display: 'flex', flexDirection: 'column', gap: { xs: 1.5, sm: 2 } }}>
      {/* ORDER IS THE EDITORIAL DECISION, not a layout one. What a play is worth is a table of
          measurements: every reader can check a row against a game they watched, and nothing on
          it tells anyone they are wrong. The steal card is a verdict built on the same numbers,
          so it reads better second, after the prices it argues from have been seen. It is also
          the one behind the switch, so for most readers this board is the card above and the
          list is not left with a hole in the middle of it. */}
      <PlayValueCard rows={rows} table={table} worked={worked} workedDate={workedDate} accent={accent} />
      {experiments && (
        <StealCard econ={econ} runners={runners} accent={accent} onOpenPlayer={onOpenPlayer} />
      )}
    </Box>
  )
}
