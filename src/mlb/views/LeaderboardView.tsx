import { TeamLogo } from '../components/TeamLogo'
import React, { useRef, useState } from 'react'
import {
  Box, Typography, Popover,
} from '@mui/material'
import { LeaderboardEntry } from '../types'
import { ACCENT, ACCENT_TEXT, HITTING_STAT_DEFS, PITCHING_STAT_DEFS, TEAM_SEASONS, LB_FEATURED, CURRENT_SEASON } from '../constants'
import { filterQualified } from '../lib/utils'
import { GAME_SCOPES, GAME_SCOPE_LABEL } from '../lib/gameScope'
import type { GameScope } from '../lib/gameScope'
import { chromePx, typePx } from '../../ui/scale'
import { FilterChip, FilterSelect, filterChipSx } from '../../ui/FilterChip'
import { playerLink } from '../lib/links'
import { pressable } from '../../ui/interaction'
import { mlbUrlFor } from '../routes'
import { StatsFilterSheet, controlPill } from './StatsRankedList'
import { FieldingLeaders } from './FieldingLeaders'
import { LeaderCard, LeaderCardSkeleton, LEADER_GRID_SX, LEADERS_SHOWN, PORTRAIT_PX, printedRanks } from '../../ui/leaders'

import { StatsBar, STATS_BOARD_ROOT_SX } from './StatsBar'
import { PlayerHeadshot } from '../components/leaderboards'

export interface LeaderboardViewProps {
  /** The Stats tab's board row, which the pinned bar carries (StatsBar). */
  boardTabs: React.ReactNode
  lbGroup: 'hitting' | 'pitching'
  /** The board is on its Fielding side: the fielding cards replace the bat or the arm's. */
  fielding: boolean
  /** The Fielding table ranked by this column, from a fielding card's "See all". */
  onOpenFielding: (key: string) => void
  /** The Stats tab's Hitting / Pitching / Fielding switch, built once by the section (MlbStats) so
   *  every board draws the same control in the same place. */
  sideSwitch: React.ReactNode
  vizSeason: number
  setVizSeason: (s: number) => void
  gameScope: GameScope
  setGameScope: (s: GameScope) => void
  lbData: LeaderboardEntry[] | null
  loadingLb: boolean
  lbSelectedKeys: string[]
  setLbSelectedKeys: (keys: string[] | ((prev: string[]) => string[])) => void
  isDesktop: boolean
  canHover: boolean
  handleLbPlayerClick: (playerId: number) => void
  /** Open the Table ranked by this stat (useMlbState.openStatsBoard). */
  onOpenStats: (statKey: string) => void
}

