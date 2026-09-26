import type { WpblPlayer, WpblBattingLine, WpblPitchingLine, WpblFieldingLine, WpblGame, WpblTeam } from './types'
import { countsInStandings, scopedLines, isPostseasonGame,
  type WpblSeasonGame, type SeasonScope } from './season'

// EVERY aggregate here takes the schedule, and it is not optional.
//
// A box-score line carries a `game_id` and nothing else about the game, so it cannot say for
// itself whether it belongs in a season total. Without a schedule to filter by, the first
// semifinal box score silently changes every season number on the site: the Stats tab, the
// home leaders, team and player pages, the draft-value model, the Discord /player card and the
// OG images on shared links. Unevenly, too, since a finalist's hitter gains up to eight extra
// games and a team swept in the semis gains two, so the leaderboards would reorder by how far a
// club went rather than by how anyone played.
//
// `games` is REQUIRED rather than defaulted for that reason: an optional argument makes
// forgetting it silent, and silence is the entire failure mode here. Pass the schedule you
// already hold. The filtering itself fails open (see season.ts), so a partial schedule
// over-counts rather than blanking the page.

// ─── The innings basis for ERA and K/9 ────────────────────────────────────────
//
// A WPBL game is seven innings, so the honest per-game rate is per 7, which is what every
// other seven-inning competition publishes: NCAA and NAIA softball, Athletes Unlimited, and
// high school baseball on MaxPreps all scale to their own game length, and Little League
// scales to 6.
//
// **The league publishes per 7 as well, and agreeing with the league is the rule.** A site
// showing 2.58 against an official 3.32 for the same arm looks broken rather than better, so
// what is stored follows womensprobaseballleague.com's own basis. Verified against its stat
// page on Sep 3, 2026 rather than assumed: all 38 pitchers and all 4 clubs matched per 7, and
// only the two 0.00 lines were also consistent with per 9 (Kelsie Whitmore, 18 ER in 24.0 IP,
// printed as 5.25, which is only per 7; per 9 is 6.75).
//
// So: STORED PER 7, ALWAYS, everywhere, including the OG share cards and the Discord bot, which
// are read next to league numbers by people who did not choose anything. A reader who prefers
// per 9 flips one setting and the app rescales at DISPLAY time (`scaleToBasis`), because both
// stats are linear in the multiplier and nothing that sorts, ranks or compares can move when
// they are rescaled together. Do not reintroduce a second basis into an aggregate: the moment
// two functions each hold their own, a leaderboard and the player page it opens can disagree
// and neither is wrong. That hazard is unchanged by which number is canonical.
//
// THE ONE THING TO CHECK IF THIS EVER LOOKS WRONG is the league's own stat page, because
// nothing we run can see this. The drift checker compares plays against the feed, and the feed
// publishes WHIP but no ERA at all, so a change of denominator on their side is invisible to
// every check here.
export type EraBasis = 7 | 9

/** What `era` and `k9` are stored on, and what the league itself publishes. Not a setting:
 *  see above. Changing this one number changes both the computation (`summarisePitching`
 *  multiplies by it) and the rescale (`scaleToBasis` divides by it), which is why a change of
 *  basis is a single line rather than a sweep. */
export const ERA_BASIS_CANONICAL: EraBasis = 7

/** The heading a strikeout-rate column carries, which moves with the basis. ERA and WHIP
 *  keep their names: only this one spells its denominator out loud. */
export const kRateLabel = (basis: EraBasis): string => `K/${basis}`

/** Rescale a stored canonical-basis rate to what the reader asked to see. Null passes through. */
export function scaleToBasis(v: number | null, basis: EraBasis): number | null {
  return v == null ? null : (v * basis) / ERA_BASIS_CANONICAL
}

// Season stat aggregation from box-score lines. Rates are null when the denominator
// is zero (no AB / no IP) so the UI can show a dash instead of NaN.

