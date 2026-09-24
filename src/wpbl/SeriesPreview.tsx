import { useEffect, useMemo, useState } from 'react'
import { Box, Typography } from '@mui/material'
import {
  ModalShell, SectionLabel, TeamBadge, pressable, FOCUS_RING, TAPPABLE, hoverOnly, useWpblDark,
  TYPE_SCALE,
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
 * when the games are (and, once played, a way into each one), how the clubs compare, and who to
 * watch on each side. The first three exist in pieces elsewhere in the section; the
 * leaders are the reason this is a series overview rather than a bigger tooltip.
 *
 * IT FETCHES NOTHING ANYBODY ELSE HAS NOT ALREADY FETCHED. Box-score lines and the league roster
 * are both app-wide caches by the time Home has drawn, so on a warm page this opens with no
 * request at all; on a cold one it asks for the same two reads the rest of the page wants.
 */

/** A series' games that have started (final or live), oldest first. Two clubs meet in at most one
 *  series of a four-club bracket (the semifinals are 1v4 and 2v3, and the final takes one club
 *  from each), so every postseason game between them belongs to this series. */
export function seriesGamesStarted(a: string, b: string, games: WpblGame[]): WpblGame[] {
  return games
    .filter(g => !countsInStandings(g) && (g.status === 'final' || g.status === 'live')
      && ((g.home_team_id === a && g.away_team_id === b) || (g.home_team_id === b && g.away_team_id === a)))
    .sort((x, y) => (x.game_date < y.game_date ? -1 : x.game_date > y.game_date ? 1 : 0))
}

function ClubChip({ team, seed, record, winP, wins, won, onOpenTeam }: {
  team: WpblTeam; seed: number | null; record: string | null; winP: number | null
  /** Series wins, shown in the percentage's slot once the odds are gone (a decided series). */
  wins: number | null
  /** Whether this club took the series; the loser's count goes grey. */
  won: boolean
  onOpenTeam?: (t: WpblTeam) => void
}) {
  const dark = useWpblDark()
  const figure = winP != null ? fmtOdds(winP) : wins != null ? String(wins) : null
  return (
    <Box
      {...pressable(onOpenTeam ? () => onOpenTeam(team) : undefined)}
      // The chip's own text is a nickname over a city over a percentage, which a screen reader
      // reads as three fragments. The label says where the tap goes.
      aria-label={onOpenTeam ? `${team.city} ${team.name} team page` : undefined}
      sx={{
        position: 'relative', overflow: 'hidden', flex: 1, minWidth: 0,
        borderRadius: 2, border: '1px solid', borderColor: 'divider', px: 1.5, py: 1.25,
        display: 'flex', alignItems: 'center', gap: 1.25,
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
      <Box sx={{ position: 'relative', flexShrink: 0, display: 'flex' }}><TeamBadge team={team} size={32} /></Box>
      <Box sx={{ position: 'relative', minWidth: 0, flex: 1 }}>
        {/* THE NICKNAME ON TOP AND THE CITY UNDERNEATH, which is not the bracket's answer and
        should not be. Two of these sit side by side inside a 560px sheet with a percentage
        on each, so "San Francisco Firebells" on one line ellipsises to "San Franci…" and
        throws the city away, which is the half the bracket's own boxes are already showing.
        Split across two lines nothing is lost and nothing is cut. */}
        <Typography sx={{
          fontSize: TYPE_SCALE.heading, fontWeight: 900, lineHeight: 1.2, minWidth: 0,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{team.name}</Typography>
        {/* The seed LEADS the meta line, as "1 seed", rather than riding the nickname as a bare
            digit: a lone grey "4" at caption size beside a 900-weight name read as a stray
            character, not a seed. WRAPS RATHER THAN ELLIPSISES: it is the only line in the chip
            that can afford a second row, and at the Large text setting the three items do not
            fit beside a percentage in half a 560px sheet. Cutting it would drop the record,
            which is the half that is not already on the bracket behind this sheet. */}
        <Typography sx={{
          fontSize: TYPE_SCALE.meta, color: 'text.secondary', lineHeight: 1.35, mt: 0.15,
        }}>{[seed != null ? `${seed} seed` : null, team.city, record].filter(Boolean).join(' · ')}</Typography>
      </Box>
      {/* A step BELOW the club name. The chip is about a club and the number is what is said
      about it; a step above, the reader's eye lands on the percentage first, in a row whose
      whole job is to say who is playing. */}
      {figure != null && (
        <Typography sx={{
          position: 'relative', flexShrink: 0, fontSize: TYPE_SCALE.title, fontWeight: 900,
          fontVariantNumeric: 'tabular-nums',
          color: winP != null || won ? wpblAccent(team.id, dark) : 'text.disabled',
        }}>{figure}</Typography>
      )}
    </Box>
  )
}

/** A section's heading, with an optional one-line answer on the right ("SF won 5-0"). The answer
 *  used to be glued onto the label ("REGULAR SEASON MATCHUP · SF WON IT 5-0"), which put a result
 *  in the smallest, faintest, all-caps type on the card; or it floated alone above the columns as
 *  a sentence with no heading at all. */
function SectionHead({ label, detail }: { label: string; detail?: string | null }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1.5, minWidth: 0 }}>
      <SectionLabel>{label}</SectionLabel>
      {detail && (
        <Typography sx={{
          fontSize: TYPE_SCALE.meta, fontWeight: 700, color: 'text.secondary',
          textAlign: 'right', minWidth: 0, lineHeight: 1.35,
        }}>{detail}</Typography>
      )}
    </Box>
  )
}

// No weekday: five tiles across a desktop sheet leave "Wed, Sep 16" cut to "Wed, Se…" beside the
// game number, and the date is the half of that string anyone is reading for.
const dayOf = (date: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' })

/** One club's line on a game tile. */
interface TileSide { team: WpblTeam | null | undefined; score?: number | null; won?: boolean }

/** What a tile can say about its game, which decides everything about how it is drawn. */
type TileState = 'final' | 'live' | 'upcoming' | 'unneeded'

/** ONE GAME OF THE SERIES AS A SCOREBOARD TILE, and the tile is the way into its Game Center.
 *
 *  WHY TILES AND NOT ROWS. Home's scoreboard is gone for the offseason, so this sheet is now the
 *  route from the bracket to a postseason box score, and a hairline row with a hover tint did not
 *  read as something to press: it looked like a table. A bordered tile with the two clubs stacked
 *  the way every scoreboard stacks them, and a "Box score ›" in the link colour at its foot, says
 *  what it does before anybody hovers. A game still to come gets the same frame with no link, so
 *  the difference between the two is the link and nothing else.
 *
 *  THE SCORE COLUMN IS rem, not chrome px, because it reserves room for a number. */
function GameTile({ n, date, time, state, away, home, onOpen, ariaLabel }: {
  n: number
  date: string | null
  time?: string | null
  state: TileState
  /** Null when the league has not said who bats last (the championship's published fixtures). */
  away: TileSide | null
  home: TileSide | null
  onOpen?: () => void
  ariaLabel?: string
}) {
  const dark = useWpblDark()
  const line = ({ team, score, won }: TileSide) => {
    const decided = state === 'final'
    const color = decided && won && team ? wpblAccent(team.id, dark) : decided ? 'text.secondary' : 'text.primary'
    const weight = decided && won ? 900 : 700
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
        {team && <TeamBadge team={team} size={22} />}
        <Typography sx={{ flex: 1, minWidth: 0, fontSize: TYPE_SCALE.title, fontWeight: weight, color, whiteSpace: 'nowrap' }}>
          {team?.abbr ?? 'TBD'}
        </Typography>
        {score != null && (
          <Typography sx={{
            minWidth: '1.4rem', textAlign: 'right', fontSize: TYPE_SCALE.title, fontWeight: weight, color,
            fontVariantNumeric: 'tabular-nums',
          }}>{score}</Typography>
        )}
      </Box>
    )
  }
  const micro = {
    fontSize: TYPE_SCALE.micro, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', whiteSpace: 'nowrap',
  } as const

  return (
    <Box
      {...pressable(onOpen)}
      aria-label={onOpen ? ariaLabel : undefined}
      sx={{
        minWidth: 0, borderRadius: 2, p: 1.25, display: 'flex', flexDirection: 'column', gap: 1,
        border: '1px solid', borderColor: 'divider',
        // Hidden on a phone, where the grid is two across and a swept best-of-3's third tile
        // would take a row of its own to say nothing was played.
        ...(state === 'unneeded' ? { borderStyle: 'dashed', opacity: 0.55, display: { xs: 'none', sm: 'flex' } } : null),
        ...(onOpen ? {
          cursor: 'pointer', transition: 'background 0.12s, border-color 0.12s',
          ...hoverOnly({ bgcolor: 'action.hover', borderColor: 'text.disabled' }),
        } : null),
        ...FOCUS_RING,
      }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1, minWidth: 0 }}>
        <Typography sx={{ ...micro, color: 'text.secondary' }}>{`Game ${n}`}</Typography>
        {date && (
          <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.disabled', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {dayOf(date)}
          </Typography>
        )}
      </Box>

      {state === 'unneeded' ? (
        <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.disabled', py: 1.1, textAlign: 'center' }}>Not needed</Typography>
      ) : away && home ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.6 }}>
          {line(away)}
          {line(home)}
        </Box>
      ) : (
        <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.disabled', py: 1.1, textAlign: 'center' }}>Matchup to come</Typography>
      )}

      {state !== 'unneeded' && (
        <Box sx={{
          display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1, minWidth: 0,
          pt: 0.75, borderTop: '1px solid', borderColor: 'divider',
        }}>
          {state === 'live' ? (
            <Typography sx={{ ...micro, color: 'error.main' }}>● Live</Typography>
          ) : state === 'final' ? (
            <Typography sx={{ ...micro, color: 'text.disabled' }}>Final</Typography>
          ) : (
            <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', whiteSpace: 'nowrap' }}>{time ?? 'Time TBA'}</Typography>
          )}
          {onOpen && (
            <Typography sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 700, color: 'primary.main', whiteSpace: 'nowrap' }}>
              {state === 'live' ? 'Watch ›' : 'Box score ›'}
            </Typography>
          )}
        </Box>
      )}
    </Box>
  )
}

