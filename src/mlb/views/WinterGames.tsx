import { lazy, Suspense, useEffect, useState } from 'react'
import { Box, Typography } from '@mui/material'
import { useAuth } from '../../AuthContext'
import { supabase } from '../../lib/supabase'
import { CardLink, SectionCard, TYPE_SCALE } from '../../ui/card'
import { CURRENT_SEASON } from '../constants'
import { fetchNextOpeningDay, longDay } from '../seasonPhase'
import { useDeepLink } from '../state/deepLink'
import { SurvivorLeaderboardModal } from './StreakSurvivor'
import { fetchMyStats } from './survivorData'

const PredictionStatsModal = lazy(() => import('./PredictionStats').then(m => ({ default: m.PredictionStatsModal })))

function GameRow({ label, value, onOpen }: { label: string; value: string | null; onOpen: () => void }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5, borderTop: '1px solid', borderColor: 'divider' }}>
      <Typography sx={{ flex: 1, minWidth: 0, fontSize: TYPE_SCALE.body, fontWeight: 700 }}>{label}</Typography>
      {value && (
        <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
          {value}
        </Typography>
      )}
      <CardLink label="Leaderboard" onClick={onOpen} />
    </Box>
  )
}

/**
 * Predictions and Streak Survivor from the end of the World Series to Opening Day. Each was a card
 * saying it would be back, which on a phone put two dead cards above the winter's news, and each read
 * a slate of games that does not exist to get there. What they hold until spring is a date, the
 * reader's record and a leaderboard, and the links in the More sheet (`?open=predictor`,
 * `?open=survivor`) land on those leaderboards here.
 *
 * Every row is the same height with or without its figure, so nothing moves when they land.
 */
export function WinterGamesCard() {
  const { user } = useAuth()
  const [opening, setOpening] = useState<string | null>(null)
  const [predictions, setPredictions] = useState<string | null>(null)
  const [survivor, setSurvivor] = useState<string | null>(null)
  const [username, setUsername] = useState<string | null>(null)
  const [open, setOpen] = useState<'predictions' | 'survivor' | null>(null)

  useDeepLink('predictor', () => setOpen('predictions'))
  useDeepLink('survivor', () => setOpen('survivor'))

  useEffect(() => {
    let cancelled = false
    fetchNextOpeningDay(CURRENT_SEASON).then(d => { if (!cancelled) setOpening(d) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    setPredictions(null); setSurvivor(null); setUsername(null)
    if (!user) return
    let cancelled = false
    supabase.from('prediction_stats').select('correct_predictions, total_predictions').eq('user_id', user.id).maybeSingle()
      .then(({ data }) => {
        const total = Number(data?.total_predictions ?? 0), correct = Number(data?.correct_predictions ?? 0)
        if (!cancelled && total > 0) setPredictions(`${correct}–${total - correct} · ${Math.round(correct / total * 100)}%`)
      })
    fetchMyStats(user.id).then(s => { if (!cancelled && s.totalPicks > 0) setSurvivor(`Best ${s.longestStreak}`) })
    // The stats sheet writes the reader's row under this name when it opens, so it must be theirs.
    supabase.from('usernames').select('username').eq('user_id', user.id).maybeSingle()
      .then(({ data }) => { if (!cancelled) setUsername(data?.username ?? null) })
    return () => { cancelled = true }
  }, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <SectionCard
      title="Opening Day"
      action={
        <Typography sx={{ fontSize: TYPE_SCALE.body, fontWeight: 800, whiteSpace: 'nowrap', visibility: opening ? undefined : 'hidden' }}>
          {opening ? longDay(opening) : 'March 25'}
        </Typography>
      }
    >
      <GameRow label="Predictions" value={predictions} onOpen={() => setOpen('predictions')} />
      <GameRow label="Streak Survivor" value={survivor} onOpen={() => setOpen('survivor')} />

      {open === 'predictions' && (
        <Suspense fallback={null}>
          <PredictionStatsModal
            open
            initialTab="board"
            userId={user?.id}
            displayName={username ?? user?.email?.split('@')[0] ?? 'Anonymous'}
            onClose={() => setOpen(null)}
          />
        </Suspense>
      )}
      {open === 'survivor' && <SurvivorLeaderboardModal userId={user?.id ?? null} onClose={() => setOpen(null)} />}
    </SectionCard>
  )
}
