import { useEffect, useMemo, useRef } from 'react'
import { Box, Typography } from '@mui/material'
import { SectionCard, TeamBadge, pressable, FOCUS_RING, useWpblDark } from './ui'
import { wpblAccent } from './constants'
import { buildBracket } from './derive/bracket'
import type { BracketSeries, BracketEntrant, WpblBracket } from './derive/bracket'
import { postseasonOdds, fmtOdds } from './derive/seriesOdds'
import type { SeriesOdds, WpblPostseasonOdds } from './derive/seriesOdds'
import { seedingRace } from './derive/seeding'
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
 * LIVE FOR EVERYONE. It began behind the experimental-features switch, since it draws a matchup
 * that does not exist yet, and came out once the win-probability blend (run differential plus
 * head-to-head, see derive/seriesOdds.ts) turned it from a bare projected bracket into the
 * section's one forward-looking surface. The odds carry their own hedge in the card's footnote,
 * which is what a bracket-shaped guess needs rather than a flag almost nobody flips.
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

function SeriesTeamRow({ entrant, series, leading, onOpenTeam, from, placeholder }: {
  entrant: BracketEntrant
  series: BracketSeries
  leading: boolean
  onOpenTeam?: OpenTeam
  from: string
  /** What an empty slot reads as. The championship names WHICH semifinal feeds each slot
   *  ("Semifinal A winner") rather than a bare "Semifinal winner" that is the same on both. */
  placeholder?: string
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
          {placeholder ?? 'Semifinal winner'}
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

/** The one-game odds turned into a two-tone bar under the series header: how likely each club
 *  is to WIN THE SERIES from where it stands. Drawn only while the series is live or projected;
 *  a decided series has a winner, not a chance. The colours are the two clubs' accents, so the
 *  bar reads without a legend once the reader has seen the rows below it. */
function SeriesOddsBar({ series, odds }: { series: BracketSeries; odds: SeriesOdds }) {
  const dark = useWpblDark()
  if (series.winner || !series.home.team || !series.away.team) return null
  const homeAccent = wpblAccent(series.home.team.id, dark)
  const awayAccent = wpblAccent(series.away.team.id, dark)

  // The season series feeds the odds, so it earns a line of its own: leader's abbr first, which
  // is how a fan says it ("SF 4-2"). Drawn only when the two actually met and one won more.
  let seasonLine: string | null = null
  const h = odds.h2h
  if (h && h.homeWins + h.awayWins > 0) {
    const [leadAbbr, hi, lo] = h.homeWins >= h.awayWins
      ? [series.home.team.abbr, h.homeWins, h.awayWins]
      : [series.away.team.abbr, h.awayWins, h.homeWins]
    seasonLine = hi === lo ? `Season series ${hi}-${lo}` : `Season series ${leadAbbr} ${hi}-${lo}`
  }

  return (
    <Box sx={{ px: 1, py: 0.6 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <Typography sx={{
          fontSize: '0.6rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums',
          color: homeAccent, minWidth: 26,
        }}>{fmtOdds(odds.homeWinP)}</Typography>
        <Box sx={{ flex: 1, height: 6, borderRadius: 3, overflow: 'hidden', display: 'flex', bgcolor: 'action.hover' }}>
          <Box sx={{ width: `${odds.homeWinP * 100}%`, bgcolor: homeAccent }} />
          <Box sx={{ flex: 1, bgcolor: awayAccent, opacity: 0.55 }} />
        </Box>
        <Typography sx={{
          fontSize: '0.6rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums',
          color: awayAccent, minWidth: 26, textAlign: 'right',
        }}>{fmtOdds(odds.awayWinP)}</Typography>
      </Box>
      {seasonLine && (
        <Typography sx={{
          fontSize: '0.55rem', fontWeight: 700, color: 'text.disabled', textAlign: 'center',
          textTransform: 'uppercase', letterSpacing: 0.4, mt: 0.4,
        }}>{seasonLine}</Typography>
      )}
    </Box>
  )
}

function SeriesBox({ series, odds, onOpenTeam, from }: {
  series: BracketSeries; odds?: SeriesOdds; onOpenTeam?: OpenTeam; from: string
}) {
  const { home, away, winner } = series
  const homeLeads = winner ? winner.id === home.team?.id : home.wins > away.wins
  const awayLeads = winner ? winner.id === away.team?.id : away.wins > home.wins
  const isFinal = series.round === 'championship'
  // The most dramatic true thing about a live series is when one club is a loss from going home.
  const elim = odds?.eliminationFor ?? null

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
        {elim && (
          <Typography sx={{
            fontSize: '0.5rem', fontWeight: 900, letterSpacing: 0.6, textTransform: 'uppercase',
            color: 'error.main', border: '1px solid', borderColor: 'error.main', borderRadius: 0.75,
            px: 0.5, py: 0.05, whiteSpace: 'nowrap', lineHeight: 1.3,
          }}>Elimination</Typography>
        )}
        <Box sx={{ flex: 1 }} />
        <Typography sx={{
          fontSize: '0.6rem', fontWeight: 700, color: 'text.secondary', whiteSpace: 'nowrap',
          overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{series.summary}</Typography>
      </Box>
      {/* In the final, the two empty slots name their source semifinal. The bracket draws A on
          top and B below, and the connector runs A → the top (home) slot, so that is the match. */}
      <SeriesTeamRow entrant={home} series={series} leading={homeLeads} onOpenTeam={onOpenTeam} from={from}
        placeholder={isFinal ? 'Semifinal A winner' : undefined} />
      <Box sx={{ borderTop: '1px solid', borderColor: 'divider' }} />
      <SeriesTeamRow entrant={away} series={series} leading={awayLeads} onOpenTeam={onOpenTeam} from={from}
        placeholder={isFinal ? 'Semifinal B winner' : undefined} />
      {odds && <SeriesOddsBar series={series} odds={odds} />}
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

export function BracketDiagram({ bracket, odds, onOpenTeam, from }: {
  bracket: WpblBracket; odds?: WpblPostseasonOdds | null; onOpenTeam?: OpenTeam; from: string
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'stretch', gap: { xs: 1, sm: 0 } , flexDirection: { xs: 'column', sm: 'row' } }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1, minWidth: 0 }}>
        {bracket.semifinals.map((s, i) => (
          <SeriesBox key={s.label} series={s} odds={odds?.semifinals[i]} onOpenTeam={onOpenTeam} from={from} />
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
        <SeriesBox series={bracket.championship} odds={odds?.championship ?? undefined} onOpenTeam={onOpenTeam} from={from} />
      </Box>
    </Box>
  )
}

/** The headline the bracket cannot draw: each club's chance to WIN IT ALL, ranked by that
 *  chance rather than by record. Ordered by probability, so a stronger lower seed can sit above
 *  a weaker higher one, which is the whole point of pricing it off run differential instead of
 *  reading the standings back. Champion crowned once the final is decided. */
function TitleOddsStrip({ odds, onOpenTeam }: {
  odds: WpblPostseasonOdds; onOpenTeam?: OpenTeam
}) {
  const dark = useWpblDark()
  if (odds.title.length === 0) return null
  const decided = odds.title.some(t => t.p >= 1)
  return (
    <Box sx={{ mt: 1.5 }}>
      <Typography sx={{
        fontSize: '0.56rem', fontWeight: 900, letterSpacing: 0.7, textTransform: 'uppercase',
        color: 'text.disabled', mb: 0.75,
      }}>{decided ? 'Champion' : 'Chance to win it all'}</Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        {odds.title.map(t => {
          const accent = wpblAccent(t.team.id, dark)
          const open = onOpenTeam
            ? () => { track(EVENTS.WPBL_BRACKET_TEAM, { teamId: t.team.id, seed: t.seed, from: 'title-odds' }); onOpenTeam(t.team) }
            : undefined
          return (
            <Box
              key={t.team.id}
              {...pressable(open)}
              sx={{
                display: 'flex', alignItems: 'center', gap: 0.9, minWidth: 0,
                cursor: onOpenTeam ? 'pointer' : 'default', borderRadius: 1, px: 0.5, py: 0.3,
                '&:hover': onOpenTeam ? { bgcolor: 'action.hover' } : undefined,
                ...FOCUS_RING,
              }}
            >
              <TeamBadge team={t.team} size={20} />
              {/* Fixed name column so every bar starts at the same x and the four read as one
                  chart. Wide enough for the longest club nickname; ellipsis is only a backstop
                  for the Large text setting. */}
              <Typography sx={{
                width: 92, flexShrink: 0, fontSize: '0.82rem', fontWeight: 700,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>{t.team.name}</Typography>
              {/* The bar fills the row: name on the left, percentage on the right, no gap
                  between. Length is the probability, so the four bars are directly comparable. */}
              <Box sx={{ flex: 1, minWidth: 0, height: 8, borderRadius: 4, overflow: 'hidden', bgcolor: 'action.hover' }}>
                <Box sx={{ width: `${Math.max(t.p * 100, t.p > 0 ? 2 : 0)}%`, height: '100%', bgcolor: accent }} />
              </Box>
              <Typography sx={{
                width: 40, flexShrink: 0, fontSize: '0.8rem', fontWeight: 800,
                fontVariantNumeric: 'tabular-nums', textAlign: 'right',
                color: t.p >= 1 ? accent : 'text.primary',
              }}>{fmtOdds(t.p)}</Typography>
            </Box>
          )
        })}
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
  const odds = useMemo(() => bracket ? postseasonOdds(bracket, rows, games) : null, [bracket, rows, games])
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
  // Kept to one line on a phone: the format (best-of-N) shows in each series box, and the
  // seeding mechanic in the footnote below, so the subtitle need not carry either.
  const subtitle =
    bracket.champion ? `${bracket.champion.name} are the inaugural champions.`
    : bracket.started ? 'Series odds, updated after every game.'
    : bracket.settled ? 'Seeds are set. Semifinals begin Sep 9.'
    : 'The bracket and title odds as they stand today.'

  return (
    <SectionCard
      title={bracket.started ? 'Postseason' : 'Road to the title'}
      subtitle={subtitle}
    >
      <BracketDiagram bracket={bracket} odds={odds} onOpenTeam={onOpenTeam} from={from} />
      {odds && <TitleOddsStrip odds={odds} onOpenTeam={onOpenTeam} />}
      {odds && !bracket.champion && (
        <Typography sx={{ fontSize: '0.62rem', color: 'text.disabled', mt: 1, lineHeight: 1.45 }}>
          Odds blend each club’s run differential with its head-to-head results, then
          play the bracket out to a champion.
        </Typography>
      )}
    </SectionCard>
  )
}
