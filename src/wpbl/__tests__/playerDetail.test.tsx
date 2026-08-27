import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { WpblTeam, WpblPlayer, WpblGame, WpblBattingLine, WpblPitchingLine, WpblFieldingLine } from '../types'

// The player page folded four stacked stat blocks into role tabs on Aug 25, 2026. What is
// worth pinning at this level is the handful of decisions the restructure turns on, because
// each one is invisible until you are holding the wrong player:
//
//   - the control appears ONLY for a genuine two-way player, so the great majority of the
//     roster is not asked to tap past a pill that does nothing,
//   - a cameo does not earn a tab, it folds into the primary pane as a line,
//   - only the active role is mounted, which is the whole point of the change,
//   - fielding is a collapsed line and not a hero card.
//
// The ranking maths is covered in percentiles.test.ts. Layout is not tested here and cannot
// be: jsdom does no layout, so the clipping this replaced was measured in a real browser.

const TEAMS: WpblTeam[] = (['SF', 'LA', 'NY', 'BOS'] as const).map((id, i) => ({
  id, city: id, name: id, abbr: id, color: null, color_secondary: null,
  logo_url: null, sort_order: i, api_id: null, created_at: '',
}))

// All four clubs play every round. The qualifying bar scales off the LEAST-played club, so a
// fixture where two of them never take the field leaves it switched off and every rank comes
// back 'season-young' — which looks like a component bug and is a fixture bug.
const GAMES: WpblGame[] = Array.from({ length: 10 }, (_, i) => ({
  id: `g${i}`, game_date: `2026-08-${String(i + 1).padStart(2, '0')}`, start_time: '6:30 PM',
  home_team_id: i % 2 ? 'BOS' : 'SF', away_team_id: i % 2 ? 'LA' : 'NY', venue: null, status: 'final',
  home_score: 5, away_score: 2, innings: 7, notes: null, created_at: '', updated_at: '',
  game_type: 'regular', counts_in_standings: true,
}))

const player = (over: Partial<WpblPlayer> = {}): WpblPlayer => ({
  id: 'p1', team_id: 'SF', name: 'Test Player', position: 'CF', bats: 'R', throws: 'R',
  jersey_number: '9', age: 24, hometown: null, status: 'Signed',
  draft_round: null, draft_pick: null, bio: null,
  birth_date: null, birth_date_source: null,
  ...over,
} as WpblPlayer)

const bat = (over: Partial<WpblBattingLine> = {}): WpblBattingLine => ({
  id: Math.random().toString(36).slice(2), game_id: 'g0', player_id: 'p1', team_id: 'SF',
  batting_order: 1, position: 'CF',
  ab: 0, r: 0, h: 0, doubles: 0, triples: 0, hr: 0, rbi: 0, bb: 0, so: 0, hbp: 0,
  sb: 0, cs: 0, sf: 0, sh: 0, ibb: 0, gdp: 0, tb: 0, lob: 0,
  ...over,
} as WpblBattingLine)

const pit = (over: Partial<WpblPitchingLine> = {}): WpblPitchingLine => ({
  id: Math.random().toString(36).slice(2), game_id: 'g0', player_id: 'p1', team_id: 'SF',
  outs: 0, bf: null, h: 0, r: 0, er: 0, bb: 0, so: 0, hr: 0, pitches: null, decision: null,
  gs: 0, hbp: 0, ibb: 0, wp: 0, bk: 0, strikes: 0, doubles: 0, triples: 0,
  ...over,
} as WpblPitchingLine)

const field = (over: Partial<WpblFieldingLine> = {}): WpblFieldingLine => ({
  id: Math.random().toString(36).slice(2), game_id: 'g0', player_id: 'p1', team_id: 'SF',
  po: 0, a: 0, e: 0, pb: 0, sba: 0, dp: 0,
  ...over,
} as WpblFieldingLine)

