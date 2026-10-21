import { useEffect, useMemo, useState } from 'react'
import { NameText } from '../ui/NameText'
import { edge } from '../ui/card'
import { Box, Typography, CircularProgress } from '@mui/material'
import {
  fetchWpblAllTracking, fetchWpblAllPlayers, fetchWpblAllLines,
  getCachedWpblAllTracking, getCachedWpblAllPlayers, getCachedWpblAllLines, wpblTrackingCacheAgeMs,
} from './api'
import { aggregateTracking } from './tracking'
import type { WpblSeasonGame } from './season'
import type { TrackingBoard, VeloLeader, SpinLeader, BattedBall } from './tracking'

type TrackingRows = {
  track: Parameters<typeof aggregateTracking>[0]
  players: Parameters<typeof aggregateTracking>[1]
  pitching: Parameters<typeof aggregateTracking>[2]
}
import { WPBL_ACCENT } from './constants'
import { SectionCard, LeaderRow, leaderPlaces, CARD_BORDER, chromePx } from './ui'
import { useUnits } from '../UnitsContext'
import { fmtSpeed, fmtDistance, speedUnit, distanceUnit } from '../lib/units'
import type { WpblTeam, WpblPlayer } from './types'
import { typePx } from '../ui/scale'
import { InfoDot } from '../ui/InfoDot'
import { useWpblSeason } from './SeasonContext'
import { ICON_SIZE, TYPE_SCALE } from '../ui/card'

// The section's TrackMan showcase: season-wide velocity, spin, and batted-ball leaderboards
// derived from the feed's pitch tracking (the distinctive data the WPBL feed carries that
// even the MLB app has no equivalent for). Self-contained: fetches + aggregates on mount.

// A big league-best callout tile (fastest pitch / hardest hit / longest hit).
function BestTile({ label, value, unit, name, accent }: {
  label: string; value: string; unit: string; name: string; accent: string
}) {
  return (
    <Box sx={{
      flex: 1, minWidth: chromePx(130), p: 1.25, borderRadius: 2, border: '1px solid', borderColor: CARD_BORDER,
      background: `linear-gradient(135deg, ${accent}1f 0%, transparent 70%)`,
    }}>
      <Typography sx={{ fontSize: TYPE_SCALE.caption, fontWeight: 800, textTransform: 'uppercase', letterSpacing: typePx(0.6), color: 'text.secondary' }}>{label}</Typography>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.4, mt: 0.25 }}>
        <Typography sx={{ fontSize: TYPE_SCALE.page, fontWeight: 800, lineHeight: 1, fontVariantNumeric: 'tabular-nums', color: accent }}>{value}</Typography>
        <Typography sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 700, color: 'text.secondary' }}>{unit}</Typography>
      </Box>
      <NameText name={name} sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 600, mt: 0.4 }} />
    </Box>
  )
}

function EmptyState({ title }: { title: string }) {
  return (
    <Box sx={{ textAlign: 'center', py: 5, px: 2, color: 'text.secondary' }}>
      <Typography sx={{ fontSize: TYPE_SCALE.heading, fontWeight: 700 }}>{title}</Typography>
    </Box>
  )
}

