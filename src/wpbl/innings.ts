// Innings-pitched conversions, plus how many innings a game actually played.
// Their own module because the recap engine
// (derive/recap.ts) needs outsToIp, and everything that engine touches has to be loadable
// OUTSIDE the app bundle — the Discord recap poster in scripts/ builds the same recap the
// app shows. constants.ts can't be that home: it imports the team logos as assets, which
// only Vite can resolve. constants.ts re-exports both, so existing callers are unaffected.

/**
 * Regulation, and the one place that says so.
 *
 * It was written out three times: the default below, the gate on the run-expectancy walk, and
 * the inning after which a game can end (gameOver.ts). Each of those reads perfectly on its
 * own, which is why a league that changed its game length would be found by none of them: the
 * table would keep measuring seven-inning half-innings, the end-of-game rule would keep
 * calling games one inning early, and both would look right. Same argument as ERA_BASIS_CANONICAL.
 *
 * Here rather than in constants.ts because the Deno ingest loads this module and cannot load
 * that one (it imports the team logos as Vite assets); see the note at the top of this file.
 */
export const REGULATION_INNINGS = 7

// Innings pitched (stored as outs) → the familiar "5.2" display.
export function outsToIp(outs: number): string {
  return `${Math.floor(outs / 3)}.${outs % 3}`
}

// The inverse: parse an IP entry ("5.2" = 5 innings + 2 outs) into total outs.
// Accepts "5", "5.0", "5.1", "5.2"; clamps an invalid fraction (.3+) down to .2.
export function ipToOuts(ip: string): number {
  const t = ip.trim()
  if (!t) return 0
  const [wholeStr, fracStr] = t.split('.')
  const whole = parseInt(wholeStr || '0', 10) || 0
  let frac = fracStr ? parseInt(fracStr, 10) || 0 : 0
  if (frac > 2) frac = 2
  return whole * 3 + frac
}

// ─── How many innings a game actually played ──────────────────────────────────
// The feed pads a finished game's line score with a trailing entry for a half-inning that
// was never played, and reports the inflated count in its own status ("Final - 8 innings").
// It happens when a post-game roster line — a defensive substitution, sometimes nothing but
// "<player> to cf." — gets stamped with the next inning's number; two of the league's first
// twelve finals arrived that way, each rendering a phantom 0-0 eighth on the line score.
//
// Extras are the tell. A game only reaches an inning past regulation from a tie, so a
// post-regulation inning whose preceding inning left somebody ahead cannot have been played.
// Trailing innings are peeled off one at a time, which also unwinds a run of them. Innings
// at or below regulation are always kept: the away team bats the top of the last inning even
// in a rout, so a quiet final frame there is real.
export function playedInnings(
  away: WpblLineScoreLike[] | null | undefined,
  home: WpblLineScoreLike[] | null | undefined,
  regulation = REGULATION_INNINGS,
): number {
  const through = (line: WpblLineScoreLike[] | null | undefined, n: number) =>
    (line ?? []).reduce((t, c) => (c.inning <= n ? t + c.runs : t), 0)
  let last = Math.max(0, ...(away ?? []).map(e => e.inning), ...(home ?? []).map(e => e.inning))
  while (last > regulation && through(away, last - 1) !== through(home, last - 1)) last--
  return last
}

// Structurally what WpblLineScoreEntry is; declared here so this module stays importable
// on its own (see the note up top) without reaching for the app's type barrel.
export interface WpblLineScoreLike { inning: number; runs: number }
