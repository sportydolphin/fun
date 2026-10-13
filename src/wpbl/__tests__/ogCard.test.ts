import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  wpblPlayerCard, wpblGameCard, wpblCardDate, wpblCompareCard, compareCardPath,
  type WpblCardBatting, type WpblCardPitching, type WpblCardGame,
} from '../ogCard'

// The link-preview card for /wpbl?player=<id>. Worth pinning down here because the only
// other way to read it is to paste a link into a chat app and see what comes back: the
// Pages function that serves it (functions/wpbl/index.ts) runs at Cloudflare's edge, and
// its output is never rendered by the site itself.

const bat = (o: Partial<WpblCardBatting> = {}): WpblCardBatting => ({
  game_id: 'g-reg', ab: 0, r: 0, h: 0, doubles: 0, triples: 0, hr: 0, rbi: 0, bb: 0, so: 0,
  hbp: 0, sb: 0, cs: 0, sf: 0, sh: 0, ...o,
})
const pit = (o: Partial<WpblCardPitching> = {}): WpblCardPitching => ({
  game_id: 'g-reg', outs: 0, h: 0, r: 0, er: 0, bb: 0, so: 0, hr: 0, decision: null,
  bf: 0, gs: 0, ...o,
})
// The schedule the card is told about. Every fixture line above belongs to `g-reg`.
const GAMES = [
  { id: 'g-reg', game_type: 'regular', counts_in_standings: true, game_date: '2026-08-01', status: 'final' as const },
  { id: 'g-post', game_type: 'postseason', counts_in_standings: false, game_date: '2026-09-10', status: 'final' as const },
]

const HEIGHTS = 'New York Heights'
const hitter = { id: 'p1', name: 'Denae Benites', position: 'C' }
const pitcher = { id: 'p2', name: 'Jill Albayati', position: 'RHP' }

describe('wpblPlayerCard', () => {
  it('titles the card with the player, their position, and their club', () => {
    const card = wpblPlayerCard(hitter, HEIGHTS, [bat({ ab: 4, h: 2 })], [], GAMES)
    expect(card.ogTitle).toBe('Denae Benites — C · New York Heights')
    expect(card.title).toBe('Denae Benites — WPBL stats | sportydolphin.fun')
  })

  it('separates a two-way position code from the club with a middot, not a comma', () => {
    const card = wpblPlayerCard({ id: 'p4', name: 'Jill Albayati', position: 'RHP, UTL' }, 'San Francisco Firebells', [], [], GAMES)
    expect(card.ogTitle).toBe('Jill Albayati — RHP, UTL · San Francisco Firebells')
  })

  it('leads a hitter with the slash line and their power numbers', () => {
    const lines = [bat({ ab: 4, h: 2, hr: 1, rbi: 3 }), bat({ ab: 4, h: 2, hr: 1, rbi: 2 })]
    const card = wpblPlayerCard(hitter, HEIGHTS, lines, [], GAMES)
    expect(card.description).toBe('.500/.500/1.250 with 2 HR and 5 RBI in 2 games. Full stat line, game log, and fielding.')
  })

  it('describes a hitter with no homers or RBI by what they did do', () => {
    const card = wpblPlayerCard(hitter, HEIGHTS, [bat({ ab: 3, h: 1 })], [], GAMES)
    expect(card.description).toContain('— 1-for-3 in 1 game.')
    expect(card.description).not.toContain('0 HR')
  })

  it('leads a pitcher with ERA, WHIP, and the workload', () => {
    const lines = [pit({ outs: 15, h: 3, er: 1, bb: 1, so: 7, decision: 'W' }), pit({ outs: 6, h: 2, er: 0, bb: 0, so: 3 })]
    const card = wpblPlayerCard(pitcher, HEIGHTS, [], lines, GAMES)
    // On the LEAGUE's basis, and pinned here on purpose. A share card is read by someone who
    // did not open the site and never chose a basis, next to whatever number the league
    // published, so it must not follow the ERA setting: `wpblPlayerCard` takes no basis and this
    // is the test that fails if somebody threads one through it.
    //
    // 1 ER in 7.0 IP. The figure here was 1.29 until Sep 3, 2026, when the league switched from
    // per 9 to per 7 and this test did its job: it went red on a change nothing else on the site
    // could see, which is the whole reason a published string is pinned literally.
    expect(card.description).toBe('1-0, 1.00 ERA and 0.86 WHIP with 10 K in 7.0 IP over 2 games. Full stat line, game log, and fielding.')
  })

  it('still leads with pitching when a pitcher has also taken at-bats', () => {
    const card = wpblPlayerCard(pitcher, HEIGHTS, [bat({ ab: 2, h: 1 })], [pit({ outs: 9, so: 4 })], GAMES)
    expect(card.description).toContain('ERA')
  })

  it('leads with batting for a position player who logged a mop-up inning', () => {
    const card = wpblPlayerCard(hitter, HEIGHTS, [bat({ ab: 4, h: 2, rbi: 1 })], [pit({ outs: 3 })], GAMES)
    expect(card.description.startsWith('.500/')).toBe(true)
  })

  it('ignores appearances with no plate appearance', () => {
    // A pinch-runner who scored: a batting row, but nothing that makes an 0-for-0 line.
    const card = wpblPlayerCard(hitter, HEIGHTS, [bat({ r: 1 })], [], GAMES)
    expect(card.description).toBe('C for the New York Heights. WPBL stats, game log, and bio — updated after every game.')
  })

  it('falls back to a roster line for a player yet to appear', () => {
    const card = wpblPlayerCard(hitter, HEIGHTS, [], [], GAMES)
    expect(card.description).toBe('C for the New York Heights. WPBL stats, game log, and bio — updated after every game.')
  })

  it('leaves postseason games out of the season line it describes', () => {
    // Two identical 2-for-4 games, one of them a playoff game. The card has to read as one.
    const card = wpblPlayerCard(hitter, HEIGHTS, [
      bat({ ab: 4, h: 2 }),
      bat({ game_id: 'g-post', ab: 4, h: 2 }),
    ], [], GAMES)
    expect(card.description).toContain('.500')
    expect(card.description).toContain('in 1 game')
  })

  it('names the card by the same slug the app bundles the headshot under', () => {
    expect(wpblPlayerCard({ id: 'p3', name: 'Maïka Dumais', position: 'LHP' }, HEIGHTS, [], [], GAMES).cardPath)
      .toBe('/cards/maika-dumais.webp')
  })
})

