import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { render, screen } from '@testing-library/react'
import { Typography } from '@mui/material'
import { WpblHeadingOwnerProvider, useWpblHeadingTag, WpblVisuallyHiddenH1, TabTitle } from '../PageHeading'
import { PanelActiveContext } from '../../lib/panelActive'

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

// A tab title is the only thing at the top of a phone saying which page this is: the section nav
// there is the bottom bar. Hiding it on a phone (as every title once did, while the phone's tabs
// were a pill row at the top naming the page) leaves the phone opening onto unlabelled content,
// and it renders fine on a desktop, so only this catches it coming back.
describe('every tab title is drawn on a phone', () => {
  const TAB_TITLE_FILES = [
    'src/wpbl/StatsView.tsx',
    'src/wpbl/TeamsGrid.tsx',
    'src/wpbl/WpblApp.tsx', // Scores and Standings both live here
  ]

  it.each(TAB_TITLE_FILES)('%s draws its title through TabTitle', (file) => {
    expect(readFileSync(file, 'utf8')).toContain('<TabTitle')
  })

  it('TabTitle spreads nothing that hides it', () => {
    const src = readFileSync('src/wpbl/PageHeading.tsx', 'utf8')
    const body = src.slice(src.indexOf('export function TabTitle'))
    expect(body).not.toMatch(/HIDE_ON_PHONE|VISUALLY_HIDDEN|hidePhone/)
  })

  it("Home's title, which is not a TabTitle, spreads nothing that hides it either", () => {
    const src = readFileSync('src/wpbl/Home.tsx', 'utf8')
    const at = src.indexOf("Women's Pro Baseball League\n          </Typography>")
    expect(at).toBeGreaterThan(-1)
    const tag = src.slice(src.lastIndexOf('<Typography', at), at)
    expect(tag).not.toMatch(/HIDE_ON_PHONE|VISUALLY_HIDDEN|hidePhone/)
  })
})

// A tab the pager keeps mounted behind the one on screen is not the page, so its title steps down
// to a div; left as an h1, every visited tab added a heading to the page.
describe('a kept-alive tab off screen', () => {
  it('draws its title as a div', () => {
    render(<PanelActiveContext.Provider value={false}><TabTitle>WPBL Teams</TabTitle></PanelActiveContext.Provider>)
    expect(screen.getByText('WPBL Teams').tagName).toBe('DIV')
  })

  it('and as the h1 once it is on screen', () => {
    render(<PanelActiveContext.Provider value><TabTitle>WPBL Teams</TabTitle></PanelActiveContext.Provider>)
    expect(screen.getByText('WPBL Teams').tagName).toBe('H1')
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
    expect(src.includes('component={headingTag}') || src.includes('<TabTitle')).toBe(true)
  })

  it('TabTitle asks the context too', () => {
    const src = readFileSync('src/wpbl/PageHeading.tsx', 'utf8')
    const body = src.slice(src.indexOf('export function TabTitle'))
    expect(body).toContain('useWpblHeadingTag()')
    expect(body).toContain('component={headingTag}')
  })
})
