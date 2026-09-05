import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import FeedDelayNote from '../FeedDelayNote'
import { gameStartMs } from '../constants'
import type { FeedHealthGame } from '../derive/feedHealth'

// The copy, pinned. `feedHealth` decides WHETHER to speak and this decides WHAT it says, and
// the sentence is the whole feature: a reader who is told "something went wrong" learns
// nothing, and one who is told the wrong party is at fault is worse off than one told nothing.

const DATE = '2026-08-30'
const TIME = '6:30 PM'
const START = gameStartMs(DATE, TIME)!
const at = (mins: number) => START + mins * 60_000
const ago = (now: number, mins: number) => new Date(now - mins * 60_000).toISOString()

const game = (over: Partial<FeedHealthGame> = {}): FeedHealthGame => ({
  game_date: DATE, start_time: TIME, status: 'scheduled',
  updated_at: new Date(START).toISOString(),
  source_updated_at: new Date(START).toISOString(),
  ...over,
})

describe('when the league has gone quiet', () => {
  it('names the league as the source and gives the gap', () => {
    const now = at(30)
    render(<FeedDelayNote game={game({ updated_at: ago(now, 1), source_updated_at: ago(now, 124) })} now={now} />)
    expect(screen.getByText('Waiting on the league')).toBeTruthy()
    // The reader has to be able to see WHERE the silence is, which is what the source and the
    // elapsed time do between them. Neither alone is enough.
    expect(screen.getByText(/No update from the WPBL feed since/)).toBeTruthy()
    expect(screen.getByText(/2h 04m ago/)).toBeTruthy()
  })

  it('tells the reader not to sit there refreshing', () => {
    const now = at(30)
    render(<FeedDelayNote game={game({ updated_at: ago(now, 1), source_updated_at: ago(now, 40) })} now={now} />)
    expect(screen.getByText(/fills in on its own/)).toBeTruthy()
  })

  it('drops that second sentence when compact, and keeps the first', () => {
    const now = at(30)
    render(<FeedDelayNote game={game({ updated_at: ago(now, 1), source_updated_at: ago(now, 40) })} now={now} compact />)
    expect(screen.getByText(/No update from the WPBL feed since/)).toBeTruthy()
    expect(screen.queryByText(/fills in on its own/)).toBeNull()
  })
})

describe('when it is our own fault', () => {
  // The variant that keeps the whole thing honest. A notice that can only ever blame somebody
  // else is a disclaimer, and readers learn to discount it.
  it('says so plainly and does not mention the league', () => {
    const now = at(60)
    render(<FeedDelayNote game={game({ updated_at: ago(now, 45), source_updated_at: ago(now, 45) })} now={now} />)
    expect(screen.getByText('Our data is behind')).toBeTruthy()
    expect(screen.queryByText(/WPBL feed/)).toBeNull()
    expect(screen.queryByText('Waiting on the league')).toBeNull()
  })
})

describe('the sentence stays a sentence', () => {
  // A row with no upstream stamp used to read "…for 18m ago", and the gap was measured from
  // the Unix epoch, so it offered "56 years ago" under a baseball game.
  it('reads properly when the row carries no upstream stamp at all', () => {
    const now = at(30)
    render(<FeedDelayNote game={game({ updated_at: ago(now, 1), source_updated_at: null })} now={now} />)
    const el = screen.getByText(/No update from the WPBL feed/)
    expect(el.textContent).toContain('No update from the WPBL feed yet.')
    expect(el.textContent).not.toMatch(/ago/)
    expect(el.textContent).not.toMatch(/19[0-9]{2}|years/)
  })
})

describe('silence', () => {
  it('renders nothing at all in the ordinary case', () => {
    const now = at(30)
    const { container } = render(
      <FeedDelayNote game={game({ updated_at: ago(now, 1), source_updated_at: ago(now, 2) })} now={now} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing before first pitch, however old the upstream stamp', () => {
    const now = START - 60_000
    const { container } = render(
      <FeedDelayNote game={game({ updated_at: ago(now, 1), source_updated_at: '2026-07-25T01:43:37Z' })} now={now} />)
    expect(container.innerHTML).toBe('')
  })
})

describe('when we called the game and the league has not', () => {
  // A settled row reads `status: 'final'` to the rest of the section on purpose, so this note
  // is the ONLY thing on the page that distinguishes our call from theirs. A reader comparing
  // the score against the league's own site will find a disagreement; finding it explained is
  // very different from finding it alone.
  const settled = game({ status: 'final', final_by_rule: true })

  it('says whose call it is, in the first three words', () => {
    render(<FeedDelayNote game={settled} now={at(200)} />)
    expect(screen.getByText('Final by our count')).toBeTruthy()
    expect(screen.getByText(/has not posted this game as final yet/)).toBeTruthy()
    // Where the score came from, separately from where the call came from. They are different
    // provenances and the sentence would be misleading if it claimed both.
    expect(screen.getByText(/The score is theirs/)).toBeTruthy()
  })

  it('says nothing at all once the league posts it', () => {
    const { container } = render(<FeedDelayNote game={game({ status: 'final' })} now={at(200)} />)
    expect(container.firstChild).toBeNull()
  })
})