export interface WpblBattingTotals {
  g: number; ab: number; r: number; h: number; doubles: number; triples: number; hr: number
  rbi: number; bb: number; so: number; sb: number; hbp: number; cs: number; sf: number
  /** Sac hits (bunts). Carried so `plateAppearances` can be right, and shown beside SF on the
   *  board. It is not in OBP's denominator and must not be added to one. */
  sh: number
  /** Grounded into a double play. */
  gdp: number
  tb: number
  /** Extra-base hits: doubles, triples and home runs. */
  xbh: number
  /** Intentional walks. Already counted inside `bb`; carried so the board can say how many. */
  ibb: number
  avg: number | null; obp: number | null; slg: number | null; ops: number | null
  /** Isolated power, SLG minus AVG: extra bases per at-bat, so a singles hitter reads near zero. */
  iso: number | null
  /** Batting average on balls in play. Mostly luck and speed over a season this short, which is
   *  the point of showing it: a .450 BABIP says the average above it will not hold. */
  babip: number | null
  /** Strikeouts and walks per PLATE APPEARANCE, via `plateAppearances`, the same denominator
   *  the percentile strip's K% uses so the two cannot disagree. */
  kPct: number | null
  bbPct: number | null
  /** Steals over attempts. Null with no attempt, rather than 0%, which would read as a failure. */
  sbPct: number | null
  /**
   * Runners left on base, **team rows only**, filled in by the caller from the game row.
   * Always null here; see the note in `sumBatting`.
   */
  lob: number | null
}

export function sumBatting(lines: WpblBattingLine[], games: WpblSeasonGame[], scope: SeasonScope = 'regular'): WpblBattingTotals {
  return sumBattingRaw(scopedLines(lines, games, scope))
}

/** The arithmetic alone, on lines already known to be in scope. Internal, so the grouping
 *  helpers below can filter once for the whole league instead of once per player. */
function sumBattingRaw(lines: WpblBattingLine[]): WpblBattingTotals {
  const t = { g: lines.length, ab: 0, r: 0, h: 0, doubles: 0, triples: 0, hr: 0, rbi: 0, bb: 0, so: 0, sb: 0, hbp: 0, cs: 0, sf: 0, sh: 0, gdp: 0, ibb: 0 }
  for (const l of lines) {
    t.ab += l.ab; t.r += l.r; t.h += l.h; t.doubles += l.doubles; t.triples += l.triples; t.hr += l.hr
    t.rbi += l.rbi; t.bb += l.bb; t.so += l.so; t.sb += l.sb; t.hbp += l.hbp; t.cs += l.cs
    t.sf += l.sf; t.sh += l.sh; t.gdp += l.gdp ?? 0; t.ibb += l.ibb ?? 0
  }
  const singles = t.h - t.doubles - t.triples - t.hr
  const tb = singles + 2 * t.doubles + 3 * t.triples + 4 * t.hr
  const obDen = t.ab + t.bb + t.hbp + t.sf // now that the feed reports sac flies
  const avg = t.ab > 0 ? t.h / t.ab : null
  const obp = obDen > 0 ? (t.h + t.bb + t.hbp) / obDen : null
  const slg = t.ab > 0 ? tb / t.ab : null
  const ops = obp != null && slg != null ? obp + slg : null
  const iso = avg != null && slg != null ? slg - avg : null
  // SF stays in the denominator (a fly ball caught is a ball in play) and SH stays out, the
  // standard definition; a bunt is a sacrifice rather than an attempt to reach.
  const bip = t.ab - t.so - t.hr + t.sf
  const babip = bip > 0 ? (t.h - t.hr) / bip : null
  const pa = plateAppearances(t)
  const kPct = pa > 0 ? t.so / pa : null
  const bbPct = pa > 0 ? t.bb / pa : null
  const sbPct = t.sb + t.cs > 0 ? t.sb / (t.sb + t.cs) : null
  // LOB is deliberately null and never summed from the lines. Two reasons: the feed sends a
  // per-player `lob` but has never populated it (every row in the table is 0), and even a
  // populated one wouldn't add up to the team's LOB: individual LOB charges the same stranded
  // runner to every batter who came up while that runner was aboard, so the sum overcounts.
  // The team number lives on wpbl_games (home_lob/away_lob); StatsView fills it in there.
  return { ...t, tb, xbh: t.doubles + t.triples + t.hr, avg, obp, slg, ops, iso, babip, kPct, bbPct, sbPct, lob: null }
}

