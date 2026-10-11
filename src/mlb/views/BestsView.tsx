import React, { useEffect, useMemo, useState } from 'react'
import { Box, Skeleton, Typography, useMediaQuery, useTheme } from '@mui/material'
import { bestGames, BEST_ROWS, type BestBoard } from '../../league/bests'
import { scopedGames } from '../../league/season'
import { SectionCard, TYPE_SCALE } from '../../ui/card'
import { PillGroup } from '../../ui/PillGroup'
import { FilterChip, FilterSelect } from '../../ui/FilterChip'
import { PORTRAIT_PX } from '../../ui/leaders'
import { chromePx } from '../../ui/scale'
import { StatsBar, STATS_BOARD_ROOT_SX } from './StatsBar'
import GameLineRow from '../components/GameLineRow'
import { GAME_SCOPES, GAME_SCOPE_LABEL, type GameScope } from '../lib/gameScope'
import { CURRENT_SEASON } from '../constants'
import {
  fetchMlbSeasonLines, seasonScopeOf, MLB_LINES_SEASONS, type MlbLineGame, type MlbLinePlayer, type MlbSeasonLines,
} from '../seasonLines'

// THE BESTS BOARD: the best single game anyone had, by each of a handful of measures. WPBL's board
// (src/wpbl/BestsView.tsx), on WPBL's engine (src/league/bests.ts), over MLB's mirrored box scores.
// Nothing StatsAPI serves can answer "the most strikeouts anyone threw in a game this year": it
// keeps season totals and one box score per game, so the question needed every line on our side.
// ROADMAP.md item 6, step 3.
//
// It reads the whole season's lines (seasonLines.ts), about half a megabyte compressed, cached for
// the page's life and shared with Find, then ranks them here with no further request.

type Board = BestBoard<MlbLinePlayer, MlbLineGame>

/** A card's rows, ties included. Past it the card counts the rest; see `rankRows`. */
const BEST_CAP = 10
const SIDE_OPTIONS = [{ value: 'hitting', label: 'Hitting' }, { value: 'pitching', label: 'Pitching' }]
/** WPBL's wide board column, in chrome px: two columns of cards on a large desktop. */
const BOARD_W = chromePx(1150)

