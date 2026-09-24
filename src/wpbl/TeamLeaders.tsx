import { Box, Typography } from '@mui/material'
import { TeamBadge, PlayerPortrait, useWpblDark, useWpblName, pressable, hoverOnly, TAPPABLE, FOCUS_RING, TYPE_SCALE, chromePx } from './ui'
import { wpblAccent } from './constants'
import { aggregateBatting, aggregatePitching, wpblQualifiers, plateAppearances, scaleToBasis } from './stats'
import { outsToIp } from './innings'
import type { SeasonScope } from './season'
import type { WpblTeam, WpblPlayer, WpblBattingLine, WpblPitchingLine, WpblGame } from './types'

// The "players to watch" logic and its side-by-side table, shared by the series overview and the
// game/matchup preview. Extracted from SeriesPreview so GamePreview can reuse it: both import from
// here, and neither imports the other, which is what keeps the two out of an import cycle.

/** One club's best in one category, as a line to print. */
export interface Leader {
  label: string
  player: WpblPlayer
  value: string
}

/**
 * The clubs' leaders, from the lines played FOR that club.
 *
 * KEYED ON THE LINE'S TEAM AND NEVER ON THE ROSTER ROW, which is the trap this section is built
 * around: `team_id` on a roster row means "now", so a traded player would be listed under the
 * club they finished the season at and be missing from the one they played these games for. A
 * box-score line carries the club that game was played for, which is the question being asked.
 *
 * Rate stats are gated on the same qualifier the leaderboards use, so the club's batting average
 * is not a pinch-hitter who went 2-for-2 in August. Counting stats are not gated, because a home
 * run leader with nine home runs led whether or not they batted enough to hold a rate title.
 *
 * `scope` is the stats layer's slice, passed straight through to the aggregates and the
 * qualifier. A SERIES is `'postseason'` over only that series' games, with `teams` the two clubs
 * in it: the postseason slice keeps a line only when its game is in `games` and positively a
 * playoff game, and the qualifier then scales off the games those two clubs have played in the
 * series, so a rate title in a best-of-five needs a best-of-five's worth of plate appearances.
 */
export function teamLeaders(
  team: WpblTeam,
  players: WpblPlayer[],
  batting: WpblBattingLine[],
  pitching: WpblPitchingLine[],
  games: WpblGame[],
  teams: WpblTeam[],
  eraBasis: 7 | 9,
  scope: SeasonScope = 'regular',
): Leader[] {
  const qual = wpblQualifiers(teams, games, scope)
  const bats = aggregateBatting(players, batting.filter(l => l.team_id === team.id), games, scope)
  const pits = aggregatePitching(players, pitching.filter(l => l.team_id === team.id), games, scope)

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

const LEADER_CATEGORIES = ['AVG', 'OPS', 'HR', 'RBI', 'ERA', 'SO', 'IP'] as const
// The rich variant groups the categories the way the team comparison does, so the two boards of
// the preview read the same.
const LEADER_GROUPS = [
  { label: 'Offense', cats: ['AVG', 'OPS', 'HR', 'RBI'] as const },
  { label: 'Pitching', cats: ['ERA', 'SO', 'IP'] as const },
]

// The label column carries the category between the two clubs. Wider on a desktop, where the
// wider column is the difference between "K. Whitmore" and "K. Whitmor…".
const LEADER_LABEL_W = { xs: '2rem', sm: '2.5rem' }

/**
 * Both clubs' leaders, with the category down the middle.
 *
 * TWO LISTS SIDE BY SIDE IS NOT A COMPARISON. With one club's seven categories and then the
 * other's, each with its own label column, reading "who has the better ERA" means finding ERA
 * twice and holding the first number while you look for the second. The category sits between
 * the two and each club's leader reads outward from it, which is exactly the shape of the team
 * comparison directly above and lets the two blocks be read the same way.
 *
 * AWAY ON THE LEFT, HOME ON THE RIGHT, matching that comparison rather than the bracket: the
 * two blocks are inches apart and a reader who has just learned which side is which should not
 * have to learn it again.
 */
export function LeaderTable({ away, home, awayLeaders, homeLeaders, onOpenPlayer, rich }: {
  away: WpblTeam; home: WpblTeam
  awayLeaders: Leader[]; homeLeaders: Leader[]
  onOpenPlayer?: (p: WpblPlayer) => void
  /** The wide variant: a headshot for each leader and the categories grouped into Offense and
   *  Pitching, for a board that has the room (the matchup preview). Off by default, so the
   *  series overview keeps its compact capped table. */
  rich?: boolean
}) {
  const dark = useWpblDark()
  // The section's own answer to a long name in a narrow column: "Kelsie Whitmore" on a desktop,
  // "K. Whitmore" on a phone, where two names and a label share 375px.
  const shortName = useWpblName()
  const byLabel = (rows: Leader[]) => new Map(rows.map(r => [r.label, r]))
  const A = byLabel(awayLeaders), H = byLabel(homeLeaders)
  const rows = LEADER_CATEGORIES.filter(c => A.has(c) || H.has(c))
  if (rows.length === 0) return null

  if (rich) return (
    <RichLeaders away={away} home={home} A={A} H={H} onOpenPlayer={onOpenPlayer} />
  )

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
      {/* 800, matching the team comparison directly above, and for the reason given there: a
          tabular figure at 900 in a colour picked to be read closes its own counters up, and
          these are the same numbers in the same accent inches below that block. */}
      <Typography sx={{
        flexShrink: 0, fontSize: TYPE_SCALE.body, fontWeight: 800,
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
        fontSize: TYPE_SCALE.micro, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase',
        color: wpblAccent(team.id, dark), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>{team.name}</Typography>
      {align === 'right' && <TeamBadge team={team} size={18} />}
    </Box>
  )

  return (
    /* CAPPED AND CENTRED, AND THE CAP IS MEASURED. Each side's leader hugs the category down
    the middle, so at the sheet's full width the rules run the whole card while the text sits
    in the middle third. The cap, 520 real pixels at the desktop chrome scale, puts each side
    at a readable measure; what is left goes outside as margin, where it reads as a centred
    comparison rather than a row with a hole at each end. `chromePx` because a cap on a block is
    a structural length and not room reserved for a string, so it follows the desktop chrome
    scale and not the reader's text size. */
    <Box sx={{ mt: 0.75, maxWidth: chromePx(520), mx: 'auto' }}>
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
          {/* THE SAME LABEL AS THE TEAM COMPARISON'S, which is inches above it and asks the
              reader to read it the same way: micro, 800, secondary. */}
          <Typography sx={{
            width: LEADER_LABEL_W, flexShrink: 0, textAlign: 'center',
            fontSize: TYPE_SCALE.micro, fontWeight: 800, color: 'text.secondary',
          }}>{c}</Typography>
          {side(H.get(c), home, 'left')}
        </Box>
      ))}
    </Box>
  )
}