// ─── Fielding ──────────────────────────────────────────────────────────────────
export interface WpblFieldingTotals {
  g: number; po: number; a: number; e: number; pb: number; sba: number; dp: number
  fpct: number | null   // fielding %: (PO + A) / (PO + A + E)
}

// Scoped like `sumBatting` / `sumPitching`, and for the same reason: a fielding line carries a
// `game_id` and nothing else about the game, so without the schedule a semifinal's putouts and
// errors fold straight into the season line. This was the one summary left unscoped, so a
// finalist's fielding on her player page counted her postseason while her batting and pitching
// beside it did not. `games` is REQUIRED to keep forgetting it from being silent.
export function sumFielding(lines: WpblFieldingLine[], games: WpblSeasonGame[], scope: SeasonScope = 'regular'): WpblFieldingTotals {
  const scoped = scopedLines(lines, games, scope)
  const t = { g: scoped.length, po: 0, a: 0, e: 0, pb: 0, sba: 0, dp: 0 }
  for (const l of scoped) {
    t.po += l.po; t.a += l.a; t.e += l.e; t.pb += l.pb; t.sba += l.sba; t.dp += l.dp
  }
  const chances = t.po + t.a + t.e
  const fpct = chances > 0 ? (t.po + t.a) / chances : null
  return { ...t, fpct }
}

export interface WpblPitchingTotals {
  g: number; outs: number; h: number; r: number; er: number; bb: number; so: number; hr: number
  w: number; l: number; s: number
  /** All five arrive on every pitching line and are summed so the boards can say how much work
   *  an outing was, not only what it gave up. `gs` separates a starter from a reliever, which
   *  nothing else here does. */
  bf: number; pitches: number; strikes: number; gs: number; hbp: number; wp: number; bk: number
  /** Share of pitches thrown for strikes. The one rate the pitch counts make possible, and
   *  the closest thing to a command number the box score can give. Null before a pitch. */
  strikePct: number | null
  /** Earned runs per NINE innings, always, whatever the reader has the site set to. See
   *  `ERA_BASIS_CANONICAL`: everything downstream scales this one number, so there is exactly
   *  one place a per-7 figure can come from and no way for two surfaces to disagree. */
  era: number | null
  whip: number | null
  /** Strikeouts per `ERA_BASIS_CANONICAL` innings, canonical for the same reason `era` is.
   *  The field name is historical and does not mean per 9. Renaming it would touch the stats
   *  board, the percentile strip, the share cards and the Discord card for no gain, since every
   *  label a reader sees comes from `kRateLabel(basis)` and already moves on its own. */
  k9: number | null
  /** Strikeout-to-walk ratio. Null when nobody has walked, since the ratio has no value. */
  kbb: number | null
  /** Per batter faced, not per inning: a pitcher behind a poor defence faces more batters per
   *  inning, which inflates K/7 without the pitcher doing anything better. */
  kPct: number | null
  bbPct: number | null
  kbbPct: number | null
  /** Home runs per `ERA_BASIS_CANONICAL` innings, stored like `k9` and for the same reason: the
   *  display scales it to the reader's basis. There is deliberately no walks-per-inning twin:
   *  `bbPct` measures the same thing without charging a pitcher for the extra batters that hits
   *  allowed bring to the plate. */
  hr9: number | null
  /** BABIP against. Slightly low: the pitching line has no SF or SH, so those sit in the
   *  denominator as if they were balls in play that became outs. */
  babip: number | null
}

export function sumPitching(lines: WpblPitchingLine[], games: WpblSeasonGame[], scope: SeasonScope = 'regular'): WpblPitchingTotals {
  return sumPitchingRaw(scopedLines(lines, games, scope))
}

