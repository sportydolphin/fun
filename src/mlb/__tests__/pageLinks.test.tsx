import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { Box, Typography } from '@mui/material'
import { playerLink, teamLink, gameLink, rowClick } from '../lib/links'
import { MlbPageH1, MlbHiddenH1, useMlbHeadingTag } from '../components/PageHeading'
import { MLB_PATH_EVENT } from '../routes'

// Googlebot follows hrefs and never fires a click handler, so an MLB row that was a Box with an
// onClick made the page behind it unreachable. These pin that the rows are real links to the
// canonical address, that a plain click still stays in the app, and that a table row (which cannot
// be a link) does not open the page twice when the link inside it is clicked.

describe('MLB link helpers', () => {
  it('points a player at the canonical name-and-id path, and keeps the click in the app', () => {
    const onOpen = vi.fn()
    render(<Box {...playerLink(660271, 'Shohei Ohtani', onOpen)}>Shohei Ohtani</Box>)
    const a = screen.getByRole('link', { name: 'Shohei Ohtani' })
    expect(a.getAttribute('href')).toBe('/mlb/players/shohei-ohtani-660271')
    fireEvent.click(a)
    expect(onOpen).toHaveBeenCalledWith(660271)
  })

  it('links a club to its page, and gives a side with no page a button rather than a wrong href', () => {
    render(<>
      <Box {...teamLink(111, () => {})}>Red Sox</Box>
      <Box {...teamLink(159, () => {})}>American League</Box>
    </>)
    expect(screen.getByRole('link', { name: 'Red Sox' }).getAttribute('href')).toBe('/mlb/teams/red-sox')
    expect(screen.getByRole('button', { name: 'American League' })).toBeTruthy()
  })

  it('links a game card to the game', () => {
    render(<Box {...gameLink(849829, () => {})}>Box</Box>)
    expect(screen.getByRole('link', { name: 'Box' }).getAttribute('href')).toBe('/mlb/games/849829')
  })

  it('is plain text where nothing can open the page', () => {
    render(<Box {...playerLink(1, 'Nobody', undefined)}>Nobody</Box>)
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('opens a table row once whether the name or the rest of the row is clicked', () => {
    const open = vi.fn()
    render(
      <table><tbody>
        <Box component="tr" {...rowClick(() => open(7))}>
          <td><Typography {...playerLink(7, 'Ada Lovelace', open)}>Ada Lovelace</Typography></td>
          <td>.950</td>
        </Box>
      </tbody></table>,
    )
    fireEvent.click(screen.getByRole('link', { name: 'Ada Lovelace' }))
    expect(open).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByText('.950'))
    expect(open).toHaveBeenCalledTimes(2)
  })
})

function ScoresTitle() {
  return <Typography component={useMlbHeadingTag()}>Scores</Typography>
}

describe('one h1 per MLB page', () => {
  beforeEach(() => { window.history.replaceState({}, '', '/mlb/scores') })

  it('is the page heading until a game sheet takes the address, and comes back after', () => {
    // A drawn title and a hidden one side by side, so one test covers both kinds of page.
    render(<><ScoresTitle /><MlbPageH1>MLB Standings</MlbPageH1></>)
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(2)
    act(() => {
      window.history.pushState({}, '', '/mlb/games/849829')
      window.dispatchEvent(new Event(MLB_PATH_EVENT))
    })
    expect(screen.queryAllByRole('heading', { level: 1 })).toHaveLength(0)
    expect(screen.getByText('Scores').tagName).toBe('DIV')
    act(() => {
      window.history.replaceState({}, '', '/mlb/scores')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(screen.getByText('Scores').tagName).toBe('H1')
  })

  it('gives the game sheet a heading that is read but not drawn', () => {
    render(<MlbHiddenH1>Guardians 5, White Sox 3</MlbHiddenH1>)
    const h1 = screen.getByRole('heading', { level: 1 })
    expect(h1.style.clipPath).toBe('inset(50%)')
    expect(h1.style.display).not.toBe('none')
  })
})
