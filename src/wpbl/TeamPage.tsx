import { useEffect, useMemo, useRef, useState } from 'react'
import { Box, Typography, CircularProgress, useMediaQuery } from '@mui/material'
import { ArrowBackRounded, GridViewRounded } from '@mui/icons-material'
import { fetchWpblRoster, fetchWpblAllPlayers, fetchWpblAllLines, fetchWpblLineupHistory, fetchWpblPitchingUsage, computeStandings } from './api'
import { wpblAccent, wpblFullName, formatGameTime, positionRank } from './constants'
import { buildPositionIndex, displayPositionFromIndex } from './positions'
import { SectionCard, SectionLabel, TeamBadge, PlayerPortrait, ModalShell, pressable, FOCUS_RING, useWpblDark, useWpblName, CARD_BORDER, TAPPABLE, hoverOnly } from './ui'
import {
  aggregateBatting, aggregatePitching, sumBatting, sumPitching, fmtRate, fmtTwo,
  wpblQualifiers, plateAppearances,
  type WpblBattingTotals, type WpblPitchingTotals,
} from './stats'
import { outsToIp } from './constants'
import { useEraBasis } from './EraBasisContext'
import { TeamSpecRadar, TeamSpecReadout, TeamSpecDetail, TeamSpecPlaceholder } from './TeamSpecRadar'
import { teamSpecs, specLeagueGames, formatSpecStat, TEAM_SPEC_AXES, type TeamSpecKey } from './derive/teamSpec'
import { useWpblPlayerLink, useWpblGameLink } from './LinkContext'
import { useWpblHeadingTag } from './PageHeading'
import LineupHistory from './LineupHistory'
import PitchingUsage from './PitchingUsage'
import type { WpblTeam, WpblPlayer, WpblGame, WpblBattingLine, WpblPitchingLine, WpblLineupHistoryRow, WpblPitchingUsageRow } from './types'

// A team's page: header + record, results, season batting/pitching totals, top hitters /
// pitchers, and a roster with inline stats. Replaces the plain roster list the Teams tab
// used to show. Self-contained — fetches its own roster + box-score lines (league-wide,
// then filtered to this team; cheap for a four-team league) and derives everything.

// Pitcher position codes: P, SP, RP, and the handed variants RHP / LHP. No fielding
// position ends in "P", so a trailing P is a reliable pitcher marker.
const isPitcherPos = (pos: string | null | undefined) => /P$/i.test((pos ?? '').trim())

// Width of the result/kickoff column in the Results card. One number so the W/L letter, the
// score and the scheduled time all land on the same axis.
// 4.5rem is the 72px it has always been. A text column, so it follows the type: see the
// three kinds of fixed size in ROADMAP-WPBL item 0, phase 2.
const SCORE_COL_W = '4.5rem'

