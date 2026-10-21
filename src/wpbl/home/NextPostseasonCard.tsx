import { useDark } from '../../ui/useDark'
import { useMemo } from 'react'
import { Box, Typography } from '@mui/material'
import { computeStandings,
} from '../api'
import { wpblSurface, wpblFullName, formatGameTime, gameStartMs, relativeDayLabel } from '../constants'
import { SectionCard, TeamBadge, CARD_BORDER, TYPE_SCALE, CLUB_BAND } from '../ui'
import { postseasonSlots, BEST_OF, type PostseasonScheduleRow, type PostseasonSlot } from '../derive/bracket'
import { WpblGamePreview } from '../GamePreview'
import type { WpblTeam, WpblGame } from '../types'
import { typePx } from '../../ui/scale'
import { Countdown } from './shared'

/** The soonest postseason fixture still ahead, or null once the calendar is exhausted.
 *
 *  AN IF-NECESSARY GAME IS STILL THE NEXT GAME (drawn with the caveat on it): a conditional
 *  decider is the one thing actually on the calendar between now and the next certain fixture, so
 *  skipping it would jump a week ahead past the game that decides whether that fixture involves a
 *  club at all. Safe because `postseasonScheduleRows` DROPS an if-necessary row the moment its
 *  series is decided and CLEARS the flag the moment the game is forced. The grace window matches
 *  the feed branch in `NextGameCard`, so a game that started three hours ago is still "next"
 *  rather than skipped the moment its clock runs out.
 *
 *  Null is the season's own signal that nothing is ahead, which is what turns the Next-game slot
 *  into the season-recap card. */
export function nextPostseasonRow(rows: PostseasonScheduleRow[]): { r: PostseasonScheduleRow; ms: number } | null {
  const now = Date.now()
  const dated = rows
    .map(r => ({ r, ms: gameStartMs(r.date, r.time) }))
    .filter((x): x is { r: PostseasonScheduleRow; ms: number } => x.ms != null)
    .sort((a, b) => a.ms - b.ms)
  return dated.find(x => x.ms >= now - 3 * 3600000) ?? dated[0] ?? null
}

export function NextPostseasonCard({ rows, teams, games }: {
  rows: PostseasonScheduleRow[]; teams: Map<string, WpblTeam>; games: WpblGame[]
}) {
  const isDark = useDark()

  const next = useMemo(() => nextPostseasonRow(rows), [rows])

  const recordOf = useMemo(() => {
    const by = new Map(computeStandings([...teams.values()], games).map(r => [r.team.id, `${r.wins}–${r.losses}`]))
    return (id: string) => by.get(id) ?? null
  }, [teams, games])

  if (!next) return null
  const r = next.r
  const bestOf = BEST_OF[r.round]
  const { slots } = postseasonSlots(r)

  /** One seat: the club if it is settled, the seed it is reserved for if it is not. */
  const slotRow = (p: PostseasonSlot, i: number) => {
    const record = p.team ? recordOf(p.team.id) : null
    return (
      <Box key={i} sx={{
        display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1,
        bgcolor: p.team ? wpblSurface(p.team.id, isDark) : 'transparent',
      }}>
        {p.team ? <TeamBadge team={p.team} size={30} /> : (
          // The empty seat, sized exactly like a badge so the row does not shift under the
          // reader on the day the seed settles. The scoreboard chip's shape, one size up.
          <Box aria-hidden sx={{
            width: 30, height: 30, flexShrink: 0, borderRadius: '50%',
            border: '1px dashed', borderColor: CARD_BORDER,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: TYPE_SCALE.meta, fontWeight: 800, color: 'text.disabled',
          }}>{p.seed ?? ''}</Box>
        )}
        <Typography noWrap sx={{
          minWidth: 0, fontSize: TYPE_SCALE.display, letterSpacing: typePx(-0.2), lineHeight: 1.15,
          fontWeight: p.team ? 700 : 600,
          color: p.team ? 'text.primary' : 'text.secondary',
        }}>
          {p.team ? wpblFullName(p.team) : p.label}
        </Typography>
        {record && (
          <Typography sx={{
            fontSize: TYPE_SCALE.meta, fontWeight: 600, fontVariantNumeric: 'tabular-nums',
            color: 'text.secondary', flexShrink: 0,
          }}>{record}</Typography>
        )}
        <Box sx={{ flex: 1, minWidth: 0 }} />
      </Box>
    )
  }

  return (
    <SectionCard
      title="Next game"
      action={
        <Box sx={{
          display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end',
          alignItems: 'baseline', columnGap: 0.75, rowGap: 0.2,
        }}>
          <Typography sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 600, color: 'text.secondary' }}>
            {/* CONVERTED, like every other clock in the section. `r.time` is the league's CENTRAL
                wall clock (see PostseasonGame in derive/bracket.ts), so printed raw it would tell a
                Pacific reader 6:00 PM for a 4:00 PM start, and contradict the schedule strip, which
                converts the same field, about the same fixture. */}
            {relativeDayLabel(r.date)}{r.time ? `, ${formatGameTime(r.date, r.time) || r.time}` : ''}
          </Typography>
          <Countdown target={next.ms} />
        </Box>
      }
      actionWraps
      fill
    >
      {/* Not a link and not `TAPPABLE`: see the header. Everything else is the real card's
          layout, tier for tier, because the two are the same card on different days. */}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', p: 0.5, mx: -0.5 }}>
        <Box sx={CLUB_BAND}>
          {slots.map(slotRow)}
        </Box>

        <Typography sx={{
          fontSize: TYPE_SCALE.micro, fontWeight: 800, letterSpacing: typePx(0.6),
          textTransform: 'uppercase', color: 'var(--wpbl-accent-fg)', mt: 1, lineHeight: 1.2,
        }}>
          {r.label} · Game {r.gameNumber} of {bestOf}
        </Typography>

        {/* THE CAVEAT THAT LETS THIS GAME BE SHOWN AT ALL. It is a conditional decider, played
            only if its series has not already ended; the row exists here only while that is still
            true (see the note on `next`). Say so plainly so "Next game" is not read as a promise. */}
        {r.ifNecessary && (
          <Typography sx={{ fontSize: TYPE_SCALE.body, fontWeight: 600, color: 'text.secondary', lineHeight: 1.4, mt: 0.4 }}>
            If needed
          </Typography>
        )}

        {/* THE ONE THING A READER CANNOT WORK OUT FROM THE ROWS. A pairing can close before the
            seeds inside it do: two clubs certain to meet can still be contesting 2 and 3. Both
            clubs are named, so the card looks as settled as the other semifinal, and the order
            it prints them in is a guess. */}
        {r.seedOrderTbd && (
          <Typography sx={{ fontSize: TYPE_SCALE.body, fontWeight: 600, color: 'text.secondary', lineHeight: 1.4, mt: 0.4 }}>
            Seeding TBD
          </Typography>
        )}

        {/* The tale of the tape, when both seats are filled. It takes its two clubs as `away`
            and `home` and draws them left and right without ever printing either word, so the
            order above is a safe thing to hand it whether or not that order is away-at-home. */}
        {slots[0].team && slots[1].team && (
          <Box sx={{ mt: 1.5 }}>
            <WpblGamePreview away={slots[0].team} home={slots[1].team} teams={[...teams.values()]} games={games} compact />
          </Box>
        )}
      </Box>
    </SectionCard>
  )
}
