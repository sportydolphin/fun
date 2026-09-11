import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { WpblGame, WpblGamePlay, WpblPitchingLine, WpblPlayer, WpblTeam } from '../types'

// WHERE A PLAY'S ACCOUNT CAME FROM, said on the play.
//
// The Aug 20, 2026 game (NY 9, BOS 4) showed two Katherine Murphy singles in the play-by-play
// against a box score crediting her one, and a reader asked why. Both numbers were right about
// their own source: the league published the whole of New York's sixth and seventh as rows
// carrying a pitcher, a pitch sequence and nothing else, so fill-wpbl-play-gaps filled them from
// RetroWPBL's independent transcription. Two readings of one game disagree about that at-bat,
// and the page was presenting it as one reading that did not add up.

const NY = { id: 'NY', abbr: 'NY', name: 'Heights' } as WpblTeam
const BOS = { id: 'BOS', abbr: 'BOS', name: 'Hunters' } as WpblTeam

const GAME = {
  id: 'g1', game_date: '2026-08-20', start_time: null,
  home_team_id: 'BOS', away_team_id: 'NY', venue: null,
  status: 'final', home_score: 4, away_score: 9, innings: 7, notes: null,
  home_line: [{ inning: 1, runs: 4 }], away_line: [{ inning: 1, runs: 9 }],
} as WpblGame

const play = (over: Partial<WpblGamePlay>): WpblGamePlay => ({
  id: `p${over.sequence}`, game_id: 'g1', sequence: 1, inning: 1, half: 'top',
  team_id: 'NY', batter_name: null, batter_id: null, pitcher_name: null, pitcher_id: null,
  outs: 0, first_base: null, second_base: null, third_base: null, bases_loaded: false,
  narrative: '', event_type: null, is_hit: false, is_scoring_play: false, runs_scored: 0,
  pitch_sequence: null, balls: 0, strikes: 0,
  ...over,
} as WpblGamePlay)

// Her two singles, as the page draws them: one the league accounted for, one it did not.
const PLAYS: WpblGamePlay[] = [
  play({
    sequence: 1, batter_name: 'Katherine Murphy',
    narrative: 'Katherine Murphy singled up the middle, RBI (1-2 KSFB).',
  }),
  play({
    sequence: 2, batter_name: 'Katherine Murphy',
    narrative: 'Katherine Murphy singled to shortstop (2-0).',
    corrected_source: 'external',
  }),
]

const LINE = {
  id: 'l1', game_id: 'g1', player_id: 'x', team_id: 'NY',
  outs: 21, bf: 28, h: 5, r: 1, er: 1, bb: 1, so: 6, hr: 0, pitches: 92,
  decision: 'W', gs: 1, hbp: 0, ibb: 0, wp: 0, bk: 0, strikes: 60, doubles: 0, triples: 0,
} as WpblPitchingLine

let plays: WpblGamePlay[] = PLAYS

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return {
    ...actual,
    fetchWpblAllPlayers: () => Promise.resolve([] as WpblPlayer[]),
    fetchWpblRoster: () => Promise.resolve([] as WpblPlayer[]),
    fetchWpblGameLines: () => Promise.resolve({ batting: [], pitching: [LINE] }),
    fetchWpblGamePlays: () => Promise.resolve(plays),
    fetchWpblGameTracking: () => Promise.resolve([]),
    fetchWpblGameDetails: () => Promise.resolve(null),
    fetchWpblGameRevisions: () => Promise.resolve([]),
    fetchWpblGameRecapPlays: () => Promise.resolve([]),
    fetchWpblVideos: () => Promise.resolve([]),
    getCachedWpblVideos: () => [],
    fetchWpblArticles: () => Promise.resolve([]),
    getCachedWpblArticles: () => [],
    fetchWpblAllRunValuePlays: () => Promise.resolve([]),
    getCachedWpblAllRunValuePlays: () => [],
  }
})

const { default: GameDetailModal } = await import('../GameDetail')

/** The play-by-play tab, with every half-inning open. */
async function openPlays(rows: WpblGamePlay[]) {
  plays = rows
  localStorage.clear()
  render(<GameDetailModal game={GAME} teams={[NY, BOS]} games={[GAME]} onClose={() => {}} />)
  await userEvent.click(await screen.findByText('Play-by-Play'))
  await userEvent.click(await screen.findByText(/Expand all/i))
  await screen.findByText(/singled up the middle/)
}

describe('a play the league did not account for', () => {
  // The footnote says the same words, so both places are counted rather than asserted singly:
  // the mark on the row is the half that would go missing if the stamp stopped reaching it.
  const saidOn = (re: RegExp) =>
    Array.from(document.querySelectorAll('span,p')).filter(e => re.test(e.textContent ?? ''))

  it('says so on the play itself, in words rather than only a symbol', async () => {
    await openPlays(PLAYS)
    // The mark is a dagger, which is invisible to a screen reader and useless to anybody who
    // cannot see an 8px glyph, so the sentence is in the accessible name beside it.
    const row = screen.getByText(/singled to ss/).closest('div')!
    expect(row.textContent).toMatch(/transcribed by RetroWPBL/i)
    // And not as a bare symbol: the words are in the DOM, not only in a title attribute.
    expect(saidOn(/transcribed by RetroWPBL/i).length).toBeGreaterThan(1)
  })

  it('explains the daggers once, at the foot, and counts them', async () => {
    await openPlays(PLAYS)
    const notes = Array.from(document.querySelectorAll('p')).map(e => e.textContent ?? '')
    expect(notes.some(t => /1 play transcribed by RetroWPBL, which the league published with no account of it\./i.test(t))).toBe(true)
    // And names the reason the two accounts can disagree, which is the reader's actual question.
    expect(screen.getByText(/independent reading of the game/i)).toBeTruthy()
  })

  it('leaves the play the league did account for unmarked', async () => {
    await openPlays(PLAYS)
    const league = screen.getByText(/singled up the middle/).closest('div')!
    expect(league.textContent).not.toMatch(/transcribed/i)
  })

  it('says nothing at all about a game the league accounted for in full', async () => {
    // Every game but two, so the quiet path is the one that has to stay quiet.
    await openPlays([PLAYS[0]])
    expect(document.body.textContent).not.toMatch(/transcribed by RetroWPBL/i)
    expect(document.body.textContent).not.toMatch(/RetroWPBL/)
  })

  it('counts each source separately when a game has more than one kind', async () => {
    await openPlays([
      PLAYS[0],
      PLAYS[1],
      play({ sequence: 3, batter_name: 'A B', narrative: 'A B flied out to cf.', corrected_source: 'external' }),
      play({ sequence: 4, batter_name: 'C D', narrative: 'C D struck out swinging.', corrected_source: 'league' }),
    ])
    // The footnote is assembled from several nodes (the count, then the link, then the rest),
    // so it is read off the paragraph rather than matched as one string.
    const notes = Array.from(document.querySelectorAll('p')).map(e => e.textContent ?? '')
    // And the reason reads as a plural, which one sentence doing both jobs could not.
    expect(notes.some(t => /2 plays transcribed by RetroWPBL, which the league published with no account of them\./i.test(t))).toBe(true)
    expect(notes.some(t => /1 play corrected against the league.s own box score/i.test(t))).toBe(true)
  })
})