// A block of centered stat tiles (value over a small caps label), laid out on a fixed
// four-column grid.
//
// It used to be a wrapping flex row of `flex: 1 1 0` tiles. That looks fine while everything
// fits on one line, but the moment it wraps the trailing tiles each take an equal share of
// the LAST row's width instead of sitting under the columns above — so eight stats rendered
// as five across the top and three floating at different offsets beneath. A grid pins the
// columns, so every tile lines up with the one above it however many there are.
//
// Four columns is also the honest grouping for these stats: the four slash-line rates read
// as one row, the four counting stats as another.
function StatTiles({ items }: { items: { label: string; value: string }[] }) {
  return (
    <Box sx={{
      display: 'grid',
      gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
      columnGap: 1,
      rowGap: 1.5,
    }}>
      {items.map(it => (
        <Box key={it.label} sx={{ textAlign: 'center', minWidth: 0 }}>
          <Typography sx={{ fontSize: '1.05rem', fontWeight: 800, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>{it.value}</Typography>
          <Typography sx={{ fontSize: '0.56rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'text.disabled' }}>{it.label}</Typography>
        </Box>
      ))}
    </Box>
  )
}

// A header link in a card's action slot. Same affordance as Results' "All 15".
function CardLink({ label, accent, onClick }: { label: string; accent: string; onClick: () => void }) {
  return (
    <Typography
      {...pressable(onClick)}
      sx={{
        fontSize: '0.72rem', fontWeight: 700, color: accent, cursor: 'pointer',
        py: 0.5, px: 0.5, whiteSpace: 'nowrap', borderRadius: 1,
        '&:hover': { textDecoration: 'underline' },
        ...FOCUS_RING,
      }}
    >
      {label}
    </Typography>
  )
}

// One game in the Results card — and in the full-schedule modal, which is why it lives out
// here rather than inline: the two must not drift apart.
function ScheduleRow({ game, teamId, teamById, onOpenGame }: {
  game: WpblGame
  teamId: string
  teamById: Map<string, WpblTeam>
  onOpenGame: (g: WpblGame) => void
}) {
  const gameLink = useWpblGameLink()
  const home = game.home_team_id === teamId
  const opp = teamById.get(home ? game.away_team_id : game.home_team_id)
  const us = home ? game.home_score : game.away_score
  const them = home ? game.away_score : game.home_score
  const final = game.status === 'final' && us != null && them != null
  const live = game.status === 'live'
  const win = final && (us as number) > (them as number)
  const loss = final && (us as number) < (them as number)
  return (
    <Box {...gameLink(game, onOpenGame)} sx={{
      display: 'flex', alignItems: 'center', gap: 1, py: 0.85, cursor: 'pointer',
      borderTop: '1px solid', borderColor: 'divider', '&:first-of-type': { borderTop: 'none' },
      borderRadius: 1, ...TAPPABLE, ...FOCUS_RING,
    }}>
      <Typography sx={{ width: '2.875rem', fontSize: '0.7rem', fontWeight: 700, color: 'text.disabled', flexShrink: 0 }}>
        {new Date(`${game.game_date}T00:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' })}
      </Typography>
      <Typography sx={{ fontSize: '0.7rem', color: 'text.disabled', width: '1rem', flexShrink: 0 }}>{home ? 'vs' : '@'}</Typography>
      {opp && <TeamBadge team={opp} size={22} />}
      <Typography sx={{ flex: 1, minWidth: 0, fontSize: '0.85rem', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {opp ? opp.name : '—'}
      </Typography>
      {/* Fixed widths, not intrinsic ones. The score column varies between three and five
          characters ("1–6" vs "6–11"), and with the group simply right-aligned that difference
          pushed the W/L letter left on every wider score — so the column of W's and L's
          wobbled down the card. Pinning the box keeps that letter on one axis, and the same
          total width on scheduled rows lines the kickoff times up with the scores above. */}
      {final ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexShrink: 0, width: SCORE_COL_W }}>
          <Typography sx={{ fontSize: '0.7rem', fontWeight: 800, width: '0.875rem', textAlign: 'center', flexShrink: 0, color: win ? 'success.main' : loss ? 'error.main' : 'text.secondary' }}>
            {win ? 'W' : loss ? 'L' : 'T'}
          </Typography>
          <Typography sx={{ flex: 1, fontSize: '0.85rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>{us}–{them}</Typography>
        </Box>
      ) : (
        <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: live ? '#ef4444' : 'text.secondary', flexShrink: 0, width: SCORE_COL_W, textAlign: 'right' }}>
          {live ? '● Live' : formatGameTime(game.game_date, game.start_time) || 'TBD'}
        </Typography>
      )}
    </Box>
  )
}

// One "top N by stat" mini-list within the leaders card.
function LeaderList({ label, note, rows, accent, onOpenPlayer }: {
  label: string
  /** The qualifying bar, on the lists that have one. Only the RATE stats do, so this appears
   *  beside OPS and ERA and not beside home runs: a reader who cannot find a .900 hitter on
   *  this board deserves to be told why rather than left to think the page is wrong. */
  note?: string
  rows: { player: WpblPlayer; value: string }[]
  accent: string
  onOpenPlayer: (p: WpblPlayer) => void
}) {
  const shortName = useWpblName()
  const playerLink = useWpblPlayerLink()
  if (rows.length === 0) return null
  return (
    <Box sx={{ mb: 1.25, '&:last-of-type': { mb: 0 } }}>
      <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.8, color: 'text.disabled', mb: 0.4 }}>
        {label}
        {note && <Box component="span" sx={{ ml: 0.75, fontWeight: 600, letterSpacing: 0.3, textTransform: 'none' }}>{note}</Box>}
      </Typography>
      {rows.map((r, i) => (
        <Box key={r.player.id} {...playerLink(r.player, onOpenPlayer)} sx={{
          display: 'flex', alignItems: 'center', gap: 0.75, py: 0.4, cursor: 'pointer',
          borderRadius: 1, ...TAPPABLE, ...FOCUS_RING,
        }}>
          <Typography sx={{ width: '0.875rem', fontSize: '0.7rem', fontWeight: 800, color: i === 0 ? accent : 'text.disabled' }}>{i + 1}</Typography>
          <PlayerPortrait name={r.player.name} teamId={r.player.team_id} size={20} />
          <Typography sx={{ flex: 1, fontSize: '0.82rem', fontWeight: i === 0 ? 700 : 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{shortName(r.player.name)}</Typography>
          <Typography sx={{ fontSize: '0.82rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums', minWidth: '2.5rem', textAlign: 'right' }}>{r.value}</Typography>
        </Box>
      ))}
    </Box>
  )
}

// ─── Sticky header ──────────────────────────────────────────────────────────────

/** Vertical padding inside the pinned bar. Small on purpose: it is on screen for the whole
 *  page, and this page is thousands of pixels tall on a phone. */
const BAR_PAD_Y = 0.75

/**
 * The four-team switcher, and the thing that answers "whose page is this?" once the name
 * at the top has scrolled a roster's length away.
 *
 * Order is the league's, NOT the standings'. A control that reshuffles itself as results
 * land is a mis-tap generator: the club that was third from the left this morning is third
 * from the left tonight, whatever happened last night. (The active pill is wider than a bare
 * badge, so its neighbours do shift a little as you move along the rail. But the sequence
 * never changes, which is the half that matters for finding a club without looking.)
 *
 * The active club is the only one that spells itself out (badge, abbreviation and record)
 * because that is the orientation cue; the other three are badges alone, which is all a
 * destination needs and what keeps the whole bar inside a phone's width.
 */
function TeamRail({ teams, current, record, onSelect, onBack, onAllTeams }: {
  teams: WpblTeam[]
  current: WpblTeam
  /** The active club's record ("4–3"), or null before the first game. */
  record: string | null
  onSelect?: (t: WpblTeam) => void
  onBack: () => void
  onAllTeams?: () => void
}) {
  const isDark = useWpblDark()
  const accent = wpblAccent(current.id, isDark)

  const iconBtn = {
    ...FOCUS_RING,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: 32, height: 32, flexShrink: 0, borderRadius: '50%', cursor: 'pointer',
    color: 'text.secondary',
    ...hoverOnly({ bgcolor: 'action.hover', color: 'text.primary' }),
  }

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
      <Box {...pressable(onBack)} aria-label="Back" sx={iconBtn}>
        <ArrowBackRounded sx={{ fontSize: 20 }} />
      </Box>

      <Box role="group" aria-label="Teams" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flex: 1, minWidth: 0 }}>
        {teams.map(t => {
          const active = t.id === current.id
          if (active) {
            return (
              <Box key={t.id} aria-current="page" sx={{
                display: 'flex', alignItems: 'center', gap: 0.6, minWidth: 0,
                pl: 0.5, pr: 1, py: 0.4, borderRadius: 999,
                border: '1px solid', borderColor: accent,
                // A wash of the club's colour rather than the colour itself: a solid fill
                // needs a per-team contrast check for the text on top of it (seven of the
                // eight team/theme pairs fail AA against white), and the border already
                // carries the identity.
                bgcolor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
              }}>
                <TeamBadge team={t} size={22} />
                <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, letterSpacing: 0.3, color: accent }}>{t.abbr}</Typography>
                {record && (
                  <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                    {record}
                  </Typography>
                )}
              </Box>
            )
          }
          return (
            <Box
              key={t.id}
              {...pressable(onSelect ? () => onSelect(t) : undefined)}
              aria-label={wpblFullName(t)}
              sx={{
                ...FOCUS_RING,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 34, height: 34, flexShrink: 0, borderRadius: '50%',
                cursor: onSelect ? 'pointer' : 'default',
                // Dimmed so the active pill wins the row at a glance; full strength on touch
                // or hover, which is also the only feedback a bare badge can give.
                opacity: 0.55, transition: 'opacity 0.15s, background-color 0.15s',
                ...hoverOnly({ opacity: 1, bgcolor: 'action.hover' }),
              }}
            >
              <TeamBadge team={t} size={26} />
            </Box>
          )
        })}
      </Box>

      {onAllTeams && (
        <Box {...pressable(onAllTeams)} aria-label="All teams" sx={iconBtn}>
          <GridViewRounded sx={{ fontSize: 18 }} />
        </Box>
      )}
    </Box>
  )
}

export default function TeamPage({ team, teams, games, onBack, onAllTeams, onSelectTeam, onOpenGame, onOpenPlayer, onOpenStats }: {
  team: WpblTeam
  teams: WpblTeam[]
  games: WpblGame[]
  onBack: () => void
  /** Switch to another club from the pinned rail. Optional so the page still renders
   *  standalone; without it the rail is a read-only "you are here" strip. */
  onSelectTeam?: (t: WpblTeam) => void
  /** Up to the four-team grid. Distinct from `onBack`, which returns to wherever this page
   *  was opened from — often the Stats table, which is not "up". */
  onAllTeams?: () => void
  onOpenGame: (g: WpblGame) => void
  onOpenPlayer: (p: WpblPlayer) => void
  /** Jump to the Stats tab on a particular board. Optional so the page still renders
   *  standalone; the two links simply don't appear without it. */
  onOpenStats?: (group: 'hitting' | 'pitching', sortKey?: string,
                 opts?: { mode?: 'players' | 'teams'; teamId?: string | null; qualified?: boolean }) => void
}) {
  const isDark = useWpblDark()
  const accent = wpblAccent(team.id, isDark)
  const shortName = useWpblName()
  const playerLink = useWpblPlayerLink()
  const headingTag = useWpblHeadingTag()
  const { fmtEra, fmtK, kLabel, scale: scaleK } = useEraBasis()
  const teamById = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])


  const [roster, setRoster] = useState<WpblPlayer[] | null>(null)
  // Everyone in the league, which is a different list from the roster and needed beside it.
  // A player who was traded away in August still batted for this club in July: her lines are
  // in `lines` (they carry the team she played that game FOR), but she is on somebody else's
  // roster now, and every helper below that resolves a line back to a person does it through
  // a player list. Hand those the roster and her July disappears from this page's leaders and
  // her name disappears from its lineup grid, which reads as a hole in the data rather than as
  // a trade. The roster list itself still uses `roster`: she does not play here any more.
  const [league, setLeague] = useState<WpblPlayer[]>([])
  const [lines, setLines] = useState<{ batting: WpblBattingLine[]; pitching: WpblPitchingLine[] } | null>(null)
  // The same fetch, UNFILTERED. The spec chart is a comparison against the league average, so a
  // club's own lines cannot answer it: handed those, every axis reads 50 and the chart looks
  // finished. `fetchWpblAllLines` is league-wide and cached, so this costs nothing extra.
  const [allLines, setAllLines] = useState<{ batting: WpblBattingLine[]; pitching: WpblPitchingLine[] } | null>(null)
  // Where each player has actually been playing. The roster's own labels go stale as a season
  // goes on, and a club list that says "C" beside someone who has played third all year is
  // wrong in the one place a reader goes to learn the shape of the team.
  const positionIndex = useMemo(() => buildPositionIndex(lines?.batting ?? []), [lines])
  // Sorted by the position we are going to SHOW, not the one on file, or the list reads as
  // unsorted the moment a label is overridden.
  const sortedRoster = useMemo(() => roster && [...roster].sort((a, b) =>
    positionRank(displayPositionFromIndex(a, positionIndex).label)
      - positionRank(displayPositionFromIndex(b, positionIndex).label)
    || a.name.localeCompare(b.name)), [roster, positionIndex])
  const [lineups, setLineups] = useState<WpblLineupHistoryRow[]>([])
  const [usage, setUsage] = useState<WpblPitchingUsageRow[]>([])
  const [scheduleOpen, setScheduleOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    // `allLines` is deliberately NOT cleared. It is league-wide, so it is the same object for
    // every club, and clearing it made the spec chart blank to "Loading." and back on every tap
    // of the team rail. That switch is the one moment the chart is most worth watching: the
    // shape is supposed to morph from one club to the next, which is the whole reason to put
    // four buttons above it. Everything below is genuinely this club's and does get cleared.
    setRoster(null); setLines(null)
    setLineups([]); setUsage([])
    Promise.all([
      fetchWpblRoster(team.id), fetchWpblAllPlayers(), fetchWpblAllLines(),
      fetchWpblLineupHistory(team.id), fetchWpblPitchingUsage(team.id),
    ]).then(([r, all, l, lh, pu]) => {
      if (cancelled) return
      setLineups(lh); setUsage(pu)
      setRoster(r); setLeague(all); setAllLines(l)
      setLines({
        batting: l.batting.filter(x => x.team_id === team.id),
        pitching: l.pitching.filter(x => x.team_id === team.id),
      })
    })
    return () => { cancelled = true }
  }, [team.id])

  // Record + standing from the shared derivation.
  const standing = useMemo(() => {
    const rows = computeStandings(teams, games)
    const i = rows.findIndex(r => r.team.id === team.id)
    return i === -1 ? null : { row: rows[i], rank: i + 1 }
  }, [teams, games, team.id])

  // This team's games, chronological (date then start time).
  const schedule = useMemo(() => {
    const startMin = (t: string | null) => {
      const m = /^(\d{1,2}):(\d{2})\s*(am|pm)$/i.exec((t ?? '').trim())
      if (!m) return 0
      let h = Number(m[1]) % 12; if (/pm/i.test(m[3])) h += 12
      return h * 60 + Number(m[2])
    }
    return games
      .filter(g => g.home_team_id === team.id || g.away_team_id === team.id)
      .sort((a, b) => a.game_date !== b.game_date ? (a.game_date < b.game_date ? -1 : 1) : startMin(a.start_time) - startMin(b.start_time))
  }, [games, team.id])

  // `lines` is already filtered to this club, so aggregating against the whole league gives
  // exactly the people who played for it, current roster or not.
  const batSeasons = useMemo(() => lines ? aggregateBatting(league, lines.batting, games) : [], [league, lines, games])
  const pitSeasons = useMemo(() => lines ? aggregatePitching(league, lines.pitching, games) : [], [league, lines, games])
  // The spec chart's six numbers, for every club, so this page can draw its own solid and the
  // other three as faint outlines. League-wide input on purpose; see `allLines`.
  const teamIds = useMemo(() => teams.map(t => t.id), [teams])
  const specs = useMemo(
    () => allLines ? teamSpecs(teamIds, allLines.batting, allLines.pitching, games) : null,
    [allLines, teamIds, games])
  // Only for the placeholder's "the league is on N" line, which is why it is computed even when
  // `specs` came back null.
  const specGames = useMemo(() => specLeagueGames(teamIds, games), [teamIds, games])
  // The phone layout puts the club's numbers on the spokes and drops the readout beside the
  // chart; see the `values` prop. Everything the readout used to say permanently is one tap
  // away instead.
  const narrow = useMediaQuery('(max-width:600px)')
  const [specAxis, setSpecAxis] = useState<TeamSpecKey | null>(null)
  // A tapped axis is about the club you tapped it on. Carrying it to the next club would show
  // its Glove number under a heading the reader chose for somebody else.
  useEffect(() => { setSpecAxis(null) }, [team.id])
  const specValues = useMemo(() => {
    if (!specs || !narrow) return null
    const row = specs.byTeam.get(team.id)
    if (!row) return null
    return Object.fromEntries(TEAM_SPEC_AXES.map(a =>
      [a.key, formatSpecStat(a.key, a.key === 'arms' ? (scaleK(row.raw[a.key]) ?? row.raw[a.key]) : row.raw[a.key])],
    )) as Record<TeamSpecKey, string>
  }, [specs, narrow, team.id, scaleK])

  const teamBat = useMemo(() => lines ? sumBatting(lines.batting, games) : null, [lines, games])
  const teamPit = useMemo(() => lines ? sumPitching(lines.pitching, games) : null, [lines, games])

  const batByPid = useMemo(() => new Map(batSeasons.map(s => [s.player.id, s.totals])), [batSeasons])
  const pitByPid = useMemo(() => new Map(pitSeasons.map(s => [s.player.id, s.totals])), [pitSeasons])

  // Roster seed carries the whole draft board (118 players), but ~half were drafted and
  // never signed to an active roster. Show only signed players — plus anyone who has
  // actually recorded a stat line (a drafted player who got into a game, or a feed-only
  // call-up), so the override self-corrects the moment someone debuts. Hides the stale
  // draft-board entries (status 'Drafted'/none with no stats) that clutter the roster.
  const statPlayerIds = useMemo(() => {
    const s = new Set<string>()
    if (lines) { for (const b of lines.batting) s.add(b.player_id); for (const p of lines.pitching) s.add(p.player_id) }
    return s
  }, [lines])
  const visibleRoster = useMemo(
    () => (sortedRoster ?? []).filter(p => p.status === 'Signed' || statPlayerIds.has(p.id)),
    [sortedRoster, statPlayerIds],
  )

  /**
   * The two sideways grids, collapsed on a phone.
   *
   * Measured on a 390px screen: the page is 4,259px, of which Lineup history is 646 and
   * Pitching usage 471. Both are horizontal scrollers inside a vertical one, which is the
   * most awkward control there is on a touchscreen, and neither is what a reader opened a
   * team page to see. Above 600px they stay open: there the page is two columns and the room
   * exists.
   *
   * COLLAPSING UNMOUNTS. `SectionCard` renders `{!collapsed && children}`, so a collapsed
   * section is gone from the DOM rather than hidden in it. That is fine for exactly these two
   * and is why the roster is NOT one of them: see `rosterLimit`.
   */
  const [openGrids, setOpenGrids] = useState<{ lineups: boolean; usage: boolean }>(() => {
    // Read the width directly rather than waiting for `useMediaQuery`, which returns false on
    // the first render and corrects itself in an effect. Fine for a layout swap, and not fine
    // here: a phone would paint both grids open and then snap them shut under the reader.
    const wide = typeof window === 'undefined' || window.innerWidth > 600
    return { lineups: wide, usage: wide }
  })
  useEffect(() => { setOpenGrids({ lineups: !narrow, usage: !narrow }) }, [narrow, team.id])

  /**
   * How much of the roster to show before the reader asks for the rest.
   *
   * DELIBERATELY A WINDOW AND NOT A COLLAPSE, which is what the two grids above get. The
   * roster is the only block on this page carrying real `<a href="/wpbl/players/…">` links (18
   * of them on New York; the leader cards carry the other 18, and the two grids carry none,
   * their cells being onClick-only). `SectionCard` unmounts a collapsed body, Googlebot crawls
   * mobile-first, and CLAUDE.md has a standing note about `/mlb` sitting undiscovered for
   * months because a control had no href. Collapsing this by default would take 18 internal
   * links per team page out of what Google renders, to save 953px.
   *
   * Ten rows keeps ten of those links, saves most of the height, and expands in place rather
   * than into a modal because the roster is the LAST section: nothing below it can jump.
   */
  const ROSTER_WINDOW = 10
  const [rosterAll, setRosterAll] = useState(false)
  useEffect(() => { setRosterAll(false) }, [team.id])
  const rosterRows = useMemo(
    () => (narrow && !rosterAll ? visibleRoster.slice(0, ROSTER_WINDOW) : visibleRoster),
    [visibleRoster, narrow, rosterAll],
  )

  const top = <T,>(list: { player: WpblPlayer; totals: T }[], val: (t: T) => number | null, disp: (t: T) => string, tie: (t: T) => number, n = 3) =>
    list.filter(x => val(x.totals) != null)
      .sort((a, b) => (val(b.totals) as number) - (val(a.totals) as number) || tie(b.totals) - tie(a.totals))
      .slice(0, n)
      .map(x => ({ player: x.player, value: disp(x.totals) }))

  /**
   * The same qualifying bar the league boards use, applied to the two RATE lists here.
   *
   * OPS was gated on `ab > 0` and ERA on `outs > 0`, which is not a bar at all: one at-bat and
   * one hit is a 2.000 OPS and the top of the team's board, and a reliever who recorded a single
   * out without conceding leads it in ERA. Both are the leaderboard reading as a fact about the
   * club when it is really a fact about a cameo.
   *
   * PLATE APPEARANCES, NOT AT-BATS, which is CLAUDE.md's standing trap and is why this goes
   * through `plateAppearances()`: half of OPS is OBP, and a denominator of at-bats throws away
   * every walk, so gating on `ab` quietly keeps the club's most patient hitter off its own
   * board. `wpblQualifiers` returns zeroes before the season is far enough along for a bar to
   * mean anything, which lets everyone through early on exactly as the league boards do.
   *
   * The counting lists (home runs, RBI, strikeouts, innings) are deliberately NOT gated. Nobody
   * hits four home runs in a cameo, and a bar there would only hide a real leader.
   */
  const qual = useMemo(() => wpblQualifiers(teams, games), [teams, games])
  const paNote = qual.active ? `min ${qual.minPa} PA` : undefined
  const ipNote = qual.active ? `min ${outsToIp(qual.minOuts)} IP` : undefined

  const hitLeaders = useMemo(() => [
    { label: 'OPS', note: paNote, rows: top(batSeasons, t => plateAppearances(t) >= qual.minPa ? t.ops : null, t => fmtRate(t.ops), t => plateAppearances(t)) },
    { label: 'Home runs', rows: top(batSeasons, t => t.hr > 0 ? t.hr : null, t => String(t.hr), t => t.ab) },
    { label: 'RBI', rows: top(batSeasons, t => t.rbi > 0 ? t.rbi : null, t => String(t.rbi), t => t.ab) },
  ], [batSeasons, qual, paNote])
  // Three lists, matching the hitting card. Two against three left the pitching card short
  // and the row ragged — and innings is a leaderboard worth having on its own merits: it's
  // the workload number, and nothing else on the page says who is carrying the staff.
  const pitLeaders = useMemo(() => [
    { label: 'ERA', note: ipNote, rows: top(pitSeasons, t => t.era != null && t.outs >= qual.minOuts && t.outs > 0 ? -t.era : null, t => fmtEra(t.era), t => t.outs) },
    { label: 'Strikeouts', rows: top(pitSeasons, t => t.so > 0 ? t.so : null, t => String(t.so), t => t.outs) },
    { label: 'Innings', rows: top(pitSeasons, t => t.outs > 0 ? t.outs : null, t => outsToIp(t.outs), t => t.so) },
  ], [pitSeasons, fmtEra, qual, ipNote])

  // Head-to-head. In a four-team league every club plays every other constantly, so a bare
  // "4–3 · 2nd" hides the shape of the record: a team can be unbeaten against two opponents
  // and swept by the third, and that is the thing worth knowing before the next meeting.
  // Derived from the `games` already passed in — no extra read.
  const headToHead = useMemo(() => {
    const rec = new Map<string, { w: number; l: number; t: number }>()
    for (const g of games) {
      if (g.status !== 'final' || g.home_score == null || g.away_score == null) continue
      const home = g.home_team_id === team.id
      if (!home && g.away_team_id !== team.id) continue
      const oppId = home ? g.away_team_id : g.home_team_id
      const us = home ? g.home_score : g.away_score
      const them = home ? g.away_score : g.home_score
      const r = rec.get(oppId) ?? { w: 0, l: 0, t: 0 }
      if (us > them) r.w++; else if (us < them) r.l++; else r.t++
      rec.set(oppId, r)
    }
    return [...rec.entries()]
      .map(([id, r]) => ({ opp: teamById.get(id), ...r }))
      .filter(x => x.opp)
      // Worst matchup first: the opponent a team can't beat is the interesting one.
      .sort((a, b) => (a.w - a.l) - (b.w - b.l))
  }, [games, team.id, teamById])

  // The full schedule is 15 rows and grows all season — as the top card on a phone that is
  // most of a screenful before you reach anything else. Default to a window around now: the
  // last few results and the next couple of games, which is what anyone opening a team page
  // actually wants. The rest is one tap away.
  const RECENT_DONE = 4
  const NEXT_UP = 2
  const { played: playedGames, upcoming: upcomingGames } = useMemo(() => ({
    played: schedule.filter(g => g.status !== 'scheduled'),
    upcoming: schedule.filter(g => g.status === 'scheduled'),
  }), [schedule])
  // Chronological still, just trimmed at both ends.
  const visibleSchedule = useMemo(
    () => [...playedGames.slice(-RECENT_DONE), ...upcomingGames.slice(0, NEXT_UP)],
    [playedGames, upcomingGames])
  const hiddenCount = schedule.length - visibleSchedule.length

  const loading = roster == null || lines == null
  const played = schedule.some(g => g.status === 'final')
  const recordText = standing
    ? `${standing.row.wins}–${standing.row.losses}${played ? `  ·  ${ordinal(standing.rank)} place` : ''}`
    : 'Inaugural season'

  return (
    <Box>
      {/* Header row. Replaces the plain "← Back / All teams" row this page used to open with,
          and does three jobs that row could not: it says whose page this is, it carries the
          record, and it switches clubs in one tap. It scrolls away with the page rather than
          pinning to the top.

          Back and "All teams" are still different journeys, so both are still here as icons:
          Back retraces how you got here (arriving from the Stats table, that is the stats
          board), while the grid icon always goes up to all four. */}
      <Box
        sx={{
          bgcolor: 'background.default',
          // Full-bleed to the screen edge on mobile (cancelling the swipe pane's 16px inset,
          // then handing it back inside) so the bar spans the width rather than showing through
          // a gutter either side of it.
          mx: { xs: -2, sm: 0 },
          px: { xs: 2, sm: 0 },
          py: BAR_PAD_Y, mb: 1.5,
        }}
      >
        <TeamRail
          teams={teams}
          current={team}
          record={standing && played ? `${standing.row.wins}–${standing.row.losses}` : null}
          onSelect={onSelectTeam && (t => {
            // A different club's page starts at its own top. Keeping the scroll depth would
            // land you at whatever section happens to sit at that pixel on a page of a
            // different length: the roster of one team against the leaders of another.
            window.scrollTo({ top: 0 })
            onSelectTeam(t)
          })}
          onBack={onBack}
          onAllTeams={onAllTeams}
        />
      </Box>

      {/* Identity on the left, spec chart on the right.
          The right of this block was 562 x 137px of nothing at a 1280px viewport, on every team
          page, which is the widest empty run on the section. 137px is too short for six labelled
          spokes, so the row is allowed to grow into it rather than the chart being squeezed into
          the exact gap: the cards below move down about a hundred pixels and the space stops
          being a hole. On a phone there is no gap to fill and it stacks under the chips. */}
      <Box sx={{
        display: 'grid', gap: 2, mb: 2, alignItems: 'center',
        gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) auto' },
      }}>
       <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <TeamBadge team={team} size={52} />
        <Box sx={{ minWidth: 0 }}>
          {/* The page's heading. A selected club replaces the Teams grid, which is why that
              grid's own h1 is not also on screen; this drops to a plain div if a player or
              game modal opens over it. See PageHeading.tsx. */}
          <Typography component={headingTag} sx={{ fontSize: '1.25rem', fontWeight: 900, lineHeight: 1.1, m: 0 }}>{wpblFullName(team)}</Typography>
          <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>{recordText}</Typography>
        </Box>
        </Box>

      {headToHead.length > 0 && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 2 }}>
          {headToHead.map(h => {
            const better = h.w > h.l
            const worse = h.w < h.l
            return (
              <Box
                key={h.opp!.id}
                sx={{
                  display: 'flex', alignItems: 'center', gap: 0.6,
                  px: 0.9, py: 0.4, borderRadius: 999,
                  border: '1px solid', borderColor: CARD_BORDER,
                  bgcolor: 'background.paper',
                }}
              >
                <TeamBadge team={h.opp!} size={16} />
                <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, color: 'text.secondary' }}>
                  {h.opp!.abbr}
                </Typography>
                <Typography sx={{
                  fontSize: '0.72rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums',
                  color: better ? 'success.main' : worse ? 'error.main' : 'text.secondary',
                }}>
                  {h.w}–{h.l}{h.t ? `–${h.t}` : ''}
                </Typography>
              </Box>
            )
          })}
        </Box>
      )}
       </Box>

       {/* The chart, and the same six numbers as text beside it. The readout is not decoration:
           a radar is a picture of six figures, and a `points` attribute is nothing to a screen
           reader or a crawler, so this list is the accessible copy as well as the detail. */}
       <Box sx={{
         display: 'flex', alignItems: 'center', gap: 1.5,
         justifyContent: { xs: 'center', md: 'flex-end' },
         flexWrap: 'wrap',
       }}>
         {specs ? narrow ? (
           // PHONE. The chart takes the whole column and carries its own numbers, and the one
           // line under it replaces the readout. Measured before the change on a 390px screen:
           // the chart drew at 210px inside a 358px column, wasting 41% of the width, with a
           // 121px table under it explaining what the spokes already showed. The chart is now
           // 47% bigger for slightly LESS height than the pair used to take.
           <Box sx={{ width: '100%' }}>
             <TeamSpecRadar
               specs={specs} teams={teams} focusId={team.id} radius={104}
               values={specValues} selected={specAxis} onSelect={setSpecAxis}
             />
             <Box sx={{ mt: 0.75 }}>
               <TeamSpecDetail specs={specs} teamId={team.id} selected={specAxis}
                 kLabel={kLabel} scaleK={v => scaleK(v) ?? v} onClear={() => setSpecAxis(null)} />
             </Box>
           </Box>
         ) : (
           <>
             {/* 260 rather than 230 because the box is drawn at whatever fraction of its own
                 viewBox the container allows, and below about 0.85 the 12px axis labels stop
                 being legible. The width comes out of the identity column, which is a name, a
                 record and three chips in a 340px slot and has it to give. */}
             <Box sx={{ width: 260, flexShrink: 0 }}>
               <TeamSpecRadar specs={specs} teams={teams} focusId={team.id} radius={88} />
             </Box>
             <Box sx={{ minWidth: 132 }}>
               {/* With the other three clubs gone from the chart, the middle ring is the only
                   thing left saying what the shape is measured against, so it has to be named.
                   The readout under it is the same comparison in numbers.

                   RIGHT-ALIGNED, BECAUSE IT IS A COLUMN HEADING AND NOT A TITLE. The readout
                   is a three-column grid and only the last of them holds the pair this names;
                   left-aligned, the words "Club / League" sat over "Power" and "Contact",
                   which are the axis names, and pointed at nothing. Both this and the value
                   column are flush to the same right edge, so aligning it there parks it
                   directly above the ".192 / .148" it is explaining. */}
               <Typography sx={{ fontSize: '0.62rem', fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase', color: 'text.disabled', mb: 0.5, textAlign: 'right' }}>
                 Club / League
               </Typography>
               <TeamSpecReadout specs={specs} teamId={team.id} kLabel={kLabel}
                 scaleK={v => scaleK(v) ?? v} />
             </Box>
           </>
         ) : (
           <Box sx={{ width: '100%', maxWidth: 340 }}>
             <TeamSpecPlaceholder minGames={specGames} ready={allLines != null} />
           </Box>
         )}
       </Box>
      </Box>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {/* Results, team totals and leaders are all narrow-content cards: on a phone they
              stack, but on a wide screen a single 720px column leaves each one mostly empty
              space with a very tall list down the left. Auto-flow into two columns instead.
              `alignItems: start` stops a short card stretching to match a tall neighbour. */}
          <Box sx={{
            display: 'grid', gap: 2,
            gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
            // Cards stretch to their row's height rather than each ending wherever its
            // content does. Ragged bottoms are what made this read as four loose boxes
            // instead of a grid; the two cards in a row now share a baseline.
            alignItems: 'stretch',
          }}>
          {/* Results */}
          <SectionCard
            title="Results"
            action={hiddenCount > 0 ? (
              // Opens the full season in a modal. Expanding in place pushed everything below
              // it down by nine rows, so the card you were reading jumped out from under you
              // and you had to find your way back up to collapse it again.
              <CardLink label={`All ${schedule.length}`} accent={accent}
                onClick={() => setScheduleOpen(true)} />
            ) : undefined}
          >
            <Box sx={{ display: 'flex', flexDirection: 'column' }}>
              {visibleSchedule.map(g => (
                <ScheduleRow key={g.id} game={g} teamId={team.id} teamById={teamById} onOpenGame={onOpenGame} />
              ))}
              {visibleSchedule.length === 0 && <Typography sx={{ fontSize: '0.82rem', color: 'text.disabled', py: 1 }}>No games scheduled.</Typography>}
            </Box>
          </SectionCard>

          {/* Team season totals */}
          <SectionCard
            title="Team stats"
            action={onOpenStats ? (
              // Lands on the Teams board, which is where these totals become meaningful —
              // a .355 team average says nothing until you can see the other three.
              <CardLink label="Compare teams" accent={accent}
                onClick={() => onOpenStats('hitting', undefined, { mode: 'teams' })} />
            ) : undefined}
          >
            {teamBat && teamBat.g > 0 ? (
              <>
                <SectionLabel>Batting</SectionLabel>
                <StatTiles items={[
                  { label: 'AVG', value: fmtRate(teamBat.avg) },
                  { label: 'OBP', value: fmtRate(teamBat.obp) },
                  { label: 'SLG', value: fmtRate(teamBat.slg) },
                  { label: 'OPS', value: fmtRate(teamBat.ops) },
                  { label: 'R', value: String(teamBat.r) },
                  { label: 'HR', value: String(teamBat.hr) },
                  { label: 'RBI', value: String(teamBat.rbi) },
                  { label: 'SB', value: String(teamBat.sb) },
                ]} />
                {teamPit && teamPit.g > 0 && (
                  <Box sx={{ mt: 1.75 }}>
                    <SectionLabel>Pitching</SectionLabel>
                    {/* Mirrors the batting block: four rates on top, four counting stats
                        below. No W–L here — that is the record, and the record is already
                        the first thing on the page, under the team name. The K rate and K/BB earn
                        those slots instead: this league walks a great many batters, so
                        command is the thing the raw totals hide. */}
                    <StatTiles items={[
                      { label: 'ERA', value: fmtEra(teamPit.era) },
                      { label: 'WHIP', value: fmtTwo(teamPit.whip) },
                      { label: kLabel, value: fmtK(teamPit.k9) },
                      { label: 'K/BB', value: fmtTwo(teamPit.kbb) },
                      { label: 'IP', value: outsToIp(teamPit.outs) },
                      { label: 'SO', value: String(teamPit.so) },
                      { label: 'BB', value: String(teamPit.bb) },
                      { label: 'HR', value: String(teamPit.hr) },
                    ]} />
                  </Box>
                )}
              </>
            ) : (
              <Typography sx={{ fontSize: '0.8rem', color: 'text.disabled', py: 1 }}>Team stats appear once games are played.</Typography>
            )}
          </SectionCard>

          </Box>

          {/* Full-width next, because they scroll sideways. These two are also the most
              distinctive thing on the page — season leaders are the most replaceable — so
              they come before the leader cards rather than three scrolls below them. */}

          {/* How the manager has actually been filling out the card */}
          {roster && lineups.length > 0 && (
            <LineupHistory rows={lineups} roster={league} accent={accent} onOpenPlayer={onOpenPlayer}
              collapsed={!openGrids.lineups}
              onToggleCollapse={() => setOpenGrids(o => ({ ...o, lineups: !o.lineups }))} />
          )}

          {/* Who's been worked, and who's available */}
          {roster && usage.length > 0 && (
            <PitchingUsage rows={usage} roster={league} accent={accent} onOpenPlayer={onOpenPlayer}
              collapsed={!openGrids.usage}
              onToggleCollapse={() => setOpenGrids(o => ({ ...o, usage: !o.usage }))} />
          )}

          {/* Leaders, back in a two-column grid of their own. */}
          <Box sx={{
            display: 'grid', gap: 2, alignItems: 'stretch',
            gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
            mb: 0,
          }}>
          {/* Leaders, split by side of the ball. One combined card stacked five lists into a
              single very tall column — awkward on a phone, and on a wide screen it sat alone
              in one grid column with the other left empty. Two cards fill the row and read
              better besides: nobody scans hitting and pitching leaders in one pass. */}
          {hitLeaders.some(b => b.rows.length) && (
            <SectionCard title="Hitting leaders" subtitle="Season">
              {hitLeaders.map(b => <LeaderList key={b.label} label={b.label} note={'note' in b ? b.note : undefined} rows={b.rows} accent={accent} onOpenPlayer={onOpenPlayer} />)}
            </SectionCard>
          )}
          {pitLeaders.some(b => b.rows.length) && (
            <SectionCard title="Pitching leaders" subtitle="Season">
              {pitLeaders.map(b => <LeaderList key={b.label} label={b.label} note={'note' in b ? b.note : undefined} rows={b.rows} accent={accent} onOpenPlayer={onOpenPlayer} />)}
            </SectionCard>
          )}

          </Box>

          {/* Roster with inline stats */}
          <SectionCard
            title="Roster"
            subtitle={rosterRows.length < visibleRoster.length
              ? `${rosterRows.length} of ${visibleRoster.length} players`
              : `${visibleRoster.length} players`}
            action={onOpenStats ? (
              // The roster row shows three stats; this is the door to all of them, with the
              // team filter chip already set so you don't land in the whole league.
              //
              // AND QUALIFIED OFF, because this card is the whole roster and the board it
              // opens should be too. Landing on the qualified board answered a question
              // nobody asked here: most of the names the reader had just scrolled past were
              // simply gone, and the only clue was a lit chip above the table.
              <CardLink label="Full stats" accent={accent}
                onClick={() => onOpenStats('hitting', undefined, { mode: 'players', teamId: team.id, qualified: false })} />
            ) : undefined}
          >
            {visibleRoster.length === 0 ? (
              <Typography sx={{ fontSize: '0.82rem', color: 'text.disabled', py: 1 }}>Roster coming soon.</Typography>
            ) : (
              // Two columns on a wide screen. A roster row is a position, a face, a name and
              // three numbers — across a full-width card that leaves most of the row empty
              // while the card runs well over a thousand pixels tall. The nth-of-type rule
              // clears the top border on the first row of the SECOND column too; without it
              // that row gets a stray rule above it.
              <Box sx={{
                display: 'grid',
                // Without an explicit width the grid sizes to its content and leaves the
                // right of the card empty instead of splitting it in two.
                width: '100%',
                gridTemplateColumns: '1fr',
                columnGap: 2.5,
                // Grid items default to min-width:auto, so a row refuses to shrink below its
                // content and overflows its track — the name's own minWidth:0 doesn't help,
                // because the constraint is on the row, not on the text inside it.
                '& > *': { minWidth: 0 },
                '& > :first-of-type': { borderTop: 'none' },
                // Both the column count and the second column's border reset live in ONE
                // media block on purpose. Writing `gridTemplateColumns: { xs, md }` next to a
                // literal '@media (min-width:900px)' key silently drops the md value: MUI
                // expands the responsive object into a media block with the same key, the two
                // collide on merge, and the literal one wins — leaving a one-column grid with
                // no error anywhere.
                '@media (min-width:900px)': {
                  // minmax(0, 1fr), not 1fr: a bare 1fr floors at the track's min-content
                  // width, so a long name widens its own column and the two end up uneven.
                  gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
                  '& > :nth-of-type(2)': { borderTop: 'none' },
                },
              }}>
                {rosterRows.map(p => {
                  const pit = pitByPid.get(p.id)
                  const bat = batByPid.get(p.id)
                  const pitcher = isPitcherPos(p.position) || (pit != null && pit.outs > 0 && (bat == null || bat.ab === 0))
                  const stats = pitcher ? pitcherStats(pit, fmtEra) : batterStats(bat)
                  return (
                    <Box key={p.id} {...playerLink(p, onOpenPlayer)} sx={{
                      display: 'flex', alignItems: 'center', gap: 1.25, py: 0.9, cursor: 'pointer',
                      borderTop: '1px solid', borderColor: 'divider',
                      borderRadius: 1, ...TAPPABLE, ...FOCUS_RING,
                    }}>
                      <Typography sx={{ width: '1.625rem', textAlign: 'center', flexShrink: 0, fontSize: '0.72rem', fontWeight: 800, color: accent }}>
                        {displayPositionFromIndex(p, positionIndex).label || '—'}
                      </Typography>
                      <PlayerPortrait name={p.name} teamId={p.team_id} size={34} />
                      <Typography sx={{ flex: 1, fontSize: '0.88rem', fontWeight: 600, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{shortName(p.name)}</Typography>
                      <Box sx={{ display: 'flex', gap: 1.5, flexShrink: 0 }}>
                        {stats.map(s => (
                          <Box key={s.label} sx={{ textAlign: 'right', minWidth: '2.125rem' }}>
                            <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>{s.value}</Typography>
                            <Typography sx={{ fontSize: '0.54rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3, color: 'text.disabled' }}>{s.label}</Typography>
                          </Box>
                        ))}
                      </Box>
                    </Box>
                  )
                })}
              </Box>
            )}
            {/* The rest of the roster, in place. Not a modal, unlike Results: this is the last
                section on the page, so there is nothing below it to be pushed out from under
                the reader, and a modal would put ten player links behind a control Googlebot
                does not press. */}
            {rosterRows.length < visibleRoster.length && (
              <Box
                role="button"
                tabIndex={0}
                onClick={() => setRosterAll(true)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setRosterAll(true) } }}
                sx={{
                  mt: 1, py: 0.9, borderRadius: 1, textAlign: 'center', cursor: 'pointer',
                  border: '1px solid', borderColor: CARD_BORDER,
                  ...TAPPABLE, ...FOCUS_RING,
                }}
              >
                <Typography sx={{ fontSize: '0.76rem', fontWeight: 700, color: accent }}>
                  {`Show all ${visibleRoster.length}`}
                </Typography>
              </Box>
            )}
          </SectionCard>
        </Box>
      )}

      {/* Full season, in a modal rather than an in-place expansion. Split into what has been
          played and what is still to come — a flat run of fifteen rows makes you hunt for the
          boundary, and it is the one thing a schedule is actually asked. */}
      {scheduleOpen && (
        <ModalShell
          eyebrow={`${wpblFullName(team)} · ${schedule.length} games`}
          onClose={() => setScheduleOpen(false)}
          maxWidth={560}
        >
          <Box sx={{ px: 2, pb: 2 }}>
            {playedGames.length > 0 && (
              <Box sx={{ pt: 1.5 }}>
                <SectionLabel>{`Played · ${playedGames.length}`}</SectionLabel>
                {playedGames.map(g => (
                  <ScheduleRow
                    key={g.id} game={g} teamId={team.id} teamById={teamById}
                    // Close first: leaving the modal stacked over the game centre would
                    // trap the reader behind two layers of back.
                    onOpenGame={g2 => { setScheduleOpen(false); onOpenGame(g2) }}
                  />
                ))}
              </Box>
            )}
            {upcomingGames.length > 0 && (
              <Box sx={{ pt: playedGames.length > 0 ? 2.5 : 1.5 }}>
                <SectionLabel>{`Upcoming · ${upcomingGames.length}`}</SectionLabel>
                {upcomingGames.map(g => (
                  <ScheduleRow
                    key={g.id} game={g} teamId={team.id} teamById={teamById}
                    onOpenGame={g2 => { setScheduleOpen(false); onOpenGame(g2) }}
                  />
                ))}
              </Box>
            )}
          </Box>
        </ModalShell>
      )}
    </Box>
  )
}

function batterStats(t: WpblBattingTotals | undefined): { label: string; value: string }[] {
  if (!t || t.ab === 0) return [{ label: 'AVG', value: '—' }, { label: 'HR', value: '—' }, { label: 'RBI', value: '—' }]
  return [
    { label: 'AVG', value: fmtRate(t.avg) },
    { label: 'HR', value: String(t.hr) },
    { label: 'RBI', value: String(t.rbi) },
  ]
}
function pitcherStats(t: WpblPitchingTotals | undefined, fmtEra: (v: number | null) => string): { label: string; value: string }[] {
  if (!t || t.outs === 0) return [{ label: 'IP', value: '—' }, { label: 'ERA', value: '—' }, { label: 'SO', value: '—' }]
  return [
    { label: 'IP', value: outsToIp(t.outs) },
    { label: 'ERA', value: fmtEra(t.era) },
    { label: 'SO', value: String(t.so) },
  ]
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0])
}
