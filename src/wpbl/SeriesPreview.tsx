import { useEffect, useMemo, useState } from 'react'
import { Box, Typography } from '@mui/material'
import {
  ModalShell, SectionLabel, TeamBadge, pressable, FOCUS_RING, TAPPABLE, useWpblDark,
  TYPE_SCALE, chromePx,
} from './ui'
import { wpblAccent, wpblSurface, formatGameTime } from './constants'
import { fetchWpblAllLines, getCachedWpblAllLines, fetchWpblAllPlayers, countsInStandings } from './api'
import { useEraBasis } from './EraBasisContext'
import { postseasonGames } from './derive/bracket'
import { WpblGamePreview } from './GamePreview'
import { teamLeaders, LeaderTable } from './TeamLeaders'
import { fmtOdds } from './derive/seriesOdds'
import type { SeriesOdds } from './derive/seriesOdds'
import type { BracketSeries } from './derive/bracket'
import type {
  WpblTeam, WpblGame, WpblPlayer, WpblStandingRow,
} from './types'

/**
 * One series, opened.
 *
 * WHY THE BOX IS A SINGLE TARGET. A tap through to a club's page on each row of the bracket
 * would make a series box two controls with a third of a control between them, and leave the
 * box itself, the thing a reader actually points at, doing nothing. The whole box opens this
 * instead, and the club links live in here where there is room to label them. A team page is
 * one tap further away and arrives with the reason to want it already read, and
 * `WPBL_BRACKET_TEAM` fires from the chips below so the retention number this card is judged
 * on stays comparable.
 *
 * WHAT IT ANSWERS, in the order somebody asks it: who is playing and how likely each of them is,
 * when the games are, what happened when these two met in the season, how the clubs compare, and
 * who to watch on each side. The first four exist in pieces elsewhere in the section; the
 * leaders are the reason this is a series overview rather than a bigger tooltip.
 *
 * IT FETCHES NOTHING ANYBODY ELSE HAS NOT ALREADY FETCHED. Box-score lines and the league roster
 * are both app-wide caches by the time Home has drawn, so on a warm page this opens with no
 * request at all; on a cold one it asks for the same two reads the rest of the page wants.
 */

/** The regular-season meetings between two clubs, newest first. The season series line in the
 *  bracket is a record; this is the games behind it. */
export function seasonMeetings(a: string, b: string, games: WpblGame[]): WpblGame[] {
  return games
    .filter(g => g.status === 'final' && countsInStandings(g)
      && ((g.home_team_id === a && g.away_team_id === b) || (g.home_team_id === b && g.away_team_id === a)))
    .sort((x, y) => (x.game_date < y.game_date ? 1 : -1))
}

