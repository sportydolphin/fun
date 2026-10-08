import React, { useRef, useState } from 'react'
import {
  Box, Typography, Paper, Skeleton, Popover, Switch,
} from '@mui/material'
import { Tune, KeyboardArrowDown } from '@mui/icons-material'
import { LeaderboardEntry } from '../types'
import { ACCENT, ACCENT_TEXT, HITTING_STAT_DEFS, PITCHING_STAT_DEFS, TEAM_SEASONS, LB_FEATURED, CURRENT_SEASON } from '../constants'
import { PillChip, pillActionSx } from '../components/ui'
import { filterQualified } from '../lib/utils'
import { GAME_SCOPES, GAME_SCOPE_LABEL } from '../lib/gameScope'
import type { GameScope } from '../lib/gameScope'
import { useIsDark, teamLogoBg, teamLogoSrc, teamLogoCrop } from '../lib/colorUtils'
import { chromePx, typePx } from '../../ui/scale'
import { PillGroup } from '../../ui/PillGroup'
import { playerLink, LINK_SX } from '../lib/links'
import { pressable, linkPress, FOCUS_RING } from '../../ui/interaction'
import { rankMarks } from '../lib/statsBoard'
import { mlbUrlFor } from '../routes'
import { StatsFilterSheet, controlPill } from './StatsRankedList'

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
  const isDark = useIsDark()

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
  const maxEntries = lbIsDefault && isDesktop ? 10 : 5
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
        <Box aria-hidden sx={LB_GRID}>
          {lbSortedDefs.filter(d => lbSelectedKeys.includes(d.key)).map(def => (
            <Paper key={def.key} elevation={2} sx={{ borderRadius: 3, overflow: 'hidden' }}>
              <LbCardHead label={def.leaderLabel ?? def.label} lowerIsBetter={def.lowerIsBetter} />
              <Box sx={{ px: 1.5, py: 0.75 }}>
                {Array.from({ length: maxEntries }, (_, rank) => (
                  <Box key={rank} sx={{ ...lbRowSx(rank < maxEntries - 1), display: 'flex' }}>
                    <Typography sx={{ ...LB_RANK, fontSize: rank < 3 ? '1rem' : '0.82rem' }}>&nbsp;</Typography>
                    <Skeleton variant="circular" sx={{ width: chromePx(34), height: chromePx(34), flexShrink: 0 }} />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={LB_NAME}><Skeleton width="70%" /></Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.1 }}>
                        <Skeleton variant="circular" sx={{ width: chromePx(16), height: chromePx(16), flexShrink: 0 }} />
                        <Typography sx={LB_TEAM}><Skeleton width="1.5rem" /></Typography>
                      </Box>
                    </Box>
                    <Typography sx={LB_VALUE}><Skeleton width="2rem" /></Typography>
                  </Box>
                ))}
              </Box>
              <Box sx={{ ...LB_FOOT, color: 'text.disabled' }}><Skeleton width="5rem" /></Box>
            </Paper>
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
        const MEDALS = ['🥇', '🥈', '🥉']
        // A medal is a place nobody shares; a tie on the podium prints "T-2" like any other tie.
        const medal = (m: { n: number; tied: boolean }) => m.n <= 3 && !m.tied
        // Qualification only applies to rate stats. Otherwise a player with a
        // handful of ABs/IP could camp the top of AVG/ERA. Counting-stat boards
        // (SB, HR, saves…) must include everyone, since part-time players can
        // still lead them.
        const qualifiedData = filterQualified(lbData, lbGroup, gameScope)
        return (
          <Box
            onMouseLeave={() => setLbHoverId(null)}
            sx={LB_GRID}
          >
            {defs.map(def => {
              const asc = def.lowerIsBetter ?? false
              const pool = def.isRate ? qualifiedData : lbData
              const allEntries = pool
                .map(e => {
                  const sortVal = def.leaderValue ? def.leaderValue(e.stat) : def.getValue(e.stat)
                  return { ...e, val: def.getValue(e.stat), sortVal }
                })
                .filter(e => e.sortVal != null && !isNaN(Number(e.sortVal)))
                .sort((a, b) => asc ? Number(a.sortVal) - Number(b.sortVal) : Number(b.sortVal) - Number(a.sortVal))
              const entries = allEntries.slice(0, maxEntries)
              if (!entries.length) return null
              // Shared places, as the Table numbers them: two players on 45 home runs are both
              // first, and a gold and a silver between them would say one of them leads.
              const marks = rankMarks(entries.map(e => Number(e.sortVal)))
              const tableHref = mlbUrlFor({ view: 'stats', lb: lbGroup, season: vizSeason, games: gameScope, sort: def.key }, CURRENT_SEASON)
              return (
                <Paper key={def.key} elevation={2} sx={{ borderRadius: 3, overflow: 'hidden' }}>
                  <LbCardHead label={def.leaderLabel ?? def.label} lowerIsBetter={def.lowerIsBetter} />

                  {/* Player rows */}
                  <Box sx={{ px: 1.5, py: 0.75 }}>
                    {entries.map((e, rank) => {
                      const isHovered = lbHoverId === e.playerId
                      const dimmed = lbHoverId !== null && !isHovered
                      return (
                        <Box
                          key={e.playerId}
                          onMouseEnter={() => { if (canHover) setLbHoverId(e.playerId) }}
                          {...playerLink(e.playerId, e.playerName, handleLbPlayerClick)}
                          sx={{
                            ...LINK_SX, ...lbRowSx(rank < entries.length - 1), display: 'flex',
                            cursor: 'pointer',
                            transition: 'opacity 0.18s, background 0.18s',
                            opacity: dimmed ? 0.28 : 1,
                            bgcolor: isHovered ? `${ACCENT}14` : 'transparent',
                          }}
                        >
                          {/* Medal / rank indicator */}
                          <Typography sx={{ ...LB_RANK, fontSize: medal(marks[rank]) ? '1rem' : '0.82rem' }}>
                            {medal(marks[rank]) ? MEDALS[marks[rank].n - 1] : `${marks[rank].tied ? 'T-' : ''}${marks[rank].n}`}
                          </Typography>

                          {/* Portrait */}
                          <Box
                            component="img"
                            src={`https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_213,q_auto:best/v1/people/${e.playerId}/headshot/67/current`}
                            alt={e.playerName}
                            sx={{
                              width: chromePx(34), height: chromePx(34),
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
                              ...LB_NAME,
                              color: isHovered ? ACCENT_TEXT : 'text.primary',
                              transition: 'color 0.18s',
                            }}>
                              {e.playerName}
                            </Typography>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.1 }}>
                              {e.teamId > 0 && (
                                <Box sx={{
                                  width: chromePx(16), height: chromePx(16), borderRadius: '50%',
                                  bgcolor: teamLogoBg(e.teamId, isDark),
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  flexShrink: 0, overflow: 'hidden',
                                }}>
                                  <Box
                                    component="img"
                                    src={teamLogoSrc(e.teamId, isDark)}
                                    alt={e.teamAbbr}
                                    sx={{ width: chromePx(12), height: chromePx(12), objectFit: 'contain', transform: teamLogoCrop(e.teamId, isDark), transformOrigin: 'center' }}
                                    onError={(ev: React.SyntheticEvent<HTMLImageElement>) => {
                                      ev.currentTarget.parentElement!.style.display = 'none'
                                    }}
                                  />
                                </Box>
                              )}
                              <Typography sx={LB_TEAM}>
                                {e.teamAbbr}
                              </Typography>
                            </Box>
                          </Box>

                          {/* Stat value */}
                          <Typography sx={{
                            ...LB_VALUE,
                            color: marks[rank].n === 1 ? ACCENT_TEXT : isHovered ? ACCENT_TEXT : 'text.primary',
                            transition: 'color 0.18s',
                          }}>
                            {def.format(e.val)}
                          </Typography>
                        </Box>
                      )
                    })}
                  </Box>
                  {/* The way from a card to the whole ranking, as a real link (the Table's address
                      carries the stat), where the old expand icon was a 13px target with no href. */}
                  <Box {...linkPress(tableHref, () => onOpenStats(def.key))} sx={{
                    ...LINK_SX, ...FOCUS_RING, ...LB_FOOT, color: 'var(--wpbl-accent-fg)',
                    '&:hover': { bgcolor: `${ACCENT}0e` },
                  }}>
                    <span>All {allEntries.length} ranked</span>
                    <span aria-hidden>→</span>
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

// One leader card's parts, shared by the loaded card and its skeleton so the two cannot drift.
const LB_GRID = { display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)' }, gap: 2 } as const
const lbRowSx = (ruled: boolean) => ({
  alignItems: 'center', gap: 1.25, py: 0.65, px: 0.5, borderRadius: 1.5,
  borderBottom: ruled ? '1px solid' : 'none', borderColor: 'divider',
}) as const
const LB_RANK = {
  fontWeight: 800, color: 'text.disabled',
  // The Table's rank width: "T-10" is the widest thing it holds.
  width: '1.875rem', whiteSpace: 'nowrap', flexShrink: 0, textAlign: 'center', lineHeight: 1,
} as const
const LB_NAME = { fontSize: '0.8rem', fontWeight: 700, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const
const LB_TEAM = { fontSize: '0.62rem', color: 'text.disabled', fontWeight: 600, lineHeight: 1 } as const
const LB_VALUE = { fontSize: '0.9rem', fontWeight: 800, flexShrink: 0 } as const
const LB_FOOT = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  px: 2, minHeight: 40, borderTop: '1px solid', borderColor: 'divider',
  fontSize: '0.74rem', fontWeight: 800,
} as const

/** A leader card's header with its gradient. */
function LbCardHead({ label, lowerIsBetter }: { label: string; lowerIsBetter?: boolean }) {
  return (
    <Box sx={{
      px: 2, py: 1.25,
      background: `linear-gradient(135deg, ${ACCENT}22 0%, transparent 100%)`,
      borderBottom: '1px solid',
      borderColor: 'divider',
      display: 'flex', alignItems: 'center',
    }}>
      <Box sx={{ flex: 1 }}>
        <Typography sx={{ fontWeight: 800, fontSize: '0.92rem', letterSpacing: typePx(-0.2), lineHeight: 1.2 }}>
          {label}
        </Typography>
        {lowerIsBetter && (
          <Typography sx={{ fontSize: '0.6rem', color: 'text.disabled', fontWeight: 600, mt: 0.15 }}>
            lower = better
          </Typography>
        )}
      </Box>
    </Box>
  )
}
