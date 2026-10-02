// The desktop scale's two units, shared by both sections. Moved out of src/wpbl/ui.tsx in Oct 2026
// when MLB came off `zoom: 1.4` onto the same ramp; WPBL re-exports it from there, so its imports
// did not change. See the scale block at the top of styles.css for the variables themselves.

/** A structural pixel length, scaled by the desktop chrome scale.
 *
 *  STRUCTURE SCALES, ORNAMENT DOES NOT. Ordinary CSS has no equivalent of `zoom`, so each px
 *  length either says it scales or stays at its written size. The ones that MUST scale are the
 *  ones that decide how much fits: column widths, rail widths, a dialog's cap. Left at their
 *  written size those boxes silently shrink relative to the type inside them, and a name that
 *  fit on one line wraps onto two.
 *
 *  Ornament is deliberately left alone: hairline borders, the 6px live dot, a 4px scrollbar.
 *  At this scale they are a pixel or two either way, and a 1px border that stays 1px is
 *  sharper for it.
 */
export const chromePx = (px: number) => `calc(${px}px * var(--app-chrome, 1))`

/** The chrome scale as a number, for the few lengths spent in JS rather than CSS (a `scrollBy`
 *  distance). Read off the root, where styles.css resolves it per breakpoint, so it is 1 on a
 *  phone and the desktop scale above that without this having to know which. */
export function chromeScale(): number {
  if (typeof document === 'undefined') return 1
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-chrome')) || 1
}

/** A pixel length that belongs to TYPE (letter spacing), as rem, so it follows the type scale and
 *  the reader's Large text setting the way the font size beside it does. MUI reads a bare number
 *  here as px, which the old `zoom` scaled and the ramp does not. */
export const typePx = (px: number) => `${+(px / 16).toFixed(4)}rem`
