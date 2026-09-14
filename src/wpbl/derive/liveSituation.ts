// The live-situation derivation, pure and asset-free so it can run outside the app bundle.
//
// It used to live inside Live.tsx, which imports MUI, so the only reader was the app. The
// Discord `/live` box score (functions/discord/wpbl.ts → src/wpbl/discordLiveBox.ts) needs the
// exact same reading of the feed's `status` object, and pulling Live.tsx into a Cloudflare
// Functions bundle is not possible: it drags React and MUI in. Extracted here so both surfaces
// derive the count clamp and the between-innings break from ONE definition rather than a second
// copy that drifts. Live.tsx re-exports everything below, so its own callers are unchanged.
//
// No .ts on the type imports because nothing here is loaded by Deno; the app (Vite) and the
// Cloudflare esbuild bundle both resolve extensionless specifiers.
import type { WpblTeam, WpblLineScoreEntry, WpblLiveState } from '../types'

export interface Situation {
  half: 'top' | 'bottom'; inning: number; outs: number; balls: number; strikes: number
  battingTeam: WpblTeam; batterName: string | null; pitcherName: string | null
  first: boolean; second: boolean; third: boolean
  /** WHO is on each base, which is what the feed actually sends: `first_base` is a runner's
   *  name ("Val Perez") and an empty string when the base is empty, not a flag. The booleans
   *  above are that name emptied out, which is all a 34px glyph can use and all this carried
   *  until the Live tab had room to name them. Null where the base is empty, and also where
   *  the feed marks a base occupied without saying by whom, so a consumer has to handle a
   *  nameless runner rather than assume the pair move together. */
  firstName: string | null; secondName: string | null; thirdName: string | null
  /** The side is retired and the next one has not come to bat. */
  between: boolean
  /** What to call that gap: "Middle of the 4th" once the top is over, "End of the 4th"
   *  once the bottom is. Null while a half-inning is actually being played. */
  breakLabel: string | null
}

