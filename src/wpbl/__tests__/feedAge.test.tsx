import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FeedAge } from '../Live'

// WHAT THIS LINE IS FOR, because it is small enough to look like decoration.
//
// Sep 11, 2026, the semifinal: San Francisco changed pitchers and Game Center went on naming
// Jill Albayati. It was right. The league's boxscore still listed her as their only pitcher at
// 4.0 innings and had not published Niki Eckert at all, so there was nothing else to show; the
// reader was watching the broadcast, which runs ahead of the stats feed. Nothing on screen let
// them tell "this site is wrong" from "the league is a minute behind", and people assume the
// first. This line is the only thing on the page in a position to say which.

const AT = '2026-09-11T23:34:00Z'
const at = (ms: number) => vi.setSystemTime(new Date(Date.parse(AT) + ms))

afterEach(() => { vi.useRealTimers() })

describe('how old the league feed is', () => {
  it('states the time it last spoke while it is keeping up', () => {
    vi.useFakeTimers(); at(30_000)
    render(<FeedAge at={AT} />)
    expect(screen.getByText(/^League feed \d/)).toBeTruthy()
    expect(screen.queryByText(/quiet since/)).toBeNull()
  })

  // The ingest runs every two minutes, so anything past three is the league sitting still
  // rather than our own cadence.
  it('says it has gone quiet once it is properly behind', () => {
    vi.useFakeTimers(); at(4 * 60_000)
    render(<FeedAge at={AT} />)
    expect(screen.getByText(/League feed quiet since \d/)).toBeTruthy()
  })

  // A game with no stamp is not a game with a stale one, and an empty caption reading
  // "League feed Invalid Date" would be worse than no caption.
  it('says nothing at all rather than guessing', () => {
    const { container: a } = render(<FeedAge at={null} />)
    expect(a).toBeEmptyDOMElement()
    const { container: b } = render(<FeedAge at="not a date" />)
    expect(b).toBeEmptyDOMElement()
  })
})