describe('the generated share cards', () => {
  // These are checked-in art, not build output, so nothing else notices when they fall out
  // of step with the roster. The failure is silent and one-sided: a player whose headshot
  // was added without rerunning scripts/make-wpbl-share-cards.py gets no og:image at all,
  // because the edge confirms the file exists before pointing at it and quietly drops the
  // tag when it does not.
  // Resolved from the repo root, which is where vitest runs, because import.meta.url is
  // not preserved through this config's transform.
  const dir = (name: string) => readdirSync(join(process.cwd(), 'src/wpbl', name))
    .filter(f => f.endsWith('.webp')).sort()

  const isPair = (f: string) => f.startsWith('compare-')

  it('covers every bundled headshot', () => {
    expect(dir('cards').filter(f => !isPair(f))).toEqual(dir('portraits'))
  })

  // The compare unfurl names its art from two club ids (compareCardPath); a pair the script did
  // not draw is a shared link with the default cover instead, silently.
  it('draws the compare art for every ordered pair of clubs', () => {
    const clubs = ['bos', 'la', 'ny', 'sf']
    const want = clubs.flatMap(a => clubs.map(b => `compare-${a}-${b}.webp`)).sort()
    expect(dir('cards').filter(isPair)).toEqual(want)
  })

  // Read out of the WebP itself so the check cannot pass on a stale expectation. A lossy VP8
  // frame states its size right after the 0x9d012a start code, 14 bits each, which is cheaper
  // than pulling an image library in for two numbers. One file of each kind rather than all of
  // them: each kind comes out of one script in one pass, so they are all wrong or all right.
  it.each(['maika-dumais.webp', 'compare-ny-sf.webp'])('%s is 1200x630, which is the whole point', file => {
    const buf = readFileSync(join(process.cwd(), 'src/wpbl/cards', file))
    const start = buf.indexOf(Buffer.from([0x9d, 0x01, 0x2a]))
    expect(start).toBeGreaterThan(0)
    expect(buf.readUInt16LE(start + 3) & 0x3fff).toBe(1200)
    expect(buf.readUInt16LE(start + 5) & 0x3fff).toBe(630)
  })
})

