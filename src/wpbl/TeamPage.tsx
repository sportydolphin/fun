import { useEffect, useMemo, useState } from 'react'
import { Box, Typography, CircularProgress } from '@mui/material'
import { fetchWpblRoster, fetchWpblAllLines, computeStandings } from './api'
import { wpblAccent, wpblFullName, formatGameTime, positionRank } from './constants'
import { SectionCard, SectionLabel, TeamBadge, PlayerPortrait, useWpblDark, CARD_BORDER } from './ui'
import {
  aggregateBatting, aggregatePitching, sumBatting, sumPitching, fmtRate, fmtTwo,
  type WpblBattingTotals, type WpblPitchingTotals,
} from './stats'
import { outsToIp } from './constants'
import type { WpblTeam, WpblPlayer, WpblGame, WpblBattingLine, WpblPitchingLine } from './types'

// A team's page: header + record, results, season batting/pitching totals, top hitters /
// pitchers, and a roster with inline stats. Replaces the plain roster list the Teams tab
// used to show. Self-contained — fetches its own roster + box-score lines (league-wide,
// then filtered to this team; cheap for a four-team league) and derives everything.

// Pitcher position codes: P, SP, RP, and the handed variants RHP / LHP. No fielding
// position ends in "P", so a trailing P is a reliable pitcher marker.
const isPitcherPos = (pos: string | null | undefined) => /P$/i.test((pos ?? '').trim())

