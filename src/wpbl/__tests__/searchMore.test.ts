import { describe, expect, it } from 'vitest'
import { clipsByPlay, clubRuns, gameRecord, matchClips, parseGameRecord, parseStreakAsk, parseVideoAsk, playerRuns } from '../searchMore'
import type { WpblBattingLine, WpblGame, WpblVideo, WpblVideoTag } from '../types'

// Three questions the search box reads with the section's own data: clips, a game's records and
// streaks. The words are pinned here, and so is what each one counts (Nov 11, 2026).

const CLUBS = [
  { id: 'BOS', names: ['BOS', 'Boston', 'Hunters', 'Boston Hunters'] },
  { id: 'LA', names: ['LA', 'Los Angeles', 'Queens', 'Los Angeles Queens'] },
]

const game = (id: string, date: string, home: string, away: string, hs: number, as: number, over: Partial<WpblGame> = {}): WpblGame => ({
  id, game_date: date, start_time: null, home_team_id: home, away_team_id: away, venue: null, status: 'final',
  home_score: hs, away_score: as, innings: 7, notes: null, created_at: '', updated_at: '', ...over,
})

describe('the words', () => {
  it('reads a clip by player, club, opponent, play and year, and leaves a bare "videos" and a first alone', () => {
    expect(parseVideoAsk('geldenhuis home run video', CLUBS)).toEqual({ season: null, kind: 'hr', who: 'geldenhuis' })
    expect(parseVideoAsk('hunters vs queens highlights', CLUBS)).toEqual({ teamId: 'BOS', oppId: 'LA', season: null })
    expect(parseVideoAsk('walk-off clips', CLUBS)).toEqual({ season: null, kind: 'walkoff' })
    for (const t of ['videos', 'watch', 'video of the first hunters double', 'hunters doubles']) expect(parseVideoAsk(t, CLUBS), t).toBeNull()
  })

  it('reads a game record for the league, a club, an opponent and a year', () => {
    expect(parseGameRecord('longest game', CLUBS)).toEqual({ measure: 'longest', season: null })
    expect(parseGameRecord("hunters' biggest loss", CLUBS)).toEqual({ measure: 'loss', teamId: 'BOS', season: null })
    expect(parseGameRecord('highest-scoring game vs queens 2026', CLUBS)).toEqual({ measure: 'highest', oppId: 'LA', season: 2026 })
    // The league's biggest loss is its biggest win; a word nothing places is no question.
    expect(parseGameRecord('biggest loss', CLUBS)?.measure).toBe('win')
    for (const t of ['longest game whitmore', 'most runs in a game', 'blowouts']) expect(parseGameRecord(t, CLUBS), t).toBeNull()
  })

  it('reads a club\'s streaks and a player\'s, and leaves the league\'s longest hitting streak to Find', () => {
    expect(parseStreakAsk('hunters streak', CLUBS)).toEqual({ kind: 'club', teamId: 'BOS', type: null, longest: false, season: null })
    expect(parseStreakAsk('longest winning streak', CLUBS)).toEqual({ kind: 'club', type: 'W', longest: true, season: null })
    expect(parseStreakAsk('whitmore hitting streak', CLUBS)).toEqual({ kind: 'player', who: 'whitmore', type: 'hit', season: null })
    expect(parseStreakAsk('whitmore streak', CLUBS)).toEqual({ kind: 'player', who: 'whitmore', type: null, season: null })
    expect(parseStreakAsk('active hitting streaks', CLUBS)).toEqual({ kind: 'player', type: 'hit', season: null })
    for (const t of ['longest hitting streak', 'hitting streaks']) expect(parseStreakAsk(t, CLUBS), t).toBeNull()
  })
})

describe('a game\'s records', () => {
  const games = [
    game('a', '2026-08-01', 'BOS', 'LA', 9, 1),
    game('b', '2026-08-02', 'LA', 'BOS', 3, 2, { innings: 9 }),
    game('c', '2026-08-03', 'LA', 'BOS', 8, 0),
    // A semifinal: never a record, like every other season total.
    game('p', '2026-09-10', 'BOS', 'LA', 20, 0, { game_type: 'Semifinal' }),
  ]

  it('holds the postseason out and keeps every game tied', () => {
    expect(gameRecord({ measure: 'win', season: null }, games)).toEqual({ games: [games[0], games[2]], value: 8 })
    expect(gameRecord({ measure: 'longest', season: null }, games)).toEqual({ games: [games[1]], value: 9 })
  })

  it('reads a club\'s own wins and losses', () => {
    expect(gameRecord({ measure: 'win', teamId: 'BOS', season: null }, games)!.games.map(g => g.id)).toEqual(['a'])
    expect(gameRecord({ measure: 'loss', teamId: 'BOS', season: null }, games)!.games.map(g => g.id)).toEqual(['c'])
    expect(gameRecord({ measure: 'lowest', season: null }, games)).toMatchObject({ value: 5 })
  })
})

