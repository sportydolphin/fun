import { useDark } from '../../ui/useDark'
import { useMemo, useState, type ReactNode } from 'react'
import { Box, Typography, Skeleton } from '@mui/material'
import { computeStandings,
} from '../api'
import { WPBL_ACCENT, wpblAccent, wpblFullName, formatGameTime } from '../constants'
import { SectionLabel, TYPE_SCALE, TeamBadge, CARD_BORDER, CARD_FILL, chromePx, hoverOnly, pressable, TAPPABLE, FOCUS_RING } from '../ui'
import { usePhoneLayout } from '../../ui/ModalShell'
import { HOME_WIDE_W } from '../layoutWidths'
import type { WpblTeam, WpblPlayer, WpblGame, WpblSiteGame } from '../types'
import { seriesContexts } from '../derive/series'
import { boxScoreRevision, formatRevisionDay } from '../derive/feedHealth'
import { postseasonScheduleRows, postseasonSlots, type PostseasonScheduleRow, type PostseasonSlot } from '../derive/bracket'
import { offseasonByCalendar } from '../offseasonCalendar'
import { WpblMatchupPreview } from '../GamePreview'
import { useWpblGameLink } from '../LinkContext'
import { useGameNotes, ScoreCardFooter, ScoreCardFooterSkeleton } from '../ScoreCardNotes'
import { TabTitle } from '../PageHeading'
import { typePx } from '../../ui/scale'
import { EmptyState } from './Placeholders'

/**
 * How recent a revision has to be to be worth marking on the schedule.
 *
 * A week. The league revises box scores for weeks after the fact and most of a season's games
 * carry a revision of some kind, so a mark on every one of those is a mark on nothing. A week is
 * "changed since you last looked", which is the question a reader scanning for scoring changes is
 * asking.
 */
const REVISION_RECENT_MS = 7 * 24 * 60 * 60 * 1000

const recentRevision = (g: WpblGame): boolean => {
  const r = boxScoreRevision(g)
  return !!r && Date.now() - r.at < REVISION_RECENT_MS
}

const revisedLabel = (g: WpblGame): string => {
  const r = boxScoreRevision(g)
  return r ? formatRevisionDay(r.on) : ''
}

// Scores breaks out of the 720px column to Home's width on a wide screen, by the same device as
// Home (see homeWideSx there): the grid spends the width on more games per row, where a list had
// nothing to spend it on.
const SCORES_WIDE_SX = {
  width: { xs: 'auto', md: HOME_WIDE_W },
  position: 'relative',
  left: { xs: 0, md: '50%' },
  transform: { xs: 'none', md: 'translateX(-50%)' },
} as const

