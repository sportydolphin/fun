import React, { useEffect, useRef, useState } from 'react'
import { Box, Typography, Skeleton } from '@mui/material'
import type { StatDef } from '../types'
import { ACCENT, TEAM_SEASONS } from '../constants'
import { MlbSheet } from '../components/MlbSheet'
import { SectionLabel } from '../components/ui'
import { mlbPlayerPath } from '../routes'
import { GAME_SCOPE_LABEL } from '../lib/gameScope'
import type { GameScope } from '../lib/gameScope'
import { LIST_CAP, rankMarks, contextKeys, isBestFirst } from '../lib/statsBoard'
import type { RankedEntry, RankMark, StatsGroup } from '../lib/statsBoard'
import { pressable, hoverOnly, tappableIf, linkPress, FOCUS_RING } from '../../ui/interaction'
import { typePx } from '../../ui/scale'
import { ExpandRow } from '../../ui/ExpandRow'
import { LogoBubble } from '../components/boxScore'
import { PlayerHeadshot } from '../components/leaderboards'

// The phone's Stats board: a ranked list that shows ONE stat, with a sheet to change which.
//
// The grid it replaces is a spreadsheet in a nested scroller at 375px, sorted by OPS with the OPS
// column off the screen: the reader is looking at a ranking whose ranked number they cannot see.
// WPBL's StatsView made the same call and this is its shape (rank, face, name, one big number,
// three supporting numbers), built here rather than imported because neither section imports the
// other. The grid stays on desktop, where comparing across columns is what a grid is for, and
// behind "Full table" on a phone for the reader who wants it anyway.

const CARD_BORDER = 'divider'

/** The preference a phone reader sets once: "I want the grid". Remembered because it says how
 *  someone reads, not what page they are on. Off by default; see the list above for why. */
export const FULL_TABLE_KEY = 'mlb_stats_full_table'
export function readFullTable(): boolean {
  try { return localStorage.getItem(FULL_TABLE_KEY) === '1' } catch { return false }
}
export function writeFullTable(on: boolean): void {
  try { localStorage.setItem(FULL_TABLE_KEY, on ? '1' : '0') } catch { /* private mode: it just does not stick */ }
}


function RankText({ rank }: { rank: RankMark }) {
  // Centred on the number rather than on its baseline: a smaller "T-" on the same baseline hangs at
  // the top of it in a flex parent and reads as a superscript.
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center' }}>
      {rank.tied && <Box component="span" sx={{ fontSize: '0.8em', lineHeight: 1 }}>T-</Box>}
      <Box component="span" sx={{ lineHeight: 1 }}>{rank.n}</Box>
    </Box>
  )
}

function ListRow({ entry, onOpen, rank, value, context, first, total, bestFirst, highlighted, rowRef }: {
  entry: RankedEntry
  onOpen: () => void
  rank: RankMark
  value: string
  context: string
  first: boolean
  /** Rows on screen: a top-three mark needs a rest to stand out from. */
  total: number
  /** The top-three mark is a podium, so it belongs to the best end only: on a worst-first board
   *  it would decorate the league's three worst ERAs. */
  bestFirst: boolean
  highlighted: boolean
  rowRef?: (el: HTMLElement | null) => void
}) {
  const marked = bestFirst && rank.n <= 3 && total > 6
  return (
    // The player's page is a real <a href>, and so is the tap target: Googlebot reads no click
    // handlers, and a ctrl-click still opens a tab. The click goes to the same handler the grid's
    // row used, so the history entry, the event and the card are unchanged.
    <Box
      ref={rowRef}
      {...linkPress(mlbPlayerPath({ id: entry.playerId, fullName: entry.playerName }), onOpen)}
      sx={{
        ...FOCUS_RING, ...rowSx(first), textDecoration: 'none', color: 'inherit',
        bgcolor: highlighted ? `${ACCENT}14` : undefined,
        cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
        ...tappableIf(true),
      }}
    >
      {/* rem, not px: this reserves room for a number the reader can enlarge, and "T-10" is the
          widest thing it holds. A flex box so anything wider spills evenly rather than into the
          portrait. */}
      <Box sx={{ ...RANK_SX, color: marked ? 'var(--wpbl-accent-fg)' : 'text.disabled' }}><RankText rank={rank} /></Box>

      <PlayerHeadshot variant="ring" playerId={entry.playerId} name={entry.playerName} teamId={entry.teamId} size={32} />

      {/* Line heights set, not inherited: MUI's 1.5 put 6px of air in each line, and a screen holds
          ten of these. */}
      <Box sx={{ minWidth: 0, flex: 1 }}>
        {/* The club's logo after the name, where WPBL's list draws its badge. */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, minWidth: 0 }}>
          <Typography sx={NAME_SX}>{entry.playerName}</Typography>
          {entry.teamId > 0 && <LogoBubble teamId={entry.teamId} abbr={entry.teamAbbr} size={16} ring={1} />}
        </Box>
        <Typography sx={CONTEXT_SX}>
          {context}
        </Typography>
      </Box>

      <Box sx={VALUE_SX}>
        {value}
      </Box>
    </Box>
  )
}

