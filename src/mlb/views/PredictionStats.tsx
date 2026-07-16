import React, { useState, useEffect } from 'react'
import { Box, Typography } from '@mui/material'
import { TEAM_ABBR, ACCENT } from '../constants'
import { useIsDark, ringColor, teamLogoBg, teamLogoSrc, teamLogoCrop } from '../colorUtils'
import { supabase } from '../../lib/supabase'

// ─── Supabase table setup (run once in Supabase SQL editor) ──────────────────
//
// create table if not exists prediction_stats (
//   user_id              uuid primary key references auth.users(id) on delete cascade,
//   display_name         text not null default 'Anonymous',
//   correct_predictions  int  not null default 0,
//   total_predictions    int  not null default 0,   -- finalized predictions only
//   accuracy_pct         float not null default 0,
//   updated_at           timestamptz not null default now()
// );
// alter table prediction_stats enable row level security;
// create policy "public read"  on prediction_stats for select using (true);
// create policy "own write"    on prediction_stats for all    using (auth.uid() = user_id);

// ─── Types ────────────────────────────────────────────────────────────────────

interface PersonalStats {
  totalPredicted:     number
  finalizedCount:     number
  correctPredictions: number
  accuracyPct:        number | null
  currentStreak:      number
  bestStreak:         number
  favoriteWins:   { teamId: number; teamAbbr: string; count: number }[]
  favoriteLosses: { teamId: number; teamAbbr: string; count: number }[]
  bestPickRate:   { teamId: number; teamAbbr: string; correct: number; total: number; pct: number }[]
}

interface LeaderEntry {
  userId:      string
  displayName: string
  rank:        number
  accuracy:    number
  correct:     number
  total:       number
  isMe:        boolean
}

// ─── Data fetching ────────────────────────────────────────────────────────────

