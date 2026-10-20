import { useState } from 'react'
import { Box, Typography, type BoxProps } from '@mui/material'
import type { Theme } from '@mui/material/styles'
import { TYPE_SCALE } from './card'
import { chromePx } from './scale'

/**
 * A club's logo in a ringed circle: the one badge both sections draw.
 *
 * ONE DRAWING BECAUSE MLB HAD FIFTEEN. `LogoBubble`, two unrelated components both called
 * `TeamLogo`, and a dozen circles written inline (the schedule strip, the predictor, the live card,
 * the settings picker), each with its own ring width, its own logo inset, its own idea of whether
 * a faint alpha halo counts as an edge, and two with no ring at all. Side by side on Home they
 * read as three different sets of logos. The section supplies the colors and the art; the shape
 * is decided here once.
 *
 * THE RING IS THE BADGE'S EDGE, so it obeys the outline rule (CLAUDE.md, "Borders"): the caller
 * passes a color already lifted to 3:1 (MLB's `ringColor`, `edge()`), and nothing here fades it.
 * Its width follows the size, so a 16px badge in a table row and a 48px one in a game header are
 * the same drawing at two sizes rather than two drawings.
 *
 * `size` is chrome px, not type: it follows `--app-chrome`, and a club badge does not grow when a
 * reader turns Large text on. A breakpoint object is allowed for the few that change size on a
 * phone; the ring takes the smallest.
 */
export function ClubBadge({
  size, src, alt, bg, ring, ringWidth, fit = 'contain', logoScale = 0.72, logoTransform,
  fallbackInk = '#fff', highlight, decorative, sx, ...rest
}: Omit<BoxProps, 'children'> & {
  size: number | Partial<Record<'xs' | 'sm' | 'md', number>>
  /** The logo. Absent, or failing to load, the badge shows `alt` instead. */
  src?: string
  /** Also the fallback text, so keep it the club's abbreviation. */
  alt: string
  bg: string
  ring: string | ((t: Theme) => string)
  /** Override the size-derived width, for a hero badge that wants a heavier edge. */
  ringWidth?: number
  /** `cover` for finished lockups that fill the circle, `contain` for knockouts on the fill. */
  fit?: 'contain' | 'cover'
  logoScale?: number
  /** A per-club crop (MLB's `teamLogoCrop`). */
  logoTransform?: string
  fallbackInk?: string
  /** A selection ring outside the edge, in this color. */
  highlight?: string
  /** The club is already named in text beside the badge, so a screen reader should not hear it
   *  twice. */
  decorative?: boolean
}) {
  const [failed, setFailed] = useState(false)
  const sizes = typeof size === 'number' ? { xs: size } : size
  const smallest = Math.min(...Object.values(sizes).filter((v): v is number => v != null))
  const box = Object.fromEntries(Object.entries(sizes).map(([k, v]) => [k, chromePx(v!)]))
  // 1px at 12, 2.5px from 30 up, in quarter steps.
  const width = ringWidth ?? Math.min(2.5, Math.max(1, Math.round((smallest / 12) * 4) / 4))
  // A share of the badge's OUTER size, not of what the ring leaves: the ring is thicker on a big
  // badge, and as a percentage of the inside the logo would shrink as the badge grew.
  const inset = fit === 'cover' ? '100%'
    : Object.fromEntries(Object.entries(sizes).map(([k, v]) => [k, chromePx(Math.round(v! * logoScale))]))
  return (
    <Box aria-hidden={decorative || undefined} {...rest} sx={[{
      width: box, height: box, borderRadius: '50%', flexShrink: 0,
      bgcolor: bg, border: `${width}px solid`, borderColor: ring,
      display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
      ...(highlight ? { boxShadow: `0 0 0 2px ${highlight}` } : {}),
    }, ...(Array.isArray(sx) ? sx : [sx])]}>
      {src && !failed ? (
        <Box
          component="img" src={src} alt={decorative ? '' : alt} onError={() => setFailed(true)}
          sx={{
            width: inset, height: inset, objectFit: fit, display: 'block',
            ...(logoTransform ? { transform: logoTransform, transformOrigin: 'center' } : {}),
          }}
        />
      ) : (
        <Typography sx={{
          fontSize: smallest >= 28 ? TYPE_SCALE.caption : TYPE_SCALE.nano,
          fontWeight: 800, color: fallbackInk, lineHeight: 1, userSelect: 'none',
        }}>{alt.slice(0, 3)}</Typography>
      )}
    </Box>
  )
}
