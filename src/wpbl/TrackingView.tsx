import { useEffect, useMemo, useState } from 'react'
import { Box, Typography, CircularProgress } from '@mui/material'
import {
  fetchWpblAllTracking, fetchWpblAllPlayers, fetchWpblAllLines,
  getCachedWpblAllTracking, getCachedWpblAllPlayers, getCachedWpblAllLines, wpblTrackingCacheAgeMs,
} from './api'
import { aggregateTracking } from './tracking'
import type { TrackingBoard, VeloLeader, SpinLeader, PitchHit, BattedBall } from './tracking'
import { useWpblAccent } from './accent'
import { SectionCard, PlayerPortrait, TeamBadge, CARD_BORDER, useWpblName } from './ui'
import { useUnits } from '../UnitsContext'
import { fmtSpeed, fmtDistance, speedUnit, distanceUnit } from '../lib/units'
import type { WpblTeam, WpblPlayer } from './types'

// The section's TrackMan showcase: season-wide velocity, spin, and batted-ball leaderboards
// derived from the feed's pitch tracking (the distinctive data the WPBL feed carries that
// even the MLB app has no equivalent for). Self-contained: fetches + aggregates on mount.

// ── One ranked row: rank chip · portrait · name + team badge · a big value on the right ──
function LeaderRow({ rank, player, name, teamId, value, unit, sub, accent, onOpen }: {
  rank: number
  player: WpblPlayer | null
  name: string
  teamId: string | null
  value: string
  unit?: string
  sub?: string
  accent: string
  onOpen?: (p: WpblPlayer) => void
}) {
  const clickable = !!player && !!onOpen
  const shortName = useWpblName()
  return (
    <Box
      onClick={clickable ? () => onOpen!(player!) : undefined}
      sx={{
        display: 'flex', alignItems: 'center', gap: 1.25, px: 0.5, py: 0.85,
        borderTop: rank === 1 ? 'none' : '1px solid', borderColor: 'divider',
        borderRadius: 1, cursor: clickable ? 'pointer' : 'default',
        '&:hover': clickable ? { bgcolor: 'action.hover' } : undefined,
      }}
    >
      <Box sx={{ width: 18, textAlign: 'center', fontSize: '0.8rem', fontWeight: 800, color: rank <= 3 ? accent : 'text.disabled', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{rank}</Box>
      <PlayerPortrait name={name} teamId={teamId} size={32} />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
          <Typography sx={{ fontSize: '0.85rem', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{shortName(name)}</Typography>
          {teamId && <TeamBadge team={{ id: teamId, abbr: teamId }} size={16} />}
        </Box>
        {sub && <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</Typography>}
      </Box>
      <Box sx={{ textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
        <Box component="span" sx={{ fontSize: '1.05rem', fontWeight: 800, color: accent }}>{value}</Box>
        {unit && <Box component="span" sx={{ fontSize: '0.65rem', fontWeight: 700, color: 'text.disabled', ml: 0.4 }}>{unit}</Box>}
      </Box>
    </Box>
  )
}

// A big league-best callout tile (fastest pitch / hardest hit / longest hit).
function BestTile({ label, value, unit, name, accent }: {
  label: string; value: string; unit: string; name: string; accent: string
}) {
  const shortName = useWpblName()
  return (
    <Box sx={{
      flex: 1, minWidth: 130, p: 1.25, borderRadius: 2, border: '1px solid', borderColor: CARD_BORDER,
      background: `linear-gradient(135deg, ${accent}1f 0%, transparent 70%)`,
    }}>
      <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6, color: 'text.secondary' }}>{label}</Typography>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.4, mt: 0.25 }}>
        <Typography sx={{ fontSize: '1.7rem', fontWeight: 800, lineHeight: 1, fontVariantNumeric: 'tabular-nums', color: accent }}>{value}</Typography>
        <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: 'text.secondary' }}>{unit}</Typography>
      </Box>
      <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, mt: 0.4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{shortName(name)}</Typography>
    </Box>
  )
}