// The page's own lines, and the league-wide read behind the percentile strip.
const lines = { batting: [] as WpblBattingLine[], pitching: [] as WpblPitchingLine[], fielding: [] as WpblFieldingLine[] }

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return {
    ...actual,
    fetchWpblPlayerLines: () => Promise.resolve(lines),
    fetchWpblPitcherLocations: () => Promise.resolve([]),
    fetchWpblAllLines: () => Promise.resolve({ batting: lines.batting, pitching: lines.pitching }),
    fetchWpblArticles: () => Promise.resolve([]),
    getCachedWpblArticles: () => [],
  }
})

const { default: PlayerDetailModal, gridColumns } = await import('../PlayerDetail')

const show = (p: WpblPlayer, onOpenGame?: (g: WpblGame) => void) => render(
  <PlayerDetailModal player={p} teams={TEAMS} games={GAMES} players={[p]} onClose={() => {}} onOpenGame={onOpenGame} />,
)

/** The game log's body rows, which is where a game is opened from. */
const logRows = (container: HTMLElement) => Array.from(container.querySelectorAll('tbody tr'))

/** The role pills, in DOM order, which is what "primary role first" means. Queried in one
 *  pass: asking for pressed:false and pressed:true separately and concatenating returns the
 *  unselected pills first, which is an artefact of the query rather than of the page. */
// Each pane's headline stat also appears as a row of its own percentile strip, so these ask
// for any rather than exactly one. The two labels are disjoint across the panes: a batting
// pane never says ERA and a pitching pane never says OPS, which is what makes them a test for
// which pane is mounted.
const pitchingShown = () => screen.queryAllByText('ERA').length > 0
const battingShown = () => screen.queryAllByText('OPS').length > 0

const rolePills = () => screen.queryAllByRole('button')
  .filter(el => el.hasAttribute('aria-pressed')
    && (el.textContent === 'Batting' || el.textContent === 'Pitching'))

beforeEach(() => {
  lines.batting = []; lines.pitching = []; lines.fielding = []
})

describe('PlayerDetail: when the role tabs exist', () => {
  it('shows no tabs for a hitter who has never pitched', async () => {
    lines.batting = [bat({ ab: 30, h: 12, tb: 18 })]
    show(player())
    await waitFor(() => expect(battingShown()).toBe(true))
    expect(rolePills()).toHaveLength(0)
  })

  it('shows no tabs for a pitcher who has never batted', async () => {
    lines.pitching = [pit({ outs: 45, er: 5, h: 12, bb: 3, so: 20 })]
    show(player({ position: 'RHP' }))
    await waitFor(() => expect(pitchingShown()).toBe(true))
    expect(rolePills()).toHaveLength(0)
  })

  it('shows tabs for a genuine two-way player, primary role first', async () => {
    lines.batting = [bat({ ab: 30, h: 12, tb: 18 })]
    lines.pitching = [pit({ outs: 45, er: 5, h: 12, bb: 3, so: 20 })]
    show(player({ position: 'RHP, UTL' }))

    await waitFor(() => expect(pitchingShown()).toBe(true))
    expect(rolePills().map(p => p.textContent)).toEqual(['Pitching', 'Batting'])
    // Filed RHP leads with pitching even though she also hits.
    // 'Two-way', not 'TWO-WAY': the capitals are text-transform, which jsdom does not apply.
    // Asserting the rendered-looking string makes the NEGATIVE case below pass vacuously.
    expect(screen.getByText('Two-way')).toBeInTheDocument()
  })

  // A pitcher's handful of at-bats is not a second role. Giving it a tab would put an
  // occasional-hitting pitcher and a real two-way player in the same shape.
  it('folds a batting cameo into the pitching pane instead of giving it a tab', async () => {
    lines.batting = [bat({ ab: 4, h: 1, tb: 1 })]
    lines.pitching = [pit({ outs: 45, er: 5, h: 12, bb: 3, so: 20 })]
    show(player({ position: 'RHP' }))

    await waitFor(() => expect(pitchingShown()).toBe(true))
    expect(rolePills()).toHaveLength(0)
    expect(screen.getByText('Also batted')).toBeInTheDocument()
    expect(screen.queryByText('Two-way')).not.toBeInTheDocument()
  })

  it('folds a pitching cameo into the batting pane the same way', async () => {
    lines.batting = [bat({ ab: 30, h: 12, tb: 18 })]
    lines.pitching = [pit({ outs: 3, er: 2, h: 2, bb: 1, so: 1 })]
    show(player({ position: 'CF' }))

    await waitFor(() => expect(battingShown()).toBe(true))
    expect(rolePills()).toHaveLength(0)
    expect(screen.getByText('Also pitched')).toBeInTheDocument()
  })
})

