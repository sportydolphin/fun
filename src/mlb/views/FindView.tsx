import { useMemo } from 'react'
import { Box, Typography } from '@mui/material'
import { runFinder, type FinderQuery } from '../../league/finder'
import { FinderBoard } from '../../ui/finderBoard'
import { PORTRAIT_PX } from '../../ui/leaders'
import { chromePx } from '../../ui/scale'
import { StatsBar, STATS_BOARD_ROOT_SX } from './StatsBar'
import GameLineRow from '../components/GameLineRow'
import { PlayerHeadshot } from '../components/leaderboards'
import { LogoBubble } from '../components/boxScore'
import { playerLink } from '../lib/links'
import { TEAM_ABBR, TEAM_NICKNAME } from '../constants'
import { MLB_CLUBS } from '../routes'
import { seasonScopeOf, MLB_LINES_SEASONS } from '../seasonLines'
import { useMlbSeasonLines, LinesBoardControls, NotMirrored, type MlbLinesBoardProps } from './BestsView'

// THE FIND BOARD: every MLB game line that matches what you asked for. The shared board
// (src/ui/finderBoard.tsx) on the shared engine (src/league/finder.ts), over MLB's mirrored box scores:
// how many times did anyone strike out twelve, who went four for four most often, has anyone
// walked nobody through eight. The engine's notes say what can be asked and why every condition
// is AND; the board says why the stat picker is a native select and why the value is a text box
// (innings: "6.2" is six and two thirds, never 6.2). ROADMAP.md item 6, step 3.
//
// The same season read as Bests (seasonLines.ts, cached), so a reader moving between the two pays
// for it once. The query is the section's and on the address (`q`, `team`, `opp`, `venue`), so a
// question can be sent as a link.

const CLUBS = [...MLB_CLUBS]
  .sort((a, b) => (TEAM_NICKNAME[a.id] ?? a.name).localeCompare(TEAM_NICKNAME[b.id] ?? b.name))
  .map(c => ({ value: String(c.id), label: TEAM_NICKNAME[c.id] ?? c.name }))

export function MlbFindView({
  boardTabs, isDesktop, lbGroup, sideSwitch, vizSeason, setVizSeason, gameScope, setGameScope, onOpenPlayer, onOpenGame,
  query, onQuery,
}: MlbLinesBoardProps & {
  /** Owned by the section, which mirrors it into the address. Its `scope` is ignored here: the
   *  section's Regular season / Playoffs / Both is the one control for that. */
  query: FinderQuery
  onQuery: (q: FinderQuery) => void
}) {
  const side = lbGroup
  const { data, loading, failed } = useMlbSeasonLines(vizSeason)
  const scoped = useMemo(() => ({ ...query, scope: seasonScopeOf(gameScope) }), [query, gameScope])
  const result = useMemo(
    () => runFinder(side, data?.batting ?? [], data?.pitching ?? [], data?.players ?? [], data?.games ?? [], scoped),
    [side, data, scoped])
  const mirrored = MLB_LINES_SEASONS.includes(vizSeason)

  return (
    <Box sx={STATS_BOARD_ROOT_SX}>
      <StatsBar tabs={boardTabs} isDesktop={isDesktop}>
        {/* A new side asks a new question: the old conditions name fields the other side may not
            have (a hitter's TB, a pitcher's IP), so the switch clears them (pickSide in MlbStats). */}
        <LinesBoardControls isDesktop={isDesktop} sideSwitch={sideSwitch} gameScope={gameScope} setGameScope={setGameScope}
          season={vizSeason} setSeason={setVizSeason} />
      </StatsBar>

      {!mirrored ? <NotMirrored season={vizSeason} /> : failed ? (
        <Typography sx={{ textAlign: 'center', py: 6, color: 'text.secondary', fontSize: '0.9rem' }}>
          Couldn’t load the {vizSeason} box scores. Try again in a moment.
        </Typography>
      ) : (
        <Box sx={{ pt: { xs: 1.5, sm: 2 } }}>
          <FinderBoard side={side} query={query} onQuery={onQuery} result={result} clubs={CLUBS} loading={loading}
            clubAbbr={id => TEAM_ABBR[Number(id)] ?? id}
            intro="Search every box-score line of the season for the games that match."
            renderRow={(r, i, unit) => (
              <GameLineRow key={r.key} rank={i + 1} name={r.name} player={r.player} teamId={r.teamId}
                game={r.game} detail={r.detail} value={r.headlineDisplay} unit={unit} divider={i > 0}
                nameOpens="game" compactDate emphasizeRank={false} onOpenPlayer={onOpenPlayer} onOpenGame={onOpenGame} />
            )}
            tallyParts={t => {
              const club = t.teamId ? Number(t.teamId) : 0
              return {
                key: t.player ? String(t.player.playerId) : t.name,
                name: t.name,
                portrait: t.player
                  ? <PlayerHeadshot variant="ring" playerId={t.player.playerId} name={t.name} teamId={club || undefined} size={PORTRAIT_PX} />
                  : <Box sx={{ width: chromePx(PORTRAIT_PX) }} />,
                badge: club > 0 ? <LogoBubble teamId={club} abbr={TEAM_ABBR[club] ?? ''} size={16} ring={1} /> : undefined,
                linkProps: t.player ? playerLink(t.player.playerId, t.name, onOpenPlayer) : undefined,
              }
            }} />
        </Box>
      )}
    </Box>
  )
}