/** The grid itself: as many columns as fit a card's minimum width, which is three on a desktop. */
const SCORES_GRID_SX = {
  display: 'grid', gap: 1.25,
  gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${chromePx(300)}), 1fr))`,
} as const

/** The series strip inside a grid card: label over line, never side by side. Side by side it
 *  wraps or not depending on the card's width and the line's length, and a card whose height
 *  depends on that cannot be reserved by a skeleton. Stacked it is one height everywhere. */
const GRID_STRIP_SX = {
  display: 'flex', flexDirection: 'column', gap: 0.25,
  pt: 0.6, borderTop: '1px solid', borderColor: 'divider',
} as const

// THE DATE IS THE PAGE'S INDEX, so it is drawn in ink rather than as a grey caption: a reader
// scrolling for "the game on the 14th" scans dates, not matchups, and a tracked-out disabled label
// at caption size was the faintest thing on the card. The Postseason and Earlier dividers keep
// the caption style, so the two kinds of label read apart.
const DATE_SX = { fontSize: TYPE_SCALE.title, fontWeight: 800, color: 'text.primary', lineHeight: 1.3 } as const

/** A game day's heading in the list, above that day's cards. */
function DateLabel({ children }: { children: ReactNode }) {
  return <Typography sx={{ ...DATE_SX, mb: 0.75 }}>{children}</Typography>
}

/** A grid card's first line: its date, and the game's status on the right. */
function CardKicker({ date, children }: { date: ReactNode; children?: ReactNode }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1, mb: 0.25 }}>
      <Typography sx={{ ...DATE_SX, fontSize: TYPE_SCALE.body }}>
        {date}
      </Typography>
      {children}
    </Box>
  )
}

/**
 * The Scores tab drawn empty, from the card's own pieces: the kicker, the badge rows, the series
 * strip and the footer (ScoreCardFooterSkeleton, the footer's own rows). The grid above a phone,
 * the dated list on one, exactly as ScheduleView decides.
 */
export function ScoresSkeleton() {
  const grid = !usePhoneLayout()
  const offseason = offseasonByCalendar()
  const card = (key: number, strip: 'none' | 'short' | 'long', footer: boolean) => (
    <Box key={key} sx={{
      display: 'flex', flexDirection: 'column', gap: 0.5, p: 1.25,
      borderRadius: 2, border: '1px solid', borderColor: CARD_BORDER,
    }}>
      {grid && (
        <CardKicker date={<Skeleton width="5rem" />}>
          <Typography sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 700 }}><Skeleton width="2rem" /></Typography>
        </CardKicker>
      )}
      {[0, 1].map(row => (
        <Box key={row} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <Skeleton variant="circular" sx={{ width: chromePx(26), height: chromePx(26), flexShrink: 0 }} />
          <Typography sx={{ fontSize: TYPE_SCALE.title, flex: 1 }}><Skeleton width="9rem" /></Typography>
        </Box>
      ))}
      {strip !== 'none' && (grid ? (
        // The grid's strip stacks its label over its line, as the card does there.
        <Box sx={GRID_STRIP_SX}>
          <Typography sx={{ fontSize: TYPE_SCALE.micro }}><Skeleton width="8rem" /></Typography>
          <Typography sx={{ fontSize: TYPE_SCALE.meta }}><Skeleton width="10rem" /></Typography>
        </Box>
      ) : (
        // The list's strip: the label and the series line in two type sizes on one
        // baseline-aligned row, which stands a fraction of a pixel taller than either size alone.
        // On a phone a long series line ("Queens win the championship 3-2") wraps under its label
        // where a short one ("Series tied 2-2") does not, so it comes in both heights.
        <Box sx={{
          display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 0.75,
          pt: 0.6, borderTop: '1px solid', borderColor: 'divider',
        }}>
          <Typography sx={{ fontSize: TYPE_SCALE.micro }}><Skeleton width="8rem" /></Typography>
          <Typography sx={{ fontSize: TYPE_SCALE.meta, flexBasis: strip === 'long' ? { xs: '100%', sm: 'auto' } : 'auto' }}>
            <Skeleton width={strip === 'long' ? '10rem' : '6rem'} />
          </Typography>
        </Box>
      ))}
      {footer && <ScoreCardFooterSkeleton />}
    </Box>
  )
  const day = (key: number, body: ReactNode) => (
    <Box key={key}>
      <DateLabel><Skeleton width="7rem" /></DateLabel>
      {body}
    </Box>
  )
  // THE OFFSEASON OPENS ON THE POSTSEASON, newest first, and the calendar alone knows it (see
  // offseasonByCalendar): every card above the fold is a bracket game with a series strip and a
  // final's footer, and on a phone the first is the final, whose line names the champion and is
  // the long one. In season the page opens on the last game day's finals and then games to come.
  return (
    <Box sx={[{ display: 'flex', flexDirection: 'column', gap: 1.25 }, grid ? SCORES_WIDE_SX : {}]}>
      <TabTitle sx={{ mb: 0.25 }}>WPBL Scores</TabTitle>
      {grid ? (
        <Box sx={SCORES_GRID_SX}>
          {[0, 1, 2, 3, 4, 5].map(i => offseason ? card(i, 'short', true) : card(i, 'none', i < 2))}
        </Box>
      ) : offseason
        ? [0, 1, 2, 3, 4].map(i => day(i, card(i, i === 0 ? 'long' : 'short', true)))
        : [0, 1, 2, 3, 4].map(i => day(i, card(i, 'none', i === 0)))}
    </Box>
  )
}

export function ScheduleView({ teams, games, siteGames = [], onOpenGame, onOpenTeam, onOpenPlayer }: {
  teams: WpblTeam[]; games: WpblGame[]; siteGames?: WpblSiteGame[]; onOpenGame: (g: WpblGame) => void
  /** For the postseason matchup preview's roster and club links; optional so the view still
   *  renders without them. */
  onOpenTeam?: (t: WpblTeam) => void
  onOpenPlayer?: (p: WpblPlayer) => void
  active?: boolean // accepted (call site passes it) but unused now that ordering replaced auto-scroll
}) {
  const byId = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])
  const isDark = useDark()
  const gameLink = useWpblGameLink()
  const { notes: gameNotes, players: notePlayers, settled: notesSettled } = useGameNotes(games, teams)
  // A GRID ABOVE A PHONE. A four-club league plays at most two games a day, so a grid inside each
  // date would be one card and a hole most days: the date moves into the card instead, and the
  // games flow across the row in date order. A phone, and the side panel, keep the dated list.
  const grid = !usePhoneLayout()
  // A postseason placeholder opened as a matchup preview. These have no feed game row to open,
  // so this is a local modal rather than a history-managed page: season comparison and the two
  // rosters, which is what a seeded-but-unplayed fixture can answer.
  const [matchup, setMatchup] = useState<{ away: WpblTeam; home: WpblTeam; eyebrow: string } | null>(null)
  // The postseason is series-shaped and this list was not: a best-of-three read as three
  // unrelated games between the same two clubs. Empty all regular season, and empty for as
  // long as the feed marks no game as postseason, so nothing here changes shape on its own.
  const series = useMemo(() => seriesContexts(games, byId), [games, byId])
  // Season-to-date record per team, so upcoming games can show each side's W-L.
  const standings = useMemo(() => computeStandings(teams, games), [teams, games])
  const recordById = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of standings) m.set(r.team.id, `${r.wins}-${r.losses}`)
    return m
  }, [standings])
  // The postseason, from the calendar the league published, for as long as the feed has no rows
  // of its own. Without this the schedule would end with the regular season while the bracket card
  // is already counting down to the first playoff game. Each row retires itself the day a real game
  // lands on its date; see postseasonScheduleRows.
  const postRows = useMemo(
    () => postseasonScheduleRows(standings, games, siteGames), [standings, games, siteGames])
  const postByDate = useMemo(() => {
    const m = new Map<string, PostseasonScheduleRow[]>()
    for (const r of postRows) m.set(r.date, [...(m.get(r.date) ?? []), r])
    return m
  }, [postRows])
  // Snap the schedule to the current point in the season when it opens: the next live or
  // upcoming game lands at the top, with the just-played games directly above it, instead
  // of starting on the season opener. Games are date-ascending, so the first non-final one
  // is the next game; once the season is over, fall back to the last game.
  const anchorDate = useMemo(() => {
    const next = games.find(g => g.status !== 'final')
    return next?.game_date ?? games[games.length - 1]?.game_date ?? null
  }, [games])
  if (games.length === 0) {
    return <EmptyState title="No games" />
  }
  const byDate = new Map<string, WpblGame[]>()
  for (const g of games) {
    const list = byDate.get(g.game_date) ?? []
    list.push(g); byDate.set(g.game_date, list)
  }

  // GAME DAYS ONLY. Every calendar day between the first game and the last used to get a row,
  // off days as a dashed "No games" card, which in a season of 40 finals over seven weeks was
  // most of the page saying nothing. Worse, the lead below steps back one DATE from the anchor,
  // and with off days in the list that date was usually an off day: the offseason page opened on
  // "Mon, Sep 21 · No games" above the championship. Without them, one step back is the previous
  // game day, which is what that step was always meant to reach.
  //
  // The feed's dates plus the published postseason's, since before the league draws the bracket
  // the tail of the season exists only in the calendar (see postseasonScheduleRows).
  const dates = [...new Set([...byDate.keys(), ...postByDate.keys()])].sort()
  // The first date the postseason occupies, which is where the divider goes. Taken from the
  // rows rather than from a constant, so it moves on its own once the feed starts publishing
  // real games and the placeholders retire.
  const firstPostDate = postRows[0]?.date ?? null
  // Nothing left to play: no unfinished feed game and no published postseason game still waiting
  // for its row. Then the page is the season's results, and results read newest first, the way
  // every scores page does; the anchored order below would put the final at the top and then
  // restart the list at opening day.
  const seasonOver = !games.some(g => g.status !== 'final') && postRows.length === 0
  // In season, open on the current point by *ordering*, not scrolling: the previous game day
  // leads, then the next or live game and everything upcoming; the rest of the played games
  // follow under "Earlier", newest first, so the night before last sits directly under the
  // divider rather than at the foot of the page. Nothing moves the window, so switching to this
  // tab never scrolls the page under the reader.
  const anchorIdx = anchorDate ? Math.max(0, dates.indexOf(anchorDate)) : 0
  const start = seasonOver ? dates.length : Math.max(0, anchorIdx - 1)
  const lead = dates.slice(start)
  const earlier = dates.slice(0, start).reverse()

  // "Today" / "Tomorrow" / "Yesterday" for the nearby days (with the date kept alongside so the
  // label stays informative), otherwise the weekday + date.
  const dateLabel = (date: string) => {
    const d = new Date(`${date}T00:00:00`)
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const diff = Math.round((d.getTime() - today.getTime()) / 86400000)
    const rel = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday' : null
    const md = d.toLocaleDateString([], { month: 'short', day: 'numeric' })
    return rel ? `${rel} · ${md}` : d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
  }

  // A postseason game the league has dated but not yet drawn. Deliberately a different object
  // from a game card: dashed rather than solid, no score column, no link, and slots that name a
  // seed rather than a club. A reader must not be able to mistake it for a fixture that exists.
  const renderPostseason = (r: PostseasonScheduleRow, kicker?: string) => {
    // Away over home when the league has designated one, seed order when it has not, and no venue
    // marker either way, matching the real game card: one ballpark means "home" is only batting last.
    const { slots } = postseasonSlots(r)
    // Both clubs seeded: there is a matchup to preview even though there is no game to open, so the
    // card goes solid and clickable. A slot still holding a seed number (team null) has no matchup
    // yet, so that card stays dashed and inert, the way it always was.
    const preview = r.first.team && r.second.team
      ? { away: slots[0].team!, home: slots[1].team!,
          eyebrow: `${r.label} · Game ${r.gameNumber} · ${dateLabel(r.date)}` }
      : null
    const slot = (p: PostseasonSlot, i: number) => (
      <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
        {p.team ? <TeamBadge team={p.team} size={26} /> : (
          // The empty seat, sized exactly like a badge so a settled slot and an open one do not
          // shift the row when the seeding locks mid-week.
          <Box aria-hidden sx={{
            width: 26, height: 26, flexShrink: 0, borderRadius: '50%',
            border: '1px dashed', borderColor: CARD_BORDER,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: TYPE_SCALE.meta, fontWeight: 800, color: 'text.disabled',
          }}>{p.seed ?? ''}</Box>
        )}
        <Typography noWrap sx={{
          fontSize: TYPE_SCALE.title, fontWeight: p.team ? 600 : 500, flex: 1, minWidth: 0,
          color: p.team ? 'text.primary' : 'text.secondary',
        }}>
          {p.team ? wpblFullName(p.team) : p.label}
        </Typography>
        {p.team && recordById.get(p.team.id) && (
          <Typography sx={{ flexShrink: 0, fontSize: TYPE_SCALE.meta, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: 'text.disabled' }}>
            {recordById.get(p.team.id)}
          </Typography>
        )}
      </Box>
    )
    return (
      <Box key={r.id}
        {...(preview ? pressable(() => setMatchup(preview)) : {})}
        aria-label={preview ? `Preview ${preview.away.abbr} at ${preview.home.abbr}` : undefined}
        sx={{
          display: 'flex', flexDirection: 'column', gap: 0.5, p: 1.25,
          // Solid and clickable once both clubs are seeded (there is a matchup to preview); dashed
          // and inert while a seat is still a seed number.
          borderRadius: 2, border: preview ? '1px solid' : '1px dashed', borderColor: CARD_BORDER,
          bgcolor: CARD_FILL,
          ...(preview ? { cursor: 'pointer', ...TAPPABLE, ...FOCUS_RING, transition: 'border-color 0.15s', ...hoverOnly({ borderColor: 'text.disabled' }) } : {}),
        }}>
        {kicker && <CardKicker date={kicker} />}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
          <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            {slots.map(slot)}
          </Box>
          <Box sx={{ flexShrink: 0, textAlign: 'right', minWidth: '3.625rem', whiteSpace: 'nowrap' }}>
            {/* The league published Central wall-clock times, and formatGameTime converts them
                to the reader's zone the same way it does for a feed game. */}
            <Typography sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 700, color: 'text.secondary' }}>
              {formatGameTime(r.date, r.time) || r.time}
            </Typography>
          </Box>
        </Box>
        <Box sx={{
          display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 0.75,
          pt: 0.6, borderTop: '1px solid', borderColor: 'divider',
        }}>
          <Typography sx={{ fontSize: TYPE_SCALE.micro, fontWeight: 800, letterSpacing: typePx(0.4), textTransform: 'uppercase', color: 'text.primary' }}>
            {r.label} · Game {r.gameNumber}
          </Typography>
          {/* Spelled out rather than left as the bracket's asterisk: there is no key beside a
              schedule row to explain what the asterisk meant. "Seeding TBD" replaces the bare
              "Scheduled" rather than joining it, because a row that is here at all is scheduled:
              what the reader needs is the one thing about it we do not know, which is which of
              these two clubs is the higher seed. */}
          <Typography sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 600, color: 'text.disabled' }}>
            {r.ifNecessary ? 'If necessary' : r.seedOrderTbd ? 'Seeding TBD' : 'Scheduled'}
          </Typography>
        </Box>
      </Box>
    )
  }

  const renderGame = (g: WpblGame, kicker?: string) => {
    const home = byId.get(g.home_team_id)
    const away = byId.get(g.away_team_id)
    const final = g.status === 'final' && g.home_score != null && g.away_score != null
    const live = g.status === 'live'
    const ser = series.get(g.id)
    const status = (
      <Typography sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 700, whiteSpace: 'nowrap', color: live ? '#ef4444' : final ? 'text.secondary' : WPBL_ACCENT }}>
        {live ? '● Live' : final ? `Final${g.innings && g.innings !== 7 ? `/${g.innings}` : ''}` : formatGameTime(g.game_date, g.start_time) || 'TBD'}
      </Typography>
    )
    return (
      // Every card is a real <a href="/wpbl/games/<slug>">. This is the section's
      // crawl path to all 41 recaps, and it was a bare onClick div: no href for a
      // crawler, no tab stop for a keyboard, nothing to open in a new tab.
      // THE GAME LINK IS STRETCHED, not the card: a final's footer names players, and an <a>
      // inside an <a> is silently unpicked by the browser. The matchup row is the anchor and
      // its ::after covers the whole card, so a tap anywhere still opens the game, while the
      // player names sit above it on their own anchors.
      <Box key={g.id} sx={{
        position: 'relative',
        // A column, so a postseason game can carry a series strip under the matchup.
        // The matchup and the status keep their own row inside it and are unchanged.
        display: 'flex', flexDirection: 'column', gap: 0.5, p: 1.25, cursor: 'pointer',
        // In light mode a final gets a muted fill, so the past reads as settled against crisp
        // upcoming cards. In dark mode every card is flat (see Surfaces in ThemeContext), and a final
        // keeps that: a grey fill here was the one lifted card on a flat page.
        borderRadius: 2, border: '1px solid', borderColor: CARD_BORDER,
        bgcolor: final && !isDark ? 'action.hover' : CARD_FILL,
        transition: 'border-color 0.15s', ...hoverOnly({ borderColor: 'text.disabled' }),
      }}>
        {/* The grid's own date line, since a card there has no date label above it. */}
        {kicker && <CardKicker date={kicker}>{status}</CardKicker>}
       <Box {...gameLink(g, onOpenGame)} sx={{
         display: 'flex', alignItems: 'center', gap: 1, width: '100%', color: 'inherit', textDecoration: 'none',
         '&::after': { content: '""', position: 'absolute', inset: 0, borderRadius: 2 },
       }}>
        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          {[away, home].map((t, i) => {
            const score = i === 0 ? g.away_score ?? 0 : g.home_score ?? 0
            const other = i === 0 ? g.home_score ?? 0 : g.away_score ?? 0
            const won = final && score > other
            return t && (
            <Box key={t.id} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
              {/* Winner caret on finals: a fixed-width slot keeps both rows' badges aligned. */}
              {final && (
                <Box sx={{ width: '0.4375rem', flexShrink: 0, mx: -0.5, textAlign: 'center', fontSize: TYPE_SCALE.body, lineHeight: 1, color: wpblAccent(t.id, isDark) }}>{won ? '▸' : ''}</Box>
              )}
              <TeamBadge team={t} size={26} />
              {/* Away on top, home on the bottom, and no "@" marking the home side: the league
                  plays every game in one ballpark, so "home" means batting last and nothing
                  else, and a venue marker pointing at a ground that never changes is noise. */}
              <Typography noWrap sx={{ fontSize: TYPE_SCALE.title, fontWeight: won ? 800 : 600, flex: 1, minWidth: 0, color: final && !won ? 'text.secondary' : 'text.primary' }}>
                {wpblFullName(t)}
              </Typography>
              {(final || live) ? (
                <Typography sx={{ flexShrink: 0, minWidth: '1.125rem', textAlign: 'right', fontSize: TYPE_SCALE.title, fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: final && !won ? 'text.disabled' : 'text.primary' }}>
                  {score}
                </Typography>
              ) : recordById.get(t.id) && (
                <Typography sx={{ flexShrink: 0, textAlign: 'right', fontSize: TYPE_SCALE.meta, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: 'text.disabled' }}>
                  {recordById.get(t.id)}
                </Typography>
              )}
            </Box>
          )})}
        </Box>
        {!kicker && (
          <Box sx={{ flexShrink: 0, textAlign: 'right', minWidth: '3.625rem', whiteSpace: 'nowrap' }}>{status}</Box>
        )}
       </Box>
        {/* "Semifinal · Game 2" and the record, which is the unit a fan tracks in the
            postseason and the one thing three rows between the same two clubs cannot say
            for themselves. The record only, not what a win would clinch: that is
            broadcast copy and it belongs on the game's own page, where there is room
            for it. Wraps rather than truncates, because the club names in it are as
            long as the row is wide on a small phone. */}
        {ser && (
          <Box sx={kicker ? GRID_STRIP_SX : {
            display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 0.75,
            pt: 0.6, borderTop: '1px solid', borderColor: 'divider',
          }}>
            <Typography sx={{ fontSize: TYPE_SCALE.micro, fontWeight: 800, letterSpacing: typePx(0.4), textTransform: 'uppercase', color: 'text.primary' }}>
              {ser.label} · Game {ser.gameNumber}
            </Typography>
            {ser.line && (
              <Typography sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 600, color: 'text.secondary' }}>
                {ser.line}
              </Typography>
            )}
          </Box>
        )}
        {/* The league changed this box score in the last week. THE WINDOW IS WHAT MAKES
            IT A SIGNAL: most of a season's games get revised at some point, so marking all
            of them says nothing, where "changed since you last looked" is the question a
            reader scanning the schedule for scoring changes is actually asking. The game's
            own page carries the date whenever there is one, however old. See
            boxScoreRevision. */}
        {final && (notesSettled
          ? <ScoreCardFooter notes={gameNotes.get(g.id)} players={notePlayers} onOpenPlayer={onOpenPlayer} />
          : <ScoreCardFooterSkeleton />)}
        {recentRevision(g) && (
          <Box sx={{
            display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 0.6,
            pt: 0.6, borderTop: '1px solid', borderColor: 'divider',
          }}>
            <Typography sx={{ fontSize: TYPE_SCALE.micro, fontWeight: 800, letterSpacing: typePx(0.4), textTransform: 'uppercase', color: 'text.disabled' }}>
              Box score revised
            </Typography>
            <Typography sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 600, color: 'text.secondary' }}>
              {revisedLabel(g)}
            </Typography>
          </Box>
        )}
      </Box>
    )
  }

  const renderDate = (date: string) => {
    const dayGames = byDate.get(date)
    const dayPost = postByDate.get(date)
    return (
    <Box key={date}>
      {/* One divider where the regular season stops, so a reader scrolling past the last
          regular-season date is told what the dashed cards below it are before meeting one. */}
      {date === firstPostDate && <SectionLabel>Postseason</SectionLabel>}
      <DateLabel>{dateLabel(date)}</DateLabel>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {(dayGames ?? []).map(g => renderGame(g))}
        {(dayPost ?? []).map(r => renderPostseason(r))}
      </Box>
    </Box>
    )
  }

  // One date's cards for the grid, each carrying its own date. The postseason divider spans the row.
  const gridCards = (date: string): ReactNode[] => [
    ...(date === firstPostDate ? [<Box key="post-label" sx={{ gridColumn: '1 / -1' }}><SectionLabel>Postseason</SectionLabel></Box>] : []),
    ...(byDate.get(date) ?? []).map(g => renderGame(g, dateLabel(date))),
    ...(postByDate.get(date) ?? []).map(r => renderPostseason(r, dateLabel(date))),
  ]

  return (
    <Box sx={[{ display: 'flex', flexDirection: 'column', gap: 1.25 }, grid ? SCORES_WIDE_SX : {}]}>
      {/* The page's one <h1>: /wpbl/schedule, named for what someone would search. Demoted to
          a plain div while a game or player modal is the page; see PageHeading.tsx. */}
      <TabTitle sx={{ mb: 0.25 }}>WPBL Scores</TabTitle>
      {grid ? (
        <Box sx={SCORES_GRID_SX}>
          {lead.flatMap(gridCards)}
          {lead.length > 0 && earlier.length > 0 && <Box sx={{ gridColumn: '1 / -1' }}><SectionLabel>Earlier</SectionLabel></Box>}
          {earlier.flatMap(gridCards)}
        </Box>
      ) : (<>
        {lead.map(renderDate)}
        {/* A divider only under something: with the season over there is no lead to divide from. */}
        {lead.length > 0 && earlier.length > 0 && <SectionLabel>Earlier</SectionLabel>}
        {earlier.map(renderDate)}
      </>)}
      {matchup && (
        <WpblMatchupPreview
          away={matchup.away} home={matchup.home} teams={teams} games={games}
          eyebrow={matchup.eyebrow} onClose={() => setMatchup(null)}
          onOpenTeam={onOpenTeam} onOpenPlayer={onOpenPlayer}
        />
      )}
    </Box>
  )
}