export interface MlbLinesBoardProps {
  boardTabs: React.ReactNode
  isDesktop: boolean
  lbGroup: 'hitting' | 'pitching'
  setLbGroup: (g: 'hitting' | 'pitching') => void
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

/** What a season the mirror does not hold says, in place of the board. */
export function NotMirrored({ season }: { season: number }) {
  return (
    <Box sx={{ textAlign: 'center', py: 5, px: 2 }}>
      <Typography sx={{ fontSize: TYPE_SCALE.title, fontWeight: 700, mb: 0.5 }}>
        Game-by-game lines start in {Math.min(...MLB_LINES_SEASONS)}
      </Typography>
      <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.disabled' }}>
        This board reads every box score of a season, and {season} is not stored yet.
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
  boardTabs, isDesktop, lbGroup, setLbGroup, vizSeason, setVizSeason, gameScope, setGameScope, onOpenPlayer, onOpenGame,
}: MlbLinesBoardProps) {
  const theme = useTheme()
  const twoCol = useMediaQuery(theme.breakpoints.up('lg'), { noSsr: true })
  const { data, loading, failed } = useMlbSeasonLines(vizSeason)
  const scope = seasonScopeOf(gameScope)
  const boards: Board[] = useMemo(
    () => bestGames(lbGroup, data?.batting ?? [], data?.pitching ?? [], data?.players ?? [], data?.games ?? [], scope, BEST_ROWS, BEST_CAP),
    [lbGroup, data, scope])
  // Even boards down the left, odd down the right, each column stacking on its own so a short card
  // does not grow a gap to match a tall one beside it (as WPBL's).
  const columns = useMemo(() => {
    if (!twoCol) return [boards]
    return [boards.filter((_, i) => i % 2 === 0), boards.filter((_, i) => i % 2 === 1)]
  }, [boards, twoCol])
  // The count is the SCOPED one: a playoff record book under a line claiming the whole season
  // would be the page contradicting itself.
  const finals = useMemo(() => scopedGames((data?.games ?? []).filter(g => g.status === 'final'), scope).length, [data, scope])
  const gamesWord = gameScope === 'regular' ? 'regular-season games' : gameScope === 'post' ? 'playoff games' : 'games'
  const anyRows = boards.some(b => b.rows.length > 0)
  const mirrored = MLB_LINES_SEASONS.includes(vizSeason)

  return (
    <Box sx={STATS_BOARD_ROOT_SX}>
      <StatsBar tabs={boardTabs} isDesktop={isDesktop}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
          <PillGroup options={SIDE_OPTIONS} value={lbGroup} onChange={v => setLbGroup(v as 'hitting' | 'pitching')} />
          <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center', flexWrap: 'wrap', minWidth: 0 }}>
            {GAME_SCOPES.map(sc => (
              <FilterChip key={sc} active={gameScope === sc} onClick={() => setGameScope(sc)}>{GAME_SCOPE_LABEL[sc]}</FilterChip>
            ))}
            <Box sx={{ width: '1px', alignSelf: 'stretch', bgcolor: 'divider', mx: 0.25, flexShrink: 0 }} />
            <LinesSeasonSelect season={vizSeason} setSeason={setVizSeason} />
          </Box>
        </Box>
      </StatsBar>

      {!mirrored ? <NotMirrored season={vizSeason} /> : failed ? (
        <Typography sx={{ textAlign: 'center', py: 6, color: 'text.secondary', fontSize: '0.9rem' }}>
          Couldn’t load the {vizSeason} box scores. Try again in a moment.
        </Typography>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: { xs: 1.5, sm: 2 }, maxWidth: BOARD_W, mx: 'auto', width: '100%', pt: { xs: 1.5, sm: 2 } }}>
          {/* One sentence, as WPBL's: the cards say what each measures, and the one thing none of
              them carries is that these are single GAMES on a tab of season totals. */}
          <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.secondary', lineHeight: 1.5, maxWidth: '70ch' }}>
            {/* The count is reserved, invisibly, while the lines load: on a phone it is what wraps
                the sentence to a second line, and the cards would drop by that line when it landed. */}
            Single-game totals, not season totals
            {loading
              ? <Box component="span" sx={{ visibility: 'hidden' }}>, from 2,430 {gamesWord}</Box>
              : finals > 0 ? `, from ${finals.toLocaleString()} ${gamesWord}` : ''}.
          </Typography>
          {!loading && !anyRows ? (
            <Box sx={{ textAlign: 'center', py: 5, px: 2, color: 'text.secondary' }}>
              <Typography sx={{ fontSize: TYPE_SCALE.title, fontWeight: 700, mb: 0.5 }}>No games in this slice yet</Typography>
              <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.disabled' }}>Records fill in as games go final.</Typography>
            </Box>
          ) : (
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: { xs: 1.5, sm: 2 } }}>
              {columns.map((col, ci) => (
                <Box key={ci} sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: { xs: 1.5, sm: 2 } }}>
                  {col.map(b => loading ? <BoardSkeleton key={b.key} label={b.label} /> : (
                    <SectionCard key={b.key} title={b.label}>
                      {b.rows.length === 0
                        ? <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.disabled', py: 1 }}>Nothing here yet.</Typography>
                        : b.rows.map((r, i) => (
                          <GameLineRow key={r.key} rank={r.rank} name={r.name} player={r.player} teamId={r.teamId}
                            game={r.game} detail={r.detail} value={r.display} unit={b.unit} divider={i > 0}
                            compactDate onOpenPlayer={onOpenPlayer} onOpenGame={onOpenGame} />
                        ))}
                      {b.more > 0 && (
                        <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.disabled', textAlign: 'center', pt: 1, borderTop: '1px solid', borderColor: 'divider' }}>
                          And {b.more} more with {b.rows[b.rows.length - 1].display} {b.unit}
                        </Typography>
                      )}
                    </SectionCard>
                  ))}
                </Box>
              ))}
            </Box>
          )}
        </Box>
      )}
    </Box>
  )
}
