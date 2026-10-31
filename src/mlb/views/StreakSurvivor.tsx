import React, { useState, useEffect, useCallback } from 'react'
import { pressable } from '../../ui/interaction'
import { Box, Typography, CircularProgress } from '@mui/material'
import { SectionCard, TYPE_SCALE, ACCENT_EDGE } from '../../ui/card'
import { InfoDot } from '../../ui/InfoDot'
import { ACCENT, ACCENT_TEXT, CURRENT_SEASON, TEAM_ABBR, TEAM_NICKNAME, TONE } from '../constants'
import { useTextTone } from '../lib/colorUtils'
import { MlbSheet } from '../components/MlbSheet'
import { useAuth } from '../../AuthContext'
import { searchPlayers } from '../api'
import { Player } from '../types'
import { TeamLogo } from '../components/TeamLogo'
import { useDeepLink } from '../state/deepLink'
import {
  survivorToday, survivorNextDay, fetchMyPick, fetchMyStats, fetchHotHitters, fetchPickableTeams, saveMyPick,
  fetchSurvivorLeaderboard, fetchMyRecentPicks,
  SurvivorPick, SurvivorStats, HotHitter, SurvivorLeaderRow, SurvivorResult,
} from './survivorData'
import { chromePx, typePx } from '../../ui/scale'
import { useLastShape, useRememberShape } from '../../lib/lastShape'

const ZERO_STATS: SurvivorStats = { currentStreak: 0, longestStreak: 0, totalHits: 0, totalPicks: 0 }

// ─── Small pieces ─────────────────────────────────────────────────────────────

const RESULT_META: Record<SurvivorResult, { label: string; color: string }> = {
  hit:     { label: 'Hit',     color: '#22c55e' },
  miss:    { label: 'No hit',  color: '#ef4444' },
  void:    { label: 'No game', color: '#94a3b8' },
  pending: { label: 'Locked',  color: '#eab308' },
}

function ResultPill({ result }: { result: SurvivorResult }) {
  const tone = useTextTone()
  const m = RESULT_META[result]
  return (
    <Box sx={{
      px: 1, py: chromePx(2), borderRadius: 999, bgcolor: `${m.color}22`,
      fontSize: TYPE_SCALE.caption, fontWeight: 800, color: tone(m.color, undefined, 5.6),
      textTransform: 'uppercase', letterSpacing: typePx(0.5), whiteSpace: 'nowrap',
    }}>
      {m.label}
    </Box>
  )
}

function StreakBadge({ current, longest }: { current: number; longest: number }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
      <Box sx={{ textAlign: 'right' }}>
        <Typography sx={{ fontSize: TYPE_SCALE.title, fontWeight: 800, lineHeight: 1, color: current > 0 ? TONE.orange : 'text.primary' }}>
          {current}
        </Typography>
        <Typography sx={{ fontSize: TYPE_SCALE.caption, fontWeight: 700, textTransform: 'uppercase', letterSpacing: typePx(0.5), color: 'text.secondary', mt: chromePx(2) }}>
          Current
        </Typography>
      </Box>
      <Box sx={{ width: '1px', alignSelf: 'stretch', bgcolor: 'divider' }} />
      <Box sx={{ textAlign: 'right' }}>
        <Typography sx={{ fontSize: TYPE_SCALE.title, fontWeight: 800, lineHeight: 1, color: 'text.primary' }}>{longest}</Typography>
        <Typography sx={{ fontSize: TYPE_SCALE.caption, fontWeight: 700, textTransform: 'uppercase', letterSpacing: typePx(0.5), color: 'text.secondary', mt: chromePx(2) }}>
          Best
        </Typography>
      </Box>
    </Box>
  )
}

// One selectable hitter (a hot-streak suggestion or a search result).
function HitterRow({ name, teamId, subtitle, disabled, onPick }: {
  name: string; teamId: number; subtitle?: string; disabled?: boolean; onPick: () => void
}) {
  const abbr = TEAM_ABBR[teamId] ?? '—'
  return (
    <Box
      {...pressable(() => !disabled && onPick())}
      sx={{
        display: 'flex', alignItems: 'center', gap: 1, px: 1.25, py: chromePx(7), borderRadius: 2,
        border: '1px solid', borderColor: 'outline',
        cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1,
        '&:hover': { bgcolor: disabled ? undefined : 'action.hover', borderColor: disabled ? 'divider' : ACCENT_EDGE },
        transition: 'background 0.12s, border-color 0.12s',
      }}
    >
      <TeamLogo teamId={teamId} abbr={abbr} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: TYPE_SCALE.body, fontWeight: 700, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {name}
        </Typography>
        <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', lineHeight: 1.2 }}>
          {abbr}{subtitle ? ` · ${subtitle}` : ''}
        </Typography>
      </Box>
      <Typography sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 700, color: disabled ? 'text.disabled' : ACCENT_TEXT, whiteSpace: 'nowrap' }}>
        {disabled ? 'Started' : 'Pick'}
      </Typography>
    </Box>
  )
}

