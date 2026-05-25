import React, { useState, useEffect, useRef } from 'react'
import { Box, Typography, InputBase, useTheme } from '@mui/material'
import { Team, Player } from '../types'
import { TEAM_BG, ACCENT, HEADSHOT, CURRENT_SEASON, TEAM_ABBR } from '../constants'
import { searchPlayers, fetchDivisionForTeam } from '../api'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ordinal(n: number): string {
  const s = ['th','st','nd','rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0])
}

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
function chipDate(d: string) {
  const [, m, day] = d.split('-').map(Number)
  return `${MONTHS_SHORT[m - 1]} ${day}`
}

// ─── Team logo ─────────────────────────────────────────────────────────────────

function TeamLogoCircle({ teamId, abbr, size }: { teamId: number; abbr: string; size: number }) {
  const [failed, setFailed] = useState(false)
  const bg = TEAM_BG[teamId] ?? '#444'
  return (
    <Box sx={{
      width: size, height: size, borderRadius: '50%', bgcolor: bg,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      overflow: 'hidden', flexShrink: 0,
    }}>
      {failed ? (
        <Typography sx={{ color: '#fff', fontWeight: 900, fontSize: size * 0.28, lineHeight: 1 }}>
          {abbr}
        </Typography>
      ) : (
        <Box
          component="img"
          src={`https://www.mlbstatic.com/team-logos/team-cap-on-dark/${teamId}.svg`}
          alt={abbr}
          onError={() => setFailed(true)}
          sx={{ width: '76%', height: '76%', objectFit: 'contain' }}
        />
      )}
    </Box>
  )
}

// ─── Team picker (shown when no team is followed) ─────────────────────────────

function TeamPicker({ allTeams, onSelect }: { allTeams: Team[]; onSelect: (id: number) => void }) {
  const sorted = [...allTeams].sort((a, b) => a.name.localeCompare(b.name))
  return (
    <Box>
      <Typography sx={{ fontWeight: 800, fontSize: '1.15rem', mb: 0.5 }}>
        Pick Your Team
      </Typography>
      <Typography sx={{ color: 'text.secondary', fontSize: '0.82rem', mb: 3 }}>
        Follow a team to make this your home base
      </Typography>
      <Box sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(76px, 1fr))',
        gap: 1,
      }}>
        {sorted.map(t => {
          const bg = TEAM_BG[t.id] ?? '#333'
          return (
            <Box
              key={t.id}
              onClick={() => onSelect(t.id)}
              sx={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.75,
                p: 1.25, borderRadius: 2,
                border: '1.5px solid', borderColor: 'transparent',
                cursor: 'pointer', userSelect: 'none',
                transition: 'all 0.15s',
                '&:hover': { borderColor: bg, bgcolor: `${bg}20`, transform: 'scale(1.04)' },
              }}
            >
              <Box sx={{
                width: 44, height: 44, borderRadius: '50%', bgcolor: bg,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                overflow: 'hidden', flexShrink: 0,
              }}>
                <Box
                  component="img"
                  src={`https://www.mlbstatic.com/team-logos/team-cap-on-dark/${t.id}.svg`}
                  alt={t.abbreviation}
                  sx={{ width: 34, height: 34, objectFit: 'contain' }}
                  onError={(e: React.SyntheticEvent<HTMLImageElement>) => {
                    e.currentTarget.style.display = 'none'
                  }}
                />
              </Box>
              <Typography sx={{ fontSize: '0.62rem', fontWeight: 800, color: 'text.primary', textAlign: 'center', lineHeight: 1.2 }}>
                {t.abbreviation}
              </Typography>
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}

// ─── Schedule types & fetch ───────────────────────────────────────────────────

interface ScheduleGame {
  gamePk:        number
  date:          string
  gameTime:      string
  isHome:        boolean
  opponentId:    number
  opponentAbbr:  string
  state:         'final' | 'live' | 'preview'
  teamScore:     number | null
  opponentScore: number | null
  isWin:         boolean | null
}

async function fetchTeamSchedule(teamId: number): Promise<ScheduleGame[]> {
  const today = new Date()
  const start = new Date(today); start.setDate(start.getDate() - 14)
  const end   = new Date(today); end.setDate(end.getDate() + 21)
  const toISO = (d: Date) => d.toISOString().split('T')[0]

  const r = await fetch(
    `https://statsapi.mlb.com/api/v1/schedule?teamId=${teamId}&sportId=1` +
    `&startDate=${toISO(start)}&endDate=${toISO(end)}&gameType=R` +
    `&fields=dates,date,games,gamePk,gameDate,status,abstractGameState,teams,home,away,team,id,score,isWinner`
  )
  const d = await r.json()

  const games: ScheduleGame[] = []
  for (const dateObj of d.dates ?? []) {
    for (const game of dateObj.games ?? []) {
      const isHome = Number(game.teams?.home?.team?.id) === teamId
      const opp    = isHome ? game.teams.away : game.teams.home
      const mine   = isHome ? game.teams.home : game.teams.away
      const raw    = game.status?.abstractGameState ?? 'Preview'
      const state  = raw === 'Final' ? 'final' : raw === 'Live' ? 'live' : 'preview'
      games.push({
        gamePk:        game.gamePk,
        date:          dateObj.date,
        gameTime:      game.gameDate ? new Date(game.gameDate).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '',
        isHome,
        opponentId:    Number(opp?.team?.id ?? 0),
        opponentAbbr:  TEAM_ABBR[Number(opp?.team?.id ?? 0)] ?? '???',
        state:         state as ScheduleGame['state'],
        teamScore:     state !== 'preview' ? Number(mine?.score ?? 0) : null,
        opponentScore: state !== 'preview' ? Number(opp?.score  ?? 0) : null,
        isWin:         state === 'final' ? Boolean(mine?.isWinner) : null,
      })
    }
  }
  return games.sort((a, b) => a.date.localeCompare(b.date))
}

// ─── Game chip ────────────────────────────────────────────────────────────────

function GameChip({ game, teamColor, highlight, isActualToday, innerRef }: {
  game:          ScheduleGame
  teamColor:     string
  highlight:     boolean
  isActualToday: boolean
  innerRef?: React.RefObject<HTMLDivElement>
}) {
  const isFinal = game.state === 'final'
  const isLive  = game.state === 'live'
  const isWin   = game.isWin === true

  return (
    <Box
      ref={innerRef}
      sx={{
        flexShrink: 0, width: 70,
        borderRadius: 2,
        border: `1.5px solid`,
        borderColor: highlight ? `${teamColor}90` : `${teamColor}22`,
        bgcolor: highlight ? `${teamColor}14` : `${teamColor}06`,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        py: 1.25, px: 0.75, gap: 0.5,
        position: 'relative', overflow: 'hidden',
      }}
    >
      {/* TODAY / NEXT / LIVE banner */}
      {highlight && (
        <Box sx={{
          position: 'absolute', top: 0, left: 0, right: 0,
          bgcolor: isLive ? '#ef4444' : isActualToday ? teamColor : `${teamColor}90`,
          py: '2.5px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Typography sx={{
            fontSize: '0.44rem', fontWeight: 900, letterSpacing: 1.5,
            color: '#fff', textTransform: 'uppercase', lineHeight: 1,
          }}>
            {isLive ? '● LIVE' : isActualToday ? 'TODAY' : 'NEXT'}
          </Typography>
        </Box>
      )}

      {/* Date */}
      <Typography sx={{
        fontSize: '0.56rem', fontWeight: 600,
        color: 'text.disabled', lineHeight: 1,
        mt: highlight ? 1.4 : 0, letterSpacing: 0.3,
      }}>
        {chipDate(game.date)}
      </Typography>

      {/* @ / VS */}
      <Typography sx={{ fontSize: '0.46rem', fontWeight: 800, color: 'text.disabled', lineHeight: 1, letterSpacing: 0.8 }}>
        {game.isHome ? 'VS' : '@'}
      </Typography>

      {/* Opponent logo */}
      <Box sx={{
        width: 28, height: 28, borderRadius: '50%', bgcolor: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden', flexShrink: 0,
      }}>
        <Box
          component="img"
          src={`https://www.mlbstatic.com/team-logos/${game.opponentId}.svg`}
          alt={game.opponentAbbr}
          sx={{ width: 20, height: 20, objectFit: 'contain' }}
        />
      </Box>

      {/* Opponent abbr */}
      <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, color: 'text.primary', lineHeight: 1 }}>
        {game.opponentAbbr}
      </Typography>

      {/* Score / time / W-L */}
      {isFinal ? (
        <>
          <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, color: 'text.primary', lineHeight: 1 }}>
            {game.teamScore}–{game.opponentScore}
          </Typography>
          <Box sx={{ px: 0.75, py: '2px', borderRadius: 0.75, bgcolor: isWin ? '#22c55e22' : '#ef444422' }}>
            <Typography sx={{ fontSize: '0.58rem', fontWeight: 900, lineHeight: 1, color: isWin ? '#22c55e' : '#ef4444' }}>
              {isWin ? 'W' : 'L'}
            </Typography>
          </Box>
        </>
      ) : isLive ? (
        <Typography sx={{ fontSize: '0.7rem', fontWeight: 800, color: '#ef4444', lineHeight: 1 }}>
          {game.teamScore}–{game.opponentScore}
        </Typography>
      ) : (
        <Typography sx={{ fontSize: '0.54rem', fontWeight: 600, color: 'text.secondary', lineHeight: 1, textAlign: 'center' }}>
          {game.gameTime}
        </Typography>
      )}
    </Box>
  )
}

