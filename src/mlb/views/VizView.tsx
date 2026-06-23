import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  Box, Typography, Paper, List, ListItemButton, Divider,
  ClickAwayListener, Tooltip, CircularProgress, IconButton,
} from '@mui/material'
import { Search, InfoOutlined, OpenInFull, Close } from '@mui/icons-material'
import { TeamSummary, SosEntry } from '../types'
import { ACCENT, TEAM_BG, TEAM_ABBR, TEAM_SEASONS, CURRENT_SEASON } from '../constants'
import { pillActionSx } from '../ui'
import { TeamEraOpsPlot, TeamWinRDPlot, PayrollWinsPlot } from '../charts'
import { fetchStrengthOfSchedule, fetchTeamPayrolls, fetchTeamAverageAges } from '../api'
import { TEAM_PAYROLLS_2026 } from '../constants'

// ─── Leaderboard row model — shared by every Report Card board ───────────────

interface LbRow {
  teamId: number
  abbr: string
  name: string
  sub?: string
  value: string
  barFraction: number   // 0..1
  label?: string        // snarky verdict — only shown in the 3-row mini card
}

interface Board {
  id: string
  icon: string
  title: string
  subtitle: string
  accent: string
  tooltipText?: string
  rows: LbRow[]
  loading: boolean
}

function TeamLogo({ teamId, abbr, size = 36, accent, highlighted }: {
  teamId: number; abbr: string; size?: number; accent?: string; highlighted?: boolean
}) {
  const [failed, setFailed] = useState(false)
  const ring = TEAM_BG[teamId] ?? '#444'
  return (
    <Box sx={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      bgcolor: failed ? ring : '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
      boxShadow: highlighted && accent ? `0 0 0 2.5px ${accent}` : `0 0 0 1px ${ring}30`,
    }}>
      {failed ? (
        <Typography sx={{ color: '#fff', fontWeight: 900, fontSize: abbr.length > 2 ? '0.48rem' : '0.6rem', lineHeight: 1 }}>
          {abbr}
        </Typography>
      ) : (
        <Box
          component="img"
          src={`https://www.mlbstatic.com/team-logos/${teamId}.svg`}
          alt={abbr}
          crossOrigin="anonymous"
          onError={() => setFailed(true)}
          sx={{ width: '78%', height: '78%', objectFit: 'contain', display: 'block' }}
        />
      )}
    </Box>
  )
}

function LeaderboardRowItem({ row, rank, accent, showLabel, onSelect }: {
  row: LbRow; rank: number; accent: string; showLabel: boolean; onSelect?: (id: number) => void
}) {
  return (
    <Box
      onClick={onSelect ? () => onSelect(row.teamId) : undefined}
      sx={{
        display: 'flex', alignItems: 'center', gap: 1.25,
        py: 0.9, px: 0.75, borderRadius: 2,
        ...(onSelect ? { cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } } : {}),
        transition: 'background-color 0.15s',
      }}
    >
      <Typography sx={{ fontSize: '0.62rem', color: 'text.disabled', fontWeight: 700, width: 16, textAlign: 'right', flexShrink: 0 }}>
        {rank}
      </Typography>

      <TeamLogo teamId={row.teamId} abbr={row.abbr} accent={accent} />

      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontWeight: 700, fontSize: '0.82rem', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {row.name}
        </Typography>
        {row.sub && (
          <Typography sx={{ fontSize: '0.68rem', color: 'text.secondary', fontWeight: 500, mt: 0.1 }}>
            {row.sub}
          </Typography>
        )}
      </Box>

      <Box sx={{ width: 80, flexShrink: 0 }}>
        <Box sx={{ height: 5, bgcolor: 'action.hover', borderRadius: 1, overflow: 'hidden', mb: 0.5 }}>
          <Box sx={{ height: '100%', width: `${Math.max(row.barFraction, 0) * 100}%`, bgcolor: accent, borderRadius: 1, opacity: 0.85, transition: 'width 0.3s' }} />
        </Box>
        <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, color: accent, textAlign: 'right', lineHeight: 1 }}>
          {row.value}
        </Typography>
      </Box>

      {showLabel && (
        <Typography sx={{
          fontSize: '0.54rem', fontWeight: 800, color: accent,
          width: 76, flexShrink: 0, textAlign: 'right',
          letterSpacing: '0.3px', lineHeight: 1.25,
          textTransform: 'uppercase',
        }}>
          {row.label ?? ''}
        </Typography>
      )}
    </Box>
  )
}

// ─── Mini card — top 3 rows + snarky labels ───────────────────────────────────

