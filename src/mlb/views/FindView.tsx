import { TeamLogo } from '../components/TeamLogo'
import { useMemo, useState } from 'react'
import { Box, Typography } from '@mui/material'
import { runFinder, validFinderSort, type FinderQuery, type FinderSide, type FinderSort } from '../../league/finder'
import { FinderBoard, type FinderExample, type FinderReading } from '../../ui/finderBoard'
import { parseFinderText } from '../../league/finderParse'
import { scopedGames } from '../../league/season'
import { navigate } from '../../nav'
import { MLB_FINDER_CLUBS, mlbFinderHref } from '../finderLink'
import { MLB_QUALIFY_IP_PER_GAME, MLB_QUALIFY_PA_PER_GAME } from '../qualify'
import { PORTRAIT_PX } from '../../ui/leaders'
import { chromePx } from '../../ui/scale'
import { StatsBar, STATS_BOARD_ROOT_SX, STATS_BOARD_TOP } from './StatsBar'
import GameLineRow from '../components/GameLineRow'
import { PlayerHeadshot } from '../components/leaderboards'

import { gameLink, playerLink } from '../lib/links'
import { TEAM_ABBR, TEAM_NICKNAME } from '../constants'
import { MLB_CLUBS } from '../routes'
import { seasonScopeOf, MLB_LINES_SEASONS } from '../seasonLines'
import { useMlbSeasonLines, LinesBoardControls, NotMirrored, type MlbLinesBoardProps } from './BestsView'
import { TYPE_SCALE } from '../../ui/card'

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