// ─── Schedule strip ───────────────────────────────────────────────────────────

function TeamScheduleStrip({ teamId, teamColor }: { teamId: number; teamColor: string }) {
  const theme     = useTheme()
  const paperBg   = theme.palette.background.paper
  const [games, setGames]     = useState<ScheduleGame[]>([])
  const [loading, setLoading] = useState(true)
  const chipRef      = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  // Use local date so we never bleed into the next calendar day via UTC offset
  const now   = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

  useEffect(() => {
    setLoading(true)
    fetchTeamSchedule(teamId).then(setGames).finally(() => setLoading(false))
  }, [teamId])

  useEffect(() => {
    const c = containerRef.current, el = chipRef.current
    if (!c || !el) return
    c.scrollTo({ left: Math.max(0, el.offsetLeft - c.clientWidth / 2 + el.offsetWidth / 2), behavior: 'smooth' })
  }, [games])

  if (loading) return (
    <Box sx={{ py: 2, textAlign: 'center' }}>
      <Typography sx={{ fontSize: '0.68rem', color: 'text.disabled' }}>Loading schedule…</Typography>
    </Box>
  )
  if (!games.length) return null

  const nextGame = games.find(g => g.date >= today) ?? games[games.length - 1]

  return (
    <Box sx={{ position: 'relative' }}>
      {/* Edge fades */}
      <Box sx={{ position: 'absolute', left: 0, top: 0, bottom: 8, width: 28, zIndex: 2,
        background: `linear-gradient(to right, ${paperBg}, transparent)`, pointerEvents: 'none' }} />
      <Box sx={{ position: 'absolute', right: 0, top: 0, bottom: 8, width: 28, zIndex: 2,
        background: `linear-gradient(to left, ${paperBg}, transparent)`, pointerEvents: 'none' }} />

      <Box
        ref={containerRef}
        sx={{
          display: 'flex', gap: 1, overflowX: 'auto', px: 3, pb: 1,
          '&::-webkit-scrollbar': { height: 3 },
          '&::-webkit-scrollbar-thumb': { bgcolor: `${teamColor}30`, borderRadius: 2 },
          scrollbarWidth: 'thin', scrollbarColor: `${teamColor}30 transparent`,
        }}
      >
        {games.map(g => {
          const isHL = g.gamePk === nextGame.gamePk
          return (
            <GameChip
              key={g.gamePk}
              game={g}
              teamColor={teamColor}
              highlight={isHL}
              isActualToday={isHL && nextGame.date === today}
              innerRef={isHL ? chipRef : undefined}
            />
          )
        })}
      </Box>
    </Box>
  )
}

