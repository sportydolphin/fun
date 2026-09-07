import { describe, it, expect } from 'vitest'
import { computeStandings } from '../api'
import { postseasonScheduleRows, postseasonSlots } from '../derive/bracket'
import type { WpblGame, WpblSiteGame, WpblTeam } from '../types'

// The postseason rows the schedule prints before the feed has any games for it. The whole
// value of this list is that it says only true things about a bracket nobody has drawn yet, so
// what is pinned here is mostly what it REFUSES to claim: no club in a slot that can still
// move, no "@" it cannot know, no if-necessary game after a series is over, and nothing at all
// on a date the feed has taken over. The "@" it CAN know is the league's own designation for
// the six semifinal games, which is pinned here too, seat by seat.

const TEAMS: WpblTeam[] = (['SF', 'LA', 'NY', 'BOS'] as const).map((id, i) => ({
  id, city: id, name: id, abbr: id, color: null, color_secondary: null,
  logo_url: null, sort_order: i, api_id: null, created_at: '',
}))

let seq = 0
const game = (over: Partial<WpblGame> = {}): WpblGame => ({
  id: `g${seq++}`,
  game_date: '2026-08-01', start_time: '6:30 PM',
  home_team_id: 'SF', away_team_id: 'LA',
  venue: null, status: 'final',
  home_score: 5, away_score: 2, innings: 7, notes: null,
  created_at: '', updated_at: '',
  game_type: 'regular', counts_in_standings: true,
  ...over,
})

let day = 0
const date = () => `2026-08-${String((day++ % 28) + 1).padStart(2, '0')}`
const win = (winner: string, loser: string): WpblGame =>
  game({ game_date: date(), home_team_id: winner, away_team_id: loser, home_score: 6, away_score: 1 })

/** SF 1st, LA 2nd, NY 3rd, BOS 4th, on wins alone, with nothing left to play. */
const finished = (): WpblGame[] => [
  win('SF', 'BOS'), win('SF', 'BOS'), win('SF', 'BOS'), win('SF', 'NY'),
  win('LA', 'BOS'), win('LA', 'BOS'), win('LA', 'NY'),
  win('NY', 'BOS'), win('BOS', 'NY'),
]

const rowsFor = (games: WpblGame[], site: WpblSiteGame[] = []) =>
  postseasonScheduleRows(computeStandings(TEAMS, games), games, site)

/** A played postseason game: the feed's own row, which is what decides a series. */
const post = (date: string, winner: string, loser: string): WpblGame =>
  game({
    game_date: date, home_team_id: winner, away_team_id: loser,
    home_score: 5, away_score: 1, game_type: 'Semifinal', counts_in_standings: false,
  })

/** One row of the league's mirrored website calendar. */
const siteGame = (over: Partial<WpblSiteGame> = {}): WpblSiteGame => ({
  event_id: 1, game_date: '2026-09-09', start_time: '6:00 PM', title: 'Boston @ San Francisco',
  status: 'scheduled', home_team_id: 'SF', away_team_id: 'BOS',
  home_score: null, away_score: null,
  round: 'semifinal', series_key: 'A', game_number: 1,
  url: null, ticket_url: null,
  ...over,
})
/** The same thing, named for what the tiebreak tests are actually asking it. */
const teamSpecsSeeds = rowsFor
const bySeries = (games: WpblGame[], label: string) => rowsFor(games).filter(r => r.label === label)

