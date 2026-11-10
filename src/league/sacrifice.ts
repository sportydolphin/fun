// WHAT THE PLAY LOG CALLS A SACRIFICE BUNT, AND A BUNT.
//
// The feed's `sacrifice` event is a sacrifice FLY and nothing else: all 35 of 2026's match the box
// scores' SF. A sacrifice bunt is filed under how the batter was retired (`groundout`, or `unknown`
// when the batter reached on an error) with "SAC" in capitals in the text, and that word is the whole
// of the evidence: 3 of 2026's 10 never say "bunt" ("grounded out to 3b, SAC"). Read off "bunt"
// alone, those three were lost from every bunt count, and three readers that each had their own rule
// disagreed with the box scores: a club's half-inning counted a sacrifice fly as a bunt and a bunt
// as an at-bat, batter vs pitcher counted a bunt as an at-bat, and the wOBA baseline counted one as
// an ordinary out. Read both here so they cannot drift apart again.
//
// No imports, and imported with its `.ts` by modules Deno loads as well.

type PlayText = { event_type?: string | null; narrative?: string | null }

/** A sacrifice bunt: "SAC" in capitals, on anything but the sac fly's own event. */
export function isSacBunt(p: PlayText): boolean {
  return p.event_type !== 'sacrifice' && /\bSAC\b/.test(p.narrative ?? '')
}

/** Any bunt: a sacrifice, a bunt hit, a bunt out or a fielder's choice on one. */
export function isBunt(p: PlayText): boolean {
  return /\bbunt/i.test(p.narrative ?? '') || isSacBunt(p)
}