export default function WpblTrackingView({ side, games, onOpenPlayer }: {
  teams?: WpblTeam[]
  /** The schedule, so the boards below can be season boards. Required by `aggregateTracking`
   *  for the reason season.ts gives: a tracking row cannot say which game it belongs to. */
  games: WpblSeasonGame[]
  // Which half of the game to show. Owned by the Stats bar above, not by this view: it used
  // to keep its own Hitting/Pitching SegNav, so a reader who had already chosen a side one
  // level up was asked the same question again the moment they got here.
  side: 'hitting' | 'pitching'
  onOpenPlayer: (p: WpblPlayer) => void
}) {
  // Seed from the shared session cache so swiping back to this tab (SwipeableViews
  // unmounts it on the way out) repaints instantly instead of re-running the whole
  // fetch — including the paginated tracking scan — behind the spinner.
  //
  // THE ROWS ARE STATE AND THE BOARD IS DERIVED, so it follows the schedule. It used to be built
  // once, with whatever `games` held at mount, and the schedule is what keeps postseason pitches
  // out of a season board (CLAUDE.md, "Postseason games must never reach..."): one that arrived or
  // grew later never reached it.
  const [rows, setRows] = useState<TrackingRows | null>(() => {
    const tr = getCachedWpblAllTracking(), pl = getCachedWpblAllPlayers(), ln = getCachedWpblAllLines()
    return tr && pl && ln ? { track: tr, players: pl, pitching: ln.pitching } : null
  })
  // Cut to the year on screen first: the tracking rows and the lines are every season's.
  const { cut } = useWpblSeason()
  const board = useMemo<TrackingBoard | null>(
    () => (rows ? aggregateTracking(cut(rows.track), rows.players, cut(rows.pitching), games) : null),
    [rows, games, cut])
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
        setRows({ track, players, pitching: lines.pitching })
        setLoading(false)
      })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const accent = WPBL_ACCENT
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
    return <EmptyState title="No tracking data" />
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Coverage disclaimer: pinned to the top, restated whenever the tracked-game count changes.
          A label and a count, with the why behind the info dot (house rule, Oct 21, 2026: labels,
          not narration). It was a paragraph in first person until then. */}
      <Box sx={{
        display: 'flex', alignItems: 'center', gap: 1.25, p: 1.5, borderRadius: 2,
        border: '1px solid', borderColor: edge(accent),
        background: `linear-gradient(135deg, ${accent}26 0%, ${accent}0d 70%)`,
      }}>
        <Box aria-hidden sx={{ fontSize: ICON_SIZE.md, lineHeight: 1, flexShrink: 0 }}>⚠️</Box>
        <Box sx={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
          <Typography sx={{ fontSize: TYPE_SCALE.body, fontWeight: 800, textTransform: 'uppercase', letterSpacing: typePx(0.6), color: accent }}>
            Partial tracking data
          </Typography>
          <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.secondary' }}>
            {board.gameCount} {board.gameCount === 1 ? 'game' : 'games'}
          </Typography>
          <InfoDot text={[
            `Tracking from the league's in-park radar, for the first ${board.gameCount} ${board.gameCount === 1 ? 'game' : 'games'} of the season only, and incomplete within those.`,
            'The radar cannot follow a ball out of the field, so home runs often have no distance or exit velocity and do not rank here.',
            'Some pitches carry no pitcher when the feed omits the name.',
          ]} />
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
          <SectionCard bare title="Fastest pitchers" titleAdornment={<InfoDot text={[
            "Each pitcher's single fastest pitch, as measured by the league's in-park radar. Underneath: the average of all their tracked pitches, and how many there were.",
            'Only the games the league has published radar readings for are counted.',
          ]} />}>
            {board.veloLeaders.length === 0
              ? <EmptyState title="No velocity data" />
              : board.veloLeaders.slice(0, 10).map((l: VeloLeader, i, top) => (
                  <LeaderRow key={l.player?.id ?? l.name} {...leaderPlaces(top.map(x => fmtSpeed(x.maxVelo, units)))[i]} player={l.player} name={l.name} teamId={l.teamId}
                    value={fmtSpeed(l.maxVelo, units)} unit={speedUnit(units)} sub={`avg ${fmtSpeed(l.avgVelo, units)} · ${l.count} pitches`} accent={accent} onOpen={onOpenPlayer} />
                ))}
          </SectionCard>

          {board.spinLeaders.length > 0 && (
            <SectionCard bare title="Most spin" titleAdornment={<InfoDot text={[
              "The average spin rate of each pitcher's tracked pitches, in revolutions per minute. Underneath: their highest, and how many pitches were tracked.",
              'Only the games the league has published radar readings for are counted.',
            ]} />}>
              {board.spinLeaders.slice(0, 8).map((l: SpinLeader, i, top) => (
                <LeaderRow key={l.player?.id ?? l.name} {...leaderPlaces(top.map(x => String(Math.round(x.avgSpin))))[i]} player={l.player} name={l.name} teamId={l.teamId}
                  value={String(Math.round(l.avgSpin))} unit="rpm" sub={`max ${Math.round(l.maxSpin)} · ${l.count} pitches`} accent={accent} onOpen={onOpenPlayer} />
              ))}
            </SectionCard>
          )}
        </>
      ) : (
        <>
          {board.hitCount === 0 ? (
            <EmptyState title="No batted-ball data" />
          ) : (
            <>
              <SectionCard bare title="Hardest-hit balls" titleAdornment={<InfoDot text={[
                'Every tracked ball in play, ranked by exit velocity: how fast it was going as it left the bat.',
                'Only the games the league has published radar readings for are counted.',
              ]} />}>
                {board.hardestHits.slice(0, 10).map((b: BattedBall, i, top) => (
                  <LeaderRow key={i} {...leaderPlaces(top.map(x => fmtSpeed(x.exit ?? 0, units)))[i]} player={b.player} name={b.name} teamId={b.teamId}
                    value={fmtSpeed(b.exit ?? 0, units)} unit={speedUnit(units)} accent={accent} onOpen={onOpenPlayer}
                    sub={[b.hitType, b.distance != null ? `${fmtDistance(b.distance, units)} ${distanceUnit(units)}` : null].filter(Boolean).join(' · ') || undefined} />
                ))}
              </SectionCard>

              {board.longestHits.length > 0 && (
                <SectionCard bare title="Longest tracked hits" titleAdornment={<InfoDot text={[
                  'Every tracked ball in play, ranked by how far the radar measured it traveling.',
                  "The radar can't follow a ball once it leaves the field, so home runs, usually the longest hits, often have no distance and won't appear here.",
                ]} />}>
                  {board.longestHits.slice(0, 10).map((b: BattedBall, i, top) => (
                    <LeaderRow key={i} {...leaderPlaces(top.map(x => fmtDistance(x.distance!, units)))[i]} player={b.player} name={b.name} teamId={b.teamId}
                      value={fmtDistance(b.distance!, units)} unit={distanceUnit(units)} accent={accent} onOpen={onOpenPlayer}
                      sub={[b.hitType, b.exit != null ? `${fmtSpeed(b.exit, units)} ${speedUnit(units)} EV` : null].filter(Boolean).join(' · ') || undefined} />
                  ))}
                </SectionCard>
              )}
            </>
          )}
        </>
      )}
    </Box>
  )
}