async function fetchPersonalStats(userId: string): Promise<PersonalStats | null> {
  const { data: rows } = await supabase
    .from('game_predictions')
    .select('game_date, game_pk, predicted_team_id')
    .eq('user_id', userId)

  if (!rows || rows.length === 0) return null

  // Get date range for a single batched MLB schedule call
  const dates   = rows.map((r: any) => r.game_date as string).sort()
  const minDate = dates[0]
  const maxDate = dates[dates.length - 1]

  // Fetch all game results in range (one call)
  const gameMap: Record<number, { homeId: number; awayId: number; winnerId: number | null }> = {}
  try {
    const res = await fetch(
      `https://statsapi.mlb.com/api/v1/schedule?sportId=1` +
      `&startDate=${minDate}&endDate=${maxDate}&gameType=R` +
      `&fields=dates,date,games,gamePk,status,abstractGameState,teams,home,away,team,id,isWinner`
    ).then(r => r.json())

    for (const dateObj of res.dates ?? []) {
      for (const g of dateObj.games ?? []) {
        if (g.status?.abstractGameState !== 'Final') continue
        const homeId   = Number(g.teams?.home?.team?.id ?? 0)
        const awayId   = Number(g.teams?.away?.team?.id ?? 0)
        const winnerId = g.teams?.home?.isWinner ? homeId
          : g.teams?.away?.isWinner ? awayId : null
        gameMap[g.gamePk] = { homeId, awayId, winnerId }
      }
    }
  } catch { /* best effort */ }

  // Sort chronologically for streak calculation
  const sorted = [...rows].sort((a: any, b: any) =>
    a.game_date !== b.game_date
      ? a.game_date.localeCompare(b.game_date)
      : a.game_pk - b.game_pk
  )

  const winPicks:  Record<number, number> = {}
  const lossPicks: Record<number, number> = {}
  const teamStats: Record<number, { correct: number; total: number }> = {}
  let totalPredicted     = 0
  let finalizedCount     = 0
  let correctPredictions = 0
  const finalizedResults: boolean[] = []

  for (const row of sorted) {
    const game     = gameMap[row.game_pk]
    const pickedId = Number(row.predicted_team_id)
    totalPredicted++

    winPicks[pickedId] = (winPicks[pickedId] ?? 0) + 1

    if (game) {
      const opponentId = game.homeId === pickedId ? game.awayId : game.homeId
      if (opponentId) lossPicks[opponentId] = (lossPicks[opponentId] ?? 0) + 1

      if (game.winnerId !== null) {
        finalizedCount++
        const isCorrect = game.winnerId === pickedId
        if (isCorrect) correctPredictions++
        finalizedResults.push(isCorrect)

        if (!teamStats[pickedId]) teamStats[pickedId] = { correct: 0, total: 0 }
        teamStats[pickedId].total++
        if (isCorrect) teamStats[pickedId].correct++
      }
    }
  }

  const accuracyPct = finalizedCount > 0
    ? Math.round(correctPredictions / finalizedCount * 100)
    : null

  // Current streak — count consecutive correct from the most recent result
  let currentStreak = 0
  for (let i = finalizedResults.length - 1; i >= 0; i--) {
    if (finalizedResults[i]) currentStreak++
    else break
  }

  // Best streak ever
  let bestStreak = 0, streak = 0
  for (const r of finalizedResults) {
    streak = r ? streak + 1 : 0
    if (streak > bestStreak) bestStreak = streak
  }

  const favoriteWins = Object.entries(winPicks)
    .map(([id, count]) => ({ teamId: Number(id), teamAbbr: TEAM_ABBR[Number(id)] ?? '?', count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)

  const favoriteLosses = Object.entries(lossPicks)
    .map(([id, count]) => ({ teamId: Number(id), teamAbbr: TEAM_ABBR[Number(id)] ?? '?', count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)

  // Min 3 picks for statistical significance
  const bestPickRate = Object.entries(teamStats)
    .filter(([, s]) => s.total >= 3)
    .map(([id, s]) => ({
      teamId: Number(id), teamAbbr: TEAM_ABBR[Number(id)] ?? '?',
      ...s, pct: Math.round(s.correct / s.total * 100),
    }))
    .sort((a, b) => b.pct - a.pct || b.total - a.total)
    .slice(0, 3)

  return {
    totalPredicted, finalizedCount, correctPredictions, accuracyPct,
    currentStreak, bestStreak, favoriteWins, favoriteLosses, bestPickRate,
  }
}

async function upsertMyPredStats(userId: string, displayName: string, stats: PersonalStats) {
  try {
    if (stats.finalizedCount === 0) return
    await supabase.from('prediction_stats').upsert({
      user_id:             userId,
      display_name:        displayName,
      correct_predictions: stats.correctPredictions,
      total_predictions:   stats.finalizedCount,
      accuracy_pct:        stats.accuracyPct ?? 0,
      updated_at:          new Date().toISOString(),
    }, { onConflict: 'user_id' })
  } catch { /* non-fatal — table may not exist yet */ }
}

// Wilson score lower bound (95% confidence) for a correct/total ratio.
// Used as the leaderboard ranking key so small samples don't leapfrog proven
// predictors: a 3/3 (100%) scores ~0.44 while a 100/101 (99%) scores ~0.95.
// The penalty eases automatically as a user racks up more predictions.
function wilsonLowerBound(correct: number, total: number): number {
  if (total === 0) return 0
  const z  = 1.96
  const z2 = z * z
  const p  = correct / total
  return (p + z2 / (2 * total) - z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total)) / (1 + z2 / total)
}

async function fetchLeaderboard(myUserId: string): Promise<LeaderEntry[]> {
  try {
    const { data } = await supabase
      .from('prediction_stats')
      .select('user_id, display_name, correct_predictions, total_predictions, accuracy_pct')
      .limit(500)

    // Resolve names at read time from the `usernames` table so the board always
    // reflects each user's *current* username — the cached `display_name` on the
    // stats row is only rewritten when that user reopens My Stats, so it goes
    // stale (e.g. shows the email prefix a user had before setting a username).
    // Users without a username row (notably the prediction bots) fall back to the
    // stored display_name.
    const userIds = (data ?? []).map((r: any) => r.user_id)
    const nameByUser: Record<string, string> = {}
    if (userIds.length > 0) {
      const { data: unames } = await supabase
        .from('usernames')
        .select('user_id, username')
        .in('user_id', userIds)
      for (const u of unames ?? []) {
        if (u.username) nameByUser[u.user_id] = u.username
      }
    }

    // Rank by confidence-adjusted accuracy (Wilson lower bound), tie-breaking by
    // volume. Everyone stays on the board; the raw accuracy % below is unchanged
    // — only the ordering accounts for sample size.
    const ranked: LeaderEntry[] = (data ?? [])
      .map((row: any) => ({
        userId:      row.user_id,
        displayName: nameByUser[row.user_id] ?? row.display_name ?? 'Anonymous',
        accuracy:    row.accuracy_pct        ?? 0,
        correct:     row.correct_predictions ?? 0,
        total:       row.total_predictions   ?? 0,
        score:       wilsonLowerBound(row.correct_predictions ?? 0, row.total_predictions ?? 0),
      }))
      .sort((a, b) => b.score - a.score || b.total - a.total)
      .map((r, i) => ({
        userId: r.userId, displayName: r.displayName, rank: i + 1,
        accuracy: r.accuracy, correct: r.correct, total: r.total,
        isMe: r.userId === myUserId,
      }))

    // Show the top 25, but always append the current user's own row (with their
    // true global rank) if they fall outside it — so they see their score instantly.
    const top = ranked.slice(0, 25)
    if (!top.some(e => e.isMe)) {
      const me = ranked.find(e => e.isMe)
      if (me) top.push(me)
    }
    return top
  } catch { return [] }
}

// ─── StatPill ─────────────────────────────────────────────────────────────────

function StatPill({ label, value, accent }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <Box sx={{
      flex: 1, textAlign: 'center',
      px: 1, py: 1.25, borderRadius: 2,
      border: '1px solid',
      borderColor: accent ? `${ACCENT}40` : 'divider',
      bgcolor:     accent ? `${ACCENT}08` : 'action.hover',
    }}>
      <Typography sx={{
        fontSize: { xs: '1.35rem', sm: '1.65rem' }, fontWeight: 800, lineHeight: 1,
        color: accent ? ACCENT : 'text.primary',
      }}>
        {value}
      </Typography>
      <Typography sx={{
        fontSize: { xs: '0.58rem', sm: '0.66rem' }, color: 'text.secondary',
        lineHeight: 1, mt: 0.5, textTransform: 'uppercase', letterSpacing: 0.5,
      }}>
        {label}
      </Typography>
    </Box>
  )
}

// ─── TeamPodium ───────────────────────────────────────────────────────────────
// Shows up to 3 teams as large logo cards in a row.

const RANK_COLORS = ['#f59e0b', '#94a3b8', '#cd7c2e']  // gold / silver / bronze

function TeamLogoCard({ teamId, teamAbbr, rank, mainLabel, subLabel }: {
  teamId:    number
  teamAbbr:  string
  rank:      number   // 0-based
  mainLabel: string
  subLabel?: string
}) {
  const [failed, setFailed] = useState(false)
  const isDark   = useIsDark()
  const col      = ringColor(teamId, isDark)
  const rankCol  = RANK_COLORS[rank] ?? '#94a3b8'
  const logoSize = rank === 0 ? 68 : 56

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.6 }}>
      {/* Logo with rank badge */}
      <Box sx={{ position: 'relative', mb: 0.25 }}>
        <Box sx={{
          width: logoSize, height: logoSize, borderRadius: '50%',
          bgcolor: teamLogoBg(teamId, isDark),
          border: `2.5px solid ${col}`,
          boxShadow: rank === 0 ? `0 0 0 2px ${rankCol}55, 0 4px 16px ${col}30` : `0 2px 8px ${col}20`,
          overflow: 'hidden', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'box-shadow 0.2s',
        }}>
          {failed ? (
            <Typography sx={{ color: col, fontWeight: 900, fontSize: logoSize * 0.28, lineHeight: 1 }}>
              {teamAbbr}
            </Typography>
          ) : (
            <Box
              component="img"
              src={teamLogoSrc(teamId, isDark)}
              alt={teamAbbr}
              onError={() => setFailed(true)}
              sx={{ width: '78%', height: '78%', objectFit: 'contain', display: 'block', transform: teamLogoCrop(teamId, isDark), transformOrigin: 'center' }}
            />
          )}
        </Box>

        {/* Rank badge */}
        <Box sx={{
          position: 'absolute', top: -3, right: -3,
          width: 20, height: 20, borderRadius: '50%',
          bgcolor: rankCol,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
          border: '1.5px solid', borderColor: 'background.paper',
        }}>
          <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, color: '#fff', lineHeight: 1 }}>
            {rank + 1}
          </Typography>
        </Box>
      </Box>

      {/* Team abbr */}
      <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, color: 'text.secondary', lineHeight: 1 }}>
        {teamAbbr}
      </Typography>

      {/* Main stat */}
      <Typography sx={{ fontSize: rank === 0 ? '1.05rem' : '0.92rem', fontWeight: 800, color: col, lineHeight: 1 }}>
        {mainLabel}
      </Typography>

      {/* Sub label (e.g. "8/10") */}
      {subLabel && (
        <Typography sx={{ fontSize: '0.62rem', color: 'text.disabled', lineHeight: 1 }}>
          {subLabel}
        </Typography>
      )}
    </Box>
  )
}

