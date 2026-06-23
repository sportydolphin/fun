import React, { useState } from 'react'
import {
  Box, Typography, Paper, CircularProgress, Popover, Tooltip, Switch,
} from '@mui/material'
import { Tune, KeyboardArrowDown, OpenInFull } from '@mui/icons-material'
import { StatDef, LbFullscreenState } from '../types'
import { ACCENT, HITTING_STAT_DEFS, PITCHING_STAT_DEFS, TEAM_SEASONS, LB_FEATURED } from '../constants'
import { SegControl, PillChip, pillActionSx } from '../ui'
import { filterQualified } from '../utils'

export interface LeaderboardViewProps {
  lbGroup: 'hitting' | 'pitching'
  setLbGroup: (g: 'hitting' | 'pitching') => void
  vizSeason: number
  setVizSeason: (s: number) => void
  lbData: Array<{ playerId: number; playerName: string; teamAbbr: string; teamId: number; stat: any }> | null
  loadingLb: boolean
  lbSelectedKeys: string[]
  setLbSelectedKeys: (keys: string[] | ((prev: string[]) => string[])) => void
  isDesktop: boolean
  canHover: boolean
  handleLbPlayerClick: (playerId: number) => void
  onOpenStats: (fullscreen: LbFullscreenState) => void
}

