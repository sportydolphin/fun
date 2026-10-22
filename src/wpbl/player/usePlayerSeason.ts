import { useMemo } from 'react'
import { sumBatting, sumPitching, sumFielding, plateAppearances, hasPlateAppearance } from '../stats'
import { scopedLines, type SeasonScope } from '../season'
import { computeWpblPlayerRanks } from '../percentiles'
import type { EraBasis } from '../stats'
import { outsToIp } from '../constants'

import { positionsPlayed, leadsWithPitching, playedPosition } from '../positions'
import type { WpblTeam, WpblPlayer, WpblGame, WpblBattingLine, WpblPitchingLine, WpblFieldingLine } from '../types'
import { useSeasonValueBoards } from '../useSeasonValue'
import { playerSeasonValue } from '../derive/seasonValue'

// What the card says about one slice of one season: the totals, the ranks, which role leads and
// whether there are two, and the caveat under each headline. Everything here is derived from the
// lines the card holds; PlayerDetail.tsx draws it.
export function usePlayerSeason({ player, players, teams, games, seasonGames, season, career, scope, batting, pitching, fielding, leagueLines, eraBasis, thisSeason }: {
  player: WpblPlayer
  players: WpblPlayer[]
  teams: WpblTeam[]
  games: WpblGame[]
  seasonGames: WpblGame[]
  season: number | null
  career: boolean
  scope: SeasonScope
  batting: WpblBattingLine[]
  pitching: WpblPitchingLine[]
  fielding: WpblFieldingLine[]
  leagueLines: { batting: WpblBattingLine[]; pitching: WpblPitchingLine[] } | null
  eraBasis: EraBasis
  thisSeason: <T extends { game_id: string }>(rows: T[]) => T[]
}) {
  // Only real plate appearances count as batting: a 0-for-0 pinch/defensive cameo shouldn't
  // produce an all-zero batting card or a phantom game-log row.
  const battingReal = useMemo(() => batting.filter(hasPlateAppearance), [batting])
  // Every total on the card follows the scope toggle. The game log follows it too (see
  // `battingLog`/`pitchingLog`): with an explicit Regular / Playoffs / Both control on the card,
  // a log filtered to the chosen slice is the answer the reader asked for, not missing data.
  const bt = useMemo(() => sumBatting(battingReal, games, scope), [battingReal, games, scope])
  const pt = useMemo(() => sumPitching(pitching, games, scope), [pitching, games, scope])
  const ft = useMemo(() => sumFielding(fielding, games, scope), [fielding, games, scope])
  // The lines behind the game log and the form strip, in the same slice as the totals above.
  const battingLog = useMemo(() => scopedLines(battingReal, games, scope), [battingReal, games, scope])
  const pitchingLog = useMemo(() => scopedLines(pitching, games, scope), [pitching, games, scope])
  // Whether the player has any postseason line at all, which is the only thing that earns the
  // scope toggle: without one, the card has nothing to switch to and stays regular-season only.
  const hasPostseason = useMemo(
    () => scopedLines(battingReal, games, 'postseason').length > 0
      || scopedLines(pitching, games, 'postseason').length > 0
      || scopedLines(fielding, games, 'postseason').length > 0,
    [battingReal, pitching, fielding, games])
  const hasBatting = battingReal.length > 0
  const hasPitching = pitching.length > 0
  // WHETHER THERE IS ANYTHING TO SUMMARIZE, in the SAME scope the summary shows. `hasBatting`
  // and `hasPitching` above count every line the player has, postseason included, because the
  // game log lists those. `bt` and `pt` are summed through the schedule, which drops the
  // postseason, so the hero and the cameos below must gate on the regular-season sum having
  // content. Without this a pitcher who batted only in the playoffs has `hasBatting` true (the
  // postseason line has a plate appearance) but an empty `bt`, and the "Also batted" block
  // renders `.000/.000/.000, 0-for-0`. Symmetric for a hitter who only pitched in the postseason.
  const hasSeasonBatting = plateAppearances(bt) > 0
  const hasSeasonPitching = pt.outs > 0 || pt.bf > 0
  const hasFielding = fielding.some(f => f.po || f.a || f.e || f.dp || f.pb)
  // Off the BATTING lines, which are the only rows carrying a position at all: a fielding row
  // has none and a pitching row is always the mound. A pitching-only appearance still shows up
  // here, because the feed writes those games' batting position as "p" when the pitcher came to
  // the plate, and the line simply does not exist when they did not, which is a game fielded
  // only as a pitcher and already covered by the 'p' the other games carry.
  const fieldedPositions = useMemo(() => positionsPlayed(batting, games), [batting, games])

  // Ranks, OPS+, the percentile rail and the qualifying meter are all built against the regular
  // season: its league baseline and its qualifying bar. Laid over a playoff or combined total
  // they would rank a five-game line against a fifteen-game field, so they stand down for any
  // scope but the regular season, and every consumer already treats a null `ranks` as "not yet".
  // Against that season's league and that season's bar, so a past year is ranked among the players
  // who played it.
  const ranks = useMemo(
    () => scope === 'regular' && leagueLines && !career
      ? computeWpblPlayerRanks(player.id, players, teams, seasonGames, thisSeason(leagueLines.batting), thisSeason(leagueLines.pitching), eraBasis)
      : null,
    [scope, leagueLines, player.id, players, teams, games, season, career, seasonGames, eraBasis]) // eslint-disable-line react-hooks/exhaustive-deps

  // WINS ADDED AND THE RUNS ON THE BASES, read off Run value's own boards (derive/seasonValue.ts), so
  // "3rd of 74" here is third on that board. One season's regular season only, as the boards are,
  // and drawn after the rest of the card: the play log they need may not be in the session yet.
  const valueOn = scope === 'regular' && !career && season != null
  const seasonBatting = useMemo(() => (leagueLines ? thisSeason(leagueLines.batting) : null), [leagueLines, games, season, career]) // eslint-disable-line react-hooks/exhaustive-deps
  const valueBoards = useSeasonValueBoards(valueOn ? season : null, games, seasonGames, players, seasonBatting)
  const myValue = useMemo(() => (valueBoards ? playerSeasonValue(valueBoards, player.id) : null), [valueBoards, player.id])

  // Ranked only on the regular season, and only once the league's lines are in: until then the line
  // holds its rank row open (SeasonLine's ranksPending) instead of drawing a row short.
  const ranksPending = scope === 'regular' && !leagueLines && !career

  // The season line's qualified fields, handed to the pitch profile so every "of N" on the card
  // is the same N. See `batFieldIds` in percentiles.ts.
  const batRankPool = useMemo(() => (ranks ? new Set(ranks.batFieldIds) : null), [ranks])
  const pitRankPool = useMemo(() => (ranks ? new Set(ranks.pitFieldIds) : null), [ranks])

  // Lead with the skill the player is actually here for. The rule is `leadsWithPitching` in
  // positions.ts, shared with the unfurl card and the Discord card so the three cannot tell
  // one player's season two ways round. When one side is a cameo (a pitcher's stray ABs, a
  // hitter's mop-up inning) it does not earn a tab of its own: it folds into the primary pane
  // as a one-line summary, so genuine two-way players stand apart from occasional-hitting
  // pitchers. Thresholds are absolute (AB / outs) so they hold at any sample size.
  const pitcherFirst = leadsWithPitching({
    position: player.position, played: playedPosition(player.position, batting, games), hasBatting, hasPitching,
    gs: pt.gs, bf: pt.bf, pa: plateAppearances(bt),
  })
  const BAT_CAMEO_AB = 10, PIT_CAMEO_OUTS = 9
  const battingCameo = pitcherFirst && hasSeasonBatting && bt.ab < BAT_CAMEO_AB
  const pitchingCameo = !pitcherFirst && hasSeasonPitching && pt.outs < PIT_CAMEO_OUTS
  // A tab per role only when BOTH sides have real regular-season production: a side whose only
  // work was in the postseason is not a second role, it is a line in the game log, and giving
  // it a tab would open onto an empty regular-season pane.
  const twoWay = hasSeasonBatting && hasSeasonPitching && !battingCameo && !pitchingCameo

  // Sample-size meta for each pane, flagged as thin below a rough one-week-ish bar.
  //
  // THE RETRACTION SITS WITH THE CLAIM. This line runs directly under the headline rates, the
  // largest type on the card: a 6 AB player's `1.292` is set large, and a caveat a column away
  // in small gray type is not one a reader meets before believing the number. Naming the actual
  // bar here also says how far off the player is and what they are off from, in the same glance
  // as the figure it qualifies.
  //
  // The league's own bar is preferred over the local one whenever ranks have loaded, so this
  // line and the rail below it cannot disagree about whether the player counts. `BAT_SMALL_AB`
  // and `PIT_SMALL_OUTS` stay as the fallback for the window before `fetchWpblAllLines` lands
  // and for a season too young to have set a bar at all, where there is no number to name yet.
  const BAT_SMALL_AB = 25, PIT_SMALL_OUTS = 30 // < ~25 AB / < 10.0 IP reads as small sample
  const qual = ranks?.qualifiers
  // THE GAP, NOT THE BAR. `RankProgress` at the foot of the rail prints the distance to the bar
  // ("1 more PA"), so printing the threshold here ("29 PA to qualify") would give one fact two
  // numbers on one card, with the bigger one under the headline where it reads as a quantity
  // still owed. Twenty-nine of anything also sounds like a season away in a league that plays
  // fifteen games.
  //
  // The gap is the better retraction anyway. The bar's job here is to disown the large number
  // above it, and "1 PA from qualifying" does that while saying the more interesting thing: the
  // player is about to count. The meter below still draws the arithmetic; this is its headline.
  const paGap = qual ? Math.max(0, qual.minPa - plateAppearances(bt)) : 0
  const outsGap = qual ? Math.max(0, qual.minOuts - pt.outs) : 0
  // Falling through to 'small sample' on a zero gap is deliberate rather than defensive: it
  // cannot happen while this line and `computeWpblPlayerRanks` agree on the bar, and if they
  // ever stop agreeing, a vaguer caveat is a better failure than "0 PA from qualifying".
  const battingMeta = `${plateAppearances(bt)} PA`
    + (ranks?.batReason === 'below-bar' && paGap > 0 ? ` · ${paGap} PA from qualifying`
      : bt.ab < BAT_SMALL_AB ? ' · small sample' : '')
  // No IP here: it is a column on the pitching line now. The gap to the bar is still
  // measured in innings, because that is the unit the bar is set in.
  // Games and the record are columns of the line, so the caption keeps only the sample's verdict.
  const pitchingMeta = ranks?.pitReason === 'below-bar' && outsGap > 0 ? `${outsToIp(outsGap)} IP from qualifying`
    : pt.outs < PIT_SMALL_OUTS ? 'Small sample' : ''
  return {
    bt, pt, ft, battingLog, pitchingLog, hasPostseason, hasBatting, hasPitching, hasSeasonBatting, hasSeasonPitching,
    hasFielding, fieldedPositions, ranks, valueOn, myValue, ranksPending, batRankPool, pitRankPool,
    pitcherFirst, battingCameo, pitchingCameo, twoWay, battingMeta, pitchingMeta,
  }
}
