import { describe, it, expect } from 'vitest'
import {
  buildBlueskyPost, boxScoreAlt, boxScoreCard, cardDate, cardCharset, linkFacets, graphemes,
  finalTag, accentOf, POST_LIMIT,
} from '../derive/blueskyRecap'
import type { GameRecap } from '../derive/recap'
import type { WpblGame, WpblTeam } from '../types'

// A public timeline is the one surface here with no undo: Bluesky has no edit, so anything
// wrong is wrong until it is deleted in front of everybody. These are the parts that decide
// what gets published.

const team = (id: string, name: string, abbr: string, color?: string): WpblTeam =>
  ({ id, name, abbr, city: 'City', color } as WpblTeam)

const BOS = team('t1', 'Hunters', 'BOS', '#12ab34')
const LA = team('t2', 'Queens', 'LA')
const teams = new Map([[BOS.id, BOS], [LA.id, LA]])

const game = (over: Partial<WpblGame> = {}): WpblGame => ({
  id: 'g1', game_date: '2026-08-23', status: 'final',
  home_team_id: BOS.id, away_team_id: LA.id, home_score: 7, away_score: 3, innings: null,
  away_line: [1, 0, 1, 0, 0, 0, 1].map((runs, i) => ({ inning: i + 1, runs })),
  home_line: [2, 0, 0, 0, 4, 1, 0].map((runs, i) => ({ inning: i + 1, runs })),
  ...over,
} as WpblGame)

const recap = (over: Partial<GameRecap> = {}): GameRecap => ({
  winner: BOS, loser: LA, winnerScore: 7, loserScore: 3, margin: 4, innings: 7,
  headline: 'Hunters beat Queens',
  blurb: 'The Hunters pulled away for a 7-3 win.',
  stars: [
    { playerId: 'p1', name: 'Kate Blunt', teamId: BOS.id, kind: 'pitch', statline: '5.0 IP, 1 K, 1 ER', score: 20 },
    { playerId: 'p2', name: 'Maïka Dumais', teamId: BOS.id, kind: 'bat', statline: '1-2, 1 HR, 2 RBI', score: 9 },
  ],
  decisions: [{ key: 'W', name: 'Kate Blunt', teamId: BOS.id, statline: '5.0 IP, 1 K, 1 ER' }],
  teamLine: [
    { teamId: LA.id, name: 'City Queens', r: 3, h: 6, e: 3 },
    { teamId: BOS.id, name: 'City Hunters', r: 7, h: 4, e: 1 },
  ],
  feats: [], flags: { shutout: false, blowout: false, oneRun: false, walkOff: false, comeback: false, extras: false },
  ...over,
} as GameRecap)

describe('the post fits', () => {
  it('stays under the cap and keeps the score and the link', () => {
    const post = buildBlueskyPost(game(), recap(), teams)
    expect(graphemes(post.text)).toBeLessThanOrEqual(POST_LIMIT)
    expect(post.text).toContain('Hunters 7, Queens 3 (F)')
    expect(post.text).toContain('sportydolphin.fun/wpbl?game=g1')
  })

  it('drops the stars before the narrative when it has to', () => {
    // Trimmed from the bottom, because the parts are not equally worth keeping. A post over
    // the cap is not a long post, it is no post: the server rejects it outright.
    const long = recap({
      blurb: `The Hunters pulled away for a 7-3 win. ${'x'.repeat(170)}`,
      stars: [{ playerId: 'p1', name: 'Someone With A Long Name', teamId: BOS.id, kind: 'bat', statline: '4-5, 2 HR, 6 RBI', score: 9 }],
    })
    const post = buildBlueskyPost(game(), long, teams)
    expect(graphemes(post.text)).toBeLessThanOrEqual(POST_LIMIT)
    expect(post.text).toContain('The Hunters pulled away')
    expect(post.text).not.toContain('Someone With A Long Name')
  })

  it('cuts the narrative rather than publishing a bare score', () => {
    // Only reachable if the blurb alone is enormous, and a post with no sentence in it is not
    // worth publishing. Cut by grapheme: slicing mid-character puts a replacement glyph in
    // public, and only ever on the players with accents in their names.
    const huge = recap({ blurb: `Maïka Dumais ${'y'.repeat(400)}` })
    const post = buildBlueskyPost(game(), huge, teams)
    expect(graphemes(post.text)).toBeLessThanOrEqual(POST_LIMIT)
    expect(post.text).toContain('Maïka Dumais')
    expect(post.text).toContain('…')
    expect(post.text).toContain('sportydolphin.fun/wpbl?game=g1')
  })

  it('counts graphemes, not UTF-16 units', () => {
    // "Maïka" is 5 to a reader and to Bluesky. Measuring with String.length would refuse
    // posts that fit, and only ever for the players with accents in their names.
    expect(graphemes('Maïka')).toBe(5)
  })

  it('says the game went long, which the score cannot', () => {
    expect(finalTag(recap({ innings: 9 }))).toBe('F/9')
    expect(finalTag(recap())).toBe('F')
  })
})