describe('PlayerDetail: what the tabs actually do', () => {
  beforeEach(() => {
    lines.batting = [bat({ ab: 30, h: 12, tb: 18, rbi: 7 })]
    lines.pitching = [pit({ outs: 45, er: 5, h: 12, bb: 3, so: 20, decision: 'W' })]
  })

  // The point of the change. Mounting both and hiding one would keep a second game log and a
  // second pitch-location plot alive for a reader looking at neither.
  it('mounts only the active role', async () => {
    show(player({ position: 'RHP, UTL' }))
    await waitFor(() => expect(pitchingShown()).toBe(true))

    expect(battingShown()).toBe(false)

    fireEvent.click(rolePills().find(p => p.textContent === 'Batting')!)
    await waitFor(() => expect(battingShown()).toBe(true))
    expect(pitchingShown()).toBe(false)
  })

  // Two logs with two header rows for the same nine games was the duplication the tabs were
  // meant to remove. Each pane carries exactly one.
  it('carries one game log per role, not two', async () => {
    show(player({ position: 'RHP, UTL' }))
    await waitFor(() => expect(pitchingShown()).toBe(true))
    expect(screen.getAllByText('Game log')).toHaveLength(1)
    // The pitching log's decision column, which the batting log does not have.
    expect(screen.getByText('DEC')).toBeInTheDocument()

    fireEvent.click(rolePills().find(p => p.textContent === 'Batting')!)
    await waitFor(() => expect(battingShown()).toBe(true))
    expect(screen.getAllByText('Game log')).toHaveLength(1)
    expect(screen.queryByText('DEC')).not.toBeInTheDocument()
  })
})

describe('PlayerDetail: fielding', () => {
  it('collapses to a line and opens on tap', async () => {
    lines.batting = [bat({ ab: 30, h: 12, tb: 18 })]
    lines.fielding = [field({ po: 9, a: 10, e: 1, dp: 2 })]
    show(player())

    await waitFor(() => expect(battingShown()).toBe(true))
    const row = screen.getByRole('button', { expanded: false })
    expect(row.textContent).toContain('FPCT')
    // Closed, the detail is genuinely absent rather than hidden.
    expect(screen.queryByText('DP')).not.toBeInTheDocument()

    fireEvent.click(row)
    await waitFor(() => expect(screen.getByText('DP')).toBeInTheDocument())
  })

  it('renders nothing at all for a player with no defensive record', async () => {
    lines.batting = [bat({ ab: 30, h: 12, tb: 18 })]
    show(player())
    await waitFor(() => expect(battingShown()).toBe(true))
    expect(screen.queryByText(/FPCT/)).not.toBeInTheDocument()
  })
})

describe('PlayerDetail: league ranks', () => {
  it('puts the rank beside the headline once the player clears the bar', async () => {
    lines.batting = [bat({ ab: 30, h: 12, tb: 18 })]
    show(player())
    // A field of one: she is 1st of 1, and the population is printed rather than implied.
    // Both hero rows carry their own rank now (OPS and AVG), which is the fix for a single
    // floating pill that never said which stat it belonged to — so this expects several.
    await waitFor(() => expect(screen.getAllByText('1st of 1').length).toBeGreaterThan(0))
    expect(screen.getByText(/Against 1 qualified batters/)).toBeInTheDocument()
  })

  // Drawing a short bar for someone with four at-bats would claim she is bad rather than
  // that we do not know yet. What stands in its place is progress TOWARD the bar, which is a
  // different measurement and must never be mistaken for the percentile strip: same geometry,
  // opposite meaning, so this pins that the strip's own heading is absent.
  it('shows progress toward the bar instead of ranking a player below it', async () => {
    lines.batting = [bat({ ab: 4, h: 2, tb: 3 })]
    show(player())
    await waitFor(() => expect(battingShown()).toBe(true))
    expect(screen.getByText(/Toward league ranks/i)).toBeInTheDocument()
    expect(screen.getByText(/more AB to rank against qualified batters/i)).toBeInTheDocument()
    expect(screen.queryByText(/Against the league/i)).not.toBeInTheDocument()
  })

  // The retraction has to reach the reader who only looks at the big number. It used to live
  // only in the rail, a column away from a 2rem figure it was disowning, so the sample line
  // under the hero now names the bar itself. Pinned because the two are computed in different
  // places (`battingMeta` and `RankProgress`) off the same `ranks.qualifiers`, and a change to
  // one that misses the other puts a card in the state this was built to end: shouting a
  // number in one block and disowning it in another.
  it('names the qualifying bar on the hero sample line, not only in the rail', async () => {
    lines.batting = [bat({ ab: 4, h: 2, tb: 3 })]
    show(player())
    await waitFor(() => expect(battingShown()).toBe(true))
    expect(screen.getAllByText(/AB to qualify/).length).toBeGreaterThan(0)
  })
})

