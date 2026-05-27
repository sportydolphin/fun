import React, { useState, useEffect, useRef } from 'react'
import { Box, Typography, InputBase } from '@mui/material'
import { Player } from '../types'
import { TEAM_BG, ACCENT, HEADSHOT, CURRENT_SEASON } from '../constants'
import { searchPlayers } from '../api'

// ─── Types ────────────────────────────────────────────────────────────────────

interface FollowedPlayerInfo {
  id:        number
  fullName:  string
  position:  string
  teamAbbr:  string
  teamId:    number
  isPitcher: boolean
  keyLabel:  string
  keyValue:  string
}

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
    let keyLabel = '', keyValue = '—'
    if (!isPitcher && hitStat?.ops)  { keyLabel = 'OPS'; keyValue = hitStat.ops }
    else if (!isPitcher && hitStat?.avg) { keyLabel = 'AVG'; keyValue = hitStat.avg }
    else if (isPitcher && pitStat?.era)  { keyLabel = 'ERA'; keyValue = pitStat.era }
    return {
      id: p.id,
      fullName: p.fullName ?? '',
      position: p.primaryPosition?.abbreviation ?? p.primaryPosition?.code ?? '?',
      teamAbbr: p.currentTeam?.abbreviation ?? '—',
      teamId: Number(p.currentTeam?.id ?? 0),
      isPitcher,
      keyLabel,
      keyValue,
    }
  } catch { return null }
}

// ─── FollowedPlayerCard ───────────────────────────────────────────────────────

