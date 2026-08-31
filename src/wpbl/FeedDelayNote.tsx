import { useEffect, useState } from 'react'
import { Box, Typography } from '@mui/material'
import { CloudOffOutlined, SyncProblemOutlined } from '@mui/icons-material'
import { feedHealth, describeGap, type FeedHealthGame } from './derive/feedHealth'

/**
 * Why this game is not moving, said out loud.
 *
 * A game sitting at its scheduled state twenty minutes after first pitch is, to a reader, a
 * broken page. They refresh it, they refresh it again, and then they decide the site does not
 * work. That happened on Aug 30, 2026: our ingest was polling every two minutes with zero
 * errors while the league's own record sat frozen at 21:54:31Z, thirty-five minutes before a
 * first pitch it never acknowledged. Nothing on the page said any of that, so every reader
 * who opened it was told, by omission, that we were broken.
 *
 * IT NAMES THE SOURCE, WHICH IS THE ENTIRE MECHANISM. "Something went wrong" would have been
 * useless here and mildly dishonest. A timestamp and the words "the league's feed" let the
 * reader work out where the silence is coming from without us telling them how to feel about
 * it. Nobody is blamed and nothing is excused; the provenance is simply on the page, which is
 * the same thing the run-value explainer does with its numbers.
 *
 * AND IT SAYS WHEN IT IS OUR FAULT, in the same slot, with the same weight. `feedHealth`
 * checks our own write clock before the league's precisely so this component cannot point
 * upstream during our own outage; see the note there. A notice that only ever blames somebody
 * else is not an indicator, it is a disclaimer, and readers learn to discount it.
 *
 * NOT AN ERROR, and it must not be dressed as one. No red, no warning triangle: the page is
 * working, the data is late, and there is nothing for the reader to do. Amber on a muted
 * panel is the register for "heads up", which is what this is.
 */

/** Local wall-clock for a stamp, which is the only form of it worth showing a reader. */
function clockTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/** A clock that ticks slowly, so the note can APPEAR on its own.
 *
 *  It has to. The whole state is "nothing is arriving", so there is no incoming data to
 *  re-render this component, and without a tick a reader who opened the page before first
 *  pitch would sit in front of a silent game forever and never be told why. Thirty seconds:
 *  the copy is rounded to the minute, so anything faster is repainting to say the same thing. */
function useSlowClock(override?: number): number {
  const [now, setNow] = useState(() => override ?? Date.now())
  useEffect(() => {
    if (override != null) return
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [override])
  return override ?? now
}

export default function FeedDelayNote({ game, now: fixedNow, compact }: {
  game: FeedHealthGame
  /** Pin the clock. Tests only: in the app it ticks itself, for the reason above. */
  now?: number
  /** One line instead of two, for a card that has no room for the second. */
  compact?: boolean
}) {
  // Hooks before the early return: this component spends most of its life rendering null and
  // still has to be ticking while it does, which is the only way it ever stops.
  const now = useSlowClock(fixedNow)
  const health = feedHealth(game, now)
  if (health.kind === 'ok') return null

  const feed = health.kind === 'feed-stale'
  const Icon = feed ? CloudOffOutlined : SyncProblemOutlined

  // A stamp of 0 means the row carried none, or an unparseable one. There is then no gap to
  // measure either: `now - 0` is the age of the Unix epoch, and "56 years ago" under a
  // baseball game is the kind of number that discredits everything around it. Both the time
  // and the gap drop out together, leaving a sentence that still says the useful half.
  const stamp = health.since > 0 ? clockTime(health.since) : null
  const since = stamp ? `since ${stamp}, ${describeGap(now - health.since)} ago` : 'yet'

  // Two sentences, and the first one is the whole message. The second exists to stop the
  // reader doing the thing they are about to do, which is refresh the page repeatedly.
  const title = feed ? 'Waiting on the league' : 'Our data is behind'
  const detail = feed
    ? `No update from the WPBL feed ${since}.${compact ? '' : ' This page fills in on its own as soon as they publish.'}`
    : `We have not synced this game ${since}.${compact ? '' : ' The page will catch up by itself.'}`

  return (
    <Box
      role="status"
      sx={{
        display: 'flex', alignItems: 'flex-start', gap: 1,
        px: 1.25, py: 1, borderRadius: 2,
        border: '1px solid', borderColor: 'rgba(245,158,11,0.35)',
        bgcolor: 'rgba(245,158,11,0.08)',
      }}
    >
      <Icon sx={{ fontSize: '1.05rem', flexShrink: 0, color: '#f59e0b', mt: '1px' }} />
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontSize: '0.8rem', fontWeight: 700, lineHeight: 1.25 }}>{title}</Typography>
        <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary', lineHeight: 1.4, mt: 0.15 }}>
          {detail}
        </Typography>
      </Box>
    </Box>
  )
}
