import { useEffect, useMemo, useRef } from 'react'
import { Box, Typography } from '@mui/material'
import { SectionCard, TeamBadge, pressable, FOCUS_RING, useWpblDark } from './ui'
import { wpblAccent } from './constants'
import { buildBracket } from './derive/bracket'
import type { BracketSeries, BracketEntrant, WpblBracket } from './derive/bracket'
import { seedingRace } from './derive/seeding'
import { ExperimentalChip } from '../ExperimentsContext'
import { track, EVENTS } from '../lib/analytics'
import type { WpblGame, WpblStandingRow, WpblTeam } from './types'

/**
 * Who goes where: the postseason bracket, drawn.
 *
 * The seeding card under the Standings table says what the last games decide, one row per
 * club, and says the pairing as a letter in a column and a name in a cell. That is the right
 * shape for a table and the wrong shape for the question a fan actually asks, which is who
 * plays whom. Four clubs and three series is a picture, and this is the picture.
 *
 * NOT A DUPLICATE OF THE SEEDING CARD, and the distinction is load-bearing. An earlier version
 * of that card drew a bracket AND a ladder in the same card, so the four clubs appeared twice
 * over, and the bracket was cut for it (see SeedingRace.tsx). The objection was to a bracket
 * beside a list, not to a bracket: this one lives on Home, where the list is not, and Home is
 * the surface with no route to a team page at all.
 *
 * OPT-IN, from the experimental-features switch in Settings. It is the newest thing on the
 * section and the only one that draws a matchup which does not exist yet, so it earns a spell
 * in front of volunteers before it is in front of everyone. Note this is the opposite call
 * from the seeding race, which came OUT from behind the same flag the same day: that card had
 * been built and read for weeks and the flag was buying no more signal, this one is hours old.
 *
 * ONE CARD FOR BOTH HALVES OF SEPTEMBER. Before the postseason the pairings are a projection
 * from the standings order, which is exactly what the seeding race is about; from Sep 9 the
 * same boxes carry real series records. It deliberately does not become a different card on
 * the day, because the interesting thing about a bracket is watching a provisional one harden.
 */

/** Every club here is a tap through to a team page. That is not decoration: opening a player
 *  or team page is the section's retention event by a tenfold margin, and Home is where the
 *  traffic says readers are lost. */
type OpenTeam = (t: WpblTeam) => void

function SeriesTeamRow({ entrant, series, leading, onOpenTeam, from }: {
  entrant: BracketEntrant
  series: BracketSeries
  leading: boolean
  onOpenTeam?: OpenTeam
  from: string
}) {
  const dark = useWpblDark()
  const { team, seed, wins } = entrant

  // An undecided championship slot still draws a row, so the box keeps its height and the
  // bracket does not resize under the reader the moment a semifinal ends.
  if (!team) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.9, px: 1, py: 0.85, minWidth: 0 }}>
        <Box sx={{ width: 14, flexShrink: 0 }} />
        <Box sx={{
          width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
          border: '1px dashed', borderColor: 'divider',
        }} />
        <Typography sx={{ fontSize: '0.8rem', color: 'text.disabled', flex: 1, minWidth: 0 }}>
          Semifinal winner
        </Typography>
      </Box>
    )
  }

  const open = onOpenTeam
    ? () => { track(EVENTS.WPBL_BRACKET_TEAM, { teamId: team.id, seed, from }); onOpenTeam(team) }
    : undefined

  return (
    <Box
      {...pressable(open)}
      sx={{
        display: 'flex', alignItems: 'center', gap: 0.9, px: 1, py: 0.85, minWidth: 0,
        cursor: onOpenTeam ? 'pointer' : 'default',
        '&:hover': onOpenTeam ? { bgcolor: 'action.hover' } : undefined,
        // The club that is through, or ahead, carries the only weight in the box. Everything
        // else stays flat so the eye lands on it without reading the numbers.
        opacity: series.winner && series.winner.id !== team.id ? 0.5 : 1,
        ...FOCUS_RING,
      }}
    >
      <Typography sx={{
        width: 14, flexShrink: 0, fontSize: '0.68rem', fontWeight: 800,
        color: 'text.disabled', fontVariantNumeric: 'tabular-nums',
      }}>{seed ?? ''}</Typography>
      <TeamBadge team={team} size={22} />
      <Typography sx={{
        flex: 1, minWidth: 0, fontSize: '0.8rem', lineHeight: 1.2,
        fontWeight: leading ? 800 : 600,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        color: leading ? wpblAccent(team.id, dark) : 'text.primary',
      }}>{team.name}</Typography>
      {/* The win column appears only once a series has a game in it. A column of zeroes on
          Aug 20 would read as a series that has been played and finished nil-nil. */}
      {series.played > 0 && (
        <Typography sx={{
          fontSize: '0.9rem', fontWeight: 800, flexShrink: 0, minWidth: 12, textAlign: 'right',
          fontVariantNumeric: 'tabular-nums',
          color: leading ? 'text.primary' : 'text.secondary',
        }}>{wins}</Typography>
      )}
    </Box>
  )
}

