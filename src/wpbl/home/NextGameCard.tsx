import { useDark } from '../../ui/useDark'
import { useEffect, useMemo, useState } from 'react'
import { Box, Typography, Switch } from '@mui/material'
import { NotificationsActiveOutlined, NotificationsNoneOutlined, EventAvailableOutlined } from '@mui/icons-material'
import { useAuth } from '../../AuthContext'
import { pushSupported, pushConfigured, notificationPermission } from '../../lib/push'
import { getCachedAllGamesPref, fetchAllGamesPref, setAllGamesPref } from '../reminders'
import { computeStandings, countsInStandings,
} from '../api'
import { wpblSurface, wpblFullName, formatGameTime, gameStartMs, relativeDayLabel } from '../constants'
import { useWpblGameLink } from '../LinkContext'
import { SectionCard, TeamBadge, TAPPABLE, pressable, TYPE_SCALE, ICON_SIZE, CLUB_BAND, cardFooterBand } from '../ui'
import { type PostseasonScheduleRow } from '../derive/bracket'
import { track, EVENTS } from '../../lib/analytics'
import FeedDelayNote from '../FeedDelayNote'
import { WpblGamePreview } from '../GamePreview'
import { seriesContext } from '../derive/series'
import type { SeriesContext } from '../derive/series'
import type { WpblTeam, WpblPlayer, WpblGame } from '../types'
import { typePx } from '../../ui/scale'
import { useWpblSeason } from '../SeasonContext'
import { seasonOf, gamesInSeason } from '../season'
import { Countdown } from './shared'
import { SeasonRecapPreviewCard } from './ChampionCards'
import { nextPostseasonRow, NextPostseasonCard } from './NextPostseasonCard'

// Build a downloadable .ics so anyone can get a calendar reminder where Web Push isn't
// available (most mobile browsers), with no account needed. Mirrors the push timing with a
// 30-min-before alarm: a timed event when we know first pitch, else an all-day event.

function makeGameIcs(game: WpblGame, title: string, startMs: number | null): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const utc = (d: Date) =>
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//sportydolphin//WPBL//EN', 'BEGIN:VEVENT',
    `UID:wpbl-${game.id}@sportydolphin`, `DTSTAMP:${utc(new Date())}`,
  ]
  if (startMs != null) {
    lines.push(`DTSTART:${utc(new Date(startMs))}`, `DTEND:${utc(new Date(startMs + 3 * 3600000))}`)
  } else {
    lines.push(`DTSTART;VALUE=DATE:${game.game_date.replace(/-/g, '')}`)
  }
  lines.push(`SUMMARY:${title}`)
  if (startMs != null) lines.push('BEGIN:VALARM', 'TRIGGER:-PT30M', 'ACTION:DISPLAY', `DESCRIPTION:${title}`, 'END:VALARM')
  lines.push('END:VEVENT', 'END:VCALENDAR')
  return lines.join('\r\n')
}

function downloadIcs(filename: string, ics: string) {
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  URL.revokeObjectURL(url)
}

