import React, { useState, useEffect, useRef } from 'react'
import { Box, Typography, InputBase } from '@mui/material'
import { Player } from '../types'
import { TEAM_BG, ACCENT, HEADSHOT, CURRENT_SEASON } from '../constants'
import { searchPlayers } from '../api'
import { fetchSuggestions, SuggestionChip, SuggestionPlayer } from './SuggestedPlayers'

// ─── Types ────────────────────────────────────────────────────────────────────

interface StatCell { label: string; value: string }

interface FollowedPlayerInfo {
  id:        number
  fullName:  string
  position:  string
  teamAbbr:  string
  teamId:    number
  isPitcher: boolean
  stats:     StatCell[]
}

// ─── Shared pill button style ─────────────────────────────────────────────────

const pillSx = (color = ACCENT, compact = false) => ({
  flexShrink: 0, cursor: 'pointer',
  fontSize: compact ? '0.62rem' : '0.68rem',
  fontWeight: 700, color,
  px: compact ? 1 : 1.25, py: 0.5,
  borderRadius: 999, border: `1px solid ${color}40`,
  transition: 'background 0.12s',
  '&:hover': { bgcolor: `${color}15` },
  whiteSpace: 'nowrap',
  userSelect: 'none' as const,
})

// ─── Fetch ────────────────────────────────────────────────────────────────────

async function fetchFollowedPlayerData(id: number): Promise<FollowedPlayerInfo | null> {
  try {
    const season = CURRENT_SEASON
    const [detRes, hitRes, pitRes] = await Promise.all([
      fetch(`https://statsapi.mlb.com/api/v1/people/${id}?hydrate=currentTeam`).then(r => r.json()),
      fetch(`https://statsapi.mlb.com/api/v1/people/${id}/stats?stats=season&group=hitting&season=${season}`).then(r => r.json()).catch(() => null),
      fetch(`https://statsapi.mlb.com/api/v1/people/${id}/stats?stats=season&group=pitching&season=${season}`).then(r => r.json()).catch(() => null),
    ])
    const p = detRes.people?.[0]
    if (!p) return null
    const isPitcher = p.primaryPosition?.code === '1'
    const hitStat   = hitRes?.stats?.[0]?.splits?.[0]?.stat ?? null
    const pitStat   = pitRes?.stats?.[0]?.splits?.[0]?.stat ?? null

    let stats: StatCell[] = []
    if (!isPitcher && hitStat) {
      stats = [
        { label: 'AVG',  value: hitStat.avg ?? '—' },
        { label: 'HR',   value: String(hitStat.homeRuns ?? '—') },
        { label: 'OPS',  value: hitStat.ops ?? '—' },
      ]
    } else if (isPitcher && pitStat) {
      stats = [
        { label: 'ERA',  value: pitStat.era ?? '—' },
        { label: 'K',    value: String(pitStat.strikeOuts ?? '—') },
        { label: 'WHIP', value: pitStat.whip ?? '—' },
      ]
    }

    return {
      id: p.id,
      fullName:  p.fullName ?? '',
      position:  p.primaryPosition?.abbreviation ?? p.primaryPosition?.code ?? '?',
      teamAbbr:  p.currentTeam?.abbreviation ?? '',
      teamId:    Number(p.currentTeam?.id ?? 0),
      isPitcher,
      stats,
    }
  } catch { return null }
}

// ─── FollowedPlayerRow ────────────────────────────────────────────────────────

