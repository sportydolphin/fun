import React, { useState, useEffect } from 'react'
import { Box, Typography } from '@mui/material'
import { ACCENT } from '../constants'
import { useIsDark, highlightColor, defaultBorder } from '../lib/colorUtils'
import { fetchMilestoneData, MilestoneItem } from '../api'
import { useDeepLink } from '../state/deepLink'
import { TeamLogo } from './Standings'

const FEATURED = 3          // hero chases shown on the card; the rest live in the modal
const RECENT_ON_CARD = 2    // cap on how many "just reached" rows lead the featured strip
const ACHIEVED_GREEN = '#22c55e'
const RECORD_GOLD = '#f59e0b'
const LIVE_RED = '#ef4444'

// "2 days ago" / "today" from a YYYY-MM-DD stamp, for the recently-reached rows.
function relativeDay(ymd: string): string {
  const then = new Date(`${ymd}T00:00:00`).getTime()
  if (!Number.isFinite(then)) return ''
  const days = Math.floor((Date.now() - then) / 86400000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days}d ago`
}

// How full the proximity meter reads. The nightly job only surfaces a chase once the
// player is within a stat's watch window, so an absolute current/target bar is always
// pinned near 100% and tells you nothing. Instead we fill by how far into that final
// window the player has climbed: at the edge of the window it's nearly empty, on the
// doorstep it's nearly full. Reached milestones read full.
function proximity(item: MilestoneItem): number {
  if (item.achievedOn) return 1
  const w = item.window && item.window > 0 ? item.window : Math.max(item.remaining, 20)
  return Math.max(0.05, Math.min(1, 1 - item.remaining / w))
}

const kindLabel = (item: MilestoneItem): string =>
  item.kind === 'record' ? 'All-time record' : item.kind === 'season' ? 'This season' : 'Career'

// ─── Shared bits ────────────────────────────────────────────────────────────────

// Pulsing red "LIVE" pill — the player's team is in a game right now, so the number
// could tick down (or the milestone fall) while you watch.
function LiveBadge() {
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.4, px: 0.6, py: '1px', borderRadius: 999, bgcolor: LIVE_RED, flexShrink: 0 }}>
      <Box sx={{
        width: 4, height: 4, borderRadius: '50%', bgcolor: '#fff',
        '@keyframes msLiveDot': { '0%': { opacity: 1 }, '50%': { opacity: 0.2 }, '100%': { opacity: 1 } },
        animation: 'msLiveDot 1.4s ease-in-out infinite',
      }} />
      <Typography sx={{ fontSize: '0.5rem', fontWeight: 800, letterSpacing: 0.5, color: '#fff' }}>LIVE</Typography>
    </Box>
  )
}

function Tag({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <Typography sx={{ fontSize: '0.54rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5, color, border: `1px solid ${color}55`, borderRadius: 999, px: 0.6, py: '1px', whiteSpace: 'nowrap', flexShrink: 0 }}>
      {children}
    </Typography>
  )
}

function MeterBar({ fill, color, live, height = 4 }: { fill: number; color: string; live?: boolean; height?: number }) {
  return (
    <Box sx={{ height, borderRadius: 3, bgcolor: 'action.hover', overflow: 'hidden' }}>
      <Box sx={{
        height: '100%', width: `${Math.round(fill * 100)}%`, borderRadius: 3, bgcolor: color,
        transition: 'width 0.3s ease',
        ...(live && {
          '@keyframes msMeterPulse': { '0%': { opacity: 1 }, '50%': { opacity: 0.5 }, '100%': { opacity: 1 } },
          animation: 'msMeterPulse 1.4s ease-in-out infinite',
        }),
      }} />
    </Box>
  )
}

// ─── Featured chase — the big card treatment (up to 3 on the card) ───────────────

function FeaturedMilestone({ item, isLive, onPlayerClick }: {
  item: MilestoneItem
  isLive: boolean
  onPlayerClick?: (id: number) => void
}) {
  const isDark = useIsDark()
  const teamColor = highlightColor(item.teamId, isDark)
  const achieved = !!item.achievedOn
  const isRecord = item.kind === 'record'
  const accent = achieved ? ACHIEVED_GREEN : isRecord ? RECORD_GOLD : teamColor
  const clickable = !!onPlayerClick

  return (
    <Box
      onClick={() => onPlayerClick?.(item.playerId)}
      sx={{
        display: 'flex', alignItems: 'center', gap: 1.25, px: 1.5, py: 1.25,
        borderLeft: `3px solid ${isLive ? LIVE_RED : accent}`,
        cursor: clickable ? 'pointer' : 'default',
        '&:hover': { bgcolor: clickable ? 'action.hover' : undefined },
        transition: 'background 0.12s',
      }}
    >
      <TeamLogo teamId={item.teamId} abbr={item.teamAbbr} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
          <Typography sx={{ fontSize: '0.9rem', fontWeight: 800, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {item.playerName}
          </Typography>
          {isLive && <LiveBadge />}
          {!isLive && achieved && <Tag color={ACHIEVED_GREEN}>✓ Reached</Tag>}
          {!isLive && !achieved && isRecord && <Tag color={RECORD_GOLD}>Record</Tag>}
        </Box>
        <Typography sx={{ mt: '1px', fontSize: '0.64rem', color: 'text.secondary', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {achieved
            ? `Reached ${item.target} ${item.statLabel} · ${relativeDay(item.achievedOn!)}`
            : `${kindLabel(item)} · ${item.target} ${item.statLabel}`}
        </Typography>
        <Box sx={{ mt: '6px' }}>
          <MeterBar fill={proximity(item)} color={isLive ? LIVE_RED : accent} live={isLive} height={5} />
        </Box>
      </Box>
      <Box sx={{ textAlign: 'right', flexShrink: 0, minWidth: 42 }}>
        {achieved ? (
          <Typography sx={{ fontSize: '1.5rem', fontWeight: 800, lineHeight: 1, color: ACHIEVED_GREEN }}>✓</Typography>
        ) : (<>
          <Typography sx={{ fontSize: '1.5rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums', lineHeight: 1, color: isLive ? LIVE_RED : item.remaining <= 3 ? ACHIEVED_GREEN : 'text.primary' }}>
            {item.remaining}
          </Typography>
          <Typography sx={{ mt: '2px', fontSize: '0.54rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'text.disabled', lineHeight: 1 }}>
            to go
          </Typography>
        </>)}
      </Box>
    </Box>
  )
}

// ─── Compact row — used inside the View-all modal ────────────────────────────────

function MilestoneRow({ item, isLive, onPlayerClick }: {
  item: MilestoneItem
  isLive: boolean
  onPlayerClick?: (id: number) => void
}) {
  const isDark = useIsDark()
  const teamColor = highlightColor(item.teamId, isDark)
  const achieved = !!item.achievedOn
  const isRecord = item.kind === 'record'
  const accent = achieved ? ACHIEVED_GREEN : isRecord ? RECORD_GOLD : teamColor
  const clickable = !!onPlayerClick

  return (
    <Box
      onClick={() => onPlayerClick?.(item.playerId)}
      sx={{
        display: 'flex', alignItems: 'center', gap: 1.25, px: 1.5, py: '9px',
        borderLeft: `3px solid ${isLive ? LIVE_RED : accent}`,
        cursor: clickable ? 'pointer' : 'default',
        '&:hover': { bgcolor: clickable ? 'action.hover' : undefined },
        transition: 'background 0.12s',
      }}
    >
      <TeamLogo teamId={item.teamId} abbr={item.teamAbbr} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
          <Typography sx={{ fontSize: '0.84rem', fontWeight: 700, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {item.playerName}
          </Typography>
          {isLive && <LiveBadge />}
          {!isLive && achieved && <Tag color={ACHIEVED_GREEN}>✓ Reached</Tag>}
          {!isLive && !achieved && isRecord && <Tag color={RECORD_GOLD}>Record</Tag>}
        </Box>
        {achieved ? (
          <Typography sx={{ mt: '2px', fontSize: '0.6rem', color: 'text.disabled', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            Reached {item.target} {item.statLabel} · {relativeDay(item.achievedOn!)}
          </Typography>
        ) : (
          <Box sx={{ mt: '4px' }}>
            <MeterBar fill={proximity(item)} color={isLive ? LIVE_RED : accent} live={isLive} height={3} />
          </Box>
        )}
      </Box>
      <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
        {achieved ? (
          <Typography sx={{ fontSize: '1.1rem', fontWeight: 800, lineHeight: 1, color: ACHIEVED_GREEN }}>✓</Typography>
        ) : (<>
          <Typography sx={{ fontSize: '0.9rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1, color: item.remaining <= 3 ? ACHIEVED_GREEN : 'text.primary' }}>
            {item.remaining}
          </Typography>
          <Typography sx={{ fontSize: '0.58rem', color: 'text.disabled', lineHeight: 1.1, whiteSpace: 'nowrap' }}>
            {item.statLabel} to {item.target}
          </Typography>
        </>)}
      </Box>
    </Box>
  )
}

// ─── View-all modal ───────────────────────────────────────────────────────────

// The chase side of the modal, split by kind. The reached side is a single season-long
// list (newest first) rather than kind sections, so it lives under the Reached tab below.
const CHASE_SECTIONS: { key: MilestoneItem['kind']; label: string }[] = [
  { key: 'record', label: 'Record chases' },
  { key: 'career', label: 'Career milestones' },
  { key: 'season', label: 'This season' },
]

type ModalTab = 'chasing' | 'reached'

type GroupFilter = 'all' | 'hitting' | 'pitching'
const GROUP_FILTERS: { key: GroupFilter; label: string }[] = [
  { key: 'all',      label: 'All' },
  { key: 'hitting',  label: '⚾ Hitting' },
  { key: 'pitching', label: '🥎 Pitching' },
]

// One tab of the Chasing / Reached segmented control.
function TabButton({ active, label, count, color, onClick }: {
  active: boolean; label: string; count: number; color: string; onClick: () => void
}) {
  return (
    <Box
      onClick={onClick}
      sx={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5,
        py: '5px', borderRadius: 2, cursor: 'pointer', userSelect: 'none', transition: 'all 0.12s',
        bgcolor: active ? `${color}18` : 'transparent',
        border: '1px solid', borderColor: active ? color : 'transparent',
      }}
    >
      <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, color: active ? color : 'text.secondary' }}>{label}</Typography>
      <Typography sx={{ fontSize: '0.62rem', fontWeight: 700, color: active ? color : 'text.disabled', fontVariantNumeric: 'tabular-nums' }}>{count}</Typography>
    </Box>
  )
}

function MilestoneModal({ items, reached, liveTeamIds, onClose, onPlayerClick }: {
  items: MilestoneItem[]
  reached: MilestoneItem[]
  liveTeamIds?: Set<number>
  onClose: () => void
  onPlayerClick?: (id: number) => void
}) {
  const isDark = useIsDark()
  // Open on whichever side has content — if there are no live chases (offseason), lead
  // with the reached archive instead of an empty Chasing tab.
  const [tab, setTab] = useState<ModalTab>(items.length ? 'chasing' : 'reached')
  const [groupFilter, setGroupFilter] = useState<GroupFilter>('all')
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const isLive = (it: MilestoneItem) => !!liveTeamIds?.has(it.teamId)
  const matchesGroup = (it: MilestoneItem) => groupFilter === 'all' || it.group === groupFilter
  const pool = tab === 'chasing' ? items : reached
  const hasPitching = pool.some(it => it.group === 'pitching')
  const hasHitting = pool.some(it => it.group === 'hitting')
  const reachedFiltered = reached.filter(matchesGroup)

  return (
    <Box
      onClick={onClose}
      sx={{ position: 'fixed', inset: 0, zIndex: 1500, bgcolor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}
    >
      <Box
        onClick={e => e.stopPropagation()}
        sx={{ width: '100%', maxWidth: 460, maxHeight: '90vh', overflow: 'auto', borderRadius: 3, border: '1px solid', borderColor: defaultBorder(isDark), bgcolor: 'background.paper' }}
      >
        <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider', position: 'sticky', top: 0, bgcolor: 'background.paper', zIndex: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography sx={{ fontWeight: 800, fontSize: '0.95rem' }}>🏆 Milestone Watch</Typography>
            <Box onClick={onClose} sx={{ cursor: 'pointer', px: 1, fontSize: '1.1rem', color: 'text.secondary', '&:hover': { color: 'text.primary' } }}>✕</Box>
          </Box>
          {/* Chasing ↔ Reached — the reached side is the whole season's archive */}
          <Box sx={{ display: 'flex', gap: 0.5, mt: 1, p: '2px', borderRadius: 2, bgcolor: 'action.hover' }}>
            <TabButton active={tab === 'chasing'} label="Chasing" count={items.length} color={ACCENT} onClick={() => setTab('chasing')} />
            <TabButton active={tab === 'reached'} label="Reached" count={reached.length} color={ACHIEVED_GREEN} onClick={() => setTab('reached')} />
          </Box>
          {/* Hitting / pitching filter — only worth showing when both are present */}
          {hasPitching && hasHitting && (
            <Box sx={{ display: 'flex', gap: 0.5, mt: 1 }}>
              {GROUP_FILTERS.map(f => (
                <Box
                  key={f.key}
                  onClick={() => setGroupFilter(f.key)}
                  sx={{
                    px: 1.25, py: '3px', borderRadius: 999, cursor: 'pointer',
                    fontSize: '0.66rem', fontWeight: 700, userSelect: 'none',
                    border: '1px solid',
                    borderColor: groupFilter === f.key ? ACCENT : 'divider',
                    bgcolor: groupFilter === f.key ? `${ACCENT}18` : 'transparent',
                    color: groupFilter === f.key ? ACCENT : 'text.secondary',
                    transition: 'all 0.12s',
                  }}
                >
                  {f.label}
                </Box>
              ))}
            </Box>
          )}
        </Box>

        {tab === 'chasing' ? (
          CHASE_SECTIONS.map(g => {
            const groupItems = items.filter(it => it.kind === g.key).filter(matchesGroup)
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
                    <MilestoneRow item={it} isLive={isLive(it)} onPlayerClick={onPlayerClick} />
                  </Box>
                ))}
              </Box>
            )
          })
        ) : reachedFiltered.length ? (
          reachedFiltered.map(it => (
            <Box key={`${it.playerId}-${it.statKey}-${it.target}`} sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
              <MilestoneRow item={it} isLive={isLive(it)} onPlayerClick={onPlayerClick} />
            </Box>
          ))
        ) : (
          <Box sx={{ px: 2, py: 4, textAlign: 'center' }}>
            <Typography sx={{ fontSize: '0.8rem', color: 'text.secondary' }}>
              No milestones reached yet this season.
            </Typography>
            <Typography sx={{ mt: 0.5, fontSize: '0.68rem', color: 'text.disabled' }}>
              Check back as the chases above cross the line.
            </Typography>
          </Box>
        )}
      </Box>
    </Box>
  )
}

// ─── Card ─────────────────────────────────────────────────────────────────────

export function MilestoneWatchCard({ season, liveTeamIds, onPlayerClick }: {
  season: number
  liveTeamIds?: Set<number>
  onPlayerClick?: (id: number) => void
}) {
  const isDark = useIsDark()
  const [items, setItems] = useState<MilestoneItem[] | null>(null)
  const [recent, setRecent] = useState<MilestoneItem[]>([])
  const [reached, setReached] = useState<MilestoneItem[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [pendingOpen, setPendingOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchMilestoneData(season)
      .then(d => { if (!cancelled) { setItems(d?.items ?? null); setRecent(d?.recent ?? []); setReached(d?.reached ?? []) } })
      .catch(() => { if (!cancelled) { setItems([]); setRecent([]); setReached([]) } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [season])

  // A milestone notification click opens the full board. Queued until the data has
  // loaded so a cold start from a push doesn't open onto nothing.
  useDeepLink('milestones', () => setPendingOpen(true))
  useEffect(() => {
    if (pendingOpen && ((items && items.length) || reached.length)) { setModalOpen(true); setPendingOpen(false) }
  }, [pendingOpen, items, reached])

  // While loading, or when the row is missing/stale/empty, render nothing — the
  // card simply isn't part of the feed rather than flashing a spinner that then
  // vanishes. (fetchMilestoneData resolves to null for a missing table, so the
  // loading flag is what distinguishes "still fetching" from "nothing to show".)
  const chases = items ?? []
  if (loading || (!chases.length && !recent.length)) return null

  const isLive = (it: MilestoneItem) => !!liveTeamIds?.has(it.teamId)

  // Float chases whose team is playing right now to the front — those are the ones
  // that could actually fall tonight — while keeping the precomputed records-then-
  // closeness order within each group.
  const orderedChases = [...chases].sort((a, b) => Number(isLive(b)) - Number(isLive(a)))

  // Lead with anyone who just reached one, then fill with the closest (live-first)
  // chases, up to FEATURED cards total.
  const recentCap = orderedChases.length ? RECENT_ON_CARD : FEATURED
  const featured = [...recent.slice(0, recentCap), ...orderedChases].slice(0, FEATURED)
  // The modal holds both tabs — every chase plus the whole season's reached archive
  // (recent ⊂ reached, so no double count). That's the "View all" universe.
  const total = chases.length + reached.length
  const anyLiveFeatured = featured.some(isLive)

  const subtitle = anyLiveFeatured
    ? 'Playing now, and closing in.'
    : recent.length
      ? 'Just reached, and closing in.'
      : 'Chasing history, closest first.'

  return (
    <>
      <Box sx={{ borderRadius: 3, border: '1px solid', borderColor: defaultBorder(isDark), bgcolor: 'background.paper', overflow: 'hidden' }}>
        <Box sx={{ px: 1.75, py: 1.25, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Typography sx={{ fontWeight: 800, fontSize: '0.9rem', lineHeight: 1.15 }}>🏆 Milestone Watch</Typography>
          <Typography sx={{ fontSize: '0.64rem', color: 'text.disabled', lineHeight: 1.2 }}>
            {subtitle}
          </Typography>
        </Box>

        {featured.map((it, i) => (
          <Box key={`${it.achievedOn ? 'r' : 'c'}-${it.playerId}-${it.statKey}-${it.target}`} sx={{ borderBottom: i < featured.length - 1 ? '1px solid' : 'none', borderColor: 'divider' }}>
            <FeaturedMilestone item={it} isLive={isLive(it)} onPlayerClick={onPlayerClick} />
          </Box>
        ))}

        {total > featured.length && (
          <Box
            onClick={() => setModalOpen(true)}
            sx={{ px: 1.75, py: '9px', borderTop: '1px solid', borderColor: 'divider', cursor: 'pointer', textAlign: 'center', '&:hover': { bgcolor: 'action.hover' } }}
          >
            <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: ACCENT }}>
              View all {total} →
            </Typography>
          </Box>
        )}
      </Box>

      {modalOpen && <MilestoneModal items={chases} reached={reached} liveTeamIds={liveTeamIds} onClose={() => setModalOpen(false)} onPlayerClick={onPlayerClick} />}
    </>
  )
}
