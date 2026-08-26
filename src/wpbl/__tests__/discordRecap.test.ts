import { describe, it, expect } from 'vitest'
import { buildRecapMessage, lineScoreBlock, embedColor, recapMessageFingerprint, recapMessageHash } from '../derive/discordRecap'
import type { GameRecap } from '../derive/recap'
import type { WpblGame, WpblTeam } from '../types'

// What the Discord recap job posts to a public channel, and — through the fingerprint —
// when it decides an already-posted message needs editing. Both are worth pinning: nobody
// sees this output in the app, and getting the second one wrong means either a stale box
// score sitting in the channel or the job re-editing the same message on every pass.

const team = (id: string, city: string, name: string, abbr: string, color: string | null): WpblTeam => ({
  id, city, name, abbr, color, color_secondary: null, logo_url: null, sort_order: 0, api_id: null,
  created_at: '2026-07-01T00:00:00Z',
})
const TEAMS = new Map([
  ['BOS', team('BOS', 'Boston', 'Hunters', 'BOS', '#2e5f3a')],
  ['NY', team('NY', 'New York', 'Heights', 'NY', '#1b4f9c')],
])

const game = (o: Partial<WpblGame> = {}): WpblGame => ({
  id: 'g1', game_date: '2026-08-13', start_time: '4:30 PM',
  home_team_id: 'NY', away_team_id: 'BOS', venue: null, status: 'final',
  home_score: 1, away_score: 6, innings: 7, notes: null,
  away_line: [1, 2, 3, 4, 5, 6, 7].map(i => ({ inning: i, runs: [2, 0, 0, 1, 3, 0, 0][i - 1] })),
  home_line: [1, 2, 3, 4, 5, 6, 7].map(i => ({ inning: i, runs: [0, 0, 0, 1, 0, 0, 0][i - 1] })),
  created_at: '', updated_at: '',
  ...o,
} as WpblGame)

const recap = (o: Partial<GameRecap> = {}): GameRecap => ({
  winner: TEAMS.get('BOS')!, loser: TEAMS.get('NY')!,
  winnerScore: 6, loserScore: 1, margin: 5, innings: 7,
  headline: 'Hunters top Heights',
  blurb: 'The Hunters held on for a 6-1 win.',
  stars: [{ playerId: 'p1', name: 'Gigi Schiano', teamId: 'BOS', kind: 'pitch', statline: '3.0 IP, 1 K, 0 ER', score: 9 }],
  decisions: [{ key: 'W', name: 'Gigi Schiano', teamId: 'BOS', statline: '3.0 IP, 1 K, 0 ER' }],
  teamLine: [
    { teamId: 'BOS', name: 'Boston Hunters', r: 6, h: 11, e: 0 },
    { teamId: 'NY', name: 'New York Heights', r: 1, h: 8, e: 2 },
  ],
  feats: [],
  flags: { shutout: false, blowout: false, oneRun: false, walkOff: false, comeback: false, extras: false },
  ...o,
})

