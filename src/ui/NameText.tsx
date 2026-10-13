import type { ReactNode } from 'react'
import { Typography } from '@mui/material'
import type { SxProps, Theme } from '@mui/material'
import { nameAtStage, useLineNameFit } from './names'

/** One person's name on one line, stepped down to "F. Last" when it does not fit and only then
 *  cut with an ellipsis (CLAUDE.md). A component rather than the hook alone so a row drawn inside
 *  a `.map()` can measure its own name. The parent must let it shrink (`minWidth: 0` on a flex
 *  item), or it never overflows and so never steps down. */
export function NameText({ name, sx, component = 'p', className, linkProps }: {
  name: string
  /** A section's player link, spread onto the name when the name is the link. */
  linkProps?: object
  sx?: SxProps<Theme>
  /** `span` where the name sits inside a link or a line of other text. */
  component?: 'p' | 'span'
  className?: string
}) {
  const fit = useLineNameFit<HTMLElement>([name])
  return (
    <Typography ref={fit.ref} component={component} className={className} noWrap {...linkProps} sx={sx}>
      {nameAtStage(name, fit.stage)}
    </Typography>
  )
}

/** A line holding names among other text ("vs K. Whitmore · in play"), every name stepped down
 *  together until the line fits. `render` gets the formatter for this line's current stage. Same
 *  parent rule as NameText: it has to be allowed to shrink. */
export function NameLine({ names, render, sx, component = 'p' }: {
  names: string[]
  render: (name: (full: string) => string) => ReactNode
  sx?: SxProps<Theme>
  component?: 'p' | 'span'
}) {
  const fit = useLineNameFit<HTMLElement>(names)
  return (
    <Typography ref={fit.ref} component={component} noWrap sx={sx}>
      {render(n => nameAtStage(n, fit.stage))}
    </Typography>
  )
}
