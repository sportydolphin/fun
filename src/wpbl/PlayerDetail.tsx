import { useEffect, useMemo, useState } from 'react'
import { Box, Typography, CircularProgress } from '@mui/material'
import { fetchWpblPlayerLines } from './api'
import { sumBatting, sumPitching, fmtRate, fmtTwo } from './stats'
import { wpblAccent, wpblFullName, outsToIp } from './constants'
import { ModalShell, PlayerPortrait, useWpblDark } from './ui'
import type { WpblTeam, WpblPlayer, WpblGame, WpblBattingLine, WpblPitchingLine } from './types'

// Player page (Phase 1c): profile + season totals aggregated from box-score lines,
// plus a per-game log. Public read; opened from a team's roster.

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ textAlign: 'center', minWidth: 58 }}>
      <Typography sx={{ fontSize: '1.15rem', fontWeight: 800, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>{value}</Typography>
      <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'text.disabled' }}>{label}</Typography>
    </Box>
  )
}

function DetailGrid({ items }: { items: [string, string | number][] }) {
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, mt: 1.5 }}>
      {items.map(([label, value]) => (
        <Box key={label} sx={{ minWidth: 40 }}>
          <Typography sx={{ fontSize: '0.85rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{value}</Typography>
          <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3, color: 'text.disabled' }}>{label}</Typography>
        </Box>
      ))}
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

  useEffect(() => {
    let cancelled = false
    fetchWpblPlayerLines(player.id).then(({ batting, pitching }) => {
      if (cancelled) return
      setBatting(batting); setPitching(pitching); setLoading(false)
    })
    return () => { cancelled = true }
  }, [player.id])

  const bt = useMemo(() => sumBatting(batting), [batting])
  const pt = useMemo(() => sumPitching(pitching), [pitching])
  const hasBatting = batting.length > 0
  const hasPitching = pitching.length > 0

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
          ) : !hasBatting && !hasPitching ? (
            <Box sx={{ textAlign: 'center', py: 5, color: 'text.secondary' }}>
              <Typography sx={{ fontSize: '0.95rem', fontWeight: 700, mb: 0.5 }}>No stats yet</Typography>
              <Typography sx={{ fontSize: '0.82rem', color: 'text.disabled' }}>Season totals appear here once this player logs a game.</Typography>
            </Box>
          ) : (
            <>
              {hasBatting && (
                <Box sx={{ mb: 3 }}>
                  <Typography sx={sectionSx}>Batting</Typography>
                  <Box sx={{ display: 'flex', gap: 2 }}>
                    <StatTile label="AVG" value={fmtRate(bt.avg)} />
                    <StatTile label="OBP" value={fmtRate(bt.obp)} />
                    <StatTile label="SLG" value={fmtRate(bt.slg)} />
                    <StatTile label="OPS" value={fmtRate(bt.ops)} />
                  </Box>
                  <DetailGrid items={[['G', bt.g], ['AB', bt.ab], ['R', bt.r], ['H', bt.h], ['2B', bt.doubles], ['3B', bt.triples], ['HR', bt.hr], ['RBI', bt.rbi], ['BB', bt.bb], ['SO', bt.so], ['SB', bt.sb]]} />
                </Box>
              )}

              {hasPitching && (
                <Box sx={{ mb: 3 }}>
                  <Typography sx={sectionSx}>Pitching</Typography>
                  <Box sx={{ display: 'flex', gap: 2 }}>
                    <StatTile label="ERA" value={fmtTwo(pt.era)} />
                    <StatTile label="WHIP" value={fmtTwo(pt.whip)} />
                    <StatTile label="W-L" value={`${pt.w}-${pt.l}`} />
                    {pt.s > 0 && <StatTile label="SV" value={String(pt.s)} />}
                  </Box>
                  <DetailGrid items={[['G', pt.g], ['IP', outsToIp(pt.outs)], ['H', pt.h], ['R', pt.r], ['ER', pt.er], ['BB', pt.bb], ['SO', pt.so], ['HR', pt.hr]]} />
                </Box>
              )}

              {/* Game log */}
              <Typography sx={sectionSx}>Game log</Typography>
              <Box sx={{ overflowX: 'auto' }}>
                <Box sx={{ minWidth: 'max-content', fontVariantNumeric: 'tabular-nums' }}>
                  {hasBatting && batting.map(l => {
                    const o = oppLabel(l.game_id)
                    return (
                      <Box key={l.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.6, borderTop: '1px solid', borderColor: 'divider', fontSize: '0.8rem' }}>
                        <Box sx={{ width: 52, color: 'text.disabled' }}>{o.date}</Box>
                        <Box sx={{ width: 56, fontWeight: 600 }}>{o.text}</Box>
                        <Box sx={{ color: 'text.secondary' }}>{l.h}-for-{l.ab}{l.hr ? `, ${l.hr} HR` : ''}{l.rbi ? `, ${l.rbi} RBI` : ''}{l.bb ? `, ${l.bb} BB` : ''}</Box>
                      </Box>
                    )
                  })}
                  {hasPitching && pitching.map(l => {
                    const o = oppLabel(l.game_id)
                    return (
                      <Box key={l.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.6, borderTop: '1px solid', borderColor: 'divider', fontSize: '0.8rem' }}>
                        <Box sx={{ width: 52, color: 'text.disabled' }}>{o.date}</Box>
                        <Box sx={{ width: 56, fontWeight: 600 }}>{o.text}</Box>
                        <Box sx={{ color: 'text.secondary' }}>{outsToIp(l.outs)} IP, {l.er} ER, {l.so} K, {l.bb} BB{l.decision ? ` (${l.decision})` : ''}</Box>
                      </Box>
                    )
                  })}
                </Box>
              </Box>
            </>
          )}
        </Box>
    </ModalShell>
  )
}

const sectionSx = { fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5, color: 'text.secondary', mb: 1 } as const
