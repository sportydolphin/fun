// The parts of a player's card the search can open it at: "Ohtani splits", "Whitmore game log".
//
// The search reads the words (src/league/finderParse.ts, `typedPart`), the section asks for the
// scroll as it opens the player (lib/sectionScroll.ts), and each card puts the anchor on the
// heading of that part. Each section lists only the parts its card draws, so a part one card lacks
// ("splits" on WPBL, which has none) opens the player at the top rather than asking for a scroll
// that waits for an element that never comes.

import { sectionAnchorId } from './sectionScroll'

export type PlayerPart = 'log' | 'splits' | 'pitches' | 'advanced' | 'fielding' | 'contract' | 'spray' | 'matchups'

export const MLB_PLAYER_PARTS: ReadonlySet<PlayerPart> = new Set(['log', 'splits', 'pitches', 'advanced', 'fielding', 'contract'])
export const WPBL_PLAYER_PARTS: ReadonlySet<PlayerPart> = new Set(['log', 'pitches', 'fielding', 'spray', 'matchups'])

/** The scroll request's name for a part, `player-log`. */
export const playerPartKey = (part: PlayerPart): string => `player-${part}`

/** The element id the card's heading for the part carries. */
export const playerPartAnchor = (part: PlayerPart): string => sectionAnchorId(playerPartKey(part))

/** How a palette row says where the player will open. */
export const PLAYER_PART_LABEL: Record<PlayerPart, string> = {
  log: 'game log', splits: 'splits', pitches: 'pitch mix', advanced: 'advanced stats',
  fielding: 'fielding', contract: 'contract', spray: 'hit locations', matchups: 'matchups',
}
