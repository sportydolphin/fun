import { describe, it, expect } from 'vitest'
import { outsToIp, ipToOuts, playedInnings } from '../innings'

const line = (runs: number[]) => runs.map((r, i) => ({ inning: i + 1, runs: r }))

describe('outsToIp / ipToOuts', () => {
  it('round-trips the thirds a scorebook actually writes', () => {
    for (const ip of ['0.0', '0.1', '5.2', '7.0', '12.1']) expect(outsToIp(ipToOuts(ip))).toBe(ip)
  })

  it('clamps a fraction the feed should never send', () => {
    expect(ipToOuts('5.3')).toBe(ipToOuts('5.2'))
  })
})

// The feed stamps a trailing roster line with the next inning's number and then reports the
// inflated total in its own status, which put a phantom 0-0 eighth on two of the league's
// first twelve finals. These are those games' real line scores.
describe('playedInnings', () => {
  it('keeps a regulation game whole, including a scoreless last inning', () => {
    expect(playedInnings(line([0, 0, 0, 2, 0, 1, 0]), line([3, 5, 2, 5, 1, 1, 0]))).toBe(7)
  })

  it('drops an eighth the feed invented from a substitution', () => {
    // SF 11 @ NY 6 — the "8th" was one line: "Rakyung Kim to cf."
    expect(playedInnings(line([0, 1, 3, 2, 3, 0, 2, 0]), line([1, 0, 0, 2, 0, 2, 1, 0]))).toBe(7)
  })

  it('drops an eighth with no plays behind it at all', () => {
    // BOS 6 @ NY 1 — line arrays ran to 8, the play log stopped at 7.
    expect(playedInnings(line([2, 0, 0, 1, 3, 0, 0, 0]), line([0, 0, 0, 1, 0, 0, 0, 0]))).toBe(7)
  })

  it('keeps a real extra inning, which can only follow a tie', () => {
    // NY 7 @ BOS 6 — 5-5 after seven, then both sides scored in the 8th.
    expect(playedInnings(line([1, 0, 2, 2, 0, 0, 0, 2]), line([1, 0, 0, 1, 3, 0, 0, 1]))).toBe(8)
  })

  it('unwinds a run of phantom innings rather than just the last one', () => {
    expect(playedInnings(line([1, 0, 0, 0, 0, 0, 0, 0, 0]), line([0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(7)
  })

  it('leaves a shortened game short instead of padding it to regulation', () => {
    expect(playedInnings(line([1, 0, 0, 2, 0]), line([0, 0, 1, 0, 0]))).toBe(5)
  })

  it('handles an empty or missing line score', () => {
    expect(playedInnings(null, undefined)).toBe(0)
    expect(playedInnings([], [])).toBe(0)
  })
})
