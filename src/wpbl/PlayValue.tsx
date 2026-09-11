import { Box, Typography } from '@mui/material'
import { fmtRunValue, type EventValue, type StealEconomy, type topRunners } from './derive/runExpectancy'
import { SectionCard, pressable, FOCUS_RING, TAPPABLE, hoverOnly } from './ui'
import { ExperimentalChip } from '../ExperimentsContext'
import type { WpblPlayer } from './types'

// The two cards that say what a play is WORTH, as opposed to how often it happened.
//
// THEY USED TO BE A BOARD OF THEIR OWN, CALLED FINDINGS, and that was the mistake. The argument
// for it was real and is kept below, because it is still the reason these two are cards rather
// than chips: the rest of the Stats tab is ways to cut the numbers, and these are answers. What
// it got wrong was the container. A board is a destination, and a destination has to be worth
// choosing by name.
//
// The traffic said it was not being chosen. Of 157 sessions that reached Findings, 84 reached
// every other analysis board too and 10 reached Findings alone: readers were walking the row
// left to right, not picking a label. Reach fell monotonically with position in that row, which
// is what sweeping looks like and what choosing does not. And the cost of the split was on the
// other side: 99 of the 241 sessions that read Run value never saw these cards at all, so 41%
// of the readers of a board priced entirely in run value missed the table those prices come
// from, on a board whose own explainer argues from it.
//
// So they live on Run value now, which is the board they were always about. Same engine
// (derive/runExpectancy.ts), same season pass, same unit. `PlayValueCard` opens the second
// column there, one level simpler than the count grid under it; `StealCard` stays behind the
// experiments switch and follows it.
//
// THREE RULES SURVIVE THE MOVE, ALL THREE FROM THE TRAFFIC RATHER THAN FROM TASTE.
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

/**
 * THE VERDICT CARD, AND THE ONE STILL BEHIND THE SWITCH.
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
export function StealCard({ econ, runners, accent, onOpenPlayer }: {
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
        {/* RESERVED IN REM, NOT PX. Both labels are positioned rather than in flow, because the
            lower one has to sit on the break-even tick, so this box cannot take its height from
            its content and has to reserve it. That makes it a box reserving room for type, and
            the fixed 34px it used to carry fitted at exactly one scale: at the reader's Large
            text setting the lower label already hung out of the bottom of it, and the fixed 16px
            offset put the two line boxes 5px into each other, so the gap between the labels
            SHRANK as the type grew. Desktop is worse, since --app-type multiplies on top.

            Each length is now the line box it is standing in for, in the same unit as the text,
            so the reservation cannot drift from what it reserves. `lineHeight` is pinned here
            for that reason and not for looks: it is the multiplier both lengths are computed
            from, and inheriting it would leave those numbers describing a value set elsewhere. */}
        <Box sx={{ position: 'relative', height: `${(0.78 + 0.72) * 1.5}rem`, mt: 0.75 }}>
          <Typography sx={{ position: 'absolute', left: 0, fontSize: '0.78rem', lineHeight: 1.5, fontWeight: 800, color: worthIt ? accent : 'text.primary' }}>
            {rate(successRate)} of the time it works
          </Typography>
          <Typography sx={{
            position: 'absolute', left: x(breakEven), transform: 'translateX(-50%)', top: `${0.78 * 1.5}rem`,
            fontSize: '0.72rem', lineHeight: 1.5, color: 'text.disabled', whiteSpace: 'nowrap',
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
                ...(r.player ? hoverOnly({ borderColor: accent }) : {}),
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
 *
 * IT NO LONGER EXPLAINS ITSELF, AND THAT IS THE POINT. It used to carry half the run-value
 * explanation behind a disclosure: the leadoff anchor, one play in a ledger, the formula in
 * words. The other half, the 24 situations those prices are read off and the caveats, was on
 * the Run value board, and neither surface mentioned the other. The whole thing now lives
 * there, in the order the idea is built, and this card carries a link to it. What is left here
 * is what only this card has, which is the sixteen measurements.
 */
export function PlayValueCard({ rows, accent, onSeeMethod }: {
  rows: EventValue[]
  accent: string
  /** Opens the explainer card further down the same board. Optional: without it the card simply
   *  shows no "how this works" row, rather than one that goes nowhere. */
  onSeeMethod?: () => void
}) {
  if (rows.length < 4) return null
  const find = (e: string) => rows.find(r => r.event === e)
  const k = find('strikeout'), g = find('groundout'), sac = find('sacrifice')
  const widest = Math.max(...rows.map(r => Math.abs(r.per))) || 1

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

      {/* THE METHOD IS FURTHER DOWN THIS BOARD, AND THIS IS THE WAY TO IT.

          It was a link to another tab until the two were one board: this card carried half the
          run-value explanation behind a disclosure (the leadoff anchor, one play in a ledger,
          the formula in words) while the 24 situations those prices are read off sat on Run
          value with the rest of the fine print. Two halves, two tabs, neither one whole, and
          nothing on either saying the other existed.

          A POINTER RATHER THAN A DUPLICATE, which is the part that still matters now that the
          journey is a scroll. The explanation is the thing most likely to be edited, and a copy
          of it here is a copy that goes stale the first time somebody improves the original.
          This card keeps what only it has, which is the measurements.

          NO JARGON, still (rule 2 at the top of this file): "run expectancy" and "linear
          weights" are the names for what this leads to and neither is on the page. */}
      {onSeeMethod && (
        <Box
          {...pressable(onSeeMethod)}
          sx={{
            ...FOCUS_RING,
            mx: -2, mb: -1.5, mt: 1.5, px: 2, minHeight: 44,
            display: 'flex', alignItems: 'center', gap: 0.75,
            borderTop: '1px solid', borderColor: 'divider',
            cursor: 'pointer', userSelect: 'none', WebkitTapHighlightColor: 'transparent',
            fontSize: '0.75rem', fontWeight: 800, color: 'var(--wpbl-accent-fg)',
            ...TAPPABLE,
          }}
        >
          <Box component="span" aria-hidden sx={{ fontSize: '0.85rem' }}>&#9432;</Box>
          How this is worked out
          <Box component="span" aria-hidden sx={{ ml: 'auto', fontSize: '0.8rem' }}>&darr;</Box>
        </Box>
      )}
    </SectionCard>
  )
}
