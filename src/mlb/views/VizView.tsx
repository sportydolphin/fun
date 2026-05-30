import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  Box, Typography, Paper, List, ListItemButton, Divider,
  ClickAwayListener, Tooltip, CircularProgress, IconButton,
} from '@mui/material'
import { Search, InfoOutlined, OpenInFull, Close } from '@mui/icons-material'
import { TeamSummary, SosEntry } from '../types'
import { ACCENT, TEAM_BG, TEAM_SEASONS, CURRENT_SEASON } from '../constants'
import { pillActionSx } from '../ui'
import { TeamEraOpsPlot, TeamWinRDPlot, TeamFraudPanel, PayrollWinsPlot } from '../charts'
import { fetchStrengthOfSchedule, fetchTeamPayrolls } from '../api'
import { TEAM_PAYROLLS_2026 } from '../constants'

// ─── SOS helpers ─────────────────────────────────────────────────────────────

function sosColor(norm: number): string {
  if (norm > 0.75) return '#ef4444'
  if (norm > 0.5)  return '#f97316'
  if (norm > 0.25) return '#eab308'
  return '#22c55e'
}

function SosTeamDot({ teamId, abbr, size = 26 }: { teamId: number; abbr: string; size?: number }) {
  const [failed, setFailed] = useState(false)
  const col = TEAM_BG[teamId] ?? '#555'
  return (
    <Box sx={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      bgcolor: '#fff', border: `2px solid ${col}`, boxShadow: `0 0 0 1px ${col}25`,
      display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    }}>
      {failed ? (
        <Typography sx={{ color: col, fontWeight: 900, fontSize: abbr.length > 2 ? '0.48rem' : '0.58rem', lineHeight: 1 }}>
          {abbr}
        </Typography>
      ) : (
        <Box
          component="img"
          src={`https://www.mlbstatic.com/team-logos/${teamId}.svg`}
          alt={abbr}
          onError={() => setFailed(true)}
          sx={{ width: '72%', height: '72%', objectFit: 'contain', display: 'block' }}
        />
      )}
    </Box>
  )
}

// ─── Shared modal overlay ─────────────────────────────────────────────────────

