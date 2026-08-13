import { useEffect, useMemo, useState } from 'react'
import { Box, Typography } from '@mui/material'
import type { WpblGame, WpblTeam, WpblPlayer, WpblBattingLine, WpblPitchingLine, WpblGamePlay, WpblVideo } from './types'
import { buildRecap, leagueRecapContext, type GameRecap, type RecapStar } from './derive/recap'
import { fetchWpblGameLines, fetchWpblGamePlays } from './api'
import { SectionCard, TeamBadge, PlayerPortrait, CARD_BORDER } from './ui'
import { GameHighlightCard } from './Highlights'
import { WPBL_ACCENT } from './constants'

const MEDAL = ['🥇', '🥈', '🥉']

// ── Shared bits ─────────────────────────────────────────────────────────────────

function StarRow({ star, medal, name, displayName, teamId, portraitSize = 30, medalSize = 20, onClick }: {
  star: RecapStar; medal: string; name: string; displayName?: string; teamId: string | null; portraitSize?: number; medalSize?: number; onClick?: () => void
}) {
  // `name` is always the full name (the portrait headshot is keyed on it); `displayName`
  // is the optional label to show, e.g. an abbreviated "F. Last" for a narrow column.
  return (
    <Box onClick={onClick}
      sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.6, cursor: onClick ? 'pointer' : 'default',
        '&:hover': onClick ? { '& .starname': { textDecoration: 'underline' } } : undefined }}>
      <Box sx={{ fontSize: medalSize * 0.05 + 'rem', width: medalSize, textAlign: 'center', flexShrink: 0 }}>{medal}</Box>
      <PlayerPortrait name={name} teamId={teamId} size={portraitSize} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography className="starname" noWrap sx={{ fontSize: '0.85rem', fontWeight: 700 }}>{displayName ?? name}</Typography>
        <Typography noWrap sx={{ fontSize: '0.72rem', color: 'text.secondary' }}>{star.statline}</Typography>
      </Box>
    </Box>
  )
}

// ── Full recap (GameDetail "Recap" tab) ──────────────────────────────────────────

