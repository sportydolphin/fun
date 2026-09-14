import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { render, screen } from '@testing-library/react'
import { Typography } from '@mui/material'
import { WpblHeadingOwnerProvider, WpblNavAtBottomProvider, useWpblHeadingTag, useTabHeadingPhoneSx, WpblVisuallyHiddenH1 } from '../PageHeading'

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

// A tab title is clipped-but-in-DOM on a phone because the nav overhead already names it. Move the
// nav to the foot of the screen (the mobile bottom bar) and that justification is gone: the title
// becomes the page's only top-of-screen label and must be drawn. The failure is invisible in the
// browser and worse than the heading-level one, because it leaves the phone opening onto unlabelled
// content with no sign anything is wrong.
function PhoneSxProbe() {
  const sx = useTabHeadingPhoneSx() as Record<string, unknown>
  return <span data-testid="sx">{Object.keys(sx).length === 0 ? 'drawn' : 'hidden-on-phone'}</span>
}

describe('a tab title hides on a phone only while the nav is overhead', () => {
  it('hides on a phone by default, where the pill nav sits above it', () => {
    render(<PhoneSxProbe />)
    expect(screen.getByTestId('sx')).toHaveTextContent('hidden-on-phone')
  })

  it('is drawn on a phone once the nav has moved to the foot of the screen', () => {
    render(<WpblNavAtBottomProvider value><PhoneSxProbe /></WpblNavAtBottomProvider>)
    expect(screen.getByTestId('sx')).toHaveTextContent('drawn')
  })

  it('hides again where the bottom bar is off (desktop, and the shipped top-nav phone)', () => {
    render(<WpblNavAtBottomProvider value={false}><PhoneSxProbe /></WpblNavAtBottomProvider>)
    expect(screen.getByTestId('sx')).toHaveTextContent('hidden-on-phone')
  })
})

// The source counterpart to the behaviour above: every tab title has to go through the hook, or its
// own title silently stays hidden on a phone under the bottom bar while the other four appear. A
// bare `...HIDE_ON_PHONE` spread back onto a title is exactly that regression, and it renders fine
// on a desktop and in a top-nav phone, so nothing but this catches it.
describe('every tab title reveals itself when the nav moves to the foot', () => {
  const TAB_TITLE_FILES = [
    'src/wpbl/Home.tsx',
    'src/wpbl/StatsView.tsx',
    'src/wpbl/TeamsGrid.tsx',
    'src/wpbl/WpblApp.tsx', // Schedule and Standings both live here
  ]

  it.each(TAB_TITLE_FILES)('%s spreads useTabHeadingPhoneSx into its title', (file) => {
    const src = readFileSync(file, 'utf8')
    expect(src).toContain('useTabHeadingPhoneSx')
    expect(src).toContain('...hidePhone')
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