function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <Box sx={{ textAlign: 'center', py: 5, px: 2, color: 'text.secondary' }}>
      <Typography sx={{ fontSize: '1rem', fontWeight: 700, mb: 0.5 }}>{title}</Typography>
      {hint && <Typography sx={{ fontSize: '0.85rem', color: 'text.disabled' }}>{hint}</Typography>}
    </Box>
  )
}

export default function WpblTrackingView({ side, onOpenPlayer }: {
  teams?: WpblTeam[]
  // Which half of the game to show. Owned by the Stats bar above, not by this view: it used
  // to keep its own Hitting/Pitching SegNav, so a reader who had already chosen a side one
  // level up was asked the same question again the moment they got here.
  side: 'hitting' | 'pitching'
  onOpenPlayer: (p: WpblPlayer) => void
}) {
  // Seed from the shared session cache so swiping back to this tab (SwipeableViews
  // unmounts it on the way out) repaints instantly instead of re-running the whole
  // fetch — including the paginated tracking scan — behind the spinner.
  const [board, setBoard] = useState<TrackingBoard | null>(() => {
    const tr = getCachedWpblAllTracking(), pl = getCachedWpblAllPlayers(), ln = getCachedWpblAllLines()
    return tr && pl && ln ? aggregateTracking(tr, pl, ln.pitching) : null
  })
  const [loading, setLoading] = useState(
    () => !(getCachedWpblAllTracking() && getCachedWpblAllPlayers() && getCachedWpblAllLines()))

  // Revalidate on mount, but skip the round trip when the cache is still fresh. Tracking
  // is a slow, manually-published league batch (it barely moves within a session), so a
  // generous stale window keeps rapid swipes instant while still picking up new batches.
  useEffect(() => {
    const TRACK_STALE_MS = 60_000
    if (wpblTrackingCacheAgeMs() < TRACK_STALE_MS) return
    let cancelled = false
    Promise.all([fetchWpblAllTracking(), fetchWpblAllPlayers(), fetchWpblAllLines()])
      .then(([track, players, lines]) => {
        if (cancelled) return
        setBoard(aggregateTracking(track, players, lines.pitching))
        setLoading(false)
      })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const accent = useWpblAccent()
  const { units } = useUnits()
  const bests = useMemo(() => {
    if (!board) return []
    const fp = board.fastestPitches[0]
    const hh = board.hardestHits[0]
    const lh = board.longestHits[0]
    const tiles: { label: string; value: string; unit: string; name: string }[] = []
    if (side === 'pitching') {
      if (fp) tiles.push({ label: 'Fastest pitch', value: fmtSpeed(fp.velo, units), unit: speedUnit(units), name: fp.name })
    } else {
      if (hh && hh.exit != null) tiles.push({ label: 'Hardest hit', value: fmtSpeed(hh.exit, units), unit: `${speedUnit(units)} EV`, name: hh.name })
      if (lh && lh.distance != null) tiles.push({ label: 'Longest hit', value: fmtDistance(lh.distance, units), unit: distanceUnit(units), name: lh.name })
    }
    return tiles
  }, [board, units, side])

  if (loading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>
  }
  if (!board || board.pitchCount === 0) {
    return <EmptyState title="No tracking data yet" hint="Velocity, spin, and exit-velocity leaders appear here once games are played." />
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Coverage disclaimer — pinned to the top, restated whenever the tracked-game count changes */}
      <Box sx={{
        display: 'flex', alignItems: 'flex-start', gap: 1.25, p: 1.5, borderRadius: 2,
        border: '1px solid', borderColor: `${accent}80`,
        background: `linear-gradient(135deg, ${accent}26 0%, ${accent}0d 70%)`,
      }}>
        <Box sx={{ fontSize: '1.2rem', lineHeight: 1, flexShrink: 0, mt: '1px' }}>⚠️</Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: '0.8rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6, color: accent }}>
            Partial tracking data
          </Typography>
          <Typography sx={{ fontSize: '0.82rem', color: 'text.secondary', lineHeight: 1.45, mt: 0.25 }}>
            We only have tracking data for the first {board.gameCount} {board.gameCount === 1 ? 'game' : 'games'} of the season, and even those are incomplete. The in-park radar can't reliably track balls hit out of the field, so home runs often show up with no distance or exit velocity and won't rank on these boards. We'll add more as the league posts it.
          </Typography>
        </Box>
      </Box>

      {/* League bests */}
      {bests.length > 0 && (
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {bests.map(t => <BestTile key={t.label} {...t} accent={accent} />)}
        </Box>
      )}

      {side === 'pitching' ? (
        <>
          <SectionCard title="Fastest pitchers" subtitle="Each pitcher's hardest pitch, with their season average">
            {board.veloLeaders.length === 0
              ? <EmptyState title="No velocity data yet" />
              : board.veloLeaders.slice(0, 10).map((l: VeloLeader, i) => (
                  <LeaderRow key={l.player?.id ?? l.name} rank={i + 1} player={l.player} name={l.name} teamId={l.teamId}
                    value={fmtSpeed(l.maxVelo, units)} unit={speedUnit(units)} sub={`avg ${fmtSpeed(l.avgVelo, units)} · ${l.count} pitches`} accent={accent} onOpen={onOpenPlayer} />
                ))}
          </SectionCard>

          {board.spinLeaders.length > 0 && (
            <SectionCard title="Spin leaders" subtitle="Ranked by average spin rate">
              {board.spinLeaders.slice(0, 8).map((l: SpinLeader, i) => (
                <LeaderRow key={l.player?.id ?? l.name} rank={i + 1} player={l.player} name={l.name} teamId={l.teamId}
                  value={String(Math.round(l.avgSpin))} unit="rpm" sub={`max ${Math.round(l.maxSpin)} · ${l.count} pitches`} accent={accent} onOpen={onOpenPlayer} />
              ))}
            </SectionCard>
          )}
        </>
      ) : (
        <>
          {board.hitCount === 0 ? (
            <EmptyState title="No batted-ball data yet" hint="Exit velocity and distance leaders appear once balls are put in play." />
          ) : (
            <>
              <SectionCard title="Hardest-hit balls" subtitle="Ranked by exit velocity">
                {board.hardestHits.slice(0, 10).map((b: BattedBall, i) => (
                  <LeaderRow key={i} rank={i + 1} player={b.player} name={b.name} teamId={b.teamId}
                    value={fmtSpeed(b.exit ?? 0, units)} unit={speedUnit(units)} accent={accent} onOpen={onOpenPlayer}
                    sub={[b.hitType, b.distance != null ? `${fmtDistance(b.distance, units)} ${distanceUnit(units)}` : null].filter(Boolean).join(' · ') || undefined} />
                ))}
              </SectionCard>

              {board.longestHits.length > 0 && (
                <SectionCard title="Longest tracked hits" subtitle="By radar-measured distance">
                  {board.longestHits.slice(0, 10).map((b: BattedBall, i) => (
                    <LeaderRow key={i} rank={i + 1} player={b.player} name={b.name} teamId={b.teamId}
                      value={fmtDistance(b.distance!, units)} unit={distanceUnit(units)} accent={accent} onOpen={onOpenPlayer}
                      sub={[b.hitType, b.exit != null ? `${fmtSpeed(b.exit, units)} ${speedUnit(units)} EV` : null].filter(Boolean).join(' · ') || undefined} />
                  ))}
                  <Typography sx={{ mt: 1, px: 0.5, fontSize: '0.72rem', color: 'text.secondary', lineHeight: 1.4 }}>
                    Distances come from in-park radar, which can't follow balls once they leave the field. Home runs, usually the longest hits, often have no measured distance and won't appear here.
                  </Typography>
                </SectionCard>
              )}
            </>
          )}
        </>
      )}

      <Typography sx={{ fontSize: '0.72rem', color: 'text.disabled', textAlign: 'center', px: 2 }}>
        Pitch and batted-ball tracking from the official league feed. Some pitches are not attributed to a pitcher when the feed omits the name.
      </Typography>
    </Box>
  )
}