function ClubChip({ team, seed, record, winP, onOpenTeam }: {
  team: WpblTeam; seed: number | null; record: string | null; winP: number | null
  onOpenTeam?: (t: WpblTeam) => void
}) {
  const dark = useWpblDark()
  return (
    <Box
      {...pressable(onOpenTeam ? () => onOpenTeam(team) : undefined)}
      // The chip's own text is a nickname over a city over a percentage, which a screen reader
      // reads as three fragments. The label says where the tap goes.
      aria-label={onOpenTeam ? `${team.city} ${team.name} team page` : undefined}
      sx={{
        position: 'relative', overflow: 'hidden', flex: 1, minWidth: 0,
        borderRadius: 2, border: '1px solid', borderColor: 'divider', p: 1.25,
        display: 'flex', alignItems: 'center', gap: 1,
        cursor: onOpenTeam ? 'pointer' : 'default',
        ...(onOpenTeam ? TAPPABLE : null), ...FOCUS_RING,
      }}
    >
      {winP != null && (
        <Box aria-hidden sx={{
          position: 'absolute', inset: 0, width: `${Math.max(winP * 100, winP > 0 ? 1.5 : 0)}%`,
          bgcolor: wpblSurface(team.id, dark),
        }} />
      )}
      <Box sx={{ position: 'relative', flexShrink: 0, display: 'flex' }}><TeamBadge team={team} size={30} /></Box>
      <Box sx={{ position: 'relative', minWidth: 0, flex: 1 }}>
        {/* THE NICKNAME ON TOP AND THE CITY UNDERNEATH, which is not the bracket's answer and
        should not be. Two of these sit side by side inside a 560px sheet with a percentage
        on each, so "San Francisco Firebells" on one line ellipsises to "San Franci…" and
        throws the city away, which is the half the bracket's own boxes are already showing.
        Split across two lines nothing is lost and nothing is cut. */}
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.6, minWidth: 0 }}>
          {/* The seed rides the nickname line rather than the meta line below it. Three items
          down there ("San Francisco · 1 seed · 10-5") do not fit beside a percentage in half
          a 560px sheet, and the one that gets cut is the city, which is the whole reason this
          line exists. */}
          {seed != null && (
            <Typography sx={{
              flexShrink: 0, fontSize: TYPE_SCALE.caption, fontWeight: 800, color: 'text.disabled',
              fontVariantNumeric: 'tabular-nums',
            }}>{seed}</Typography>
          )}
          <Typography sx={{
            fontSize: TYPE_SCALE.heading, fontWeight: 900, lineHeight: 1.15, minWidth: 0,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{team.name}</Typography>
        </Box>
        {/* WRAPS RATHER THAN ELLIPSISES. It is the only line in the chip that can afford a
            second row, and at the Large text setting "San Francisco · 10-5" does not fit beside
            a percentage in half a 560px sheet. Cutting it would drop the record, which is the
            half that is not already on the bracket behind this sheet. */}
        <Typography sx={{
          fontSize: TYPE_SCALE.caption, color: 'text.disabled', lineHeight: 1.3,
        }}>{[team.city, record].filter(Boolean).join(' · ')}</Typography>
      </Box>
      {/* A step BELOW the club name. The chip is about a club and the number is what is said
      about it; a step above (21px against the name's 19px), the reader's eye lands on the
      percentage first, in a row whose whole job is to say who is playing. */}
      {winP != null && (
        <Typography sx={{
          position: 'relative', flexShrink: 0, fontSize: TYPE_SCALE.title, fontWeight: 900,
          fontVariantNumeric: 'tabular-nums', color: wpblAccent(team.id, dark),
        }}>{fmtOdds(winP)}</Typography>
      )}
    </Box>
  )
}

/** The published fixture list for this series, resolved onto the two clubs.
 *
 *  THE LEAGUE PUBLISHES A SEAT, NOT A CLUB ("higher" or "lower" seed bats last), which is what
 *  makes this printable before anyone knows who is in it. The championship's five carry no seat
 *  at all, because the league has not said which end of the bracket bats last in which game, and
 *  a guessed "@" is exactly what that field exists not to print: those rows show the date and
 *  nothing else. */