/** The arithmetic alone; see `sumBattingRaw`. */
function sumPitchingRaw(lines: WpblPitchingLine[]): WpblPitchingTotals {
  const t = { g: lines.length, outs: 0, h: 0, r: 0, er: 0, bb: 0, so: 0, hr: 0, w: 0, l: 0, s: 0, bf: 0, pitches: 0, strikes: 0, gs: 0, hbp: 0, wp: 0, bk: 0 }
  for (const l of lines) {
    t.outs += l.outs; t.h += l.h; t.r += l.r; t.er += l.er; t.bb += l.bb; t.so += l.so; t.hr += l.hr
    // Nullish-coalesced, unlike the fields above: these are newer columns on the feed's line
    // and an older mirrored row can carry null where a fresh one carries 0.
    t.bf += l.bf ?? 0; t.pitches += l.pitches ?? 0; t.strikes += l.strikes ?? 0
    t.gs += l.gs ?? 0; t.hbp += l.hbp ?? 0; t.wp += l.wp ?? 0; t.bk += l.bk ?? 0
    if (l.decision === 'W') t.w++
    else if (l.decision === 'L') t.l++
    else if (l.decision === 'S') t.s++
  }
  const ip = t.outs / 3
  // Per NINE, which is not the length of a WPBL game. See ERA_BASIS_CANONICAL for why the
  // stored number is the league's basis rather than the honest one.
  const era = ip > 0 ? (t.er * ERA_BASIS_CANONICAL) / ip : null
  const whip = ip > 0 ? (t.bb + t.h) / ip : null
  const k9 = ip > 0 ? (t.so * ERA_BASIS_CANONICAL) / ip : null
  // Null, not Infinity, on a staff that hasn't issued a walk: the ratio genuinely doesn't
  // exist, and fmtTwo renders null as the no-value dash rather than a nonsense number.
  const kbb = t.bb > 0 ? t.so / t.bb : null
  const strikePct = t.pitches > 0 ? t.strikes / t.pitches : null
  const kPct = t.bf > 0 ? t.so / t.bf : null
  const bbPct = t.bf > 0 ? t.bb / t.bf : null
  const kbbPct = kPct != null && bbPct != null ? kPct - bbPct : null
  const hr9 = ip > 0 ? (t.hr * ERA_BASIS_CANONICAL) / ip : null
  const bip = t.bf - t.bb - t.hbp - t.so - t.hr
  const babip = bip > 0 ? (t.h - t.hr) / bip : null
  return { ...t, era, whip, k9, kbb, strikePct, kPct, bbPct, kbbPct, hr9, babip }
}

// ─── FIP ───────────────────────────────────────────────────────────────────────
// Fielding independent pitching: ERA rebuilt from the three outcomes no fielder touches, so it
// separates a pitcher from the defence and the luck behind them.

/** Runs each fielding-independent outcome is worth against an average ball in play. Weighted
 *  in RUNS PER EVENT, not the familiar 13/3/2: those are MLB's run values multiplied by nine
 *  so the formula reads per nine innings, which is both the wrong run environment and the
 *  wrong basis here. `fipWeights` in derive/linearWeights.ts measures these from the league's
 *  own plays. MLB's, for comparison, are 13/9, 3/9 and -2/9. */
export interface FipWeights { hr: number; bb: number; k: number }

// Multiplying by the canonical basis puts FIP on the same basis as the stored ERA and keeps it
// linear in the basis, which is what lets `scaleToBasis` rescale it for display exactly as it
// does ERA.
function fipCore(t: Pick<WpblPitchingTotals, 'hr' | 'bb' | 'hbp' | 'so' | 'outs'>, w: FipWeights): number | null {
  const ip = t.outs / 3
  return ip > 0 ? ((w.hr * t.hr + w.bb * (t.bb + t.hbp) + w.k * t.so) / ip) * ERA_BASIS_CANONICAL : null
}

/** The constant that makes the league's FIP equal the league's ERA. Built from the same slice
 *  as the rows it is applied to, or a playoff FIP is centred on a regular season it is not
 *  being compared with. Null before an inning is pitched or before the weights exist. */
