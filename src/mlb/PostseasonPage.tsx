import { useEffect, useState } from 'react'
import { Box, Skeleton, Typography } from '@mui/material'
import { ChevronRight } from '@mui/icons-material'
import StandalonePage from '../ui/StandalonePage'
import { CARD_BORDER, ICON_SIZE, TYPE_SCALE } from '../ui/card'
import { InfoDot } from '../ui/InfoDot'
import { NameText } from '../ui/NameText'
import { FOCUS_RING, hoverOnly, linkPress } from '../ui/interaction'
import { chromePx } from '../ui/scale'
import { navigate } from '../nav'
import { CURRENT_SEASON, TEAM_ABBR, TEAM_NICKNAME } from './constants'
import { SectionLabel } from './components/boxScore'
import { TeamLogo } from './components/TeamLogo'
import { LINK_SX, playerLink } from './lib/links'
import { championPath, fetchBracket, postseasonLikelyOver, seededBracket, seriesName } from './postseason'
import type { Bracket, SeriesId } from './postseason'
import { fetchPostseasonBoards } from './postseasonLeaders'
import type { PostseasonBoard } from './postseasonLeaders'
import { MLB_BASE, mlbGamePath, mlbPlayerPath, mlbPostseasonSeasonFromPath, mlbSeriesPath, mlbTeamPath } from './routes'
import { seatNextSeriesOverPage } from './state/sheetHistory'
import { ChampionCard, ChampionCardSkeleton } from './views/ChampionCard'
import { PlayoffBracketCard } from './views/PlayoffBracket'
import { TopPerformers } from './views/TopPerformers'

// ─── One October ──────────────────────────────────────────────────────────────
//
// What Home's winter cards link to. Home can give a finished postseason one line and one card, and
// the answers to "who won, how did they get there, who carried it" had no address of their own.
//
// Outside the section (see routes.ts), so a player, a club, a series or a game is a link that leaves
// for its address. A sheet opened here would move the address onto what it shows, the shell would
// draw the section for that address, and this page would unmount under its own sheet.

const toPlayer = (id: number) => navigate(mlbPlayerPath({ id }))
const toTeam = (id: number) => navigate(mlbTeamPath(id))
const toGame = (gamePk: number) => navigate(mlbGamePath(gamePk))
const toSeries = (season: number, id: SeriesId) => {
  seatNextSeriesOverPage()
  navigate(mlbSeriesPath(season, id))
}

const CARD = { border: '1px solid', borderColor: CARD_BORDER, borderRadius: 2.5, bgcolor: 'background.paper', p: 1.75, minWidth: 0 } as const
const ROW_H = chromePx(36)