function FollowedPlayerCard({ id, data, onRemove, onClick }: {
  id:       number
  data:     FollowedPlayerInfo | null
  onRemove: () => void
  onClick:  () => void
}) {
  const teamColor = TEAM_BG[data?.teamId ?? 0] ?? '#444'

  return (
    <Box
      onClick={onClick}
      sx={{
        position: 'relative', flexShrink: 0,
        width: 86, borderRadius: 2.5,
        border: '1px solid', borderColor: 'divider',
        bgcolor: 'background.paper', overflow: 'hidden',
        cursor: 'pointer',
        transition: 'border-color 0.15s, box-shadow 0.15s',
        '&:hover': { borderColor: ACCENT, boxShadow: `0 0 0 1px ${ACCENT}40` },
        '&:hover .remove-btn': { opacity: 1 },
      }}
    >
      <Box
        className="remove-btn"
        onClick={e => { e.stopPropagation(); onRemove() }}
        sx={{
          position: 'absolute', top: 22, right: 4, zIndex: 3,
          width: 18, height: 18, borderRadius: '50%',
          bgcolor: 'rgba(0,0,0,0.65)', color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '0.6rem', fontWeight: 900, cursor: 'pointer',
          opacity: 0, transition: 'opacity 0.12s',
          lineHeight: 1,
        }}
      >
        ✕
      </Box>

      <Box sx={{ height: 3, bgcolor: teamColor }} />

      <Box sx={{ px: 1, pt: 1, pb: 1.25, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
        <Box sx={{
          width: 54, height: 62, borderRadius: 1.5,
          overflow: 'hidden', bgcolor: 'action.hover', flexShrink: 0,
        }}>
          <Box
            component="img"
            src={HEADSHOT(id)}
            alt={data?.fullName ?? ''}
            sx={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 15%', display: 'block' }}
          />
        </Box>

        <Typography sx={{
          fontWeight: 700, fontSize: '0.65rem', lineHeight: 1.2,
          textAlign: 'center', px: 0.25,
          display: '-webkit-box', WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>
          {data?.fullName ?? '…'}
        </Typography>

        <Typography sx={{ fontSize: '0.56rem', color: 'text.disabled', lineHeight: 1 }}>
          {data ? `${data.position} · ${data.teamAbbr}` : ''}
        </Typography>

        {data?.keyValue && data.keyValue !== '—' && (
          <Box sx={{ textAlign: 'center', mt: 0.25 }}>
            <Typography sx={{ fontSize: '0.48rem', color: 'text.disabled', textTransform: 'uppercase', letterSpacing: 0.5, lineHeight: 1 }}>
              {data.keyLabel}
            </Typography>
            <Typography sx={{ fontSize: '0.9rem', fontWeight: 800, lineHeight: 1.1 }}>
              {data.keyValue}
            </Typography>
          </Box>
        )}
      </Box>
    </Box>
  )
}

// ─── FollowedPlayersSection ───────────────────────────────────────────────────

export function FollowedPlayersSection({ followedPlayerIds, onUnfollow, onPlayerClick, onFollow }: {
  followedPlayerIds: number[]
  onUnfollow:    (id: number) => void
  onPlayerClick: (id: number) => void
  onFollow:      (id: number) => void
}) {
  const [playerData, setPlayerData]     = useState<Record<number, FollowedPlayerInfo>>({})
  const [adding, setAdding]             = useState(false)
  const [addQuery, setAddQuery]         = useState('')
  const [addResults, setAddResults]     = useState<Player[]>([])
  const [addSearching, setAddSearching] = useState(false)
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

  return (
    <Box sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', overflow: 'hidden' }}>
      <Box sx={{ px: 2.5, py: 1.75, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid', borderColor: 'divider' }}>
        <Typography sx={{ fontWeight: 800, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: 1.5, color: ACCENT }}>
          ★ Your Players
        </Typography>
        <Box
          onClick={() => { setAdding(a => !a); setAddQuery(''); setAddResults([]) }}
          sx={{
            cursor: 'pointer', fontSize: '0.68rem', fontWeight: 700, color: ACCENT,
            px: 1.5, py: 0.5, borderRadius: 999,
            border: `1px solid ${ACCENT}40`,
            transition: 'background 0.12s',
            '&:hover': { bgcolor: `${ACCENT}15` },
          }}
        >
          {adding ? '✕ Cancel' : '+ Add'}
        </Box>
      </Box>

      <Box sx={{ px: 2.5, pt: 2, pb: 2.5 }}>
        {adding && (
          <Box ref={searchRef} sx={{ mb: 2, position: 'relative' }}>
            <InputBase
              autoFocus
              placeholder="Search player…"
              value={addQuery}
              onChange={e => setAddQuery(e.target.value)}
              onKeyDown={e => e.key === 'Escape' && (setAdding(false), setAddQuery(''), setAddResults([]))}
              sx={{
                width: '100%', px: 1.5, py: 0.875,
                bgcolor: 'action.hover', borderRadius: 2,
                fontSize: '0.875rem', border: '1px solid', borderColor: 'divider',
              }}
            />
            {(addResults.length > 0 || addSearching) && (
              <Box sx={{
                position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 100,
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
                        sx={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 15%' }} />
                    </Box>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography sx={{ fontWeight: 700, fontSize: '0.82rem', lineHeight: 1.2 }}>
                        {p.fullName}
                      </Typography>
                      <Typography sx={{ fontSize: '0.68rem', color: 'text.secondary' }}>
                        {p.primaryPosition?.name}{!p.active ? ' · retired' : ''}
                      </Typography>
                    </Box>
                    {followedPlayerIds.includes(p.id) && (
                      <Typography sx={{ fontSize: '0.6rem', color: ACCENT, fontWeight: 700, ml: 'auto', flexShrink: 0 }}>
                        ✓ Following
                      </Typography>
                    )}
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        )}

        {followedPlayerIds.length === 0 ? (
          <Box sx={{ py: 3, textAlign: 'center' }}>
            <Typography sx={{ color: 'text.disabled', fontSize: '0.82rem', mb: 0.5 }}>No players followed yet</Typography>
            <Typography sx={{ color: 'text.disabled', fontSize: '0.72rem' }}>
              Tap <Box component="span" sx={{ color: ACCENT, fontWeight: 700 }}>+ Add</Box> to follow players and track them here
            </Typography>
          </Box>
        ) : (
          <Box sx={{
            display: 'flex', gap: 1.25, overflowX: 'auto', pb: 0.5,
            '&::-webkit-scrollbar': { display: 'none' },
            scrollbarWidth: 'none',
          }}>
            {followedPlayerIds.map(id => (
              <FollowedPlayerCard
                key={id}
                id={id}
                data={playerData[id] ?? null}
                onRemove={() => onUnfollow(id)}
                onClick={() => onPlayerClick(id)}
              />
            ))}
          </Box>
        )}
      </Box>
    </Box>
  )
}
