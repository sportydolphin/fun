import { Box, Skeleton, Typography } from '@mui/material'
import type { WpblTeam, WpblStandingRow } from '../types'
import { wpblAccent, wpblColor } from '../constants'
import { INK } from '../../ui/color'
import { TeamBadge, TYPE_SCALE, DISPLAY_FONT, FOCUS_RING, hoverOnly, chromePx } from '../ui'
import { AGATE_SX } from '../../ui/card'
import { useWpblTeamLink } from '../LinkContext'
import { UNSTYLED_LINK } from '../../nav'

// The four clubs under Home's title, each a solid block of its own color (Nov 4, 2026,
// ROADMAP-UI.md's audit). They were four small outlined chips beside the title, a filter bar, and
// hidden on a phone. A league of four clubs is the most recognizable thing about it, so the clubs
// are the masthead: the page's color comes from them before anything else.
//
// SOLID BLOCKS, SQUARE CORNERS, NO EDGE STRIPE DOWN A SIDE. The first cut was a pale wash with the club's color
// as a stripe along the top of a rounded tile: the stock "accent card" of generated dashboards, and
// on the light page the washes were nearly invisible (owner's call, Nov 4). A club prints as a block
// of its own color, the way a jersey or a broadcast standings graphic does.
//
// Each block is a link to its club page, so this is also the way to the clubs on a phone.

/** The blocks before the clubs land: always four, the league's size, so the rail holds its height. */
const SLOTS = [0, 1, 2, 3]

/** "1st", "2nd": a club's finish in the regular season. */
function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th'
  return `${n}${s}`
}

/** A line that holds its height with nothing in it: a lone space collapses. */
const EMPTY_LINE = ' '

function ClubBlock({ team, row, place, champion, onOpenTeam }: {
  team: WpblTeam | null; row: WpblStandingRow | undefined; place: number; champion: boolean
  onOpenTeam: (t: WpblTeam) => void
}) {
  const teamLink = useWpblTeamLink()
  // The jersey: the club's own near-black primary with its bright color as trim, the same in both
  // themes. The mid-tone fills before it (wpblField) were colors chosen to carry white text, so the
  // four read as a palette rather than as clubs (owner's call, Nov 4, 2026). The trim is the dark
  // theme's accent, which clears 4.5:1 on every primary.
  const fill = team ? wpblColor(team.id) : undefined
  const trim = team ? wpblAccent(team.id, true) : undefined
  const ink = INK.white
  const record = row ? `${row.wins}–${row.losses}` : null
  // On every line, not only the block: the link's color did not reach its text through inheritance
  // (each line read in the page's ink on a club fill in light mode).
  const inkSx = { color: team ? ink : 'text.secondary' } as const
  const finish = champion ? 'Champions' : row && (row.wins + row.losses) > 0 ? ordinal(place) : null
  const body = (
    <>
      {team
        ? <TeamBadge team={team} size={36} ring={trim} onFill />
        : <Skeleton variant="circular" sx={{ flexShrink: 0, width: chromePx(36), height: chromePx(36) }} />}
      <Box sx={{ minWidth: 0, flex: 1 }}>
        {/* The city as a kicker from `sm`; on a phone the block is a quarter of 343px and the
            abbreviation is the club. */}
        <Typography noWrap sx={{ color: trim ?? 'text.secondary', display: { xs: 'none', sm: 'block' }, ...AGATE_SX, fontSize: TYPE_SCALE.meta, textTransform: 'uppercase', letterSpacing: '0.06em', lineHeight: 1.3 }}>
          {team ? team.city : EMPTY_LINE}
        </Typography>
        <Typography noWrap sx={{ ...inkSx, fontFamily: DISPLAY_FONT, fontWeight: 700, fontSize: { xs: TYPE_SCALE.display, sm: TYPE_SCALE.page }, lineHeight: 1.1, textTransform: 'uppercase' }}>
          {team
            ? <><Box component="span" sx={{ display: { xs: 'inline', sm: 'none' } }}>{team.abbr}</Box>
                <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>{team.name}</Box></>
            : EMPTY_LINE}
        </Typography>
        <Typography noWrap sx={{ ...inkSx, ...AGATE_SX, fontSize: TYPE_SCALE.meta, lineHeight: 1.3 }}>
          {record ?? EMPTY_LINE}
          {finish && <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>{` · ${finish}`}</Box>}
        </Typography>
      </Box>
    </>
  )
  const sx = {
    display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, alignItems: { xs: 'flex-start', sm: 'center' },
    gap: { xs: 0.75, sm: 1.25 }, minWidth: 0, px: { xs: 1, sm: 1.5 }, py: { xs: 1, sm: 1.25 },
    // Square: a block of club color, not a card.
    borderRadius: 0, position: 'relative',
    bgcolor: team ? fill : 'action.hover', color: team ? ink : 'text.secondary',
    // The trim along the foot, drawn as a fill: on the dark page it is the block's visible edge, since
    // a near-black primary barely parts from the page there.
    ...(trim ? { '&::after': { content: '""', position: 'absolute', left: 0, right: 0, bottom: 0, height: chromePx(4), bgcolor: trim } } : null),
  } as const
  return team
    ? <Box {...teamLink(team, onOpenTeam)} aria-label={`${team.city} ${team.name}${record ? `, ${record}` : ''}${finish ? `, ${finish}` : ''}`}
        sx={{ ...UNSTYLED_LINK, ...sx, ...hoverOnly({ filter: 'brightness(1.35)' }), ...FOCUS_RING }}>{body}</Box>
    : <Box aria-hidden sx={sx}>{body}</Box>
}

export function ClubRail({ teams, standings, championId, onOpenTeam }: {
  teams: WpblTeam[]
  /** The season's table, for each club's record and place. */
  standings: WpblStandingRow[]
  /** The season's champion, once there is one: its finish says so. */
  championId: string | null
  onOpenTeam: (t: WpblTeam) => void
}) {
  const rowOf = new Map(standings.map((r, i) => [r.team.id, { row: r, place: i + 1 }]))
  // IN THE ORDER THEY FINISHED once there is a table (Nov 4, 2026): four blocks in a row each
  // carrying "4th", "Champions", "2nd", "1st" read as a ranking that was out of order. The
  // league's own order only until the standings land, or for a club the table does not have.
  const placeOf = (t: WpblTeam) => rowOf.get(t.id)?.place ?? Number.MAX_SAFE_INTEGER
  const ordered = [...teams].sort((a, b) => placeOf(a) - placeOf(b) || a.sort_order - b.sort_order)
  return (
    // Flush, no gap: four blocks side by side read as one band of the league's colors.
    <Box component="nav" aria-label="Clubs" sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
      {SLOTS.map(i => {
        const team = ordered[i] ?? null
        const at = team ? rowOf.get(team.id) : undefined
        return (
          <ClubBlock key={team?.id ?? i} team={team} row={at?.row} place={at?.place ?? 0}
            champion={!!team && team.id === championId} onOpenTeam={onOpenTeam} />
        )
      })}
    </Box>
  )
}

/** The rail before anything has loaded, for the page skeleton: the same blocks with nothing in them. */
export function ClubRailSkeleton() {
  return <ClubRail teams={[]} standings={[]} championId={null} onOpenTeam={() => {}} />
}
