// WPBL's half of placing a fielder at each play (`fieldingInningLines` in src/league/inningLines.ts):
// where each starter played, who a name in the log is, and which club a player was on that day.
//
// The lineup cards are the one read this adds, and only once Fielding's inning grain is asked for: one
// per club, the same rows (and the same cache) the club page's lineup grid reads. Every season's rows,
// which is fine here, since a lineup row places a player only in its own game.

import type { FielderSource } from '../league/inningLines'
import { foldName } from '../lib/fuzzyName'
import { fetchWpblLineupHistory } from './api'
import type { WpblPlayer, WpblTeam } from './types'

type Line = { game_id: string; player_id: string; team_id: string | null }

export async function wpblFielderSource(teams: readonly WpblTeam[], players: readonly WpblPlayer[], lines: readonly Line[][]): Promise<FielderSource> {
  const starts = (await Promise.all(teams.map(t => fetchWpblLineupHistory(t.id)))).flat()
  const byName = new Map(players.map(p => [foldName(p.name), p.id]))
  // The club off the game's own lines, never the roster's (a traded player's club is a fact about a
  // date; src/wpbl/CLAUDE.md). A pitcher with no batting line is on the pitching lines.
  const club = new Map<string, string>()
  for (const list of lines) for (const l of list) if (l.team_id) club.set(`${l.game_id}|${l.player_id}`, l.team_id)
  for (const r of starts) if (r.team_id) club.set(`${r.game_id}|${r.player_id}`, r.team_id)
  return {
    starts,
    byName: name => byName.get(foldName(name)) ?? null,
    teamOf: (gameId, playerId) => club.get(`${gameId}|${playerId}`) ?? null,
  }
}
