import { ACCENT_EDGE, TYPE_SCALE } from '../../ui/card'
import { Box, Typography } from '@mui/material'
import { WPBL_ACCENT, wpblFullName } from '../constants'
import {
  TeamBadge, ModalShell, SectionLabel, PillGroup,
  CARD_BORDER, pressable, FOCUS_RING, hoverOnly } from '../ui'
import type { WpblTeam } from '../types'
import type { SeasonScope } from '../season'
import type { EraBasis } from '../stats'
import type { Col } from '../statColumns'
import type { Side, Totals } from './axes'
import { statNames } from './columns'

// ── The sheets, and the one rule they are built to ───────────────────────────────
//
// EVERY TARGET IN HERE IS AT LEAST 52px TALL. The control bar's `Chip` is 24px: fine as a
// label you glance at, half the minimum for anything a finger has to hit, and fifteen of them
// wrap into dense lines. A chip row is a good way to SHOW a small set of options and a bad way
// to let someone pick from a long one.
//
// So the options are tiles and rows, sized for a thumb, and the room that costs buys something
// back: there is space to say what each abbreviation means.

/** One option in a picker. Fills its grid cell, two lines, 52px minimum. */
function OptionTile({ label, hint, on, onClick }: {
  label: string
  hint?: string
  on: boolean
  onClick: () => void
}) {
  return (
    <Box {...pressable(onClick)} aria-pressed={on} sx={{
      ...FOCUS_RING,
      minHeight: 52, display: 'flex', flexDirection: 'column', justifyContent: 'center',
      px: 1.25, py: 0.85, borderRadius: 2, cursor: 'pointer', userSelect: 'none',
      border: '1px solid', transition: 'all 0.15s',
      borderColor: on ? ACCENT_EDGE : CARD_BORDER,
      bgcolor: on ? `${WPBL_ACCENT}14` : 'transparent',
      ...hoverOnly({ borderColor: ACCENT_EDGE }),
    }}>
      <Typography sx={{
        fontSize: TYPE_SCALE.body, fontWeight: 800, lineHeight: 1.2,
        color: on ? 'var(--wpbl-accent-fg)' : 'text.primary',
      }}>{label}</Typography>
      {hint && (
        // Wraps to a second line rather than truncating: the hint is the whole point of the
        // picker, and "Strikeouts per…" does not say which denominator. Clamped at two so a
        // long one cannot make its row of tiles tower over the rest.
        <Typography sx={{
          fontSize: TYPE_SCALE.micro, lineHeight: 1.25, color: 'text.disabled', overflowWrap: 'anywhere',
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>{hint}</Typography>
      )}
    </Box>
  )
}

/** A full-width option row, for a short list where the label wants the whole line. */
function OptionRow({ label, hint, icon, on, onClick }: {
  label: string
  hint?: string
  icon?: React.ReactNode
  on: boolean
  onClick: () => void
}) {
  return (
    <Box {...pressable(onClick)} aria-pressed={on} sx={{
      ...FOCUS_RING,
      minHeight: 52, display: 'flex', alignItems: 'center', gap: 1.25,
      px: 1.25, py: 0.85, borderRadius: 2, cursor: 'pointer', userSelect: 'none',
      border: '1px solid', transition: 'all 0.15s',
      borderColor: on ? ACCENT_EDGE : CARD_BORDER,
      bgcolor: on ? `${WPBL_ACCENT}14` : 'transparent',
      ...hoverOnly({ borderColor: ACCENT_EDGE }),
    }}>
      {icon}
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography sx={{
          fontSize: TYPE_SCALE.title, fontWeight: 700, lineHeight: 1.25,
          color: on ? 'var(--wpbl-accent-fg)' : 'text.primary',
        }}>{label}</Typography>
        {hint && (
          <Typography sx={{ fontSize: TYPE_SCALE.micro, lineHeight: 1.3, color: 'text.disabled' }}>
            {hint}
          </Typography>
        )}
      </Box>
      {/* A tick as well as the fill, never the fill alone: a tinted border is the sort of
          difference that disappears in sunlight, and about one man in twelve cannot use
          color to tell two states apart at all. */}
      <Box aria-hidden sx={{
        flexShrink: 0, fontSize: TYPE_SCALE.title, fontWeight: 800,
        color: 'var(--wpbl-accent-fg)', opacity: on ? 1 : 0,
      }}>✓</Box>
    </Box>
  )
}

/** The sheet's way out, at the bottom where a thumb is. The ✕ in the header is 700px up the
 *  screen on a sheet this tall, which is the corner of a phone a hand cannot reach without
 *  regripping it. Both sheets apply their choices live, so this only closes: it is a Done
 *  rather than an Apply, and it says so. */
function SheetDone({ onClose }: { onClose: () => void }) {
  return (
    <Box {...pressable(onClose)} sx={{
      ...FOCUS_RING,
      minHeight: 48, display: 'flex', alignItems: 'center', justifyContent: 'center',
      borderRadius: 2, cursor: 'pointer', userSelect: 'none',
      bgcolor: 'var(--wpbl-accent-solid)', color: '#fff', fontWeight: 800, fontSize: TYPE_SCALE.title,
    }}>Done</Box>
  )
}

/** A titled group inside a sheet. */
function SheetGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box>
      <SectionLabel>{title}</SectionLabel>
      <Box sx={{ mt: 0.9 }}>{children}</Box>
    </Box>
  )
}