describe('link facets', () => {
  it('indexes by UTF-8 byte, not by string position', () => {
    // The trap: "ï" and "·" are each one JS character and two UTF-8 bytes. Indexing by string
    // position puts the underline a few characters left of the URL, and the post publishes
    // looking broken with no error anywhere.
    const text = 'Maïka · sportydolphin.fun/wpbl?game=g1'
    const [facet] = linkFacets(text, 'sportydolphin.fun/wpbl?game=g1') as any[]
    expect(facet.index.byteStart).toBe(new TextEncoder().encode('Maïka · ').length)
    expect(facet.index.byteStart).not.toBe(text.indexOf('sportydolphin'))
    expect(facet.features[0].uri).toBe('https://sportydolphin.fun/wpbl?game=g1')
  })

  it('returns nothing rather than a facet pointing at nothing', () => {
    expect(linkFacets('no link here', 'sportydolphin.fun/x')).toEqual([])
  })
})

describe('the card', () => {
  it('marks the half the home team never batted', () => {
    // BOS led after six and did not bat in the bottom of the 7th. Printing 0 there claims a
    // scoreless frame nobody played, so a scorebook writes X, and so does the alt text.
    expect(boxScoreAlt(game(), recap(), teams)).toContain('BOS 2 0 0 0 4 1 X')
  })

  it('describes itself for anyone who cannot see it', () => {
    // An image carrying the whole box score with no description is the game hidden entirely.
    const alt = boxScoreAlt(game(), recap(), teams)
    expect(alt).toContain('innings 1 to 7')
    expect(alt).toContain('7 runs, 4 hits, 1 errors')
  })

  it('formats the date without going through Date', () => {
    // A bare date parsed as a Date is midnight UTC printed in local time, which in every
    // American zone is the evening before. A Saturday game labelled Friday is wrong in a way
    // nobody reports.
    expect(cardDate('2026-08-23')).toBe('Aug 23, 2026')
    expect(cardDate('')).toBe('')
  })

  it('takes the winner brand colour only when it is real hex', () => {
    expect(accentOf(BOS)).toBe('#12ab34')
    expect(accentOf(LA)).toBe('#e8412c')
    expect(accentOf(team('t3', 'X', 'X', 'not-a-colour'))).toBe('#e8412c')
  })

  it('escapes text into the SVG rather than letting it close a tag', () => {
    const svg = boxScoreCard(game(), recap({ headline: 'A & B </text>' }), teams)
    expect(svg).toContain('A &amp; B &lt;/text&gt;')
    expect(svg).not.toContain('B </text>')
  })

  it('lists every character it draws, so the font subset can cover them', () => {
    // A glyph missing from the subset renders as nothing at all, silently: an accented name
    // simply vanishes from a card that otherwise looks perfect.
    const svg = boxScoreCard(game(), recap({ decisions: [{ key: 'W', name: 'Maïka Dumais', teamId: BOS.id, statline: '' }] }), teams)
    expect(cardCharset(svg)).toContain('ï')
  })

  it('widens for an extra-inning game instead of dropping columns', () => {
    const extras = game({
      away_line: Array.from({ length: 9 }, (_, i) => ({ inning: i + 1, runs: 0 })),
      home_line: Array.from({ length: 9 }, (_, i) => ({ inning: i + 1, runs: i === 8 ? 1 : 0 })),
    })
    const svg = boxScoreCard(extras, recap({ innings: 9 }), teams)
    expect(svg).toContain('>9<')
  })
})
