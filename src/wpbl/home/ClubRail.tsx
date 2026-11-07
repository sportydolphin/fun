import { Box, Skeleton, Typography } from '@mui/material'
import type { WpblTeam, WpblStandingRow } from '../types'
import { TeamMark, TYPE_SCALE, FOCUS_RING, hoverOnly, chromePx } from '../ui'
import { AGATE_SX, SECTION_RULE } from '../../ui/card'
import { useWpblTeamLink } from '../LinkContext'
import { UNSTYLED_LINK } from '../../nav'
import { localeDate } from '../../lib/dateFormat'

// The four clubs under Home's title, as the standings line a sports section runs under its
// nameplate (Nov 4, 2026, owner's pick from a trial against the blocks, a strip under a club-color
// bar, and nothing): place, mark, name, record, between a heavy rule and a hairline.
//
// IT WAS FOUR SOLID BLOCKS of each club's near-black primary with a bright trim. They were the
// heaviest thing on the page and they were navigation, not news: they sat over the lead and pushed
// it down by their 95px, said again what the Teams tab says, and kept the top of the light page
// dark. As a line the clubs still lead the page in the order they finished, and the color is left
// to the marks.
//
// Each club is a link to its club page, so this is still the way to the clubs on a phone.

/** The cells before the clubs land: always four, the league's size, so the line holds its height. */
const SLOTS = [0, 1, 2, 3]

/** A line that holds its height with nothing in it: a no-break space, since a plain one collapses
 *  and the placeholder came out 3px short of the loaded line (a shift the sweep caught). */
const EMPTY_LINE = ' '

/** The mark: a step smaller on a phone, where a cell is a quarter of 343px. */
const BADGE = { phone: 24, wide: 28 } as const

function ClubCell({ team, row, place, champion, first, onOpenTeam }: {
  team: WpblTeam | null; row: WpblStandingRow | undefined; place: number; champion: boolean; first: boolean
  onOpenTeam: (t: WpblTeam) => void
}) {
  const teamLink = useWpblTeamLink()
  const record = row && (row.wins + row.losses) > 0 ? `${row.wins}–${row.losses}` : null
  const gb = record && row && row.gamesBack > 0 ? String(row.gamesBack) : null
  const body = (
    <>
      {/* The place, as a standings line numbers itself. Ornament to a screen reader, whose name for
          the link carries it in words. */}
      <Typography aria-hidden sx={{ ...AGATE_SX, flexShrink: 0, fontSize: TYPE_SCALE.meta, color: 'text.secondary', minWidth: '1ch' }}>
        {team && record ? place : EMPTY_LINE}
      </Typography>
      {team
        ? <>
            <Box sx={{ display: { xs: 'flex', sm: 'none' } }}><TeamMark team={team} size={BADGE.phone} /></Box>
            <Box sx={{ display: { xs: 'none', sm: 'flex' } }}><TeamMark team={team} size={BADGE.wide} /></Box>
          </>
        : <Skeleton variant="circular" sx={{ flexShrink: 0, width: { xs: chromePx(BADGE.phone), sm: chromePx(BADGE.wide) }, height: { xs: chromePx(BADGE.phone), sm: chromePx(BADGE.wide) } }} />}
      <Box sx={{ minWidth: 0 }}>
        {/* The abbreviation on a phone, the name from `sm`: the city is the club page's to say. */}
        <Typography noWrap sx={{ fontSize: TYPE_SCALE.body, fontWeight: 700, lineHeight: 1.25 }}>
          {team
            ? <><Box component="span" sx={{ display: { xs: 'inline', sm: 'none' } }}>{team.abbr}</Box>
                <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>{team.name}</Box></>
            : EMPTY_LINE}
        </Typography>
        <Typography noWrap sx={{ ...AGATE_SX, fontSize: TYPE_SCALE.meta, color: 'text.secondary', lineHeight: 1.3 }}>
          {record ?? EMPTY_LINE}
          {/* Games back from `sm`, as a standings line prints it, where a cell is a quarter of the page
              and the record alone left most of it empty. NO "Champions" HERE (Nov 6, 2026): the lead
              under the line says it in its kicker and headline, and a third statement of one result
              in the first screen is what the strip's champion tile was cut for. */}
          {gb && <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}> · {gb} GB</Box>}
        </Typography>
      </Box>
    </>
  )
  const sx = {
    display: 'flex', alignItems: 'center', gap: { xs: 0.6, sm: 1 }, minWidth: 0,
    py: 1, px: { xs: 0.75, sm: 1.25 },
    // A hairline between clubs, as a standings box columns them; the first sits flush with the title.
    ...(first ? { pl: 0 } : { borderLeft: '1px solid', borderLeftColor: 'divider' }),
  } as const
  const finish = champion ? 'champions' : record ? `${ordinal(place)} place` : null
  return team
    ? <Box {...teamLink(team, onOpenTeam)} aria-label={`${team.city} ${team.name}${record ? `, ${record}` : ''}${finish ? `, ${finish}` : ''}`}
        sx={{ ...UNSTYLED_LINK, ...sx, color: 'text.primary', ...hoverOnly({ bgcolor: 'action.hover' }), ...FOCUS_RING }}>{body}</Box>
    : <Box aria-hidden sx={sx}>{body}</Box>
}

