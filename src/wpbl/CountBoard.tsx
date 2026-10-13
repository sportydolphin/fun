import { useDark } from '../ui/useDark'
import { Box, Typography } from '@mui/material'
import { SectionCard } from './ui'
import { mixHex, heatCell } from '../lib/contrast'
import { fmtRunValue } from './derive/runExpectancy'
import { pitchSwing, countKey } from './derive/countValue'
import type { CountValue } from './derive/countValue'
import { typePx } from '../ui/scale'
import { InfoDot } from '../ui/InfoDot'

// The axis labels, spelled the way the situations grid's "0 outs" header on the same board is,
// so the two grids a reader meets one card apart do not label their axes in two styles.
const AXIS_SX = {
  fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: typePx(0.6),
  color: 'text.secondary',
} as const

// ─── What every count is worth ────────────────────────────────────────────────
//
// A GRID SHAPED LIKE A COUNT, not a ranked list. The count has two axes and every reader
// already carries them in their head, so sorting twelve rows by value would throw away the
// one piece of structure the audience arrives with. Balls down, strikes across: 3-0 is bottom
// left, 0-2 is top right, and the diagonal between them reads as the thing it actually is.
//
// THE COLOUR IS THE VALUE AND SO IS THE NUMBER. This has to survive being read by someone who
// cannot separate red from green and by someone printing it in grey, and a hot-cold grid with
// the figures taken out is exactly the chart that does not. Hue carries the sign, opacity
// carries the size, and the figure under them carries both.