// Choosing what the board ranks by. Two columns of tiles: sixteen options as full-width rows
// is three screenfuls of scrolling, and two columns is one and a bit, with every tile still
// 165px wide on the narrowest phone.
//
// Direction is named rather than described. "Ascending" is a fact about the sort and "best
// first" is what the reader wants, and the two are opposites for ERA and WHIP, which is
// exactly where getting it wrong is least forgivable.
export function SortBody({ cols, sortKey, side, eraBasis, bestFirst, onPick, onDirection }: {
  cols: Col<Totals>[]
  sortKey: string
  side: Side
  eraBasis: EraBasis
  bestFirst: boolean
  onPick: (c: Col<Totals>) => void
  onDirection: (bestFirst: boolean) => void
}) {
  // ERA carries its denominator here and nowhere else on the board. This sheet is the one
  // place a reader is already asking what a stat means, so it is the cheapest place to answer
  // "which ERA is this" without putting a number on every column heading.
  const names = statNames(side, eraBasis)
  const groups: [string, Col<Totals>[]][] = [
    ['Rate stats', cols.filter(c => c.rate)],
    ['Counting stats', cols.filter(c => !c.rate)],
  ]
  // minmax(0, 1fr), never bare 1fr: a bare fr track will not shrink below its content's
  // min-content width, so one long hint ("Strikeouts per plate appearance") widened both columns
  // past the sheet and the whole picker scrolled sideways on a phone.
  const grid = { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1 } as const
  return (
    <>
      {groups.map(([title, list]) => list.length === 0 ? null : (
        <SheetGroup key={title} title={title}>
          <Box sx={grid}>
            {list.map(c => (
              <OptionTile key={c.key} label={c.label} hint={names[c.key]}
                on={c.key === sortKey} onClick={() => onPick(c)} />
            ))}
          </Box>
        </SheetGroup>
      ))}
      <SheetGroup title="Order">
        <Box sx={grid}>
          <OptionTile label="Best first" on={bestFirst} onClick={() => onDirection(true)} />
          <OptionTile label="Worst first" on={!bestFirst} onClick={() => onDirection(false)} />
        </Box>
      </SheetGroup>
    </>
  )
}