// ─── Leaderboard modal ──────────────────────────────────────────────────────

function LeaderRow({ entry }: { entry: SurvivorLeaderRow }) {
  return (
    <Box sx={{
      display: 'flex', alignItems: 'center', gap: 1.25, px: 1.5, py: chromePx(9),
      borderBottom: '1px solid', borderColor: 'divider',
      bgcolor: entry.isMe ? `${ACCENT}18` : undefined,
    }}>
      <Typography sx={{ minWidth: '1.625rem', textAlign: 'center', fontSize: TYPE_SCALE.body, fontWeight: 800, color: 'text.secondary' }}>
        {entry.rank}
      </Typography>
      <Typography sx={{ flex: 1, minWidth: 0, fontSize: TYPE_SCALE.body, fontWeight: entry.isMe ? 800 : 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {entry.displayName}{entry.isMe ? ' (you)' : ''}
      </Typography>
      {entry.currentStreak > 0 && (
        <Typography sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 700, color: TONE.orange, whiteSpace: 'nowrap' }}>
          {entry.currentStreak} now
        </Typography>
      )}
      <Typography sx={{ minWidth: '2.125rem', textAlign: 'right', fontSize: TYPE_SCALE.title, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
        {entry.longestStreak}
      </Typography>
    </Box>
  )
}

export function SurvivorLeaderboardModal({ userId, onClose }: { userId: string | null; onClose: () => void }) {
  const [rows, setRows] = useState<SurvivorLeaderRow[] | null>(null)

  useEffect(() => {
    fetchSurvivorLeaderboard(userId).then(setRows).catch(() => setRows([]))
  }, [userId])

  return (
    <MlbSheet onClose={onClose} maxWidth={chromePx(440)} sheet eyebrow="Streak Survivor leaderboard">
        <Box sx={{ px: 1.5, py: chromePx(6), flexShrink: 0, display: 'flex', alignItems: 'center', gap: 1.25, bgcolor: 'action.hover' }}>
          <Typography sx={{ minWidth: '1.625rem', textAlign: 'center', fontSize: TYPE_SCALE.caption, fontWeight: 700, textTransform: 'uppercase', letterSpacing: typePx(0.5), color: 'text.secondary' }}>#</Typography>
          <Typography sx={{ flex: 1, fontSize: TYPE_SCALE.caption, fontWeight: 700, textTransform: 'uppercase', letterSpacing: typePx(0.5), color: 'text.secondary' }}>Player</Typography>
          <Typography sx={{ minWidth: '2.125rem', textAlign: 'right', fontSize: TYPE_SCALE.caption, fontWeight: 700, textTransform: 'uppercase', letterSpacing: typePx(0.5), color: 'text.secondary' }}>Best</Typography>
        </Box>

        {rows === null ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress size={28} sx={{ color: ACCENT_TEXT }} /></Box>
        ) : rows.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 6, px: 2 }}>
            <Typography sx={{ color: 'text.secondary', fontSize: TYPE_SCALE.body }}>
              No streaks yet. Make the first pick and you're on the board tomorrow.
            </Typography>
          </Box>
        ) : (
          rows.map(r => <LeaderRow key={r.userId} entry={r} />)
        )}
    </MlbSheet>
  )
}

// ─── Widget ─────────────────────────────────────────────────────────────────

// The search box and the no-suggestions line, shared with the loading state's ghost of them.
const SEARCH_SX = {
  width: '100%', px: 1.25, py: chromePx(8), borderRadius: 2, fontSize: TYPE_SCALE.body,
  border: '1px solid', borderColor: 'outline', bgcolor: 'background.default',
} as const
const EMPTY_SX = { fontSize: TYPE_SCALE.meta, color: 'text.disabled', textAlign: 'center', py: 1.5 } as const

/** What a signed-in reader's card held last time, for the loading state to ghost. */
interface SurvivorShape { pick: boolean; change: boolean; hitters: number; recent: boolean }

/** Only measured, never read: the pick a loading card ghosts. */
const GHOST_PICK: SurvivorPick = { gameDate: '', playerId: 0, playerName: 'Bobby Witt Jr.', teamId: 118, result: 'pending' }

