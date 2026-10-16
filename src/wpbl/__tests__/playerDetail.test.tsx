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
//   - fielding is one small line under a heading, last among the stats, not a hero card.
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

// The fan-photo strip is owner-gated through useAuth, and this page renders with no AuthProvider.
vi.mock('../fanPhotoGate', () => ({ useCanEditFanPhotos: () => false }))

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return {
    ...actual,
    fetchWpblPlayerLines: () => Promise.resolve(lines),
    fetchWpblPitcherLocations: () => Promise.resolve([]),
    fetchWpblAllLines: () => Promise.resolve({ batting: lines.batting, pitching: lines.pitching }),
    // The WPA / BsR strip's read. Left real, it went to the placeholder Supabase, and whether it
    // had settled by the time a test looked depended on the machine's load: under three parallel
    // runs BsR printed a third "1st of 1" and the rank test failed on a change that touched nothing.
    fetchWpblAllRunValuePlays: () => Promise.resolve([]),
    getCachedWpblAllRunValuePlays: () => null,
    fetchWpblArticles: () => Promise.resolve([]),
    getCachedWpblArticles: () => [],
    // The season tables' board (wOBA, wRC+, FIP, WAR). Off the network for the same reason: no stored
    // seasons and no priced row, so it builds from the lines above, as it does when both are stale.
    fetchWpblPlayerSeasons: () => Promise.reject(new Error('not in tests')),
    fetchWpblRunEnvironment: () => Promise.resolve(null),
  }
})

const { default: PlayerDetailModal } = await import('../PlayerDetail')

/**
 * `container` here is the DOCUMENT BODY, not the render root, and that is not a shortcut.
 *
 * This card is a `ModalShell`, and ModalShell portals itself to the body: `position: fixed` is
 * only fixed to the viewport while no ancestor is transformed, and the WPBL tab pager transforms
 * its track, so a modal opened from inside a tab was being laid out inside that pane. The portal
 * is the fix, and it means the modal's DOM is no longer under the element `render` returns.
 *
 * Testing Library hands back `baseElement` for exactly this, so the queries below are unchanged
 * and still read the card they are about.
 */
const show = (p: WpblPlayer, onOpenGame?: (g: WpblGame) => void) => {
  const view = render(
    <PlayerDetailModal player={p} teams={TEAMS} games={GAMES} players={[p]} onClose={() => {}} onOpenGame={onOpenGame} />,
  )
  return { ...view, container: view.baseElement as HTMLElement }
}

/**
 * The same card, but inside a league big enough to be ranked against.
 *
 * The counting strip refuses a field under `COUNT_RANK_MIN_FIELD`, and it is right to: a
 * one-player league makes a hitter with four at-bats its leader in hits. So a test about the
 * strip has to supply a league, and the filler is deliberately BETTER than the subject at
 * everything except the one stat under test, so a passing assertion is about that stat rather
 * than about her being the only person here.
 */
const showInLeague = (p: WpblPlayer, subjectLines: WpblBattingLine[]) => {
  const others = Array.from({ length: 14 }, (_, i) => player({ id: `filler${i}`, name: `Filler ${i}` }))
  lines.batting = [
    ...subjectLines,
    ...others.map(o => bat({ player_id: o.id, ab: 40, h: 20, tb: 30, r: 15, rbi: 15, bb: 8, doubles: 5 })),
  ]
  return render(
    <PlayerDetailModal player={p} teams={TEAMS} games={GAMES} players={[p, ...others]} onClose={() => {}} />,
  )
}

/** The game log's body rows, which is where a game is opened from.
 *
 *  Scoped to the log's own table by its Date header, because the season line is a table now
 *  as well and a bare `tbody tr` catches its value row. The totals row is not caught either:
 *  it lives in a `tfoot`, which is part of why it is there. */
const logRows = (container: HTMLElement) => {
  const log = Array.from(container.querySelectorAll('table'))
    .find(t => (t.querySelector('thead')?.textContent ?? '').startsWith('Date'))
  return Array.from(log?.querySelectorAll('tbody tr') ?? [])
}

