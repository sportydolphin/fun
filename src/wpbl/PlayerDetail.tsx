import { useEffect, useMemo, useState } from 'react'
import { Box, Typography, CircularProgress, Tooltip } from '@mui/material'
import { fetchWpblPlayerLines, fetchWpblPitcherLocations, type WpblPitchLoc } from './api'
import { sumBatting, sumPitching, sumFielding, fmtRate, fmtTwo } from './stats'
import { wpblAccent, wpblFullName, outsToIp } from './constants'
import { ModalShell, PlayerPortrait, useWpblDark } from './ui'
import { PitchLocationCard } from './PitchLocation'
import type { WpblTeam, WpblPlayer, WpblGame, WpblBattingLine, WpblPitchingLine, WpblFieldingLine } from './types'

// Player page (Phase 1c): profile + season totals aggregated from box-score lines,
// plus a per-game log. Public read; opened from a team's roster.

// What each abbreviation stands for — surfaced on hover/tap so the stat line isn't cryptic.
const STAT_FULL: Record<string, string> = {
  AVG: 'Batting average', OBP: 'On-base percentage', SLG: 'Slugging percentage', OPS: 'On-base plus slugging',
  G: 'Games', AB: 'At-bats', R: 'Runs', H: 'Hits', '2B': 'Doubles', '3B': 'Triples', HR: 'Home runs',
  RBI: 'Runs batted in', BB: 'Walks', SO: 'Strikeouts', SB: 'Stolen bases', TB: 'Total bases',
  ERA: 'Earned run average', WHIP: 'Walks + hits per inning pitched', 'W-L': 'Wins–Losses', SV: 'Saves',
  IP: 'Innings pitched', ER: 'Earned runs',
  FPCT: 'Fielding percentage', PO: 'Putouts', A: 'Assists', E: 'Errors', DP: 'Double plays',
  PB: 'Passed balls', SBA: 'Stolen bases allowed',
}
const statFull = (k: string): string => STAT_FULL[k] ?? k
// The player modal sits at zIndex 1600; MUI's tooltip defaults to 1500, so it would
// render behind the modal. Lift the popper above it.
const tipSlotProps = { popper: { sx: { zIndex: 1700 } } } as const

// A stat section (Batting / Pitching / Fielding) as its own card with a team-color spine,
// a prominent rate-stat hero row, and a tidy aligned stat line of counting stats.
function StatSection({ label, color, hero, line }: {
  label: string; color: string
  hero: { label: string; value: string }[]
  line?: [string, string | number][]
}) {
  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden', mb: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.75, py: 0.9, borderBottom: '1px solid', borderColor: 'divider', borderLeft: `3px solid ${color}` }}>
        <Typography sx={{ fontSize: '0.76rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6 }}>{label}</Typography>
      </Box>
      <Box sx={{ px: 1.75, py: 1.5 }}>
        {/* Hero rate stats — big, evenly spaced, divided */}
        <Box sx={{ display: 'flex', mb: line && line.length ? 1.75 : 0 }}>
          {hero.map((t, i) => (
            <Tooltip key={t.label} title={statFull(t.label)} arrow enterTouchDelay={0} leaveTouchDelay={2500} slotProps={tipSlotProps}>
              <Box sx={{ flex: 1, textAlign: 'center', cursor: 'help', borderLeft: i > 0 ? '1px solid' : 'none', borderColor: 'divider' }}>
                <Typography sx={{ fontSize: '1.4rem', fontWeight: 800, lineHeight: 1.05, fontVariantNumeric: 'tabular-nums' }}>{t.value}</Typography>
                <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'text.disabled' }}>{t.label}</Typography>
              </Box>
            </Tooltip>
          ))}
        </Box>
        {/* Counting stats as an aligned label-over-value line */}
        {line && line.length > 0 && <StatLine items={line} />}
      </Box>
    </Box>
  )
}