function SeriesBox({ series, onOpenTeam, from }: {
  series: BracketSeries; onOpenTeam?: OpenTeam; from: string
}) {
  const { home, away, winner } = series
  const homeLeads = winner ? winner.id === home.team?.id : home.wins > away.wins
  const awayLeads = winner ? winner.id === away.team?.id : away.wins > home.wins
  const isFinal = series.round === 'championship'

  return (
    <Box sx={{
      borderRadius: 2, overflow: 'hidden', flex: 1, minWidth: 0,
      border: '1px solid', borderColor: isFinal ? 'var(--wpbl-medal-1)' : 'divider',
      bgcolor: 'background.paper',
    }}>
      <Box sx={{
        display: 'flex', alignItems: 'baseline', gap: 0.75, px: 1, py: 0.5,
        bgcolor: 'action.hover', borderBottom: '1px solid', borderColor: 'divider',
      }}>
        <Typography sx={{
          fontSize: '0.56rem', fontWeight: 900, letterSpacing: 0.7, textTransform: 'uppercase',
          color: isFinal ? 'var(--wpbl-medal-1)' : 'text.disabled', whiteSpace: 'nowrap',
        }}>{series.label}</Typography>
        <Box sx={{ flex: 1 }} />
        <Typography sx={{
          fontSize: '0.6rem', fontWeight: 700, color: 'text.secondary', whiteSpace: 'nowrap',
          overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{series.summary}</Typography>
      </Box>
      <SeriesTeamRow entrant={home} series={series} leading={homeLeads} onOpenTeam={onOpenTeam} from={from} />
      <Box sx={{ borderTop: '1px solid', borderColor: 'divider' }} />
      <SeriesTeamRow entrant={away} series={series} leading={awayLeads} onOpenTeam={onOpenTeam} from={from} />
    </Box>
  )
}

/** The elbow joining the two semifinals to the championship. Drawn only from `sm` up, where
 *  the three boxes sit side by side and the line has something to connect; stacked on a phone
 *  the boxes are already in reading order and a connector would be decoration. */
function Connector() {
  return (
    <Box aria-hidden sx={{
      display: { xs: 'none', sm: 'block' }, position: 'relative',
      width: 22, flexShrink: 0, alignSelf: 'stretch',
    }}>
      {/* Two horizontal stubs out of the semifinals, a vertical spine joining them, and one
          stub into the championship. Percentages rather than fixed offsets so the elbow tracks
          the boxes whatever height the club names force on them. */}
      <Box sx={{ position: 'absolute', left: 0, width: '50%', top: '25%', borderTop: '1px solid', borderColor: 'divider' }} />
      <Box sx={{ position: 'absolute', left: 0, width: '50%', top: '75%', borderTop: '1px solid', borderColor: 'divider' }} />
      <Box sx={{ position: 'absolute', left: '50%', top: '25%', height: '50%', borderLeft: '1px solid', borderColor: 'divider' }} />
      <Box sx={{ position: 'absolute', left: '50%', width: '50%', top: '50%', borderTop: '1px solid', borderColor: 'divider' }} />
    </Box>
  )
}

export function BracketDiagram({ bracket, onOpenTeam, from }: {
  bracket: WpblBracket; onOpenTeam?: OpenTeam; from: string
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'stretch', gap: { xs: 1, sm: 0 } , flexDirection: { xs: 'column', sm: 'row' } }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1, minWidth: 0 }}>
        {bracket.semifinals.map(s => (
          <SeriesBox key={s.label} series={s} onOpenTeam={onOpenTeam} from={from} />
        ))}
      </Box>
      <Connector />
      {/* On a phone the championship follows the two semifinals in a column, so it gets a word
          instead of a line: without one it reads as a third semifinal. */}
      <Typography sx={{
        display: { xs: 'block', sm: 'none' },
        fontSize: '0.56rem', fontWeight: 900, letterSpacing: 0.7, textTransform: 'uppercase',
        color: 'text.disabled', textAlign: 'center', mt: 0.25,
      }}>The winners meet in the</Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0 }}>
        <SeriesBox series={bracket.championship} onOpenTeam={onOpenTeam} from={from} />
      </Box>
    </Box>
  )
}

