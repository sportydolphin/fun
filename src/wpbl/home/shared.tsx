import { useDark } from '../../ui/useDark'
import { useEffect, useState } from 'react'
import { Typography, alpha } from '@mui/material'
import { WPBL_ACCENT, countdownLabel } from '../constants'
import { linkTo, isModified } from '../../nav'
import { TYPE_SCALE } from '../ui'
import { track } from '../../lib/analytics'
import { HOME_WIDE_W } from '../layoutWidths'

/**
 * The gap between one top-level block of Home and the next, in MUI spacing units.
 *
 * IT HAS TO BEAT THE GAP INSIDE A BLOCK. A section heading sits `mb: 1` above its own content,
 * so the step between blocks must be clearly larger for proximity to group anything: 2.5 gives
 * 25px against 10px, where 1.5 (15 against 10) reads the whole top of the page as one stack.
 * Change this rather than a literal, and change nothing else: the loading skeleton mirrors these
 * blocks pixel for pixel so the real heading lands where the placeholder was, and a literal left
 * behind in one of the four places is a jump on first paint.
 */
export const SECTION_GAP = 2.5

/**
 * The gap under the league header, shared with the skeleton so the heading lands where its
 * placeholder was. The title's size, `{ xs: heading, md: page }`, is written out at both sites
 * because typeScale.test.ts reads every fontSize for a TYPE_SCALE reference.
 *
 * FROM md UP IT IS THE PAGE'S TITLE, at the size every other WPBL page gives its h1. At `heading`
 * it was 21px beside a 38px row of club chips, so the chips set the row's height and the title
 * read as a caption to them, with a full SECTION_GAP of air underneath. The gap is Home's card
 * gap rather than SECTION_GAP: what sits under the title now is the card grid itself (the
 * scoreboard heading that used to follow it is gone in the offseason), and a title reads as the
 * top of what is under it only if it sits close to it. Below md it keeps `heading`: a phone's h1
 * is a small label over the feed that fits one line on a 375px screen only at that size, and from
 * sm to md the title shares its row with the chips and wraps to two lines at the larger size.
 */
export const HEADER_GAP = 1.5

// Home breaks out of the section's 720px page column on a wide screen: the two card columns and
// the bracket's shape need more than 720px, and a desktop has the margin to spend. The viewport
// term keeps it safe rather than a step change: below the cap the width tracks the screen less
// the app's own gutters, so this is a no-op at 1024 and only widens once there is room. The 24px
// of slack stops `100vw` (which counts a classic scrollbar) from giving the whole site a
// horizontal scrollbar.
//
// APPLIED TO THE WHOLE PAGE, not to the grid alone: the scoreboard, the h1 and the league row are
// the same column as the cards, and a grid wider than the strip above it reads as a mistake. `xs`
// opts out: the page already fills a phone, and the transform would only fight the gutter
// SwipeableViews hands each pane. Same device as StatsView's FULL_BLEED_W.
export const homeWideSx = {
  width: { xs: 'auto', md: HOME_WIDE_W },
  position: 'relative',
  left: { xs: 0, md: '50%' },
  transform: { xs: 'none', md: 'translateX(-50%)' },
} as const

export function Countdown({ target }: { target: number }) {
  const [now, setNow] = useState(() => Date.now())
  const isDark = useDark()
  // Once every 15s, not once a second. The label is minute-granular (`countdownLabel`), so a
  // per-second timer would re-render the card 59 times in 60 to paint the same string, on a page a
  // phone leaves open. 15s keeps the worst lag behind a minute boundary short enough that nobody
  // catches it.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15000)
    return () => clearInterval(id)
  }, [])
  // IN THE HEADER LINE, BESIDE THE CARD TITLE, rather than as a block under the matchup. A block
  // costs a band plus its margin inside a card that already scrolls on a phone, to say what the
  // header row has room for: "Next game ... Today, 4:30 PM · in 5h 52m" is one sentence, and the
  // header is where a card says what it is about. The accent and the tint keep the live figure the
  // thing the eye lands on in a row that is otherwise a title and a muted date.
  //
  // THE CHIP IS DRAWN IN HERE, not by the caller, because it has to be able to not exist. Once
  // the start time is far enough past that `countdownLabel` will no longer assert a start it
  // cannot confirm, the whole tinted chip goes with it; wrapped from outside, a null label would
  // leave an empty tinted box on the card, which reads as a value that failed to load rather than
  // one deliberately not claimed. The header then falls back to the date alone, which is all we
  // actually know.
  const label = countdownLabel(target, now)
  if (!label) return null
  return (
    <Typography component="span" sx={{
      // TEXT USES THE FOREGROUND-SAFE ACCENT, the tint behind it uses the raw one. `WPBL_ACCENT`
      // (#60a5fa) measures ~2.3:1 as text on the light-mode paper and is documented in constants.ts
      // as fill-only; as the countdown figure on white it was the pale blue that made this card's
      // one live number the hardest accent on the page to read, and a second blue against the
      // darker `--wpbl-accent-fg` links ("Full recap", "Try it") elsewhere on the feed. The wash
      // stays raw: a 9% fill is what that constant is safe for.
      fontSize: TYPE_SCALE.body, fontWeight: 800, color: 'var(--wpbl-accent-fg)',
      px: 0.7, py: 0.15, borderRadius: 1, lineHeight: 1.35,
      bgcolor: alpha(WPBL_ACCENT, isDark ? 0.14 : 0.09),
      fontVariantNumeric: 'tabular-nums',
    }}>
      {label}
    </Typography>
  )
}

// linkTo plus a product event, fired on the PLAIN click only. A modified click is the reader
// asking the browser for the URL (open in new tab), which linkTo lets through untouched; firing
// the event there too would miscount it as an in-app open. Mirrors LeagueCard's `go`.
export function trackedLinkTo(to: string, event: string, props: Record<string, unknown> = {}) {
  const base = linkTo(to)
  return {
    ...base,
    onClick: (e: React.MouseEvent) => {
      if (!isModified(e)) track(event, props)
      base.onClick(e)
    },
  }
}
