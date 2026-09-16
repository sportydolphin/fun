import { useEffect, useMemo, useState } from 'react'
import { Box, Typography } from '@mui/material'
import { fetchWpblAllLines, getCachedWpblAllLines, fetchWpblAllPlayers, getCachedWpblAllPlayers } from './api'
import { ModalShell, SegNav, TeamBadge, PlayerPortrait, useWpblDark, useWpblName, pressable, hoverOnly, FOCUS_RING, TAPPABLE, TYPE_SCALE } from './ui'
import { wpblAccent, wpblFullName, positionRank } from './constants'
import {
  computeWpblTeamStats, WPBL_TEAM_STAT_DEFS,
  type WpblTeamStatValue,
} from './stats'
import { useEraBasis } from './EraBasisContext'
import { useWpblPlayerLink } from './LinkContext'
import { teamLeaders, LeaderTable } from './TeamLeaders'
import type { WpblTeam, WpblGame, WpblPlayer } from './types'

// The WPBL game-preview matchup card — the analogue of the MLB app's GamePreview
// TeamComparison, shown inside GameDetail for a game that hasn't been played yet. Each
// row is a diverging bar scaled to the league's range for that stat, so the two clubs read
// against each other (and against the league) at a glance. Bars always grow toward "better",
// including for ERA/WHIP where the lower number wins. Built from the same box-score lines the
// leaders read (cached by Home), so it needs no extra fetch on a warm app.

const CURRENT_SEASON = 2026

/** The three rows the compact cut keeps: how many runs a club scores, how well it hits, how
 *  many runs it gives up. Score, hit, prevent: the shortest honest description of a baseball
 *  team, and the three a reader can hold in their head between the team rows above and the
 *  first pitch. The full nine live one tap away in Game Center, which is where somebody who
 *  wants WHIP has already gone. */
const COMPACT_KEYS = ['rpg', 'ops', 'era'] as const

function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th'
    : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th'
  return `${n}${suffix}`
}

