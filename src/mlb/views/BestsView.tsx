import React, { useEffect, useMemo, useState } from 'react'
import { Box, Skeleton, Typography } from '@mui/material'
import { bestGames, BEST_ROWS, type BestBoard } from '../../league/bests'
import { scopedGames } from '../../league/season'
import { SectionCard, TYPE_SCALE } from '../../ui/card'
import { BestsBoards } from '../../ui/bestsBoards'
import { FilterChip, FilterSelect } from '../../ui/FilterChip'
import { PORTRAIT_PX } from '../../ui/leaders'
import { chromePx } from '../../ui/scale'
import { StatsBar, STATS_BOARD_ROOT_SX } from './StatsBar'
import { StatsFilterSheet, controlPill } from './StatsRankedList'
import { pressable } from '../../ui/interaction'
import { ACCENT } from '../constants'
import GameLineRow from '../components/GameLineRow'
import { GAME_SCOPES, GAME_SCOPE_LABEL, type GameScope } from '../lib/gameScope'
import { CURRENT_SEASON } from '../constants'
import {
  fetchMlbSeasonLines, seasonScopeOf, MLB_LINES_SEASONS, type MlbLineGame, type MlbLinePlayer, type MlbSeasonLines,
} from '../seasonLines'

// THE BESTS BOARD: the best single game anyone had, by each of a handful of measures. WPBL's layout
// (src/ui/bestsBoards.tsx), on WPBL's engine (src/league/bests.ts), over MLB's mirrored box scores.
// Nothing StatsAPI serves can answer "the most strikeouts anyone threw in a game this year": it
// keeps season totals and one box score per game, so the question needed every line on our side.
// ROADMAP.md item 6, step 3.
//
// It reads the whole season's lines (seasonLines.ts), about half a megabyte compressed, cached for
// the page's life and shared with Find, then ranks them here with no further request.

type Board = BestBoard<MlbLinePlayer, MlbLineGame>

/** A card's rows, ties included. Past it the card counts the rest; see `rankRows`. */
const BEST_CAP = 10

export interface MlbLinesBoardProps {
  boardTabs: React.ReactNode
  isDesktop: boolean
  lbGroup: 'hitting' | 'pitching'
  /** The Stats tab's Hitting / Pitching / Fielding switch, built once by the section (MlbStats) so
   *  every board draws the same control in the same place. */
  sideSwitch: React.ReactNode
  vizSeason: number
  setVizSeason: (s: number) => void
  gameScope: GameScope
  setGameScope: (s: GameScope) => void
  onOpenPlayer: (playerId: number) => void
  onOpenGame: (gamePk: number) => void
}

/** The season's lines, read for a board, with the three states a board draws. */
export function useMlbSeasonLines(season: number): { data: MlbSeasonLines | null; loading: boolean; failed: boolean } {
  const [state, setState] = useState<{ season: number; data: MlbSeasonLines | null; failed: boolean } | null>(null)
  useEffect(() => {
    let live = true
    if (!MLB_LINES_SEASONS.includes(season)) return
    fetchMlbSeasonLines(season)
      .then(data => { if (live) setState({ season, data, failed: false }) })
      .catch(() => { if (live) setState({ season, data: null, failed: true }) })
    return () => { live = false }
  }, [season])
  const mine = state?.season === season ? state : null
  return { data: mine?.data ?? null, loading: MLB_LINES_SEASONS.includes(season) && !mine, failed: !!mine?.failed }
}

/** The season picker, offering only the seasons the mirror holds. */
export function LinesSeasonSelect({ season, setSeason }: { season: number; setSeason: (s: number) => void }) {
  const options = MLB_LINES_SEASONS.includes(season) ? MLB_LINES_SEASONS : [season, ...MLB_LINES_SEASONS]
  return (
    <FilterSelect ariaLabel="Season" value={String(season)}
      options={[...options].sort((a, b) => b - a).map(y => ({ value: String(y), label: String(y) }))}
      onChange={v => setSeason(Number(v))} active={season !== CURRENT_SEASON} />
  )
}

/** THE CONTROLS OF BOTH BOARDS ON THE MIRRORED LINES (Bests, Find): the side, the games and the
 *  season. On a phone the games and the season are one Filters pill and a sheet, as on every other
 *  board on both Stats tabs: as chips they were a second pinned row under the switch, the only one. */
export function LinesBoardControls({ isDesktop, sideSwitch, gameScope, setGameScope, season, setSeason }: {
  isDesktop: boolean
  sideSwitch: React.ReactNode
  gameScope: GameScope
  setGameScope: (s: GameScope) => void
  season: number
  setSeason: (s: number) => void
}) {
  const [open, setOpen] = useState(false)
  const filtersSet = season !== CURRENT_SEASON || gameScope !== 'regular'
  if (!isDesktop) {
    const seasons = MLB_LINES_SEASONS.includes(season) ? MLB_LINES_SEASONS : [season, ...MLB_LINES_SEASONS]
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
        {sideSwitch}
        <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center' }}>
          <Box {...pressable(() => setOpen(true))} aria-haspopup="dialog" aria-expanded={open} sx={controlPill(filtersSet)}>
            Filters
            {filtersSet && <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: ACCENT }} />}
            <Box component="span" sx={{ fontSize: TYPE_SCALE.caption }}>▾</Box>
          </Box>
        </Box>
        {open && (
          <StatsFilterSheet allTime={false} seasons={[...seasons].sort((a, b) => b - a)}
            seasonValue={String(season)} onSeason={v => setSeason(Number(v))}
            scope={gameScope} scopes={GAME_SCOPES} onScope={setGameScope}
            canQualify={false} qualified onQualified={() => {}}
            onClose={() => setOpen(false)} />
        )}
      </Box>
    )
  }
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
      {sideSwitch}
      <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center', flexWrap: 'wrap', minWidth: 0 }}>
        {GAME_SCOPES.map(sc => (
          <FilterChip key={sc} active={gameScope === sc} onClick={() => setGameScope(sc)}>{GAME_SCOPE_LABEL[sc]}</FilterChip>
        ))}
        <Box sx={{ width: '1px', alignSelf: 'stretch', bgcolor: 'divider', mx: 0.25, flexShrink: 0 }} />
        <LinesSeasonSelect season={season} setSeason={setSeason} />
      </Box>
    </Box>
  )
}

