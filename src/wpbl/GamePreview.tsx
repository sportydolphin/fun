import { useDark } from '../ui/useDark'
import { NameText } from '../ui/NameText'
import { useEffect, useMemo, useState } from 'react'
import { Box, Typography } from '@mui/material'
import { fetchWpblAllLines, getCachedWpblAllLines, fetchWpblAllPlayers, getCachedWpblAllPlayers } from './api'
import { ModalShell, TeamBadge, PlayerPortrait, hoverOnly, FOCUS_RING, TYPE_SCALE } from './ui'
import { ComparisonBars, MatchupHeader, PreviewEmpty, PreviewFrame, type PreviewSide } from '../ui/gamePreview'
import { wpblAccent, wpblFullName, positionRank } from './constants'
import { computeWpblTeamStats, WPBL_TEAM_STAT_DEFS } from './stats'
import { useEraBasis } from './EraBasisContext'
import { useWpblPlayerLink } from './LinkContext'
import { teamLeaders, LeaderTable } from './TeamLeaders'
import type { WpblTeam, WpblGame, WpblPlayer } from './types'
import { typePx } from '../ui/scale'
import { useWpblSeason } from './SeasonContext'

// WPBL's binding of the game preview (the drawing is src/ui/gamePreview.tsx), shown inside Game
// Center for a game that hasn't been played yet, on Home's Next game card and in the series and
// matchup sheets. It feeds the league's own numbers, club badges and links, and adds what only
// WPBL has: each club's leaders and active roster as boards beside the comparison. Built from the
// same box-score lines the leaders read (cached by Home), so it needs no extra fetch on a warm app.


/** The three rows the compact cut keeps: how many runs a club scores, how well it hits, how
 *  many runs it gives up. Score, hit, prevent: the shortest honest description of a baseball
 *  team, and the three a reader can hold in their head between the team rows above and the
 *  first pitch. The full nine live one tap away in Game Center, which is where somebody who
 *  wants WHIP has already gone. */
const COMPACT_KEYS = ['rpg', 'ops', 'era'] as const