// THE ONE-TAP QUESTIONS, in nine-inning terms and a 162-game season. Innings are in outs and rates
// in their last printed digit, as the engine stores both.
const EXAMPLES: Record<FinderSide, FinderExample[]> = {
  pitching: [
    { label: '10+ strikeouts', conditions: [{ field: 'so', op: 'gte', value: 10 }] },
    { label: '7+ IP, no runs', conditions: [{ field: 'ip', op: 'gte', value: 21 }, { field: 'r', op: 'eq', value: 0 }] },
    { label: '8+ IP, no walks', conditions: [{ field: 'ip', op: 'gte', value: 24 }, { field: 'bb', op: 'eq', value: 0 }] },
    { label: '6+ IP, no hits', conditions: [{ field: 'ip', op: 'gte', value: 18 }, { field: 'h', op: 'eq', value: 0 }] },
    { label: '10+ K in a loss', conditions: [{ field: 'so', op: 'gte', value: 10 }, { field: 'l', op: 'eq', value: 1 }] },
    { label: '110+ pitches', conditions: [{ field: 'pitches', op: 'gte', value: 110 }] },
    { per: 'season', label: 'ERA under 3.00', conditions: [{ field: 'era', op: 'lte', value: 299 }] },
    { per: 'season', label: 'WHIP under 1.10', conditions: [{ field: 'whip', op: 'lte', value: 109 }] },
    { per: 'season', label: '15+ wins', conditions: [{ field: 'w', op: 'gte', value: 15 }] },
    { per: 'season', label: '30+ saves', conditions: [{ field: 'sv', op: 'gte', value: 30 }] },
    { per: 'season', label: '200+ strikeouts', conditions: [{ field: 'so', op: 'gte', value: 200 }] },
    { per: 'season', label: '180+ innings', conditions: [{ field: 'ip', op: 'gte', value: 540 }] },
  ],
  hitting: [
    { label: '4-hit games', conditions: [{ field: 'h', op: 'gte', value: 4 }] },
    { label: 'Multi-homer games', conditions: [{ field: 'hr', op: 'gte', value: 2 }] },
    { label: '5+ RBI', conditions: [{ field: 'rbi', op: 'gte', value: 5 }] },
    { label: '3+ steals', conditions: [{ field: 'sb', op: 'gte', value: 3 }] },
    { label: 'On base 5+ times', conditions: [{ field: 'ob', op: 'gte', value: 5 }] },
    { per: 'season', label: '.300 hitters', conditions: [{ field: 'avg', op: 'gte', value: 300 }] },
    { per: 'season', label: '.900+ OPS', conditions: [{ field: 'ops', op: 'gte', value: 900 }] },
    { per: 'season', label: '30+ home runs', conditions: [{ field: 'hr', op: 'gte', value: 30 }] },
    { per: 'season', label: '30+ steals', conditions: [{ field: 'sb', op: 'gte', value: 30 }] },
  ],
}

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
  // The table's column sort, held here because the engine sorts before it caps (WPBL's FindView).
  const [sortPick, setSort] = useState<FinderSort | null>(null)
  const sort = validFinderSort(side, query, sortPick)
  // MLB's own rate-title bar (qualify.ts) on the fewest games any club has played in the slice, the
  // same thing the batting title is measured against on the last day.
  const qualify = useMemo(() => {
    const played = new Map<string, number>()
    for (const g of scopedGames((data?.games ?? []).filter(g => g.status === 'final'), scoped.scope)) {
      for (const id of [g.home_team_id, g.away_team_id]) played.set(id, (played.get(id) ?? 0) + 1)
    }
    if (!played.size) return null
    const teamGames = Math.min(...played.values())
    return { minPa: Math.round(MLB_QUALIFY_PA_PER_GAME * teamGames), minOuts: Math.round(MLB_QUALIFY_IP_PER_GAME * teamGames * 3) }
  }, [data, scoped.scope])
  const result = useMemo(
    () => runFinder(side, data?.batting ?? [], data?.pitching ?? [], data?.players ?? [], data?.games ?? [], scoped, 50, sort,
      { eraInnings: 9, qualify }),
    [side, data, scoped, sort, qualify])
  // A reading on this side is asked in place, keeping the season on screen; the other side goes
  // through the address, as the search box sends it, since the side is the section's to switch.
  const onAsk = (r: FinderReading) => {
    if (r.side === side) onQuery({ ...query, per: r.per, conditions: r.conditions, teamId: r.teamId, oppId: r.oppId, venue: r.venue })
    else navigate(mlbFinderHref(r))
  }
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
        <Typography sx={{ textAlign: 'center', py: 6, color: 'text.secondary', fontSize: TYPE_SCALE.body }}>
          Couldn’t load the {vizSeason} box scores. Try again in a moment.
        </Typography>
      ) : (
        <Box sx={{ pt: { xs: 1.5, sm: 2 } }}>
          <FinderBoard side={side} query={query} onQuery={onQuery} result={result} clubs={CLUBS} loading={loading}
            clubAbbr={id => TEAM_ABBR[Number(id)] ?? id}
            intro="Search every box-score line of the season for the games that match."
            sort={sort} onSort={setSort} examples={EXAMPLES[side]} stickyTop={STATS_BOARD_TOP}
            parse={text => parseFinderText(text, MLB_FINDER_CLUBS)} onAsk={onAsk}
            renderRow={(r, i, unit) => (
              <GameLineRow key={r.key} rank={i + 1} name={r.name} player={r.player} teamId={r.teamId}
                game={r.game} detail={r.detail} value={r.headlineDisplay} unit={unit} divider={i > 0}
                nameOpens="game" compactDate emphasizeRank={false} onOpenPlayer={onOpenPlayer} onOpenGame={onOpenGame} />
            )}
            rowParts={r => {
              const club = r.teamId ? Number(r.teamId) : 0
              const game = r.game
              return {
                portrait: r.player
                  ? <PlayerHeadshot variant="ring" playerId={r.player.playerId} name={r.name} teamId={club || undefined} size={PORTRAIT_PX} />
                  : <Box sx={{ width: chromePx(PORTRAIT_PX), flexShrink: 0 }} />,
                club: club > 0 ? <TeamLogo teamId={club} abbr={TEAM_ABBR[club] ?? ''} size={16} /> : undefined,
                playerLink: r.player ? playerLink(r.player.playerId, r.name, onOpenPlayer) : undefined,
                gameLink: game ? gameLink(game.gamePk, onOpenGame ? () => onOpenGame(game.gamePk) : undefined) : undefined,
              }
            }}
            tallyParts={t => {
              const club = t.teamId ? Number(t.teamId) : 0
              return {
                key: t.player ? String(t.player.playerId) : t.name,
                name: t.name,
                portrait: t.player
                  ? <PlayerHeadshot variant="ring" playerId={t.player.playerId} name={t.name} teamId={club || undefined} size={PORTRAIT_PX} />
                  : <Box sx={{ width: chromePx(PORTRAIT_PX) }} />,
                badge: club > 0 ? <TeamLogo teamId={club} abbr={TEAM_ABBR[club] ?? ''} size={16} /> : undefined,
                linkProps: t.player ? playerLink(t.player.playerId, t.name, onOpenPlayer) : undefined,
              }
            }} />
        </Box>
      )}
    </Box>
  )
}
