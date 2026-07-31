import { useEffect, useMemo, useState } from 'react'
import { Box, Typography, CircularProgress } from '@mui/material'
import { fetchWpblRoster, fetchWpblGameLines } from './api'
import { wpblAccent, wpblFullName, outsToIp, WPBL_ACCENT, formatGameTime } from './constants'
import { ModalShell, TeamBadge, useWpblDark } from './ui'
import type { WpblTeam, WpblGame, WpblPlayer, WpblBattingLine, WpblPitchingLine } from './types'

// Read-only box score / game detail (Phase 1b). Public — anyone can open a game to see
// the entered lines. For a final game with no lines yet, shows a friendly empty state;
// for an unplayed game, shows the matchup + time. Admin gets an "Edit result" shortcut.

const BAT_COLS: { key: keyof WpblBattingLine; label: string }[] = [
  { key: 'ab', label: 'AB' }, { key: 'r', label: 'R' }, { key: 'h', label: 'H' },
  { key: 'hr', label: 'HR' }, { key: 'rbi', label: 'RBI' }, { key: 'bb', label: 'BB' },
  { key: 'so', label: 'SO' }, { key: 'sb', label: 'SB' },
]
const PIT_COLS: { key: keyof WpblPitchingLine; label: string }[] = [
  { key: 'h', label: 'H' }, { key: 'r', label: 'R' }, { key: 'er', label: 'ER' },
  { key: 'bb', label: 'BB' }, { key: 'so', label: 'SO' }, { key: 'hr', label: 'HR' },
]