describe('postseasonScheduleRows', () => {
  it('prints the published calendar: two semifinals and a best-of-five final', () => {
    const rows = rowsFor(finished())
    expect(bySeries(finished(), 'Semifinal A')).toHaveLength(3)
    expect(bySeries(finished(), 'Championship')).toHaveLength(5)
    // Date order across all three series, which is how the schedule reads them.
    expect(rows.map(r => r.date)).toEqual([...rows.map(r => r.date)].sort())
    expect(rows[0].date).toBe('2026-09-09')
    expect(rows[rows.length - 1].date).toBe('2026-09-22')
  })

  it('names a club only once that seed can no longer move', () => {
    const rows = rowsFor(finished())
    const g1 = rows.find(r => r.label === 'Semifinal A' && r.gameNumber === 1)!
    expect(g1.first.team?.id).toBe('SF')
    expect(g1.second.team?.id).toBe('BOS')
  })

  // The reason this is seed-based rather than a projection. Mid-season every slot is still
  // live, and a schedule that named clubs would be naming the wrong ones.
  it('falls back to the seed number while the race is open', () => {
    const open = [win('SF', 'BOS'), win('LA', 'NY'), game({ game_date: '2026-09-06', status: 'scheduled', home_score: null, away_score: null })]
    const g1 = rowsFor(open).find(r => r.label === 'Semifinal A' && r.gameNumber === 1)!
    expect(g1.first.team).toBeNull()
    expect(g1.first.label).toBe('1 seed')
    expect(g1.second.label).toBe('4 seed')
  })

  // The top seed usually locks days before the bottom two stop swapping. Holding every slot
  // vague until the whole bracket settles would say less than we know.
  it('settles one seed at a time rather than waiting for the whole bracket', () => {
    // SF has 4 wins and nobody else can reach 4, but LA/NY/BOS are still tangled.
    const partial = [
      win('SF', 'BOS'), win('SF', 'BOS'), win('SF', 'NY'), win('SF', 'LA'),
      win('LA', 'NY'), win('NY', 'BOS'), win('BOS', 'LA'),
      game({ game_date: '2026-09-05', status: 'scheduled', home_team_id: 'LA', away_team_id: 'NY', home_score: null, away_score: null }),
      game({ game_date: '2026-09-06', status: 'scheduled', home_team_id: 'BOS', away_team_id: 'NY', home_score: null, away_score: null }),
    ]
    const g1 = rowsFor(partial).find(r => r.label === 'Semifinal A' && r.gameNumber === 1)!
    expect(g1.first.team?.id).toBe('SF')   // locked
    expect(g1.second.team).toBeNull()      // the 4 seed is still being fought over
    expect(g1.second.label).toBe('4 seed')
  })

  // A published game always wins. This is what lets the constant retire itself instead of
  // needing to be deleted the day the league draws the bracket.
  it('yields the date to a real postseason game from the feed', () => {
    const games = [...finished(), game({
      game_date: '2026-09-09', home_team_id: 'SF', away_team_id: 'BOS',
      game_type: 'Semifinal A', counts_in_standings: false, status: 'scheduled',
      home_score: null, away_score: null,
    })]
    expect(rowsFor(games).some(r => r.date === '2026-09-09')).toBe(false)
    expect(rowsFor(games).some(r => r.date === '2026-09-11')).toBe(true)
  })

  // The one way this list can be actively false rather than merely vague.
  it('drops an if-necessary game once the series is decided', () => {
    const swept = [...finished(),
      game({ game_date: '2026-09-09', home_team_id: 'SF', away_team_id: 'BOS', home_score: 5, away_score: 1, game_type: 'Semifinal A', counts_in_standings: false }),
      game({ game_date: '2026-09-11', home_team_id: 'SF', away_team_id: 'BOS', home_score: 4, away_score: 2, game_type: 'Semifinal A', counts_in_standings: false }),
    ]
    // Sep 13 is Semifinal A game 3, marked if-necessary, and SF have already won 2-0.
    expect(rowsFor(swept).some(r => r.date === '2026-09-13')).toBe(false)
    // Semifinal B is untouched by that, and its own game 3 is still on the board.
    expect(rowsFor(swept).some(r => r.date === '2026-09-14')).toBe(true)
  })

  // THE TWO HALVES OF THE TIEBREAK, on the real table of Sep 3, 2026.
  //
  // A clinch is not a statement about wins alone, because the standings break a tie on head to
  // head. Whether a club that can only DRAW LEVEL with you is a threat depends on who holds that
  // series and whether it is finished, and these two go opposite ways on the same arithmetic.
  //
  // BALANCED, every pair meeting five times so every club plays fifteen. `computeStandings`
  // sorts on win PERCENTAGE, so a fixture with uneven games played can rank a 7-3 club above a
  // 9-5 one, and a draft of this test did exactly that and asked the wrong question.
  //
  //   SF 9-4  LA 7-6  NY 6-7  BOS 4-9, two to play each
  //   SF-LA 3-2 finished · NY-BOS 3-2 to BOS finished · the other four have one left
  const beat = (winner: string, loser: string, n: number) =>
    Array.from({ length: n }, () => win(winner, loser))
  const toPlay = (home: string, away: string) => game({
    game_date: '2026-09-05', home_team_id: home, away_team_id: away,
    status: 'scheduled', home_score: null, away_score: null,
  })
  const season = () => [
    ...beat('SF', 'LA', 3), ...beat('LA', 'SF', 2),
    ...beat('SF', 'NY', 2), ...beat('NY', 'SF', 2), toPlay('NY', 'SF'),
    ...beat('SF', 'BOS', 4), toPlay('SF', 'BOS'),
    ...beat('LA', 'NY', 2), ...beat('NY', 'LA', 2), toPlay('LA', 'NY'),
    ...beat('LA', 'BOS', 3), ...beat('BOS', 'LA', 1), toPlay('BOS', 'LA'),
    ...beat('NY', 'BOS', 2), ...beat('BOS', 'NY', 3),
  ]
  const semiA1 = (games: WpblGame[]) =>
    rowsFor(games).find(r => r.label === 'Semifinal A' && r.gameNumber === 1)!

  // Los Angeles' ceiling is 9 and San Francisco's floor is 9, so the only way LA catch them is a
  // 9-6 tie, and SF hold that series 3-2 with nothing left in it. This list said "1 seed".
  it('names a club that has clinched on a tiebreak it can no longer lose', () => {
    expect(semiA1(season()).first.team?.id).toBe('SF')
  })

  // The mirror. Boston top out at 6 wins, which is exactly New York's total, and Boston hold
  // THAT series 3-2 with none left, so a tie goes their way and third is still reachable.
  it('will not name a club that wins the tie it can still force', () => {
    const g1 = semiA1(season())
    expect(g1.second.team).toBeNull()
    expect(g1.second.label).toBe('4 seed')
  })

  // A series with a game still in it decides nothing: the lead in it can change hands.
  it('will not spend a tiebreak that can still flip', () => {
    const games = season()
    const i = games.findIndex(g => g.home_team_id === 'SF' && g.away_team_id === 'LA')
    games[i] = toPlay('SF', 'LA')
    expect(semiA1(games).first.team).toBeNull()
  })

  it('carries the if-necessary flag so the card can mark it', () => {
    const rows = bySeries(finished(), 'Championship')
    expect(rows.filter(r => r.ifNecessary).map(r => r.gameNumber)).toEqual([4, 5])
  })

  // A PAIRING CLOSES BEFORE ITS SEEDS DO, which is the real table of Sep 5, 2026: San Francisco
  // had the 1 seed, Boston the 4, and New York and Los Angeles were disputing 2 and 3 with the
  // game between them still to play. Whoever won it, they were playing EACH OTHER, and the
  // per-seed rule could not say so.
  //
  // BALANCED AT NINE GAMES EACH so that the win-percentage sort and the win-count clinch cannot
  // disagree: SF 8-1, LA 4-5, NY 4-5, BOS 2-7, with only LA-NY left.
  //   SF beats LA 3-0 and NY 3-0 and BOS 2-1 · LA beats BOS 3-0 · NY beats LA 2-1 and BOS 2-1
  const pairSettled = (): WpblGame[] => [
    ...beat('SF', 'LA', 3),
    ...beat('SF', 'NY', 3),
    ...beat('SF', 'BOS', 2), ...beat('BOS', 'SF', 1),
    ...beat('LA', 'BOS', 3),
    ...beat('NY', 'LA', 2), ...beat('LA', 'NY', 1),
    ...beat('NY', 'BOS', 2), ...beat('BOS', 'NY', 1),
    toPlay('LA', 'NY'),
  ]

  it('names both clubs once only two can fill a pairing, even with the seeds open', () => {
    const semiB = rowsFor(pairSettled()).find(r => r.label === 'Semifinal B' && r.gameNumber === 1)!
    expect([semiB.first.team?.id, semiB.second.team?.id].sort()).toEqual(['LA', 'NY'])
    // The one thing still unknown, and the row has to say so: the order printed is the current
    // standings order, which the last game can still reverse.
    expect(semiB.seedOrderTbd).toBe(true)
  })

  it('leaves a settled pairing unflagged, and does not flag one that is still open', () => {
    // Semifinal A on the same table: both seeds clinched outright, so the order is a fact.
    const semiA = rowsFor(pairSettled()).find(r => r.label === 'Semifinal A' && r.gameNumber === 1)!
    expect([semiA.first.team?.id, semiA.second.team?.id]).toEqual(['SF', 'BOS'])
    expect(semiA.seedOrderTbd).toBe(false)
    // And mid-season, where three clubs can still land in the same two seats, naming two of
    // them would be a guess. The 1v4 pair is the one that has to be counted rather than tested
    // for overlap: its seats are not adjacent, so every club's range starts out inside it.
    const open = [win('SF', 'BOS'), win('LA', 'NY'), toPlay('SF', 'LA'), toPlay('NY', 'BOS')]
    for (const r of rowsFor(open)) {
      expect(r.first.team).toBeNull()
      expect(r.seedOrderTbd).toBe(false)
    }
  })

  // The other end of the if-necessary rule. A row is DROPPED when the series is over; it is
  // UNFLAGGED when the series is alive and every game before it has been played, which in a
  // best-of-three is the moment game 3 stops being conditional. The Home scoreboard spends its
  // four upcoming slots on games it can promise, so it reads this rather than the game number.
  it('unflags an if-necessary game once the series has to reach it', () => {
    const split = [...finished(),
      game({ game_date: '2026-09-09', home_team_id: 'SF', away_team_id: 'BOS', home_score: 5, away_score: 1, game_type: 'Semifinal A', counts_in_standings: false }),
      game({ game_date: '2026-09-11', home_team_id: 'SF', away_team_id: 'BOS', home_score: 2, away_score: 6, game_type: 'Semifinal A', counts_in_standings: false }),
    ]
    const g3 = rowsFor(split).find(r => r.date === '2026-09-13')!
    expect(g3.ifNecessary).toBe(false)
    // Semifinal B has not started, so its own game 3 is still a maybe.
    expect(rowsFor(split).find(r => r.date === '2026-09-14')!.ifNecessary).toBe(true)
  })

  // The chip on the Home scoreboard is 8.5rem wide, where "Semifinal A winner" ellipsises to
  // "Semifinal A w…" and names the wrong thing.
  it('carries a short label for a slot with no room for the long one', () => {
    const champ = bySeries(finished(), 'Championship')[0]
    expect(champ.first.label).toBe('Semifinal A winner')
    expect(champ.first.shortLabel).toBe('Semi A')
    const semiA = rowsFor([win('SF', 'BOS')]).find(r => r.label === 'Semifinal A')!
    expect(semiA.first.shortLabel).toBe('1 seed')
  })

  // WHO BATS LAST. The league's schedule page designates a home club for every semifinal game
  // and for none of the championship's: the higher seed bats last in games 1 and 3, the lower
  // seed in game 2. Held as a seat rather than a club so it was already true before the seeds
  // were, which is the same reason the pairings are seeds.
  it('carries the home designation the league published for the semifinals', () => {
    for (const label of ['Semifinal A', 'Semifinal B']) {
      const rows = bySeries(finished(), label)
      expect(rows.map(r => r.homeSlot)).toEqual(['first', 'second', 'first'])
    }
  })

  // Five rows the league lists as "WPBL Championship Game #1" with no clubs on them. Extending
  // the semifinals' pattern over them would be a guess, and a guessed "@" is the one thing
  // these rows exist not to print.
  it('claims no home club for the championship, which the league has not designated', () => {
    for (const r of bySeries(finished(), 'Championship')) expect(r.homeSlot).toBeNull()
  })

  // "The higher seed bats last" needs a higher seed. With the pairing closed and the seeds
  // inside it open, `first` and `second` are the standings order and the last game can reverse
  // them, so applying the designation would print an "@" against a coin toss.
  it('drops the designation while the seed order inside a pairing is open', () => {
    const semiB = rowsFor(pairSettled()).filter(r => r.label === 'Semifinal B')
    expect(semiB.map(r => r.seedOrderTbd)).toEqual([true, true, true])
    expect(semiB.map(r => r.homeSlot)).toEqual([null, null, null])
    // The other semifinal on the same table has both seeds clinched and keeps it.
    expect(rowsFor(pairSettled()).find(r => r.label === 'Semifinal A')!.homeSlot).toBe('first')
  })

  // The one ordering rule, in the one place three surfaces read it from: away over home when
  // there is a home, seed order when there is not.
  it('orders the two seats away over home, and leaves them in seed order without one', () => {
    const rows = bySeries(finished(), 'Semifinal A')
    const g1 = postseasonSlots(rows[0])
    expect(g1.homeKnown).toBe(true)
    expect(g1.slots.map(s => s.team?.id)).toEqual(['BOS', 'SF'])   // 4 seed @ 1 seed
    const g2 = postseasonSlots(rows[1])
    expect(g2.slots.map(s => s.team?.id)).toEqual(['SF', 'BOS'])   // 1 seed @ 4 seed
    const champ = postseasonSlots(bySeries(finished(), 'Championship')[0])
    expect(champ.homeKnown).toBe(false)
    expect(champ.slots.map(s => s.label)).toEqual(['Semifinal A winner', 'Semifinal B winner'])
  })

  // ─── The league's own calendar, mirrored ────────────────────────────────────
  //
  // The stats feed will not carry a postseason game until it has two clubs for it, so for the
  // fixtures it has never published the league's website is the only source. It names clubs,
  // which is what lets it answer the one thing the seat rule cannot: the championship's home
  // club, published with no clubs on it until the semifinals end.

  it('takes the home club from the mirrored calendar when it names these two clubs', () => {
    // Deliberately the OPPOSITE of the published pattern, so a pass cannot come from the
    // constant agreeing by accident: the league moved game 1 to the lower seed.
    const rows = rowsFor(finished(), [siteGame({ home_team_id: 'BOS', away_team_id: 'SF' })])
    const g1 = rows.find(r => r.label === 'Semifinal A' && r.gameNumber === 1)!
    expect(g1.homeSlot).toBe('second')
    expect(postseasonSlots(g1).slots.map(s => s.team?.id)).toEqual(['SF', 'BOS'])
  })

  it('answers the championship, which the seat rule never can', () => {
    const site = [siteGame({
      event_id: 2, game_date: '2026-09-16', round: 'championship', series_key: null,
      game_number: 1, home_team_id: 'SF', away_team_id: 'LA',
    })]
    // Both semifinals decided, so the final's two seats hold clubs and the calendar's can be
    // matched against them.
    const played = [...finished(),
      post('2026-09-09', 'SF', 'BOS'), post('2026-09-11', 'SF', 'BOS'),
      post('2026-09-10', 'LA', 'NY'), post('2026-09-12', 'LA', 'NY'),
    ]
    const g1 = rowsFor(played, site).find(r => r.label === 'Championship' && r.gameNumber === 1)!
    expect(g1.homeSlot).toBe('first')
    expect(postseasonSlots(g1).slots.map(s => s.team?.id)).toEqual(['LA', 'SF'])
  })

  // A mirrored row naming two clubs that are not the two in front of us is a disagreement with
  // the bracket, not an instruction. Falling back to the seat rule keeps the "@" consistent
  // with the clubs printed beside it.
  it('ignores a mirrored row whose clubs are not this matchup', () => {
    const rows = rowsFor(finished(), [siteGame({ home_team_id: 'NY', away_team_id: 'LA' })])
    expect(rows.find(r => r.label === 'Semifinal A' && r.gameNumber === 1)!.homeSlot).toBe('first')
  })

  // The league moving a game is the one thing a hardcoded date cannot survive and the one
  // nobody would notice, so the live calendar wins on when as well as on who.
  it('takes the date and time from the calendar when they have moved', () => {
    const rows = rowsFor(finished(), [siteGame({ game_date: '2026-09-08', start_time: '1:00 PM' })])
    const g1 = rows.find(r => r.label === 'Semifinal A' && r.gameNumber === 1)!
    expect([g1.date, g1.time]).toEqual(['2026-09-08', '1:00 PM'])
  })

  // A partial league is a test fixture and an empty state, not a bracket.
  it('returns nothing when there are not four clubs', () => {
    const two = TEAMS.slice(0, 2)
    expect(postseasonScheduleRows(computeStandings(two, [win('SF', 'LA')]), [win('SF', 'LA')])).toEqual([])
  })
})