// The band's form strip. Its ORDER is the thing worth a test: it is the one list on this page
// that runs oldest-first, against a game log two columns away that runs newest-first, and both
// are built from the same `newestFirst` helper. A reversal here is silent by construction,
// because either order renders a plausible-looking row of five games, and the only reader who
// would catch it is one who already knows how the last week went.
describe('PlayerDetail: the form strip', () => {
  // GAMES run g0 (Aug 1) to g9 (Aug 10), so the fixture's own chronology is the assertion.
  const week = () => [
    bat({ game_id: 'g5', ab: 4, h: 1 }),
    bat({ game_id: 'g6', ab: 3, h: 0 }),
    bat({ game_id: 'g7', ab: 5, h: 3 }),
    bat({ game_id: 'g8', ab: 4, h: 2 }),
    bat({ game_id: 'g9', ab: 4, h: 4 }),
  ]

  const stripValues = (container: HTMLElement) => {
    const head = Array.from(container.querySelectorAll('*'))
      .find(el => el.children.length === 0 && /^Last \d+ · /.test(el.textContent ?? ''))
    // The heading's parent is the strip; the cells are the second child's children, each of
    // which is an opponent over a value.
    const cells = head?.parentElement?.lastElementChild
    return Array.from(cells?.children ?? []).map(c => c.lastElementChild?.textContent ?? '')
  }

  it('runs oldest to newest, the opposite of the game log beside it', async () => {
    lines.batting = week()
    const { container } = show(player())
    await waitFor(() => expect(battingShown()).toBe(true))
    // Aug 6 through Aug 10, in that order. The log's own first row is the newest, Aug 10.
    expect(stripValues(container)).toEqual(['1-4', '0-3', '3-5', '2-4', '4-4'])
    expect(logRows(container)[0].textContent).toContain('Aug 10')
  })

  it('shows only the last five, keeping the most recent rather than the first played', async () => {
    lines.batting = [bat({ game_id: 'g0', ab: 4, h: 4 }), ...week()]
    const { container } = show(player())
    await waitFor(() => expect(battingShown()).toBe(true))
    const values = stripValues(container)
    expect(values).toHaveLength(5)
    expect(values[values.length - 1]).toBe('4-4')   // Aug 10, the newest
    expect(values[0]).toBe('1-4')                    // Aug 6, not the Aug 1 game
  })

  it('follows the role tab for a two-way player', async () => {
    lines.batting = week()
    lines.pitching = [pit({ game_id: 'g9', outs: 12, so: 5 }), pit({ game_id: 'g8', outs: 9 })]
    const { container } = show(player())
    await waitFor(() => expect(battingShown()).toBe(true))
    expect(screen.getByText(/Last \d+ · H-AB/)).toBeInTheDocument()
    fireEvent.click(rolePills().find(el => el.textContent === 'Pitching')!)
    await waitFor(() => expect(pitchingShown()).toBe(true))
    expect(screen.getByText(/Last \d+ · IP/)).toBeInTheDocument()
    // Innings, not outs: 12 outs is 4.0 IP and 9 is 3.0, oldest first.
    expect(stripValues(container)).toEqual(['3.0', '4.0'])
  })
})