// Counting stats as evenly-spread columns (label over value) so everything lines up in a
// clean row. Each column is hoverable and shows what the abbreviation stands for.
function StatLine({ items }: { items: [string, string | number][] }) {
  return (
    <Box sx={{ display: 'flex', overflowX: 'auto', borderTop: '1px solid', borderColor: 'divider', pt: 1.25 }}>
      {items.map(([label, value]) => (
        <Tooltip key={label} title={statFull(label)} arrow enterTouchDelay={0} leaveTouchDelay={2500} slotProps={tipSlotProps}>
          <Box sx={{ flex: '1 0 auto', minWidth: 34, textAlign: 'center', px: 0.75, cursor: 'help' }}>
            <Typography sx={{ fontSize: '0.56rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'text.disabled', mb: 0.15 }}>{label}</Typography>
            <Typography sx={{ fontSize: '0.95rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{value}</Typography>
          </Box>
        </Tooltip>
      ))}
    </Box>
  )
}

function GameLog({ title, rows }: { title: string; rows: { date: string; text: string; line: string }[] }) {
  if (rows.length === 0) return null
  return (
    <Box sx={{ mb: 2 }}>
      <Typography sx={sectionSx}>{title}</Typography>
      <Box>
        {rows.map((r, i) => (
          <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 0.7, borderTop: '1px solid', borderColor: 'divider', fontSize: '0.82rem' }}>
            <Box sx={{ width: 46, color: 'text.disabled', flexShrink: 0 }}>{r.date}</Box>
            <Box sx={{ width: 50, fontWeight: 700, flexShrink: 0 }}>{r.text}</Box>
            <Box sx={{ color: 'text.secondary', flex: 1, minWidth: 0 }}>{r.line}</Box>
          </Box>
        ))}
      </Box>
    </Box>
  )
}

export default function PlayerDetailModal({ player, teams, games, onClose }: {
  player: WpblPlayer
  teams: WpblTeam[]
  games: WpblGame[]
  onClose: () => void
}) {
  const isDark = useWpblDark()
  const team = useMemo(() => teams.find(t => t.id === player.team_id), [teams, player.team_id])
  const gameById = useMemo(() => new Map(games.map(g => [g.id, g])), [games])
  const teamById = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])
  const color = team ? wpblAccent(team.id, isDark) : '#888'

  const [loading, setLoading] = useState(true)
  const [batting, setBatting] = useState<WpblBattingLine[]>([])
  const [pitching, setPitching] = useState<WpblPitchingLine[]>([])
  const [fielding, setFielding] = useState<WpblFieldingLine[]>([])
  const [pitchLocs, setPitchLocs] = useState<WpblPitchLoc[]>([])

  useEffect(() => {
    let cancelled = false
    fetchWpblPlayerLines(player.id).then(({ batting, pitching, fielding }) => {
      if (cancelled) return
      setBatting(batting); setPitching(pitching); setFielding(fielding); setLoading(false)
    })
    // Pitch-location tracking keys on the feed id; empty for non-pitchers / unmapped players.
    setPitchLocs([])
    fetchWpblPitcherLocations(player.api_id).then(locs => { if (!cancelled) setPitchLocs(locs) })
    return () => { cancelled = true }
  }, [player.id, player.api_id])

  const bt = useMemo(() => sumBatting(batting), [batting])
  const pt = useMemo(() => sumPitching(pitching), [pitching])
  const ft = useMemo(() => sumFielding(fielding), [fielding])
  const hasBatting = batting.length > 0
  const hasPitching = pitching.length > 0
  const hasFielding = fielding.some(f => f.po || f.a || f.e || f.dp || f.pb)

  // Opponent label for a game the player appeared in.
  const oppLabel = (gameId: string): { date: string; text: string } => {
    const g = gameById.get(gameId)
    if (!g) return { date: '', text: '' }
    const isHome = g.home_team_id === player.team_id
    const oppId = isHome ? g.away_team_id : g.home_team_id
    const opp = teamById.get(oppId)
    const date = new Date(`${g.game_date}T00:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' })
    return { date, text: `${isHome ? 'vs' : '@'} ${opp?.abbr ?? oppId}` }
  }

  const subParts = [player.position, [player.bats, player.throws].filter(Boolean).join('/') ? `B/T ${player.bats || '-'}/${player.throws || '-'}` : null, player.age != null ? `${player.age} yrs` : null].filter(Boolean)

  return (
    <ModalShell
      eyebrow={team ? wpblFullName(team) : 'Player'}
      onClose={onClose}
      maxWidth={640}
      zIndex={1600}
    >
      {/* Identity */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.75, p: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Box sx={{ width: 4, alignSelf: 'stretch', borderRadius: 3, bgcolor: color, flexShrink: 0 }} />
        <PlayerPortrait name={player.name} teamId={player.team_id} size={72} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: '1.2rem', fontWeight: 800, lineHeight: 1.15 }}>{player.name}</Typography>
          {subParts.length > 0 && (
            <Typography sx={{ fontSize: '0.8rem', color: 'text.secondary' }}>{subParts.join(' · ')}</Typography>
          )}
          {player.hometown && <Typography sx={{ fontSize: '0.72rem', color: 'text.disabled' }}>{player.hometown}{player.draft_round ? ` · Round ${player.draft_round}, Pick ${player.draft_pick}` : ''}</Typography>}
        </Box>
      </Box>

      <Box sx={{ p: 2 }}>
        {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
          ) : !hasBatting && !hasPitching && !hasFielding ? (
            <Box sx={{ textAlign: 'center', py: 5, color: 'text.secondary' }}>
              <Typography sx={{ fontSize: '0.95rem', fontWeight: 700, mb: 0.5 }}>No stats yet</Typography>
              <Typography sx={{ fontSize: '0.82rem', color: 'text.disabled' }}>Season totals appear here once this player logs a game.</Typography>
            </Box>
          ) : (
            <>
              {hasBatting && (
                <StatSection
                  label="Batting" color={color}
                  hero={[
                    { label: 'AVG', value: fmtRate(bt.avg) }, { label: 'OBP', value: fmtRate(bt.obp) },
                    { label: 'SLG', value: fmtRate(bt.slg) }, { label: 'OPS', value: fmtRate(bt.ops) },
                  ]}
                  line={[['G', bt.g], ['AB', bt.ab], ['R', bt.r], ['H', bt.h], ['2B', bt.doubles], ['3B', bt.triples], ['HR', bt.hr], ['RBI', bt.rbi], ['BB', bt.bb], ['SO', bt.so], ['SB', bt.sb], ['TB', bt.tb]]}
                />
              )}

              {hasPitching && (
                <StatSection
                  label="Pitching" color={color}
                  hero={[
                    { label: 'ERA', value: fmtTwo(pt.era) }, { label: 'WHIP', value: fmtTwo(pt.whip) },
                    { label: 'W-L', value: `${pt.w}-${pt.l}` }, ...(pt.s > 0 ? [{ label: 'SV', value: String(pt.s) }] : []),
                  ]}
                  line={[['G', pt.g], ['IP', outsToIp(pt.outs)], ['H', pt.h], ['R', pt.r], ['ER', pt.er], ['BB', pt.bb], ['SO', pt.so], ['HR', pt.hr]]}
                />
              )}

              {pitchLocs.length > 0 && <PitchLocationCard rows={pitchLocs} accent={color} />}

              {hasFielding && (
                <StatSection
                  label="Fielding" color={color}
                  hero={[
                    { label: 'FPCT', value: fmtRate(ft.fpct) }, { label: 'PO', value: String(ft.po) },
                    { label: 'A', value: String(ft.a) }, { label: 'E', value: String(ft.e) },
                    ...(ft.dp ? [{ label: 'DP', value: String(ft.dp) }] : []),
                    ...(ft.pb ? [{ label: 'PB', value: String(ft.pb) }] : []),
                    ...(ft.sba ? [{ label: 'SBA', value: String(ft.sba) }] : []),
                  ]}
                />
              )}

              {/* Game log — split by type so a two-way player's lines don't blur together */}
              {hasBatting && (
                <GameLog
                  title={hasPitching ? 'Hitting log' : 'Game log'}
                  rows={batting.map(l => ({ ...oppLabel(l.game_id), line: `${l.h}-for-${l.ab}${l.hr ? `, ${l.hr} HR` : ''}${l.rbi ? `, ${l.rbi} RBI` : ''}${l.bb ? `, ${l.bb} BB` : ''}` }))}
                />
              )}
              {hasPitching && (
                <GameLog
                  title={hasBatting ? 'Pitching log' : 'Game log'}
                  rows={pitching.map(l => ({ ...oppLabel(l.game_id), line: `${outsToIp(l.outs)} IP, ${l.er} ER, ${l.so} K, ${l.bb} BB${l.decision ? ` (${l.decision})` : ''}` }))}
                />
              )}
            </>
          )}
        </Box>
    </ModalShell>
  )
}

const sectionSx = { fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5, color: 'text.secondary', mb: 1 } as const