function PathCard({ bracket }: { bracket: Bracket }) {
  const steps = championPath(bracket)
  return (
    <Box sx={CARD}>
      <SectionLabel>Path to the title</SectionLabel>
      <Box sx={{ mt: 0.75 }}>
        {steps.map(({ series: s, opp, wins, losses }) => (
          <Box key={s.id} {...linkPress(mlbSeriesPath(bracket.season, s.id), () => toSeries(bracket.season, s.id))} sx={{
            ...LINK_SX, display: 'flex', alignItems: 'center', gap: 1, minHeight: ROW_H,
            borderTop: '1px solid', borderColor: 'divider', cursor: 'pointer',
            ...hoverOnly({ bgcolor: 'action.hover' }), ...FOCUS_RING,
          }}>
            <Typography sx={{ width: '5.5rem', flexShrink: 0, fontSize: TYPE_SCALE.meta, fontWeight: 700, color: 'text.secondary' }}>
              {s.round === 'wc' ? 'Wild Card' : seriesName(s)}
            </Typography>
            <TeamLogo teamId={opp.id} abbr={opp.abbr} size={20} decorative />
            <Typography sx={{ flex: 1, minWidth: 0, fontSize: TYPE_SCALE.body, fontWeight: 700 }}>
              {TEAM_NICKNAME[opp.id] ?? opp.abbr}
            </Typography>
            <Typography sx={{ fontSize: TYPE_SCALE.body, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{wins}–{losses}</Typography>
            <ChevronRight sx={{ fontSize: ICON_SIZE.md, color: 'text.disabled' }} />
          </Box>
        ))}
      </Box>
    </Box>
  )
}

function PathCardSkeleton() {
  return (
    <Box aria-hidden sx={CARD}>
      <SectionLabel>Path to the title</SectionLabel>
      <Box sx={{ mt: 0.75 }}>
        {[0, 1, 2].map(i => (
          <Box key={i} sx={{ display: 'flex', alignItems: 'center', minHeight: ROW_H, borderTop: '1px solid', borderColor: 'divider' }}>
            <Typography sx={{ flex: 1, fontSize: TYPE_SCALE.body }}><Skeleton /></Typography>
          </Box>
        ))}
      </Box>
    </Box>
  )
}

const LEADER_ROWS = [0, 1, 2, 3, 4]

function BoardCard({ board, label, info }: { board: PostseasonBoard | null; label: string; info?: string }) {
  return (
    <Box sx={CARD}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minHeight: ICON_SIZE.md }}>
        <SectionLabel>{label}</SectionLabel>
        {info && <InfoDot text={info} label={`${label} minimum`} />}
      </Box>
      <Box sx={{ mt: 0.5 }}>
        {LEADER_ROWS.map(i => {
          const row = board?.rows[i]
          return (
            <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minHeight: chromePx(30), borderTop: '1px solid', borderColor: 'divider' }}>
              {row ? (
                <>
                  <TeamLogo teamId={row.teamId} abbr={TEAM_ABBR[row.teamId] ?? ''} size={16} decorative />
                  <NameText name={row.name} linkProps={playerLink(row.id, row.name, toPlayer)} sx={{
                    ...LINK_SX, flex: 1, minWidth: 0, fontSize: TYPE_SCALE.meta, fontWeight: 700,
                    ...hoverOnly({ textDecoration: 'underline' }), ...FOCUS_RING,
                  }} />
                  <Typography sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{row.value}</Typography>
                </>
              ) : !board && <Typography sx={{ flex: 1, fontSize: TYPE_SCALE.meta }}><Skeleton /></Typography>}
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}

// The boards' names and minimums need no data, so the page draws them before the read returns.
const BOARD_SLOTS: { key: string; label: string }[] = [
  { key: 'hr', label: 'HR' }, { key: 'rbi', label: 'RBI' }, { key: 'avg', label: 'AVG' },
  { key: 'k', label: 'K' }, { key: 'era', label: 'ERA' }, { key: 'sv', label: 'SV' },
]

export default function MlbPostseasonPage({ path }: { path: string }) {
  const season = mlbPostseasonSeasonFromPath(path) ?? CURRENT_SEASON
  // Keyed on the season as well as held in state, so stepping from one recap to another never draws
  // the last one's champion under the new title.
  const [read, setRead] = useState<{ season: number; bracket: Bracket | null; loaded: boolean }>(
    () => ({ season, bracket: seededBracket(season), loaded: false }))
  const [boards, setBoards] = useState<{ season: number; list: PostseasonBoard[] | null } | null>(null)

  useEffect(() => {
    let alive = true
    fetchBracket(season).then(b => { if (alive) setRead({ season, bracket: b, loaded: true }) })
    fetchPostseasonBoards(season).then(list => { if (alive) setBoards({ season, list }) })
    return () => { alive = false }
  }, [season])

  const current = read.season === season ? read : { season, bracket: null, loaded: false }
  const { bracket, loaded } = current
  const list = boards?.season === season ? boards.list : undefined
  const over = bracket ? bracket.over : !loaded && postseasonLikelyOver(season, CURRENT_SEASON)
  const missing = loaded && !bracket

  return (
    <StandalonePage title={`${season} Postseason`} back={{ href: MLB_BASE, label: 'MLB' }} maxWidth={chromePx(1180)}>
      {missing ? (
        <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.secondary' }}>No data</Typography>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {over && (bracket
            ? <ChampionCard bracket={bracket} linkLabel="Series" onTeamClick={toTeam} onPlayerClick={toPlayer}
                linkProps={linkPress(mlbSeriesPath(season, 'W_1'), () => toSeries(season, 'W_1'))} />
            : <ChampionCardSkeleton season={season} />)}
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: over ? 'repeat(2, minmax(0, 1fr))' : 'minmax(0, 1fr)' }, gap: 2 }}>
            {over && (bracket ? <PathCard bracket={bracket} /> : <PathCardSkeleton />)}
            <TopPerformers worldSeriesOf={season} onPlayerClick={toPlayer} onTeamClick={toTeam} onOpenGame={toGame} />
          </Box>
          <PlayoffBracketCard season={season} title="Bracket" noChampionLine onOpenSeries={id => toSeries(season, id)} />
          {list !== null && (
            <Box>
              <Box sx={{ mb: 1 }}><SectionLabel>Leaders</SectionLabel></Box>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(3, minmax(0, 1fr))' }, gap: 1 }}>
                {BOARD_SLOTS.map(({ key, label }) => {
                  const board = list?.find(b => b.key === key) ?? null
                  return <BoardCard key={key} board={board} label={label} info={board?.info} />
                })}
              </Box>
            </Box>
          )}
        </Box>
      )}
    </StandalonePage>
  )
}