// Bar colors come from the shared team accent palette (constants.ts `wpblAccent`), which
// exists for exactly this reason: the raw primaries are all near-black and unusable as
// foreground. Keeping one source means a palette tweak lands everywhere at once.
export function WpblGamePreview({ away, home, teams, games, onOpenTeam, onOpenPlayer, compact, bare, rosters }: {
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
   *  club legend STAYS, because it is the key to which colour is whose and the bars are
   *  unreadable without it. */
  bare?: boolean
}) {
  const isDark = useWpblDark()
  const shortName = useWpblName()
  const playerLink = useWpblPlayerLink()
  const { basis: eraBasis, kLabel } = useEraBasis()
  const [lines, setLines] = useState(() => getCachedWpblAllLines())
  const [failed, setFailed] = useState(false)
  // The league roster, only when this cut shows it. App-wide cache, so on a warm page it costs
  // no request; the club rosters are read off it by `team_id`, which means "now" and is exactly
  // the active roster an upcoming game wants.
  const [players, setPlayers] = useState<WpblPlayer[] | null>(() => getCachedWpblAllPlayers())
  // Which board the toggle shows, when this cut has rosters to offer. Defaults to the matchup: it
  // is the answer to "who is favoured", which is the first thing a reader asks; the leaders answer
  // "who is worth watching", and the rosters "who is on this team", in that order.
  const [board, setBoard] = useState<'comparison' | 'leaders' | 'rosters'>('comparison')

  useEffect(() => {
    if (lines) return              // warm cache — no fetch, no flash
    let cancelled = false
    fetchWpblAllLines()
      .then(l => { if (!cancelled) setLines(l) })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
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

  const awayStats = stats?.get(away.id)
  const homeStats = stats?.get(home.id)
  const loading = !stats && !failed

  // Nothing to compare yet (opening days, neither club has logged a line) — say so plainly
  // rather than drawing empty tracks.
  if (!loading && (failed || (!awayStats && !homeStats))) {
    if (compact) return null
    return (
      <Box sx={{ px: 2, py: 3, textAlign: 'center' }}>
        <Typography sx={{ fontSize: TYPE_SCALE.title, fontWeight: 700, mb: 0.5 }}>This game hasn't been played yet</Typography>
        <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.disabled' }}>
          Season stats to compare appear once both clubs have played.
        </Typography>
      </Box>
    )
  }

  const awayColor = wpblAccent(away.id, isDark)
  const homeColor = wpblAccent(home.id, isDark)
  const trackBg = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)'

  const shimmer = {
    bgcolor: 'action.hover', borderRadius: 0.75,
    '@keyframes wpblPvPulse': { '0%,100%': { opacity: 0.5 }, '50%': { opacity: 0.85 } },
    animation: 'wpblPvPulse 1.1s ease-in-out infinite',
  } as const

  // value + rank stacked on the outer edge, bar growing inward from it.
  const valueCell = (v: WpblTeamStatValue | undefined, better: boolean, color: string, align: 'right' | 'left') => (
    <Box sx={{ width: '2.75rem', flexShrink: 0, textAlign: align }}>
      {loading ? (
        <Box sx={{ ...shimmer, width: '2rem', height: '0.8rem', ml: align === 'right' ? 'auto' : 0 }} />
      ) : (
        <>
          {/* THE COMPACT CUT IS A FOOTER AND IS TYPED LIKE ONE. At 0.82rem/900 in a club accent
              these three values were the heaviest ink in Home's Next game card, ahead of the
              club names the card is about; the only caller of `compact` is that card. The
              winner keeps its colour at both sizes: that is the comparison, and dropping it
              would leave three bars saying nothing a glance can pick up.

              800 AND NOT 900 AT FULL SIZE. Weight and a saturated accent are two emphases on
              one short string, and at 900 they stop adding up and start fighting: the strokes
              of a tabular figure at that weight close up the counters, and in a colour chosen
              to be READ against the page rather than to sit quietly, the number came out as a
              blob that had to be worked at. It still has 200 weights and the whole colour on
              the losing side, which is more than enough to say which one won. */}
          <Typography sx={{
            fontSize: compact ? TYPE_SCALE.meta : TYPE_SCALE.body,
            fontWeight: better ? (compact ? 700 : 800) : 600, lineHeight: 1.1,
            color: better ? color : 'text.secondary', fontVariantNumeric: 'tabular-nums',
          }}>
            {v?.display ?? '—'}
          </Typography>
          {/* The league rank under the value, and the first thing the compact cut drops: it is
              a second line on every cell, so it is a third of the block's height, and it is the
              detail a reader goes to Game Center for. The bar already says the same thing in
              the only resolution that matters at this size, which is longer or shorter. */}
          {!compact && (
            <Typography sx={{ fontSize: TYPE_SCALE.nano, fontWeight: 600, color: 'text.disabled', lineHeight: 1.2 }}>
              {v ? ordinal(v.rank) : ''}
            </Typography>
          )}
        </>
      )}
    </Box>
  )

  // Half-track: bar anchored at the center label, growing outward, its length the team's
  // position in the league range for that stat.
  const bar = (v: WpblTeamStatValue | undefined, better: boolean, color: string, side: 'away' | 'home') => (
    <Box sx={{
      // 4px in the footer cut, 8 at full size, a touch taller on a desktop where the bar is
      // longer and a thin rule would read as faint against it. A 8px bar beside 0.72rem type is a
      // chart with a caption; at 4 it reads as the rule it sits under.
      flex: 1, minWidth: 0, height: compact ? 4 : { xs: 8, md: 10 }, borderRadius: 999, bgcolor: trackBg,
      position: 'relative', overflow: 'hidden',
    }}>
      {!loading && v && (
        <Box sx={{
          position: 'absolute', top: 0, bottom: 0,
          [side === 'away' ? 'right' : 'left']: 0,
          // Floor keeps a last-in-league value visible rather than zero-width.
          width: `${Math.max(5, v.pct * 100)}%`,
          bgcolor: color, opacity: better ? 1 : 0.4,
          borderRadius: 999,
          transition: 'width 0.35s ease, opacity 0.2s',
        }} />
      )}
    </Box>
  )

  const row = (def: typeof WPBL_TEAM_STAT_DEFS[number]) => {
    const a = awayStats?.[def.key]
    const h = homeStats?.[def.key]
    // Rank already encodes direction (1 = best), so it decides the winner for both
    // higher-is-better and lower-is-better stats.
    const awayBetter = !!a && !!h && a.rank < h.rank
    const homeBetter = !!a && !!h && h.rank < a.rank

    return (
      <Box key={def.key} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, py: compact ? 0.25 : 0.4 }}>
        {valueCell(a, awayBetter, awayColor, 'right')}
        {bar(a, awayBetter, awayColor, 'away')}
        <Typography sx={{
          flexShrink: 0, width: '2.375rem', textAlign: 'center',
          fontSize: TYPE_SCALE.micro, fontWeight: 800, color: 'text.secondary',
          textTransform: 'uppercase', letterSpacing: 0.4, lineHeight: 1,
        }}>
          {def.key === 'k9' ? kLabel : def.label}
        </Typography>
        {bar(h, homeBetter, homeColor, 'home')}
        {valueCell(h, homeBetter, homeColor, 'left')}
      </Box>
    )
  }

  // A hairline rule with the group name set into it — separates Offense from Pitching
  // without a second heavy all-caps header competing with the row labels.
  const groupBlock = (group: 'hitting' | 'pitching', label: string) => (
    <Box sx={{ mt: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.4 }}>
        <Typography sx={{
          // 700 at `nano`: see the weight ceiling under TYPE_SCALE. This one is 8px, uppercase,
          // letter-spaced AND dimmed, so it had four things working against it and weight was
          // the only one not earning its place.
          fontSize: TYPE_SCALE.nano, fontWeight: 700, color: 'text.disabled',
          textTransform: 'uppercase', letterSpacing: 1, lineHeight: 1, flexShrink: 0,
        }}>
          {label}
        </Typography>
        <Box sx={{ flex: 1, height: '1px', bgcolor: 'divider' }} />
      </Box>
      {WPBL_TEAM_STAT_DEFS.filter(d => d.group === group).map(row)}
    </Box>
  )

  // Team chip — the club's badge (logo) plus its abbr in the bar color, so the row-side ↔
  // team ↔ color mapping is unmistakable without decoding a legend.
  //
  // And it opens the club. This card is a wall of the two teams' season numbers, so "how is
  // Boston actually doing" is the obvious next question and the badge is the obvious thing to
  // press for it. `pressable` rather than an anchor, like every other team target in the
  // section: a club page is history state on /wpbl/teams rather than a URL of its own, so
  // there is no href to give it.
  const teamChip = (team: WpblTeam, color: string, align: 'right' | 'left') => (
    <Box
      {...(onOpenTeam ? pressable(() => onOpenTeam(team)) : {})}
      aria-label={onOpenTeam ? `${wpblFullName(team)} team page` : undefined}
      sx={{
        flex: 1, display: 'flex', alignItems: 'center', gap: 0.6, minWidth: 0,
        flexDirection: align === 'right' ? 'row-reverse' : 'row',
        ...(onOpenTeam ? {
          cursor: 'pointer', borderRadius: 1, mx: -0.5, px: 0.5, py: 0.25,
          ...TAPPABLE,
          ...FOCUS_RING,
        } : {}),
      }}
    >
      <TeamBadge team={team} size={18} />
      <Typography sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 800, color, lineHeight: 1 }}>{team.abbr}</Typography>
    </Box>
  )

  // The compact cut: three rows, and everything a host card already provides is left to it.
  // No padding of its own, no legend (the two team rows directly above it carry the badges in
  // the same club colours these bars use), no season footnote, no group rules for three stats
  // that do not need dividing into two groups.
  if (compact) {
    return (
      <Box>
        {/* Disabled ink, not secondary: the host card now puts a rule above this block, and a
            rule plus a caption plus secondary-weight type is three ways of saying "new section"
            for a footer that only needs one. */}
        <Typography sx={{
          fontSize: TYPE_SCALE.caption, fontWeight: 800, color: 'text.disabled',
          textTransform: 'uppercase', letterSpacing: 0.8, lineHeight: 1, mb: 0.5,
        }}>
          Season stats
        </Typography>
        {COMPACT_KEYS.map(k => WPBL_TEAM_STAT_DEFS.find(d => d.key === k)).map(d => d && row(d))}
      </Box>
    )
  }

  // One club's active roster: the signed players whose club is this one now, sorted by position
  // the way a lineup card reads. `team_id` is "now", which is the right question for a game that
  // has not happened yet. Named plainly (no box-score override), because this is the roster the
  // league lists, not where a player has been used.
  const rosterCol = (team: WpblTeam, color: string) => {
    const list = (players ?? [])
      .filter(p => p.team_id === team.id && p.status === 'Signed')
      .sort((a, b) => positionRank(a.position) - positionRank(b.position) || a.name.localeCompare(b.name))
    return (
      <Box sx={{ minWidth: 0 }}>
        {/* The full club name where the column is wide enough for it (desktop), the abbreviation
            on a phone where two columns leave no room. A club header carries more of the reader's
            attention than a stat-bar legend, so it takes the space when there is space. */}
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
              // The row still opens the player on a real tap; FOCUS_RING keeps it keyboard-reachable.
              ...(onOpenPlayer ? { cursor: 'pointer', ...FOCUS_RING, transition: 'background 0.12s', ...hoverOnly({ bgcolor: 'action.hover' }) } : {}),
            }}>
              <PlayerPortrait name={p.name} teamId={team.id} size={22} />
              <Typography noWrap sx={{ flex: 1, minWidth: 0, fontSize: TYPE_SCALE.body, fontWeight: 600 }}>
                {shortName(p.name)}
              </Typography>
              {p.position && (
                <Typography sx={{
                  flexShrink: 0, fontSize: TYPE_SCALE.micro, fontWeight: 700, color: 'text.disabled',
                  textTransform: 'uppercase', letterSpacing: 0.3,
                }}>{p.position}</Typography>
              )}
            </Box>
          )
        })}
      </Box>
    )
  }

  // The two roster columns. Capped and centred on a desktop: at full page width each column ran
  // the length of the sheet and threw its position label to the far edge, an inch of empty rule
  // between a name and its "RHP". A readable measure keeps the position beside the name.
  const rostersView = (
    <Box sx={{
      display: 'grid', columnGap: { xs: 2, md: 6 }, alignItems: 'start',
      gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(2, minmax(0, 24rem))' },
      justifyContent: { md: 'center' },
    }}>
      {rosterCol(away, awayColor)}
      {rosterCol(home, homeColor)}
    </Box>
  )

  // The season comparison: the legend, the two stat groups and the footnote. Extracted so the
  // toggle can swap it for the rosters without duplicating the bars.
  const comparisonView = (
    <>
      {/* Legend: which color is which club */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
        {teamChip(away, awayColor, 'right')}
        <Typography sx={{ fontSize: TYPE_SCALE.micro, fontWeight: 700, color: 'text.disabled', flexShrink: 0, lineHeight: 1 }}>VS</Typography>
        {teamChip(home, homeColor, 'left')}
      </Box>

      {groupBlock('hitting', 'Offense')}
      {groupBlock('pitching', 'Pitching')}

      <Typography sx={{ fontSize: TYPE_SCALE.micro, color: 'text.disabled', mt: 1, textAlign: 'center', lineHeight: 1.5 }}>
        {CURRENT_SEASON} season · bar length = rank in the league, longer is better
      </Typography>
    </>
  )

  // With rosters offered, a toggle chooses the board and names it, so the "Season Comparison"
  // heading is redundant and goes. Without them, the comparison is the whole card and keeps its
  // heading (except in the bare cut, whose host already titled it).
  // Each club's stat leaders, side by side. The one board that answers "who is worth watching",
  // which the team bars and the full rosters do not.
  const leadersView = leaders && (leaders.away.length > 0 || leaders.home.length > 0) ? (
    <LeaderTable away={away} home={home} awayLeaders={leaders.away} homeLeaders={leaders.home} onOpenPlayer={onOpenPlayer} rich />
  ) : (
    <Typography sx={{ fontSize: TYPE_SCALE.micro, color: 'text.disabled', textAlign: 'center', py: 2 }}>
      Leaders appear once both clubs have played.
    </Typography>
  )

  if (rosters) {
    return (
      <Box sx={bare ? { px: 0, py: 0 } : { px: 2, py: 1.5 }}>
        <Box sx={{ mb: 1.5 }}>
          <SegNav
            options={[
              { value: 'comparison', label: 'Matchup' },
              { value: 'leaders', label: 'Leaders' },
              { value: 'rosters', label: 'Rosters' },
            ]}
            value={board} onChange={v => setBoard(v as 'comparison' | 'leaders' | 'rosters')} mb={0}
          />
        </Box>
        {board === 'comparison' ? comparisonView : board === 'leaders' ? leadersView : rostersView}
      </Box>
    )
  }

  return (
    <Box sx={bare ? { px: 0, py: 0 } : { px: 2, py: 1.5 }}>
      {!bare && (
        <Typography sx={{
          fontSize: TYPE_SCALE.micro, fontWeight: 700, color: 'text.disabled',
          textTransform: 'uppercase', letterSpacing: 0.8, lineHeight: 1, mb: 1,
        }}>
          Season Comparison
        </Typography>
      )}
      {comparisonView}
    </Box>
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
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5, px: 2, pt: 2 }}>
        <TeamBadge team={away} size={40} />
        <Typography sx={{ fontSize: TYPE_SCALE.title, fontWeight: 700 }}>
          {away.abbr} <Box component="span" sx={{ color: 'text.disabled', fontWeight: 600 }}>at</Box> {home.abbr}
        </Typography>
        <TeamBadge team={home} size={40} />
      </Box>
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