function FullscreenModal({ open, onClose, title, subtitle, children }: {
  open: boolean
  onClose: () => void
  title: React.ReactNode
  subtitle?: string
  children: React.ReactNode
}) {
  if (!open) return null
  return (
    <Box
      sx={{
        position: 'fixed', inset: 0, zIndex: 1300,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        bgcolor: 'rgba(0,0,0,0.55)', p: 2,
      }}
      onClick={onClose}
    >
      <Box
        sx={{
          bgcolor: 'background.paper',
          borderRadius: 3,
          width: '100%',
          maxWidth: 540,
          maxHeight: '86vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 24px 80px rgba(0,0,0,0.4)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <Box sx={{
          px: 2.5, py: 1.75,
          borderBottom: '1px solid', borderColor: 'divider',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <Box>
            <Typography sx={{ fontWeight: 800, fontSize: '1rem', letterSpacing: '-0.3px' }}>{title}</Typography>
            {subtitle && (
              <Typography sx={{ fontSize: '0.68rem', color: 'text.secondary', mt: 0.1 }}>{subtitle}</Typography>
            )}
          </Box>
          <IconButton size="small" onClick={onClose} sx={{ ml: 1, color: 'text.secondary', '&:hover': { color: 'text.primary' } }}>
            <Close sx={{ fontSize: '1.1rem' }} />
          </IconButton>
        </Box>
        {/* Scrollable body */}
        <Box sx={{ overflowY: 'auto', p: 2 }}>
          {children}
        </Box>
      </Box>
    </Box>
  )
}

// ─── SOS mini card (5 rows) ───────────────────────────────────────────────────

function SosMiniCard({ title, subtitle, slice, allEntries, onExpand, loading }: {
  title: React.ReactNode
  subtitle: string
  slice: SosEntry[]
  allEntries: SosEntry[]
  onExpand: () => void
  loading: boolean
}) {
  const minPct = allEntries.length ? Math.min(...allEntries.map(e => e.oppWinPct)) : 0
  const maxPct = allEntries.length ? Math.max(...allEntries.map(e => e.oppWinPct)) : 1
  const range  = maxPct - minPct || 0.001

  return (
    <Box sx={{ borderRadius: 2, border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', overflow: 'hidden' }}>
      {/* Header */}
      <Box sx={{ px: 2, py: 1.25, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid', borderColor: 'divider' }}>
        <Box>
          <Typography sx={{ fontWeight: 800, fontSize: '1rem', letterSpacing: '-0.3px' }}>{title}</Typography>
          <Typography sx={{ fontSize: '0.68rem', color: 'text.secondary', mt: 0.1 }}>{subtitle}</Typography>
        </Box>
        <Tooltip title="View all 30 teams" arrow placement="top">
          <IconButton size="small" onClick={onExpand} sx={{ color: 'text.disabled', '&:hover': { color: ACCENT } }}>
            <OpenInFull sx={{ fontSize: '1rem' }} />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Rows */}
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
          <CircularProgress size={22} sx={{ color: ACCENT }} />
        </Box>
      ) : (
        slice.map((e, idx) => {
          const norm  = (e.oppWinPct - minPct) / range
          const color = sosColor(norm)
          const barW  = `${5 + norm * 95}%`
          const pctStr = '.' + Math.round(e.oppWinPct * 1000).toString().padStart(3, '0')
          const rankInFull = allEntries.findIndex(x => x.teamId === e.teamId) + 1
          return (
            <Box key={e.teamId} sx={{
              display: 'grid',
              gridTemplateColumns: '22px 28px 1fr 60px 36px',
              alignItems: 'center', gap: 1,
              px: 1.5, py: '9px',
              borderBottom: idx < slice.length - 1 ? '1px solid' : 'none',
              borderColor: 'divider',
              borderLeft: `3px solid ${TEAM_BG[e.teamId] ?? '#444'}`,
            }}>
              <Typography sx={{ fontSize: '0.72rem', color: 'text.disabled', fontWeight: 700, textAlign: 'center' }}>
                {rankInFull}
              </Typography>
              <SosTeamDot teamId={e.teamId} abbr={e.abbr} />
              <Typography sx={{ fontSize: '0.84rem', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {e.abbr}
              </Typography>
              <Box>
                <Box sx={{ height: 6, borderRadius: 3, bgcolor: 'action.disabledBackground', overflow: 'hidden' }}>
                  <Box sx={{ height: '100%', width: barW, borderRadius: 3, bgcolor: color }} />
                </Box>
              </Box>
              <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {pctStr}
              </Typography>
            </Box>
          )
        })
      )}

      {/* Footer */}
      {!loading && (
        <Box sx={{ px: 2, py: '7px', borderTop: '1px solid', borderColor: 'divider', display: 'flex', justifyContent: 'flex-end' }}>
          <Typography onClick={onExpand} sx={{ fontSize: '0.72rem', color: ACCENT, fontWeight: 700, cursor: 'pointer', userSelect: 'none', '&:hover': { textDecoration: 'underline' } }}>
            View all 30 →
          </Typography>
        </Box>
      )}
    </Box>
  )
}

// ─── SOS full content (used inside modal) ─────────────────────────────────────

function SosFullContent({ entries, direction }: {
  entries: SosEntry[]
  direction: 'hardest' | 'easiest'
}) {
  const sorted = direction === 'easiest' ? [...entries].reverse() : entries
  const minPct = entries.length ? Math.min(...entries.map(e => e.oppWinPct)) : 0
  const maxPct = entries.length ? Math.max(...entries.map(e => e.oppWinPct)) : 1
  const range  = maxPct - minPct || 0.001

  const SOS_TIERS = [
    { maxRank: 5,  label: 'Absolute Gauntlet', emoji: '💀', color: '#ef4444' },
    { maxRank: 12, label: 'Uphill Battle',      emoji: '😤', color: '#f97316' },
    { maxRank: 20, label: 'Middle of the Pack', emoji: '⚖️',  color: '#eab308' },
    { maxRank: 26, label: 'Lucky Draw',         emoji: '😌', color: '#84cc16' },
    { maxRank: 30, label: 'Vacation Mode',      emoji: '🏖️', color: '#22c55e' },
  ]
  function tierForRank(rank: number) {
    return SOS_TIERS.find(t => rank <= t.maxRank) ?? SOS_TIERS[SOS_TIERS.length - 1]
  }

  const shownTiers = new Set<string>()

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      {sorted.map((e, idx) => {
        const rank  = idx + 1
        const norm  = (e.oppWinPct - minPct) / range
        const color = sosColor(norm)
        const barW  = `${5 + norm * 95}%`
        const pctStr = '.' + Math.round(e.oppWinPct * 1000).toString().padStart(3, '0')
        const tier = tierForRank(rank)
        const showHeader = !shownTiers.has(tier.label)
        if (showHeader) shownTiers.add(tier.label)

        return (
          <React.Fragment key={e.teamId}>
            {showHeader && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 0.5, pt: idx === 0 ? 0 : 1, pb: 0.25 }}>
                <Typography sx={{ fontSize: '0.65rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.2, color: tier.color }}>
                  {tier.emoji} {tier.label}
                </Typography>
                <Box sx={{ flex: 1, height: '1px', bgcolor: `${tier.color}30` }} />
              </Box>
            )}
            <Box sx={{
              display: 'grid',
              gridTemplateColumns: '26px 28px 1fr 50px 48px 1fr 38px',
              alignItems: 'center', gap: 1,
              px: 1.5, py: '9px',
              borderRadius: 1.5,
              border: '1px solid', borderColor: 'divider',
              bgcolor: 'background.paper',
              borderLeft: `3px solid ${TEAM_BG[e.teamId] ?? '#444'}`,
            }}>
              <Typography sx={{ fontSize: '0.76rem', fontWeight: 700, color: 'text.disabled', textAlign: 'center' }}>{rank}</Typography>
              <SosTeamDot teamId={e.teamId} abbr={e.abbr} />
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontSize: '0.84rem', fontWeight: 700, lineHeight: 1.2 }}>{e.abbr}</Typography>
                <Typography sx={{ fontSize: '0.61rem', color: 'text.disabled', lineHeight: 1.2, display: { xs: 'none', sm: 'block' }, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {e.teamName}
                </Typography>
              </Box>
              <Typography sx={{ fontSize: '0.78rem', color: 'text.secondary', textAlign: 'right', display: { xs: 'none', sm: 'block' } }}>
                {e.wins}–{e.losses}
              </Typography>
              <Typography sx={{ fontSize: '0.72rem', color: 'text.disabled', textAlign: 'right', display: { xs: 'none', sm: 'block' } }}>
                {e.remainingGames}G
              </Typography>
              <Box sx={{ px: 0.5 }}>
                <Box sx={{ height: 8, borderRadius: 4, bgcolor: 'action.disabledBackground', overflow: 'hidden' }}>
                  <Box sx={{ height: '100%', width: barW, borderRadius: 4, bgcolor: color, transition: 'width 0.5s ease' }} />
                </Box>
              </Box>
              <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {pctStr}
              </Typography>
            </Box>
          </React.Fragment>
        )
      })}
    </Box>
  )
}

// ─── Fraud mini card wrapper ──────────────────────────────────────────────────

function FraudMiniCard({ type, data, nameMap, highlightTeamId, onSelectTeam, onHoverTeam, onExpand, tooltipText, subtitle }: {
  type: 'fraud' | 'cursed'
  data: TeamSummary[]
  nameMap: Map<number, string>
  highlightTeamId: number | null
  onSelectTeam?: (id: number) => void
  onHoverTeam?: (id: number | null) => void
  onExpand: () => void
  tooltipText: string
  subtitle: string
}) {
  const isFraud = type === 'fraud'
  const title = isFraud ? '🚨 Top Frauds' : '💀 Most Cursed'
  const viewAllLabel = isFraud ? 'View all frauds →' : 'View all cursed →'

  return (
    <Box sx={{ borderRadius: 2, border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', overflow: 'hidden' }}>
      {/* Header */}
      <Box sx={{ px: 2, py: 1.25, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid', borderColor: 'divider' }}>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Typography sx={{ fontWeight: 800, fontSize: '1rem', letterSpacing: '-0.3px' }}>{title}</Typography>
            <Tooltip arrow placement="top" title={
              <Box sx={{ maxWidth: 270, p: 0.5 }}>
                <Typography sx={{ fontWeight: 700, fontSize: '0.78rem', mb: 0.5 }}>What this shows</Typography>
                <Typography sx={{ fontSize: '0.72rem', lineHeight: 1.5 }}>{tooltipText}</Typography>
              </Box>
            }>
              <InfoOutlined sx={{ fontSize: '0.88rem', color: 'text.disabled', cursor: 'help' }} />
            </Tooltip>
          </Box>
          <Typography sx={{ fontSize: '0.68rem', color: 'text.secondary', mt: 0.1 }}>{subtitle}</Typography>
        </Box>
        <Tooltip title="View all teams" arrow placement="top">
          <IconButton size="small" onClick={onExpand} sx={{ color: 'text.disabled', '&:hover': { color: ACCENT } }}>
            <OpenInFull sx={{ fontSize: '1rem' }} />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Panel rows */}
      <Box sx={{ px: 0.5, py: 0.5 }}>
        <TeamFraudPanel
          data={data}
          nameMap={nameMap}
          highlightTeamId={highlightTeamId}
          onSelectTeam={onSelectTeam}
          onHoverTeam={onHoverTeam}
          type={type}
          limit={5}
        />
      </Box>

      {/* Footer */}
      <Box sx={{ px: 2, py: '7px', borderTop: '1px solid', borderColor: 'divider', display: 'flex', justifyContent: 'flex-end' }}>
        <Typography onClick={onExpand} sx={{ fontSize: '0.72rem', color: ACCENT, fontWeight: 700, cursor: 'pointer', userSelect: 'none', '&:hover': { textDecoration: 'underline' } }}>
          {viewAllLabel}
        </Typography>
      </Box>
    </Box>
  )
}

// ─── VizSubNav — in-page tab switcher ────────────────────────────────────────

type VizTab = 'graphs' | 'report-card'

function VizSubNav({ tab, onChange }: { tab: VizTab; onChange: (t: VizTab) => void }) {
  const tabs: Array<{ value: VizTab; label: string }> = [
    { value: 'graphs',      label: 'Graphs' },
    { value: 'report-card', label: 'Report Card' },
  ]
  return (
    <Box sx={{
      display: 'flex',
      borderBottom: '1px solid', borderColor: 'divider',
      mb: 2.5,
      mx: { xs: -2, sm: 0 },
      px: { xs: 2, sm: 0 },
    }}>
      {tabs.map(({ value, label }) => {
        const active = tab === value
        return (
          <Box
            key={value}
            onClick={() => onChange(value)}
            sx={{
              flex: 1, py: 0.9,
              textAlign: 'center',
              fontSize: { xs: '0.78rem', sm: '0.84rem' },
              fontWeight: active ? 700 : 500,
              color: active ? 'text.primary' : 'text.secondary',
              cursor: 'pointer', userSelect: 'none',
              borderBottom: '2.5px solid',
              borderColor: active ? 'text.primary' : 'transparent',
              mb: '-1px',
              transition: 'color 0.15s, border-color 0.15s',
              '&:hover': { color: 'text.primary' },
            }}
          >
            {label}
          </Box>
        )
      })}
    </Box>
  )
}

// ─── Main view ────────────────────────────────────────────────────────────────

export interface VizViewProps {
  vizSeason: number
  setVizSeason: (s: number) => void
  teamSummaries: TeamSummary[]
  loadingViz: boolean
  nameMap: Map<number, string>
  handleVizNavigate: (id: number) => void
  canHover: boolean
}

export function VizView({
  vizSeason, setVizSeason, teamSummaries, loadingViz,
  nameMap, handleVizNavigate, canHover,
}: VizViewProps) {
  const [vizTab, setVizTab]           = useState<VizTab>('graphs')
  const [vizHighlightId, setVizHighlightId] = useState<number | null>(null)
  const [vizHoverId, setVizHoverId]   = useState<number | null>(null)
  const [vizSearch, setVizSearch]     = useState('')
  const [vizSearchOpen, setVizSearchOpen] = useState(false)

  // ─── SOS state ────────────────────────────────────────────────────────────
  const [sosData, setSosData]       = useState<SosEntry[]>([])
  const [loadingSos, setLoadingSos] = useState(false)
  const [sosModal, setSosModal]     = useState<'hardest' | 'easiest' | null>(null)

  // ─── Fraud modal state ────────────────────────────────────────────────────
  const [fraudModal, setFraudModal] = useState<'fraud' | 'cursed' | null>(null)

  // ─── Payroll state — live from Supabase, falls back to hardcoded constant ─
  const [payrolls, setPayrolls] = useState<Record<number, number>>(TEAM_PAYROLLS_2026)

  // Only load SOS / payrolls for the current season (past seasons have no data)
  const showSos = vizSeason === CURRENT_SEASON

  useEffect(() => {
    if (!showSos) { setPayrolls(TEAM_PAYROLLS_2026); return }
    fetchTeamPayrolls(vizSeason).then(live => {
      if (Object.keys(live).length >= 28) setPayrolls(live)
    })
  }, [vizSeason, showSos])

  useEffect(() => {
    if (!showSos) { setSosData([]); setSosModal(null); return }
    if (sosData.length > 0) return
    let cancelled = false
    setLoadingSos(true)
    fetchStrengthOfSchedule(vizSeason)
      .then(d => { if (!cancelled) setSosData(d) })
      .catch(() => { if (!cancelled) setSosData([]) })
      .finally(() => { if (!cancelled) setLoadingSos(false) })
    return () => { cancelled = true }
  }, [vizSeason, showSos])

  // ─── Swipe to switch tabs ─────────────────────────────────────────────────
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
  }, [])
  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current) return
    const dx = e.changedTouches[0].clientX - touchStartRef.current.x
    const dy = e.changedTouches[0].clientY - touchStartRef.current.y
    touchStartRef.current = null
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return
    setVizTab(dx < 0 ? 'report-card' : 'graphs')
  }, [])

  const fraudTooltip = 'Teams winning the most games above what their run differential predicts, weighted by how well they\'re actually doing. A first-place team winning 5 more than expected ranks higher than a last-place team winning 6 more — because the first-place team is actually fooling people. Bar length = weighted fraud score. Number = raw wins above expectation.'
  const cursedTooltip = 'Teams losing the most games beyond what their run differential predicts, weighted by how poorly they\'re already doing. A last-place team underperforming by 4 wins ranks higher than a first-place team underperforming by 5 — because the first-place team is still fine. Bar length = weighted cursed score. Number = raw wins below expectation.'

  return (
    <Box>
      {/* ── Top controls: season picker + team search ─────────────────────── */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontWeight: 700, fontSize: '0.85rem', color: 'text.secondary', display: { xs: 'none', sm: 'block' } }}>
            All 30 teams · click to focus · hover to inspect
          </Typography>

          {vizHighlightId != null ? (
            <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, px: 1.5, py: 0.55, borderRadius: 999, bgcolor: TEAM_BG[vizHighlightId] ?? 'grey.700' }}>
              <Typography sx={{ color: '#fff', fontSize: '0.78rem', fontWeight: 700, lineHeight: 1 }}>
                {nameMap.get(vizHighlightId) ?? teamSummaries.find(t => t.id === vizHighlightId)?.abbr}
              </Typography>
              <Box onClick={() => { setVizHighlightId(null); setVizSearch('') }}
                sx={{ color: 'rgba(255,255,255,0.75)', fontSize: '1rem', lineHeight: 1, cursor: 'pointer', ml: 0.25, '&:hover': { color: '#fff' } }}>×</Box>
            </Box>
          ) : (
            <ClickAwayListener onClickAway={() => setVizSearchOpen(false)}>
              <Box sx={{ position: 'relative', minWidth: { xs: 0, sm: 180 }, flex: { xs: 1, sm: 'none' } }}>
                <Box sx={{
                  display: 'flex', alignItems: 'center', gap: 0.75, px: 1.25, py: 0.6, borderRadius: 999,
                  border: '1.5px solid', borderColor: 'divider', bgcolor: 'background.paper',
                  transition: 'border-color 0.15s', '&:focus-within': { borderColor: ACCENT },
                }}>
                  <Search sx={{ fontSize: '0.85rem', color: 'text.disabled', flexShrink: 0 }} />
                  <Box component="input" value={vizSearch}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setVizSearch(e.target.value); setVizSearchOpen(true) }}
                    onFocus={() => setVizSearchOpen(true)}
                    placeholder="Highlight a team…"
                    sx={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', bgcolor: 'transparent', fontSize: '0.8rem', color: 'text.primary', p: 0, fontFamily: 'inherit', '&::placeholder': { color: 'text.disabled' } }}
                  />
                </Box>
                {vizSearchOpen && (() => {
                  const q = vizSearch.toLowerCase()
                  const matches = vizSearch.length > 0
                    ? teamSummaries.filter(t => { const name = nameMap.get(t.id) ?? ''; return name.toLowerCase().includes(q) || t.abbr.toLowerCase().includes(q) })
                    : [...teamSummaries].sort((a, b) => (nameMap.get(a.id) ?? a.abbr).localeCompare(nameMap.get(b.id) ?? b.abbr))
                  if (matches.length === 0) return null
                  return (
                    <Paper elevation={8} sx={{ position: 'absolute', width: '100%', zIndex: 20, mt: 0.5, borderRadius: 2, overflow: 'hidden' }}>
                      <List dense disablePadding>
                        {matches.map((t, i) => (
                          <React.Fragment key={t.id}>
                            {i > 0 && <Divider />}
                            <ListItemButton onClick={() => { setVizHighlightId(t.id); setVizSearch(''); setVizSearchOpen(false) }} sx={{ gap: 1.25, py: 0.6 }}>
                              <Box sx={{ width: 26, height: 26, borderRadius: '50%', bgcolor: TEAM_BG[t.id] ?? 'grey.700', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                <Typography sx={{ color: '#fff', fontWeight: 800, fontSize: t.abbr.length > 2 ? '0.52rem' : '0.62rem', lineHeight: 1 }}>{t.abbr}</Typography>
                              </Box>
                              <Typography sx={{ fontSize: '0.85rem', fontWeight: 600 }}>{nameMap.get(t.id) ?? t.abbr}</Typography>
                            </ListItemButton>
                          </React.Fragment>
                        ))}
                      </List>
                    </Paper>
                  )
                })()}
              </Box>
            </ClickAwayListener>
          )}
        </Box>

        <Box sx={{ ...pillActionSx, p: 0, '&:hover': { borderColor: ACCENT }, '&:focus-within': { borderColor: ACCENT } }}>
          <select value={vizSeason} onChange={e => setVizSeason(Number(e.target.value))}
            style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', color: 'inherit', padding: '6px 16px', borderRadius: 999, fontFamily: 'inherit' }}>
            {TEAM_SEASONS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </Box>
      </Box>

      {/* ── Tab switcher ──────────────────────────────────────────────────── */}
      <VizSubNav tab={vizTab} onChange={setVizTab} />

      {loadingViz && <Box sx={{ textAlign: 'center', py: 6 }}><CircularProgress size={28} /></Box>}

      {!loadingViz && teamSummaries.length > 0 && (
        <Box onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} sx={{ overflow: 'hidden' }}>
          <Box sx={{
            display: 'flex',
            width: '200%',
            marginLeft: vizTab === 'graphs' ? '0%' : '-100%',
            transition: 'margin-left 0.32s cubic-bezier(0.4, 0, 0.2, 1)',
            alignItems: 'flex-start',
          }}>

            {/* ── Panel 1: Graphs ───────────────────────────────────────────── */}
            <Box sx={{ width: '50%', flexShrink: 0, minWidth: 0 }}>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, columnGap: { md: 5 }, rowGap: 0 }}
                onMouseLeave={() => setVizHoverId(null)}>

                {/* ERA vs OPS */}
                <Box sx={{ pb: 3.5, borderBottom: '1px solid', borderColor: 'divider', minWidth: 0 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.25 }}>
                    <Typography sx={{ fontWeight: 800, fontSize: '1rem', letterSpacing: '-0.3px' }}>Pitching vs Hitting</Typography>
                    <Tooltip arrow placement="top" title={
                      <Box sx={{ maxWidth: 260, p: 0.5 }}>
                        <Typography sx={{ fontWeight: 700, fontSize: '0.78rem', mb: 0.5 }}>What this shows</Typography>
                        <Typography sx={{ fontSize: '0.72rem', lineHeight: 1.5 }}>Each bubble is a team plotted by their pitching quality (ERA, vertical) vs their hitting power (OPS, horizontal). Lower ERA = better pitching, so the top of the chart is elite pitching. Higher OPS = better hitting, so the right side is elite offense. The quadrants label each team style — top-right teams have both elite pitching and elite hitting.</Typography>
                      </Box>
                    }>
                      <InfoOutlined sx={{ fontSize: '0.95rem', color: 'text.disabled', cursor: 'help', mt: '1px' }} />
                    </Tooltip>
                  </Box>
                  <Typography sx={{ color: 'text.secondary', fontSize: '0.72rem', mb: 1.5 }}>How good a team's pitching and hitting are · top-right = best of both</Typography>
                  <TeamEraOpsPlot data={teamSummaries} nameMap={nameMap} highlightTeamId={vizHoverId ?? vizHighlightId} onSelectTeam={canHover ? handleVizNavigate : undefined} onHoverTeam={canHover ? setVizHoverId : undefined} />
                </Box>

                {/* Wins vs Run Margin */}
                <Box sx={{ pt: { xs: 3, md: 0 }, pb: 3.5, borderBottom: '1px solid', borderColor: 'divider', minWidth: 0 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.25 }}>
                    <Typography sx={{ fontWeight: 800, fontSize: '1rem', letterSpacing: '-0.3px' }}>Wins vs Run Margin</Typography>
                    <Tooltip arrow placement="top" title={
                      <Box sx={{ maxWidth: 280, p: 0.5 }}>
                        <Typography sx={{ fontWeight: 700, fontSize: '0.78rem', mb: 0.5 }}>What this shows</Typography>
                        <Typography sx={{ fontSize: '0.72rem', lineHeight: 1.5 }}>Each bubble is a team's actual win% plotted against their run margin (runs scored minus runs allowed). The blue dashed curve is the expected win rate. Teams above the curve are winning more than their scoring predicts. Teams below are underperforming. Hover a team to see their actual record vs expected W-L.</Typography>
                      </Box>
                    }>
                      <InfoOutlined sx={{ fontSize: '0.95rem', color: 'text.disabled', cursor: 'help', mt: '1px' }} />
                    </Tooltip>
                  </Box>
                  <Typography sx={{ color: 'text.secondary', fontSize: '0.72rem', mb: 1.5 }}>Actual record vs expected W-L based on scoring · above the curve = outperforming</Typography>
                  <TeamWinRDPlot data={teamSummaries} nameMap={nameMap} highlightTeamId={vizHoverId ?? vizHighlightId} onSelectTeam={canHover ? handleVizNavigate : undefined} onHoverTeam={canHover ? setVizHoverId : undefined} />
                </Box>

                {/* Payroll vs Performance — current season only */}
                {showSos && (
                  <>
                    <Divider sx={{ gridColumn: '1 / -1' }} />
                    <Box sx={{ gridColumn: '1 / -1', pt: { xs: 3, md: 3.5 }, minWidth: 0 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.25 }}>
                        <Typography sx={{ fontWeight: 800, fontSize: '1rem', letterSpacing: '-0.3px' }}>Payroll vs. Performance</Typography>
                        <Tooltip arrow placement="top" title={
                          <Box sx={{ maxWidth: 290, p: 0.5 }}>
                            <Typography sx={{ fontWeight: 700, fontSize: '0.78rem', mb: 0.5 }}>What this shows</Typography>
                            <Typography sx={{ fontSize: '0.72rem', lineHeight: 1.5 }}>Each bubble is a team's estimated payroll plotted against their current win percentage. The purple dashed line is the league's average efficiency. Teams above the line are outperforming their payroll. The quadrants show Moneyball (low spend, winning), All-In (high spend, winning), Rebuilding (low spend, losing), and Burning $$$ (high spend, losing).</Typography>
                          </Box>
                        }>
                          <InfoOutlined sx={{ fontSize: '0.95rem', color: 'text.disabled', cursor: 'help', mt: '1px' }} />
                        </Tooltip>
                      </Box>
                      <Typography sx={{ color: 'text.secondary', fontSize: '0.72rem', mb: 1.5 }}>{vizSeason} estimated payroll vs current win% · above the dashed line = best value</Typography>
                      <PayrollWinsPlot data={teamSummaries} payrolls={payrolls} nameMap={nameMap} highlightTeamId={vizHoverId ?? vizHighlightId} onSelectTeam={canHover ? handleVizNavigate : undefined} onHoverTeam={canHover ? setVizHoverId : undefined} />
                    </Box>
                  </>
                )}
              </Box>
            </Box>

            {/* ── Panel 2: Report Card ──────────────────────────────────────── */}
            <Box sx={{ width: '50%', flexShrink: 0, minWidth: 0 }}>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, columnGap: { md: 3 }, rowGap: 0 }}>

                {/* Top Frauds */}
                <Box sx={{ minWidth: 0 }}>
                  <FraudMiniCard
                    type="fraud"
                    data={teamSummaries}
                    nameMap={nameMap}
                    highlightTeamId={vizHighlightId}
                    onSelectTeam={handleVizNavigate}
                    onExpand={() => setFraudModal('fraud')}
                    tooltipText={fraudTooltip}
                    subtitle="Winning more than their scoring predicts"
                  />
                </Box>

                {/* Most Cursed */}
                <Box sx={{ pt: { xs: 2, md: 0 }, minWidth: 0 }}>
                  <FraudMiniCard
                    type="cursed"
                    data={teamSummaries}
                    nameMap={nameMap}
                    highlightTeamId={vizHighlightId}
                    onSelectTeam={handleVizNavigate}
                    onExpand={() => setFraudModal('cursed')}
                    tooltipText={cursedTooltip}
                    subtitle="Losing more than their scoring predicts"
                  />
                </Box>

                {/* Schedules — current season only */}
                {showSos && (
                  <>
                    <Divider sx={{ gridColumn: '1 / -1', my: 2 }} />
                    <Box sx={{ minWidth: 0 }}>
                      <SosMiniCard
                        title="⚔️ Hardest Schedules"
                        subtitle="Toughest remaining opponents"
                        slice={sosData.slice(0, 5)}
                        allEntries={sosData}
                        onExpand={() => setSosModal('hardest')}
                        loading={loadingSos}
                      />
                    </Box>
                    <Box sx={{ pt: { xs: 2, md: 0 }, minWidth: 0 }}>
                      <SosMiniCard
                        title="🏖️ Easiest Schedules"
                        subtitle="Softest remaining opponents"
                        slice={[...sosData].slice(-5).reverse()}
                        allEntries={sosData}
                        onExpand={() => setSosModal('easiest')}
                        loading={loadingSos}
                      />
                    </Box>
                  </>
                )}
              </Box>
            </Box>

          </Box>
        </Box>
      )}

      {!loadingViz && teamSummaries.length === 0 && (
        <Typography color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>No team stats available for {vizSeason}.</Typography>
      )}

      {/* ── SOS Modals ─────────────────────────────────────────────────────── */}
      <FullscreenModal
        open={sosModal === 'hardest'}
        onClose={() => setSosModal(null)}
        title="⚔️ Hardest Schedules — All 30 Teams"
        subtitle="Avg opponent win% · remaining regular-season games · toughest → lightest"
      >
        <SosFullContent entries={sosData} direction="hardest" />
      </FullscreenModal>

      <FullscreenModal
        open={sosModal === 'easiest'}
        onClose={() => setSosModal(null)}
        title="🏖️ Easiest Schedules — All 30 Teams"
        subtitle="Avg opponent win% · remaining regular-season games · lightest → toughest"
      >
        <SosFullContent entries={sosData} direction="easiest" />
      </FullscreenModal>

      {/* ── Fraud Modals ───────────────────────────────────────────────────── */}
      <FullscreenModal
        open={fraudModal === 'fraud'}
        onClose={() => setFraudModal(null)}
        title="🚨 Top Frauds — All Teams"
        subtitle="Winning more than their scoring predicts · weighted by standings position"
      >
        <TeamFraudPanel
          data={teamSummaries}
          nameMap={nameMap}
          highlightTeamId={null}
          onSelectTeam={id => { setFraudModal(null); handleVizNavigate(id) }}
          type="fraud"
          limit={30}
        />
      </FullscreenModal>

      <FullscreenModal
        open={fraudModal === 'cursed'}
        onClose={() => setFraudModal(null)}
        title="💀 Most Cursed — All Teams"
        subtitle="Losing more than their scoring predicts · weighted by standings position"
      >
        <TeamFraudPanel
          data={teamSummaries}
          nameMap={nameMap}
          highlightTeamId={null}
          onSelectTeam={id => { setFraudModal(null); handleVizNavigate(id) }}
          type="cursed"
          limit={30}
        />
      </FullscreenModal>
    </Box>
  )
}