// The dialog grew a second column and a club band that carries the headline numbers on
// Aug 25, 2026, because desktop was rendering a layout measured on a 375px phone with ~800px
// of empty screen either side of it. The COLUMNS are still not testable here for the reason
// at the top of this file: jsdom runs no media queries, so both the band copy of the hero and
// the pane copy are in the DOM at once and only CSS decides which one a reader sees. What is
// testable, and worth pinning, is which block the numbers are IN and whose numbers they are.
describe('PlayerDetail: the headline pair on the club band', () => {
  // `data-sheet-drag` marks the block that names her: it is the sheet's grab surface on a
  // phone and the club band everywhere, which makes it the one stable hook for "the band".
  const band = (c: HTMLElement) => c.querySelector('[data-sheet-drag]') as HTMLElement

  it('carries the headline pair without taking it away from the pane', async () => {
    lines.batting = [bat({ ab: 30, h: 12, tb: 18 })]
    const { container } = show(player())
    await waitFor(() => expect(battingShown()).toBe(true))

    // 12-for-30, all singles as far as the totals are concerned (`sumBatting` derives total
    // bases from the hit types rather than trusting the line's `tb`), so .400 / .400 / .400
    // and an .800 OPS.
    expect(band(container).textContent).toContain('.800')
    expect(band(container).textContent).toContain('.400')
    // And still in the pane, which is where it renders below `lg`.
    expect(screen.getAllByText('.800').length).toBeGreaterThan(1)
  })

  it('follows the role tab for a two-way player', async () => {
    lines.batting = [bat({ ab: 30, h: 12, tb: 18 })]
    lines.pitching = [pit({ outs: 45, er: 5, h: 12, bb: 3, so: 20 })]
    const { container } = show(player({ position: 'RHP, UTL' }))
    await waitFor(() => expect(pitchingShown()).toBe(true))

    expect(band(container).textContent).toContain('ERA')
    expect(band(container).textContent).not.toContain('OPS')

    fireEvent.click(rolePills().find(p => p.textContent === 'Batting')!)
    await waitFor(() => expect(band(container).textContent).toContain('OPS'))
    expect(band(container).textContent).not.toContain('ERA')
  })

  // A defensive-only cameo has no batting line, so the pane's totals are all zeros. Putting a
  // .000 OPS on the card that names her would state an absence as a fact about her season.
  it('stays empty for a player with only a defensive record', async () => {
    lines.fielding = [field({ po: 9, a: 10 })]
    const { container } = show(player())
    await waitFor(() => expect(screen.getByText('Fielding')).toBeInTheDocument())

    expect(band(container).textContent).not.toContain('OPS')
  })
})

