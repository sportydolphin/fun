import { lazy, Suspense, useEffect, useState } from 'react'
import { Box } from '@mui/material'
import { useAuth } from '../../AuthContext'
import { supabase } from '../../lib/supabase'
import { SectionCard } from '../../ui/card'
import { CountRow } from '../components/CountRow'
import { CURRENT_SEASON } from '../constants'
import { fetchNextOpeningDay, longDay } from '../seasonPhase'
import { useDeepLink } from '../state/deepLink'
import { SurvivorLeaderboardModal } from './StreakSurvivor'
import { fetchMyStats } from './survivorData'

const PredictionStatsModal = lazy(() => import('./PredictionStats').then(m => ({ default: m.PredictionStatsModal })))

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
      title="Games"
      subtitle={<Box component="span" sx={{ visibility: opening ? undefined : 'hidden' }}>Opening Day · {opening ? longDay(opening) : 'March 25'}</Box>}
    >
      <CountRow label="Predictions" value={predictions ?? 'Leaderboard'} onOpen={() => setOpen('predictions')} />
      <CountRow label="Streak Survivor" value={survivor ?? 'Leaderboard'} onOpen={() => setOpen('survivor')} />

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