function TeamBox({ team, batting, pitching, names }: {
  team: WpblTeam
  batting: WpblBattingLine[]
  pitching: WpblPitchingLine[]
  names: Map<string, WpblPlayer>
}) {
  const isDark = useWpblDark()
  const color = wpblAccent(team.id, isDark)
  const totals = batting.reduce((t, b) => {
    for (const c of BAT_COLS) (t as any)[c.key] = ((t as any)[c.key] ?? 0) + (b[c.key] as number)
    return t
  }, {} as Record<string, number>)

  if (batting.length === 0 && pitching.length === 0) return null

  return (
    <Box sx={{ mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <TeamBadge team={team} size={24} />
        <Typography sx={{ fontSize: '0.95rem', fontWeight: 800 }}>{wpblFullName(team)}</Typography>
      </Box>

      {batting.length > 0 && (
        <Box sx={{ overflowX: 'auto', mb: 1.5 }}>
          <Box sx={{ minWidth: 'max-content', fontVariantNumeric: 'tabular-nums' }}>
            <Box sx={{ display: 'flex', ...rowSx, ...headSx }}>
              <Box sx={{ ...nameColSx }}>Batting</Box>
              {BAT_COLS.map(c => <Box key={c.key as string} sx={statColSx}>{c.label}</Box>)}
            </Box>
            {batting.map(b => (
              <Box key={b.id} sx={{ display: 'flex', ...rowSx, borderTop: '1px solid', borderColor: 'divider' }}>
                <Box sx={{ ...nameColSx, fontWeight: 600 }}>
                  {names.get(b.player_id)?.name ?? '—'}
                  {b.position ? <Box component="span" sx={{ color: 'text.disabled', fontWeight: 500 }}> {b.position}</Box> : null}
                </Box>
                {BAT_COLS.map(c => <Box key={c.key as string} sx={statColSx}>{b[c.key] as number}</Box>)}
              </Box>
            ))}
            <Box sx={{ display: 'flex', ...rowSx, borderTop: '2px solid', borderColor: color, fontWeight: 800 }}>
              <Box sx={{ ...nameColSx, color: 'text.secondary' }}>Totals</Box>
              {BAT_COLS.map(c => <Box key={c.key as string} sx={statColSx}>{totals[c.key as string] ?? 0}</Box>)}
            </Box>
          </Box>
        </Box>
      )}

      {pitching.length > 0 && (
        <Box sx={{ overflowX: 'auto' }}>
          <Box sx={{ minWidth: 'max-content', fontVariantNumeric: 'tabular-nums' }}>
            <Box sx={{ display: 'flex', ...rowSx, ...headSx }}>
              <Box sx={{ ...nameColSx }}>Pitching</Box>
              <Box sx={statColSx}>IP</Box>
              {PIT_COLS.map(c => <Box key={c.key as string} sx={statColSx}>{c.label}</Box>)}
            </Box>
            {pitching.map(p => (
              <Box key={p.id} sx={{ display: 'flex', ...rowSx, borderTop: '1px solid', borderColor: 'divider' }}>
                <Box sx={{ ...nameColSx, fontWeight: 600 }}>
                  {names.get(p.player_id)?.name ?? '—'}
                  {p.decision ? <Box component="span" sx={{ color, fontWeight: 800 }}> ({p.decision})</Box> : null}
                </Box>
                <Box sx={statColSx}>{outsToIp(p.outs)}</Box>
                {PIT_COLS.map(c => <Box key={c.key as string} sx={statColSx}>{p[c.key] as number}</Box>)}
              </Box>
            ))}
          </Box>
        </Box>
      )}
    </Box>
  )
}

export default function GameDetailModal({ game, teams, onClose, onEdit }: {
  game: WpblGame
  teams: WpblTeam[]
  onClose: () => void
  onEdit?: (g: WpblGame) => void
}) {
  const byId = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])
  const home = byId.get(game.home_team_id)
  const away = byId.get(game.away_team_id)

  const [loading, setLoading] = useState(true)
  const [lines, setLines] = useState<{ batting: WpblBattingLine[]; pitching: WpblPitchingLine[] }>({ batting: [], pitching: [] })
  const [names, setNames] = useState<Map<string, WpblPlayer>>(new Map())

  useEffect(() => {
    let cancelled = false
    Promise.all([
      away ? fetchWpblRoster(away.id) : Promise.resolve([]),
      home ? fetchWpblRoster(home.id) : Promise.resolve([]),
      fetchWpblGameLines(game.id),
    ]).then(([a, h, l]) => {
      if (cancelled) return
      setNames(new Map([...a, ...h].map(p => [p.id, p])))
      setLines(l)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [game.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const final = game.status === 'final' && game.home_score != null && game.away_score != null
  const hasLines = lines.batting.length > 0 || lines.pitching.length > 0
  const awayWon = final && (game.away_score ?? 0) > (game.home_score ?? 0)
  const homeWon = final && (game.home_score ?? 0) > (game.away_score ?? 0)
  const dateLabel = new Date(`${game.game_date}T00:00:00`).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })

  const scoreLine = (team: WpblTeam | undefined, score: number | null, won: boolean) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      {team && <TeamBadge team={team} size={30} />}
      <Typography sx={{ flex: 1, fontSize: '1rem', fontWeight: won ? 800 : 600 }}>{team ? wpblFullName(team) : ''}</Typography>
      {final && <Typography sx={{ fontSize: '1.25rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: won ? 'text.primary' : 'text.secondary' }}>{score}</Typography>}
    </Box>
  )

  return (
    <ModalShell
      eyebrow={final ? `Final${game.innings && game.innings !== 7 ? ` / ${game.innings}` : ''}` : `${dateLabel}${game.start_time ? ` · ${formatGameTime(game.game_date, game.start_time)}` : ''}`}
      onClose={onClose}
      maxWidth={720}
      actions={onEdit
        ? <Box onClick={() => onEdit(game)} sx={{ cursor: 'pointer', fontSize: '0.72rem', fontWeight: 800, color: WPBL_ACCENT, mr: 0.5, '&:hover': { textDecoration: 'underline' } }}>Edit result</Box>
        : undefined}
    >
      {/* Score block */}
      <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          {scoreLine(away, game.away_score, awayWon)}
          {scoreLine(home, game.home_score, homeWon)}
        </Box>
        {game.venue && <Typography sx={{ fontSize: '0.72rem', color: 'text.disabled', mt: 1 }}>{game.venue}</Typography>}
      </Box>

      {/* Box score */}
      <Box sx={{ p: 2 }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
        ) : hasLines ? (
          <>
            {away && <TeamBox team={away} batting={lines.batting.filter(b => b.team_id === away.id)} pitching={lines.pitching.filter(p => p.team_id === away.id)} names={names} />}
            {home && <TeamBox team={home} batting={lines.batting.filter(b => b.team_id === home.id)} pitching={lines.pitching.filter(p => p.team_id === home.id)} names={names} />}
          </>
        ) : (
          <Box sx={{ textAlign: 'center', py: 5, color: 'text.secondary' }}>
            <Typography sx={{ fontSize: '0.95rem', fontWeight: 700, mb: 0.5 }}>
              {final ? 'Box score not entered yet' : 'This game has not been played yet'}
            </Typography>
            <Typography sx={{ fontSize: '0.82rem', color: 'text.disabled' }}>
              {final ? 'The line score will appear here once it is added.' : 'Check back after first pitch.'}
            </Typography>
          </Box>
        )}
      </Box>
    </ModalShell>
  )
}

const rowSx = { alignItems: 'center', px: 0.5, py: 0.6 } as const
const headSx = { fontSize: '0.62rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.3, color: 'text.disabled' } as const
const nameColSx = { minWidth: 150, maxWidth: 200, fontSize: '0.82rem', pr: 1 } as const
const statColSx = { width: 40, textAlign: 'center', fontSize: '0.82rem', flexShrink: 0 } as const