function SeriesSchedule({ series }: { series: BracketSeries }) {
  const list = postseasonGames(series.round, series.key)
  if (list.length === 0) return null
  const higher = series.home.team
  const lower = series.away.team

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column' }}>
      {list.map(g => {
        const host = g.home === 'higher' ? higher : g.home === 'lower' ? lower : null
        const guest = g.home === 'higher' ? lower : g.home === 'lower' ? higher : null
        const when = formatGameTime(g.date, g.time)
        const day = new Date(`${g.date}T00:00:00`).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
        return (
          <Box key={g.game} sx={{
            display: 'flex', alignItems: 'center', gap: 0.75, py: 0.7, minWidth: 0,
            borderTop: '1px solid', borderColor: 'divider',
            opacity: g.ifNecessary ? 0.6 : 1,
          }}>
            <Typography sx={{
              // "Game 3" and nothing longer, at the smallest size on the row, so it gets the
              // width that string needs and not a hand-picked column. A wider column takes pixels
              // the matchup on the right needs at the Large text setting, where "BOS @ SF" comes
              // out as "BOS @ S…".
              width: '2.75rem', flexShrink: 0,
              fontSize: TYPE_SCALE.caption, fontWeight: 800,
              letterSpacing: 0.4, textTransform: 'uppercase', color: 'text.disabled',
            }}>{`Game ${g.game}`}</Typography>
            <Typography sx={{ fontSize: TYPE_SCALE.body, fontWeight: 700, whiteSpace: 'nowrap' }}>{day}</Typography>
            <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.secondary', whiteSpace: 'nowrap' }}>{when}</Typography>
            <Box sx={{ flex: 1 }} />
            {host && guest && (
              <Typography sx={{
                fontSize: TYPE_SCALE.caption, color: 'text.disabled', whiteSpace: 'nowrap',
                overflow: 'hidden', textOverflow: 'ellipsis',
              }}>{`${guest.abbr} @ ${host.abbr}`}</Typography>
            )}
            {g.ifNecessary && (
              <Typography sx={{
                fontSize: TYPE_SCALE.caption, fontWeight: 800, color: 'text.disabled',
                whiteSpace: 'nowrap', flexShrink: 0,
              }}>if needed</Typography>
            )}
          </Box>
        )
      })}
    </Box>
  )
}