export function WpblGamePreview({ away, home, teams, games: allGames, onOpenTeam, onOpenPlayer, compact, bare, rosters, renderBoards }: {
  away: WpblTeam
  home: WpblTeam
  teams: WpblTeam[]
  games: WpblGame[]
  /** Open a club's page from its chip. Optional so the preview still renders anywhere that
   *  has nowhere to send the tap. */
  onOpenTeam?: (team: WpblTeam) => void
  /** Open a player's page from a roster row. Optional for the same reason as onOpenTeam. */
  onOpenPlayer?: (player: WpblPlayer) => void
  /** Show each club's active roster under the season comparison. For the pre-game screen and the
   *  postseason matchup preview, where "who is on this team" is a question the reader has and the
   *  season bars do not answer. Off for the compact Home cut and the Home hero, which have no room
   *  for two rosters. */
  rosters?: boolean
  /** Three rows instead of nine, one line per value instead of two, and no chrome of its own:
   *  no card padding, no legend, no footnote, no group rules. For Home's Next game card, which
   *  is a card already and supplies all of that, and which has room for a tale of the tape but
   *  not for a second card's worth of it.
   *
   *  It also renders NOTHING rather than an empty state. In GameDetail this component IS the
   *  pane, so "this game hasn't been played yet" is the answer to the reader's question; on
   *  Home it is the last block of a card that has already said plenty, and a card that grows a
   *  paragraph of apology on the season's first day is worse than one that simply stops. */
  compact?: boolean
  /** Drop the "Season Comparison" heading and the card's own padding, for a caller that has
   *  already titled this block and supplied the surround. The series overview has: it sits
   *  under a "Tale of the tape" label, inside a sheet whose eyebrow already names both clubs,
   *  so the heading was the third time in four inches that the same thing was said. The
   *  club legend STAYS, because it is the key to which color is whose and the bars are
   *  unreadable without it. */
  bare?: boolean
  /** With `rosters`, hand the three boards to the caller to lay out instead of drawing the toggle
   *  that pages between them. For the full-page Game Center, which has room for all three at once
   *  and puts each in its own section. */
  renderBoards?: (boards: { matchup: React.ReactNode; leaders: React.ReactNode; rosters: React.ReactNode }) => React.ReactNode
}) {
  const isDark = useDark()
  const playerLink = useWpblPlayerLink()
  const { basis: eraBasis, kLabel } = useEraBasis()
  // THE CURRENT SEASON, which is what a preview compares: the clubs as they stand. In the spring,
  // before the new year has a result, that is still last season, which is the best evidence there is.
  const { season, cut, seasonGames: games } = useWpblSeason(allGames, { current: true })
  const [allLines, setLines] = useState(() => getCachedWpblAllLines())
  const lines = useMemo(
    () => allLines && { batting: cut(allLines.batting), pitching: cut(allLines.pitching) }, [allLines, cut])
  const [failed, setFailed] = useState(false)
  // The league roster, only when this cut shows it. App-wide cache, so on a warm page it costs
  // no request; the club rosters are read off it by `team_id`, which means "now" and is exactly
  // the active roster an upcoming game wants.
  const [players, setPlayers] = useState<WpblPlayer[] | null>(() => getCachedWpblAllPlayers())

  useEffect(() => {
    if (allLines) return              // warm cache: no fetch, no flash
    let cancelled = false
    fetchWpblAllLines()
      .then(l => { if (!cancelled) setLines(l) })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
    // Once per mount: `lines` only says whether the cache already had them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!rosters || players) return
    let cancelled = false
    fetchWpblAllPlayers().then(p => { if (!cancelled) setPlayers(p) }).catch(() => { /* rosters omit themselves */ })
    return () => { cancelled = true }
  }, [rosters, players])

  const stats = useMemo(
    () => (lines ? computeWpblTeamStats(teams, games, lines.batting, lines.pitching, eraBasis) : null),
    [lines, teams, games, eraBasis],
  )

  // Each club's stat leaders, for the "players to watch" board. Only when this cut offers rosters
  // (which is what fetches the players); null until both the lines and the roster are in hand.
  const leaders = useMemo(
    () => (rosters && lines && players
      ? {
        away: teamLeaders(away, players, lines.batting, lines.pitching, games, teams, eraBasis),
        home: teamLeaders(home, players, lines.batting, lines.pitching, games, teams, eraBasis),
      }
      : null),
    [rosters, lines, players, away, home, games, teams, eraBasis],
  )

  // Player ids that have appeared in a box-score line this season, batting or pitching. The
  // roster filter needs this because `status` alone is wrong: nearly half the league sits at
  // 'Drafted' rather than 'Signed', and ten of those have actually suited up (Baird, Frank and
  // Villarreal all played for LA), so a `status === 'Signed'` gate drops real, rostered players.
  // Built from `lines`, already in hand, so it costs no fetch.
  const playedIds = useMemo(() => {
    const s = new Set<string>()
    for (const l of lines?.batting ?? []) if (l.player_id) s.add(l.player_id)
    for (const l of lines?.pitching ?? []) if (l.player_id) s.add(l.player_id)
    return s
  }, [lines])

  const awayStats = stats?.get(away.id)
  const homeStats = stats?.get(home.id)
  const loading = !stats && !failed
  // Nothing to compare yet (opening days, neither club has logged a line): say so plainly
  // rather than drawing empty tracks.
  if (!loading && (failed || (!awayStats && !homeStats))) {
    if (compact) return null
    return <PreviewEmpty />
  }

  // Bar colors come from the shared team accent palette (`wpblAccent`), which exists for exactly
  // this reason: the raw primaries are all near-black and unusable as foreground.
  const side = (team: WpblTeam): PreviewSide => ({
    abbr: team.abbr,
    color: wpblAccent(team.id, isDark),
    mark: size => <TeamBadge team={team} size={size} />,
    // `pressable` rather than an anchor, like every other team target in the section: a club
    // page is history state on /wpbl/teams rather than a URL of its own.
    onOpen: onOpenTeam ? () => onOpenTeam(team) : undefined,
    openLabel: `${wpblFullName(team)} team page`,
  })
  const awaySide = side(away)
  const homeSide = side(home)

  const comparisonView = (
    <ComparisonBars
      away={awaySide} home={homeSide} defs={WPBL_TEAM_STAT_DEFS}
      awayStats={awayStats} homeStats={homeStats} loading={loading}
      compact={compact} compactKeys={COMPACT_KEYS}
      labelFor={def => (def.key === 'k9' ? kLabel : def.label)}
      footnote={`${season != null ? `${season} season` : 'Season'} · bar length = rank in the league, longer is better`}
    />
  )

  // The compact cut: three rows, and everything a host card already provides is left to it.
  if (compact) return comparisonView

  // One club's active roster: whose club is this one now, sorted by position the way a lineup
  // card reads. `team_id` is "now", which is the right question for a game that has not happened
  // yet. A player belongs if the league has them Signed OR they have appeared in a game (see
  // `playedIds`): 'Drafted' is not off the roster, it is the status half the league carries, so
  // gating on 'Signed' alone hid ten players who have actually played. The 48 draftees who have
  // not suited up stay out, which is the line "on the roster" should draw. Named plainly (no
  // box-score override), because this is the roster the league lists, not where a player has been used.
  const rosterCol = (team: WpblTeam, color: string) => {
    const list = (players ?? [])
      .filter(p => p.team_id === team.id && (p.status === 'Signed' || playedIds.has(p.id)))
      .sort((a, b) => positionRank(a.position) - positionRank(b.position) || a.name.localeCompare(b.name))
    return (
      <Box sx={{ minWidth: 0 }}>
        {/* The full club name where the column is wide enough for it (desktop), the abbreviation
            on a phone where two columns leave no room. */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 1 }}>
          <TeamBadge team={team} size={24} />
          <Typography noWrap sx={{ minWidth: 0, fontSize: TYPE_SCALE.body, fontWeight: 800, color, lineHeight: 1.15 }}>
            <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>{wpblFullName(team)}</Box>
            <Box component="span" sx={{ display: { xs: 'inline', sm: 'none' } }}>{team.abbr}</Box>
          </Typography>
        </Box>
        {list.length === 0 ? (
          <Typography sx={{ fontSize: TYPE_SCALE.micro, color: 'text.disabled' }}>Roster not available</Typography>
        ) : list.map(p => {
          const link = onOpenPlayer ? playerLink(p, onOpenPlayer) : {}
          return (
            <Box key={p.id} {...link} sx={{
              display: 'flex', alignItems: 'center', gap: 0.75, py: 0.35, px: 0.5, mx: -0.5,
              minWidth: 0, textDecoration: 'none', color: 'inherit', borderRadius: 1,
              // A hover tint marks the row as clickable, and it is DESKTOP-ONLY: `hoverOnly` gates
              // it behind `@media (hover: hover)`, so a touch scroll on a phone never flashes or
              // leaves a row looking selected (no `:active` press tint here for the same reason).
              ...(onOpenPlayer ? { cursor: 'pointer', ...FOCUS_RING, transition: 'background 0.12s', ...hoverOnly({ bgcolor: 'action.hover' }) } : {}),
            }}>
              <PlayerPortrait name={p.name} teamId={team.id} size={22} />
              <NameText name={p.name} sx={{ flex: 1, minWidth: 0, fontSize: TYPE_SCALE.body, fontWeight: 600 }} />
              {p.position && (
                <Typography sx={{
                  flexShrink: 0, fontSize: TYPE_SCALE.micro, fontWeight: 700, color: 'text.disabled',
                  textTransform: 'uppercase', letterSpacing: typePx(0.3),
                }}>{p.position}</Typography>
              )}
            </Box>
          )
        })}
      </Box>
    )
  }

  // The two roster columns. Capped and centered on a desktop: at full page width each column ran
  // the length of the sheet and threw its position label to the far edge.
  const rostersView = (
    <Box sx={{
      display: 'grid', columnGap: { xs: 2, md: 6 }, alignItems: 'start',
      gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(2, minmax(0, 24rem))' },
      justifyContent: { md: 'center' },
    }}>
      {rosterCol(away, awaySide.color)}
      {rosterCol(home, homeSide.color)}
    </Box>
  )

  // Each club's stat leaders, side by side. The one board that answers "who is worth watching",
  // which the team bars and the full rosters do not.
  const leadersView = leaders && (leaders.away.length > 0 || leaders.home.length > 0) ? (
    <LeaderTable away={away} home={home} awayLeaders={leaders.away} homeLeaders={leaders.home} onOpenPlayer={onOpenPlayer} rich />
  ) : (
    <Typography sx={{ fontSize: TYPE_SCALE.micro, color: 'text.disabled', textAlign: 'center', py: 2 }}>
      No data
    </Typography>
  )

  if (rosters && renderBoards) {
    return <>{renderBoards({ matchup: comparisonView, leaders: leadersView, rosters: rostersView })}</>
  }

  // With rosters offered, the frame's toggle chooses the board, matchup first: "who is favored" is
  // the first thing a reader asks, then "who is worth watching", then "who is on this team".
  return (
    <PreviewFrame bare={bare} boards={rosters
      ? [
        { value: 'comparison', label: 'Matchup', node: comparisonView },
        { value: 'leaders', label: 'Leaders', node: leadersView },
        { value: 'rosters', label: 'Rosters', node: rostersView },
      ]
      : [{ value: 'comparison', label: 'Matchup', node: comparisonView }]}
    />
  )
}