export function fipConstant(league: WpblPitchingTotals, w: FipWeights | null): number | null {
  const core = w ? fipCore(league, w) : null
  return core != null && league.era != null ? league.era - core : null
}

/** FIP on the canonical basis. Null without innings, weights, or a league to centre it on. */
export function fip(t: WpblPitchingTotals, w: FipWeights | null, constant: number | null): number | null {
  const core = w ? fipCore(t, w) : null
  return core != null && constant != null ? core + constant : null
}

/** Trips to the plate: the honest measure of how much someone has played, and the unit
 *  every rate qualifier below is set in. AB throws away walks, and G counts a pinch-hitter's
 *  one swing as a full day.
 *
 *  Summed the way OBP's denominator is (see `sumBatting`) plus sac hits, which OBP leaves
 *  out on purpose and playing time does not. Exported so no call site derives its own copy:
 *  a copy taken from OBP's denominator drops `sh`, which the feed does report. */
export function plateAppearances(t: Pick<WpblBattingTotals, 'ab' | 'bb' | 'hbp' | 'sf' | 'sh'>): number {
  return t.ab + t.bb + t.hbp + t.sf + t.sh
}

/** Did this line, or these totals, represent an actual trip to the plate?
 *
 *  A pitcher is listed in the box score of every game they pitch, with an all-zero batting
 *  line, and a position player can enter a game only to run or field. Those rows are
 *  appearances, not games batted, so a surface that sums them straight reads "8 G, 0 PA" for
 *  someone who never came up, or draws a full batting card of dashes for two pitchers. Filter
 *  batting lines through this before summing them into a batting line a reader will see. One
 *  definition so the player page and the compare card cannot disagree about who batted. */
export function hasPlateAppearance(l: Pick<WpblBattingTotals, 'ab' | 'bb' | 'hbp' | 'sf' | 'sh'>): boolean {
  return plateAppearances(l) > 0
}

// ─── Rate-stat qualifiers ──────────────────────────────────────────────────────
// A fixed threshold (a flat 5 AB / 3 IP, say) stops meaning anything the moment the
// season moves past its first week: five games in, 5 AB is one game's work, so the OPS
// board fills with 4-for-5 cameos and the ERA board with three relievers tied at 0.00.
// So the bar SCALES with how far the season has actually gone, the way a real rate title
// does: MLB requires 3.1 PA per team game and 1 IP per team game.
//
// Both of ours are that rule with the one honest adjustment applied, 7 innings instead of 9.
// 3.1 x 7/9 = 2.41 PA, and 1.0 x 7/9 = 0.78 IP, rounded to 0.8. The check on the batting
// number is that it is the same share of full-time play MLB's is: a team gets roughly 30
// plate appearances in a 7-inning game, so one lineup slot is worth about 3.3 a game, and
// 2.4 is 73% of that, which is what 3.1 is of a nine-inning slot's 4.2.
//
// THE BATTING BAR IS PLATE APPEARANCES, NOT AT-BATS, and the unit is the whole point. AB
// discards every walk, so gating OPS (half of which is OBP) on it charges a patient hitter
// for the thing the stat exists to reward: 40 AB with 18 BB is more playing time than 55 AB
// with none, and an AB bar would qualify only the second. Both bars are in MLB's own units.
//
// The floors keep the opening days sane, and we scale off the LEAST-played team so a club
// with a game in hand can't push its own players below the line.
export const QUALIFY_MIN_GAMES = 2      // every team must have played this many before the bar applies
// The two 2.4s below are a coincidence and must not be folded into one constant: one is
// plate appearances per team game, the other is OUTS per team game (0.8 IP).
export const QUALIFY_PA_PER_GAME = 2.4  // MLB's 3.1 per team game, scaled to a 7-inning game
export const QUALIFY_OUTS_PER_GAME = 2.4 // 0.8 IP per team game (MLB's 1.0, scaled the same way)
export const QUALIFY_FLOOR_PA = 6
export const QUALIFY_FLOOR_OUTS = 9     // 3 IP

