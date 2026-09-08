import { useEffect, useMemo, useState } from 'react'
import { Box, Typography } from '@mui/material'
import {
  ModalShell, SectionLabel, TeamBadge, pressable, FOCUS_RING, TAPPABLE, useWpblDark, useWpblName,
  TYPE_SCALE, chromePx,
} from './ui'
import { wpblAccent, wpblSurface, formatGameTime } from './constants'
import { fetchWpblAllLines, getCachedWpblAllLines, fetchWpblAllPlayers, countsInStandings } from './api'
import {
  aggregateBatting, aggregatePitching, wpblQualifiers, plateAppearances, scaleToBasis,
} from './stats'
import { outsToIp } from './innings'
import { useEraBasis } from './EraBasisContext'
import { postseasonGames } from './derive/bracket'
import { WpblGamePreview } from './GamePreview'
import { fmtOdds } from './derive/seriesOdds'
import type { SeriesOdds } from './derive/seriesOdds'
import type { BracketSeries } from './derive/bracket'
import type {
  WpblTeam, WpblGame, WpblPlayer, WpblBattingLine, WpblPitchingLine, WpblStandingRow,
} from './types'

/**
 * One series, opened.
 *
 * WHY THE BOX IS A SINGLE TARGET NOW. Each club row in the bracket used to be its own tap
 * through to that club's page, which made a series box two controls with a third of a control
 * between them, and left the box itself, the thing a reader actually points at, doing nothing.
 * The whole box opens this instead, and the club links live in here where there is room to
 * label them. Nothing is lost by the move: a team page is one tap further away and arrives with
 * the reason to want it already read, and `WPBL_BRACKET_TEAM` still fires from the chips below
 * so the retention number this card is judged on stays comparable.
 *
 * WHAT IT ANSWERS, in the order somebody asks it: who is playing and how likely each of them is,
 * when the games are, what happened when these two met in the season, how the clubs compare, and
 * who to watch on each side. The first four already existed in pieces scattered across the
 * section; the leaders are new, and they are the reason this is a series overview rather than a
 * bigger tooltip.
 *
 * IT FETCHES NOTHING ANYBODY ELSE HAS NOT ALREADY FETCHED. Box-score lines and the league roster
 * are both app-wide caches by the time Home has drawn, so on a warm page this opens with no
 * request at all; on a cold one it asks for the same two reads the rest of the page wants.
 */

/** One club's best in one category, as a line to print. */
interface Leader {
  label: string
  player: WpblPlayer
  value: string
}

/**
 * The clubs' leaders, from the lines played FOR that club.
 *
 * KEYED ON THE LINE'S TEAM AND NEVER ON THE ROSTER ROW, which is the trap this section is built
 * around: `team_id` on a roster row means "now", so a traded player would be listed under the
 * club she finished the season at and be missing from the one she played these games for. A
 * box-score line carries the club that game was played for, which is the question being asked.
 *
 * Rate stats are gated on the same qualifier the leaderboards use, so the club's batting average
 * is not a pinch-hitter who went 2-for-2 in August. Counting stats are not gated, because a home
 * run leader with nine home runs led whether or not she batted enough to hold a rate title.
 */