function LeaderboardCard({ icon, title, subtitle, accent, tooltipText, rows, loading, onExpand, onSelectTeam }: Board & {
  onExpand: () => void
  onSelectTeam?: (id: number) => void
}) {
  const top3 = rows.slice(0, 3)
  return (
    <Box sx={{ borderRadius: 2, border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', overflow: 'hidden' }}>
      {/* Header */}
      <Box sx={{ px: 2, py: 1.25, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid', borderColor: 'divider' }}>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Typography sx={{ fontWeight: 800, fontSize: '1rem', letterSpacing: '-0.3px' }}>{icon} {title}</Typography>
            {tooltipText && (
              <Tooltip arrow placement="top" title={
                <Box sx={{ maxWidth: 270, p: 0.5 }}>
                  <Typography sx={{ fontWeight: 700, fontSize: '0.78rem', mb: 0.5 }}>What this shows</Typography>
                  <Typography sx={{ fontSize: '0.72rem', lineHeight: 1.5 }}>{tooltipText}</Typography>
                </Box>
              }>
                <InfoOutlined sx={{ fontSize: '0.88rem', color: 'text.disabled', cursor: 'help' }} />
              </Tooltip>
            )}
          </Box>
          <Typography sx={{ fontSize: '0.68rem', color: 'text.secondary', mt: 0.1 }}>{subtitle}</Typography>
        </Box>
        <Tooltip title="View all teams" arrow placement="top">
          <IconButton size="small" onClick={onExpand} sx={{ color: 'text.disabled', '&:hover': { color: ACCENT } }}>
            <OpenInFull sx={{ fontSize: '1rem' }} />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Rows */}
      <Box sx={{ px: 0.5, py: 0.5 }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
            <CircularProgress size={22} sx={{ color: ACCENT }} />
          </Box>
        ) : (
          top3.map((row, idx) => (
            <LeaderboardRowItem key={row.teamId} row={row} rank={idx + 1} accent={accent} showLabel onSelect={onSelectTeam} />
          ))
        )}
      </Box>

      {/* Footer */}
      {!loading && (
        <Box sx={{ px: 2, py: '7px', borderTop: '1px solid', borderColor: 'divider', display: 'flex', justifyContent: 'flex-end' }}>
          <Typography onClick={onExpand} sx={{ fontSize: '0.72rem', color: ACCENT, fontWeight: 700, cursor: 'pointer', userSelect: 'none', '&:hover': { textDecoration: 'underline' } }}>
            View all {rows.length} →
          </Typography>
        </Box>
      )}
    </Box>
  )
}

// ─── Fullscreen modal — full scrollable ranking, no snarky labels ─────────────

function LeaderboardModal({ open, onClose, icon, title, subtitle, accent, rows, onSelectTeam }: {
  open: boolean
  onClose: () => void
  icon?: string
  title?: string
  subtitle?: string
  accent?: string
  rows: LbRow[]
  onSelectTeam?: (id: number) => void
}) {
  // Lock background scroll while a board is fullscreened
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

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
            <Typography sx={{ fontWeight: 800, fontSize: '1rem', letterSpacing: '-0.3px' }}>{icon} {title}</Typography>
            {subtitle && (
              <Typography sx={{ fontSize: '0.68rem', color: 'text.secondary', mt: 0.1 }}>{subtitle}</Typography>
            )}
          </Box>
          <IconButton size="small" onClick={onClose} sx={{ ml: 1, color: 'text.secondary', '&:hover': { color: 'text.primary' } }}>
            <Close sx={{ fontSize: '1.1rem' }} />
          </IconButton>
        </Box>
        {/* Scrollable body — all teams, no verdict labels */}
        <Box sx={{ overflowY: 'auto', p: 1.5 }}>
          {rows.map((row, idx) => (
            <LeaderboardRowItem key={row.teamId} row={row} rank={idx + 1} accent={accent ?? ACCENT} showLabel={false} onSelect={onSelectTeam} />
          ))}
        </Box>
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

// ─── Row builders — one per board, each producing a fully-sorted LbRow[] ──────

interface AgeEntry { teamId: number; abbr: string; avgAge: number }

function buildFraudRows(data: TeamSummary[], nameMap: Map<number, string>, type: 'fraud' | 'cursed'): LbRow[] {
  const isFraud = type === 'fraud'
  const withScores = data
    .filter(d => !isNaN(d.rs) && !isNaN(d.ra) && d.wins + d.losses > 0)
    .map(d => {
      const e = 1.83
      const pythPct = d.ra > 0 ? Math.pow(d.rs, e) / (Math.pow(d.rs, e) + Math.pow(d.ra, e)) : 0.99
      const games = d.wins + d.losses
      const pythWins = Math.round(pythPct * games)
      const delta = d.wins - pythWins
      const winPct = d.wins / games
      const fraudScore = delta > 0 ? delta * winPct : 0
      const cursedScore = delta < 0 ? (-delta) * (1 - winPct) : 0
      return { ...d, delta, winPct, fraudScore, cursedScore }
    })
    .filter(t => isFraud ? t.delta > 0 : t.delta < 0)
    .sort((a, b) => isFraud ? b.fraudScore - a.fraudScore : b.cursedScore - a.cursedScore)

  const maxScore = Math.max(...withScores.map(t => isFraud ? t.fraudScore : t.cursedScore), 1)

  const getLabel = (score: number) => isFraud
    ? score >= 4.0 ? 'CONFIRMED FRAUD' : score >= 2.5 ? 'FRAUD ALERT' : score >= 1.5 ? 'SUS' : 'A LIL SUS'
    : score >= 4.0 ? 'TRULY CURSED' : score >= 2.5 ? 'BIG MAD' : score >= 1.5 ? 'ROBBED' : 'UNLUCKY'

  return withScores.map(t => {
    const score = isFraud ? t.fraudScore : t.cursedScore
    return {
      teamId: t.id,
      abbr: t.abbr,
      name: nameMap.get(t.id) ?? t.abbr,
      sub: `${t.wins}–${t.losses}`,
      value: `${t.delta > 0 ? '+' : ''}${t.delta} wins`,
      barFraction: score / maxScore,
      label: getLabel(score),
    }
  })
}

const OLDEST_LABELS   = ['ULTRA UNC', 'GRAMPS', 'SENIOR DISCOUNT']
const YOUNGEST_LABELS = ['LITERAL TODDLERS', 'BABY-FACED', 'YOUNG GUNS']

function buildAgeRows(entries: AgeEntry[], nameMap: Map<number, string>, type: 'oldest' | 'youngest'): LbRow[] {
  if (!entries.length) return []
  const isOldest = type === 'oldest'
  const sorted = isOldest ? entries : [...entries].reverse()
  const minAge = entries[entries.length - 1].avgAge
  const maxAge = entries[0].avgAge
  const range = maxAge - minAge || 0.1
  const labels = isOldest ? OLDEST_LABELS : YOUNGEST_LABELS

  return sorted.map((t, idx) => {
    const norm = (t.avgAge - minAge) / range
    return {
      teamId: t.teamId,
      abbr: t.abbr,
      name: nameMap.get(t.teamId) ?? t.abbr,
      value: `${t.avgAge.toFixed(1)} yrs`,
      barFraction: isOldest ? norm : 1 - norm,
      label: idx < labels.length ? labels[idx] : undefined,
    }
  })
}

const HARDEST_LABELS = ['GOOD LUCK LOL', 'UPHILL BATTLE', 'ROUGH PATCH']
const EASIEST_LABELS = ['VACATION MODE', 'EASY STREET', 'BIG CHILLING']

function buildSosRows(entries: SosEntry[], direction: 'hardest' | 'easiest'): LbRow[] {
  if (!entries.length) return []
  const isHardest = direction === 'hardest'
  const sorted = isHardest ? entries : [...entries].reverse()
  const minPct = Math.min(...entries.map(e => e.oppWinPct))
  const maxPct = Math.max(...entries.map(e => e.oppWinPct))
  const range = maxPct - minPct || 0.001
  const labels = isHardest ? HARDEST_LABELS : EASIEST_LABELS

  return sorted.map((e, idx) => {
    const norm = (e.oppWinPct - minPct) / range
    const pctStr = '.' + Math.round(e.oppWinPct * 1000).toString().padStart(3, '0')
    return {
      teamId: e.teamId,
      abbr: e.abbr,
      name: e.teamName,
      sub: `${e.wins}–${e.losses} · ${e.remainingGames}G left`,
      value: pctStr,
      barFraction: isHardest ? norm : 1 - norm,
      label: idx < labels.length ? labels[idx] : undefined,
    }
  })
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

  // ─── Report Card fullscreen state — one board open at a time ─────────────
  const [expandedBoard, setExpandedBoard] = useState<string | null>(null)

  // ─── Team age state ───────────────────────────────────────────────────────
  const [ageEntries, setAgeEntries]   = useState<AgeEntry[]>([])
  const [loadingAges, setLoadingAges] = useState(false)

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
    if (!showSos) { setSosData([]); setExpandedBoard(null); return }
    if (sosData.length > 0) return
    let cancelled = false
    setLoadingSos(true)
    fetchStrengthOfSchedule(vizSeason)
      .then(d => { if (!cancelled) setSosData(d) })
      .catch(() => { if (!cancelled) setSosData([]) })
      .finally(() => { if (!cancelled) setLoadingSos(false) })
    return () => { cancelled = true }
  }, [vizSeason, showSos])

  useEffect(() => {
    if (!showSos) { setAgeEntries([]); return }
    if (ageEntries.length > 0) return
    let cancelled = false
    setLoadingAges(true)
    fetchTeamAverageAges(vizSeason)
      .then(ages => {
        if (cancelled) return
        const entries: AgeEntry[] = Object.entries(ages)
          .map(([id, avgAge]) => ({ teamId: Number(id), abbr: TEAM_ABBR[Number(id)] ?? '?', avgAge }))
          .filter(e => e.abbr !== '?')
          .sort((a, b) => b.avgAge - a.avgAge)
        setAgeEntries(entries)
      })
      .catch(() => { if (!cancelled) setAgeEntries([]) })
      .finally(() => { if (!cancelled) setLoadingAges(false) })
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

  // ─── Report Card boards — every leaderboard follows the same shape ────────
  const boards: Board[] = [
    {
      id: 'fraud', icon: '🚨', title: 'Top Frauds', accent: '#f97316',
      subtitle: 'Winning more than their scoring predicts', tooltipText: fraudTooltip,
      rows: buildFraudRows(teamSummaries, nameMap, 'fraud'), loading: loadingViz,
    },
    {
      id: 'cursed', icon: '💀', title: 'Most Cursed', accent: '#818cf8',
      subtitle: 'Losing more than their scoring predicts', tooltipText: cursedTooltip,
      rows: buildFraudRows(teamSummaries, nameMap, 'cursed'), loading: loadingViz,
    },
    ...(showSos ? [
      {
        id: 'oldest', icon: '👴', title: 'Oldest Rosters', accent: '#f97316',
        subtitle: 'Highest avg roster age',
        rows: buildAgeRows(ageEntries, nameMap, 'oldest'), loading: loadingAges,
      },
      {
        id: 'youngest', icon: '🌱', title: 'Youngest Rosters', accent: '#22c55e',
        subtitle: 'Lowest avg roster age',
        rows: buildAgeRows(ageEntries, nameMap, 'youngest'), loading: loadingAges,
      },
      {
        id: 'hardest', icon: '⚔️', title: 'Hardest Schedules', accent: '#ef4444',
        subtitle: 'Toughest remaining opponents',
        rows: buildSosRows(sosData, 'hardest'), loading: loadingSos,
      },
      {
        id: 'easiest', icon: '🏖️', title: 'Easiest Schedules', accent: '#22c55e',
        subtitle: 'Softest remaining opponents',
        rows: buildSosRows(sosData, 'easiest'), loading: loadingSos,
      },
    ] : []),
  ]

  const activeBoard = boards.find(b => b.id === expandedBoard) ?? null

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

            {/* ── Panel 2: Report Card — every board uses the same card/modal ─ */}
            <Box sx={{ width: '50%', flexShrink: 0, minWidth: 0 }}>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, columnGap: { md: 3 }, rowGap: 3 }}>
                {boards.map(board => (
                  <Box key={board.id} sx={{ minWidth: 0 }}>
                    <LeaderboardCard
                      {...board}
                      onExpand={() => setExpandedBoard(board.id)}
                      onSelectTeam={handleVizNavigate}
                    />
                  </Box>
                ))}
              </Box>
            </Box>

          </Box>
        </Box>
      )}

      {!loadingViz && teamSummaries.length === 0 && (
        <Typography color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>No team stats available for {vizSeason}.</Typography>
      )}

      {/* ── Report Card fullscreen modal — shared by every board ──────────── */}
      <LeaderboardModal
        open={activeBoard != null}
        onClose={() => setExpandedBoard(null)}
        icon={activeBoard?.icon}
        title={activeBoard ? `${activeBoard.title} — All ${activeBoard.rows.length} Teams` : undefined}
        subtitle={activeBoard?.subtitle}
        accent={activeBoard?.accent}
        rows={activeBoard?.rows ?? []}
        onSelectTeam={id => { setExpandedBoard(null); handleVizNavigate(id) }}
      />
    </Box>
  )
}
