// The season page's champion banner and the final series under it. Split out of SeasonPage.tsx.
import { useDark } from '../../ui/useDark'
import { Box, Typography, Skeleton } from '@mui/material'
import { type ChampionResult } from '../derive/bracket'
import { wpblAccent, wpblFullName } from '../constants'
import { TAPPABLE, FOCUS_RING, CARD_BORDER, TeamBadge, TextGhost, chromePx } from '../ui'
import type { WpblTeam, WpblGame } from '../types'
import { typePx } from '../../ui/scale'
import { ICON_SIZE, TYPE_SCALE } from '../../ui/card'
import { isModified } from '../../nav'
import { shortDate } from '../../lib/format'

// ─── Champion ────────────────────────────────────────────────────────────────────
// The inaugural title, at the top of the recap. A gold hero rather than a stat line: the champion
// is the one thing on this page that a stat cannot carry, and the block the reader who came for
// "who won" is looking for. Full width, its own color, and no link, because it is the answer
// rather than a route to one; the games that decided it are the cards directly under it.
export function SeasonChampionBlock({ champ }: {
  /** Null draws the banner empty, for the page's skeleton. */
  champ: ChampionResult | null
}) {
  const isDark = useDark()
  const accent = champ ? wpblAccent(champ.champion.id, isDark) : 'var(--wpbl-medal-1)'
  return (
    <Box sx={{
      borderRadius: 3, overflow: 'hidden',
      border: '1.5px solid', borderColor: 'var(--wpbl-medal-1)',
      backgroundImage: `linear-gradient(120deg, color-mix(in srgb, var(--wpbl-medal-1) 14%, transparent), color-mix(in srgb, ${accent} 12%, transparent))`,
      bgcolor: 'background.paper',
    }}>
      <Box sx={{
        display: 'flex', alignItems: 'center', gap: 0.75, px: 2, py: 0.85,
        bgcolor: 'color-mix(in srgb, var(--wpbl-medal-1) 16%, transparent)',
        borderBottom: '1px solid', borderColor: 'divider',
      }}>
        <Box aria-hidden sx={{ fontSize: ICON_SIZE.sm, lineHeight: 1 }}>🏆</Box>
        <Typography sx={{
          fontSize: TYPE_SCALE.micro, fontWeight: 900, letterSpacing: typePx(1), textTransform: 'uppercase',
          color: 'var(--wpbl-medal-1)',
        }}>WPBL Champions</Typography>
      </Box>
      <Box sx={{ p: { xs: 2, sm: 2.5 }, display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
        {champ
          ? <TeamBadge team={champ.champion} size={56} />
          : <Skeleton variant="circular" width={chromePx(56)} height={chromePx(56)} sx={{ flexShrink: 0 }} />}
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: TYPE_SCALE.page, fontWeight: 900, lineHeight: 1.1, color: accent }}>
            {champ ? wpblFullName(champ.champion) : <TextGhost>Champion Clubname</TextGhost>}
          </Typography>
          <Typography sx={{ fontSize: TYPE_SCALE.title, fontWeight: 700, color: 'text.primary', mt: 0.4 }}>
            Inaugural WPBL champions
          </Typography>
          {(!champ || champ.runnerUp) && (
            <Typography sx={{ fontSize: TYPE_SCALE.body, fontWeight: 500, color: 'text.secondary', mt: 0.25 }}>
              {champ?.runnerUp
                ? <>Beat {wpblFullName(champ.runnerUp)} {champ.champWins}-{champ.rivalWins} in the championship series.</>
                : <TextGhost>Beat Runners-up Clubname 3-2 in the championship series.</TextGhost>}
            </Typography>
          )}
        </Box>
      </Box>
    </Box>
  )
}

// The final, one small card per game, under the banner that names who won it. The banner is the
// result and these are the route into how: each opens that game's full page. Real <a href>s with
// the plain click intercepted, like every game link on this page, so crawlers can follow them.
// A grid that wraps rather than a scrolling rail: five games fit one row on a desktop and wrap to
// two columns on a phone, and none of the five is hidden off the edge.
export function FinalSeriesGames({ games, teamById, href, onOpen }: {
  games: WpblGame[]
  teamById: Map<string, WpblTeam>
  href: (g: WpblGame) => string
  onOpen: (g: WpblGame) => void
}) {
  return (
    <Box sx={{ display: 'grid', gap: 1, mt: 1.25, gridTemplateColumns: 'repeat(auto-fit, minmax(7.5rem, 1fr))' }}>
      {games.map((g, i) => {
        const away = teamById.get(g.away_team_id), home = teamById.get(g.home_team_id)
        const awayWon = g.away_score! > g.home_score!
        const side = (team: WpblTeam | undefined, score: number | null, won: boolean) => (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
            {team && <TeamBadge team={team} size={18} />}
            <Typography sx={{
              flex: 1, minWidth: 0, fontSize: TYPE_SCALE.body, fontWeight: won ? 800 : 600,
              color: won ? 'text.primary' : 'text.secondary',
            }}>{team?.abbr ?? '—'}</Typography>
            <Typography sx={{
              fontSize: TYPE_SCALE.title, fontWeight: won ? 900 : 600, fontVariantNumeric: 'tabular-nums',
              color: won ? 'text.primary' : 'text.secondary',
            }}>{score}</Typography>
          </Box>
        )
        return (
          <Box
            key={g.id}
            component="a"
            href={href(g)}
            aria-label={`Game ${i + 1}: ${away?.city ?? ''} ${g.away_score}, ${home?.city ?? ''} ${g.home_score}`}
            onClick={e => { if (!isModified(e)) { e.preventDefault(); onOpen(g) } }}
            sx={{ ...FINAL_GAME_CARD, textDecoration: 'none', color: 'inherit', ...TAPPABLE, ...FOCUS_RING }}
          >
            <FinalGameHead n={i + 1} date={shortDate(g.game_date)} />
            {side(away, g.away_score, awayWon)}
            {side(home, g.home_score, !awayWon)}
          </Box>
        )
      })}
    </Box>
  )
}

export const FINAL_GAME_CARD = {
  display: 'flex', flexDirection: 'column', gap: 0.5, minWidth: 0,
  borderRadius: 2, px: 1.25, py: 1, border: '1px solid', borderColor: CARD_BORDER,
} as const

export function FinalGameHead({ n, date }: { n: number; date: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5 }}>
      <Typography sx={{
        flex: 1, fontSize: TYPE_SCALE.micro, fontWeight: 800, letterSpacing: typePx(0.6),
        textTransform: 'uppercase', color: 'text.disabled',
      }}>Game {n}</Typography>
      <Typography sx={{ fontSize: TYPE_SCALE.micro, fontWeight: 700, color: 'text.disabled' }}>{date}</Typography>
    </Box>
  )
}