// Opt-in row under the matchup: a Web Push reminder before every WPBL game's first pitch. A
// standing preference (user_preferences.notify_wpbl_all_games) that the server cron
// (scripts/send-wpbl-game-start.mjs) expands into a reminder for each scheduled game; that
// sender still honors legacy per-game wpbl_game_reminders rows.
//
// Signed out, the whole row prompts sign-in: Web Push is user-scoped, so there's no anonymous
// reminder to store.
function GameReminderRow({ game, away, home, startMs }: {
  game: WpblGame; away?: WpblTeam; home?: WpblTeam; startMs: number | null
}) {
  const { user, openAuthDialog } = useAuth()
  const isDark     = useDark()
  const supported  = pushSupported()
  const configured = pushConfigured()

  // Seed from the session cache so a remount shows the right switch state on the first frame:
  // no off-to-on flicker, no refetch per visit.
  const [on,   setOn]   = useState(() => (user ? getCachedAllGamesPref() : false))
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(() => !user)
  const [perm, setPerm] = useState<ReturnType<typeof notificationPermission>>('default')
  const [err,  setErr]  = useState('')

  // localStorage paints the right state on the first frame (Home unmounts on every tab
  // swipe), then the account value confirms or corrects it.
  useEffect(() => {
    setErr(''); setPerm(notificationPermission())
    if (!user) { setOn(false); setReady(true); return }
    setOn(getCachedAllGamesPref())
    let cancelled = false
    fetchAllGamesPref(user.id)
      .then(pref => { if (!cancelled && pref !== null) setOn(pref) })
      .finally(() => { if (!cancelled) setReady(true) })
    return () => { cancelled = true }
    // Keyed on the account, not the object, which Supabase replaces on every token refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  const handleToggle = async (next: boolean) => {
    if (!user) { openAuthDialog('signin'); return }
    if (busy) return
    setBusy(true); setErr('')
    const error = await setAllGamesPref(user.id, next)
    if (error) {
      setErr(error)
      // Leave the switch where it was: claiming "on" while nothing can deliver is worse
      // than showing it failed.
      setOn(!next)
    } else {
      setOn(next)
      track(next ? EVENTS.WPBL_GAME_REMINDER_ON : EVENTS.WPBL_GAME_REMINDER_OFF,
        { scope: 'all' }, user.id)
    }
    setPerm(notificationPermission())
    setBusy(false)
  }

  // Where Web Push can't work at all (most mobile browsers, or an unconfigured deploy), offer a
  // calendar download instead of dead-ending on "this browser can't do notifications". It needs no
  // account and works everywhere, with the same 30-min heads-up.
  if (!supported || !configured) {
    const title = `${away ? wpblFullName(away) : 'Away'} @ ${home ? wpblFullName(home) : 'Home'} · WPBL`
    return (
      <Box
        {...pressable(() => { track(EVENTS.WPBL_GAME_CALENDAR, { gameId: game.id }); downloadIcs(`wpbl-${game.id}.ics`, makeGameIcs(game, title, startMs)) })}
        sx={{ ...cardFooterBand(isDark), cursor: 'pointer', ...TAPPABLE }}
      >
        <EventAvailableOutlined sx={{ fontSize: ICON_SIZE.md, flexShrink: 0, color: 'var(--wpbl-accent-fg)' }} />
        <Typography noWrap title="Saves the game with a 30-min heads-up before first pitch."
          sx={{ flex: 1, minWidth: 0, fontSize: TYPE_SCALE.body, fontWeight: 700, lineHeight: 1.2 }}>
          Add to calendar
        </Typography>
      </Box>
    )
  }

  // When signed in, the switch is the control; when signed out, the whole row taps
  // through to sign-in (a switch has nothing to toggle yet).
  const blocked = !!user && (!supported || !configured || perm === 'denied')

  // ONE LINE, IN EVERY STATE, AND THE STRING HAS A MEASURED BUDGET: 183px, which is a 320px phone
  // at the reader's Large text setting minus the bell, the switch and two gaps. Every string below
  // is measured against it, which is why they are as short as they are: the switch is the verb,
  // and the line only says what it turns on. Leave headroom, because a string that fits a mock-up
  // exactly wraps on a real handset. Anything over budget ellipsises rather than wrapping, so it
  // cannot silently grow a second line, and `title` carries the full sentence.
  //
  // The status REPLACES the offer instead of stacking under it. A reader whose browser has blocked
  // notifications does not need to be told what they would get; they need to know why the switch
  // beside them is dead.
  //
  // (`!supported` and `!configured` are unreachable here: they return the calendar row above.)
  let label = 'All games, 30 min early'
  let hint  = 'A push reminder 30 minutes before every WPBL game.'
  let tone: 'primary' | 'secondary' | 'error' = 'primary'
  if (busy)                   { label = 'Working…'; tone = 'secondary' }
  else if (err)               { label = err; hint = err; tone = 'error' }
  else if (perm === 'denied') { label = 'Notifications blocked'; tone = 'secondary'
                                hint = 'Turn notifications on for this site in your browser settings.' }
  else if (!user)             { label = 'Sign in for reminders'; tone = 'secondary'
                                hint = 'Web Push is tied to an account, so there is nobody to remind yet.' }

  const Icon = on ? NotificationsActiveOutlined : NotificationsNoneOutlined

  return (
    <Box
      {...pressable(!user ? () => openAuthDialog('signin') : undefined)}
      sx={{ ...cardFooterBand(isDark), ...(!user ? { cursor: 'pointer', ...TAPPABLE } : {}) }}
    >
      <Icon sx={{ fontSize: ICON_SIZE.md, flexShrink: 0, color: on ? 'var(--wpbl-accent-fg)' : 'text.disabled' }} />
      {/* THE OFFER IS BOLD, A STATUS IS NOT. "All games, 30 min early" is a thing to do and
          carries the weight of one. "Notifications blocked" and "Sign in for reminders" are
          states, and at the same 700 they were louder than the season-series line on a card
          whose subject is a baseball game. Same row, same size, one step down in weight. */}
      <Typography noWrap title={hint} sx={{
        flex: 1, minWidth: 0, fontSize: TYPE_SCALE.body, fontWeight: tone === 'primary' ? 700 : 600, lineHeight: 1.25,
        color: tone === 'error' ? 'error.main' : tone === 'secondary' ? 'text.secondary' : 'text.primary',
      }}>
        {label}
      </Typography>
      {user && (
        <Switch
          size="small"
          checked={on}
          disabled={busy || blocked || !ready}
          onChange={e => handleToggle(e.target.checked)}
          sx={{ flexShrink: 0, my: -0.5 }}
        />
      )}
    </Box>
  )
}

// Head-to-head record between two clubs this season. Deliberately filtered the same way
// `computeStandings` filters, decisive regular-season finals only, so the series line and the
// standings table sitting beside it can never tell a reader two different stories about the
// same games. That includes the postseason: two clubs meeting five times in a championship
// series have not played a fifteen-game season series, and a line saying so next to a 3-4
// record would be nonsense. Null before the two have met, which is a real state early in a
// season and reads better as nothing than as "0–0".
function seasonSeries(games: WpblGame[], homeId: string, awayId: string): { homeWins: number; awayWins: number } | null {
  let homeWins = 0, awayWins = 0
  for (const g of games) {
    if (g.status !== 'final' || g.home_score == null || g.away_score == null || g.home_score === g.away_score) continue
    if (!countsInStandings(g)) continue
    const involvesBoth = (g.home_team_id === homeId && g.away_team_id === awayId)
      || (g.home_team_id === awayId && g.away_team_id === homeId)
    if (!involvesBoth) continue
    const winner = g.home_score > g.away_score ? g.home_team_id : g.away_team_id
    if (winner === homeId) homeWins++; else awayWins++
  }
  return homeWins + awayWins === 0 ? null : { homeWins, awayWins }
}

// HOW MANY RESULTS THE FORM STRIP DRAWS, AND WHY IT IS FIFTEEN.
//
// It is the whole season, and it is also the most that provably fits. A WPBL regular season is
// 15 games a club, so the strip is a season at a glance rather than a peephole onto the last few.
//
// The number is a WIDTH, though, not a fact about the schedule, so it is derived from the
// narrowest screen the site supports rather than from the fixture list. At 320px: 32px of page
// gutter and 32px of card padding leave 256, the club abbreviation and the record take 78
// between them with their gaps, and 178 remain. At a 9px dot on a 3px pitch that is
// `12n - 3 <= 178`, so 15. A longer season would show its most recent 15, which is still a form
// guide; a wider dot or a fatter gap would silently push the record off the row, so change
// either of those and redo this arithmetic.
const FORM_DOTS = 15

/** A club's last `n` decided results before `beforeMs`, oldest first, as won/lost.
 *
 *  Filtered exactly as `seasonSeries` and `computeStandings` are, decisive regular-season
 *  finals only, for the same reason: this sits two rows above a record that comes out of
 *  `computeStandings`, and a form strip counting games that record does not is a card
 *  disagreeing with itself.
 *
 *  Ordered by start time rather than by date alone, because the feed publishes a timezone twin
 *  of every game (see the ingest note) and two rows sharing a date have to break their tie on
 *  something stable or the strip reshuffles between paints.
 */
function recentForm(games: WpblGame[], teamId: string, beforeMs: number, n = FORM_DOTS): boolean[] {
  return games
    .filter(g => g.status === 'final' && g.home_score != null && g.away_score != null
      && g.home_score !== g.away_score && countsInStandings(g)
      && (g.home_team_id === teamId || g.away_team_id === teamId))
    .map(g => ({ g, ms: gameStartMs(g.game_date, g.start_time) ?? 0 }))
    .filter(x => x.ms < beforeMs)
    .sort((a, b) => a.ms - b.ms || a.g.id.localeCompare(b.g.id))
    .slice(-n)
    .map(({ g }) => (g.home_score! > g.away_score! ? g.home_team_id : g.away_team_id) === teamId)
}

/**
 * What Next game says about the fixture, under the clock: the series it belongs to, and the
 * one sentence describing where that series stands.
 *
 * THE POSTSEASON IS A DIFFERENT SERIES. `seasonSeries` filters through `countsInStandings`, so it
 * only ever counts regular-season meetings: during a semifinal it would read "Season series tied
 * 2-2", the summer's head-to-head, on a card whose entire subject is the game about to be played,
 * while RecapCard directly beneath it names the playoff series.
 *
 * It fails toward the regular season by construction: `seriesContext` returns null for
 * anything `countsInStandings` accepts, and that helper counts everything it does not
 * recognize, so a feed that renames its game types gives this card the regular-season reading
 * rather than a blank one.
 *
 * A PURE FUNCTION AND EXPORTED, so it can be tested without rendering Home: the postseason branch
 * cannot be looked at on the page outside the postseason.
 */
export function nextGameContext(
  game: WpblGame,
  games: WpblGame[],
  teams: Map<string, WpblTeam>,
  /** The game's start, for the form guide's cutoff. Held by the caller, which found the game
   *  by sorting on it. */
  startMs: number,
): { postseason: SeriesContext | null; line: string } {
  const home = teams.get(game.home_team_id)
  const away = teams.get(game.away_team_id)
  const postseason = seriesContext(game, games, teams)

  const series = seasonSeries(games, game.home_team_id, game.away_team_id)
  let seriesLabel: string | null = null
  if (series && home && away) {
    const { homeWins, awayWins } = series
    // Nicknames, matching the standings table next to it rather than the full club names on
    // the rows above: "Boston Hunters lead the season series" says the city twice in one card.
    if (homeWins === awayWins) seriesLabel = `Season series tied ${homeWins}–${awayWins}`
    else seriesLabel = `${homeWins > awayWins ? home.name : away.name} lead the season series `
      + `${Math.max(homeWins, awayWins)}–${Math.min(homeWins, awayWins)}`
  }

  /**
   * The two clubs' current runs, folded into the series line rather than drawn as their own block
   * of dots.
   *
   * NO DOTS HERE. A season-series line, a strip of dots per club and the tale of the tape at about
   * the same weight are three answers to one question, which is a list rather than a hierarchy.
   * The dots earn their space on the Teams page, where they sit in a table row and the shape of a
   * season is the column's whole job.
   *
   * The streak is the part a strip of dots is slowest to yield and the part this card wants, so it
   * is kept as words on a line that is already there. Three and up, the same bar the Teams page
   * uses for the same fact: below three it is something the last two results already say.
   *
   * FORM IS COMPUTED FROM THE SAME `recentForm`, so nothing here can disagree with the strip on the
   * Teams page about what a club's run is.
   */
  const streakClause = (t: WpblTeam | undefined): string | null => {
    if (!t) return null
    const results = recentForm(games, t.id, startMs)
    if (results.length === 0) return null
    let streak = 0
    for (let i = results.length - 1; i >= 0 && results[i] === results[results.length - 1]; i--) streak++
    if (streak < 3) return null
    return `${t.name} have ${results[results.length - 1] ? 'won' : 'lost'} ${streak}`
  }
  // The series first, because it is about the fixture; the runs after, because they are about
  // the clubs. Joined rather than stacked: one sentence at one weight is a thing a reader
  // finishes, where three lines at one weight is a thing they skip.
  //
  // IN THE POSTSEASON THE STREAKS COME OUT. `line` and `stakes` already name a club each, so
  // keeping the form clauses gives "Firebells lead 1-0 · Firebells can clinch · Firebells have
  // won 3", which is one club's name three times in a sentence that only says two things. The
  // series record IS the form guide once the postseason starts, and it is the better one.
  const contextLine = (postseason
    ? [postseason.line, postseason.stakes]
    : [seriesLabel, streakClause(away), streakClause(home)]
  ).filter(Boolean).join(' · ')
  return { postseason, line: contextLine }
}

/**
 * Sizes on this card come from `TYPE_SCALE`, like the rest of the page. The scale, and the test
 * that keeps a raw rem literal out of this file, live in ui.tsx.
 */
export function NextGameCard({ games, teams, postseason: postRows, onOpenGame, players, onOpenPlayer, devForceRecap, devChampion }: {
  games: WpblGame[]; teams: Map<string, WpblTeam>
  /** For the season card's Star of the final, once this slot has become it. */
  players: WpblPlayer[]; onOpenPlayer: (p: WpblPlayer) => void
  /** The dated-but-unpublished postseason, for when the feed has run out of games. */
  postseason: PostseasonScheduleRow[]
  onOpenGame: (g: WpblGame) => void
  /** Dev only: force the season-recap card into this slot regardless of the real schedule, to
   *  simulate the season being over. Always false in production (see WpblHome). */
  devForceRecap?: boolean
  /** Dev only: the simulated champion for that forced card (null while the final is "in progress"). */
  devChampion?: WpblTeam | null
}) {
  const gameLink = useWpblGameLink()
  const isDark = useDark()
  const next = useMemo(() => {
    const now = Date.now()
    const upcoming = games
      .filter(g => g.status !== 'final' && g.status !== 'live')
      .map(g => ({ g, ms: gameStartMs(g.game_date, g.start_time) }))
      .filter((x): x is { g: WpblGame; ms: number } => x.ms != null)
      .sort((a, b) => a.ms - b.ms)
    // The soonest game still ahead (small grace window), else the earliest upcoming.
    return upcoming.find(x => x.ms >= now - 3 * 3600000) ?? upcoming[0] ?? null
  }, [games])
  // The season just played, for the recap and the bracket this card stands in for when there is no
  // next game; and the NEXT GAME'S OWN season for its records and its series line, which in the
  // spring is a year with no results: an Opening Day matchup reads 0–0, not last year's record.
  const { seasonGames } = useWpblSeason(games, { current: true })
  const nextYear = next ? seasonOf(next.g) : null
  const nextGames = useMemo(
    () => (nextYear == null ? seasonGames : gamesInSeason(games, nextYear)), [games, nextYear, seasonGames])

  // Records through `computeStandings` rather than a local count, so the two numbers on these
  // rows are the same two numbers the Standings card renders beside them. A card that
  // disagrees with the table next to it is worse than a card with no records at all.
  const recordOf = useMemo(() => {
    const rows = computeStandings([...teams.values()], nextGames)
    const by = new Map(rows.map(r => [r.team.id, `${r.wins}–${r.losses}`]))
    return (id: string) => by.get(id) ?? null
  }, [teams, nextGames])

  // NO FEED GAME AHEAD IS NOT THE SAME AS NO NEXT GAME. Between the regular season and the league
  // publishing the bracket, `wpbl_games` has nothing ahead, and a null card leaves a hole in the
  // grid on the page a reader opens to find out what is on next. The scoreboard strip above carries
  // the same dated rows; this draws them in the shape this card uses.
  //
  // It retires itself the same way the strip's rows do: `postseasonScheduleRows` drops a row as
  // soon as the feed carries a real game on its date, so the branch below stops being reached
  // without anything having to be deleted.
  // Dev only: the season-finale simulator forces the recap card here regardless of the real
  // schedule, so the end-of-season Home can be seen before the final is played. `import.meta.env.DEV`
  // is first so this whole branch drops from production.
  if (import.meta.env.DEV && devForceRecap) {
    return <SeasonRecapPreviewCard teams={teams} games={seasonGames} devChampion={devChampion} onOpenGame={onOpenGame}
      players={players} onOpenPlayer={onOpenPlayer} />
  }
  // Nothing in the feed ahead falls to the postseason calendar; once THAT is exhausted too, the
  // season is over and this slot becomes the recap card. Same retire-by-emptiness the strip uses,
  // so the pivot happens the moment the final goes live and nothing has to be deleted or dated.
  if (!next) {
    return nextPostseasonRow(postRows)
      ? <NextPostseasonCard rows={postRows} teams={teams} games={seasonGames} />
      : <SeasonRecapPreviewCard teams={teams} games={seasonGames} onOpenGame={onOpenGame} players={players} onOpenPlayer={onOpenPlayer} />
  }
  const g = next.g
  const away = teams.get(g.away_team_id)
  const home = teams.get(g.home_team_id)
  const dateLabel = relativeDayLabel(g.game_date)
  const timeLabel = formatGameTime(g.game_date, g.start_time)

  const { postseason, line: contextLine } = nextGameContext(g, nextGames, teams, next.ms)

  /**
   * The matchup, at headline weight.
   *
   * NOT THE SAME ROW AS LastGameCard's `scoreRow`, deliberately. The two rows carry different
   * weight of fact: LastGameCard's trailing number is the SCORE, which is the whole point of a game
   * that has been played, and this one's is a win-loss record, the least important thing on a card
   * about a game that has not. So the names are 1.2rem/700 and the record 0.72rem/600 in secondary
   * ink, which is the order anyone reads them in.
   *
   * SIZE CARRIES THE HIERARCHY, NOT WEIGHT. 800 at 1.2rem across a saturated band is a poster
   * rather than a card: heavy enough that the letterforms close up and the row reads as a block of
   * ink before it reads as a club. 700 is the weight of the card's own title three steps down in
   * size, which is the point. Not a rule for the section: LastGameCard's winning club stays at 800
   * at a smaller size, where the weight is what says which side won.
   *
   * NO "AWAY" AND "HOME" WORDS, and no "@": the row order says it (see the note on the rows below).
   */
  const teamRow = (t: WpblTeam | undefined) => {
    const record = t ? recordOf(t.id) : null
    return (
      // THE ROW WEARS THE CLUB'S COLOR, so four clubs with real identities are told apart by more
      // than a badge the size of a fingernail.
      //
      // BOTH ROWS, EVEN THOUGH ONE CLUB IS AT HOME. This card is a fixture and the two clubs are
      // equals in it; Last Game tints the winner alone, because that card is a result and there the
      // color is carrying which way it went. Same device, two meanings.
      //
      // NO RADIUS AND NO MARGIN OF ITS OWN: the two rows are cut out of one band (below), so the shape
      // belongs to the band and each row is just a field of color inside it. Two separately shaped
      // pills with a gap between them read as unrelated chips that happen to be stacked, the opposite
      // of what a fixture is.
      <Box sx={{
        display: 'flex', alignItems: 'center', gap: 1,
        px: 2, py: 1,
        bgcolor: t ? wpblSurface(t.id, isDark) : 'transparent',
      }}>
        {t && <TeamBadge team={t} size={30} />}
        {/* NO "@", AND NOTHING IN ITS PLACE. Inline it pushes only one of the two names out of
            line, and given a reserved slot it becomes a column of mostly nothing on a card whose
            whole point is two big names.

            Away on top, home underneath, which is the order the Scoreboard strip at the top of
            this page uses with no marker, and the order every schedule in the sport is written
            in. The full fixture is one tap away on the game page. What is lost is that a reader
            who does not know the convention cannot tell who is at home from this card alone;
            what is gained is that the two club names line up. */}
        {/* NOT `flex: 1`. The name takes the width it needs so the record can sit against it;
            the spacer below eats the rest of the row. With flex on the name the record would
            go back to the card's right edge, which is what the record note underneath is about. */}
        <Typography noWrap sx={{
          minWidth: 0, fontSize: TYPE_SCALE.display, fontWeight: 700, letterSpacing: typePx(-0.2), lineHeight: 1.15,
        }}>
          {t ? wpblFullName(t) : '?'}
        </Typography>
        {/* BESIDE THE NAME, NOT AGAINST THE CARD'S EDGE. Right-aligned, a muted record floats a
            long way from the club it belongs to, in a column with nothing else in it, and looks
            accidental rather than deliberate. The slack falls to the right of the pair instead.
            LastGameCard keeps its right-aligned column and should: a score is a number the eye
            goes looking for down the edge of a card, and a record is not.

            SECONDARY INK, NOT DISABLED: disabled is tuned against the card's own paper, and
            these two numbers sit on a club tint, where a low-alpha grey on a light club tint
            goes muddy rather than quiet. */}
        {record && (
          <Typography sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: 'text.secondary', flexShrink: 0 }}>
            {record}
          </Typography>
        )}
        <Box sx={{ flex: 1, minWidth: 0 }} />
      </Box>
    )
  }

  return (
    <SectionCard
      title="Next game"
      /* NO SUBTITLE, and WHEN GOES IN THE ACTION SLOT INSTEAD. The subtitle is the header's
         quietest line at 0.72rem, which is the wrong size for the only fact on this card that
         changes; the action slot is the same baseline as the title, so "Next game" and "Today,
         4:30 PM · in 5h 52m" read as one line rather than as a heading with a footnote. The
         title stays because it is the card's real `h2` and the only thing a screen reader has
         to skim the page by.

         WRAPS RATHER THAN SQUEEZING THE TITLE. SectionCard's action slot does not shrink, so
         at a large text scale on a narrow phone this would otherwise break "Next game" onto
         two lines. Wrapping inside the slot puts the clock under the date instead, which is
         the pair that can afford to stack. */
      action={
        <Box sx={{
          display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end',
          alignItems: 'baseline', columnGap: 0.75, rowGap: 0.2,
        }}>
          <Typography sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 600, color: 'text.secondary' }}>
            {dateLabel}{timeLabel ? `, ${timeLabel}` : ''}
          </Typography>
          <Countdown target={next.ms} />
        </Box>
      }
      actionWraps
      fill
    >
      {/* Laid out as LastGameCard is, tier for tier: the two team rows, then one line at
          headline weight saying what the game is right now, then a quieter line of context,
          then a rule and the row you can act on. Everything inside the clickable block is a
          fact about THIS game, so it all opens the game, the way the team rows already did.

          `flex: 1` + centered absorbs whatever height the card beside it forces on this one,
          splitting it above and below rather than dropping it in one hole, so the card stays
          even when the series line drops out, which it does the first time two clubs meet. */}
      <Box {...gameLink(g, onOpenGame)} sx={{ cursor: 'pointer', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', borderRadius: 1, p: 0.5, mx: -0.5, ...TAPPABLE }}>
        {/* THE GROUPS ARE THE RHYTHM. The two club rows are tight because they are one fact; the
            series line stands off them because it is a different one; the rule below opens the
            season context. */}
        {/* ONE BAND, EDGE TO EDGE, TWO FIELDS AND A ONE-PIXEL SEAM.

            The seam is the card showing through a `gap`, not a border: two saturated tints
            meeting edge to edge blend into a third color along the join (Firebells red into
            Heights blue reads purple for a pixel), and a `divider` rule there would be a third
            color drawn on purpose. The card's own paper between them says "two clubs" without
            adding any ink.

            FULL BLEED, because a tinted rectangle inset a few pixels inside a card is the one
            shape that reads as an accident: against the card's edge, a thin margin of paper just
            looks like the tint failed to fill. Run to the edge it is a band, which is what a
            broadcast graphic does with a fixture. `mx: -2` is SectionCard's body padding
            canceled through the clickable block's own `p: 0.5, mx: -0.5`, so it lands exactly
            on the card's inner edge and the card's `overflow: hidden` takes care of the corners.

            The rows get that padding back as `px: 2` so the club names stay on the text
            column: a name that starts left of the series line under it would trade one
            accident for another. */}
        <Box sx={CLUB_BAND}>
          {teamRow(away)}
          {teamRow(home)}
        </Box>

        {/* WHICH GAME OF WHICH SERIES, in the section's one wording for it: the Schedule row
            says "Semifinal · Game 2" in the accent above the same record, and two surfaces
            describing one series two ways is worse than either wording is good.

            "of 3" is the one addition, and this is the card with room for it. A bare "Game 2"
            leaves "Firebells lead 1–0" underneath meaning nothing in particular; against a
            best-of-three it means the Firebells win tonight or play a decider, which is why
            anyone is reading this card in the postseason. `gameNumber` is deliberately
            un-clamped upstream, so "Game 4 of 3" can appear and is a real signal (a doubled
            row in the mirror), not a rendering fault to defend against here. */}
        {postseason && (
          <Typography sx={{
            fontSize: TYPE_SCALE.micro, fontWeight: 800, letterSpacing: typePx(0.6),
            textTransform: 'uppercase', color: 'var(--wpbl-accent-fg)', mt: 1, lineHeight: 1.2,
          }}>
            {postseason.label} · Game {postseason.gameNumber} of {postseason.bestOf}
          </Typography>
        )}
        {/* THE POSTSEASON KEEPS ITS LINE, THE REGULAR SEASON DOES NOT.

            A regular-season line ("Season series tied 2–2 · Firebells have won 4") is true,
            quiet, and the same shape every night, sitting between the two loudest things on
            the card, and the color band above already says this is a fixture with a story.
            In the postseason the same slot carries "Firebells lead 1–0 · Firebells can clinch",
            which is the stakes, and the postseason branch of `nextGameContext` is what makes
            the two different. */}
        {postseason && contextLine && (
          <Typography sx={{ fontSize: TYPE_SCALE.body, fontWeight: 600, color: 'text.secondary', lineHeight: 1.4, mt: 0.4 }}>
            {contextLine}
          </Typography>
        )}
        {/* The tale of the tape, BELOW A HAIRLINE AND AT FOOTER WEIGHT. Same component Game
            Center draws for an unplayed game, cut down to a block (see its `compact` note).

            At full strength its values, heavy and in a club accent, out-punch the club names,
            which is backwards for a card whose subject is the fixture. The rule and the
            quieter type make it the thing you read if you are still here rather than the thing
            you meet first.

            NO EXTRA FETCH. It reads the season lines out of the same session cache Home has
            already filled, so on this page it is arithmetic on data in hand. It renders nothing
            at all until there is something to compare, so the season's opening days get the
            card without an empty frame. */}
        {away && home && (
          <Box sx={{ mt: 1.5 }}>
            <WpblGamePreview away={away} home={home} teams={[...teams.values()]} games={games} compact />
          </Box>
        )}
      </Box>
      {/* Once the countdown in the header has run out and nothing has happened, this is the
          card that owes the reader an explanation: it is the one that promised a first pitch.
          Compact, because the full second sentence belongs on Game Center where there is room
          and where somebody has gone looking for detail. Outside the clickable block above,
          which is all facts about the game itself. */}
      {/* `:empty` because the note renders nothing on the ordinary day and this is a flex
          column, where margins do not collapse: without it the card carries 8px of dead space
          above its footer whenever the feed is behaving, which is almost always. */}
      <Box sx={{ mt: 1, '&:empty': { display: 'none' } }}>
        <FeedDelayNote game={g} compact />
      </Box>

      <GameReminderRow game={g} away={away} home={home} startMs={next.ms} />
    </SectionCard>
  )
}