/** What a season the mirror does not hold says, in place of the board. */
export function NotMirrored({ season }: { season: number }) {
  return (
    <Box sx={{ textAlign: 'center', py: 5, px: 2 }}>
      <Typography sx={{ fontSize: TYPE_SCALE.title, fontWeight: 700 }}>
        No {season} box scores · Lines start in {Math.min(...MLB_LINES_SEASONS)}
      </Typography>
    </Box>
  )
}

/** A card before the lines land: the real title, and the shape a season's card nearly always has,
 *  a full cap of rows and the line counting the ties past it. */
function BoardSkeleton({ label }: { label: string }) {
  return (
    <SectionCard title={label}>
      {Array.from({ length: BEST_CAP }, (_, i) => (
        <Box key={i} aria-hidden sx={{
          display: 'flex', alignItems: 'center', gap: 1.25, px: 0.5, py: 0.85,
          borderTop: i > 0 ? '1px solid' : 'none', borderColor: 'divider',
        }}>
          <Box sx={{ width: '1.5rem', flexShrink: 0, fontSize: TYPE_SCALE.body }}>&nbsp;</Box>
          <Skeleton variant="circular" width={chromePx(PORTRAIT_PX)} height={chromePx(PORTRAIT_PX)} sx={{ flexShrink: 0 }} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontSize: TYPE_SCALE.body }}><Skeleton width="55%" /></Typography>
            <Typography sx={{ fontSize: TYPE_SCALE.meta }}><Skeleton width="75%" /></Typography>
          </Box>
          <Box sx={{ fontSize: TYPE_SCALE.heading, fontWeight: 800 }}><Skeleton width="2rem" /></Box>
        </Box>
      ))}
      <Typography aria-hidden sx={{ fontSize: TYPE_SCALE.meta, color: 'transparent', textAlign: 'center', pt: 1, borderTop: '1px solid', borderColor: 'divider' }}>
        And more
      </Typography>
    </SectionCard>
  )
}

export function MlbBestsView({
  boardTabs, isDesktop, lbGroup, sideSwitch, vizSeason, setVizSeason, gameScope, setGameScope, onOpenPlayer, onOpenGame,
}: MlbLinesBoardProps) {
  const { data, loading, failed } = useMlbSeasonLines(vizSeason)
  const scope = seasonScopeOf(gameScope)
  const boards: Board[] = useMemo(
    () => bestGames(lbGroup, data?.batting ?? [], data?.pitching ?? [], data?.players ?? [], data?.games ?? [], scope, BEST_ROWS, BEST_CAP),
    [lbGroup, data, scope])
  // The count is the SCOPED one: a playoff record book under a line claiming the whole season
  // would be the page contradicting itself.
  const finals = useMemo(() => scopedGames((data?.games ?? []).filter(g => g.status === 'final'), scope).length, [data, scope])
  const gamesWord = gameScope === 'regular' ? 'regular-season games' : gameScope === 'post' ? 'playoff games' : 'games'
  const mirrored = MLB_LINES_SEASONS.includes(vizSeason)

  return (
    <Box sx={STATS_BOARD_ROOT_SX}>
      <StatsBar tabs={boardTabs} isDesktop={isDesktop}>
        <LinesBoardControls isDesktop={isDesktop} sideSwitch={sideSwitch} gameScope={gameScope} setGameScope={setGameScope}
          season={vizSeason} setSeason={setVizSeason} />
      </StatsBar>

      {!mirrored ? <NotMirrored season={vizSeason} /> : failed ? (
        <Typography sx={{ textAlign: 'center', py: 6, color: 'text.secondary', fontSize: TYPE_SCALE.body }}>
          Couldn’t load the {vizSeason} box scores. Try again in a moment.
        </Typography>
      ) : (
        <Box sx={{ pt: { xs: 1.5, sm: 2 } }}>
          <BestsBoards boards={boards} finals={finals} gamesWord={gamesWord} loading={loading}
            skeleton={b => <BoardSkeleton key={b.key} label={b.label} />}
            renderRow={(r, i, b) => (
              <GameLineRow key={r.key} rank={r.rank} name={r.name} player={r.player} teamId={r.teamId}
                game={r.game} detail={r.detail} value={r.display} unit={b.unit} divider={i > 0}
                onOpenPlayer={onOpenPlayer} onOpenGame={onOpenGame} />
            )} />
        </Box>
      )}
    </Box>
  )
}
