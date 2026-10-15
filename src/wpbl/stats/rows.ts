import type { WpblValueTotals, PlayerValueSeason } from '../derive/playerValue'
import { compareRows } from '../leaderOrder'
import { wpblFullName } from '../constants'
import { buildPositionIndex, displayPositionFromIndex } from '../positions'
import {
  aggregateBatting, aggregatePitching, aggregateFielding, sumBatting, sumPitching, sumFielding,
  wpblQualifiers, plateAppearances,
  type WpblBattingTotals, type WpblPitchingTotals, type WpblFieldingTotals,
} from '../stats'
import type { WpblTeam, WpblPlayer, WpblGame, WpblBattingLine, WpblPitchingLine, WpblFieldingLine } from '../types'
import { scopedLines, type SeasonScope } from '../season'
import { useWpblPlayerLink } from '../LinkContext'
import type { Col } from '../statColumns'
import { matchesPositionFilter, type PositionFilter } from '../../league/positionFilter'
import type { Side, Totals, Mode } from './axes'
import type { Row } from './shared'

/** The table's rows, sorted: one per player on Players (any side), one per club on Teams. */
export function buildRows({ mode, side, players, lines, fielding, valueSeasons, batSeasons, pitSeasons, teams,
  teamById, teamId, qualified, qual, activeCol, sortAsc, onOpenPlayer, onOpenTeam, playerLink, lobByGameTeam,
  games, scope, positionIndex, pos }: {
  mode: Mode
  side: Side
  players: WpblPlayer[]
  lines: { batting: WpblBattingLine[]; pitching: WpblPitchingLine[] }
  fielding: WpblFieldingLine[] | null
  valueSeasons: PlayerValueSeason<WpblPlayer>[] | null
  batSeasons: ReturnType<typeof aggregateBatting>
  pitSeasons: ReturnType<typeof aggregatePitching>
  teams: WpblTeam[]
  teamById: Map<string, WpblTeam>
  teamId: string | null
  qualified: boolean
  qual: ReturnType<typeof wpblQualifiers>
  activeCol: Col<Totals>
  sortAsc: boolean
  onOpenPlayer: (p: WpblPlayer) => void
  onOpenTeam?: (t: WpblTeam) => void
  playerLink: ReturnType<typeof useWpblPlayerLink>
  lobByGameTeam: Map<string, number>
  games: WpblGame[]
  scope: SeasonScope
  positionIndex: ReturnType<typeof buildPositionIndex>
  pos: PositionFilter | null
}): Row[] {
  let built: Row[]
  if (mode === 'teams') {
    // One row per team (only four). Team G is the team's games played (the count of distinct
    // game_ids), not the number of player lines that sumBatting/sumPitching add up.
    built = teams.map(team => {
      if (side === 'fielding') {
        // The club's fielding lines summed, scoped like the rest. G is the club's games off its
        // BATTING lines, which are written for every game: a fielding line exists only for a game
        // in which someone recorded something (see `gamesAppeared` in stats.ts).
        const totals = sumFielding((fielding ?? []).filter(l => l.team_id === team.id), games, scope)
        totals.g = new Set(scopedLines(lines.batting.filter(l => l.team_id === team.id), games, scope).map(l => l.game_id)).size
        return {
          key: team.id, team, label: wpblFullName(team), shortLabel: team.name,
          totals: totals as Totals, qualified: true,
          onClick: onOpenTeam ? () => onOpenTeam(team) : undefined,
        }
      }
      const src = side === 'hitting'
        ? lines.batting.filter(l => l.team_id === team.id)
        : lines.pitching.filter(l => l.team_id === team.id)
      // SCOPED ONCE, HERE, AND EVERYTHING ON THE ROW READS OFF IT.
      //
      // `sumBatting` and `sumPitching` take the schedule and the scope as required arguments
      // precisely so a season total cannot silently include the postseason. The two figures this
      // branch computes ITSELF, G and LOB, get no such protection: built from unfiltered lines they
      // would count a club's playoff games and runners on every scope, and nothing on screen would
      // look wrong, because the other columns in the same row are filtered.
      //
      // Filtering here and still passing `games` and `scope` below is deliberate belt and
      // braces: `scopedLines` is idempotent, and keeping the required arguments means nobody
      // can later take this line out and leave the sums quietly unscoped.
      const scoped = scopedLines(src as (WpblBattingLine | WpblPitchingLine)[], games, scope)
      const totals = side === 'hitting'
        ? sumBatting(scoped as WpblBattingLine[], games, scope)
        : sumPitching(scoped as WpblPitchingLine[], games, scope)
      const gameIds = new Set(scoped.map(l => l.game_id))
      totals.g = gameIds.size
      if (side === 'hitting') {
        // Summed over exactly the games this team has box-score lines for, so LOB covers
        // the same games as the rest of the row rather than drifting ahead of it when a
        // game's score lands before its boxscore does. Left null when none of them
        // reported one, so the cell dashes instead of claiming a tidy zero.
        let lob = 0, any = false
        for (const gid of gameIds) {
          const v = lobByGameTeam.get(`${gid}|${team.id}`)
          if (v != null) { lob += v; any = true }
        }
        ;(totals as WpblBattingTotals).lob = any ? lob : null
      }
      return {
        key: team.id, team, label: wpblFullName(team), shortLabel: team.name,
        totals, qualified: true,
        onClick: onOpenTeam ? () => onOpenTeam(team) : undefined,
      }
    })
  } else if (side === 'overall') {
    // No qualifier: every figure is a total against an average player, so a cameo reads as a
    // small number rather than an extreme one, and the bar would only hide the bench.
    let list = valueSeasons ?? []
    if (teamId) list = list.filter(s => s.player.team_id === teamId)
    if (pos) list = list.filter(s => matchesPositionFilter(pos, displayPositionFromIndex(s.player, positionIndex).label))
    built = list.map(s => ({
      key: s.player.id, team: teamById.get(s.player.team_id),
      label: s.player.name, fullName: s.player.name, sublabel: displayPositionFromIndex(s.player, positionIndex).label ?? undefined,
      totals: s.totals, qualified: true,
      onClick: () => onOpenPlayer(s.player),
      link: playerLink(s.player, onOpenPlayer),
    }))
  } else {
    const seasons = side === 'hitting'
      ? batSeasons.map(s => ({ player: s.player, totals: s.totals as Totals, qualified: plateAppearances(s.totals) >= qual.minPa }))
      : side === 'fielding'
      ? aggregateFielding(players, fielding ?? [], lines.batting, lines.pitching, games, scope).map(s => ({ player: s.player, totals: s.totals as Totals, qualified: s.totals.g >= qual.minG }))
      : pitSeasons.map(s => ({ player: s.player, totals: s.totals as Totals, qualified: s.totals.outs >= qual.minOuts }))
    let list = seasons
    if (teamId) list = list.filter(s => s.player.team_id === teamId)
    if (pos) {
      list = list.filter(s => matchesPositionFilter(pos, displayPositionFromIndex(s.player, positionIndex).label,
        side === 'pitching' ? s.totals as WpblPitchingTotals : null))
    }
    // The qualifier applies to every sort, counting stats included: a 1-for-1 HR leader shouldn't
    // top the board over a full-season slugger, and a lit "✓ Qualified" chip must not silently do
    // nothing on a counting stat.
    if (qualified) list = list.filter(s => s.qualified)
    built = list.map(s => ({
      key: s.player.id, team: teamById.get(s.player.team_id),
      label: s.player.name, fullName: s.player.name, sublabel: displayPositionFromIndex(s.player, positionIndex).label ?? undefined,
      totals: s.totals, qualified: s.qualified,
      onClick: () => onOpenPlayer(s.player),
      link: playerLink(s.player, onOpenPlayer),
    }))
  }

  const val = (r: Row) => activeCol.value(r.totals)
  // Ties break toward the bigger sample, innings pitched (outs) for pitching and plate
  // appearances for hitting, regardless of sort direction (more is always the better
  // tiebreak). Both are the unit that side's qualifier is set in. Fielding breaks on chances
  // rather than games: a 1.000 off forty chances outranks one off four.
  const sample = (r: Row) => side === 'pitching' ? (r.totals as WpblPitchingTotals).outs
    : side === 'fielding' ? (r.totals as WpblFieldingTotals).tc
    : side === 'overall' ? (r.totals as WpblValueTotals).pa + (r.totals as WpblValueTotals).outs
    : plateAppearances(r.totals as WpblBattingTotals)
  // Then the name, so a tie reads the same whichever source built the rows (leaderOrder.ts).
  return built.sort((a, b) => compareRows(val(a), val(b), sortAsc, sample(a), sample(b), a.label, b.label))
}