/** The role pills, in DOM order, which is what "primary role first" means. Queried in one
 *  pass: asking for pressed:false and pressed:true separately and concatenating returns the
 *  unselected pills first, which is an artefact of the query rather than of the page. */
// Each pane's headline stat also appears as a row of its own percentile strip, so these ask
// for any rather than exactly one. The two labels are disjoint across the panes: a batting
// pane never says ERA and a pitching pane never says OPS, which is what makes them a test for
// which pane is mounted.
//
// Loaded first: while the lines are in flight the card draws its loading state with the real
// labels over sample bars, so a label alone no longer says the lines have landed.
const loaded = () => !document.querySelector('[aria-busy="true"]')
const pitchingShown = () => loaded() && screen.queryAllByText('ERA').length > 0
const battingShown = () => loaded() && screen.queryAllByText('OPS').length > 0

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

  // Emi Saiki is filed SS and threw the season's longest start. The rule is
  // `leadsWithPitching` and it is pinned in positions.test.ts; what this pins is that the
  // CARD asks it, since the pane order and the pill order are the only visible answer.
  it('leads with pitching for a shortstop the box score says is a starter', async () => {
    lines.batting = [bat({ ab: 12, h: 8, tb: 8, bb: 5 })]
    lines.pitching = [pit({ outs: 18, bf: 28, gs: 1, er: 2, h: 3, bb: 1, so: 4 }),
      pit({ game_id: 'g1', outs: 15, bf: 26, gs: 1, er: 5, h: 9, bb: 1, so: 3 })]
    show(player({ position: 'SS' }))

    await waitFor(() => expect(pitchingShown()).toBe(true))
    expect(rolePills().map(p => p.textContent)).toEqual(['Pitching', 'Batting'])
  })

  // The same shortstop without the starts is a hitter who mopped up, and her card has to say
  // so: this is the half of the rule that keeps seventeen of the league's nineteen two-way
  // players where they were.
  it('still leads with batting when the mound work came in relief', async () => {
    lines.batting = [bat({ ab: 12, h: 8, tb: 8, bb: 5 })]
    lines.pitching = [pit({ outs: 14, bf: 28, gs: 0, er: 6, h: 8, bb: 3, so: 2 })]
    show(player({ position: 'SS' }))

    await waitFor(() => expect(battingShown()).toBe(true))
    expect(rolePills().map(p => p.textContent)).toEqual(['Batting', 'Pitching'])
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

  // A pitcher who came to the plate once, in a playoff game. The season line is the regular
  // season, so her regular-season batting is empty; the all-lines flag that drives the game log
  // is still true because the postseason line has a plate appearance. "Also batted" must gate on
  // the regular-season sum or it renders .000/.000/.000, 0-for-0 for a pitcher who did not bat.
  it('does not show a batting cameo when the only plate appearance was in the postseason', async () => {
    const games = [...GAMES, { ...GAMES[0], id: 'post1', game_type: 'postseason' } as WpblGame]
    lines.batting = [bat({ game_id: 'post1', ab: 2, h: 0 })]
    lines.pitching = [pit({ outs: 45, er: 5, h: 12, bb: 3, so: 20 })]
    const p = player({ position: 'RHP' })
    render(<PlayerDetailModal player={p} teams={TEAMS} games={games} players={[p]} onClose={() => {}} />)

    await waitFor(() => expect(pitchingShown()).toBe(true))
    expect(screen.queryByText('Also batted')).not.toBeInTheDocument()
    expect(rolePills()).toHaveLength(0)
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
  // A one-row table, shown whole, since Oct 2026: it was a run-on sentence of figures, and before
  // that a bordered panel that hid PO, A and DP behind a tap.
  it('shows the whole line as a table under a heading, with nothing to open', async () => {
    lines.batting = [bat({ ab: 30, h: 12, tb: 18 })]
    lines.fielding = [field({ po: 9, a: 10, e: 1, dp: 2 })]
    show(player())

    await waitFor(() => expect(battingShown()).toBe(true))
    expect(screen.getByText('Fielding')).toBeInTheDocument()
    const table = screen.getByText('FPCT').closest('table')!
    const heads = Array.from(table.querySelectorAll('th')).map(th => th.textContent)
    const cells = Array.from(table.querySelectorAll('td')).map(td => td.textContent)
    const by = Object.fromEntries(heads.map((h, i) => [h, cells[i]]))
    expect(by).toMatchObject({ E: '1', PO: '9', A: '10', DP: '2' })
    expect(heads).not.toContain('PB')
    expect(screen.queryByRole('button', { name: /fielding/i })).not.toBeInTheDocument()
  })

  // What she did, then how, then the least reliable number: the game log leads the blocks
  // under the season line and fielding closes them. See desktopRoleBlock.
  it('comes after the game log', async () => {
    lines.batting = [bat({ ab: 30, h: 12, tb: 18 })]
    lines.fielding = [field({ po: 9, a: 10 })]
    show(player())
    await waitFor(() => expect(battingShown()).toBe(true))
    const log = screen.getByText('Game log'), fielding = screen.getByText('Fielding')
    expect(log.compareDocumentPosition(fielding) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('renders nothing at all for a player with no defensive record', async () => {
    lines.batting = [bat({ ab: 30, h: 12, tb: 18 })]
    show(player())
    await waitFor(() => expect(battingShown()).toBe(true))
    expect(screen.queryByText(/FPCT/)).not.toBeInTheDocument()
  })
})

describe('PlayerDetail: league ranks', () => {
  /** The summary table: the first whose header row begins with Season. */
  const lineTable = (n = 0) => Array.from(document.querySelectorAll('table'))
    .filter(t => (t.querySelector('thead')?.textContent ?? '').startsWith('Season'))[n]
  /** The rank under each figure of the player's row, cell by cell (the lead cell has none), or []
   *  when no rank line was drawn at all. */
  const rankRow = (n = 0): string[] => {
    const row = lineTable(n)?.querySelector('tbody tr')
    const cells = Array.from(row?.querySelectorAll('td') ?? [])
    if (!cells.some(td => td.querySelector('div'))) return []
    return cells.map(td => td.querySelector('div')?.textContent ?? '')
  }
  const headsOf = (n = 0) => Array.from(lineTable(n)?.querySelectorAll('th') ?? []).map(th => th.textContent)

  it('puts every rate rank under the rate it belongs to', async () => {
    lines.batting = [bat({ ab: 30, h: 12, tb: 18 })]
    show(player())
    // A field of one, so she is 1st in every rate. Every rank is the bare place with its field in
    // the tooltip, under its own figure in the summary. Waiting for all four is waiting for the
    // card to load.
    await waitFor(() => expect(screen.getAllByTitle('1st of 1')).toHaveLength(4))
    expect(screen.queryByText(/ of \d+$/)).not.toBeInTheDocument()
    const heads = headsOf()
    const ranksBy = Object.fromEntries(heads.map((h, i) => [h, rankRow()[i] ?? '']))
    for (const k of ['AVG', 'OBP', 'SLG', 'OPS']) expect(ranksBy[k]).toBe('1st')
  })

  it('draws the season as the line a reader expects, with the league under it', async () => {
    lines.batting = [bat({ ab: 30, h: 12, tb: 18 })]
    show(player())
    await waitFor(() => expect(battingShown()).toBe(true))
    expect(headsOf()).toEqual(['Season', 'G', 'PA', 'HR', 'AVG', 'OBP', 'SLG', 'OPS', 'wOBA', 'wRC+', 'WAR'])
    const rows = Array.from(lineTable()?.querySelectorAll('tbody tr') ?? [])
    expect(rows[0].querySelector('td')?.textContent).toBe('2026')
    expect(rows[1].querySelector('td')?.textContent).toBe('League avg')
  })

  // The rest of the line is one tap away, and the choice is the reader's: kept for the next card.
  it('opens the standard and advanced lines behind All stats', async () => {
    lines.batting = [bat({ ab: 30, h: 12, tb: 18 })]
    show(player())
    await waitFor(() => expect(battingShown()).toBe(true))
    expect(screen.queryByText('Standard')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'All stats' }))
    expect(screen.getByText('Standard')).toBeInTheDocument()
    expect(screen.getByText('Advanced')).toBeInTheDocument()
    expect(headsOf(1)).toContain('AB')
    expect(headsOf(2)).toContain('OPS+')
    expect(localStorage.getItem('sd.playerCard.allStats')).toBe('1')
    fireEvent.click(screen.getByRole('button', { name: 'Fewer stats' }))
    expect(screen.queryByText('Standard')).not.toBeInTheDocument()
  })

  // Ranking someone with four trips to the plate would claim she is bad rather than that we do
  // not know yet. What stands in its place is progress TOWARD the bar, which is a different
  // measurement: the rate cells are still drawn, with nothing under them.
  it('shows progress toward the bar instead of ranking a player below it', async () => {
    lines.batting = [bat({ ab: 4, h: 2, tb: 3 })]
    show(player())
    await waitFor(() => expect(battingShown()).toBe(true))
    expect(screen.getByText(/Toward qualifying/i)).toBeInTheDocument()
    expect(screen.getByText(/more PA to rank against qualified batters/i)).toBeInTheDocument()
    expect(rankRow().every(c => !c.trim())).toBe(true)
  })

  // A COUNT is not subject to the objection the bar exists for, since a short sample can only
  // deflate one. So a below-bar player gets the meter AND a league position, and the two have
  // to be able to sit on one card.
  //
  // NO POPULATION IS ASSERTED, and there is none to assert: the card prints a bare ordinal in
  // the cell. Two fields are in play here (the rates are ranked against the qualified, the
  // counts against everyone who has played), and naming both was a line of small print under
  // every table saying the same thing on every card. The band's hero pair still carries "of N"
  // for a reader who wants a denominator.
  it('still gives a below-bar player a league position, off her counting totals', async () => {
    // Three steals in four at-bats: nowhere near qualifying, and nobody else has stolen one.
    showInLeague(player(), [bat({ ab: 4, h: 2, tb: 3, sb: 3 })])
    await waitFor(() => expect(battingShown()).toBe(true))
    expect(screen.getByText(/Toward qualifying/i)).toBeInTheDocument()
    // Steals are in the standard line, behind All stats.
    fireEvent.click(screen.getByRole('button', { name: 'All stats' }))
    expect(rankRow(1)).toContain('1st')
    fireEvent.click(screen.getByRole('button', { name: 'Fewer stats' }))
  })

  // Most of the roster leads nothing. Anything below the card's top-three bar leaves its cell
  // empty; the row itself is held open, blank, so the card is the height its loading state was
  // and does not shrink when the ranks land (see StatTable's `reserveRanks`).
  it('leaves the rank row blank for a player who leads nothing', async () => {
    showInLeague(player(), [bat({ ab: 4, h: 1, tb: 1 })])
    await waitFor(() => expect(battingShown()).toBe(true))
    expect(rankRow().length).toBeGreaterThan(0)
    expect(rankRow().every(c => !c.trim())).toBe(true)
  })

  // Strikeouts are the one column that must never carry a rank. Second in the league in
  // strikeouts is not an achievement, and `WPBL_BAT_COUNT_RANK_DEFS` leaves SO out for exactly
  // that reason; a rank printed into the cell would put it back by the side door.
  it('never ranks strikeouts', async () => {
    showInLeague(player(), [bat({ ab: 4, h: 1, tb: 1, so: 4, sb: 3 })])
    await waitFor(() => expect(battingShown()).toBe(true))
    fireEvent.click(screen.getByRole('button', { name: 'All stats' }))
    const soAt = headsOf(1).indexOf('SO')
    expect(soAt).toBeGreaterThan(-1)
    expect((rankRow(1)[soAt] ?? '').trim()).toBe('')
    fireEvent.click(screen.getByRole('button', { name: 'Fewer stats' }))
  })

  // The retraction has to reach the reader who only looks at the big number, so the sample
  // line under the rates names the gap too. Pinned because the two are computed in different
  // places (`battingMeta` and `RankProgress`) off the same `ranks.qualifiers`, and they must be
  // the SAME number: the sample line printed the threshold while the rail printed the distance
  // to it, so a player one plate appearance short of the leaderboard was told "29 PA to
  // qualify" under her headline and "1 more PA" at the foot of the rail.
  it('names the same shortfall on the sample line as in the rail', async () => {
    lines.batting = [bat({ ab: 4, h: 2, tb: 3 })]
    show(player())
    await waitFor(() => expect(battingShown()).toBe(true))
    const onHero = screen.getAllByText(/\d+ PA from qualifying/)
    expect(onHero.length).toBeGreaterThan(0)
    const gap = (el: HTMLElement, re: RegExp) => (el.textContent ?? '').match(re)?.[1]
    const inRail = screen.getByText(/more PA to rank against qualified batters/i)
    expect(gap(onHero[0], /(\d+) PA from qualifying/)).toBe(gap(inRail, /(\d+) more PA/))
  })

  // No season row under the log on the regular season: the season line a few inches above is the
  // same figures, and on a phone the row was the most cramped on the card. It comes back for
  // Playoffs and Both, where it says which games the list adds up.
  it('leaves the season row off the regular-season game log', async () => {
    lines.batting = [bat({ game_id: 'g0', ab: 4, h: 2, tb: 3 }), bat({ game_id: 'g1', ab: 3, h: 1, tb: 1 })]
    show(player())
    await waitFor(() => expect(battingShown()).toBe(true))
    expect(document.querySelector('tfoot')).toBeNull()
  })
})

// The game log runs newest first. Pinned because the order is a sort on the game's ISO date, and
// the "Aug 13" label the row shows would sort August after April.
describe('PlayerDetail: game log order', () => {
  it('puts the newest game first', async () => {
    lines.batting = [
      bat({ game_id: 'g5', ab: 4, h: 1 }),
      bat({ game_id: 'g9', ab: 4, h: 4 }),
      bat({ game_id: 'g7', ab: 5, h: 3 }),
    ]
    const { container } = show(player())
    await waitFor(() => expect(battingShown()).toBe(true))
    expect(logRows(container)[0].textContent).toContain('Aug 10')
  })
})

// The dialog grew a second column and a club band that carries the headline numbers on
// Aug 25, 2026, because desktop was rendering a layout measured on a 375px phone with ~800px
// of empty screen either side of it. The COLUMNS are still not testable here for the reason
// at the top of this file: jsdom runs no media queries, so both the band copy of the hero and
// the pane copy are in the DOM at once and only CSS decides which one a reader sees. What is
// testable, and worth pinning, is which block the numbers are IN and whose numbers they are.
describe('PlayerDetail: the headline pair on the club band', () => {
  // `data-player-band` marks the block that names her. Not `data-sheet-drag`, which the band
  // carries only while it is pinned (see PlayerBand's `grab`).
  const band = (c: HTMLElement) => c.querySelector('[data-player-band]') as HTMLElement

  // THE BAND CARRIES NO STATS ANY MORE, which is what the desktop rebuild cost it and what
  // that rebuild was for. It could only ever show one role's numbers, and above `md` every
  // role is now drawn with its own rates down the rail beside its own tables, so a band hero
  // would either repeat the primary role's four or pick one of two and hide the other.
  // What the band keeps is what is true of the PLAYER rather than of a role.
  it('names the player and leaves the numbers to the pane', async () => {
    lines.batting = [bat({ ab: 30, h: 12, tb: 18 })]
    const { container } = show(player())
    await waitFor(() => expect(battingShown()).toBe(true))

    expect(band(container).textContent).toContain('Test Player')
    // 12-for-30, all singles as far as the totals are concerned (`sumBatting` derives total
    // bases from the hit types rather than trusting the line's `tb`), so .400 / .400 / .400
    // and an .800 OPS. It is in the pane, in the headline and again in the standard line, as on
    // every stat site, and never on the band.
    expect(screen.getAllByText('.800').length).toBeGreaterThan(0)
    expect(band(container).textContent).not.toContain('.800')
  })

  // The facts in words: the meta line was "#9 · RHP, UTL · B/T R/R · 24 yrs", and the band had a
  // form strip repeating the top five rows of the game log. Neither survives.
  it('says the facts in words, with no form strip', async () => {
    lines.batting = [bat({ game_id: 'g9', ab: 30, h: 12, tb: 18 })]
    lines.pitching = [pit({ game_id: 'g9', outs: 45, er: 5, h: 12, bb: 3, so: 20 })]
    const { container } = show(player({ position: 'RHP, UTL', hometown: 'Tulsa, Oklahoma', draft_round: 2, draft_pick: 7 }))
    await waitFor(() => expect(pitchingShown()).toBe(true))

    const text = band(container).textContent ?? ''
    expect(text).toContain('Pitcher / Utility')
    expect(text).toContain('Age 24')
    expect(text).toContain('Tulsa, Oklahoma')
    expect(text).toContain('Drafted round 2, pick 7')
    expect(text).not.toContain('B/T')
    expect(text).not.toMatch(/Last \d+/)
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
  // The log is the tallest block on the card and the only one that grows on its own, so it
  // opens on five games with the rest behind a control, which names how much more there is,
  // since that is the question a reader is asking before they decide to tap it.
  it('opens on five games and expands to the whole season', async () => {
    lines.batting = GAMES.map(g => bat({ game_id: g.id, ab: 2, h: 1, tb: 1 }))
    const { container } = show(player())
    await waitFor(() => { expect(loaded()).toBe(true); expect(logRows(container)).toHaveLength(5) })

    fireEvent.click(screen.getByRole('button', { name: /show 5 more games/i }))
    expect(logRows(container)).toHaveLength(10)
    expect(screen.queryByRole('button', { name: /show \d+ more/i })).not.toBeInTheDocument()
  })

  // Folding back up was deliberately missing until Sep 28, 2026, on the grounds that it would
  // yank the page out from under a reader; the expanded log is a capped scroller now, so the
  // most it can take back is that cap, and a reader who has looked should be able to put it away.
  it('folds back to five games', async () => {
    lines.batting = GAMES.map(g => bat({ game_id: g.id, ab: 2, h: 1, tb: 1 }))
    const { container } = show(player())
    await waitFor(() => { expect(loaded()).toBe(true); expect(logRows(container)).toHaveLength(5) })

    fireEvent.click(screen.getByRole('button', { name: /show 5 more games/i }))
    const fewer = screen.getByRole('button', { name: /show fewer/i })
    expect(fewer).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(fewer)
    expect(logRows(container)).toHaveLength(5)
    expect(screen.getByRole('button', { name: /show 5 more games/i })).toHaveAttribute('aria-expanded', 'false')
  })

  // A log that fits gets no control at all: a button that expands nothing is worse than no
  // button, and most pitching logs are shorter than the preview.
  it('draws no control for a log that already fits', async () => {
    lines.batting = [bat({ game_id: 'g0', ab: 4, h: 2, tb: 3 }), bat({ game_id: 'g1', ab: 3, h: 1, tb: 1 })]
    show(player())
    await waitFor(() => expect(battingShown()).toBe(true))
    expect(screen.queryByRole('button', { name: /show \d+ more/i })).not.toBeInTheDocument()
  })

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

