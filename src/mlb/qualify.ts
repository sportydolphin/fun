// MLB's qualifying bar for a rate title, one definition. Was a literal 3.1 in four files (the
// leaderboards, the Stats table, the player card's ranks) until Oct 9, 2026, when the glossary
// started quoting it: a rule stated in prose has to be the number the boards apply, and two copies
// of a constant are how they stop being.

/** Plate appearances per team game for a batting title. */
export const MLB_QUALIFY_PA_PER_GAME = 3.1
/** Innings pitched per team game for an ERA title. */
export const MLB_QUALIFY_IP_PER_GAME = 1

// A fielding title's bar, Rule 9.22(c): a catcher in half the club's games, any other fielder at the
// position in two thirds of them, and a pitcher an inning per club game. The table qualifies each
// position row on its own, so a player can qualify at one position and not at the other.
/** Games at catcher per team game. */
export const MLB_QUALIFY_C_GAMES_PER_GAME = 1 / 2
/** Games at the position per team game, for every fielder but a catcher or a pitcher. */
export const MLB_QUALIFY_FIELD_GAMES_PER_GAME = 2 / 3
