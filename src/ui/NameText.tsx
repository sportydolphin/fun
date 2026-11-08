import { createContext, useContext, type ReactNode, type RefObject } from 'react'
import { Typography } from '@mui/material'
import type { SxProps, Theme } from '@mui/material'
import { nameAtStage, useColumnNameFit, useLineNameFit } from './names'

type ColumnFit = ReturnType<typeof useColumnNameFit<HTMLElement>>
const NameColumnContext = createContext<ColumnFit | null>(null)

/** Every `NameText` (and game-line row) inside shares ONE stage, the longest any of them needs,
 *  so a column of names reads in one style rather than "D. Benites" above "Emi Saiki". `names`
 *  is every name in the column, in any order: a change to it starts the fit over. */
export function NameColumn({ names, children }: { names: string[]; children: ReactNode }) {
  const fit = useColumnNameFit<HTMLElement>(names)
  return <NameColumnContext.Provider value={fit}>{children}</NameColumnContext.Provider>
}

/** The column's fit when inside a `NameColumn`, else this one name's own. */
export function useNameFit(name: string): { ref: ColumnFit['ref'] | RefObject<HTMLElement>; stage: number } {
  const column = useContext(NameColumnContext)
  const own = useLineNameFit<HTMLElement>([name])
  return column ?? own
}

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
  const fit = useNameFit(name)
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