export const ORDINAL = (n: number): string => {
  const rest = n % 100
  if (rest >= 11 && rest <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
}

/**
 * Is the game sitting between half-innings?
 *
 * Worth having because the strip has no honest reading of the break otherwise. The feed sends
 * one situation object and keeps serving the last one it built until something moves, so the
 * count, the outs, the runners and the batter it carries during the gap describe an at-bat
 * that has already finished. Drawn literally they say a game is being played.
 *
 * HOW THE BREAK IS FOUND, AND WHY IT IS NOT THE OBVIOUS WAY. The MLB feed hands over an
 * `inningState` of "Middle" or "End" and src/mlb reads it straight. This one has no such
 * field, and it has none of the substitutes either. Watched through the top of the 4th on
 * 2026-08-20 it went:
 *
 *   17:42:42  In Progress - Top of 4th     top 4   2 out  0-0  Denae Benites
 *   17:43:13  In Progress - Bottom of 4th  bottom 4  0 out  0-0  Suzuka Yamamoto
 *
 * The third out and the flip to the next half arrive in the SAME update. There is no state
 * in which the feed reports three outs, no state in which it blanks `half`, and the status
 * string only ever reads "Top of"/"Bottom of", never "Middle of"/"End of". Every signal the
 * MLB side keys on is absent, and anything built on them would simply never fire.
 *
 * What the feed does instead is announce the next half-inning the moment the last one ends
 * and then sit on it, untouched, for the length of the break: that 17:43:13 state held until
 * 17:45:55, two minutes and forty-two seconds, when the first pitch of the bottom of the 4th
 * finally registered. So the break is not a state the feed names, it is a state the feed
 * leaves EMPTY: the next half-inning is on the board and nothing has happened in it yet.
 *
 * That is what this tests for. Nobody out, no count, nobody on base, and no runs in the
 * batting side's line for the inning.
 *
 * The runs check is what makes the rest of it airtight rather than nearly right. Empty bases
 * with nobody out normally does mean nobody has batted, because every runner who leaves the
 * bases without scoring costs an out. The exception is the leadoff home run, which puts the
 * next batter up on a 0-0 count with the bases clear and no outs, and which without this
 * check would read as a break for as long as it took the next pitch to land.
 */
export function betweenInnings(state: WpblLiveState, lines?: LineScores): boolean {
  if (state.complete) return false
  const half = state.half === 'bottom' ? 'bottom' : state.half === 'top' ? 'top' : null
  if (!half) return false
  const inning = state.inning || 0
  // The top of the 1st with nothing in it is not a break, it is a game that has not started.
  // The ingest only calls a game live once something has actually happened, so this is
  // belt-and-braces, but the label for it would be "End of the 0th".
  if (inning < 1 || (inning === 1 && half === 'top')) return false
  if ((state.outs || 0) !== 0 || (state.balls || 0) !== 0 || (state.strikes || 0) !== 0) return false
  if (state.first_base || state.second_base || state.third_base) return false
  const line = (half === 'top' ? lines?.away : lines?.home) ?? []
  return !line.some(e => e.inning === inning && e.runs > 0)
}

export interface LineScores { away?: WpblLineScoreEntry[] | null; home?: WpblLineScoreEntry[] | null }

/**
 * What to call the break, which is the half-inning BEHIND the one the feed is showing.
 *
 * The feed has already moved the board on to what comes next, so the naming inverts: sitting
 * on an untouched bottom of the 4th means the top of the 4th is what just finished, which is
 * the middle of the 4th. Sitting on an untouched top of the 5th means the bottom of the 4th
 * finished, which is the end of the 4th.
 */
function breakLabelFor(half: 'top' | 'bottom', inning: number): string {
  return half === 'bottom'
    ? `Middle of the ${ORDINAL(inning)}`
    : `End of the ${ORDINAL(inning - 1)}`
}

export function deriveSituation(state: WpblLiveState, away: WpblTeam, home: WpblTeam, lines?: LineScores): Situation {
  // A blank half cannot be read as 'top' the way this used to read it: that named the away
  // team as batting whenever the feed left the half out. Fall back to the batting side the
  // feed names instead, and only then to the top of the inning.
  const half: 'top' | 'bottom' =
    state.half === 'bottom' ? 'bottom'
    : state.half === 'top' ? 'top'
    : state.batting_team_id && state.batting_team_id === home.id ? 'bottom'
    : 'top'
  const between = betweenInnings(state, lines)
  return {
    half, inning: state.inning || 1, outs: state.outs || 0,
    // CLAMPED HERE, once, so nothing drawing a count can print one that cannot exist. The feed
    // publishes the PREVIOUS at-bat's full count between batters (watched on Sep 5, 2026: balls
    // 3, strikes 3 on a batter with nobody out), and the stored plays carry the same shape,
    // with the terminal pitch counted: 557 of them hold balls 4 or strikes 3. The bulbs in
    // LiveGameView clamp their own input and always did; the 34-character strip printed
    // "3–3" for months, which is a fourth ball and a third strike sitting on screen.
    balls: Math.min(state.balls || 0, 3), strikes: Math.min(state.strikes || 0, 2),
    battingTeam: half === 'top' ? away : home,
    batterName: state.batter_name || null, pitcherName: state.pitcher_name || null,
    first: !!state.first_base, second: !!state.second_base, third: !!state.third_base,
    // Trimmed, and the flags above deliberately are NOT: the flag is whether the base is
    // occupied and the name is who is standing on it, and a value of " " answers the first
    // question yes and the second one not at all. Left untrimmed the consumer renders a space
    // where a name goes, which is a blank row rather than a fallback.
    firstName: state.first_base?.trim() || null,
    secondName: state.second_base?.trim() || null,
    thirdName: state.third_base?.trim() || null,
    between,
    breakLabel: between ? breakLabelFor(half, state.inning || 1) : null,
  }
}
