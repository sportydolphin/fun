import React, { useState, useEffect } from 'react'
import { Box, Typography } from '@mui/material'
import { ACCENT, TEAM_NICKNAME } from '../constants'
import { useIsDark, highlightColor, defaultBorder } from '../lib/colorUtils'
import { fetchMilestoneWatch, MilestoneItem } from '../api'
import { useDeepLink } from '../state/deepLink'
import { TeamLogo } from './Standings'

const CARD_LIMIT = 5

// ─── One chase row ────────────────────────────────────────────────────────────

function MilestoneRow({ item, onPlayerClick }: {
  item: MilestoneItem
  onPlayerClick?: (id: number) => void
}) {
  const isDark = useIsDark()
  const teamColor = highlightColor(item.teamId, isDark)
  const clickable = !!onPlayerClick
  const pct = Math.max(0, Math.min(1, item.current / item.target))
  const isRecord = item.kind === 'record'

  return (
    <Box
      onClick={() => onPlayerClick?.(item.playerId)}
      sx={{
        display: 'flex', alignItems: 'center', gap: 1.25, px: 1.5, py: '9px',
        borderLeft: `3px solid ${teamColor}`,
        cursor: clickable ? 'pointer' : 'default',
        '&:hover': { bgcolor: clickable ? 'action.hover' : undefined },
        transition: 'background 0.12s',
      }}
    >
      <TeamLogo teamId={item.teamId} abbr={item.teamAbbr} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <Typography sx={{ fontSize: '0.84rem', fontWeight: 700, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {item.playerName}
          </Typography>
          {isRecord && (
            <Typography sx={{ fontSize: '0.54rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5, color: '#f59e0b', border: '1px solid #f59e0b55', borderRadius: 999, px: 0.6, py: '1px', whiteSpace: 'nowrap' }}>
              Record
            </Typography>
          )}
          {item.kind === 'season' && (
            <Typography sx={{ fontSize: '0.54rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'text.disabled', whiteSpace: 'nowrap' }}>
              Season
            </Typography>
          )}
        </Box>
        {/* Progress toward the milestone */}
        <Box sx={{ mt: '4px', height: 3, borderRadius: 2, bgcolor: 'action.hover', overflow: 'hidden' }}>
          <Box sx={{ height: '100%', width: `${pct * 100}%`, bgcolor: isRecord ? '#f59e0b' : teamColor, borderRadius: 2 }} />
        </Box>
      </Box>
      <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
        <Typography sx={{ fontSize: '0.9rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1, color: item.remaining <= 3 ? '#22c55e' : 'text.primary' }}>
          {item.remaining}
        </Typography>
        <Typography sx={{ fontSize: '0.58rem', color: 'text.disabled', lineHeight: 1.1, whiteSpace: 'nowrap' }}>
          {item.statLabel} to {item.target}
        </Typography>
      </Box>
    </Box>
  )
}

// ─── View-all modal ───────────────────────────────────────────────────────────

const GROUPS: { key: MilestoneItem['kind']; label: string }[] = [
  { key: 'record', label: 'Record chases' },
  { key: 'career', label: 'Career milestones' },
  { key: 'season', label: 'This season' },
]

function MilestoneModal({ items, onClose, onPlayerClick }: {
  items: MilestoneItem[]
  onClose: () => void
  onPlayerClick?: (id: number) => void
}) {
  const isDark = useIsDark()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <Box
      onClick={onClose}
      sx={{ position: 'fixed', inset: 0, zIndex: 1500, bgcolor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}
    >
      <Box
        onClick={e => e.stopPropagation()}
        sx={{ width: '100%', maxWidth: 460, maxHeight: '90vh', overflow: 'auto', borderRadius: 3, border: '1px solid', borderColor: defaultBorder(isDark), bgcolor: 'background.paper' }}
      >
        <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, bgcolor: 'background.paper', zIndex: 1 }}>
          <Typography sx={{ fontWeight: 800, fontSize: '0.95rem' }}>🏆 Milestone Watch</Typography>
          <Box onClick={onClose} sx={{ cursor: 'pointer', px: 1, fontSize: '1.1rem', color: 'text.secondary', '&:hover': { color: 'text.primary' } }}>✕</Box>
        </Box>

        {GROUPS.map(g => {
          const groupItems = items.filter(it => it.kind === g.key)
          if (!groupItems.length) return null
          return (
            <Box key={g.key}>
              <Box sx={{ px: 1.5, py: '6px', bgcolor: 'action.hover' }}>
                <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'text.disabled' }}>
                  {g.label}
                </Typography>
              </Box>
              {groupItems.map(it => (
                <Box key={`${it.playerId}-${it.statKey}-${it.target}`} sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
                  <MilestoneRow item={it} onPlayerClick={onPlayerClick} />
                </Box>
              ))}
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}

// ─── Card ─────────────────────────────────────────────────────────────────────

export function MilestoneWatchCard({ season, onPlayerClick }: {
  season: number
  onPlayerClick?: (id: number) => void
}) {
  const isDark = useIsDark()
  const [items, setItems] = useState<MilestoneItem[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [pendingOpen, setPendingOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchMilestoneWatch(season)
      .then(d => { if (!cancelled) setItems(d) })
      .catch(() => { if (!cancelled) setItems([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [season])

  // A milestone notification click opens the full board. Queued until the data has
  // loaded so a cold start from a push doesn't open onto nothing.
  useDeepLink('milestones', () => setPendingOpen(true))
  useEffect(() => {
    if (pendingOpen && items && items.length) { setModalOpen(true); setPendingOpen(false) }
  }, [pendingOpen, items])

  // While loading, or when the row is missing/stale/empty, render nothing — the
  // card simply isn't part of the feed rather than flashing a spinner that then
  // vanishes. (fetchMilestoneWatch resolves to null for a missing table, so the
  // loading flag is what distinguishes "still fetching" from "nothing to show".)
  if (loading || !items || !items.length) return null

  const shown = items.slice(0, CARD_LIMIT)

  return (
    <>
      <Box sx={{ borderRadius: 3, border: '1px solid', borderColor: defaultBorder(isDark), bgcolor: 'background.paper', overflow: 'hidden' }}>
        <Box sx={{ px: 1.75, py: 1.25, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Typography sx={{ fontWeight: 800, fontSize: '0.9rem', lineHeight: 1.15 }}>🏆 Milestone Watch</Typography>
          <Typography sx={{ fontSize: '0.64rem', color: 'text.disabled', lineHeight: 1.2 }}>Chasing history, closest first.</Typography>
        </Box>

        {shown.map((it, i) => (
          <Box key={`${it.playerId}-${it.statKey}-${it.target}`} sx={{ borderBottom: i < shown.length - 1 ? '1px solid' : 'none', borderColor: 'divider' }}>
            <MilestoneRow item={it} onPlayerClick={onPlayerClick} />
          </Box>
        ))}

        {items.length > CARD_LIMIT && (
          <Box
            onClick={() => setModalOpen(true)}
            sx={{ px: 1.75, py: '9px', borderTop: '1px solid', borderColor: 'divider', cursor: 'pointer', textAlign: 'center', '&:hover': { bgcolor: 'action.hover' } }}
          >
            <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: ACCENT }}>
              View all {items.length} →
            </Typography>
          </Box>
        )}
      </Box>

      {modalOpen && <MilestoneModal items={items} onClose={() => setModalOpen(false)} onPlayerClick={onPlayerClick} />}
    </>
  )
}