/** "1st", "2nd": a club's finish in the regular season, for the link's spoken name. */
function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th'
  return `${n}${s}`
}

export function ClubRail({ teams, standings, championId, onOpenTeam }: {
  teams: WpblTeam[]
  /** The season's table, for each club's record and place. */
  standings: WpblStandingRow[]
  /** The season's champion, once there is one: its line says so. */
  championId: string | null
  onOpenTeam: (t: WpblTeam) => void
}) {
  const rowOf = new Map(standings.map((r, i) => [r.team.id, { row: r, place: i + 1 }]))
  // IN THE ORDER THEY FINISHED once there is a table, which is what numbers a standings line. The
  // league's own order only until the standings land, or for a club the table does not have.
  const placeOf = (t: WpblTeam) => rowOf.get(t.id)?.place ?? Number.MAX_SAFE_INTEGER
  const ordered = [...teams].sort((a, b) => placeOf(a) - placeOf(b) || a.sort_order - b.sort_order)
  return (
    // A hairline under it. The nameplate's heavy rule is on the dateline above (Dateline).
    <Box component="nav" aria-label="Clubs" sx={{
      display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
      borderBottom: '1px solid', borderBottomColor: 'divider',
    }}>
      {SLOTS.map(i => {
        const team = ordered[i] ?? null
        const at = team ? rowOf.get(team.id) : undefined
        return (
          <ClubCell key={team?.id ?? i} team={team} row={at?.row} place={at?.place ?? 0} first={i === 0}
            champion={!!team && team.id === championId} onOpenTeam={onOpenTeam} />
        )
      })}
    </Box>
  )
}

/** The date as a reader's calendar prints it: "Friday, November 6, 2026", or "Fri, Nov 6, 2026"
 *  where the long form does not fit. */
function dateText(d: Date, long: boolean): string {
  return localeDate(d, 'en-US', long
    ? { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }
    : { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

/**
 * THE DATELINE (Nov 6, 2026, the thirteenth pass): the folio line a paper prints under its
 * nameplate, today's date and the edition, between the nameplate's heavy rule and the standings
 * line. Without it the league's name read as one more section heading over a row of cells; the
 * date is what makes a nameplate a front page, and on a site that is updated daily it is true.
 *
 * `phase` is the edition ("Offseason"); null holds the line's height while the schedule loads.
 */
export function Dateline({ phase, now = new Date() }: { phase: string | null; now?: Date }) {
  const sx = { ...AGATE_SX, fontSize: TYPE_SCALE.meta, color: 'text.secondary', lineHeight: 1.3 } as const
  return (
    <Box sx={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 2, py: 0.6,
      ...SECTION_RULE, borderBottom: '1px solid', borderBottomColor: 'divider',
    }}>
      <Typography noWrap sx={sx}>
        <Box component="span" sx={{ display: { xs: 'inline', sm: 'none' } }}>{dateText(now, false)}</Box>
        <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>{dateText(now, true)}</Box>
      </Typography>
      <Typography noWrap sx={{ ...sx, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {phase ?? EMPTY_LINE}
      </Typography>
    </Box>
  )
}

/** The line before anything has loaded, for the page skeleton: the same cells with nothing in them. */
export function ClubRailSkeleton() {
  return <ClubRail teams={[]} standings={[]} championId={null} onOpenTeam={() => {}} />
}