function TeamPodium({ title, teams, getMain, getSub }: {
  title:   string
  teams:   Array<{ teamId: number; teamAbbr: string; [key: string]: any }>
  getMain: (t: any) => string
  getSub?: (t: any) => string
}) {
  const top3 = teams.slice(0, 3)
  if (top3.length === 0) return null

  return (
    <Box>
      <Typography sx={{
        fontWeight: 800, fontSize: '0.62rem',
        textTransform: 'uppercase', letterSpacing: 1.2,
        color: ACCENT, mb: 1.25,
      }}>
        {title}
      </Typography>
      <Box sx={{ display: 'flex', gap: 1 }}>
        {top3.map((t, i) => (
          <TeamLogoCard
            key={t.teamId}
            teamId={t.teamId}
            teamAbbr={t.teamAbbr}
            rank={i}
            mainLabel={getMain(t)}
            subLabel={getSub?.(t)}
          />
        ))}
      </Box>
    </Box>
  )
}

// ─── MyStatsContent ───────────────────────────────────────────────────────────

function MyStatsContent({ stats }: { stats: PersonalStats }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>

      {/* Summary pills */}
      <Box sx={{ display: 'flex', gap: 1 }}>
        <StatPill
          label="Accuracy"
          value={stats.accuracyPct !== null ? `${stats.accuracyPct}%` : '—'}
          accent
        />
        <StatPill
          label="Correct"
          value={`${stats.correctPredictions}/${stats.finalizedCount}`}
        />
        <StatPill
          label="🔥 Streak"
          value={stats.currentStreak}
        />
      </Box>

      {/* Most picked to win */}
      <TeamPodium
        title="Most Picked to Win"
        teams={stats.favoriteWins}
        getMain={t => `${t.count}×`}
      />

      {/* Most picked to lose */}
      <TeamPodium
        title="Most Picked to Lose"
        teams={stats.favoriteLosses}
        getMain={t => `${t.count}×`}
      />

      {/* Best pick rate (min 3 picks) */}
      <TeamPodium
        title="Best Pick Rate"
        teams={stats.bestPickRate}
        getMain={t => `${t.pct}%`}
        getSub={t => `${t.correct}/${t.total}`}
      />

    </Box>
  )
}