function FollowedPlayerRow({ id, data, isLive, editMode, isSelected, onRemove, onToggleSelect, onClick }: {
  id:             number
  data:           FollowedPlayerInfo | null
  isLive:         boolean
  editMode:       boolean
  isSelected:     boolean
  onRemove:       () => void
  onToggleSelect: () => void
  onClick:        () => void
}) {
  const teamColor  = TEAM_BG[data?.teamId ?? 0] ?? '#444'
  const subtitle   = data ? [data.position, data.teamAbbr].filter(Boolean).join(' · ') : ''
  const statCells  = (data?.stats && data.stats.length > 0)
    ? data.stats
    : [{ label: '···', value: '—' }, { label: '···', value: '—' }, { label: '···', value: '—' }]

  return (
    <Box
      onClick={editMode ? onToggleSelect : onClick}
      sx={{
        display: 'flex', alignItems: 'center',
        gap: { xs: 1, sm: 1.5 },
        px: 1.5, py: 0.9,
        cursor: 'pointer', borderRadius: 1.5,
        transition: 'background 0.12s',
        bgcolor: isSelected ? `${ACCENT}14` : 'transparent',
        '&:hover': { bgcolor: isSelected ? `${ACCENT}1e` : 'action.hover' },
        ...(!editMode && { '&:hover .fp-remove': { opacity: 1 } }),
      }}
    >
      {/* Selection circle — edit mode */}
      {editMode && (
        <Box sx={{
          flexShrink: 0, width: 20, height: 20, borderRadius: '50%',
          border: '2px solid', borderColor: isSelected ? ACCENT : 'text.disabled',
          bgcolor: isSelected ? ACCENT : 'transparent',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'all 0.15s',
          color: '#fff', fontSize: '0.6rem', fontWeight: 900, lineHeight: 1,
        }}>
          {isSelected && '✓'}
        </Box>
      )}

      {/* Headshot */}
      <Box sx={{
        position: 'relative', flexShrink: 0,
        width: 30, height: 38, borderRadius: 1,
        overflow: 'hidden', bgcolor: 'action.hover',
        border: `2px solid ${teamColor}50`,
      }}>
        <Box
          component="img"
          src={HEADSHOT(id)}
          alt={data?.fullName ?? ''}
          sx={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 20%', display: 'block' }}
        />
        {isLive && (
          <Box sx={{
            position: 'absolute', bottom: 0, left: 0, right: 0,
            bgcolor: 'rgba(239,68,68,0.92)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            py: '1.5px',
          }}>
            <Typography sx={{ fontSize: '0.37rem', fontWeight: 900, color: '#fff', lineHeight: 1, letterSpacing: '0.5px' }}>
              LIVE
            </Typography>
          </Box>
        )}
      </Box>

      {/* Name + pos/team */}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{
          fontWeight: 700, fontSize: { xs: '0.78rem', sm: '0.82rem' }, lineHeight: 1.2,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {data?.fullName ?? '…'}
        </Typography>
        {subtitle && (
          <Typography sx={{ fontSize: '0.62rem', color: 'text.secondary', lineHeight: 1.3 }}>
            {subtitle}
          </Typography>
        )}
      </Box>

      {/* Stat cells */}
      {statCells.map((s, idx) => (
        <Box key={idx} sx={{ flexShrink: 0, textAlign: 'right', minWidth: { xs: 28, sm: 36 } }}>
          <Typography sx={{
            fontWeight: 800, fontSize: { xs: '0.8rem', sm: '0.88rem' }, lineHeight: 1.1,
            fontVariantNumeric: 'tabular-nums', color: 'text.primary',
          }}>
            {s.value}
          </Typography>
          <Typography sx={{
            fontSize: '0.52rem', fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: 0.4,
            color: 'text.disabled', lineHeight: 1,
          }}>
            {s.label}
          </Typography>
        </Box>
      ))}

      {/* Remove button — normal mode */}
      {!editMode && (
        <Box
          className="fp-remove"
          onClick={e => { e.stopPropagation(); onRemove() }}
          sx={{
            flexShrink: 0,
            width: 20, height: 20, borderRadius: '50%',
            bgcolor: 'transparent', color: 'text.disabled',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '0.6rem', fontWeight: 900, cursor: 'pointer',
            opacity: 0, transition: 'opacity 0.12s',
            '&:hover': { bgcolor: 'error.main', color: '#fff' },
          }}
        >
          ✕
        </Box>
      )}
    </Box>
  )
}

// ─── FollowedPlayersSection ───────────────────────────────────────────────────

export function FollowedPlayersSection({ followedPlayerIds, onUnfollow, onPlayerClick, onFollow, liveTeamIds, compact, teamId }: {
  followedPlayerIds: number[]
  onUnfollow:    (id: number) => void
  onPlayerClick: (id: number) => void
  onFollow:      (id: number) => void
  liveTeamIds?:  Set<number>
  compact?:      boolean
  teamId?:       number
}) {
  const [playerData, setPlayerData]     = useState<Record<number, FollowedPlayerInfo>>({})
  const [adding, setAdding]             = useState(false)
  const [addQuery, setAddQuery]         = useState('')
  const [addResults, setAddResults]     = useState<Player[]>([])
  const [addSearching, setAddSearching] = useState(false)
  const [suggestions, setSuggestions]   = useState<SuggestionPlayer[]>([])
  const [editMode, setEditMode]         = useState(false)
  const [selected, setSelected]         = useState<Set<number>>(new Set())
  const searchRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    for (const id of followedPlayerIds) {
      if (playerData[id]) continue
      fetchFollowedPlayerData(id).then(data => {
        if (data) setPlayerData(prev => ({ ...prev, [id]: data }))
      }).catch(() => {})
    }
  }, [followedPlayerIds]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!adding || !teamId) return
    fetchSuggestions(teamId, followedPlayerIds).then(setSuggestions).catch(() => {})
  }, [adding, teamId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (addQuery.length < 2) { setAddResults([]); return }
    const t = setTimeout(async () => {
      setAddSearching(true)
      try { setAddResults((await searchPlayers(addQuery)).slice(0, 6)) }
      finally { setAddSearching(false) }
    }, 320)
    return () => clearTimeout(t)
  }, [addQuery])

  useEffect(() => {
    if (!adding) return
    const handle = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setAdding(false); setAddQuery(''); setAddResults([])
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [adding])

  const handleAdd = (p: Player) => {
    onFollow(p.id)
    setAdding(false); setAddQuery(''); setAddResults([])
  }

  const toggleSelect = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const exitEditMode = () => { setEditMode(false); setSelected(new Set()) }

  const handleDeleteSelected = () => {
    selected.forEach(id => onUnfollow(id))
    exitEditMode()
  }

  return (
    <Box sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', overflow: 'hidden', flex: 1 }}>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <Box sx={{
        px: 1.5, py: compact ? 1.1 : 1.4,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid', borderColor: 'divider',
        gap: 0.5, minHeight: 40,
      }}>
        <Typography sx={{
          fontWeight: 800,
          fontSize: compact ? '0.65rem' : '0.72rem',
          textTransform: 'uppercase', letterSpacing: 1.2,
          color: editMode ? 'text.secondary' : ACCENT,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          transition: 'color 0.15s',
        }}>
          {editMode
            ? (selected.size > 0 ? `${selected.size} selected` : 'Tap to select')
            : (compact ? '★ Players' : '★ Your Players')}
        </Typography>

        <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center', flexShrink: 0 }}>
          {editMode ? (
            <>
              {selected.size > 0 && (
                <Box onClick={handleDeleteSelected} sx={pillSx('#ef4444', compact)}>
                  Remove {selected.size}
                </Box>
              )}
              <Box onClick={exitEditMode} sx={pillSx(ACCENT, compact)}>
                Done
              </Box>
            </>
          ) : (
            <>
              {followedPlayerIds.length > 0 && (
                <Box onClick={() => { setEditMode(true); setAdding(false); setAddQuery(''); setAddResults([]) }}
                  sx={pillSx(ACCENT, compact)}>
                  ✎ Edit
                </Box>
              )}
              <Box
                onClick={() => { setAdding(a => !a); setAddQuery(''); setAddResults([]) }}
                sx={pillSx(ACCENT, compact)}
              >
                {adding ? '✕' : '+ Add'}
              </Box>
            </>
          )}
        </Box>
      </Box>

      <Box sx={{ pt: adding ? 1.5 : 0, pb: 0.5 }}>
        {/* ── Add-player search ─────────────────────────────────────────────── */}
        {adding && (
          <Box ref={searchRef} sx={{ mb: 1, px: 1.5, position: 'relative' }}>
            <InputBase
              autoFocus
              placeholder="Search player…"
              value={addQuery}
              onChange={e => setAddQuery(e.target.value)}
              onKeyDown={e => e.key === 'Escape' && (setAdding(false), setAddQuery(''), setAddResults([]))}
              sx={{
                width: '100%', px: 1.25, py: 0.75,
                bgcolor: 'action.hover', borderRadius: 2,
                fontSize: compact ? '0.8rem' : '0.875rem',
                border: '1px solid', borderColor: 'divider',
              }}
            />
            {(addResults.length > 0 || addSearching) && (
              <Box sx={{
                position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 200,
                bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider',
                borderRadius: 2, overflow: 'hidden',
                boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
              }}>
                {addSearching && !addResults.length && (
                  <Box sx={{ px: 2, py: 1.5 }}>
                    <Typography sx={{ fontSize: '0.78rem', color: 'text.disabled' }}>Searching…</Typography>
                  </Box>
                )}
                {addResults.map((p, i) => (
                  <Box
                    key={p.id}
                    onClick={() => handleAdd(p)}
                    sx={{
                      px: 1.5, py: 0.9, cursor: 'pointer',
                      borderTop: i > 0 ? '1px solid' : 'none', borderColor: 'divider',
                      display: 'flex', alignItems: 'center', gap: 1.25,
                      '&:hover': { bgcolor: 'action.hover' },
                    }}
                  >
                    <Box sx={{ width: 32, height: 32, borderRadius: '50%', overflow: 'hidden', bgcolor: 'action.hover', flexShrink: 0 }}>
                      <Box component="img" src={HEADSHOT(p.id)}
                        sx={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 20%' }} />
                    </Box>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography sx={{ fontWeight: 700, fontSize: '0.82rem', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {p.fullName}
                      </Typography>
                      <Typography sx={{ fontSize: '0.68rem', color: 'text.secondary' }}>
                        {p.primaryPosition?.name}{!p.active ? ' · retired' : ''}
                      </Typography>
                    </Box>
                    {followedPlayerIds.includes(p.id) && (
                      <Typography sx={{ fontSize: '0.6rem', color: ACCENT, fontWeight: 700, ml: 'auto', flexShrink: 0 }}>
                        ✓
                      </Typography>
                    )}
                  </Box>
                ))}
              </Box>
            )}
            {addQuery.length < 2 && suggestions.length > 0 && (
              <Box sx={{
                position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 200,
                bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider',
                borderRadius: 2, boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
                p: 1.25, display: 'flex', flexDirection: 'column', gap: 0.75,
              }}>
                <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'text.disabled', px: 0.25 }}>
                  ✨ Suggested
                </Typography>
                {suggestions.map(p => (
                  <SuggestionChip
                    key={p.id}
                    player={p}
                    alreadyFollowed={followedPlayerIds.includes(p.id)}
                    onFollow={() => { onFollow(p.id); setAdding(false); setAddQuery(''); setAddResults([]) }}
                    onPlayerClick={onPlayerClick}
                  />
                ))}
              </Box>
            )}
          </Box>
        )}

        {/* ── Player rows ───────────────────────────────────────────────────── */}
        {followedPlayerIds.length === 0 ? (
          <Box sx={{ py: compact ? 2.5 : 3.5, textAlign: 'center' }}>
            <Typography sx={{ color: 'text.disabled', fontSize: compact ? '0.72rem' : '0.82rem', mb: 0.5, lineHeight: 1.4 }}>
              {compact ? 'No players yet' : 'No players followed yet'}
            </Typography>
            {!compact && (
              <Typography sx={{ color: 'text.disabled', fontSize: '0.72rem' }}>
                Tap <Box component="span" sx={{ color: ACCENT, fontWeight: 700 }}>+ Add</Box> to track players
              </Typography>
            )}
          </Box>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', py: 0.5, maxHeight: 260, overflowY: 'auto' }}>
            {followedPlayerIds.map((id, i) => {
              const data   = playerData[id] ?? null
              const isLive = !!(liveTeamIds && data?.teamId && liveTeamIds.has(data.teamId))
              return (
                <React.Fragment key={id}>
                  {i > 0 && <Box sx={{ height: '1px', bgcolor: 'divider', mx: 1.5 }} />}
                  <FollowedPlayerRow
                    id={id}
                    data={data}
                    isLive={isLive}
                    editMode={editMode}
                    isSelected={selected.has(id)}
                    onRemove={() => onUnfollow(id)}
                    onToggleSelect={() => toggleSelect(id)}
                    onClick={() => onPlayerClick(id)}
                  />
                </React.Fragment>
              )
            })}
          </Box>
        )}
      </Box>
    </Box>
  )
}
