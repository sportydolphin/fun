import { Box } from '@mui/material'
import { chromePx } from './scale'

// Moved out of src/wpbl/ui.tsx in Oct 2026, when MLB's play-by-play took WPBL's play row and with it
// the diamond and out lamps that close each row. One glyph for both sections, for the reason below.

/**
 * Who is on, in the words a broadcast uses. The accessible name for `BaseDiamond`, and the one
 * spelling of these eight phrases on any surface that has only the three flags.
 *
 * WORD FOR WORD THE SAME EIGHT as `BASE_PHRASE` in `derive/runExpectancy.ts`, and pinned to it
 * by `baseDiamond.test.tsx`. They are not one constant because the shapes differ: that one is
 * keyed on a base bitmask, which is right where a bitmask is what you hold, and importing it
 * here would pull the whole run-expectancy engine into the live scoreboard's chunk to read a
 * string table. Two short lists and a test that compares them is cheaper than that, and the
 * test is what stops them drifting into two spellings of one phrase.
 */
export function basesPhrase(first: boolean, second: boolean, third: boolean): string {
  const on = [first && '1st', second && '2nd', third && '3rd'].filter(Boolean) as string[]
  if (on.length === 0) return 'nobody on'
  if (on.length === 3) return 'bases loaded'
  if (on.length === 1) return `runner on ${on[0]}`
  return `runners on ${on[0]} and ${on[1]}`
}

/**
 * Who is on base, as the shape a scoreboard draws.
 *
 * ONE GLYPH FOR THE WHOLE SECTION: two diamonds that disagree about which corner is second base
 * is the kind of difference a reader notices without being able to say what is wrong. Second at
 * the top, third at the left, first at the right: the view from behind the plate, which is every
 * scoreboard and every broadcast graphic.
 *
 * NO HOME PLATE, deliberately. Nobody stands on it, so drawing it adds a fourth mark that is
 * never filled and makes the three that matter harder to count at 20px.
 *
 * IT CARRIES ITS OWN NAME, AND IT WRITES IT ITSELF. Three unlabelled squares are invisible to a
 * screen reader and to anyone who cannot see the fill, so the glyph is a `role="img"` and its
 * name is derived from the same three flags it draws. Derived rather than passed because a
 * required prop is a prop a new call site can get wrong or paste from its neighbour, and a
 * diamond captioned with the wrong bases is worse than one captioned generically. On the
 * run-value table the name is also what lets the written label be dropped on a phone, which is
 * what stops that table scrolling sideways.
 *
 * `scale` IS EXPLICIT AT EVERY CALL SITE and has no default, because the two answers are both
 * right and the wrong one is invisible. `chrome` is the ordinary one: art in the page grows
 * with `--app-chrome` like TeamBadge and PlayerPortrait do. `none` is for a glyph pinned to a
 * strip whose other lengths are raw px, where scaling one of them pulls the row apart.
 * See the scale rules in CLAUDE.md.
 */
export function BaseDiamond({ first, second, third, size = 34, scale, color = '#60a5fa', context }: {
  first: boolean; second: boolean; third: boolean
  size?: number
  scale: 'chrome' | 'none'
  /** The fill for an occupied base. An empty base is an outline in `text.disabled` either way. */
  color?: string
  /** What this diamond is a picture OF, when the surface means something narrower than "who is
   *  on": "Bases after the play". A PREFIX AND NOT A LABEL, deliberately, for the reason above:
   *  the eight phrases stay derived from the three flags, so no call site can caption a diamond
   *  with bases it is not drawing. All this adds is the sentence a screen reader needs when the
   *  glyph is one of eighty down a list rather than the one live state at the top of a card. */
  context?: string
}) {
  const phrase = basesPhrase(first, second, third)
  const label = context ? `${context}: ${phrase}` : phrase
  const len = (px: number) => (scale === 'chrome' ? chromePx(px) : `${px}px`)
  // The corners are percentages of the frame, so they follow whichever unit the frame took.
  const sq = (occ: boolean, pos: object) => (
    <Box sx={{
      position: 'absolute', ...pos, width: len(size * 0.3), height: len(size * 0.3),
      transform: 'translate(-50%,-50%) rotate(45deg)',
      bgcolor: occ ? color : 'transparent',
      border: '1.5px solid', borderColor: occ ? color : 'text.disabled', borderRadius: '1px',
    }} />
  )
  return (
    <Box role="img" aria-label={label} sx={{
      position: 'relative', width: len(size), height: len(size), flexShrink: 0,
    }}>
      {sq(second, { left: '50%', top: '22%' })}
      {sq(third, { left: '22%', top: '50%' })}
      {sq(first, { left: '78%', top: '50%' })}
    </Box>
  )
}

/**
 * How many are away, as the three lamps a scoreboard lights.
 *
 * ONLY EVER 0, 1 OR 2, AND THE THIRD LAMP IS NEVER LIT. `outs` on a feed row is the count
 * BEFORE the pitch, so this is read off the next play of the half (see `stateAfter`), and a play
 * that started with three away cannot exist: the half would have ended. The third lamp is
 * therefore the one the half-inning is heading towards rather than one that is missing, and the
 * row that would light it is the row that draws no glyphs at all.
 *
 * A GLYPH AND NOT A NUMBER, which is why it follows `--app-chrome` like the diamond it sits
 * beside. "2 out" set in type would be the wider thing on the row and would grow with the
 * reader's text scale while the diamond did not, which is how a pair drifts apart.
 *
 * It carries its own name for the same reason `BaseDiamond` does: three small circles are
 * nothing at all to a screen reader.
 */
export function OutDots({ outs }: { outs: number }) {
  // Clamped for the reason Live.tsx clamps the count: the feed has published a state that
  // cannot exist, and a value out of range should draw the nearest real thing rather than
  // three-and-a-bit lamps.
  const n = Math.max(0, Math.min(3, outs))
  return (
    <Box role="img" aria-label={`${n} out`} sx={{
      display: 'flex', flexDirection: 'column', gap: chromePx(2), flexShrink: 0,
    }}>
      {[0, 1, 2].map(k => (
        <Box key={k} sx={{
          width: chromePx(4), height: chromePx(4), borderRadius: '50%',
          border: '1px solid', borderColor: k < n ? 'text.secondary' : 'text.disabled',
          bgcolor: k < n ? 'text.secondary' : 'transparent',
        }} />
      ))}
    </Box>
  )
}
