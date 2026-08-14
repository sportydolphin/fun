import { describe, it, expect } from 'vitest'
import { wpblPlayerCard, type WpblCardBatting, type WpblCardPitching } from '../ogCard'

// The link-preview card for /wpbl?player=<id>. Worth pinning down here because the only
// other way to read it is to paste a link into a chat app and see what comes back: the
// Pages function that serves it (functions/wpbl/index.ts) runs at Cloudflare's edge, and
// its output is never rendered by the site itself.

const bat = (o: Partial<WpblCardBatting> = {}): WpblCardBatting => ({
  ab: 0, r: 0, h: 0, doubles: 0, triples: 0, hr: 0, rbi: 0, bb: 0, so: 0,
  hbp: 0, sb: 0, cs: 0, sf: 0, sh: 0, ...o,
})
const pit = (o: Partial<WpblCardPitching> = {}): WpblCardPitching => ({
  outs: 0, h: 0, r: 0, er: 0, bb: 0, so: 0, hr: 0, decision: null, ...o,
})

const HEIGHTS = 'New York Heights'
const hitter = { id: 'p1', name: 'Denae Benites', position: 'C' }
const pitcher = { id: 'p2', name: 'Jill Albayati', position: 'RHP' }

describe('wpblPlayerCard', () => {
  it('titles the card with the player, their position, and their club', () => {
    const card = wpblPlayerCard(hitter, HEIGHTS, [bat({ ab: 4, h: 2 })], [])
    expect(card.ogTitle).toBe('Denae Benites — C · New York Heights')
    expect(card.title).toBe('Denae Benites — WPBL stats | sportydolphin.fun')
  })

  it('separates a two-way position code from the club with a middot, not a comma', () => {
    const card = wpblPlayerCard({ id: 'p4', name: 'Jill Albayati', position: 'RHP, UTL' }, 'San Francisco Firebells', [], [])
    expect(card.ogTitle).toBe('Jill Albayati — RHP, UTL · San Francisco Firebells')
  })

  it('leads a hitter with the slash line and their power numbers', () => {
    const lines = [bat({ ab: 4, h: 2, hr: 1, rbi: 3 }), bat({ ab: 4, h: 2, hr: 1, rbi: 2 })]
    const card = wpblPlayerCard(hitter, HEIGHTS, lines, [])
    expect(card.description).toBe('.500/.500/1.250 with 2 HR and 5 RBI in 2 games. Full stat line, game log, and fielding.')
  })

  it('describes a hitter with no homers or RBI by what they did do', () => {
    const card = wpblPlayerCard(hitter, HEIGHTS, [bat({ ab: 3, h: 1 })], [])
    expect(card.description).toContain('— 1-for-3 in 1 game.')
    expect(card.description).not.toContain('0 HR')
  })

  it('leads a pitcher with ERA, WHIP, and the workload', () => {
    const lines = [pit({ outs: 15, h: 3, er: 1, bb: 1, so: 7, decision: 'W' }), pit({ outs: 6, h: 2, er: 0, bb: 0, so: 3 })]
    const card = wpblPlayerCard(pitcher, HEIGHTS, [], lines)
    // ERA is per SEVEN innings here — WPBL games are 7 innings (see sumPitching).
    expect(card.description).toBe('1-0, 1.00 ERA and 0.86 WHIP with 10 K in 7.0 IP over 2 games. Full stat line, game log, and fielding.')
  })

  it('still leads with pitching when a pitcher has also taken at-bats', () => {
    const card = wpblPlayerCard(pitcher, HEIGHTS, [bat({ ab: 2, h: 1 })], [pit({ outs: 9, so: 4 })])
    expect(card.description).toContain('ERA')
  })

  it('leads with batting for a position player who logged a mop-up inning', () => {
    const card = wpblPlayerCard(hitter, HEIGHTS, [bat({ ab: 4, h: 2, rbi: 1 })], [pit({ outs: 3 })])
    expect(card.description.startsWith('.500/')).toBe(true)
  })

  it('ignores appearances with no plate appearance', () => {
    // A pinch-runner who scored: a batting row, but nothing that makes an 0-for-0 line.
    const card = wpblPlayerCard(hitter, HEIGHTS, [bat({ r: 1 })], [])
    expect(card.description).toBe('C for the New York Heights. WPBL stats, game log, and bio — updated after every game.')
  })

  it('falls back to a roster line for a player yet to appear', () => {
    const card = wpblPlayerCard(hitter, HEIGHTS, [], [])
    expect(card.description).toBe('C for the New York Heights. WPBL stats, game log, and bio — updated after every game.')
  })

  it('names the portrait by the same slug the app bundles it under', () => {
    expect(wpblPlayerCard({ id: 'p3', name: 'Maïka Dumais', position: 'LHP' }, HEIGHTS, [], []).portraitPath)
      .toBe('/portraits/maika-dumais.webp')
  })
})