/**
 * A postseason matchup the league has dated but the feed has no game row for yet, opened.
 *
 * The Schedule tab and the Home scoreboard carry these as placeholder cards; once both clubs are
 * seeded there is a real matchup to preview even though there is no game to open, so the card
 * opens this instead of nothing. It is deliberately NOT the full Game Center (there is no box
 * score, play-by-play or line score to show) and NOT `SeriesPreview` (which needs the bracket's
 * odds and standings): it is the season comparison and the two rosters, which is what a reader
 * asks of a fixture that has not happened.
 */
export function WpblMatchupPreview({ away, home, teams, games, eyebrow, onClose, onOpenTeam, onOpenPlayer }: {
  away: WpblTeam
  home: WpblTeam
  teams: WpblTeam[]
  games: WpblGame[]
  /** "Semifinal A · Game 1 · Tue, Sep 9". Named by the caller, which is the only thing that knows
   *  the round and the date. */
  eyebrow: string
  onClose: () => void
  onOpenTeam?: (team: WpblTeam) => void
  onOpenPlayer?: (player: WpblPlayer) => void
}) {
  return (
    // Wider as the screen allows: a 640px dialog is a quarter of a desktop monitor, and the
    // matchup (long stat bars, two rosters) is exactly the content that reads better with room.
    // Still full width on a phone and a comfortable dialog in between.
    <ModalShell eyebrow={eyebrow} onClose={onClose} maxWidth={{ xs: '100%', sm: 720, md: 860, lg: 1000 }} zIndex={1600}>
      <MatchupHeader
        away={{ abbr: away.abbr, mark: size => <TeamBadge team={away} size={size} /> }}
        home={{ abbr: home.abbr, mark: size => <TeamBadge team={home} size={size} /> }}
      />
      <WpblGamePreview
        away={away} home={home} teams={teams} games={games}
        onOpenTeam={onOpenTeam ? t => { onClose(); onOpenTeam(t) } : undefined}
        // Close this local modal before opening the player's page, so the two never stack: the
        // matchup preview is not on the history stack and the player page is.
        onOpenPlayer={onOpenPlayer ? p => { onClose(); onOpenPlayer(p) } : undefined}
        rosters
      />
    </ModalShell>
  )
}