describe('lineScoreBlock', () => {
  it('lays the innings out as a fenced monospace table, away side first', () => {
    expect(lineScoreBlock(game(), recap(), TEAMS)).toBe([
      '```',
      '      1  2  3  4  5  6  7 │  R  H  E',
      'BOS   2  0  0  1  3  0  0 │  6 11  0',
      'NY    0  0  0  1  0  0  0 │  1  8  2',
      '```',
    ].join('\n'))
  })

  it('abbreviates the clubs, so the block stays inside a phone', () => {
    const block = lineScoreBlock(game(), recap(), TEAMS)
    expect(block).not.toContain('Boston Hunters')
    expect(Math.max(...block.split('\n').map(l => l.length))).toBeLessThan(48)
  })

  it('widens to the innings actually played when a game goes long', () => {
    const long = game({ innings: 9, away_line: [{ inning: 9, runs: 2 }], home_line: [] })
    const lines = lineScoreBlock(long, recap({ innings: 9 }), TEAMS).split('\n')
    expect(lines[1].trim().split(/\s+/).slice(0, 9)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9'])
    expect(lines[2]).toContain(' 0  0  0  0  0  0  0  0  2')
  })

  // A home team that's already ahead never bats in the bottom of the last inning. The feed
  // reports 0 for that half anyway, and printing the 0 invents a frame that was never played.
  it('scores the final inning X when the home team never had to bat', () => {
    const homeWin = game({
      home_score: 10, away_score: 3,
      away_line: [1, 2, 3, 4, 5, 6, 7].map(i => ({ inning: i, runs: [0, 0, 2, 0, 0, 0, 1][i - 1] })),
      home_line: [1, 2, 3, 4, 5, 6, 7].map(i => ({ inning: i, runs: [2, 0, 0, 7, 1, 0, 0][i - 1] })),
    })
    const lines = lineScoreBlock(homeWin, recap(), TEAMS).split('\n')
    expect(lines[2]).toContain(' 0  0  2  0  0  0  1 │')   // away batted the 7th
    expect(lines[3]).toContain(' 2  0  0  7  1  0  X │')   // home never did
  })

  it('keeps the home runs on a walk-off, where the home team did bat', () => {
    const walkOff = game({
      home_score: 2, away_score: 1,
      away_line: [1, 2, 3, 4, 5, 6, 7].map(i => ({ inning: i, runs: [0, 0, 0, 0, 0, 0, 1][i - 1] })),
      home_line: [1, 2, 3, 4, 5, 6, 7].map(i => ({ inning: i, runs: [0, 0, 0, 0, 0, 0, 2][i - 1] })),
    })
    const lines = lineScoreBlock(walkOff, recap(), TEAMS).split('\n')
    expect(lines[3]).toContain(' 0  0  0  0  0  0  2 │')
    expect(lines[3]).not.toContain('X')
  })

  it('falls back to the club name when a team is missing from the map', () => {
    expect(lineScoreBlock(game(), recap(), new Map())).toContain('Boston Hunters')
  })
})

const GAME_URL = 'https://sportydolphin.fun/wpbl/games/2026-08-22-heights-at-hunters'

describe('buildRecapMessage', () => {
  it('never pings the channel', () => {
    expect(buildRecapMessage(game(), recap(), TEAMS, GAME_URL).allowed_mentions).toEqual({ parse: [] })
  })

  // The BLANK line is the assertion, not incidental to it. Discord draws a code block as a
  // filled box, and a single newline puts that box hard against the last line of the blurb.
  it('leads with the headline and carries the blurb a clear line above the box score', () => {
    const { embeds: [e] } = buildRecapMessage(game(), recap(), TEAMS, GAME_URL)
    expect(e.title).toBe('Hunters top Heights')
    expect(e.description.startsWith('The Hunters held on for a 6-1 win.\n\n```')).toBe(true)
  })

  it('links at the URL it is handed, so the embed cannot invent one of its own', () => {
    expect(buildRecapMessage(game(), recap(), TEAMS, GAME_URL).embeds[0].url)
      .toBe(GAME_URL)
  })

  it('takes its accent colour from the winner', () => {
    expect(buildRecapMessage(game(), recap(), TEAMS, GAME_URL).embeds[0].color).toBe(0x2e5f3a)
  })

  it('drops sections it has nothing to say in', () => {
    const bare = buildRecapMessage(game(), recap({ stars: [], decisions: [], feats: [] }), TEAMS, GAME_URL)
    expect(bare.embeds[0].fields).toEqual([])
  })

  it('notes extra innings in the footer, and stays quiet at the regulation seven', () => {
    expect(buildRecapMessage(game({ innings: 9 }), recap(), TEAMS, GAME_URL).embeds[0].footer.text).toContain('9 innings')
    expect(buildRecapMessage(game(), recap(), TEAMS, GAME_URL).embeds[0].footer.text).not.toContain('innings')
  })
})

describe('embedColor', () => {
  it('reads a hex team colour', () => expect(embedColor(TEAMS.get('NY'))).toBe(0x1b4f9c))
  it('is undefined for a team with no usable colour', () => {
    expect(embedColor(team('X', 'X', 'X', 'X', null))).toBeUndefined()
    expect(embedColor(team('X', 'X', 'X', 'X', 'rebeccapurple'))).toBeUndefined()
  })
})

describe('recapMessageFingerprint', () => {
  it('is stable for the same game, so a quiet run sends nothing', () => {
    expect(recapMessageFingerprint(buildRecapMessage(game(), recap(), TEAMS, GAME_URL)))
      .toBe(recapMessageFingerprint(buildRecapMessage(game(), recap(), TEAMS, GAME_URL)))
  })

  it('changes when a corrected box score changes what the reader would see', () => {
    const before = recapMessageFingerprint(buildRecapMessage(game(), recap(), TEAMS, GAME_URL))
    // The kind of revision the feed actually issues after a final: a hit reclassified as
    // an error.
    const corrected = recap({ teamLine: [
      { teamId: 'BOS', name: 'Boston Hunters', r: 6, h: 10, e: 0 },
      { teamId: 'NY', name: 'New York Heights', r: 1, h: 8, e: 3 },
    ] })
    expect(recapMessageFingerprint(buildRecapMessage(game(), corrected, TEAMS, GAME_URL))).not.toBe(before)
  })
})

describe('recapMessageHash', () => {
  it('is the fingerprint, hashed — the same message hashes the same every time', async () => {
    const a = await recapMessageHash(buildRecapMessage(game(), recap(), TEAMS, GAME_URL))
    const b = await recapMessageHash(buildRecapMessage(game(), recap(), TEAMS, GAME_URL))
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{32}$/)
  })

  it('differs once the message differs, which is what makes the two posters agree', async () => {
    // The edge function posts a final the moment the ingest sees it; the scheduled job then
    // compares this hash to decide whether to edit. Both compute it here, so an unchanged
    // game must produce an unchanged hash or the job would re-edit a fresh message forever.
    const before = await recapMessageHash(buildRecapMessage(game(), recap(), TEAMS, GAME_URL))
    const after = await recapMessageHash(buildRecapMessage(game(), recap({ headline: 'Hunters rout Heights' }), TEAMS, GAME_URL))
    expect(after).not.toBe(before)
  })
})
