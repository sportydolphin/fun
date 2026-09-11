import { describe, it, expect } from 'vitest'
import { canonicalFeedName, matchFeedName } from '../feedNames'

// The seven the league's play log and live situation spell differently from the roster, read
// off wpbl_game_plays on Sep 10, 2026. Every one is a real player, and every one lost her
// headshot, her statline and her link for as long as the match was exact-only: the portrait
// lookup is BY NAME, so an unmatched spelling draws initials on a coloured circle, which is
// indistinguishable from a player the site has no photo of.
const FEED_SPELLINGS: ReadonlyArray<readonly [string, string]> = [
  ['Val Perez', 'Valerie Perez'],
  ['Isabella Villareal', 'Isabella Villarreal'],
  ['Maggie Fox', 'Maggie Foxx'],
  ['Emi Saki', 'Emi Saiki'],
  ['Alexi Jorge', 'Alexia Jorge'],
  ['Gabriella Haas', 'Gabrielle Haas'],
  ['Suzu Naraski', 'Suzu Narasaki'],
]

// Enough of the roster to be a real test of ambiguity rather than a list of seven happy paths:
// it carries both Valenzuelas, both Adelaides and Denae Benites, who is one edit from nobody
// here but sits beside Samaria Benítez in the league.
const ROSTER = [
  'Valerie Perez', 'Isabella Villarreal', 'Maggie Foxx', 'Emi Saiki', 'Alexia Jorge',
  'Gabrielle Haas', 'Suzu Narasaki', 'Andréanne Leblanc', 'Samaria Benítez', 'Thaima Maximiliana',
  'Ela Day-Bédard', 'Denae Benites', 'Paloma Benach', 'Maria José Valenzuela',
  'Angela Valenzuela', 'Adelaide Frank', 'Adelaide Ziebart', 'Kelsie Whitmore',
].map(name => ({ name }))

describe('the feed spelling of a name', () => {
  it.each(FEED_SPELLINGS)('resolves %s to %s', (feed, roster) => {
    expect(canonicalFeedName(feed, ROSTER)).toBe(roster)
  })

  // These four already worked, because normalizeName folds the accents. Pinned so a future
  // rewrite of the matching cannot quietly drop the case that needs no matching at all.
  it.each([
    ['Andreanne Leblanc', 'Andréanne Leblanc'],
    ['Samaria Benitez', 'Samaria Benítez'],
    ['Tháima Maximiliana', 'Thaima Maximiliana'],
    ['Ela Day-Bedard', 'Ela Day-Bédard'],
  ])('folds accents: %s is %s', (feed, roster) => {
    expect(canonicalFeedName(feed, ROSTER)).toBe(roster)
  })

  it('leaves a name nobody on the roster can be alone', () => {
    expect(canonicalFeedName('Mookie Wilson', ROSTER)).toBe('Mookie Wilson')
    expect(matchFeedName('Mookie Wilson', ROSTER)).toEqual([])
  })

  it('refuses to choose between two people it fits', () => {
    // "Adelaide F" is a prefix of Frank and one edit from nothing else, but the surname rule
    // does not fire twice: the real ambiguity is a shared given name with a surname the feed
    // truncated. Either way the answer must be the feed's own spelling, never a coin toss.
    expect(matchFeedName('Adelaide', ROSTER)).toEqual([])
    const both = matchFeedName('Angela Valenzuela', [
      { name: 'Angela Valenzuela', team: 'NY' }, { name: 'Angela Valenzuela', team: 'LA' },
    ])
    expect(both).toHaveLength(2)
    expect(canonicalFeedName('Angela Valenzuela', both)).toBe('Angela Valenzuela')
  })

  it('never lets a near match beat an exact one', () => {
    // Alexia Jorge is on the roster and "Alexi Jorge" prefixes her. If a real Alexi Jorge ever
    // signs, the exact row must win outright rather than join a two-way tie that resolves to
    // nobody and strips the picture off BOTH of them.
    const withBoth = [...ROSTER, { name: 'Alexi Jorge' }]
    expect(matchFeedName('Alexi Jorge', withBoth)).toEqual([{ name: 'Alexi Jorge' }])
    expect(canonicalFeedName('Alexia Jorge', withBoth)).toBe('Alexia Jorge')
  })

  it('does not match on a surname alone', () => {
    // One token is a surname, an initial or a fragment, and the prefix rule would make any of
    // those match half the league.
    expect(matchFeedName('Whitmore', ROSTER)).toEqual([])
    expect(matchFeedName('', ROSTER)).toEqual([])
  })
})