// ─── LeaderboardContent ───────────────────────────────────────────────────────

const MEDALS = ['🥇', '🥈', '🥉']

function LeaderboardContent({ leaders }: { leaders: LeaderEntry[] }) {
  return (
    <Box>
      {/* Column headers */}
      <Box sx={{
        display: 'flex', gap: 1, pb: 0.75,
        borderBottom: '1px solid', borderColor: 'divider', mb: 0.5,
      }}>
        <Typography sx={{ fontSize: '0.58rem', color: 'text.disabled', textTransform: 'uppercase', letterSpacing: 0.5, width: 28, textAlign: 'center', flexShrink: 0 }}>#</Typography>
        <Typography sx={{ fontSize: '0.58rem', color: 'text.disabled', textTransform: 'uppercase', letterSpacing: 0.5, flex: 1 }}>User</Typography>
        <Typography sx={{ fontSize: '0.58rem', color: 'text.disabled', textTransform: 'uppercase', letterSpacing: 0.5, minWidth: 52, textAlign: 'right' }}>W/L</Typography>
        <Typography sx={{ fontSize: '0.58rem', color: 'text.disabled', textTransform: 'uppercase', letterSpacing: 0.5, minWidth: 40, textAlign: 'right' }}>Acc.</Typography>
      </Box>

      {leaders.map((entry, i) => {
        const prev = leaders[i - 1]
        const gap  = prev && entry.rank > prev.rank + 1  // pinned "you" row below the top
        return (
        <React.Fragment key={entry.userId}>
        {gap && (
          <Typography sx={{ textAlign: 'center', color: 'text.disabled', fontSize: '0.85rem', lineHeight: 1, py: 0.4 }}>
            ···
          </Typography>
        )}
        <Box
          sx={{
            display: 'flex', alignItems: 'center', gap: 1,
            py: 0.8, px: entry.isMe ? 0.75 : 0, borderRadius: 1.5,
            border: '1px solid',
            borderColor: entry.isMe ? `${ACCENT}35` : 'transparent',
            bgcolor:     entry.isMe ? `${ACCENT}0d` : 'transparent',
            mb: 0.25,
          }}
        >
          <Typography sx={{
            fontSize: entry.rank <= 3 ? '0.88rem' : '0.7rem',
            fontWeight: 800, width: 28, textAlign: 'center', flexShrink: 0,
            color: entry.rank <= 3 ? 'text.primary' : 'text.disabled',
            lineHeight: 1,
          }}>
            {entry.rank <= 3 ? MEDALS[entry.rank - 1] : entry.rank}
          </Typography>
          <Typography sx={{
            fontSize: '0.78rem', fontWeight: entry.isMe ? 800 : 500, flex: 1,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            color: entry.isMe ? ACCENT : 'text.primary',
          }}>
            {entry.displayName}{entry.isMe ? ' (you)' : ''}
          </Typography>
          <Typography sx={{ fontSize: '0.7rem', color: 'text.secondary', minWidth: 52, textAlign: 'right' }}>
            {entry.correct}/{entry.total}
          </Typography>
          <Typography sx={{
            fontSize: '0.78rem', fontWeight: 700, minWidth: 40, textAlign: 'right',
            color: entry.isMe ? ACCENT : 'text.primary',
          }}>
            {Math.round(entry.accuracy)}%
          </Typography>
        </Box>
        </React.Fragment>
        )
      })}

      {leaders.length > 0 && (
        <Typography sx={{ fontSize: '0.62rem', color: 'text.disabled', textAlign: 'center', mt: 1.5 }}>
          Ranked by accuracy &amp; volume · Stats update when you view My Stats
        </Typography>
      )}
    </Box>
  )
}