export function LeaderboardView({
  boardTabs, lbGroup, fielding, onOpenFielding, sideSwitch, vizSeason, setVizSeason, gameScope, setGameScope,
  lbData, loadingLb, lbSelectedKeys, setLbSelectedKeys,
  isDesktop, canHover, handleLbPlayerClick, onOpenStats,
}: LeaderboardViewProps) {
  const [lbPickerAnchor, setLbPickerAnchor] = useState<HTMLElement | null>(null)
  const [lbHoverId, setLbHoverId] = useState<number | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const statsPillRef = useRef<HTMLElement | null>(null)
  const filtersSet = vizSeason !== CURRENT_SEASON || gameScope !== 'regular'
  // Which cards: on the Fielding side the four are fixed (FieldingLeaders), so there is no picker.
  const canPick = !fielding

  const lbAllDefs = (lbGroup === 'hitting' ? HITTING_STAT_DEFS : PITCHING_STAT_DEFS).filter(d => d.leaderCategory)
  const lbFeatured = LB_FEATURED[lbGroup]
  const lbSortedDefs = [...lbAllDefs].sort((a, b) => {
    const ai = lbFeatured.indexOf(a.key), bi = lbFeatured.indexOf(b.key)
    if (ai !== -1 && bi !== -1) return ai - bi
    if (ai !== -1) return -1
    if (bi !== -1) return 1
    return (a.leaderLabel ?? a.label).localeCompare(b.leaderLabel ?? b.label)
  })
  const lbIsDefault = lbFeatured.length === lbSelectedKeys.length && lbFeatured.every(k => lbSelectedKeys.includes(k))
  const allLbKeys = lbAllDefs.map(d => d.key)

  return (
    <Box sx={STATS_BOARD_ROOT_SX}>
      <StatsBar tabs={boardTabs} isDesktop={isDesktop}>
      {/* Desktop controls: room for every one of them in a row. */}
      {isDesktop && <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1.5 }}>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          {sideSwitch}
          {/* Filters, so chips, as on the Players board and on every WPBL board. */}
          {GAME_SCOPES.map(sc => (
            <FilterChip key={sc} active={gameScope === sc} onClick={() => setGameScope(sc)}>{GAME_SCOPE_LABEL[sc]}</FilterChip>
          ))}
        </Box>
        {/* The chip family on the right too, as WPBL's Players board draws its club chips. The
            "Show all" switch that sat here is gone: the picker's own "All" does the same thing. */}
        <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center', flexWrap: 'wrap' }}>
          <FilterSelect
            ariaLabel="Season"
            value={String(vizSeason)}
            options={TEAM_SEASONS.map(y => ({ value: String(y), label: String(y) }))}
            onChange={v => setVizSeason(Number(v))}
            active={vizSeason !== CURRENT_SEASON}
          />
          {canPick && (
            <Box
              ref={statsPillRef} {...pressable(() => setLbPickerAnchor(statsPillRef.current))}
              aria-haspopup="dialog" aria-expanded={!!lbPickerAnchor}
              sx={{ ...filterChipSx(!!lbPickerAnchor || !lbIsDefault), gap: 0.4 }}
            >
              Stats{!lbIsDefault ? ` (${lbSelectedKeys.length})` : ''}
              <Box component="span" sx={{ fontSize: '0.6rem' }}>▾</Box>
            </Box>
          )}
        </Box>
      </Box>}

      {/* Phone controls, the Table's design: the switch that changes the whole board stays visible,
          and everything else is ONE pill that opens a sheet. The cards picker had a pill of its own
          beside Filters, and with Fielding in the switch the three came to more than the row: the
          picker is a group in the sheet now, and the dot counts it as set. */}
      {!isDesktop && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
          {sideSwitch}
          <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Box {...pressable(() => setFiltersOpen(true))} aria-haspopup="dialog" aria-expanded={filtersOpen}
              sx={controlPill(filtersSet || (canPick && !lbIsDefault))}>
              Filters
              {(filtersSet || (canPick && !lbIsDefault)) && <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: ACCENT }} />}
              <Box component="span" sx={{ fontSize: '0.6rem' }}>▾</Box>
            </Box>
          </Box>
        </Box>
      )}
      </StatsBar>
      {filtersOpen && !isDesktop && (
        <StatsFilterSheet
          allTime={false}
          seasonValue={String(vizSeason)}
          onSeason={v => setVizSeason(Number(v))}
          scope={gameScope} scopes={GAME_SCOPES} onScope={setGameScope}
          canQualify={false} qualified onQualified={() => {}}
          cards={canPick ? {
            options: lbSortedDefs.map(d => ({ key: d.key, label: d.leaderLabel ?? d.label })),
            selected: lbSelectedKeys,
            onToggle: key => setLbSelectedKeys(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]),
            onReset: lbIsDefault ? undefined : () => setLbSelectedKeys([...lbFeatured]),
          } : undefined}
          onClose={() => setFiltersOpen(false)} />
      )}

      <Popover
        open={Boolean(lbPickerAnchor)}
        anchorEl={lbPickerAnchor}
        onClose={() => setLbPickerAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { borderRadius: 2.5, p: 1.75, mt: 0.75, width: chromePx(280), boxShadow: '0 8px 32px rgba(0,0,0,0.14)' } } }}
      >
        {(() => {
          const allLbSelected = allLbKeys.length > 0 && allLbKeys.every(k => lbSelectedKeys.includes(k))
          return (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
              <Typography sx={{ fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: typePx(1.6), color: 'text.disabled' }}>
                Leaderboard stats
              </Typography>
              <Box
                {...pressable(() => setLbSelectedKeys(allLbSelected ? [...lbFeatured] : allLbKeys))}
                sx={{ fontSize: '0.68rem', fontWeight: 700, color: ACCENT_TEXT, cursor: 'pointer', userSelect: 'none' }}
              >
                {allLbSelected ? 'Reset' : 'All'}
              </Box>
            </Box>
          )
        })()}
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.65 }}>
          {lbSortedDefs.map((def, i) => {
            const isFeatured = lbFeatured.includes(def.key)
            const prevFeatured = i > 0 && lbFeatured.includes(lbSortedDefs[i - 1].key)
            return (
              <React.Fragment key={def.key}>
                {!isFeatured && prevFeatured && (
                  <Box sx={{ width: '100%', borderTop: '1px solid', borderColor: 'divider', my: 0.5 }} />
                )}
                <FilterChip
                  active={lbSelectedKeys.includes(def.key)}
                  onClick={() => setLbSelectedKeys(prev =>
                    prev.includes(def.key)
                      ? prev.filter(k => k !== def.key)
                      : [...prev, def.key]
                  )}
                >{def.leaderLabel ?? def.label}</FilterChip>
              </React.Fragment>
            )
          })}
        </Box>
        {!lbIsDefault && (
          <Box
            {...pressable(() => setLbSelectedKeys([...lbFeatured]))}
            sx={{ mt: 1.25, pt: 1, borderTop: '1px solid', borderColor: 'divider', fontSize: '0.7rem', color: 'text.disabled', cursor: 'pointer', fontWeight: 600, '&:hover': { color: ACCENT_TEXT } }}
          >
            ↩ Reset to featured
          </Box>
        )}
      </Popover>

      {/* LOADING IS THE BOARD DRAWN EMPTY: the same cards under their real titles, which need no
          data, each holding its rows open. It was a centred spinner, which left the footer in view
          on a phone and threw it 500px down when the cards landed. */}
      {fielding && (
        <FieldingLeaders season={vizSeason} gameScope={gameScope} canHover={canHover}
          onOpenPlayer={handleLbPlayerClick} onSeeAll={onOpenFielding} />
      )}

      {!fielding && loadingLb && (
        <Box aria-hidden sx={LEADER_GRID_SX}>
          {lbSortedDefs.filter(d => lbSelectedKeys.includes(d.key)).map(def => (
            <LeaderCardSkeleton key={def.key} title={def.leaderLabel ?? def.label} />
          ))}
        </Box>
      )}

      {!fielding && !loadingLb && lbData && lbData.length === 0 && gameScope === 'post' && (
        <Typography sx={{ textAlign: 'center', py: 6, color: 'text.secondary', fontSize: '0.9rem' }}>
          No playoff games in {vizSeason}{vizSeason >= CURRENT_SEASON ? ' yet' : ''}.
        </Typography>
      )}

      {!fielding && !loadingLb && lbData && (() => {
        const defs = lbSortedDefs.filter(d => lbSelectedKeys.includes(d.key))
        // Qualification only applies to rate stats. Otherwise a player with a
        // handful of ABs/IP could camp the top of AVG/ERA. Counting-stat boards
        // (SB, HR, saves…) must include everyone, since part-time players can
        // still lead them.
        const qualifiedData = filterQualified(lbData, lbGroup, gameScope)
        return (
          // The shared card (src/ui/leaders.tsx), WPBL's too: five rows, plain ranks, no medals.
          <Box onMouseLeave={() => setLbHoverId(null)} sx={LEADER_GRID_SX}>
            {defs.map(def => {
              const asc = def.lowerIsBetter ?? false
              const pool = def.isRate ? qualifiedData : lbData
              const entries = pool
                .map(e => ({ ...e, sortVal: Number(def.leaderValue ? def.leaderValue(e.stat) : def.getValue(e.stat)) }))
                .filter(e => !isNaN(e.sortVal))
                .sort((a, b) => asc ? a.sortVal - b.sortVal : b.sortVal - a.sortVal)
                .slice(0, LEADERS_SHOWN)
              if (!entries.length) return null
              const texts = entries.map(e => def.format(def.getValue(e.stat)))
              const ranks = printedRanks(texts)
              const tableHref = mlbUrlFor({ view: 'stats', lb: lbGroup, season: vizSeason, games: gameScope, sort: def.key }, CURRENT_SEASON)
              return (
                <LeaderCard key={def.key} title={def.leaderLabel ?? def.label}
                  seeAll={{ href: tableHref, onClick: () => onOpenStats(def.key) }}
                  hoverKey={lbHoverId == null ? null : String(lbHoverId)}
                  onHover={canHover ? k => setLbHoverId(k == null ? null : Number(k)) : undefined}
                  items={entries.map((e, i) => ({
                    key: String(e.playerId), ...ranks[i], name: e.playerName, value: texts[i],
                    portrait: <PlayerHeadshot variant="ring" playerId={e.playerId} name={e.playerName} teamId={e.teamId} size={PORTRAIT_PX} />,
                    badge: e.teamId > 0 ? <TeamLogo teamId={e.teamId} abbr={e.teamAbbr} size={16} /> : undefined,
                    linkProps: playerLink(e.playerId, e.playerName, handleLbPlayerClick),
                  }))} />
              )
            })}
          </Box>
        )
      })()}
    </Box>
  )
}