export interface WpblQualifiers {
  active: boolean    // whether to apply the bar at all
  teamGames: number  // games played by the least-played team
  minPa: number      // plate appearances needed for a batting rate title
  minOuts: number    // outs recorded needed for a pitching rate title
}

/** Regular-season games played (finals only) per team id.
 *
 *  Postseason games come out here too, and not just for tidiness: the qualifier thresholds
 *  scale off this number, so counting playoff games would raise the bar for a rate title in
 *  the middle of the postseason and quietly drop players off leaderboards they had already
 *  qualified for. */
function gamesPlayed(games: WpblGame[], scope: SeasonScope = 'regular'): Map<string, number> {
  const played = new Map<string, number>()
  for (const g of games) {
    if (g.status !== 'final') continue
    // THE DENOMINATOR HAS TO MOVE WITH THE NUMERATOR. On the postseason slice the bar has to
    // scale off postseason games, or a hitter needs a regular season's worth of plate
    // appearances to qualify for a rate title in a three-game series and the board is empty.
    if (scope === 'regular' && !countsInStandings(g)) continue
    if (scope === 'postseason' && !isPostseasonGame(g)) continue
    played.set(g.home_team_id, (played.get(g.home_team_id) ?? 0) + 1)
    played.set(g.away_team_id, (played.get(g.away_team_id) ?? 0) + 1)
  }
  return played
}

export function wpblQualifiers(teams: WpblTeam[], games: WpblGame[], scope: SeasonScope = 'regular'): WpblQualifiers {
  const inactive = { active: false, teamGames: 0, minPa: 0, minOuts: 0 }
  if (teams.length === 0) return inactive
  const played = gamesPlayed(games, scope)
  const teamGames = Math.min(...teams.map(t => played.get(t.id) ?? 0))
  if (teamGames < QUALIFY_MIN_GAMES) return inactive
  return {
    active: true,
    teamGames,
    minPa: Math.max(QUALIFY_FLOOR_PA, Math.round(QUALIFY_PA_PER_GAME * teamGames)),
    minOuts: Math.max(QUALIFY_FLOOR_OUTS, Math.round(QUALIFY_OUTS_PER_GAME * teamGames)),
  }
}

/** Back-compat shorthand for callers that only need the on/off flag. */
export function qualifiersActive(teams: WpblTeam[], games: WpblGame[]): boolean {
  return wpblQualifiers(teams, games).active
}

// ".278" (leading zero stripped) for AVG/OBP/SLG/OPS; dash when null.
export const fmtRate = (v: number | null): string => (v == null ? '—' : v.toFixed(3).replace(/^0(?=\.)/, ''))
// "3.24" for ERA/WHIP; dash when null.
export const fmtTwo = (v: number | null): string => (v == null ? '—' : v.toFixed(2))
/** A share as a percent to one place, the precision K% and BB% are conventionally quoted at. */
export const fmtPct = (v: number | null): string =>
  // A true minus, as `fmtSigned` uses: K-BB% goes negative for a pitcher who walks more than they strike out.
  v == null ? '—' : `${(v * 100).toFixed(1)}%`.replace(/^-/, '−')

/** A signed run differential: "+26", "\u221217", "0".
 *
 *  The sign is a true minus (U+2212), not a hyphen. Measured, the two have the identical
 *  advance here. The difference is the GLYPH inside it: a hyphen is a short dash centred in
 *  a digit-width slot, so it leaves air on both sides and reads as "- 17" where the plus,
 *  drawn to fill its slot, reads as "+26". U+2212 is the minus built to match the plus. */
export const fmtSigned = (n: number): string => (n > 0 ? `+${n}` : n < 0 ? `\u2212${Math.abs(n)}` : '0')

// ─── League leaders ─────────────────────────────────────────────────────────────
// Group every box-score line by player and total it, attaching the player. One entry
// per player who has logged at least one line; the home view ranks these per stat.

export interface WpblBatSeason { player: WpblPlayer; totals: WpblBattingTotals }
export interface WpblPitSeason { player: WpblPlayer; totals: WpblPitchingTotals }

