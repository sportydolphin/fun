import type { WpblTeam, WpblPlayer, WpblGame } from '../types'
import type { WpblStatsFocus } from '../stats/StatsView'
import TeamPage from '../TeamPage'
import TeamsGrid from '../TeamsGrid'
import { EmptyState } from './Placeholders'

export function TeamsView({ teams, games, selected, onSelect, onOpenGame, onOpenPlayer, onOpenStats }: {
  teams: WpblTeam[]; games: WpblGame[]; selected: WpblTeam | null
  onSelect: (t: WpblTeam | null) => void
  onOpenGame: (g: WpblGame) => void
  onOpenPlayer: (p: WpblPlayer) => void
  onOpenStats: (g: 'hitting' | 'pitching', sortKey?: string,
                opts?: Pick<WpblStatsFocus, 'mode' | 'teamId' | 'qualified'>) => void
}) {
  if (teams.length === 0) {
    return <EmptyState title="No teams" />
  }

  // Full team page (results, totals, leaders, roster with inline stats).
  if (selected) {
    return (
      <TeamPage
        team={selected}
        teams={teams}
        games={games}
        // Walk history back to wherever the team page was opened from (Home chips, the
        // Teams grid, a schedule link…) rather than always landing on the Teams grid.
        onBack={() => window.history.back()}
        // Up to the grid, as distinct from Back. Back returns you to wherever you opened the
        // team from (Stats, a Home chip, a schedule link); this always goes to all four.
        onAllTeams={() => onSelect(null)}
        // The sticky header's team rail: switching clubs from inside a team page, without
        // a trip back out to the grid.
        onSelectTeam={onSelect}
        onOpenGame={onOpenGame}
        onOpenPlayer={onOpenPlayer}
        onOpenStats={onOpenStats}
      />
    )
  }

  return <TeamsGrid teams={teams} games={games} onSelect={onSelect} />
}