// The game log is the only place on the page that names an individual game, and until Aug 25,
// 2026 it was the only place naming one that could not be opened.
describe('PlayerDetail: the game log', () => {
  it('opens the game a row is about', async () => {
    lines.batting = [bat({ game_id: 'g3', ab: 4, h: 2, tb: 3 })]
    const onOpenGame = vi.fn()
    const { container } = show(player(), onOpenGame)
    await waitFor(() => expect(logRows(container)).toHaveLength(1))

    fireEvent.click(logRows(container)[0])
    expect(onOpenGame).toHaveBeenCalledTimes(1)
    expect(onOpenGame.mock.calls[0][0].id).toBe('g3')
  })

  // Enter and Space, because the row is not a `role="button"` — that would take it out of the
  // table for a screen reader — so it carries the keyboard half itself.
  it('opens the game from the keyboard', async () => {
    lines.batting = [bat({ game_id: 'g3', ab: 4, h: 2, tb: 3 })]
    const onOpenGame = vi.fn()
    const { container } = show(player(), onOpenGame)
    await waitFor(() => expect(logRows(container)).toHaveLength(1))

    const row = logRows(container)[0]
    expect(row).toHaveAttribute('tabindex', '0')
    fireEvent.keyDown(row, { key: 'Enter' })
    fireEvent.keyDown(row, { key: ' ' })
    expect(onOpenGame).toHaveBeenCalledTimes(2)
  })

  // A line can arrive for a game the schedule this render holds does not, and a row that looks
  // pressable and does nothing is worse than one that never offered.
  it('leaves a row alone when the schedule does not hold its game', async () => {
    lines.batting = [bat({ game_id: 'not-in-the-schedule', ab: 4, h: 2, tb: 3 })]
    const { container } = show(player(), vi.fn())
    await waitFor(() => expect(logRows(container)).toHaveLength(1))

    expect(logRows(container)[0]).not.toHaveAttribute('tabindex')
  })

  // The POS column is the RAW line, not the season's majority answer. Her roster position and
  // her season-long one are both CF here; the point of the column is the game that was neither.
  it('prints the position she played that game, not the one she plays', async () => {
    lines.batting = [
      bat({ game_id: 'g0', position: 'cf', ab: 4, h: 2, tb: 3 }),
      bat({ game_id: 'g1', position: 'cf', ab: 4, h: 1, tb: 1 }),
      bat({ game_id: 'g2', position: 'cf', ab: 4, h: 1, tb: 1 }),
      bat({ game_id: 'g3', position: '1b/p', ab: 4, h: 2, tb: 4 }),
    ]
    const { container } = show(player({ position: 'CF' }))
    await waitFor(() => expect(logRows(container)).toHaveLength(4))

    // Newest first, so g3 leads.
    const pos = logRows(container).map(r => r.children[2].textContent)
    expect(pos).toEqual(['1B/P', 'CF', 'CF', 'CF'])
  })

  // Newest first. Oldest-first reads down the season, which is the better shape at ten games
  // and the wrong one at forty: it buries last night under a scroll, and on desktop the log is
  // capped, so it is also what decides which thirteen rows are visible without scrolling.
  it('leads the log with the most recent game', async () => {
    lines.batting = [
      bat({ game_id: 'g0', ab: 4, h: 1, tb: 1 }),
      bat({ game_id: 'g7', ab: 4, h: 3, tb: 6 }),
      bat({ game_id: 'g4', ab: 4, h: 2, tb: 2 }),
    ]
    const { container } = show(player())
    await waitFor(() => expect(logRows(container)).toHaveLength(3))

    // GAMES[i] is dated 2026-08-(i+1), so g7 is the latest of the three.
    const dates = logRows(container).map(r => r.children[0].textContent)
    expect(dates).toEqual(['Aug 8', 'Aug 5', 'Aug 1'])
  })

  // A pitching line's position is 'p' in every row of every pitcher's season, so the column
  // would be a wall of one letter.
  it('gives the pitching log no POS column', async () => {
    lines.pitching = [pit({ game_id: 'g0', outs: 21, er: 1, h: 4, bb: 1, so: 8 })]
    const { container } = show(player({ position: 'RHP' }))
    await waitFor(() => expect(logRows(container)).toHaveLength(1))

    const heads = Array.from(container.querySelectorAll('thead th')).map(h => h.textContent)
    expect(heads).not.toContain('POS')
    expect(heads).toContain('DEC')
  })
})

// jsdom does no layout, so the grid itself cannot be measured here (the widths in the comments
// on StatGrid were taken on a real phone). What CAN be pinned is the rule those widths were
// chosen to serve: a stat grid never ends in dead cells.
describe('gridColumns', () => {
  it('divides the item count where it can', () => {
    expect(gridColumns(10, 6)).toBe(5)  // the batting chips: two rows of five, not 6 + 4
    expect(gridColumns(6, 6)).toBe(6)   // the pitching chips: one row
    expect(gridColumns(4, 6)).toBe(4)   // fielding, collapsed
    expect(gridColumns(9, 6)).toBe(3)
  })

  it('falls back to four when nothing divides', () => {
    expect(gridColumns(7, 6)).toBe(4)   // fielding with DP, PB and SBA
    expect(gridColumns(11, 6)).toBe(4)
  })

  it('never exceeds the cap', () => {
    for (let n = 1; n <= 24; n++) expect(gridColumns(n, 6)).toBeLessThanOrEqual(6)
  })
})