// ─── PredictionStatsModal ─────────────────────────────────────────────────────

export function PredictionStatsModal({ open, userId, displayName, onClose }: {
  open:        boolean
  userId:      string | undefined
  displayName: string
  onClose:     () => void
}) {
  const [tab,       setTab]       = useState<'my' | 'board'>('my')
  const [stats,     setStats]     = useState<PersonalStats | null>(null)
  const [leaders,   setLeaders]   = useState<LeaderEntry[]>([])
  const [loading,   setLoading]   = useState(false)
  const [lbLoading, setLbLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [open, onClose])

  // Load personal stats when the modal opens
  useEffect(() => {
    if (!open || !userId) return
    setLoading(true)
    setStats(null)
    fetchPersonalStats(userId)
      .then(async s => {
        setStats(s)
        if (s) await upsertMyPredStats(userId, displayName, s)
      })
      .finally(() => setLoading(false))
  }, [open, userId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load leaderboard when switching to that tab
  useEffect(() => {
    if (!open || tab !== 'board' || !userId) return
    setLbLoading(true)
    fetchLeaderboard(userId)
      .then(setLeaders)
      .finally(() => setLbLoading(false))
  }, [open, tab, userId])

  if (!open) return null

  return (
    <Box
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      sx={{
        position: 'fixed', inset: 0, zIndex: 1400,
        bgcolor: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        p: { xs: 1, sm: 2 },
      }}
    >
      <Box sx={{
        bgcolor: 'background.paper', borderRadius: 3,
        border: '1px solid', borderColor: 'divider',
        width: '100%', maxWidth: 460,
        // `100%` of the padded fixed overlay (not `vh`) so the card stays on-screen
        // under the desktop `zoom` wrapper, which doesn't shrink viewport units.
        maxHeight: '100%',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 24px 64px rgba(0,0,0,0.55)',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <Box sx={{ px: 2.5, pt: 2, pb: 1.5, borderBottom: '1px solid', borderColor: 'divider', flexShrink: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography sx={{ fontWeight: 800, fontSize: '1.05rem', lineHeight: 1.2, flex: 1 }}>
              📊 Prediction Stats
            </Typography>
            <Box
              onClick={onClose}
              sx={{
                flexShrink: 0, width: 28, height: 28, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', color: 'text.disabled',
                '&:hover': { bgcolor: 'action.hover', color: 'text.primary' },
              }}
            >
              <Typography sx={{ fontSize: '0.8rem', lineHeight: 1 }}>✕</Typography>
            </Box>
          </Box>

          {/* Sub-tabs */}
          <Box sx={{ display: 'flex', gap: 0.75, mt: 1.25 }}>
            {(['my', 'board'] as const).map(t => (
              <Box
                key={t}
                onClick={() => setTab(t)}
                sx={{
                  px: 1.5, py: 0.6, borderRadius: 999, cursor: 'pointer',
                  fontSize: '0.72rem', fontWeight: 700,
                  bgcolor: tab === t ? ACCENT     : 'transparent',
                  color:   tab === t ? '#fff'     : 'text.secondary',
                  border: '1px solid',
                  borderColor: tab === t ? ACCENT : 'divider',
                  transition: 'all 0.15s',
                  '&:hover': tab === t ? {} : { borderColor: `${ACCENT}60`, color: 'text.primary' },
                }}
              >
                {t === 'my' ? '📈 My Stats' : '🏆 Leaderboard'}
              </Box>
            ))}
          </Box>
        </Box>

        {/* Scrollable content */}
        <Box sx={{
          overflowY: 'auto', flex: 1, minHeight: 0, p: 2,
          '&::-webkit-scrollbar': { width: 4 },
          '&::-webkit-scrollbar-thumb': { bgcolor: 'divider', borderRadius: 2 },
        }}>
          {!userId ? (
            <Box sx={{ py: 5, textAlign: 'center' }}>
              <Typography sx={{ color: 'text.disabled', fontSize: '0.85rem' }}>
                Sign in to view your prediction stats
              </Typography>
            </Box>
          ) : tab === 'my' ? (
            loading ? (
              <Typography sx={{ color: 'text.disabled', fontSize: '0.78rem' }}>
                Loading stats…
              </Typography>
            ) : !stats ? (
              <Box sx={{ py: 5, textAlign: 'center' }}>
                <Typography sx={{ color: 'text.disabled', fontSize: '0.85rem' }}>
                  No predictions yet — make some picks first!
                </Typography>
              </Box>
            ) : (
              <MyStatsContent stats={stats} />
            )
          ) : (
            lbLoading ? (
              <Typography sx={{ color: 'text.disabled', fontSize: '0.78rem' }}>
                Loading leaderboard…
              </Typography>
            ) : leaders.length === 0 ? (
              <Box sx={{ py: 5, textAlign: 'center' }}>
                <Typography sx={{ color: 'text.disabled', fontSize: '0.85rem' }}>
                  Leaderboard coming soon
                </Typography>
                <Typography sx={{ color: 'text.disabled', fontSize: '0.72rem', mt: 0.75, lineHeight: 1.4 }}>
                  View "My Stats" first to register your score,<br />
                  then check back after others do too.
                </Typography>
              </Box>
            ) : (
              <LeaderboardContent leaders={leaders} />
            )
          )}
        </Box>
      </Box>
    </Box>
  )
}