export function LeaderboardView({
  lbGroup, setLbGroup, vizSeason, setVizSeason,
  lbData, loadingLb, lbSelectedKeys, setLbSelectedKeys,
  isDesktop, canHover, handleLbPlayerClick, onOpenStats,
}: LeaderboardViewProps) {
  const [lbPickerAnchor, setLbPickerAnchor] = useState<HTMLElement | null>(null)
  const [lbHoverId, setLbHoverId] = useState<number | null>(null)

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
      {/* Controls row */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2.5, flexWrap: 'wrap', gap: 1.5 }}>
        <SegControl
          options={[{ value: 'hitting', label: 'Hitting' }, { value: 'pitching', label: 'Pitching' }]}
          value={lbGroup}
          onChange={v => setLbGroup(v as 'hitting' | 'pitching')}
        />
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <Box sx={{ ...pillActionSx, p: 0, '&:hover': { borderColor: ACCENT }, '&:focus-within': { borderColor: ACCENT } }}>
            <select value={vizSeason} onChange={e => setVizSeason(Number(e.target.value))}
              style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', color: 'inherit', padding: '6px 16px', borderRadius: 999, fontFamily: 'inherit' }}>
              {TEAM_SEASONS.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </Box>
          {/* Show all toggle */}
          <Box
            onClick={() => setLbSelectedKeys(lbShowAll ? [...lbFeatured] : allLbKeys)}
            sx={{ display: 'flex', alignItems: 'center', gap: 0.25, cursor: 'pointer', userSelect: 'none' }}
          >
            <Typography sx={{ fontSize: '0.78rem', fontWeight: 600, color: lbShowAll ? ACCENT : 'text.secondary' }}>
              Show all
            </Typography>
            <Switch
              size="small"
              checked={lbShowAll}
              onChange={() => setLbSelectedKeys(lbShowAll ? [...lbFeatured] : allLbKeys)}
              sx={{ '& .MuiSwitch-switchBase.Mui-checked': { color: ACCENT }, '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { bgcolor: ACCENT } }}
            />
          </Box>
          {/* Stats picker button */}
          <Box
            onClick={e => setLbPickerAnchor(e.currentTarget as HTMLElement)}
            sx={{
              ...pillActionSx,
              borderColor: lbPickerAnchor ? ACCENT : lbIsDefault ? 'divider' : ACCENT,
              color: lbPickerAnchor ? ACCENT : lbIsDefault ? 'text.secondary' : ACCENT,
              bgcolor: lbPickerAnchor || !lbIsDefault ? `${ACCENT}10` : 'transparent',
            }}
          >
            <Tune sx={{ fontSize: '0.85rem' }} />
            Stats{!lbIsDefault ? ` (${lbSelectedKeys.length})` : ''}
            <KeyboardArrowDown sx={{ fontSize: '0.85rem' }} />
          </Box>
          <Popover
            open={Boolean(lbPickerAnchor)}
            anchorEl={lbPickerAnchor}
            onClose={() => setLbPickerAnchor(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            PaperProps={{ sx: { borderRadius: 2.5, p: 1.75, mt: 0.75, width: 280, boxShadow: '0 8px 32px rgba(0,0,0,0.14)' } }}
          >
            {(() => {
              const allLbSelected = allLbKeys.every(k => lbSelectedKeys.includes(k))
              return (
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                  <Typography sx={{ fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.6, color: 'text.disabled' }}>
                    Leaderboard stats
                  </Typography>
                  <Box
                    onClick={() => setLbSelectedKeys(allLbSelected ? [...lbFeatured] : allLbKeys)}
                    sx={{ fontSize: '0.68rem', fontWeight: 700, color: ACCENT, cursor: 'pointer', userSelect: 'none' }}
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
                sx={{ mt: 1.25, pt: 1, borderTop: '1px solid', borderColor: 'divider', fontSize: '0.7rem', color: 'text.disabled', cursor: 'pointer', fontWeight: 600, '&:hover': { color: ACCENT } }}
              >
                ↩ Reset to featured
              </Box>
            )}
          </Popover>
        </Box>
      </Box>

      {loadingLb && <Box sx={{ textAlign: 'center', py: 6 }}><CircularProgress size={28} /></Box>}

      {!loadingLb && lbData && (() => {
        const defs = lbSortedDefs.filter(d => lbSelectedKeys.includes(d.key))
        const MEDALS = ['🥇', '🥈', '🥉']
        const maxEntries = lbIsDefault && isDesktop ? 10 : 5
        // Collapsed cards only show qualified players by default — otherwise a
        // player with a handful of ABs/IP can camp the top of a rate stat.
        const qualifiedData = filterQualified(lbData, lbGroup)
        return (
          <Box
            onMouseLeave={() => setLbHoverId(null)}
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)' },
              gap: 2,
            }}
          >
            {defs.map(def => {
              const asc = def.lowerIsBetter ?? false
              const allEntries = qualifiedData
                .map(e => {
                  const sortVal = def.leaderValue ? def.leaderValue(e.stat) : def.getValue(e.stat)
                  return { ...e, val: def.getValue(e.stat), sortVal }
                })
                .filter(e => e.sortVal != null && !isNaN(Number(e.sortVal)))
                .sort((a, b) => asc ? Number(a.sortVal) - Number(b.sortVal) : Number(b.sortVal) - Number(a.sortVal))
              const entries = allEntries.slice(0, maxEntries)
              if (!entries.length) return null
              return (
                <Paper key={def.key} elevation={2} sx={{ borderRadius: 3, overflow: 'hidden' }}>
                  {/* Card header with gradient */}
                  <Box sx={{
                    px: 2, py: 1.25,
                    background: `linear-gradient(135deg, ${ACCENT}22 0%, transparent 100%)`,
                    borderBottom: '1px solid',
                    borderColor: 'divider',
                    display: 'flex', alignItems: 'center',
                  }}>
                    <Box sx={{ flex: 1 }}>
                      <Typography sx={{ fontWeight: 800, fontSize: '0.92rem', letterSpacing: '-0.2px', lineHeight: 1.2 }}>
                        {def.leaderLabel ?? def.label}
                      </Typography>
                      {def.lowerIsBetter && (
                        <Typography sx={{ fontSize: '0.6rem', color: 'text.disabled', fontWeight: 600, mt: 0.15 }}>
                          lower = better
                        </Typography>
                      )}
                    </Box>
                    <Tooltip title="Fullscreen">
                      <Box
                        onClick={(ev: React.MouseEvent) => {
                          ev.stopPropagation()
                          onOpenStats({ def, group: lbGroup, sortKey: def.key, sortAsc: def.lowerIsBetter ?? false, entries: allEntries.slice(0, 50) })
                        }}
                        sx={{
                          cursor: 'pointer', color: 'text.disabled', ml: 1, p: 0.5, borderRadius: 1,
                          display: 'flex', alignItems: 'center',
                          '&:hover': { color: ACCENT, bgcolor: `${ACCENT}18` },
                          transition: 'color 0.15s, background 0.15s',
                        }}
                      >
                        <OpenInFull sx={{ fontSize: '0.8rem' }} />
                      </Box>
                    </Tooltip>
                  </Box>

                  {/* Player rows */}
                  <Box sx={{ px: 1.5, py: 0.75 }}>
                    {entries.map((e, rank) => {
                      const isHovered = lbHoverId === e.playerId
                      const dimmed = lbHoverId !== null && !isHovered
                      return (
                        <Box
                          key={e.playerId}
                          onMouseEnter={() => { if (canHover) setLbHoverId(e.playerId) }}
                          onClick={() => handleLbPlayerClick(e.playerId)}
                          sx={{
                            display: 'flex', alignItems: 'center', gap: 1.25,
                            py: 0.65,
                            borderBottom: rank < entries.length - 1 ? '1px solid' : 'none',
                            borderColor: 'divider',
                            borderRadius: 1.5,
                            px: 0.5,
                            cursor: 'pointer',
                            transition: 'opacity 0.18s, background 0.18s',
                            opacity: dimmed ? 0.28 : 1,
                            bgcolor: isHovered ? `${ACCENT}14` : 'transparent',
                          }}
                        >
                          {/* Medal / rank indicator */}
                          <Typography sx={{
                            fontSize: rank < 3 ? '1rem' : '0.82rem',
                            fontWeight: 800,
                            color: 'text.disabled',
                            width: 22,
                            flexShrink: 0,
                            textAlign: 'center',
                            lineHeight: 1,
                          }}>
                            {rank < 3 ? MEDALS[rank] : `${rank + 1}`}
                          </Typography>

                          {/* Portrait */}
                          <Box
                            component="img"
                            src={`https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_213,q_auto:best/v1/people/${e.playerId}/headshot/67/current`}
                            alt={e.playerName}
                            sx={{
                              width: 34, height: 34,
                              borderRadius: '50%',
                              objectFit: 'cover',
                              flexShrink: 0,
                              border: isHovered ? `2px solid ${ACCENT}` : '2px solid transparent',
                              transition: 'border-color 0.18s',
                              bgcolor: 'action.hover',
                            }}
                          />

                          {/* Name + team logo */}
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography sx={{
                              fontSize: '0.8rem', fontWeight: 700, lineHeight: 1.2,
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                              color: isHovered ? ACCENT : 'text.primary',
                              transition: 'color 0.18s',
                            }}>
                              {e.playerName}
                            </Typography>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.1 }}>
                              {e.teamId > 0 && (
                                <Box sx={{
                                  width: 16, height: 16, borderRadius: '50%',
                                  bgcolor: '#fff',
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  flexShrink: 0, overflow: 'hidden',
                                }}>
                                  <Box
                                    component="img"
                                    src={`https://www.mlbstatic.com/team-logos/${e.teamId}.svg`}
                                    alt={e.teamAbbr}
                                    sx={{ width: 12, height: 12, objectFit: 'contain' }}
                                    onError={(ev: React.SyntheticEvent<HTMLImageElement>) => {
                                      ev.currentTarget.parentElement!.style.display = 'none'
                                    }}
                                  />
                                </Box>
                              )}
                              <Typography sx={{ fontSize: '0.62rem', color: 'text.disabled', fontWeight: 600, lineHeight: 1 }}>
                                {e.teamAbbr}
                              </Typography>
                            </Box>
                          </Box>

                          {/* Stat value */}
                          <Typography sx={{
                            fontSize: '0.9rem', fontWeight: 800, flexShrink: 0,
                            color: rank === 0 ? ACCENT : isHovered ? ACCENT : 'text.primary',
                            transition: 'color 0.18s',
                          }}>
                            {def.format(e.val)}
                          </Typography>
                        </Box>
                      )
                    })}
                  </Box>
                </Paper>
              )
            })}
          </Box>
        )
      })()}
    </Box>
  )
}