// THE PHONE'S ONE SHEET: the sort and the filters, a tab each, behind the one pill in the bar. The
// tabs are drawn only when the board has both. The Filter tab carries the bar's dot, so a reader who
// opened the sheet to change the sort still sees that something else is set.
export function StatsSheet({ tab, onTab, side, sort, filter, filtersSet, onClose }: {
  tab: 'sort' | 'filter'
  onTab: (t: 'sort' | 'filter') => void
  side: Side
  sort: React.ReactNode
  filter: React.ReactNode
  filtersSet: boolean
  onClose: () => void
}) {
  const shown = sort && filter ? tab : sort ? 'sort' : 'filter'
  const eyebrow = shown === 'filter' ? 'Filter'
    : side === 'pitching' ? 'Rank pitchers by' : side === 'fielding' ? 'Rank fielders by'
    : side === 'overall' ? 'Rank players by' : 'Rank hitters by'
  return (
    <ModalShell sheet eyebrow={eyebrow} onClose={onClose} maxWidth={480} footer={<SheetDone onClose={onClose} />}>
      <Box sx={{ px: 2, py: 1.75, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {sort && filter && (
          <PillGroup options={[{ value: 'sort', label: 'Sort' }, { value: 'filter', label: filtersSet ? 'Filter •' : 'Filter' }]}
            value={shown} onChange={v => onTab(v as 'sort' | 'filter')} />
        )}
        {shown === 'sort' ? sort : filter}
      </Box>
    </ModalShell>
  )
}

// The two filters, on a phone, in one sheet.
//
// Rows rather than tiles: there are only seven, and a club wants its badge and its whole name
// rather than three letters.
export function FilterBody({ teams, teamId, onTeam, qualified, onQualified, scope, onScope, season, seasons, onSeason, showWho, showQualified = true, bar }: {
  teams: WpblTeam[]
  teamId: string | null
  onTeam: (id: string | null) => void
  qualified: boolean
  onQualified: () => void
  /** Null when no postseason game has finished, which is when the choice does not exist yet
   *  rather than when it is set to the regular season. */
  scope: SeasonScope | null
  onScope: (s: SeasonScope) => void
  /** Null with one season on record, when there is no year to choose. */
  season: number | null
  seasons: number[]
  onSeason: (s: number) => void
  /** Only the player board has a per-player population to filter. */
  showWho: boolean
  /** False on a side with no qualifying bar (Overall), where the choice would do nothing. */
  showQualified?: boolean
  /** The qualifying bar in its own unit ("36 PA", "12.0 IP"), or null before it applies. Said
   *  here because the phone's table no longer says it under the board unless Everyone is on. */
  bar: string | null
}) {
  const rows = { display: 'flex', flexDirection: 'column', gap: 0.75 } as const
  return (
    <>
      {/* The year before anything else: it decides which games exist at all for the rest. */}
      {season != null && (
        <SheetGroup title="Season">
          <Box sx={rows}>
            {seasons.map(y => <OptionRow key={y} label={String(y)} on={season === y} onClick={() => onSeason(y)} />)}
          </Box>
        </SheetGroup>
      )}

      {/* BEFORE THE CLUB, because it is the wider cut: it changes which GAMES everything
          below is counted from, where the other two only choose who to list out of them. */}
      {scope && (
        <SheetGroup title="Games">
          <Box sx={rows}>
            <OptionRow label="Regular season" on={scope === 'regular'} onClick={() => onScope('regular')} />
            <OptionRow label="Playoffs" on={scope === 'postseason'} onClick={() => onScope('postseason')} />
            {/* "Both" rather than "All": the team group below opens on "All teams", and two
                rows reading All in one sheet is a coin toss about which one a tap changes. */}
            <OptionRow label="Both" on={scope === 'all'} onClick={() => onScope('all')} />
          </Box>
        </SheetGroup>
      )}

      {showWho && (
      <>
      <SheetGroup title="Team">
        <Box sx={rows}>
          <OptionRow label="All teams" on={teamId === null} onClick={() => onTeam(null)} />
          {teams.map(t => (
            <OptionRow key={t.id} label={wpblFullName(t)} on={teamId === t.id}
              icon={<TeamBadge team={t} size={28} />}
              onClick={() => onTeam(teamId === t.id ? null : t.id)} />
          ))}
        </Box>
      </SheetGroup>

      {showQualified && <SheetGroup title="Who to include">
        <Box sx={rows}>
          <OptionRow label="Qualified" on={qualified} hint={bar ? `${bar} or more` : undefined}
            onClick={() => { if (!qualified) onQualified() }} />
          <OptionRow label="Everyone" on={!qualified} hint={bar ? `Under ${bar} shown faded` : undefined}
            onClick={() => { if (qualified) onQualified() }} />
        </Box>
      </SheetGroup>}
      </>
      )}
    </>
  )
}
