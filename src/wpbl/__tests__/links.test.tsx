import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Box } from '@mui/material'
import { WpblLinkProvider, useWpblPlayerLink, useWpblGameLink } from '../LinkContext'

// Every player name on the section used to be a div with an onClick and nothing else, which
// fails silently in three directions at once: a crawler cannot follow it, a keyboard cannot
// reach it, and there is nothing to open in a new tab. 118 player URLs sat in the sitemap
// with no internal link pointing at any of them. These pin the anchor back on.

const ROSTER = [
  { id: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'Denae Benites' },
  { id: 'bbbbbbbb-0000-0000-0000-000000000002', name: 'Kelsie Whitmore' },
  // Two people who share a name, which is what forces the id-suffixed slug on BOTH of them.
  { id: 'cccccccc-0000-0000-0000-000000000003', name: 'Alex Rivera' },
  { id: 'dddddddd-0000-0000-0000-000000000004', name: 'Alex Rivera' },
]

function Row({ player, onOpen, roster = ROSTER }: {
  player: { id: string; name: string }
  onOpen?: (p: { id: string; name: string }) => void
  roster?: readonly { id: string; name: string }[]
}) {
  return (
    <WpblLinkProvider roster={roster} schedule={[]} teams={[]}>
      <Inner player={player} onOpen={onOpen} />
    </WpblLinkProvider>
  )
}

function Inner({ player, onOpen }: {
  player: { id: string; name: string }
  onOpen?: (p: { id: string; name: string }) => void
}) {
  const playerLink = useWpblPlayerLink()
  return <Box {...playerLink(player, onOpen)}>{player.name}</Box>
}

describe('player links', () => {
  it('renders a real anchor at the player’s canonical URL', () => {
    render(<Row player={ROSTER[0]} onOpen={() => {}} />)
    const el = screen.getByText('Denae Benites')
    expect(el.tagName).toBe('A')
    expect(el.getAttribute('href')).toBe('/wpbl/players/denae-benites')
  })

  it('takes the id-suffixed slug when the name is shared', () => {
    // The bare slug resolves to nobody in that case (see routes.ts), so linking to it would
    // point every one of them at a 404.
    render(<Row player={ROSTER[2]} onOpen={() => {}} />)
    expect(screen.getByText('Alex Rivera').getAttribute('href'))
      .toBe('/wpbl/players/alex-rivera-cccccccc')
  })

  it('opens in-app on a plain click without letting the browser navigate', () => {
    const onOpen = vi.fn()
    render(<Row player={ROSTER[0]} onOpen={onOpen} />)
    const el = screen.getByText('Denae Benites')
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true })
    fireEvent(el, ev)
    expect(onOpen).toHaveBeenCalledWith(ROSTER[0])
    expect(ev.defaultPrevented).toBe(true)
  })

  it('leaves a modified click to the browser, so open-in-new-tab works', () => {
    const onOpen = vi.fn()
    render(<Row player={ROSTER[0]} onOpen={onOpen} />)
    const el = screen.getByText('Denae Benites')
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true })
    fireEvent(el, ev)
    expect(onOpen).not.toHaveBeenCalled()
    // Left for the browser. jsdom prints "Not implemented: navigation" on this line and that
    // is the assertion passing out loud: it is jsdom saying a real browser would now be
    // following the href, which is the whole point of a cmd-click.
    expect(ev.defaultPrevented).toBe(false)
  })

  it('does not let a row underneath open the same player a second time', () => {
    // Several of these anchors sit inside a row that also opens the player. Without the
    // stopPropagation one click would push two history entries, the second a dead Back.
    const rowClick = vi.fn()
    const onOpen = vi.fn()
    render(
      <Box onClick={rowClick}>
        <Row player={ROSTER[0]} onOpen={onOpen} />
      </Box>,
    )
    fireEvent.click(screen.getByText('Denae Benites'))
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(rowClick).not.toHaveBeenCalled()
  })

  it('stays a plain click until the roster lands, rather than guessing a slug', () => {
    const onOpen = vi.fn()
    render(<Row player={ROSTER[0]} onOpen={onOpen} roster={[]} />)
    const el = screen.getByText('Denae Benites')
    expect(el.tagName).not.toBe('A')
    fireEvent.click(el)
    expect(onOpen).toHaveBeenCalledWith(ROSTER[0])
  })
})

// ─── Game links ────────────────────────────────────────────────────────────────
//
// Game Center was deep-linkable as ?game=<uuid> from the start, which seo.ts canonicalises
// back to the tab underneath: every recap the section rendered was unindexable by design,
// and the schedule cards were bare onClick divs because there was no href to give them.

const TEAMS = [
  { id: 'BOS', name: 'Hunters' },
  { id: 'LA', name: 'Queens' },
]
const SCHEDULE = [
  { id: 'aaaaaaaa-0000-0000-0000-000000000001', game_date: '2026-08-23', home_team_id: 'BOS', away_team_id: 'LA' },
  { id: 'bbbbbbbb-0000-0000-0000-000000000002', game_date: '2026-08-22', home_team_id: 'LA', away_team_id: 'BOS' },
]

function GameRow({ game, onOpen, schedule = SCHEDULE, teams = TEAMS }: {
  game: { id: string; game_date: string; home_team_id: string; away_team_id: string }
  onOpen?: (g: { id: string }) => void
  schedule?: readonly { id: string; game_date: string; home_team_id: string; away_team_id: string }[]
  teams?: readonly { id: string; name: string }[]
}) {
  return (
    <WpblLinkProvider roster={ROSTER} schedule={schedule} teams={teams}>
      <GameInner game={game} onOpen={onOpen} />
    </WpblLinkProvider>
  )
}

function GameInner({ game, onOpen }: {
  game: { id: string; game_date: string; home_team_id: string; away_team_id: string }
  onOpen?: (g: { id: string }) => void
}) {
  const gameLink = useWpblGameLink()
  return <Box {...gameLink(game, onOpen)}>the game</Box>
}

describe('game links', () => {
  it('renders a real anchor at the game’s canonical URL', () => {
    render(<GameRow game={SCHEDULE[0]} onOpen={() => {}} />)
    const el = screen.getByText('the game')
    expect(el.tagName).toBe('A')
    expect(el.getAttribute('href')).toBe('/wpbl/games/2026-08-23-queens-at-hunters')
  })

  it('opens Game Center in-app rather than reloading the page', () => {
    const onOpen = vi.fn()
    render(<GameRow game={SCHEDULE[0]} onOpen={onOpen} />)
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true })
    fireEvent(screen.getByText('the game'), ev)
    expect(onOpen).toHaveBeenCalledWith(SCHEDULE[0])
    expect(ev.defaultPrevented).toBe(true)
  })

  it('stays a plain click until the schedule and the clubs land', () => {
    // The matchup half of the slug is nicknames, so the clubs are as load-bearing as the
    // schedule: without them every link would come out as ids and then change shape.
    for (const props of [{ schedule: [] }, { teams: [] }]) {
      const onOpen = vi.fn()
      const { unmount } = render(<GameRow game={SCHEDULE[0]} onOpen={onOpen} {...props} />)
      const el = screen.getByText('the game')
      expect(el.tagName).not.toBe('A')
      fireEvent.click(el)
      expect(onOpen).toHaveBeenCalledWith(SCHEDULE[0])
      unmount()
    }
  })
})