export function GameRecapView({ game, teams, batting, pitching, plays, names, games = [], video, onOpenPlayer }: {
  game: WpblGame
  teams: Map<string, WpblTeam>
  batting: WpblBattingLine[]
  pitching: WpblPitchingLine[]
  plays: WpblGamePlay[]
  names: Map<string, WpblPlayer>
  games?: WpblGame[]   // full schedule, so the recap verbs calibrate to the league's run environment
  video?: WpblVideo | null   // the league's matched YouTube highlight for this game, if published
  onOpenPlayer?: (p: WpblPlayer) => void
}) {
  const nameOf = useMemo(() => (id: string) => names.get(id)?.name ?? '—', [names])
  const ctx = useMemo(() => leagueRecapContext(games), [games])
  const recap = useMemo(() => buildRecap(game, teams, batting, pitching, plays, nameOf, ctx),
    [game, teams, batting, pitching, plays, nameOf, ctx])
  if (!recap) return null

  return (
    <Box sx={{ px: 2, pb: 2, pt: 0.5, display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box>
        <Typography sx={{ fontSize: '1.15rem', fontWeight: 700, lineHeight: 1.2 }}>{recap.headline}</Typography>
        <Typography sx={{ fontSize: '0.9rem', color: 'text.secondary', mt: 0.75, lineHeight: 1.35 }}>{recap.blurb}</Typography>
      </Box>

      {recap.feats.length > 0 && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
          {recap.feats.map((f, i) => (
            <Box key={i} sx={{ px: 1, py: 0.4, borderRadius: 999, border: '1px solid', borderColor: CARD_BORDER,
              fontSize: '0.72rem', fontWeight: 600, bgcolor: 'action.hover' }}>{f}</Box>
          ))}
        </Box>
      )}

      {recap.stars.length > 0 && (
        <Box>
          <Typography sx={{ fontSize: '0.63rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.6, color: 'text.disabled', mb: 0.25 }}>Stars of the game</Typography>
          {/* One row of three, sized to content: each star takes only the width its name/stats
              need, so a short name gives its slack to a longer one instead of every cell being a
              rigid third. nowrap keeps them on a single line; minWidth 0 on each lets a cell
              ellipsize only as a last resort if the three together overrun the width. */}
          <Box sx={{ display: 'flex', flexWrap: 'nowrap', gap: 2.5 }}>
            {recap.stars.map((s, i) => {
              const p = names.get(s.playerId)
              return (
                <Box key={s.playerId} sx={{ minWidth: 0 }}>
                  <StarRow star={s} medal={MEDAL[i] ?? '⭐'} name={s.name} teamId={s.teamId}
                    onClick={p && onOpenPlayer ? () => onOpenPlayer(p) : undefined} />
                </Box>
              )
            })}
          </Box>
        </Box>
      )}

      {recap.decisions.length > 0 && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
          {recap.decisions.map(d => (
            <Box key={d.key}>
              <Typography component="span" sx={{ fontSize: '0.72rem', fontWeight: 800, color: d.key === 'L' ? 'text.disabled' : WPBL_ACCENT }}>{d.key}</Typography>
              <Typography component="span" sx={{ fontSize: '0.78rem', fontWeight: 600, ml: 0.5 }}>{d.name}</Typography>
              <Typography component="span" sx={{ fontSize: '0.72rem', color: 'text.secondary', ml: 0.5 }}>{d.statline}</Typography>
            </Box>
          ))}
        </Box>
      )}

      {/* League's YouTube highlight for this game, when one has been published. */}
      {video && <GameHighlightCard video={video} />}
    </Box>
  )
}

// ── Compact last-game card (Home) — self-fetches the latest final's box + plays ────

function latestFinal(games: WpblGame[]): WpblGame | null {
  const finals = games.filter(g => g.status === 'final' && g.home_score != null && g.away_score != null && g.home_score !== g.away_score)
  if (finals.length === 0) return null
  return finals.sort((a, b) => a.game_date !== b.game_date ? (a.game_date < b.game_date ? 1 : -1)
    : (b.start_time ?? '').localeCompare(a.start_time ?? ''))[0]
}

export function LastGameCard({ games, teams, players, onOpenGame }: {
  games: WpblGame[]
  teams: Map<string, WpblTeam>
  players: WpblPlayer[]
  onOpenGame: (g: WpblGame) => void
}) {
  const game = useMemo(() => latestFinal(games), [games])
  const [data, setData] = useState<{ batting: WpblBattingLine[]; pitching: WpblPitchingLine[]; plays: WpblGamePlay[] } | null>(null)

  useEffect(() => {
    if (!game) { setData(null); return }
    let cancelled = false
    Promise.all([fetchWpblGameLines(game.id), fetchWpblGamePlays(game.id)])
      .then(([l, pl]) => { if (!cancelled) setData({ batting: l.batting, pitching: l.pitching, plays: pl }) })
      .catch(() => { /* keep last-good; card falls back to line-score-only recap */ })
    return () => { cancelled = true }
  }, [game?.id])

  const nameOf = useMemo(() => {
    const byId = new Map(players.map(p => [p.id, p.name]))
    return (id: string) => byId.get(id) ?? '—'
  }, [players])

  const ctx = useMemo(() => leagueRecapContext(games), [games])
  const recap = useMemo(() => game ? buildRecap(game, teams, data?.batting ?? [], data?.pitching ?? [], data?.plays ?? [], nameOf, ctx) : null,
    [game, teams, data, nameOf, ctx])

  if (!game || !recap) return null
  const away = teams.get(game.away_team_id), home = teams.get(game.home_team_id)
  const dateLabel = new Date(`${game.game_date}T00:00:00`).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })

  const scoreRow = (team: WpblTeam | undefined, score: number | null, won: boolean) => team && (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <TeamBadge team={team} size={26} />
      <Typography sx={{ flex: 1, fontSize: '0.9rem', fontWeight: won ? 800 : 600, color: won ? 'text.primary' : 'text.secondary' }}>{team.name}</Typography>
      <Typography sx={{ fontSize: '1rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: won ? 'text.primary' : 'text.secondary' }}>{score}</Typography>
    </Box>
  )

  return (
    <SectionCard
      title="Last Game"
      subtitle={dateLabel}
      action={
        <Typography onClick={() => onOpenGame(game)} sx={{ fontSize: '0.72rem', fontWeight: 700, color: WPBL_ACCENT, cursor: 'pointer', flexShrink: 0, '&:hover': { textDecoration: 'underline' } }}>
          Full recap
        </Typography>
      }
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mb: 1 }}>
        {scoreRow(away, game.away_score, recap.winner.id === away?.id)}
        {scoreRow(home, game.home_score, recap.winner.id === home?.id)}
      </Box>
      <Typography sx={{ fontSize: '0.95rem', fontWeight: 700, lineHeight: 1.2 }}>{recap.headline}</Typography>
      <Typography sx={{ fontSize: '0.8rem', color: 'text.secondary', mt: 0.5, lineHeight: 1.35 }}>{recap.blurb}</Typography>
      {recap.stars[0] && (
        <Box sx={{ mt: 1, pt: 1, borderTop: '1px solid', borderColor: 'divider' }}>
          <StarRow star={recap.stars[0]} medal="🥇" name={recap.stars[0].name} teamId={recap.stars[0].teamId} portraitSize={44} medalSize={30} onClick={() => onOpenGame(game)} />
        </Box>
      )}
    </SectionCard>
  )
}