export default function SeriesPreview({ series, odds, teams, games, rows, onClose, onOpenTeam, onOpenPlayer, onOpenGame }: {
  series: BracketSeries
  odds?: SeriesOdds
  teams: WpblTeam[]
  games: WpblGame[]
  rows: WpblStandingRow[]
  onClose: () => void
  onOpenTeam?: (t: WpblTeam) => void
  onOpenPlayer?: (p: WpblPlayer) => void
  /** Open one of the season's meetings in Game Center. Optional: without it the rows are still
   *  worth reading, they just stop being a way in. */
  onOpenGame?: (g: WpblGame) => void
}) {
  const dark = useWpblDark()
  const { basis: eraBasis } = useEraBasis()
  const [lines, setLines] = useState(() => getCachedWpblAllLines())
  const [players, setPlayers] = useState<WpblPlayer[]>([])

  useEffect(() => {
    let off = false
    if (!lines) fetchWpblAllLines().then(l => { if (!off) setLines(l) })
    fetchWpblAllPlayers().then(p => { if (!off) setPlayers(p) })
    return () => { off = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const home = series.home.team
  const away = series.away.team
  const recordOf = (id: string | undefined) => {
    const r = rows.find(x => x.team.id === id)
    return r ? `${r.wins}-${r.losses}` : null
  }

  const leaders = useMemo(() => {
    if (!lines || players.length === 0) return null
    const of = (t: WpblTeam) => teamLeaders(t, players, lines.batting, lines.pitching, games, teams, eraBasis)
    return { home: home ? of(home) : [], away: away ? of(away) : [] }
  }, [lines, players, games, teams, home, away, eraBasis])

  const meetings = useMemo(
    () => (home && away ? seasonMeetings(home.id, away.id, games) : []),
    [home, away, games])

  const h2h = odds?.h2h
  const h2hLine = h2h && home && away && h2h.homeWins + h2h.awayWins > 0
    ? (h2h.homeWins === h2h.awayWins
      ? `Split ${h2h.homeWins}-${h2h.awayWins}`
      : h2h.homeWins > h2h.awayWins
        ? `${home.abbr} won it ${h2h.homeWins}-${h2h.awayWins}`
        : `${away.abbr} won it ${h2h.awayWins}-${h2h.homeWins}`)
    : null

  return (
    // WIDER THAN A SHEET ON A DESKTOP, because it is five blocks and they do not want to be a
    // column 1,348px long. At 1600x1000 a sheet-width card runs the full height of the screen
    // with half its content below the fold, in a 560px ribbon with a thousand pixels of empty
    // page either side of it.
    <ModalShell sheet eyebrow={`${series.label} · best of ${series.bestOf}`}
      maxWidth={{ xs: 560, md: 900 }} onClose={onClose}>
      <Box sx={{ px: 2, py: 1.75, display: 'flex', flexDirection: 'column', gap: 2.25 }}>
        {/* Who, and how likely. The same two facts the bracket box shows, at the size a sheet
            can afford, and the only place in here a club is a link. */}
        {/* STACKED ON A PHONE. Side by side at 375px each chip gets ~160px for a badge, a seed, a
            nickname and a percentage, and the nickname is what gives: "Heights" came out as
            "Hei…" on the one surface where this sheet is most likely to be opened. */}
        {/* AWAY FIRST, THEN HOME, which is the order every other block in this sheet uses. The
        bracket draws the higher seed on top, and following it here would put these chips the
        other way round from the schedule ("BOS @ SF"), the team comparison ("BOS vs SF") and
        the leaders (Boston on the left). Away first everywhere is also how a baseball line
        reads. */}
        <Box sx={{ display: 'flex', gap: 1, minWidth: 0, flexDirection: { xs: 'column', sm: 'row' } }}>
          {away && (
            <ClubChip team={away} seed={series.away.seed} record={recordOf(away.id)}
              winP={odds && !series.winner ? odds.awayWinP : null} onOpenTeam={onOpenTeam} />
          )}
          {home && (
            <ClubChip team={home} seed={series.home.seed} record={recordOf(home.id)}
              winP={odds && !series.winner ? odds.homeWinP : null} onOpenTeam={onOpenTeam} />
          )}
        </Box>

        {/* The state of the series, but only when it is more than the format: the eyebrow above
            already says "best of 3", so an unplayed series was printing that twice, once as a
            heading and once as a sentence. */}
        {(series.summary !== `Best of ${series.bestOf}` || odds?.eliminationFor) && (
          <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.secondary', lineHeight: 1.45 }}>
            {series.summary !== `Best of ${series.bestOf}` ? series.summary : ''}
            {odds?.eliminationFor ? `${series.summary !== `Best of ${series.bestOf}` ? ' · ' : ''}${odds.eliminationFor.name} face elimination.` : ''}
          </Typography>
        )}

        {/* TWO COLUMNS FROM md UP, and the split is by KIND rather than by length: the left is
            what is going to happen and what already has, the right is how the two clubs measure
            up. Either column reads on its own, which is what lets them stack on a phone in that
            same order without anything being orphaned. */}
        <Box sx={{
          display: 'grid', gap: { xs: 2.25, md: 3 }, alignItems: 'start',
          gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
        }}>
        <Box sx={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2.25 }}>
        <Box>
          <SectionLabel>Game schedule</SectionLabel>
          <Box sx={{ mt: 0.5 }}><SeriesSchedule series={series} /></Box>
        </Box>

        {meetings.length > 0 && (
          <Box>
            <SectionLabel>{h2hLine ? `Regular season matchup · ${h2hLine}` : 'Regular season matchup'}</SectionLabel>
            <Box sx={{ mt: 0.5, display: 'flex', flexDirection: 'column' }}>
              {meetings.map(g => {
                const homeWon = (g.home_score ?? 0) > (g.away_score ?? 0)
                const ht = teams.find(x => x.id === g.home_team_id)
                const at = teams.find(x => x.id === g.away_team_id)
                /* EACH GAME AS IT WAS PLAYED, away at home, rather than the winner and a
                scoreline. A date on the far left and "SF 13-7" on the far right leaves 250px of
                nothing between them, which is a lot of width spent on less information: it never
                says where the game was, and in a series where one club won all five it prints that
                club's name five times. This says who was at home, which is the same thing the
                schedule block above says about the games still to come, and it fills the row it is
                given. */
                const sideText = (team: WpblTeam | undefined, score: number | null, won: boolean) => (
                  <Typography sx={{
                    // A step up on a desktop, where this block sits in a 430px column with
                    // room to spare and was reading as a footnote beside the comparison
                    // bars next to it. A phone has no such room and keeps the smaller size.
                    fontSize: { xs: TYPE_SCALE.body, md: TYPE_SCALE.title }, whiteSpace: 'nowrap',
                    fontWeight: won ? 900 : 600,
                    color: won && team ? wpblAccent(team.id, dark) : 'text.secondary',
                  }}>{`${team?.abbr ?? '???'} ${score ?? 0}`}</Typography>
                )
                return (
                  <Box
                    key={g.id}
                    {...pressable(onOpenGame ? () => onOpenGame(g) : undefined)}
                    aria-label={onOpenGame
                      ? `${at?.abbr ?? ''} ${g.away_score ?? 0} at ${ht?.abbr ?? ''} ${g.home_score ?? 0}, box score`
                      : undefined}
                    sx={{
                      display: 'flex', alignItems: 'center', gap: { xs: 1, md: 1.25 },
                      py: { xs: 0.55, md: 0.85 }, minWidth: 0,
                      borderTop: '1px solid', borderColor: 'divider',
                      cursor: onOpenGame ? 'pointer' : 'default',
                      ...(onOpenGame ? TAPPABLE : null), ...FOCUS_RING,
                    }}>
                    <Typography sx={{
                      width: { xs: '3rem', md: '3.5rem' }, flexShrink: 0,
                      fontSize: { xs: TYPE_SCALE.body, md: TYPE_SCALE.title },
                      color: 'text.disabled', whiteSpace: 'nowrap',
                    }}>
                      {new Date(`${g.game_date}T00:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                    </Typography>
                    {at && <TeamBadge team={at} size={22} />}
                    {sideText(at, g.away_score, !homeWon)}
                    <Typography sx={{ fontSize: TYPE_SCALE.caption, color: 'text.disabled', flexShrink: 0 }}>@</Typography>
                    {ht && <TeamBadge team={ht} size={22} />}
                    {sideText(ht, g.home_score, homeWon)}
                  </Box>
                )
              })}
            </Box>
          </Box>
        )}
        </Box>

        <Box sx={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2.25 }}>
        {/* The tale of the tape, which is the card that already existed for exactly this and was
            only ever shown for a scheduled GAME. A series is the same question asked once. */}
        {home && away && (
          <Box>
            <SectionLabel>Team comparison</SectionLabel>
            <Box sx={{ mt: 0.5 }}>
              <WpblGamePreview away={away} home={home} teams={teams} games={games} onOpenTeam={onOpenTeam} bare />
            </Box>
          </Box>
        )}

        </Box>
        </Box>

        {/* ACROSS BOTH COLUMNS, because this block is itself two columns. Nested inside one half
        of the sheet each club's list gets about 200px, and every name over eleven characters
        comes out as "Kelsie Whit…", which is most of them, and a leaders list whose leaders
        cannot be read is decoration. Out here each side has the width the names need. */}
        {leaders && (leaders.home.length > 0 || leaders.away.length > 0) && (
          <Box>
            {/* CENTRED OVER THE TABLE, WHICH TAKES BOTH HALVES. The table's own 400 cap puts the
            label in the right BOX, and centring puts the words where the content is. Flush left
            inside that box, the words sit at the left edge of a block whose content pools around
            the middle (each side's leader hugs the category column, so the outer thirds of every
            row are empty): about 250px left of everything they label, at an indent that matches
            nothing else in the sheet, where the two headings above sit on their own columns'
            edges. */}
            <Box sx={{ maxWidth: chromePx(400), mx: 'auto', textAlign: 'center' }}>
              <SectionLabel>Team leaders</SectionLabel>
            </Box>
            {away && home && (
              <LeaderTable away={away} home={home}
                awayLeaders={leaders.away} homeLeaders={leaders.home}
                onOpenPlayer={onOpenPlayer} />
            )}
          </Box>
        )}
      </Box>
    </ModalShell>
  )
}
