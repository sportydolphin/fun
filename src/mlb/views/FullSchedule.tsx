import { lazy, Suspense, useState } from 'react'
import { Box, Typography } from '@mui/material'
import ChevronLeft from '@mui/icons-material/ChevronLeft'
import ChevronRight from '@mui/icons-material/ChevronRight'
import { ACCENT_EDGE, ICON_SIZE, TYPE_SCALE } from '../../ui/card'
import { pressable } from '../../ui/interaction'
import { chromePx } from '../../ui/scale'
import { MlbSheet } from '../components/MlbSheet'
import { TeamLogo } from '../components/TeamLogo'
import { TONE } from '../constants'
import { gameLink, LINK_SX } from '../lib/links'
import { calendarCell, gamesInMonth, monthRecord, monthWeeks, openingMonth, scheduleMonths, scheduleGameToPreview, type ScheduleGame } from './scheduleData'

const GamePreviewModal = lazy(() => import('./GamePreview').then(m => ({ default: m.GamePreviewModal })))

// A CLUB'S SEASON AS ONE MONTH AT A TIME. This was WPBL's shape, one row of chips to swipe through,
// which holds a sixty-game season. A hundred and sixty-two games and a postseason is about 170 chips:
// no way to reach June but to swipe past May. A calendar puts a month on one screen on a phone and in
// a desktop's sheet alike, and says where in the week a game falls, which a list of chips did not.

const WEEKDAYS = [['S', 'Sun'], ['M', 'Mon'], ['T', 'Tue'], ['W', 'Wed'], ['T', 'Thu'], ['F', 'Fri'], ['S', 'Sat']]
const COLUMNS = { display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 0.5 } as const

const monthName = (ym: string) => {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long' })
}
const longDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function GameCell({ game, onOpen }: { game: ScheduleGame; onOpen: () => void }) {
  const cell = calendarCell(game)
  return (
    <Box {...gameLink(game.gamePk, onOpen)} aria-label={`${longDate(game.date)}, ${game.isHome ? 'vs' : 'at'} ${game.opponentAbbr}, ${cell.label}`} sx={{
      ...LINK_SX, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.25, cursor: 'pointer', minWidth: 0, width: '100%',
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1px', minWidth: 0 }}>
        {!game.isHome && <Typography component="span" sx={{ fontSize: TYPE_SCALE.caption, fontWeight: 700, color: 'text.secondary', lineHeight: 1 }}>@</Typography>}
        <TeamLogo teamId={game.opponentId} abbr={game.opponentAbbr} size={22} decorative />
      </Box>
      <Typography component="span" sx={{
        fontSize: TYPE_SCALE.caption, fontWeight: 800, lineHeight: 1.1, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums',
        color: cell.tone === 'win' ? TONE.green : cell.tone === 'loss' ? TONE.red : cell.tone === 'live' ? TONE.red : 'text.secondary',
      }}>
        {cell.text}
      </Typography>
    </Box>
  )
}

export function FullScheduleModal({ games, myTeamId, today, onPlayerClick, onTeamClick, onClose }: {
  games:          ScheduleGame[]
  myTeamId:       number
  today:          string
  onPlayerClick?: (id: number) => void
  onTeamClick?:   (id: number) => void
  onClose:        () => void
}) {
  const [picked, setPicked] = useState<string | null>(null)
  const [selected, setSelected] = useState<ScheduleGame | null>(null)

  const months = scheduleMonths(games)
  // Null until the reader moves: the strip's few weeks are handed over first and the whole season
  // lands a moment later, and the sheet should stay on the same month through that.
  const month = picked && months.includes(picked) ? picked : openingMonth(games, today)
  const at = months.indexOf(month)
  const inMonth = gamesInMonth(games, month)
  const record = monthRecord(inMonth)
  const selectedIdx = selected ? games.findIndex(g => g.gamePk === selected.gamePk) : -1

  const stepper = (dir: -1 | 1) => {
    const to = months[at + dir]
    return (
      <Box {...(to ? pressable(() => setPicked(to)) : { 'aria-hidden': true })} aria-label={to ? monthName(to) : undefined} sx={{
        width: chromePx(36), height: chromePx(36), borderRadius: '50%', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        visibility: to ? 'visible' : 'hidden', cursor: 'pointer', color: 'text.secondary',
        '&:hover': { bgcolor: 'action.hover', color: 'text.primary' },
      }}>
        {dir < 0 ? <ChevronLeft sx={{ fontSize: ICON_SIZE.md }} /> : <ChevronRight sx={{ fontSize: ICON_SIZE.md }} />}
      </Box>
    )
  }

  return (
    <>
      <MlbSheet onClose={onClose} maxWidth={chromePx(560)} sheet eyebrow="Full schedule">
        <Box sx={{ px: 1.5, pb: 2.5, pt: 0.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
            {stepper(-1)}
            <Box sx={{ flex: 1, display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 1, minWidth: 0 }}>
              <Typography component="h3" sx={{ fontSize: TYPE_SCALE.title, fontWeight: 800 }}>{monthName(month)}</Typography>
              {record && (
                <Typography sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 700, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>{record}</Typography>
              )}
            </Box>
            {stepper(1)}
          </Box>

          <Box sx={{ ...COLUMNS, mb: 0.5 }}>
            {WEEKDAYS.map(([short, long]) => (
              <Typography key={long} aria-label={long} sx={{ fontSize: TYPE_SCALE.caption, fontWeight: 700, color: 'text.secondary', textAlign: 'center' }}>{short}</Typography>
            ))}
          </Box>

          {/* Six weeks in every month, so only a doubleheader's taller week moves the sheet when stepping. */}
          <Box sx={{ ...COLUMNS, gridAutoRows: `minmax(${chromePx(66)}, auto)` }}>
            {monthWeeks(month).map((iso, i) => {
              const day = iso ? inMonth.filter(g => g.date === iso) : []
              const isToday = iso === today
              return (
                <Box key={iso ?? `blank-${i}`} sx={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5, minWidth: 0, p: 0.5, borderRadius: 1.5,
                  ...(iso ? { border: '1px solid', borderColor: isToday ? ACCENT_EDGE : day.length ? 'outline' : 'transparent' } : null),
                  ...(day.length ? { bgcolor: 'background.paper', '&:hover': { bgcolor: 'action.hover' } } : null),
                }}>
                  {iso && (
                    <Typography component="span" sx={{ fontSize: TYPE_SCALE.caption, fontWeight: isToday ? 800 : 600, color: isToday ? 'text.primary' : 'text.secondary', lineHeight: 1 }}>
                      {Number(iso.slice(8))}
                    </Typography>
                  )}
                  {day.map(g => <GameCell key={`${g.date}-${g.gamePk}`} game={g} onOpen={() => setSelected(g)} />)}
                </Box>
              )
            })}
          </Box>
        </Box>
      </MlbSheet>

      {selected && (
        <Suspense fallback={null}>
          <GamePreviewModal
            game={scheduleGameToPreview(selected, myTeamId)}
            onClose={() => setSelected(null)}
            onPlayerClick={id => { onClose(); onPlayerClick?.(id) }}
            onTeamClick={id => { onClose(); onTeamClick?.(id) }}
            onPrev={selectedIdx > 0 ? () => setSelected(games[selectedIdx - 1]) : undefined}
            onNext={selectedIdx >= 0 && selectedIdx < games.length - 1 ? () => setSelected(games[selectedIdx + 1]) : undefined}
          />
        </Suspense>
      )}
    </>
  )
}
