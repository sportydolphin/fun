import React, { useRef, useState } from 'react'
import {
  Box, Typography, Popover, Switch,
} from '@mui/material'
import { Tune, KeyboardArrowDown } from '@mui/icons-material'
import { LeaderboardEntry } from '../types'
import { ACCENT, ACCENT_TEXT, HITTING_STAT_DEFS, PITCHING_STAT_DEFS, TEAM_SEASONS, LB_FEATURED, CURRENT_SEASON } from '../constants'
import { PillChip, pillActionSx } from '../components/ui'
import { filterQualified } from '../lib/utils'
import { GAME_SCOPES, GAME_SCOPE_LABEL } from '../lib/gameScope'
import type { GameScope } from '../lib/gameScope'
import { chromePx, typePx } from '../../ui/scale'
import { PillGroup } from '../../ui/PillGroup'
import { playerLink } from '../lib/links'
import { pressable } from '../../ui/interaction'
import { mlbUrlFor } from '../routes'
import { StatsFilterSheet, controlPill } from './StatsRankedList'
import { LeaderCard, LeaderCardSkeleton, LEADER_GRID_SX, LEADERS_SHOWN, PORTRAIT_PX, printedRanks } from '../../ui/leaders'
import { LogoBubble } from '../components/boxScore'

export interface LeaderboardViewProps {
  lbGroup: 'hitting' | 'pitching'
  setLbGroup: (g: 'hitting' | 'pitching') => void
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
  lbGroup, setLbGroup, vizSeason, setVizSeason, gameScope, setGameScope,
  lbData, loadingLb, lbSelectedKeys, setLbSelectedKeys,
  isDesktop, canHover, handleLbPlayerClick, onOpenStats,
}: LeaderboardViewProps) {
  const [lbPickerAnchor, setLbPickerAnchor] = useState<HTMLElement | null>(null)
  const [lbHoverId, setLbHoverId] = useState<number | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const statsPillRef = useRef<HTMLElement | null>(null)
  const filtersSet = vizSeason !== CURRENT_SEASON || gameScope !== 'regular'

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
  const lbShowAll = allLbKeys.length > 0 && allLbKeys.every(k => lbSelectedKeys.includes(k))

  return (
    <Box>
      {/* Desktop controls: room for every one of them in a row. */}
      {isDesktop && <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2.5, flexWrap: 'wrap', gap: 1.5 }}>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <PillGroup
            options={[{ value: 'hitting', label: 'Hitting' }, { value: 'pitching', label: 'Pitching' }]}
            value={lbGroup}
            onChange={v => setLbGroup(v as 'hitting' | 'pitching')}
          />
          <PillGroup
            options={GAME_SCOPES.map(s => ({ value: s, label: GAME_SCOPE_LABEL[s] }))}
            value={gameScope}
            onChange={v => setGameScope(v as GameScope)}
          />
        </Box>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <Box sx={{ ...pillActionSx, p: 0, '&:hover': { borderColor: ACCENT }, '&:focus-within': { borderColor: ACCENT } }}>
            <select value={vizSeason} onChange={e => setVizSeason(Number(e.target.value))}
              style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', color: 'inherit', padding: `${chromePx(6)} ${chromePx(16)}`, borderRadius: 999, fontFamily: 'inherit' }}>
              {TEAM_SEASONS.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </Box>
          {/* Show all toggle */}
          <Box
            onClick={() => setLbSelectedKeys(lbShowAll ? [...lbFeatured] : allLbKeys)}
            sx={{ display: 'flex', alignItems: 'center', gap: 0.25, cursor: 'pointer', userSelect: 'none' }}
          >
            <Typography sx={{ fontSize: '0.78rem', fontWeight: 600, color: lbShowAll ? ACCENT_TEXT : 'text.secondary' }}>
              Show all
            </Typography>
            <Switch
              size="small"
              checked={lbShowAll}
              onChange={() => setLbSelectedKeys(lbShowAll ? [...lbFeatured] : allLbKeys)}
              sx={{ '& .MuiSwitch-switchBase.Mui-checked': { color: ACCENT_TEXT }, '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { bgcolor: ACCENT } }}
            />
          </Box>
          {/* Stats picker button */}
          <Box
            onClick={e => setLbPickerAnchor(e.currentTarget as HTMLElement)}
            sx={{
              ...pillActionSx,
              borderColor: lbPickerAnchor ? ACCENT : lbIsDefault ? 'divider' : ACCENT,
              color: lbPickerAnchor ? ACCENT_TEXT : lbIsDefault ? 'text.secondary' : ACCENT_TEXT,
              bgcolor: lbPickerAnchor || !lbIsDefault ? `${ACCENT}10` : 'transparent',
            }}
          >
            <Tune sx={{ fontSize: '0.85rem' }} />
            Stats{!lbIsDefault ? ` (${lbSelectedKeys.length})` : ''}
            <KeyboardArrowDown sx={{ fontSize: '0.85rem' }} />
          </Box>
        </Box>
      </Box>}

      {/* Phone controls, the Table's design: the switch that changes the whole board stays visible,
          and everything else is a pill that says what it is set to and opens a sheet. The desktop
          row wrapped onto three lines at 375px before a single leader was on screen. */}
      {!isDesktop && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 1.5, flexWrap: 'wrap' }}>
          <PillGroup
            options={[{ value: 'hitting', label: 'Hitting' }, { value: 'pitching', label: 'Pitching' }]}
            value={lbGroup}
            onChange={v => setLbGroup(v as 'hitting' | 'pitching')}
          />
          <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Box ref={statsPillRef} {...pressable(() => setLbPickerAnchor(statsPillRef.current))}
              aria-haspopup="dialog" aria-expanded={!!lbPickerAnchor} sx={controlPill(!lbIsDefault)}>
              Stats{!lbIsDefault ? ` (${lbSelectedKeys.length})` : ''}
              <Box component="span" sx={{ fontSize: '0.6rem' }}>▾</Box>
            </Box>
            <Box {...pressable(() => setFiltersOpen(true))} aria-haspopup="dialog" aria-expanded={filtersOpen} sx={controlPill(filtersSet)}>
              Filters
              {filtersSet && <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: ACCENT }} />}
              <Box component="span" sx={{ fontSize: '0.6rem' }}>▾</Box>
            </Box>
          </Box>
        </Box>
      )}
      {filtersOpen && !isDesktop && (
        <StatsFilterSheet
          allTime={false}
          seasonValue={String(vizSeason)}
          onSeason={v => setVizSeason(Number(v))}
          scope={gameScope} scopes={GAME_SCOPES} onScope={setGameScope}
          canQualify={false} qualified onQualified={() => {}}
          onClose={() => setFiltersOpen(false)} />
      )}

      <Popover
        open={Boolean(lbPickerAnchor)}
        anchorEl={lbPickerAnchor}
        onClose={() => setLbPickerAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        PaperProps={{ sx: { borderRadius: 2.5, p: 1.75, mt: 0.75, width: chromePx(280), boxShadow: '0 8px 32px rgba(0,0,0,0.14)' } }}
      >
        {(() => {
          const allLbSelected = allLbKeys.every(k => lbSelectedKeys.includes(k))
          return (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
              <Typography sx={{ fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: typePx(1.6), color: 'text.disabled' }}>
                Leaderboard stats
              </Typography>
              <Box
                onClick={() => setLbSelectedKeys(allLbSelected ? [...lbFeatured] : allLbKeys)}
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
                <PillChip
                  label={def.leaderLabel ?? def.label}
                  selected={lbSelectedKeys.includes(def.key)}
                  onChange={() => setLbSelectedKeys(prev =>
                    prev.includes(def.key)
                      ? prev.filter(k => k !== def.key)
                      : [...prev, def.key]
                  )}
                />
              </React.Fragment>
            )
          })}
        </Box>
        {!lbIsDefault && (
          <Box
            onClick={() => setLbSelectedKeys([...lbFeatured])}
            sx={{ mt: 1.25, pt: 1, borderTop: '1px solid', borderColor: 'divider', fontSize: '0.7rem', color: 'text.disabled', cursor: 'pointer', fontWeight: 600, '&:hover': { color: ACCENT_TEXT } }}
          >
            ↩ Reset to featured
          </Box>
        )}
      </Popover>

      {/* LOADING IS THE BOARD DRAWN EMPTY: the same cards under their real titles, which need no
          data, each holding its rows open. It was a centred spinner, which left the footer in view
          on a phone and threw it 500px down when the cards landed. */}
      {loadingLb && (
        <Box aria-hidden sx={LEADER_GRID_SX}>
          {lbSortedDefs.filter(d => lbSelectedKeys.includes(d.key)).map(def => (
            <LeaderCardSkeleton key={def.key} title={def.leaderLabel ?? def.label} />
          ))}
        </Box>
      )}

      {!loadingLb && lbData && lbData.length === 0 && gameScope === 'post' && (
        <Typography sx={{ textAlign: 'center', py: 6, color: 'text.secondary', fontSize: '0.9rem' }}>
          No playoff games in {vizSeason}{vizSeason >= CURRENT_SEASON ? ' yet' : ''}.
        </Typography>
      )}

      {!loadingLb && lbData && (() => {
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
                    portrait: <Box component="img" loading="lazy" alt=""
                      src={`https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_213,q_auto:best/v1/people/${e.playerId}/headshot/67/current`}
                      sx={{ width: chromePx(PORTRAIT_PX), height: chromePx(PORTRAIT_PX), borderRadius: '50%', objectFit: 'cover', flexShrink: 0, bgcolor: 'action.hover' }} />,
                    badge: e.teamId > 0 ? <LogoBubble teamId={e.teamId} abbr={e.teamAbbr} size={16} ring={1} /> : undefined,
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