export function aggregateBatting(players: WpblPlayer[], lines: WpblBattingLine[], games: WpblSeasonGame[], scope: SeasonScope = 'regular'): WpblBatSeason[] {
  const pmap = new Map(players.map(p => [p.id, p]))
  const byPlayer = new Map<string, WpblBattingLine[]>()
  for (const l of scopedLines(lines, games, scope)) {
    const arr = byPlayer.get(l.player_id) ?? []
    arr.push(l); byPlayer.set(l.player_id, arr)
  }
  const out: WpblBatSeason[] = []
  for (const [pid, ls] of byPlayer) {
    const player = pmap.get(pid)
    if (player) out.push({ player, totals: sumBattingRaw(ls) })
  }
  return out
}

export function aggregatePitching(players: WpblPlayer[], lines: WpblPitchingLine[], games: WpblSeasonGame[], scope: SeasonScope = 'regular'): WpblPitSeason[] {
  const pmap = new Map(players.map(p => [p.id, p]))
  const byPlayer = new Map<string, WpblPitchingLine[]>()
  for (const l of scopedLines(lines, games, scope)) {
    const arr = byPlayer.get(l.player_id) ?? []
    arr.push(l); byPlayer.set(l.player_id, arr)
  }
  const out: WpblPitSeason[] = []
  for (const [pid, ls] of byPlayer) {
    const player = pmap.get(pid)
    if (player) out.push({ player, totals: sumPitchingRaw(ls) })
  }
  return out
}

// ─── Team season comparison (game-preview matchup bars) ──────────────────────────
// The WPBL analogue of the MLB app's fetchTeamSeasonStats: each team's season totals,
// ranked against the rest of the league so the game-preview card can draw a diverging
// bar per stat (bar length = position in the league range, always growing toward
// "better", including ERA/WHIP where the lower number wins). Computed client-side from
// the same box-score lines the leaders read, so it needs no extra fetch beyond what Home
// already caches.

export type WpblTeamStatKey = 'avg' | 'obp' | 'slg' | 'ops' | 'rpg' | 'hr' | 'era' | 'whip' | 'k9'

export interface WpblTeamStatValue {
  display: string
  rank: number          // 1 = best in the league; ties share the better rank
  pct: number           // 0 = worst, 1 = best (already direction-aware)
}

export type WpblTeamSeasonStats = Partial<Record<WpblTeamStatKey, WpblTeamStatValue>>

export interface WpblTeamStatDef {
  key: WpblTeamStatKey
  label: string
  group: 'hitting' | 'pitching'
  better: 'high' | 'low'
}

// Render order for the comparison table. The K label below is a PLACEHOLDER and never
// reaches a screen: every consumer swaps it for `kRateLabel(basis)` at render, because the
// denominator moves with the reader's setting.
export const WPBL_TEAM_STAT_DEFS: WpblTeamStatDef[] = [
  { key: 'avg',  label: 'AVG',  group: 'hitting',  better: 'high' },
  { key: 'obp',  label: 'OBP',  group: 'hitting',  better: 'high' },
  { key: 'slg',  label: 'SLG',  group: 'hitting',  better: 'high' },
  { key: 'ops',  label: 'OPS',  group: 'hitting',  better: 'high' },
  { key: 'hr',   label: 'HR',   group: 'hitting',  better: 'high' },
  { key: 'rpg',  label: 'R/G',  group: 'hitting',  better: 'high' },
  { key: 'era',  label: 'ERA',  group: 'pitching', better: 'low'  },
  { key: 'whip', label: 'WHIP', group: 'pitching', better: 'low'  },
  { key: 'k9',   label: 'K/9',  group: 'pitching', better: 'high' },
]

