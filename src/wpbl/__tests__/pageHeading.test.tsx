import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { render, screen } from '@testing-library/react'
import { Typography } from '@mui/material'
import { WpblHeadingOwnerProvider, useWpblHeadingTag, WpblVisuallyHiddenH1 } from '../PageHeading'

// A player page and a game page are real pages with their own URL, title and canonical, drawn
// as a modal over whichever tab they were opened from. Before this, the tab underneath kept
// rendering its own <h1> and the modal rendered none, so 139 of the sitemap's 168 URLs
// answered "what is this page" with "Women's Pro Baseball League" and the player's own name
// was not a heading of any level.

function Title() {
  return <Typography component={useWpblHeadingTag()}>WPBL Stats</Typography>
}

describe('who owns the page heading', () => {
  it('is the tab, when the tab is the page', () => {
    render(<WpblHeadingOwnerProvider owned><Title /></WpblHeadingOwnerProvider>)
    expect(screen.getByText('WPBL Stats').tagName).toBe('H1')
  })

  it('is not the tab, when a player or game modal is the page', () => {
    // A plain div, not a demotion to h2: the tab's title is decoration at that point, and a
    // second-level heading would put it in the modal's outline as though it were a section
    // of the player's page.
    render(<WpblHeadingOwnerProvider owned={false}><Title /></WpblHeadingOwnerProvider>)
    expect(screen.getByText('WPBL Stats').tagName).toBe('DIV')
  })

  it('defaults to owning it, so a board rendered outside the section still has a heading', () => {
    render(<Title />)
    expect(screen.getByText('WPBL Stats').tagName).toBe('H1')
  })

  it('gives Game Center a heading that is read but not drawn', () => {
    render(<WpblVisuallyHiddenH1>Hunters 7, Queens 3, Aug 23, 2026</WpblVisuallyHiddenH1>)
    const h1 = screen.getByRole('heading', { level: 1 })
    expect(h1).toHaveTextContent('Hunters 7, Queens 3, Aug 23, 2026')
    // Clipped rather than display:none, which would take it out of the accessibility tree
    // and leave the page with no heading again.
    expect(h1.style.clipPath).toBe('inset(50%)')
    expect(h1.style.display).not.toBe('none')
  })
})

// The drift this guards against is invisible in a browser: hardcode `component="h1"` back
// into a tab and every player and game page quietly has two headings again, the first of them
// naming the wrong page.
describe('no tab hardcodes its heading level', () => {
  const TAB_VIEWS = [
    'src/wpbl/Home.tsx',
    'src/wpbl/StatsView.tsx',
    'src/wpbl/TeamsGrid.tsx',
    'src/wpbl/TeamPage.tsx',
    'src/wpbl/WpblApp.tsx',
  ]

  it.each(TAB_VIEWS)('%s asks the context instead', (file) => {
    const src = readFileSync(file, 'utf8')
    expect(src).not.toContain('component="h1"')
    expect(src).toContain('component={headingTag}')
  })
})