describe('streaks', () => {
  it('runs each club\'s wins and losses in the order played, the postseason out', () => {
    const games = [
      game('1', '2026-08-01', 'BOS', 'LA', 2, 1), game('2', '2026-08-02', 'BOS', 'LA', 2, 1),
      game('3', '2026-08-03', 'LA', 'BOS', 5, 1), game('p', '2026-09-10', 'BOS', 'LA', 9, 0, { game_type: 'Postseason' }),
    ]
    const { current, all } = clubRuns(games, 2026)
    expect(current.get('BOS')).toMatchObject({ type: 'L', count: 1 })
    expect(current.get('LA')).toMatchObject({ type: 'W', count: 1 })
    expect(all.filter(r => r.teamId === 'BOS').map(r => `${r.type}${r.count}`)).toEqual(['W2', 'L1'])
  })

  // The record books' rule, which Find's streaks keep: a game walked every time neither extends a
  // hitting streak nor ends it.
  it('counts a player\'s streak through a game with no at-bat', () => {
    const line = (game_id: string, ab: number, h: number, bb = 0): WpblBattingLine =>
      ({ game_id, player_id: 'p', ab, h, bb, hbp: 0, sf: 0, sh: 0 }) as WpblBattingLine
    const lines = [line('1', 3, 1), line('2', 0, 0, 3), line('3', 4, 2), line('4', 3, 0), line('5', 2, 1)]
    const when = (l: { game_id: string }) => `2026-08-0${l.game_id}`
    const hit = playerRuns(lines, when, 'hit')
    expect(hit.longest).toEqual({ count: 2, from: '2026-08-01', to: '2026-08-03' })
    expect(hit.current).toEqual({ count: 1, from: '2026-08-05', to: '2026-08-05' })
    expect(playerRuns(lines, when, 'ob').longest.count).toBe(3)
  })
})

describe('clips', () => {
  const video = (id: string, at: string, game_id: string | null = null): WpblVideo =>
    ({ video_id: id, channel_id: 'c', title: id, published_at: at, thumbnail_url: null, kind: 'highlight', game_id }) as WpblVideo
  const tag = (video_id: string, over: Partial<WpblVideoTag>): WpblVideoTag =>
    ({ video_id, game_id: null, play_sequence: null, inning: null, half: null, team_id: null, player_ids: [], method: 'play', ...over })
  const games = [game('g1', '2026-08-01', 'BOS', 'LA', 3, 2)]
  const videos = [video('hr', '2026-08-02'), video('k', '2026-08-03'), video('recap', '2026-08-04', 'g1')]
  const tags = new Map([
    ['hr', tag('hr', { game_id: 'g1', play_sequence: 4, event_type: 'home_run', team_id: 'BOS', player_ids: ['ann'] })],
    ['k', tag('k', { game_id: 'g1', play_sequence: 9, event_type: 'strikeout', team_id: 'LA', player_ids: ['bo', 'ace'] })],
  ])

  it('finds a club\'s plays and games, a player\'s clips and a kind, newest first', () => {
    const ids = (ask: Parameters<typeof matchClips>[0], who: string[] | null = null) => matchClips(ask, videos, tags, games, who, null).map(c => c.video.video_id)
    expect(ids({ teamId: 'BOS', season: null })).toEqual(['recap', 'hr'])
    expect(ids({ season: null }, ['ann'])).toEqual(['hr'])
    expect(ids({ season: null, kind: 'hr' })).toEqual(['hr'])
    expect(ids({ season: 2025 })).toEqual([])
  })

  it('keys each pinned clip by its play', () => {
    expect([...clipsByPlay(videos, tags).keys()]).toEqual(['g1|4', 'g1|9'])
  })
})