export function teamLeaders(
  team: WpblTeam,
  players: WpblPlayer[],
  batting: WpblBattingLine[],
  pitching: WpblPitchingLine[],
  games: WpblGame[],
  teams: WpblTeam[],
  eraBasis: 7 | 9,
): Leader[] {
  const qual = wpblQualifiers(teams, games)
  const bats = aggregateBatting(players, batting.filter(l => l.team_id === team.id), games)
  const pits = aggregatePitching(players, pitching.filter(l => l.team_id === team.id), games)

  const best = <T,>(rows: T[], value: (r: T) => number | null, ok: (r: T) => boolean): T | null => {
    let top: T | null = null, topV = -Infinity
    for (const r of rows) {
      if (!ok(r)) continue
      const v = value(r)
      if (v == null || !Number.isFinite(v) || v <= topV) continue
      top = r; topV = v
    }
    return top
  }

  const out: Leader[] = []
  const qualified = (b: typeof bats[number]) => !qual.active || plateAppearances(b.totals) >= qual.minPa

  const avg = best(bats, b => b.totals.avg, qualified)
  if (avg?.totals.avg != null) out.push({ label: 'AVG', player: avg.player, value: avg.totals.avg.toFixed(3).replace(/^0/, '') })

  const ops = best(bats, b => b.totals.ops, qualified)
  if (ops?.totals.ops != null) out.push({ label: 'OPS', player: ops.player, value: ops.totals.ops.toFixed(3) })

  const hr = best(bats, b => b.totals.hr, () => true)
  if (hr && hr.totals.hr > 0) out.push({ label: 'HR', player: hr.player, value: String(hr.totals.hr) })

  const rbi = best(bats, b => b.totals.rbi, () => true)
  if (rbi && rbi.totals.rbi > 0) out.push({ label: 'RBI', player: rbi.player, value: String(rbi.totals.rbi) })

  // Lowest ERA, so the comparison is negated rather than a second `best` that sorts the other
  // way: one ordering rule, inverted at the call site, cannot disagree with itself.
  const era = best(pits, p => (p.totals.era == null ? null : -p.totals.era),
    p => !qual.active || p.totals.outs >= qual.minOuts)
  if (era?.totals.era != null) {
    out.push({ label: 'ERA', player: era.player, value: (scaleToBasis(era.totals.era, eraBasis) ?? 0).toFixed(2) })
  }

  const so = best(pits, p => p.totals.so, () => true)
  if (so && so.totals.so > 0) out.push({ label: 'SO', player: so.player, value: String(so.totals.so) })

  const ip = best(pits, p => p.totals.outs, () => true)
  if (ip && ip.totals.outs > 0) out.push({ label: 'IP', player: ip.player, value: outsToIp(ip.totals.outs) })

  return out
}

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
            on each, so "San Francisco Firebells" on one line ellipsised to "San Franci…" and
            threw the city away, which is the half the bracket's own boxes are already showing.
            Split across two lines nothing is lost and nothing is cut. */}
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.6, minWidth: 0 }}>
          {/* The seed rides the nickname line rather than the meta line below it. Three items
              down there ("San Francisco · 1 seed · 10-5") do not fit beside a percentage in half
              a 560px sheet, and the one that was being cut was the city, which is the whole
              reason this line exists. */}
          {seed != null && (
            <Typography sx={{
              flexShrink: 0, fontSize: TYPE_SCALE.caption, fontWeight: 800, color: 'text.disabled',
              fontVariantNumeric: 'tabular-nums',
            }}>{seed}</Typography>
          )}
          <Typography sx={{
            fontSize: TYPE_SCALE.title, fontWeight: 900, lineHeight: 1.15, minWidth: 0,
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
      {winP != null && (
        <Typography sx={{
          position: 'relative', flexShrink: 0, fontSize: TYPE_SCALE.heading, fontWeight: 900,
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
              // width that string needs and not a hand-picked column. The pixels it was holding
              // are what the matchup on the right needed at the Large text setting, where
              // "BOS @ SF" was coming out as "BOS @ S…".
              width: '2.75rem', flexShrink: 0,
              fontSize: TYPE_SCALE.caption, fontWeight: 900,
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

/** The categories, in the order they are read, so both clubs' rows line up even when one of
 *  them has nobody in a category. A club with no home runs all season leaves a dash rather
 *  than shifting every row under it up by one. */
const LEADER_CATEGORIES = ['AVG', 'OPS', 'HR', 'RBI', 'ERA', 'SO', 'IP'] as const

/** The width of the category column between the two clubs. In rem because it is reserving room
 *  for a STRING, and narrower on a phone because the longest label here is three characters and
 *  the two names either side need every pixel: at the Large text setting on a 375px screen the
 *  wider column was the difference between "K. Whitmore" and "K. Whitmor…". */
const LEADER_LABEL_W = { xs: '2rem', sm: '2.5rem' }

/**
 * Both clubs' leaders, with the category down the middle.
 *
 * TWO LISTS SIDE BY SIDE IS NOT A COMPARISON. It was that first: one club's seven categories,
 * then the other's, each with its own label column, so reading "who has the better ERA" meant
 * finding ERA twice and holding the first number while you looked for the second. The category
 * sits between the two now and each club's leader reads outward from it, which is exactly the
 * shape of the team comparison directly above and lets the two blocks be read the same way.
 *
 * AWAY ON THE LEFT, HOME ON THE RIGHT, matching that comparison rather than the bracket: the
 * two blocks are inches apart and a reader who has just learned which side is which should not
 * have to learn it again.
 */
function LeaderTable({ away, home, awayLeaders, homeLeaders, onOpenPlayer }: {
  away: WpblTeam; home: WpblTeam
  awayLeaders: Leader[]; homeLeaders: Leader[]
  onOpenPlayer?: (p: WpblPlayer) => void
}) {
  const dark = useWpblDark()
  // The section's own answer to a long name in a narrow column: "Kelsie Whitmore" on a desktop,
  // "K. Whitmore" on a phone, where two names and a label share 375px.
  const shortName = useWpblName()
  const byLabel = (rows: Leader[]) => new Map(rows.map(r => [r.label, r]))
  const A = byLabel(awayLeaders), H = byLabel(homeLeaders)
  const rows = LEADER_CATEGORIES.filter(c => A.has(c) || H.has(c))
  if (rows.length === 0) return null

  const side = (l: Leader | undefined, team: WpblTeam, align: 'left' | 'right') => (
    <Box
      {...pressable(l && onOpenPlayer ? () => onOpenPlayer(l.player) : undefined)}
      sx={{
        flex: 1, minWidth: 0, borderRadius: 1, px: 0.5, py: 0.2,
        display: 'flex', alignItems: 'baseline', gap: 0.75,
        flexDirection: align === 'right' ? 'row' : 'row-reverse',
        cursor: l && onOpenPlayer ? 'pointer' : 'default',
        ...(l && onOpenPlayer ? TAPPABLE : null), ...FOCUS_RING,
      }}
    >
      <Typography sx={{
        flex: 1, minWidth: 0, fontSize: TYPE_SCALE.body, fontWeight: 600,
        textAlign: align, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        color: l ? 'text.primary' : 'text.disabled',
      }}>{l ? shortName(l.player.name) : '—'}</Typography>
      <Typography sx={{
        flexShrink: 0, fontSize: TYPE_SCALE.body, fontWeight: 900,
        fontVariantNumeric: 'tabular-nums', color: l ? wpblAccent(team.id, dark) : 'text.disabled',
      }}>{l ? l.value : ''}</Typography>
    </Box>
  )

  const head = (team: WpblTeam, align: 'left' | 'right') => (
    <Box sx={{
      flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 0.6,
      justifyContent: align === 'right' ? 'flex-end' : 'flex-start',
    }}>
      {align === 'left' && <TeamBadge team={team} size={18} />}
      <Typography sx={{
        fontSize: TYPE_SCALE.caption, fontWeight: 900, letterSpacing: 0.5, textTransform: 'uppercase',
        color: wpblAccent(team.id, dark), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>{team.name}</Typography>
      {align === 'right' && <TeamBadge team={team} size={18} />}
    </Box>
  )

  return (
    /* CAPPED AND CENTRED, AND THE CAP IS MEASURED. Each side's leader hugs the category down
       the middle, so at the sheet's full width the rules ran the whole card while the text sat
       in the middle third: 725px wide, each side 328px holding 178px of "Kelsie Whitmore
       1.669", which is 150px of empty card inside every row, twice. 500px puts each side at
       217px, which clears the widest pair at the default text size and still clears it at the
       Large setting, where the same string grows to about 200px. What is left goes outside as
       margin, where it reads as a centred comparison rather than a row with a hole at each
       end. `chromePx` because a cap on a block is a structural length and not room reserved
       for a string, so it follows the desktop chrome scale and not the reader's text size. */
    <Box sx={{ mt: 0.75, maxWidth: chromePx(400), mx: 'auto' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
        {head(away, 'right')}
        {/* Holds the label column's width on the header row, so the two club names sit exactly
            over the two sides they label. */}
        <Box sx={{ width: LEADER_LABEL_W, flexShrink: 0 }} />
        {head(home, 'left')}
      </Box>
      {rows.map(c => (
        <Box key={c} sx={{
          display: 'flex', alignItems: 'baseline', gap: 1, minWidth: 0,
          py: 0.3, borderTop: '1px solid', borderColor: 'divider',
        }}>
          {side(A.get(c), away, 'right')}
          <Typography sx={{
            width: LEADER_LABEL_W, flexShrink: 0, textAlign: 'center',
            fontSize: TYPE_SCALE.caption, fontWeight: 900, letterSpacing: 0.4,
            color: 'text.disabled',
          }}>{c}</Typography>
          {side(H.get(c), home, 'left')}
        </Box>
      ))}
    </Box>
  )
}

export default function SeriesPreview({ series, odds, teams, games, rows, onClose, onOpenTeam, onOpenPlayer }: {
  series: BracketSeries
  odds?: SeriesOdds
  teams: WpblTeam[]
  games: WpblGame[]
  rows: WpblStandingRow[]
  onClose: () => void
  onOpenTeam?: (t: WpblTeam) => void
  onOpenPlayer?: (p: WpblPlayer) => void
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
    // column 1,348px long. Measured at 1600x1000 before this: the card ran the full height of
    // the screen with half its content below the fold, in a 560px ribbon with a thousand pixels
    // of empty page either side of it.
    <ModalShell sheet eyebrow={`${series.label} · best of ${series.bestOf}`}
      maxWidth={{ xs: 560, md: 900 }} onClose={onClose}>
      <Box sx={{ px: 2, py: 1.75, display: 'flex', flexDirection: 'column', gap: 2.25 }}>
        {/* Who, and how likely. The same two facts the bracket box shows, at the size a sheet
            can afford, and the only place in here a club is a link. */}
        {/* STACKED ON A PHONE. Side by side at 375px each chip gets ~160px for a badge, a seed, a
            nickname and a percentage, and the nickname is what gives: "Heights" came out as
            "Hei…" on the one surface where this sheet is most likely to be opened. */}
        <Box sx={{ display: 'flex', gap: 1, minWidth: 0, flexDirection: { xs: 'column', sm: 'row' } }}>
          {home && (
            <ClubChip team={home} seed={series.home.seed} record={recordOf(home.id)}
              winP={odds && !series.winner ? odds.homeWinP : null} onOpenTeam={onOpenTeam} />
          )}
          {away && (
            <ClubChip team={away} seed={series.away.seed} record={recordOf(away.id)}
              winP={odds && !series.winner ? odds.awayWinP : null} onOpenTeam={onOpenTeam} />
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
                   scoreline. The row used to be a date on the far left and "SF 13-7" on the far
                   right with 250px of nothing between them, which is a lot of width spent on
                   less information: it never said where the game was, and in a series where one
                   club won all five it printed that club's name five times. This says who was
                   at home, which is the same thing the schedule block above says about the games
                   still to come, and it fills the row it is given. */
                const sideText = (team: WpblTeam | undefined, score: number | null, won: boolean) => (
                  <Typography sx={{
                    fontSize: TYPE_SCALE.body, whiteSpace: 'nowrap',
                    fontWeight: won ? 900 : 600,
                    color: won && team ? wpblAccent(team.id, dark) : 'text.secondary',
                  }}>{`${team?.abbr ?? '???'} ${score ?? 0}`}</Typography>
                )
                return (
                  <Box key={g.id} sx={{
                    display: 'flex', alignItems: 'center', gap: 1, py: 0.55, minWidth: 0,
                    borderTop: '1px solid', borderColor: 'divider',
                  }}>
                    <Typography sx={{
                      width: '3rem', flexShrink: 0,
                      fontSize: TYPE_SCALE.body, color: 'text.disabled', whiteSpace: 'nowrap',
                    }}>
                      {new Date(`${g.game_date}T00:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                    </Typography>
                    {at && <TeamBadge team={at} size={18} />}
                    {sideText(at, g.away_score, !homeWon)}
                    <Typography sx={{ fontSize: TYPE_SCALE.caption, color: 'text.disabled', flexShrink: 0 }}>@</Typography>
                    {ht && <TeamBadge team={ht} size={18} />}
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
            of the sheet each club's list got about 200px, and every name over eleven characters
            came out as "Kelsie Whit…" — which is most of them, and a leaders list whose leaders
            cannot be read is decoration. Out here each side has the width the names need. */}
        {leaders && (leaders.home.length > 0 || leaders.away.length > 0) && (
          <Box>
            <SectionLabel>Team leaders</SectionLabel>
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