// A row's parts, shared with its skeleton so the two cannot drift.
const rowSx = (first: boolean) => ({
  display: 'flex', alignItems: 'center', gap: 1.25, px: 1.25, py: 0.85,
  borderTop: first ? 'none' : '1px solid', borderColor: 'divider',
}) as const
const RANK_SX = {
  width: '1.875rem', whiteSpace: 'nowrap', flexShrink: 0, display: 'flex', justifyContent: 'center',
  fontSize: '0.8rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums',
} as const
const NAME_SX = { fontSize: '0.85rem', fontWeight: 600, lineHeight: 1.25, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } as const
const CONTEXT_SX = { fontSize: '0.68rem', lineHeight: 1.35, color: 'text.disabled', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } as const
const VALUE_SX = { flexShrink: 0, fontSize: '1.05rem', fontWeight: 800, color: 'var(--wpbl-accent-fg)', fontVariantNumeric: 'tabular-nums' } as const

function ListRowSkeleton({ first }: { first: boolean }) {
  return (
    <Box sx={rowSx(first)}>
      <Box sx={RANK_SX}>&nbsp;</Box>
      <Skeleton variant="circular" width={32} height={32} sx={{ flexShrink: 0 }} />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography sx={NAME_SX}><Skeleton width="60%" /></Typography>
        <Typography sx={CONTEXT_SX}><Skeleton width="80%" /></Typography>
      </Box>
      <Box sx={VALUE_SX}><Skeleton width="2.5rem" /></Box>
    </Box>
  )
}