export function StreakSurvivorWidget() {
  const { user, loading: authLoading, openAuthDialog } = useAuth()
  const today = survivorToday()
  // The season shown, not the calendar year: from January to Opening Day that year has no streaks yet.
  const season = CURRENT_SEASON

  // The day being picked. Normally today, but once today has no team left to pick
  // (every game started or final), it rolls to tomorrow so a pick can be made
  // ahead. Resolved by the slate effect below, so it starts at today.
  const [slateDate, setSlateDate]   = useState(today)
  const isTomorrow = slateDate !== today

  const [myPick, setMyPick]         = useState<SurvivorPick | null>(null)
  const [stats, setStats]           = useState<SurvivorStats>(ZERO_STATS)
  const [pickable, setPickable]     = useState<Set<number>>(new Set())
  const [hotHitters, setHotHitters] = useState<HotHitter[] | null>(null)
  const [recent, setRecent]         = useState<SurvivorPick[]>([])
  // Which reader and slate the pick and form were last read for.
  const [userFor, setUserFor]       = useState<string | null>(null)
  const [loading, setLoading]       = useState(true)
  const [saving, setSaving]         = useState(false)
  const [changing, setChanging]     = useState(false)   // expanded picker even though a pick exists
  const [query, setQuery]           = useState('')
  const [results, setResults]       = useState<Player[]>([])
  const [lbOpen, setLbOpen]         = useState(false)
  // The More sheet's Streak Survivor row.
  useDeepLink('survivor', () => setLbOpen(true))

  // Resolve the slate: today if any team hasn't played yet, otherwise tomorrow.
  // No auth needed, so it runs for signed-out visitors too (teaser).
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    ;(async () => {
      const todayTeams = await fetchPickableTeams(today)
      if (todayTeams.size > 0) {
        if (!cancelled) { setSlateDate(today); setPickable(todayTeams) }
      } else {
        const tmr = survivorNextDay(today)
        const tmrTeams = await fetchPickableTeams(tmr)
        if (!cancelled) { setSlateDate(tmr); setPickable(tmrTeams) }
      }
    })().finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [today])

  // Hot-hitter suggestions are season-based, independent of the slate day.
  useEffect(() => {
    let cancelled = false
    fetchHotHitters(season).then(hh => { if (!cancelled) setHotHitters(hh) }, () => { if (!cancelled) setHotHitters([]) })
    return () => { cancelled = true }
  }, [season])

  // Per-user state, keyed to the slate day so a rolled-forward pick loads correctly.
  useEffect(() => {
    let cancelled = false
    if (!user) { setMyPick(null); setStats(ZERO_STATS); setRecent([]); setUserFor(null); return }
    const key = `${user.id}:${slateDate}`
    fetchMyStats(user.id).then(s => { if (!cancelled) setStats(s) })
    Promise.allSettled([
      fetchMyPick(user.id, slateDate).then(p => { if (!cancelled) setMyPick(p) }),
      fetchMyRecentPicks(user.id, 6).then(r => { if (!cancelled) setRecent(r) }),
    ]).then(() => { if (!cancelled) setUserFor(key) })
    return () => { cancelled = true }
  }, [user?.id, slateDate]) // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced hitter search (hitters with a current team only).
  useEffect(() => {
    const q = query.trim()
    if (q.length < 3) { setResults([]); return }
    let cancelled = false
    const t = setTimeout(() => {
      searchPlayers(q).then(ps => {
        if (cancelled) return
        setResults(ps.filter(p =>
          p.currentTeam && p.primaryPosition?.code !== '1' && p.primaryPosition?.type !== 'Pitcher'
        ).slice(0, 6))
      }).catch(() => { if (!cancelled) setResults([]) })
    }, 300)
    return () => { cancelled = true; clearTimeout(t) }
  }, [query])

  const pick = useCallback(async (p: { playerId: number; playerName: string; teamId: number }) => {
    if (!user) { openAuthDialog('signin'); return }
    if (!pickable.has(p.teamId)) return
    setSaving(true)
    const err = await saveMyPick(user.id, slateDate, p)
    setSaving(false)
    if (!err) {
      setMyPick({ gameDate: slateDate, ...p, result: 'pending' })
      setChanging(false); setQuery(''); setResults([])
    }
  }, [user, pickable, slateDate, openAuthDialog])

  const pickLocked = myPick != null && !pickable.has(myPick.teamId)
  // Graded picks only (hit/miss/void), oldest-left, capped for the form dots.
  const recentForm = recent.filter(r => r.result !== 'pending').slice(0, 6).reverse()

  // A signed-out reader's card needs nothing read: it is the pitch, from the first frame. A
  // signed-in one waits for the slate, their pick and form, and the suggestions, and until then
  // ghosts what it held last time. It drew a spinner the size of none of them, then grew by
  // whatever arrived (a pick, eight suggested hitters, a form row), each a jump of its own.
  const userReady = !!user && !loading && userFor === `${user.id}:${slateDate}` && hotHitters !== null
  const showsPick = !!myPick && !changing
  const lastShape = useLastShape<SurvivorShape | null>('mlb.survivor', null)
  useRememberShape('mlb.survivor', userReady ? {
    pick: showsPick, change: showsPick && !pickLocked && myPick!.result === 'pending',
    hitters: (hotHitters ?? []).length, recent: recentForm.length > 0,
  } satisfies SurvivorShape : undefined)
  const ghost = user && !userReady ? lastShape : null

  // ── Card shell ──
  const Shell = (children: React.ReactNode) => (
    <SectionCard
      title="Streak Survivor"
      titleAdornment={<>
        <InfoDot label="Rules" text="One hitter a day. A hit extends the streak; an 0-fer resets it." />
        {isTomorrow && (
          <Typography sx={{ fontSize: TYPE_SCALE.caption, fontWeight: 800, textTransform: 'uppercase', letterSpacing: typePx(0.5), color: 'text.secondary', border: '1px solid', borderColor: 'outline', borderRadius: 999, px: 0.75, py: '1px', whiteSpace: 'nowrap' }}>
            Tomorrow
          </Typography>
        )}
      </>}
      action={user ? <StreakBadge current={stats.currentStreak} longest={stats.longestStreak} /> : undefined}
    >
      {/* The body runs to the card's edges, as it did under the old header: the pick, the form row
          and the footer each carry their own padding and rules. */}
      <Box sx={{ mx: -2, mb: -1.5 }}>
      {children}
      {/* Recent form: last few graded picks, oldest-left */}
      {user && (ghost ? ghost.recent : userReady && recentForm.length > 0) && (
        <Box aria-hidden={ghost ? true : undefined} sx={{
          px: 2, py: chromePx(8), borderTop: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1,
          ...(ghost ? { '& > *': { visibility: 'hidden' } } : null),
        }}>
          <Typography sx={{ fontSize: TYPE_SCALE.caption, fontWeight: 700, textTransform: 'uppercase', letterSpacing: typePx(0.5), color: 'text.secondary' }}>Recent</Typography>
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            {(ghost ? [] : recentForm).map((r, i) => (
              <Box key={i} title={`${r.gameDate}: ${RESULT_META[r.result].label} (${r.playerName})`} sx={{
                width: chromePx(9), height: chromePx(9), borderRadius: '50%', bgcolor: RESULT_META[r.result].color,
              }} />
            ))}
          </Box>
        </Box>
      )}
      {/* Footer */}
      <Box
        {...pressable(() => setLbOpen(true))}
        sx={{ px: 2, py: chromePx(9), borderTop: '1px solid', borderColor: 'divider', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.75, '&:hover': { bgcolor: 'action.hover' } }}
      >
        <Typography sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 700, color: ACCENT_TEXT }}>View leaderboard</Typography>
      </Box>
      </Box>
    </SectionCard>
  )

  const suggestions = (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
      {/* Search */}
      <Box
        component="input"
        value={query}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
        placeholder="Search any hitter…"
        sx={{
          ...SEARCH_SX, color: 'text.primary', outline: 'none', '&:focus': { borderColor: ACCENT_EDGE },
          '&::placeholder': { color: 'text.disabled' },
        }}
      />
      {(results.length ? results.map(p => ({
        playerId: p.id, playerName: p.fullName, teamId: p.currentTeam!.id,
        subtitle: p.primaryPosition?.abbreviation, disabled: !pickable.has(p.currentTeam!.id),
      })) : (hotHitters ?? []).map(h => ({
        playerId: h.playerId, playerName: h.playerName, teamId: h.teamId,
        subtitle: `${h.streak}-game hit streak`, disabled: !pickable.has(h.teamId),
      }))).map(opt => (
        <HitterRow
          key={opt.playerId}
          name={opt.playerName}
          teamId={opt.teamId}
          subtitle={opt.subtitle}
          disabled={opt.disabled || saving}
          onPick={() => pick({ playerId: opt.playerId, playerName: opt.playerName, teamId: opt.teamId })}
        />
      ))}
      {!results.length && !(hotHitters ?? []).length && (
        <Typography sx={EMPTY_SX}>
          No hitters
        </Typography>
      )}
    </Box>
  )

  // ── Body states ──
  let body: React.ReactNode

  if (authLoading || (user && !userReady && !ghost)) {
    body = <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress size={26} sx={{ color: ACCENT_TEXT }} /></Box>
  } else if (ghost) {
    body = (
      <Box aria-hidden sx={{ visibility: 'hidden' }}>
        {ghost.pick ? pickBody(GHOST_PICK, !ghost.change) : chooseBody(
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
            <Box sx={SEARCH_SX}>&nbsp;</Box>
            {ghost.hitters > 0
              ? Array.from({ length: ghost.hitters }, (_, i) => (
                  <HitterRow key={i} name={GHOST_PICK.playerName} teamId={GHOST_PICK.teamId} subtitle="10-game hit streak" onPick={() => {}} />
                ))
              : <Typography sx={EMPTY_SX}>No hitters</Typography>}
          </Box>,
        )}
      </Box>
    )
  } else if (!user) {
    body = (
      <Box sx={{ px: 2, pt: 0.5, pb: 1.75 }}>
        <Box
          {...pressable(() => openAuthDialog('signin'))}
          sx={{ px: 1.5, py: chromePx(9), borderRadius: 2, bgcolor: 'var(--wpbl-accent-solid)', color: '#fff', textAlign: 'center', cursor: 'pointer', fontWeight: 800, fontSize: TYPE_SCALE.body, '&:hover': { opacity: 0.9 } }}
        >
          Sign in to play
        </Box>
      </Box>
    )
  } else if (myPick && !changing) {
    body = pickBody(myPick, pickLocked)
  } else {
    body = chooseBody(suggestions)
  }

  function pickBody(myPick: SurvivorPick, pickLocked: boolean) {
    return (
      <Box sx={{ px: 2, pt: 0.5, pb: 1.5 }}>
        <Typography sx={{ fontSize: TYPE_SCALE.caption, fontWeight: 700, textTransform: 'uppercase', letterSpacing: typePx(0.5), color: 'text.secondary', mb: 0.75 }}>
          {isTomorrow ? "Tomorrow's pick" : "Today's pick"}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <TeamLogo teamId={myPick.teamId} abbr={TEAM_ABBR[myPick.teamId] ?? '—'} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontSize: TYPE_SCALE.title, fontWeight: 800, lineHeight: 1.2 }}>{myPick.playerName}</Typography>
            <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary' }}>
              {TEAM_NICKNAME[myPick.teamId] ?? TEAM_ABBR[myPick.teamId]}
            </Typography>
          </Box>
          <ResultPill result={myPick.result} />
        </Box>
        <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', mt: 1.25 }}>
          {pickLocked
            ? 'Their game has started, so your pick is locked in. Good luck.'
            : "You can change your pick until their game starts."}
        </Typography>
        {!pickLocked && myPick.result === 'pending' && (
          <Box
            {...pressable(() => setChanging(true))}
            sx={{ mt: 1, px: 1.25, py: chromePx(7), borderRadius: 2, border: '1px solid', borderColor: 'outline', textAlign: 'center', cursor: 'pointer', fontSize: TYPE_SCALE.meta, fontWeight: 700, color: 'text.secondary', '&:hover': { borderColor: ACCENT_EDGE, color: ACCENT_TEXT } }}
          >
            Change pick
          </Box>
        )}
      </Box>
    )
  }

  function chooseBody(suggestions: React.ReactNode) {
    return (
      <Box sx={{ px: 2, pt: 0.5, pb: 1.5 }}>
        <Typography sx={{ fontSize: TYPE_SCALE.caption, fontWeight: 700, textTransform: 'uppercase', letterSpacing: typePx(0.5), color: 'text.secondary', mb: 0.75 }}>
          {changing ? 'Change your pick' : isTomorrow ? "Pick tomorrow's hitter" : "Pick today's hitter"}
        </Typography>
        {suggestions}
        {changing && (
          <Box {...pressable(() => { setChanging(false); setQuery(''); setResults([]) })} sx={{ mt: 1, textAlign: 'center', cursor: 'pointer', fontSize: TYPE_SCALE.meta, color: 'text.disabled', '&:hover': { color: 'text.secondary' } }}>
            Cancel
          </Box>
        )}
      </Box>
    )
  }

  return (
    <>
      {Shell(body)}
      {lbOpen && <SurvivorLeaderboardModal userId={user?.id ?? null} onClose={() => setLbOpen(false)} />}
    </>
  )
}