// ─── Followed player data & fetch ─────────────────────────────────────────────

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

// ─── Followed player card ─────────────────────────────────────────────────────

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
      {/* Remove button (appears on hover) */}
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

      {/* Team color bar at top */}
      <Box sx={{ height: 3, bgcolor: teamColor }} />

      <Box sx={{ px: 1, pt: 1, pb: 1.25, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
        {/* Headshot */}
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

        {/* Name */}
        <Typography sx={{
          fontWeight: 700, fontSize: '0.65rem', lineHeight: 1.2,
          textAlign: 'center', px: 0.25,
          display: '-webkit-box', WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>
          {data?.fullName ?? '…'}
        </Typography>

        {/* Position · Team */}
        <Typography sx={{ fontSize: '0.56rem', color: 'text.disabled', lineHeight: 1 }}>
          {data ? `${data.position} · ${data.teamAbbr}` : ''}
        </Typography>

        {/* Key stat */}
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

// ─── Followed players section ─────────────────────────────────────────────────

function FollowedPlayersSection({ followedPlayerIds, onUnfollow, onPlayerClick, onFollow }: {
  followedPlayerIds: number[]
  onUnfollow:    (id: number) => void
  onPlayerClick: (id: number) => void
  onFollow:      (id: number) => void
}) {
  const [playerData, setPlayerData]   = useState<Record<number, FollowedPlayerInfo>>({})
  const [adding, setAdding]           = useState(false)
  const [addQuery, setAddQuery]       = useState('')
  const [addResults, setAddResults]   = useState<Player[]>([])
  const [addSearching, setAddSearching] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)

  // Fetch data for newly added players
  useEffect(() => {
    for (const id of followedPlayerIds) {
      if (playerData[id]) continue
      fetchFollowedPlayerData(id).then(data => {
        if (data) setPlayerData(prev => ({ ...prev, [id]: data }))
      }).catch(() => {})
    }
  }, [followedPlayerIds]) // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced player search
  useEffect(() => {
    if (addQuery.length < 2) { setAddResults([]); return }
    const t = setTimeout(async () => {
      setAddSearching(true)
      try { setAddResults((await searchPlayers(addQuery)).slice(0, 6)) }
      finally { setAddSearching(false) }
    }, 320)
    return () => clearTimeout(t)
  }, [addQuery])

  // Close search on outside click
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
      {/* Header */}
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
        {/* Inline add search */}
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

        {/* Player cards */}
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

// ─── Standing summary type ────────────────────────────────────────────────────

interface StandingSummary {
  wins:         number
  losses:       number
  divisionRank: number
  divisionName: string
  gamesBack:    string
  divisionLeader: boolean
}

// ─── HomeView props ───────────────────────────────────────────────────────────

export interface HomeViewProps {
  allTeams:          Team[]
  followedTeamId:    number | null
  onFollowTeam:      (teamId: number) => void
  onUnfollowTeam:    () => void
  followedPlayerIds: number[]
  onFollowPlayer:    (id: number) => void
  onUnfollowPlayer:  (id: number) => void
  onPlayerClick:     (id: number) => void
}

// ─── HomeView ─────────────────────────────────────────────────────────────────

export function HomeView({
  allTeams, followedTeamId, onFollowTeam, onUnfollowTeam,
  followedPlayerIds, onFollowPlayer, onUnfollowPlayer, onPlayerClick,
}: HomeViewProps) {
  const [standing, setStanding] = useState<StandingSummary | null>(null)

  useEffect(() => {
    if (!followedTeamId) return
    setStanding(null)
    fetchDivisionForTeam(followedTeamId, CURRENT_SEASON).then(div => {
      const t = div?.teams.find(t => t.teamId === followedTeamId)
      if (t && div) setStanding({
        wins: t.wins, losses: t.losses,
        divisionRank: t.divisionRank, divisionName: div.divisionName,
        gamesBack: t.gamesBack, divisionLeader: t.divisionLeader,
      })
    }).catch(() => {})
  }, [followedTeamId])

  if (!followedTeamId) {
    return <TeamPicker allTeams={allTeams} onSelect={onFollowTeam} />
  }

  const team    = allTeams.find(t => t.id === followedTeamId)
  const bg      = TEAM_BG[followedTeamId] ?? '#1a2035'
  const abbr    = team?.abbreviation ?? '—'
  const name    = team?.name ?? '—'
  const words   = name.split(' ')
  const nickname = words[words.length - 1]
  const city    = words.slice(0, -1).join(' ')

  const standingLine = standing ? [
    `${standing.wins}–${standing.losses}`,
    `${ordinal(standing.divisionRank)} ${standing.divisionName}`,
    !standing.divisionLeader && standing.gamesBack !== '-' ? `${standing.gamesBack} GB` : null,
  ].filter(Boolean).join(' · ') : null

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>

      {/* ── Team card ─────────────────────────────────────────────────────────── */}
      <Box sx={{
        borderRadius: { xs: 0, sm: 3 },
        mx: { xs: -2, sm: 0 },
        overflow: 'hidden',
        border: '1px solid',
        borderColor: `${bg}40`,
        borderLeft: { sm: `4px solid ${bg}` },
        bgcolor: 'background.paper',
        background: `linear-gradient(135deg, ${bg}1a 0%, ${bg}0a 45%, transparent 70%)`,
      }}>
        {/* Header row */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 2.5, pt: 2.5, pb: 2 }}>
          {/* Logo in a team-color circle */}
          <TeamLogoCircle teamId={followedTeamId} abbr={abbr} size={62} />

          {/* Name + standing */}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            {city && (
              <Typography sx={{
                fontSize: '0.6rem', fontWeight: 700, letterSpacing: '3px',
                textTransform: 'uppercase', color: 'text.secondary', lineHeight: 1, mb: 0.3,
              }}>
                {city}
              </Typography>
            )}
            <Typography sx={{
              fontSize: { xs: '1.5rem', sm: '1.9rem' },
              fontWeight: 900, textTransform: 'uppercase',
              letterSpacing: '-1px', lineHeight: 1,
              color: 'text.primary',
            }}>
              {nickname}
            </Typography>
            {standingLine && (
              <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary', mt: 0.5, lineHeight: 1 }}>
                {standingLine}
              </Typography>
            )}
          </Box>

          {/* Change team */}
          <Box
            onClick={onUnfollowTeam}
            sx={{
              alignSelf: 'flex-start',
              fontSize: '0.62rem', fontWeight: 700, color: 'text.disabled',
              cursor: 'pointer', px: 1.25, py: 0.5,
              borderRadius: 999, border: '1px solid', borderColor: 'divider',
              whiteSpace: 'nowrap', flexShrink: 0,
              transition: 'color 0.12s, border-color 0.12s',
              '&:hover': { color: 'text.primary', borderColor: 'text.secondary' },
            }}
          >
            Change
          </Box>
        </Box>

        {/* Schedule strip */}
        <Box sx={{ borderTop: '1px solid', borderColor: 'divider', pt: 1.5, pb: 0.5 }}>
          <Typography sx={{
            fontSize: '0.56rem', fontWeight: 800, textTransform: 'uppercase',
            letterSpacing: 2, color: 'text.disabled', textAlign: 'center', mb: 1.25,
          }}>
            Schedule
          </Typography>
          <TeamScheduleStrip teamId={followedTeamId} teamColor={bg} />
        </Box>
      </Box>

      {/* ── Followed players ──────────────────────────────────────────────────── */}
      <FollowedPlayersSection
        followedPlayerIds={followedPlayerIds}
        onUnfollow={onUnfollowPlayer}
        onPlayerClick={onPlayerClick}
        onFollow={onFollowPlayer}
      />

    </Box>
  )
}