// A compact row of centered stat tiles (value over a small caps label).
function StatTiles({ items }: { items: { label: string; value: string }[] }) {
  return (
    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
      {items.map(it => (
        <Box key={it.label} sx={{ flex: '1 1 0', minWidth: 54, textAlign: 'center' }}>
          <Typography sx={{ fontSize: '1.05rem', fontWeight: 800, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>{it.value}</Typography>
          <Typography sx={{ fontSize: '0.56rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'text.disabled' }}>{it.label}</Typography>
        </Box>
      ))}
    </Box>
  )
}

// One "top N by stat" mini-list within the leaders card.
function LeaderList({ label, rows, accent, onOpenPlayer }: {
  label: string
  rows: { player: WpblPlayer; value: string }[]
  accent: string
  onOpenPlayer: (p: WpblPlayer) => void
}) {
  if (rows.length === 0) return null
  return (
    <Box sx={{ mb: 1.25, '&:last-of-type': { mb: 0 } }}>
      <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.8, color: 'text.disabled', mb: 0.4 }}>{label}</Typography>
      {rows.map((r, i) => (
        <Box key={r.player.id} onClick={() => onOpenPlayer(r.player)} sx={{
          display: 'flex', alignItems: 'center', gap: 0.75, py: 0.4, cursor: 'pointer',
          borderRadius: 1, '&:hover': { bgcolor: 'action.hover' },
        }}>
          <Typography sx={{ width: 14, fontSize: '0.7rem', fontWeight: 800, color: i === 0 ? accent : 'text.disabled' }}>{i + 1}</Typography>
          <PlayerPortrait name={r.player.name} teamId={r.player.team_id} size={20} />
          <Typography sx={{ flex: 1, fontSize: '0.82rem', fontWeight: i === 0 ? 700 : 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.player.name}</Typography>
          <Typography sx={{ fontSize: '0.82rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums', minWidth: 40, textAlign: 'right' }}>{r.value}</Typography>
        </Box>
      ))}
    </Box>
  )
}

export default function TeamPage({ team, teams, games, onBack, onOpenGame, onOpenPlayer }: {
  team: WpblTeam
  teams: WpblTeam[]
  games: WpblGame[]
  onBack: () => void
  onOpenGame: (g: WpblGame) => void
  onOpenPlayer: (p: WpblPlayer) => void
}) {
  const isDark = useWpblDark()
  const accent = wpblAccent(team.id, isDark)
  const teamById = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])

  const [roster, setRoster] = useState<WpblPlayer[] | null>(null)
  const [lines, setLines] = useState<{ batting: WpblBattingLine[]; pitching: WpblPitchingLine[] } | null>(null)

  useEffect(() => {
    let cancelled = false
    setRoster(null); setLines(null)
    Promise.all([fetchWpblRoster(team.id), fetchWpblAllLines()]).then(([r, l]) => {
      if (cancelled) return
      setRoster([...r].sort((a, b) => positionRank(a.position) - positionRank(b.position) || a.name.localeCompare(b.name)))
      setLines({
        batting: l.batting.filter(x => x.team_id === team.id),
        pitching: l.pitching.filter(x => x.team_id === team.id),
      })
    })
    return () => { cancelled = true }
  }, [team.id])

  // Record + standing from the shared derivation.
  const standing = useMemo(() => {
    const rows = computeStandings(teams, games)
    const i = rows.findIndex(r => r.team.id === team.id)
    return i === -1 ? null : { row: rows[i], rank: i + 1 }
  }, [teams, games, team.id])

  // This team's games, chronological (date then start time).
  const schedule = useMemo(() => {
    const startMin = (t: string | null) => {
      const m = /^(\d{1,2}):(\d{2})\s*(am|pm)$/i.exec((t ?? '').trim())
      if (!m) return 0
      let h = Number(m[1]) % 12; if (/pm/i.test(m[3])) h += 12
      return h * 60 + Number(m[2])
    }
    return games
      .filter(g => g.home_team_id === team.id || g.away_team_id === team.id)
      .sort((a, b) => a.game_date !== b.game_date ? (a.game_date < b.game_date ? -1 : 1) : startMin(a.start_time) - startMin(b.start_time))
  }, [games, team.id])

  const batSeasons = useMemo(() => lines ? aggregateBatting(roster ?? [], lines.batting) : [], [roster, lines])
  const pitSeasons = useMemo(() => lines ? aggregatePitching(roster ?? [], lines.pitching) : [], [roster, lines])
  const teamBat = useMemo(() => lines ? sumBatting(lines.batting) : null, [lines])
  const teamPit = useMemo(() => lines ? sumPitching(lines.pitching) : null, [lines])

  const batByPid = useMemo(() => new Map(batSeasons.map(s => [s.player.id, s.totals])), [batSeasons])
  const pitByPid = useMemo(() => new Map(pitSeasons.map(s => [s.player.id, s.totals])), [pitSeasons])

  const top = <T,>(list: { player: WpblPlayer; totals: T }[], val: (t: T) => number | null, disp: (t: T) => string, tie: (t: T) => number, n = 3) =>
    list.filter(x => val(x.totals) != null)
      .sort((a, b) => (val(b.totals) as number) - (val(a.totals) as number) || tie(b.totals) - tie(a.totals))
      .slice(0, n)
      .map(x => ({ player: x.player, value: disp(x.totals) }))

  const hitLeaders = useMemo(() => [
    { label: 'OPS', rows: top(batSeasons, t => t.ab > 0 ? t.ops : null, t => fmtRate(t.ops), t => t.ab) },
    { label: 'Home runs', rows: top(batSeasons, t => t.hr > 0 ? t.hr : null, t => String(t.hr), t => t.ab) },
    { label: 'RBI', rows: top(batSeasons, t => t.rbi > 0 ? t.rbi : null, t => String(t.rbi), t => t.ab) },
  ], [batSeasons])
  const pitLeaders = useMemo(() => [
    { label: 'ERA', rows: top(pitSeasons, t => t.era != null && t.outs > 0 ? -t.era : null, t => fmtTwo(t.era), t => t.outs) },
    { label: 'Strikeouts', rows: top(pitSeasons, t => t.so > 0 ? t.so : null, t => String(t.so), t => t.outs) },
  ], [pitSeasons])

  const loading = roster == null || lines == null
  const played = schedule.some(g => g.status === 'final')
  const recordText = standing
    ? `${standing.row.wins}–${standing.row.losses}${played ? `  ·  ${ordinal(standing.rank)} place` : ''}`
    : 'Inaugural season'

  return (
    <Box>
      {/* Header */}
      <Box onClick={onBack} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, mb: 2, cursor: 'pointer', color: 'text.secondary', fontSize: '0.85rem', fontWeight: 600, '&:hover': { color: 'text.primary' } }}>
        ← All teams
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
        <TeamBadge team={team} size={52} />
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: '1.25rem', fontWeight: 900, lineHeight: 1.1 }}>{wpblFullName(team)}</Typography>
          <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>{recordText}</Typography>
        </Box>
      </Box>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {/* Results */}
          <SectionCard title="Results" subtitle={`${schedule.length} games`}>
            <Box sx={{ display: 'flex', flexDirection: 'column' }}>
              {schedule.map(g => {
                const home = g.home_team_id === team.id
                const opp = teamById.get(home ? g.away_team_id : g.home_team_id)
                const us = home ? g.home_score : g.away_score
                const them = home ? g.away_score : g.home_score
                const final = g.status === 'final' && us != null && them != null
                const live = g.status === 'live'
                const win = final && (us as number) > (them as number)
                const loss = final && (us as number) < (them as number)
                return (
                  <Box key={g.id} onClick={() => onOpenGame(g)} sx={{
                    display: 'flex', alignItems: 'center', gap: 1, py: 0.85, cursor: 'pointer',
                    borderTop: '1px solid', borderColor: 'divider', '&:first-of-type': { borderTop: 'none' },
                    borderRadius: 1, '&:hover': { bgcolor: 'action.hover' },
                  }}>
                    <Typography sx={{ width: 46, fontSize: '0.7rem', fontWeight: 700, color: 'text.disabled', flexShrink: 0 }}>
                      {new Date(`${g.game_date}T00:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                    </Typography>
                    <Typography sx={{ fontSize: '0.7rem', color: 'text.disabled', width: 16, flexShrink: 0 }}>{home ? 'vs' : '@'}</Typography>
                    {opp && <TeamBadge team={opp} size={22} />}
                    <Typography sx={{ flex: 1, fontSize: '0.85rem', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {opp ? opp.name : '—'}
                    </Typography>
                    {final ? (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexShrink: 0 }}>
                        <Typography sx={{ fontSize: '0.7rem', fontWeight: 800, width: 14, textAlign: 'center', color: win ? 'success.main' : loss ? 'error.main' : 'text.secondary' }}>
                          {win ? 'W' : loss ? 'L' : 'T'}
                        </Typography>
                        <Typography sx={{ fontSize: '0.85rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{us}–{them}</Typography>
                      </Box>
                    ) : (
                      <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: live ? '#ef4444' : 'text.secondary', flexShrink: 0 }}>
                        {live ? '● Live' : formatGameTime(g.game_date, g.start_time) || 'TBD'}
                      </Typography>
                    )}
                  </Box>
                )
              })}
              {schedule.length === 0 && <Typography sx={{ fontSize: '0.82rem', color: 'text.disabled', py: 1 }}>No games scheduled.</Typography>}
            </Box>
          </SectionCard>

          {/* Team season totals */}
          <SectionCard title="Team stats" subtitle="Season totals">
            {teamBat && teamBat.g > 0 ? (
              <>
                <SectionLabel>Batting</SectionLabel>
                <StatTiles items={[
                  { label: 'AVG', value: fmtRate(teamBat.avg) },
                  { label: 'OBP', value: fmtRate(teamBat.obp) },
                  { label: 'SLG', value: fmtRate(teamBat.slg) },
                  { label: 'OPS', value: fmtRate(teamBat.ops) },
                  { label: 'R', value: String(teamBat.r) },
                  { label: 'HR', value: String(teamBat.hr) },
                  { label: 'RBI', value: String(teamBat.rbi) },
                  { label: 'SB', value: String(teamBat.sb) },
                ]} />
                {teamPit && teamPit.g > 0 && (
                  <Box sx={{ mt: 1.75 }}>
                    <SectionLabel>Pitching</SectionLabel>
                    <StatTiles items={[
                      { label: 'ERA', value: fmtTwo(teamPit.era) },
                      { label: 'WHIP', value: fmtTwo(teamPit.whip) },
                      { label: 'W', value: String(teamPit.w) },
                      { label: 'L', value: String(teamPit.l) },
                      { label: 'SO', value: String(teamPit.so) },
                      { label: 'BB', value: String(teamPit.bb) },
                      { label: 'HR', value: String(teamPit.hr) },
                    ]} />
                  </Box>
                )}
              </>
            ) : (
              <Typography sx={{ fontSize: '0.8rem', color: 'text.disabled', py: 1 }}>Team stats appear once games are played.</Typography>
            )}
          </SectionCard>

          {/* Leaders */}
          {(hitLeaders.some(b => b.rows.length) || pitLeaders.some(b => b.rows.length)) && (
            <SectionCard title="Team leaders" subtitle="Season leaders">
              {hitLeaders.map(b => <LeaderList key={b.label} label={b.label} rows={b.rows} accent={accent} onOpenPlayer={onOpenPlayer} />)}
              {pitLeaders.map(b => <LeaderList key={b.label} label={b.label} rows={b.rows} accent={accent} onOpenPlayer={onOpenPlayer} />)}
            </SectionCard>
          )}

          {/* Roster with inline stats */}
          <SectionCard title="Roster" subtitle={`${roster!.length} players`}>
            {roster!.length === 0 ? (
              <Typography sx={{ fontSize: '0.82rem', color: 'text.disabled', py: 1 }}>Roster coming soon.</Typography>
            ) : (
              <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                {roster!.map(p => {
                  const pit = pitByPid.get(p.id)
                  const bat = batByPid.get(p.id)
                  const pitcher = isPitcherPos(p.position) || (pit != null && pit.outs > 0 && (bat == null || bat.ab === 0))
                  const stats = pitcher ? pitcherStats(pit) : batterStats(bat)
                  return (
                    <Box key={p.id} onClick={() => onOpenPlayer(p)} sx={{
                      display: 'flex', alignItems: 'center', gap: 1.25, py: 0.9, cursor: 'pointer',
                      borderTop: '1px solid', borderColor: 'divider', '&:first-of-type': { borderTop: 'none' },
                      borderRadius: 1, '&:hover': { bgcolor: 'action.hover' },
                    }}>
                      <Typography sx={{ width: 26, textAlign: 'center', flexShrink: 0, fontSize: '0.72rem', fontWeight: 800, color: accent }}>
                        {p.position || '—'}
                      </Typography>
                      <PlayerPortrait name={p.name} teamId={p.team_id} size={34} />
                      <Typography sx={{ flex: 1, fontSize: '0.88rem', fontWeight: 600, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</Typography>
                      <Box sx={{ display: 'flex', gap: 1.5, flexShrink: 0 }}>
                        {stats.map(s => (
                          <Box key={s.label} sx={{ textAlign: 'right', minWidth: 34 }}>
                            <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>{s.value}</Typography>
                            <Typography sx={{ fontSize: '0.54rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3, color: 'text.disabled' }}>{s.label}</Typography>
                          </Box>
                        ))}
                      </Box>
                    </Box>
                  )
                })}
              </Box>
            )}
          </SectionCard>
        </Box>
      )}
    </Box>
  )
}

function batterStats(t: WpblBattingTotals | undefined): { label: string; value: string }[] {
  if (!t || t.ab === 0) return [{ label: 'AVG', value: '—' }, { label: 'HR', value: '—' }, { label: 'RBI', value: '—' }]
  return [
    { label: 'AVG', value: fmtRate(t.avg) },
    { label: 'HR', value: String(t.hr) },
    { label: 'RBI', value: String(t.rbi) },
  ]
}
function pitcherStats(t: WpblPitchingTotals | undefined): { label: string; value: string }[] {
  if (!t || t.outs === 0) return [{ label: 'IP', value: '—' }, { label: 'ERA', value: '—' }, { label: 'SO', value: '—' }]
  return [
    { label: 'IP', value: outsToIp(t.outs) },
    { label: 'ERA', value: fmtTwo(t.era) },
    { label: 'SO', value: String(t.so) },
  ]
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0])
}