export default function PlayoffBracket({ rows, games, onOpenTeam, from = 'home' }: {
  /** Standings rows, in order, from `computeStandings`. */
  rows: WpblStandingRow[]
  games: WpblGame[]
  onOpenTeam?: OpenTeam
  from?: string
}) {
  const bracket = useMemo(() => buildBracket(rows, games), [rows, games])
  // Games left is the seeding card's own figure, recomputed here rather than passed down so
  // the two cards cannot drift: each remaining game sits on two clubs, hence the halving.
  const left = useMemo(() => {
    const seeds = seedingRace(rows, games)
    return Math.round(seeds.reduce((n, s) => n + s.remaining, 0) / 2)
  }, [rows, games])

  const logged = useRef(false)
  useEffect(() => {
    if (logged.current || !bracket) return
    logged.current = true
    track(EVENTS.WPBL_BRACKET_SHOWN, {
      settled: bracket.settled, started: bracket.started, gamesLeft: left, from,
    })
  }, [bracket, left, from])

  if (!bracket) return null

  // Three states, one card. The subtitle is the only part that changes, because it is the only
  // part whose meaning does: the same boxes are a projection, then a scoreboard, then a record.
  const subtitle =
    bracket.champion ? `${bracket.champion.name} are the inaugural champions.`
    : bracket.started ? 'Semifinals are best-of-three, the championship best-of-five.'
    : bracket.settled ? 'The order is final. Semifinals begin Sep 9.'
    : `All four clubs are in, so the last ${left} game${left === 1 ? '' : 's'} decide only the order. Here is the bracket as it stands.`

  return (
    <SectionCard
      title={bracket.started ? 'Postseason' : 'The road to the title'}
      // Opt-in, and the card has to say so itself: it looks exactly like the shipped cards it
      // sits between, and someone who turned the switch on weeks ago should not have to
      // remember which of them was the experiment.
      action={<ExperimentalChip />}
      subtitle={subtitle}
    >
      <BracketDiagram bracket={bracket} onOpenTeam={onOpenTeam} from={from} />
      {!bracket.started && (
        <Typography sx={{ fontSize: '0.66rem', color: 'text.disabled', mt: 1.25, lineHeight: 1.45 }}>
          {bracket.settled
            ? 'A and B are our labels for the two pairings, not the league’s.'
            : 'Seeds 1 and 4 meet, and 2 and 3, so a club’s finishing position sets its opponent. The pairings move with the standings until the last game on Sep 6.'}
        </Typography>
      )}
    </SectionCard>
  )
}