export function StatsRankedList({
  rows, def, statDefs, group, asc, highlightPlayerId, league, footer,
  onOpenPlayer, skeleton,
}: {
  /** Every ranked row, already filtered and sorted by the caller. The list shows ten and opens to all
   *  of them, as WPBL's does. */
  rows: RankedEntry[]
  def: StatDef
  statDefs: StatDef[]
  group: StatsGroup
  asc: boolean
  highlightPlayerId?: number | null
  /** The league's figure for the ranked stat, printed beside its label as WPBL's list does. Null on a
   *  counting stat or a career board. */
  league?: string | null
  /** The list's last row, given how many rows are showing: what the board is counted from, and the
   *  switch to the grid. */
  footer?: (shown: number) => React.ReactNode
  onOpenPlayer: (id: number) => void
  /** The board drawn empty while its read is out: the real header, a first page of empty rows. */
  skeleton?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const hlIdx = highlightPlayerId ? rows.findIndex(r => r.playerId === highlightPlayerId) : -1
  // Arriving from a stat card on a player's page, the player has to be on screen: stretch the cap
  // to include them rather than land on a board that does not show who you came for.
  const cap = expanded ? rows.length : Math.max(LIST_CAP, hlIdx + 1)
  const visible = rows.slice(0, cap)
  const marks = rankMarks(visible.map(r => r._v))
  const keys = contextKeys(group, def.key, !!def.isRate)
  const bestFirst = isBestFirst(def, asc)
  const ctx = keys.map(k => statDefs.find(d => d.key === k)).filter((d): d is StatDef => !!d)

  const hlRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (hlIdx < 0) return
    const t = setTimeout(() => hlRef.current?.scrollIntoView({ block: 'center' }), 120)
    return () => clearTimeout(t)
  }, [hlIdx])

  return (
    <Box sx={{ border: '1px solid', borderColor: CARD_BORDER, borderRadius: 2, overflow: 'hidden' }}>
      {/* WPBL's header: "Player", the league's figure, the ranked stat with its direction arrow. On
          the ERA board the numbers ascend and nothing else says so. */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.25, py: 0.7, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Typography sx={{ flex: 1, minWidth: 0, fontSize: '0.6rem', fontWeight: 800, letterSpacing: typePx(0.4), textTransform: 'uppercase', color: 'text.disabled' }}>
          Player
        </Typography>
        {league && (
          <Typography data-league-head="" sx={{ flexShrink: 0, fontSize: '0.62rem', fontWeight: 600, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
            League avg {league}
          </Typography>
        )}
        <Typography sx={{ flexShrink: 0, fontSize: '0.6rem', fontWeight: 800, letterSpacing: typePx(0.4), color: 'var(--wpbl-accent-fg)' }}>
          {def.label}
          <Box component="span" aria-label={asc ? 'ascending' : 'descending'} sx={{ ml: 0.3, fontSize: '0.62rem' }}>{asc ? '↑' : '↓'}</Box>
        </Typography>
      </Box>

      {skeleton && Array.from({ length: LIST_CAP }, (_, i) => <ListRowSkeleton key={i} first={i === 0} />)}

      {visible.map((r, i) => (
        <ListRow key={r.playerId}
          entry={r} onOpen={() => onOpenPlayer(r.playerId)}
          rank={marks[i]} first={i === 0} total={visible.length} bestFirst={bestFirst}
          highlighted={i === hlIdx}
          rowRef={i === hlIdx ? el => { hlRef.current = el } : undefined}
          value={def.format(def.getValue(r.stat))}
          context={ctx.map(d => `${d.format(d.getValue(r.stat))} ${d.label}`).join(' · ')} />
      ))}

      {/* WPBL's foot (src/ui/ExpandRow): the count is in the words, so there is no "Showing 10 of".
          The skeleton keeps its room, since nearly every board holds more than ten. */}
      {skeleton
        ? <Box aria-hidden sx={{ minHeight: 48, borderTop: '1px solid', borderColor: 'divider' }} />
        : rows.length > LIST_CAP && (
          <ExpandRow expanded={expanded} moreLabel={`Show all ${rows.length} players`} onToggle={() => setExpanded(e => !e)} />
        )}
      {footer?.(visible.length)}
    </Box>
  )
}

/** A phone control that opens a sheet ("Sort OPS ▾", "Filters ▾"). `on` lights it: the Sort pill
 *  always, Filters only when something is off its default, so a filter is never silently on.
 *  Shared by the Table and Leaders so the two boards' phone controls are one design. */
export const controlPill = (on: boolean) => ({
  ...FOCUS_RING,
  display: 'inline-flex', alignItems: 'center', gap: 0.4, flexShrink: 0,
  cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
  minHeight: 34, px: 1.25, borderRadius: 999, fontSize: '0.78rem', fontWeight: 700,
  border: '1px solid', transition: 'all 0.15s',
  borderColor: on ? ACCENT : 'divider',
  bgcolor: on ? `${ACCENT}12` : 'transparent',
  color: on ? 'var(--wpbl-accent-fg)' : 'text.secondary',
} as const)

// ── The sheets ───────────────────────────────────────────────────────────────────────────
//
// EVERY TARGET IN HERE IS AT LEAST 52PX TALL, because these are what a thumb has to hit, and a
// chip row is a good way to SHOW a small set of options and a bad way to pick from a long one.

function OptionTile({ label, hint, on, onClick, disabled }: {
  label: string; hint?: string; on: boolean; onClick: () => void; disabled?: boolean
}) {
  return (
    // role stated outright: pressable supplies it, and a disabled tile skips pressable, which
    // would leave aria-pressed on an element with no role to carry it.
    <Box {...(disabled ? {} : pressable(onClick))} role="button" aria-pressed={on} aria-disabled={disabled || undefined} sx={{
      ...FOCUS_RING,
      minHeight: 52, display: 'flex', flexDirection: 'column', justifyContent: 'center',
      px: 1.25, py: 0.85, borderRadius: 2, cursor: disabled ? 'default' : 'pointer', userSelect: 'none',
      border: '1px solid', transition: 'all 0.15s', opacity: disabled ? 0.45 : 1,
      borderColor: on ? ACCENT : CARD_BORDER,
      bgcolor: on ? `${ACCENT}14` : 'transparent',
      ...(disabled ? {} : hoverOnly({ borderColor: ACCENT })),
    }}>
      <Typography sx={{ fontSize: '0.85rem', fontWeight: 800, lineHeight: 1.2, color: on ? 'var(--wpbl-accent-fg)' : 'text.primary' }}>{label}</Typography>
      {hint && (
        <Typography sx={{
          fontSize: '0.66rem', lineHeight: 1.25, color: 'text.disabled', overflowWrap: 'anywhere',
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>{hint}</Typography>
      )}
    </Box>
  )
}

/** The sheet's way out, at the bottom where a thumb is. Choices apply live, so this only closes. */
function SheetDone({ onClose }: { onClose: () => void }) {
  return (
    <Box {...pressable(onClose)} sx={{
      ...FOCUS_RING, minHeight: 48, display: 'flex', alignItems: 'center', justifyContent: 'center',
      borderRadius: 2, cursor: 'pointer', userSelect: 'none',
      bgcolor: 'var(--wpbl-accent-solid)', color: '#fff', fontWeight: 800, fontSize: '0.9rem',
    }}>Done</Box>
  )
}

function SheetGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box>
      <SectionLabel>{title}</SectionLabel>
      <Box sx={{ mt: 0.9 }}>{children}</Box>
    </Box>
  )
}

// minmax(0, 1fr), never bare 1fr: a bare fr track will not shrink below its content's min-content
// width, so one long hint widens both columns past the sheet and the picker scrolls sideways.
const GRID = { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1 } as const

export function StatsSortSheet({ statDefs, group, sortKey, asc, reversible, onPick, onDirection, onClose }: {
  statDefs: StatDef[]
  group: StatsGroup
  sortKey: string
  asc: boolean
  /** False on an all-time counting board, which only has the leaders' direction. */
  reversible: boolean
  onPick: (def: StatDef) => void
  onDirection: (bestFirst: boolean) => void
  onClose: () => void
}) {
  const active = statDefs.find(d => d.key === sortKey) ?? statDefs[0]
  const groups: [string, StatDef[]][] = [
    ['Rate stats', statDefs.filter(d => d.isRate)],
    ['Counting stats', statDefs.filter(d => !d.isRate)],
  ]
  const best = isBestFirst(active, asc)
  return (
    <MlbSheet sheet eyebrow={group === 'pitching' ? 'Rank pitchers by' : 'Rank hitters by'}
      onClose={onClose} maxWidth={480} footer={<SheetDone onClose={onClose} />}>
      <Box sx={{ px: 2, py: 1.75, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {groups.map(([title, list]) => list.length === 0 ? null : (
          <SheetGroup key={title} title={title}>
            <Box sx={GRID}>
              {list.map(d => (
                <OptionTile key={d.key} label={d.label} hint={d.leaderLabel && d.leaderLabel !== d.label ? d.leaderLabel : undefined}
                  on={d.key === sortKey} onClick={() => onPick(d)} />
              ))}
            </Box>
          </SheetGroup>
        ))}
        <SheetGroup title="Order">
          {/* Named, not described. "Ascending" is a fact about the sort and "best first" is what
              the reader wants, and the two are opposites for ERA and WHIP. */}
          <Box sx={GRID}>
            <OptionTile label="Best first" on={best} disabled={!reversible} onClick={() => onDirection(true)} />
            <OptionTile label="Worst first" on={!best} disabled={!reversible} onClick={() => onDirection(false)} />
          </Box>
          {!reversible && (
            <Typography sx={{ mt: 0.75, fontSize: '0.68rem', color: 'text.disabled', lineHeight: 1.3 }}>
              Career leaders only. The bottom of this stat is thousands of players tied on zero, so there is no worst first.
            </Typography>
          )}
        </SheetGroup>
      </Box>
    </MlbSheet>
  )
}

export function StatsFilterSheet({
  seasonValue, onSeason, scope, scopes, onScope, canQualify, qualified, onQualified, onClose, allTime = true,
}: {
  /** 'all' for All-Time, otherwise a season. */
  seasonValue: string
  onSeason: (v: string) => void
  scope: GameScope
  scopes: readonly GameScope[]
  onScope: (s: GameScope) => void
  /** Only rate stats have a qualifying bar, and only on a season board. */
  canQualify: boolean
  qualified: boolean
  onQualified: () => void
  onClose: () => void
  /** Leaders has no career board, so it leaves the All-Time option out. */
  allTime?: boolean
}) {
  return (
    <MlbSheet sheet eyebrow="Filter" onClose={onClose} maxWidth={480} footer={<SheetDone onClose={onClose} />}>
      <Box sx={{ px: 2, py: 1.75, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <SheetGroup title="Season">
          {/* The OS picker: twenty-seven options is the case a native select is better at than
              anything drawn here. */}
          <Box component="select" aria-label="Season" value={seasonValue} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onSeason(e.target.value)}
            sx={{
              ...FOCUS_RING, width: '100%', minHeight: 52, px: 1.25, borderRadius: 2, fontSize: '0.9rem', fontWeight: 700,
              fontFamily: 'inherit', color: 'text.primary', bgcolor: 'transparent', border: '1px solid', borderColor: CARD_BORDER,
            }}>
            {allTime && <option value="all">All-Time</option>}
            {TEAM_SEASONS.map(y => <option key={y} value={String(y)}>{y}</option>)}
          </Box>
        </SheetGroup>
        <SheetGroup title="Games">
          <Box sx={GRID}>
            {scopes.map(s => (
              <OptionTile key={s} label={GAME_SCOPE_LABEL[s]} on={s === scope} onClick={() => onScope(s)} />
            ))}
          </Box>
        </SheetGroup>
        {canQualify && (
          <SheetGroup title="Who">
            <Box sx={GRID}>
              <OptionTile label="Qualified" hint="Enough plate appearances or innings" on={qualified} onClick={() => !qualified && onQualified()} />
              <OptionTile label="Everyone" hint="Including part-timers" on={!qualified} onClick={() => qualified && onQualified()} />
            </Box>
          </SheetGroup>
        )}
      </Box>
    </MlbSheet>
  )
}