// The link-preview card for /wpbl/compare/<a>-vs-<b>: both names, a line each by the player
// card's role rule, and the club-pair art in the link's order.
describe('wpblCompareCard', () => {
  const side = (player: typeof hitter, team: string | null, teamId: string | null, b: WpblCardBatting[], p: WpblCardPitching[]) =>
    ({ player, team, teamId, batting: b, pitching: p })

  it('names both and gives each the line their role leads with', () => {
    const card = wpblCompareCard(
      side(hitter, 'New York', 'NY', [bat({ ab: 10, h: 4, hr: 1, bb: 2 })], []),
      side(pitcher, 'San Francisco', 'SF', [], [pit({ outs: 21, er: 2, so: 9, decision: 'W', bf: 26, gs: 1 })]),
      GAMES,
    )
    expect(card.ogTitle).toBe('Denae Benites vs Jill Albayati')
    expect(card.title).toBe('Denae Benites vs Jill Albayati: 2026 WPBL stats compared | sportydolphin.fun')
    expect(card.description).toMatch(/^Denae Benites \(New York\): \.400\/\.500\/\.700, 1 HR\. Jill Albayati \(San Francisco\): 1-0, /)
    expect(card.description).toContain(' ERA, 9 K. ')
    expect(card.cardPath).toBe('/cards/compare-ny-sf.webp')
  })

  it('keeps the regular season only, and names a player with no line without numbers', () => {
    const card = wpblCompareCard(
      side(hitter, 'New York', 'NY', [bat({ game_id: 'g-post', ab: 4, h: 4 })], []),
      side(pitcher, null, null, [], []),
      GAMES,
    )
    expect(card.description).toBe('Denae Benites (New York). Jill Albayati. Their 2026 seasons side by side.')
    expect(card.cardPath).toBeNull()
  })

  it('describes the current season only, once a second one has a result', () => {
    // A share card reads every line the player has. In 2027 that is two seasons, and summed under
    // "the season" it would publish a career; the card is the year the site opens on.
    const games = [...GAMES, { id: 'g-27', game_type: 'regular', counts_in_standings: true, game_date: '2027-06-01', status: 'final' as const }]
    const card = wpblCompareCard(
      side(hitter, 'New York', 'NY', [bat({ ab: 10, h: 10, hr: 5 }), bat({ game_id: 'g-27', ab: 4, h: 1 })], []),
      side(pitcher, null, null, [], []),
      games,
    )
    expect(card.title).toBe('Denae Benites vs Jill Albayati: 2027 WPBL stats compared | sportydolphin.fun')
    expect(card.description).toMatch(/^Denae Benites \(New York\): \.250\//)
  })

  it('builds the art path only from plain club ids', () => {
    expect(compareCardPath('LA', 'BOS')).toBe('/cards/compare-la-bos.webp')
    expect(compareCardPath('LA', '../x')).toBeNull()
  })
})

// ─── Game cards ────────────────────────────────────────────────────────────────

describe('wpblGameCard', () => {
  const teams = [
    { id: 'BOS', city: 'Boston', name: 'Hunters' },
    { id: 'LA', city: 'Los Angeles', name: 'Queens' },
  ]
  const game = (o: Partial<WpblCardGame> = {}): WpblCardGame => ({
    id: 'g1', game_date: '2026-08-23', home_team_id: 'BOS', away_team_id: 'LA',
    status: 'final', home_score: 7, away_score: 3, ...o,
  })

  it('leads a final with the winner, the way a result is spoken', () => {
    const card = wpblGameCard(game(), teams)
    expect(card.ogTitle).toBe('Hunters 7, Queens 3, Aug 23, 2026')
    expect(card.title).toContain('WPBL box score')
    expect(card.description).toContain('Boston Hunters beat the Los Angeles Queens 7–3')
  })

  it('leads a final with the winner even when the away side won', () => {
    const card = wpblGameCard(game({ home_score: 3, away_score: 7 }), teams)
    expect(card.ogTitle).toBe('Queens 7, Hunters 3, Aug 23, 2026')
  })

  // An unfurl is fetched once and cached by whoever fetched it, so a card claiming a live
  // score would still be claiming it a week later. The matchup is the part that stays true.
  it('names the matchup rather than the score for a game not yet final', () => {
    for (const status of ['scheduled', 'live', null]) {
      const card = wpblGameCard(game({ status }), teams)
      expect(card.ogTitle).toBe('Queens at Hunters, Aug 23, 2026')
      expect(card.title).toContain('WPBL preview')
    }
  })

  it('does not claim a result when the feed has sent no score', () => {
    const card = wpblGameCard(game({ home_score: null, away_score: null }), teams)
    expect(card.ogTitle).toBe('Queens at Hunters, Aug 23, 2026')
  })

  it('falls back to the club id rather than leaving a hole', () => {
    expect(wpblGameCard(game(), []).ogTitle).toBe('BOS 7, LA 3, Aug 23, 2026')
  })

  // game_date is a plain calendar date with no zone. Handing it to the Date constructor
  // reads it as UTC midnight, which renders as the day BEFORE anywhere west of Greenwich,
  // so a card would name the wrong day for most of the league's own audience.
  it('reads the date as a calendar date, not as UTC midnight', () => {
    expect(wpblCardDate('2026-08-01')).toBe('Aug 1, 2026')
    expect(wpblCardDate('2026-01-01')).toBe('Jan 1, 2026')
    expect(wpblCardDate('2026-12-31')).toBe('Dec 31, 2026')
    expect(wpblCardDate('nonsense')).toBe('')
  })
})