// Per-team, per-stat ranked values for every team that has logged box-score lines. A team
// with no lines yet (opening days) simply isn't in the map, so the preview shows a dash on
// that side. Ranks and bar scales are over the teams that HAVE played, so early in the
// season the comparison is still meaningful between two clubs that have both taken the field.
export function computeWpblTeamStats(
  teams: WpblTeam[],
  games: WpblGame[],
  batting: WpblBattingLine[],
  pitching: WpblPitchingLine[],
  /** What ERA and K/9 are shown on. Defaults to the league's basis, so a caller that has no
   *  reader to ask (a share card, a bot) gets the league's numbers without opting in. */
  basis: EraBasis = ERA_BASIS_CANONICAL,
  /** Which slice of the season. Defaults to regular, so every existing caller is unchanged. */
  scope: SeasonScope = 'regular',
): Map<string, WpblTeamSeasonStats> {
  // Games each team has played IN THIS SLICE, the denominator for R/G. It has to move in step
  // with the numerator, or a finalist's playoff runs end up divided by a regular-season count.
  // Shares the helper above so the two counts cannot drift apart.
  const played = gamesPlayed(games, scope)

  const batByTeam = new Map<string, WpblBattingLine[]>()
  for (const l of scopedLines(batting, games, scope)) {
    if (!l.team_id) continue
    const a = batByTeam.get(l.team_id) ?? []; a.push(l); batByTeam.set(l.team_id, a)
  }
  const pitByTeam = new Map<string, WpblPitchingLine[]>()
  for (const l of scopedLines(pitching, games, scope)) {
    if (!l.team_id) continue
    const a = pitByTeam.get(l.team_id) ?? []; a.push(l); pitByTeam.set(l.team_id, a)
  }

  // Raw numeric value per stat per team; null values are simply left out (dash in the UI).
  const raw = new Map<WpblTeamStatKey, Map<string, number>>()
  const put = (key: WpblTeamStatKey, teamId: string, value: number | null) => {
    if (value == null || !Number.isFinite(value)) return
    if (!raw.has(key)) raw.set(key, new Map())
    raw.get(key)!.set(teamId, value)
  }

  for (const t of teams) {
    const bt = sumBattingRaw(batByTeam.get(t.id) ?? [])
    put('avg', t.id, bt.avg)
    put('obp', t.id, bt.obp)
    put('slg', t.id, bt.slg)
    put('ops', t.id, bt.ops)
    if (bt.ab > 0 || bt.h > 0) put('hr', t.id, bt.hr)
    const gp = played.get(t.id) ?? 0
    if (gp > 0) put('rpg', t.id, bt.r / gp)

    const pt = sumPitchingRaw(pitByTeam.get(t.id) ?? [])
    // Rescaled here rather than at the render site because this map holds FORMATTED strings
    // as well as numbers, and formatting a per-9 value under a K/7 heading is the exact
    // mismatch the setting exists to avoid.
    put('era', t.id, scaleToBasis(pt.era, basis))
    put('whip', t.id, pt.whip)
    put('k9', t.id, scaleToBasis(pt.k9, basis))
  }

  const fmt: Record<WpblTeamStatKey, (n: number) => string> = {
    avg: fmtRate, obp: fmtRate, slg: fmtRate, ops: fmtRate,
    rpg: n => n.toFixed(1),
    hr: n => String(Math.round(n)),
    era: n => n.toFixed(2),
    whip: n => n.toFixed(2),
    k9: n => n.toFixed(1),
  }

  const out = new Map<string, WpblTeamSeasonStats>()
  for (const def of WPBL_TEAM_STAT_DEFS) {
    const values = raw.get(def.key)
    if (!values) continue
    const sorted = [...values].sort((a, b) => def.better === 'high' ? b[1] - a[1] : a[1] - b[1])
    const best = sorted[0][1]
    const worst = sorted[sorted.length - 1][1]
    const span = Math.abs(best - worst)
    let rank = 0
    let prev: number | null = null
    sorted.forEach(([teamId, value], i) => {
      if (prev === null || value !== prev) rank = i + 1
      prev = value
      const entry = out.get(teamId) ?? {}
      entry[def.key] = {
        display: fmt[def.key](value),
        rank,
        pct: span === 0 ? 1 : Math.abs(value - worst) / span,
      }
      out.set(teamId, entry)
    })
  }
  return out
}