export default function CountBoard({ counts, fullCount, accent }: {
  counts: CountValue[]
  /** The gap between a ball and a strike on 3-2, which this card's own grid cannot produce:
   *  both outcomes leave it. Measured from the pitches themselves by `fullCountSwing`, and
   *  quoted here because it is the number that gives the grid its scale. Null until both
   *  sides of it have been thrown often enough to price. */
  fullCount: number | null
  accent: string
}) {
  const dark = useDark()
  // The card the grid sits on, and the theme's error red, as hex: the cells are mixed from them.
  const card = dark ? '#0f1115' : '#ffffff'
  const neg = dark ? '#f44336' : '#d32f2f'
  const byKey = new Map(counts.map(c => [c.key, c]))
  // Scaled to the widest cell rather than to a fixed range: this league's runs are roughly
  // double a major-league one, so any hardcoded span would wash the whole grid out.
  const span = Math.max(...counts.map(c => Math.abs(c.per)), 0.01)
  const first = pitchSwing(counts, { balls: 0, strikes: 0 })

  const best = counts.reduce((a, b) => (b.per > a.per ? b : a))
  const worst = counts.reduce((a, b) => (b.per < a.per ? b : a))

  // NO WIDTH CAP OF ITS OWN. The board this sits in gives it a column, and two caps for one
  // question left the grid stopping short of its own column's edge on a wide screen while the
  // leaderboard beside it did not.
  return (
    <Box sx={{ minWidth: 0 }}>
      <SectionCard title="What every count is worth"
        titleAdornment={<InfoDot text={[
          "Every plate appearance passes through a run of counts on its way to an outcome, starting at 0-0. A count's number is the average run value of every plate appearance that reached it, however it ended.",
          "So 0-0 is this league's average plate appearance, and every other count reads against it.",
          'The small number is how many plate appearances reached that count. Counts reached fewer than 25 times are left blank.',
        ]} />}>
        <Typography sx={{ fontSize: '0.82rem', color: 'text.secondary', mb: 1.25, lineHeight: 1.6 }}>
          {/* A GAP, SO NO SIGN. These two used to print "+0.13" and "+1.05" beside a grid whose
              3-2 cell reads +0.14, and a signed number in that sentence reads as another cell. */}
          {first != null && (
            <>Ball or strike on the first pitch is a swing of <strong>{Math.abs(first).toFixed(2)}</strong>{' '}
              runs, the gap between 1-0 and 0-1.</>
          )}
          {/* THE RANGE, WHICH IS THE POINT OF THE CARD. One pitch being worth a tenth of a run
              reads as small until it is set beside the same pitch on 3-2, where the two
              outcomes are a walk and a strikeout and it is worth eight times as much. That
              cell cannot say so itself: 4-2 and 3-3 are not counts, so the grid stops one
              pitch short of its own most interesting number. */}
          {fullCount != null && (
            <> On 3-2, where it is ball four or strike three, the swing is{' '}
              <strong>{Math.abs(fullCount).toFixed(2)}</strong>.</>
          )}
        </Typography>

        <Box sx={{ display: 'grid', gridTemplateColumns: 'auto repeat(3, 1fr)', gap: 0.5 }}>
          <Box />
          {[0, 1, 2].map(s => (
            <Typography key={s} sx={{ ...AXIS_SX, textAlign: 'center' }}>
              {s} {s === 1 ? 'strike' : 'strikes'}
            </Typography>
          ))}

          {[0, 1, 2, 3].map(b => (
            <Box key={b} sx={{ display: 'contents' }}>
              <Typography sx={{ ...AXIS_SX, alignSelf: 'center', pr: 0.75, whiteSpace: 'nowrap' }}>
                {b} {b === 1 ? 'ball' : 'balls'}
              </Typography>
              {[0, 1, 2].map(st => {
                const c = byKey.get(countKey({ balls: b, strikes: st }))
                if (!c) {
                  return (
                    <Box key={st} sx={{
                      borderRadius: 1.5, border: '1px dashed', borderColor: 'outline',
                      py: 1.4, textAlign: 'center',
                    }}>
                      <Typography sx={{ fontSize: '0.6rem', color: 'text.disabled' }}>—</Typography>
                    </Box>
                  )
                }
                // THE FILL FADES, NOT THE CELL. This was `opacity` on the whole cell, which faded the
                // white figures with it: the palest cells measured 1.4:1. Mixed into the card's own
                // colour instead, and inked white or near-black by what that fill actually is.
                const { fill, ink } = heatCell(mixHex(c.per >= 0 ? accent : neg, card, 0.25 + 0.75 * (Math.abs(c.per) / span)))
                return (
                  <Box key={st} sx={{
                    borderRadius: 1.5, py: 0.9, px: 0.5, textAlign: 'center',
                    bgcolor: fill, color: ink,
                  }}>
                    <Typography sx={{ fontSize: '0.55rem', fontWeight: 800, color: 'inherit' }}>
                      {c.key}
                    </Typography>
                    {/* TWO DECIMALS, not the one place the rest of this board uses. The whole
                        grid lives inside about half a run, so a tenth collapses it: 0-2 and
                        1-2 printed the same figure while one is materially worse than the
                        other, and comparing two cells got no answer from the number. */}
                    <Typography sx={{ fontSize: '0.95rem', fontWeight: 900, color: 'inherit', fontVariantNumeric: 'tabular-nums', lineHeight: 1.25 }}>
                      {fmtRunValue(c.per, 2)}
                    </Typography>
                    <Typography sx={{ fontSize: '0.5rem', fontWeight: 700, color: 'inherit' }}>
                      {c.n.toLocaleString()} PA
                    </Typography>
                  </Box>
                )
              })}
            </Box>
          ))}
        </Box>

        {/* The two ends of the grid in words, because the one thing a reader should take from
            this card is the size of the gap rather than any single cell. */}
        <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary', mt: 1.25, lineHeight: 1.55 }}>
          Best count for a hitter: <strong>{best.key}</strong> ({fmtRunValue(best.per, 2)}
          {', '}{Math.round(best.walk * 100)}% walked). Worst: <strong>{worst.key}</strong>
          {' '}({fmtRunValue(worst.per, 2)}, {Math.round(worst.strikeout * 100)}% struck out).
        </Typography>
      </SectionCard>
    </Box>
  )
}