/** Every game of the series as a tile: the ones played, the published fixtures still to come, and
 *  once the series is decided the ones it did not need.
 *
 *  THE LEAGUE PUBLISHES A SEAT, NOT A CLUB ("higher" or "lower" seed bats last), which is what
 *  makes a fixture printable before anyone knows who is in it. The championship's five carry no
 *  seat at all, because the league has not said which end of the bracket bats last in which game,
 *  and a guessed "@" is exactly what that field exists not to print.
 *
 *  THE TILE COUNT IS THE FORMAT, so the grid is always the shape of the series: a best-of-3 swept
 *  in two still draws three tiles, the third marked "Not needed". Dropping it left two tiles
 *  stranded at the left of a row built for five, and "won in two" is worth seeing anyway. */
function SeriesGames({ series, played, teams, onOpenGame }: {
  series: BracketSeries
  /** This series' games that have started, in order (see `seriesGamesStarted`). */
  played: WpblGame[]
  teams: WpblTeam[]
  onOpenGame?: (g: WpblGame) => void
}) {
  // A played game takes its published slot's place, counted in order rather than matched on the
  // date, so a rain-out that moves game 2 by a day still lands on "Game 2".
  const published = postseasonGames(series.round, series.key)
  const higher = series.home.team
  const lower = series.away.team
  const slots = Math.max(series.bestOf, played.length)
  if (slots === 0) return null

  const tiles = Array.from({ length: slots }, (_, i) => {
    const n = i + 1
    const g = played[i]
    if (g) {
      const at = teams.find(t => t.id === g.away_team_id)
      const ht = teams.find(t => t.id === g.home_team_id)
      const live = g.status === 'live'
      const a = g.away_score ?? 0, h = g.home_score ?? 0
      return (
        <GameTile key={g.id} n={n} date={g.game_date} state={live ? 'live' : 'final'}
          away={{ team: at, score: a, won: a > h }} home={{ team: ht, score: h, won: h > a }}
          onOpen={onOpenGame ? () => onOpenGame(g) : undefined}
          ariaLabel={`Game ${n}: ${at?.abbr ?? ''} ${a} at ${ht?.abbr ?? ''} ${h}${live ? ', in progress' : ''}, box score`} />
      )
    }
    if (series.winner) return <GameTile key={`n${n}`} n={n} date={null} state="unneeded" away={null} home={null} />
    const p = published.find(x => x.game === n)
    const host = p?.home === 'higher' ? higher : p?.home === 'lower' ? lower : null
    const guest = p?.home === 'higher' ? lower : p?.home === 'lower' ? higher : null
    return (
      <GameTile key={`n${n}`} n={n} date={p?.date ?? null} time={p ? formatGameTime(p.date, p.time) : null}
        state="upcoming"
        away={host && guest ? { team: guest } : null} home={host && guest ? { team: host } : null} />
    )
  })

  return (
    <Box sx={{
      display: 'grid', gap: 1,
      // The whole series on one row on a desktop, which is what a series looks like on a
      // scoreboard. Two to a row on a phone and three in a 560px sheet, where five across would
      // leave each tile narrower than a badge, an abbreviation and a two-digit score.
      gridTemplateColumns: {
        xs: 'repeat(2, minmax(0, 1fr))',
        sm: `repeat(${Math.min(slots, 3)}, minmax(0, 1fr))`,
        md: `repeat(${slots}, minmax(0, 1fr))`,
      },
    }}>
      {tiles}
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
  /** Open one of this series' games in Game Center. Optional: without it the tiles are still
   *  worth reading, they just stop being a way in. */
  onOpenGame?: (g: WpblGame) => void
}) {
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

  const played = useMemo(
    () => (home && away ? seriesGamesStarted(home.id, away.id, games) : []),
    [home, away, games])
  const seriesFinals = useMemo(() => played.filter(g => g.status === 'final'), [played])

  // SERIES LEADERS ONCE A GAME OF IT IS FINAL, the season's before that. Before first pitch the
  // season is the only evidence of who to watch; after it, the sheet is about this series, and a
  // club's season leader who has gone 1-for-12 in it is not who led it. The switch waits for a
  // FINAL, not a live game, because a line in progress would make the board move mid-inning.
  const seriesScope = seriesFinals.length > 0 && !!home && !!away
  const leaders = useMemo(() => {
    if (!lines || players.length === 0) return null
    const of = (t: WpblTeam) => seriesScope
      ? teamLeaders(t, players, lines.batting, lines.pitching, seriesFinals, [away!, home!], eraBasis, 'postseason')
      : teamLeaders(t, players, lines.batting, lines.pitching, games, teams, eraBasis)
    return { home: home ? of(home) : [], away: away ? of(away) : [] }
  }, [lines, players, games, teams, home, away, eraBasis, seriesScope, seriesFinals])

  // The state of the series, but only when it is more than the format: the eyebrow already says
  // "best of 3", so an unplayed series would print that twice.
  const stateLine = [
    series.summary !== `Best of ${series.bestOf}` ? series.summary : null,
    odds?.eliminationFor ? `${odds.eliminationFor.name} face elimination` : null,
  ].filter(Boolean).join(' · ') || null

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
        other way round from the game tiles (away over home), the team comparison ("BOS vs SF") and
        the leaders (Boston on the left). Away first everywhere is also how a baseball line
        reads. */}
        <Box sx={{ display: 'flex', gap: 1, minWidth: 0, flexDirection: { xs: 'column', sm: 'row' } }}>
          {away && (
            <ClubChip team={away} seed={series.away.seed} record={recordOf(away.id)}
              winP={odds && !series.winner ? odds.awayWinP : null}
              wins={series.played > 0 ? series.away.wins : null} won={series.winner?.id === away.id}
              onOpenTeam={onOpenTeam} />
          )}
          {home && (
            <ClubChip team={home} seed={series.home.seed} record={recordOf(home.id)}
              winP={odds && !series.winner ? odds.homeWinP : null}
              wins={series.played > 0 ? series.home.wins : null} won={series.winner?.id === home.id}
              onOpenTeam={onOpenTeam} />
          )}
        </Box>

        {/* THE GAMES FIRST AND ACROSS THE WHOLE SHEET. They are what a reader came from the
            bracket to open, now that Home has no scoreboard to open them from, and a row of tiles
            is the one block here that wants the full width rather than a column of it. */}
        <Box>
          <SectionHead label="Games" detail={stateLine} />
          <SeriesGames series={series} played={played} teams={teams} onOpenGame={onOpenGame} />
        </Box>

        {/* TWO COLUMNS FROM md UP: how the clubs measure up, and who to watch on each. Both are
            "away on the left, home on the right" boards of about the same height, so side by side
            they read as one comparison. */}
        <Box sx={{
          display: 'grid', gap: { xs: 2.25, md: 3.5 }, alignItems: 'start',
          // The leaders get the wider half. Their names are the one thing on this sheet that
          // cannot be shortened without losing who it is ("Joely Leguiz…" at an even split), and
          // the comparison's bars give up the difference without anyone noticing.
          gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 2fr) minmax(0, 3fr)' },
        }}>
          {/* The tale of the tape, which is the card that already existed for exactly this and
              was only ever shown for a scheduled GAME. A series is the same question asked once. */}
          {home && away && (
            <Box sx={{ minWidth: 0 }}>
              <SectionHead label="Team comparison" />
              <WpblGamePreview away={away} home={home} teams={teams} games={games} onOpenTeam={onOpenTeam} bare />
            </Box>
          )}
          {leaders && away && home && (leaders.home.length > 0 || leaders.away.length > 0) && (
            <Box sx={{ minWidth: 0 }}>
              <SectionHead label={seriesScope ? 'Series leaders' : 'Team leaders'} />
              <LeaderTable away={away} home={home}
                awayLeaders={leaders.away} homeLeaders={leaders.home}
                onOpenPlayer={onOpenPlayer} />
            </Box>
          )}
        </Box>
      </Box>
    </ModalShell>
  )
}