/**
 * The wide leaders board: a headshot and a stacked name-over-value for each club's leader in each
 * category, the categories grouped into Offense and Pitching the way the team comparison is. The
 * portrait and the club colour turn a table into two lineups facing off, which is what the extra
 * room in the matchup preview is worth spending on.
 */
function RichLeaders({ away, home, A, H, onOpenPlayer }: {
  away: WpblTeam; home: WpblTeam
  A: Map<string, Leader>; H: Map<string, Leader>
  onOpenPlayer?: (p: WpblPlayer) => void
}) {
  const dark = useWpblDark()
  const shortName = useWpblName()

  // One club's leader in one category: portrait on the OUTER edge, the name over the value
  // reading in from it, so the two clubs face each other across the category label.
  const cell = (l: Leader | undefined, team: WpblTeam, dir: 'away' | 'home') => {
    const outer = dir === 'away' ? 'flex-start' : 'flex-end'
    return (
      <Box
        {...pressable(l && onOpenPlayer ? () => onOpenPlayer(l.player) : undefined)}
        sx={{
          flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 1, borderRadius: 1.5,
          px: 0.75, py: 0.5, flexDirection: dir === 'away' ? 'row' : 'row-reverse',
          cursor: l && onOpenPlayer ? 'pointer' : 'default', ...FOCUS_RING,
          ...(l && onOpenPlayer ? hoverOnly({ bgcolor: 'action.hover' }) : {}),
        }}
      >
        {l ? (
          <PlayerPortrait name={l.player.name} teamId={team.id} size={40} />
        ) : (
          <Box aria-hidden sx={{
            width: 40, height: 40, flexShrink: 0, borderRadius: '50%',
            border: '1px dashed', borderColor: 'divider',
          }} />
        )}
        <Box sx={{ minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: outer, textAlign: dir === 'away' ? 'left' : 'right' }}>
          <Typography noWrap sx={{
            maxWidth: '100%', fontSize: TYPE_SCALE.body, fontWeight: 600, lineHeight: 1.2,
            overflow: 'hidden', textOverflow: 'ellipsis',
            color: l ? 'text.primary' : 'text.disabled',
          }}>{l ? shortName(l.player.name) : '—'}</Typography>
          <Typography sx={{
            fontSize: TYPE_SCALE.heading, fontWeight: 800, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums',
            color: l ? wpblAccent(team.id, dark) : 'text.disabled',
          }}>{l ? l.value : ''}</Typography>
        </Box>
      </Box>
    )
  }

  const head = (team: WpblTeam, align: 'left' | 'right') => (
    <Box sx={{
      flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 0.6,
      justifyContent: align === 'right' ? 'flex-end' : 'flex-start',
    }}>
      {align === 'left' && <TeamBadge team={team} size={20} />}
      <Typography sx={{
        fontSize: TYPE_SCALE.caption, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase',
        color: wpblAccent(team.id, dark), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>{team.name}</Typography>
      {align === 'right' && <TeamBadge team={team} size={20} />}
    </Box>
  )

  return (
    <Box sx={{ maxWidth: chromePx(760), mx: 'auto' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5, px: 0.75 }}>
        {head(away, 'right')}
        <Box sx={{ width: '2.5rem', flexShrink: 0 }} />
        {head(home, 'left')}
      </Box>
      {LEADER_GROUPS.map(group => {
        const cats = group.cats.filter(c => A.has(c) || H.has(c))
        if (cats.length === 0) return null
        return (
          <Box key={group.label} sx={{ mt: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.25 }}>
              <Typography sx={{
                fontSize: TYPE_SCALE.nano, fontWeight: 700, color: 'text.disabled',
                textTransform: 'uppercase', letterSpacing: 1, lineHeight: 1, flexShrink: 0,
              }}>{group.label}</Typography>
              <Box sx={{ flex: 1, height: '1px', bgcolor: 'divider' }} />
            </Box>
            {cats.map(c => (
              <Box key={c} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                {cell(A.get(c), away, 'away')}
                <Typography sx={{
                  width: '2.5rem', flexShrink: 0, textAlign: 'center',
                  fontSize: TYPE_SCALE.micro, fontWeight: 800, color: 'text.secondary',
                }}>{c}</Typography>
                {cell(H.get(c), home, 'home')}
              </Box>
            ))}
          </Box>
        )
      })}
    </Box>
  )
}
