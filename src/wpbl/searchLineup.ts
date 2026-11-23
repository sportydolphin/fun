// "Cleanup hitters", "batting 9th", "Hunters leadoff hitter": who has started in that spot of the
// order and how they hit there, off the lineup cards (wpbl_lineup_history) and the box-score lines of
// the games they started in it. The words are read in src/league/lineupSpot.ts.
//
// STARTS ONLY, and the line is the whole game's, since a box-score line carries no slot: a starter
// moved mid-game is rare, and the view already settles who started a shared slot. REGULAR SEASON
// ONLY, cut against the whole schedule, as every season figure is (src/wpbl/CLAUDE.md).

import { fetchWpblAllLines, fetchWpblLineupHistory } from './api'
import { parseLineupSpot, SPOT_NAMES } from '../league/lineupSpot'
import { currentSeason, inSeason, seasonGames } from './season'
import { scopedGames } from '../league/season'
import { fmtRate, plateAppearances, sumBatting } from './stats'
import { WPBL_FINDER_CLUBS } from './finderLink'
import { wpblPlayerPath, wpblTeamPath } from './routes'
import { foldName } from '../lib/fuzzyName'
import type { PlayAnswer } from '../mlb/state/SearchBridgeContext'
import type { WpblGame, WpblPlayer, WpblTeam } from './types'

const MAX_PLAYERS = 3

/** The rows for a lineup-spot question, or none when `text` is not one. */
export async function wpblLineupAnswers(text: string, ctx: { games: WpblGame[]; players: WpblPlayer[]; teams: WpblTeam[] }): Promise<PlayAnswer[]> {
  const ask = parseLineupSpot(text)
  if (!ask) return []
  // What is left is a club, a year, or nothing.
  let rest = ` ${foldName(ask.rest)} `
  let season: number | null = null
  rest = rest.replace(/ (20\d\d) /, (_m, y: string) => { season = Number(y); return ' ' })
  const names = WPBL_FINDER_CLUBS.flatMap(c => c.names.map(n => ({ id: c.id, n: foldName(n) }))).sort((a, b) => b.n.length - a.n.length)
  let teamId: string | null = null
  for (const { id, n } of names) {
    const re = new RegExp(` ${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s? `)
    if (re.test(rest)) { teamId = id; rest = rest.replace(re, ' '); break }
  }
  if (rest.trim()) return []
  const year = season ?? currentSeason(ctx.games)
  if (year == null) return []
  const games = scopedGames(seasonGames(ctx.games, year), 'regular').filter(g => g.status === 'final')
  const gameIds = new Set(games.map(g => g.id))
  const clubs = teamId ? ctx.teams.filter(t => t.id === teamId) : ctx.teams
  const [cards, lines] = await Promise.all([Promise.all(clubs.map(t => fetchWpblLineupHistory(t.id))), fetchWpblAllLines()])
  const starts = cards.flat().filter(r => r.started && r.lineup_spot === ask.spot && gameIds.has(r.game_id))
  if (!starts.length) return []
  const batting = inSeason(lines.batting, ctx.games, year)
  const lineOf = new Map(batting.map(l => [`${l.game_id}|${l.player_id}`, l]))
  const byPlayer = new Map<string, typeof batting>()
  for (const s of starts) {
    const l = lineOf.get(`${s.game_id}|${s.player_id}`)
    if (!l) continue
    byPlayer.set(s.player_id, [...(byPlayer.get(s.player_id) ?? []), l])
  }
  const spot = SPOT_NAMES[ask.spot]
  const slash = (ls: typeof batting) => {
    const t = sumBatting(ls, ctx.games)
    return `${fmtRate(t.avg)} AVG · ${fmtRate(t.ops)} OPS · ${plateAppearances(t)} PA`
  }
  const team = teamId ? ctx.teams.find(t => t.id === teamId) : undefined
  const all = [...byPlayer.values()].flat()
  const summary: PlayAnswer = {
    key: `lineup-${ask.spot}-${teamId ?? 'league'}-${year}`,
    title: `${spot} spot${team ? `, ${team.name}` : ', every club'}`,
    detail: `${slash(all)} · ${year}`,
    href: team ? wpblTeamPath(team, ctx.teams) : '/wpbl/teams',
    open: () => {},
  }
  const byId = new Map(ctx.players.map(p => [p.id, p]))
  const regulars = [...byPlayer].map(([id, ls]) => ({ player: byId.get(id), ls }))
    .filter((r): r is { player: WpblPlayer; ls: typeof batting } => !!r.player)
    .sort((a, b) => b.ls.length - a.ls.length || a.player.name.localeCompare(b.player.name))
    .slice(0, MAX_PLAYERS)
  return [summary, ...regulars.map(({ player, ls }) => ({
    key: `lineup-${ask.spot}-${player.id}-${year}`,
    title: `${player.name}, ${ls.length} ${ls.length === 1 ? 'start' : 'starts'} batting ${ask.spot === 1 ? 'leadoff' : ask.spot === 4 ? 'cleanup' : SPOT_NAMES[ask.spot]}`,
    detail: slash(ls),
    href: wpblPlayerPath(player, ctx.players),
    open: () => {},
  }))]
}
