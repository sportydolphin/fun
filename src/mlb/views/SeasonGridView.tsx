import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Box, Typography, Skeleton } from '@mui/material'
import { ACCENT, ACCENT_TEXT, HITTING_STAT_DEFS, PITCHING_STAT_DEFS, TEAM_ABBR, TEAM_NICKNAME, TEAM_SEASONS, CURRENT_SEASON } from '../constants'
import type { StatDef } from '../types'
import { typePx } from '../../ui/scale'
import { NameText } from '../../ui/NameText'
import { CARD_BORDER } from '../../ui/card'
import { pressable, FOCUS_RING } from '../../ui/interaction'
import { FilterChip, FilterSelect } from '../../ui/FilterChip'
import { printedRanks } from '../../ui/leaders'
import { ExpandRow, TABLE_CAP } from '../../ui/ExpandRow'
import { HEAD_LABEL_SX, HEAD_LEAGUE_SX, HEAD_LEAGUE_TINT } from '../../ui/statsTableHead'
import { StatsBar, STATS_BOARD_ROOT_SX } from './StatsBar'
import { TABLE_FRAME_SX, TABLE_MAX_H, ROW_TINT_VAR, ROW_TINT, TABLE_FOOT_SX, FOOT_TEXT_SX, RankMarkText, frozenSx, FROZEN_EDGE, NAME_W } from './statsTable'
import { LogoBubble } from '../components/boxScore'
import { playerLink, teamLink, rowClick, LINK_SX } from '../lib/links'
import { fetchAllTeamStats } from '../api'
import { fetchSeasonFielding } from '../apiSeasonStats'
import { GAME_SCOPES, GAME_SCOPE_LABEL, type GameScope } from '../lib/gameScope'
import { sortBoard, leagueLine, isBestFirst, ascFor } from '../lib/statsBoard'
import type { LeaderboardEntry } from '../types'
import {
  FIELDING_POSITIONS, fieldingDefsFor, fieldingQualified, fieldingRows, fieldingLeagueLine,
  gridDefaultSort, combineTeamLines, combineFieldingSplits, combineFieldingLines, type FieldingPosition, type GridRow, type GridSort,
} from '../lib/seasonGrid'
import { StatsRankedList, StatsSortFilterSheet, SortBody, FilterBody, SortFilterPill, readFullTable, writeFullTable } from './StatsRankedList'
import { MLB_CLUBS } from '../routes'
import { scrollBehavior } from '../../lib/motion'
import { useStagesFit } from '../../ui/names'

// THE TEAMS AND FIELDING BOARDS, WPBL's two season tables that MLB's Stats tab lacked (ROADMAP.md,
// "WPBL's Stats boards on MLB"). One component because they are one table with two kinds of row,
// which is also how WPBL draws them: the same frame, header, league row and sorted-column tint as
// Players (statsTable.tsx), minus what only a player board needs (career, Standard and Advanced).
// Teams answers all three sides, Fielding included (the clubs' own fielding lines), since Oct 2026.
//
// ON A PHONE, PLAYERS' RANKED LIST (StatsRankedList), with the table behind the same "Full table"
// preference. Until Oct 2026 these two drew the desktop grid at 375px, the only boards that did:
// a club's name ran out of its column ("Diamondb…"), Fielding's position chips wrapped to three
// rows before a fielder was on screen, and the ranked stat was the one number frozen in place.
//
// EACH BOARD READS FOR ITSELF, on mount, as WPBL's Tracked board does, rather than through
// useMlbState: nothing else in the section wants these rows, and the club lines it reads are the
// cached ones the team page and Charts already share (fetchAllTeamStats).
//
// The side and the season are the section's, so a reader who switches from Players to Teams keeps
// looking at the same season's pitching. The sort, the position and the club are the board's own,
// but held by the section too (useMlbState), because the address carries them and Back restores
// them: /mlb/fielding?pos=SS&team=mariners&sort=e is a link anyone can send.

export type SeasonGridKind = 'teams' | 'fielding'

export interface SeasonGridViewProps {
  kind: SeasonGridKind
  boardTabs: React.ReactNode
  isDesktop: boolean
  lbGroup: 'hitting' | 'pitching'
  /** Teams on its Fielding side: the clubs' fielding lines. Fielding (the player board) always is. */
  fielding: boolean
  /** The Stats tab's Hitting / Pitching / Fielding switch, built once by the section (MlbStats). */
  sideSwitch: React.ReactNode
  vizSeason: number
  setVizSeason: (s: number) => void
  /** Regular season, playoffs or both: the section's, shared with Players and Leaders. */
  gameScope: GameScope
  setGameScope: (s: GameScope) => void
  onOpenPlayer: (playerId: number) => void
  onOpenTeam: (teamId: number) => void
  sort: GridSort | null
  setSort: (s: GridSort | null) => void
  /** Fielding only. */
  position: FieldingPosition | 'all'
  setPosition: (p: FieldingPosition | 'all') => void
  club: number | null
  setClub: (id: number | null) => void
  /** The row a link came to see (a club on Teams, a player on Fielding), tinted and scrolled to. */
  highlightId: number | null
  setHighlightId: (id: number | null) => void
}

const POSITION_OPTIONS = [{ value: 'all', label: 'All' }, ...FIELDING_POSITIONS.map(p => ({ value: p, label: p }))]
const CLUB_OPTIONS = [{ value: '', label: 'All clubs' }, ...[...MLB_CLUBS]
  .sort((a, b) => (TEAM_NICKNAME[a.id] ?? a.name).localeCompare(TEAM_NICKNAME[b.id] ?? b.name))
  .map(c => ({ value: String(c.id), label: TEAM_NICKNAME[c.id] ?? c.name }))]
/** A row's height, in rem because it holds a name over a position, so it grows with the type. Fixed
 *  so the skeleton's rows are the loaded rows' height exactly. */
const ROW_H = '2.625rem'
/** The name column, fixed rather than sized by the longest name, which is not known until the rows
 *  land and moved every stat column sideways when they did. In rem: it reserves room for a name.
 *  "Diamondbacks" and "Michael Harris II" fit; longer names ellipsize, a tap from the full one. */
const NAME_COL_W = '11.5rem'
/** What each column's widest figure looks like, drawn invisibly in the skeleton's cells so a column
 *  is as wide before its numbers land as after: an auto-sized table sizes every column by its
 *  content, and empty cells sized them by the heading alone. Digit counts from a full season
 *  (2025 and 2026); figures are tabular, so only the count and the punctuation matter. */
const SAMPLE: Record<string, string> = {
  g: '162', gs: '162', pa: '6382', ab: '5564', r: '850', h: '1386', '2b': '274', '3b': '26', hr: '220',
  rbi: '804', sb: '114', cs: '22', bb: '600', k: '1450', avg: '.251', obp: '.339', slg: '.428',
  ops: '.767', tb: '2313', gdp: '128', hbp: '68', sh: '15', sf: '49', ibb: '25',
  wl: '93-68', era: '3.23', sv: '45', ip: '1441.1', er: '518', bk: '4', wp: '35', bf: '5973',
  p: '23432', whip: '1.17', so9: '9.05',
  inn: '1289.2', tc: '1373', po: '1218', a: '284', e: '14', dp: '114', fpct: '1.000', rf9: '10.30',
  sba: '58', csPct: '.342', pb: '6',
}

/** A club's fielding totals, wider than any fielder's: a season of innings is five digits. */
const TEAM_FIELDING_SAMPLE: Record<string, string> = {
  g: '162', gs: '162', inn: '13023.0', tc: '6038', po: '4385', a: '1653', e: '118', dp: '163',
  fpct: '.990', rf9: '4.26', sba: '160', cs: '51', csPct: '.325', pb: '16',
}

/** "Cal Raleigh" as "C. Raleigh", as Players' phone table shortens a name to fit its column. */
const abbrevName = (name: string) => {
  const i = name.indexOf(' ')
  return i < 0 ? name : `${name[0]}. ${name.slice(i + 1)}`
}

interface Loaded { key: string; rows: GridRow[]; teamGames: Map<number, number> }

/** A club in the frozen name column: its nickname, or its abbreviation when the nickname does not
 *  fit (CLAUDE.md's rule for names, applied to a club), never "Diamondb…". */
function ClubName({ teamId, name, sx }: { teamId: number; name: string; sx: object }) {
  const { ref, stage } = useStagesFit<HTMLSpanElement>([name, TEAM_ABBR[teamId] ?? name])
  return <Typography component="span" ref={ref} sx={sx}>{stage ? (TEAM_ABBR[teamId] ?? name) : name}</Typography>
}

export function SeasonGridView({
  kind, boardTabs, isDesktop, lbGroup, fielding, sideSwitch, vizSeason, setVizSeason, gameScope, setGameScope, onOpenPlayer, onOpenTeam,
  sort, setSort, position: posProp, setPosition, club: clubProp, setClub, highlightId, setHighlightId,
}: SeasonGridViewProps) {
  const teams = kind === 'teams'
  // The side the rows are: a club's bat or arm, or a glove (every Fielding row, and Teams on Fielding).
  const teamFielding = teams && fielding
  const side: 'hitting' | 'pitching' | 'fielding' = teams && !fielding ? lbGroup : 'fielding'
  const position = teams ? 'all' : posProp
  const club = teams ? null : clubProp
  // One club's fielders open on everyone, as WPBL's roster link opens its board: the bar would leave a
  // club's page showing eight of the names the reader had just been reading.
  const [qualified, setQualified] = useState(club == null)
  useEffect(() => { setQualified(club == null) }, [club])
  // THE PHONE'S LIST, Players' (StatsRankedList), and the table behind the same remembered choice.
  const [fullTable, setFullTable] = useState(readFullTable)
  const toggleFullTable = () => { const next = !fullTable; setFullTable(next); writeFullTable(next) }
  const listView = !isDesktop && !fullTable
  const [sheetTab, setSheetTab] = useState<null | 'sort' | 'filter'>(null)
  // A reader's own control is a new question, so the row a link picked out stops being the point.
  const choose = <T,>(set: (v: T) => void) => (v: T) => { set(v); setHighlightId(null) }

  // ── The read ───────────────────────────────────────────────────────────
  const loadKey = teams ? `teams|${side}|${vizSeason}|${gameScope}` : `fielding|${vizSeason}|${gameScope}`
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    setFailed(null)
    // Each half as StatsAPI serves it, and "Both" as the two summed (lib/seasonGrid.ts).
    const clubLines = (group: 'hitting' | 'pitching' | 'fielding') => gameScope === 'all'
      ? Promise.all([fetchAllTeamStats(group, vizSeason), fetchAllTeamStats(group, vizSeason, 'P')]).then(([r, p]) => group === 'fielding'
        // A fielding line's rates rebuilt from the summed counts, as a fielder's are (combineFieldingSplits).
        ? new Map([...r].map(([id, line]) => [id, p.has(id) ? combineFieldingLines(line, p.get(id)) : line] as [number, any]))
        : combineTeamLines(r, p))
      : fetchAllTeamStats(group, vizSeason, gameScope === 'post' ? 'P' : 'R')
    // Fielding qualifies each row on its club's games IN THE SAME GAMES, which the clubs' own lines
    // carry: a catcher's half of a club's playoff games, not of its season.
    const games = clubLines('hitting')
      .then(m => new Map([...m].map(([id, s]) => [id, Number(s?.gamesPlayed) || 0] as [number, number])))
    const rows: Promise<GridRow[]> = teams
      ? clubLines(side).then(m => [...m]
        .filter(([id, s]) => s && TEAM_ABBR[id])
        .map(([id, s]) => ({ id: String(id), name: TEAM_NICKNAME[id] ?? TEAM_ABBR[id], teamId: id, stat: s })))
      : (gameScope === 'all'
        ? Promise.all([fetchSeasonFielding(vizSeason), fetchSeasonFielding(vizSeason, 'P')]).then(([r, p]) => combineFieldingSplits(r, p))
        : fetchSeasonFielding(vizSeason, gameScope === 'post' ? 'P' : 'R')
      ).then(fieldingRows)
    Promise.all([rows, games])
      .then(([r, g]) => { if (live) setLoaded({ key: loadKey, rows: r, teamGames: g }) })
      .catch(() => { if (live) setFailed(loadKey) })
    return () => { live = false }
  }, [loadKey, teams, side, vizSeason, gameScope])
  const data = loaded?.key === loadKey ? loaded : null
  const loading = !data && failed !== loadKey

  // ── Columns and sort ───────────────────────────────────────────────────
  // A club's fielding is every position's, so its battery columns (SB allowed, CS, PB) are the club's.
  const defs: StatDef[] = teamFielding ? fieldingDefsFor('C')
    : teams ? (lbGroup === 'hitting' ? HITTING_STAT_DEFS : PITCHING_STAT_DEFS)
    : fieldingDefsFor(position)
  const defaultSort = gridDefaultSort(teams ? 'teamStats' : 'fielding', side, club)
  // A sort the columns no longer hold (CS% after leaving the catchers, ERA after switching to
  // hitting, a hand-edited address) falls back to the board's default rather than ranking on a
  // blank, and is dropped, so the address stops naming a column the board is not sorted by.
  const sortValid = !sort || defs.some(d => d.key === sort.key)
  useEffect(() => { if (!sortValid) setSort(null) }, [sortValid, setSort])
  const activeDef = (sortValid && defs.find(d => d.key === sort?.key)) || defs.find(d => d.key === defaultSort) || defs[0]
  const asc = sort?.key === activeDef.key && sort.asc != null ? sort.asc : (activeDef.lowerIsBetter ?? false)
  const pickColumn = (def: StatDef) => {
    // `asc` is stored only when it is turned round from the column's natural order, which is what
    // puts `dir=` on the address (useMlbState) and leaves it off a plain sort.
    const natural = def.lowerIsBetter ?? false
    const next = def.key === activeDef.key ? !asc : natural
    setSort(next === natural ? { key: def.key } : { key: def.key, asc: next })
    setHighlightId(null)
  }

  // ── Rows ───────────────────────────────────────────────────────────────
  const onPosition = useMemo(
    // ALL IS EVERY FIELDER BUT THE PITCHERS, who have a chip of their own. They are a third of the
    // rows, they qualify on innings rather than games, and a pitcher's season is a dozen chances, so
    // on All they filled the top of fielding percentage with 1.000s and pushed every glove a reader
    // came to compare off the first screen.
    () => (data?.rows ?? []).filter(r => teams
      || ((position === 'all' ? r.position !== 'P' : r.position === position) && (club == null || r.teamId === club))),
    [data, teams, position, club])
  // Thirty clubs all qualify; the bar is a fielder's. Rate columns only, as on Players: a part-time
  // fielder can lead in assists, never in fielding percentage off eleven chances.
  const canQualify = !teams && !!activeDef.isRate
  const qualifies = (r: GridRow) => !data || fieldingQualified(r, data.teamGames.get(r.teamId) ?? Math.max(0, ...data.teamGames.values()))
  const pool = canQualify && qualified ? onPosition.filter(qualifies) : onPosition
  // A player's card links to their row whether or not they qualify, so a part-timer's link turns the
  // bar off rather than landing on a board without them.
  const hlHidden = !teams && highlightId != null && canQualify && qualified
    && onPosition.some(r => r.playerId === highlightId) && !pool.some(r => r.playerId === highlightId)
  useEffect(() => { if (hlHidden) setQualified(false) }, [hlHidden])
  const ranked = sortBoard(pool as unknown as LeaderboardEntry[], activeDef, asc) as unknown as (GridRow & { _v: number })[]
  const ranks = printedRanks(ranked.map(r => activeDef.format(activeDef.getValue(r.stat))))
  const league = useMemo(() => {
    if (!onPosition.length) return null
    return side !== 'fielding' ? leagueLine(onPosition as unknown as LeaderboardEntry[], side) : fieldingLeagueLine(onPosition)
  }, [onPosition, side])
  const rowKeyId = (r: GridRow) => (teams ? r.teamId : r.playerId)
  const hlIdx = highlightId == null ? -1 : ranked.findIndex(r => rowKeyId(r) === highlightId)
  const hlRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (hlIdx < 0) return
    const t = window.setTimeout(() => hlRef.current?.scrollIntoView({ behavior: scrollBehavior(), block: 'center' }), 120)
    return () => window.clearTimeout(t)
  }, [hlIdx, highlightId])
  // THE SORTED COLUMN FROZEN BESIDE THE NAME ON A PHONE, as Players' is: at 375px the default sort
  // (OPS, ERA) is a dozen columns off the right edge, so the number the board is ranked on was the
  // one number a reader could not see. First in the order, and pinned there while the rest scroll.
  const frozenOn = !isDesktop
  const cols = frozenOn ? [activeDef, ...defs.filter(d => d.key !== activeDef.key)] : defs
  const isFrozen = (def: StatDef) => frozenOn && def.key === activeDef.key
  // The shadow onto the scrolling stats, once they are off their left edge.
  const [atStart, setAtStart] = useState(true)
  const leagueCell = (def: StatDef) => (league && def.isRate ? def.format(def.getValue(league)) : '')

  // Capped as Players is, with the rest one tap away. Thirty clubs fit under the cap's spirit and
  // are drawn whole: a club board that hid five clubs would be hiding the question.
  const [open, setOpen] = useState<string | null>(null)
  const boardKey = `${loadKey}|${position}|${club}|${activeDef.key}|${asc}|${qualified}`
  // A picked-out row past the cap stretches it to include them, as Players' does.
  const cap = Math.max(TABLE_CAP, hlIdx + 1)
  const canCap = !teams && ranked.length > cap
  const shown = canCap && open !== boardKey ? ranked.slice(0, cap) : ranked
  const noun = teams ? 'clubs' : 'fielders'

  // ── Drawing ────────────────────────────────────────────────────────────
  const thSx = {
    px: 0.5, fontSize: '0.6rem', fontWeight: 800, letterSpacing: typePx(0.4), whiteSpace: 'nowrap' as const,
    bgcolor: 'background.paper', position: 'sticky' as const, top: 0, ...HEAD_LABEL_SX,
  }
  const tdSx = {
    py: 0.5, px: 0.5, height: ROW_H, borderTop: '1px solid', borderColor: 'divider',
    whiteSpace: 'nowrap' as const, verticalAlign: 'middle' as const,
  }
  // Players' narrower phone column on a phone, where the frozen sorted column needs the room beside it.
  const nameW = frozenOn ? NAME_W : NAME_COL_W
  const frozen = frozenSx(nameW)
  const nameColSx = {
    position: 'sticky' as const, left: 0, width: nameW, minWidth: nameW, maxWidth: nameW, px: 1, textAlign: 'left' as const,
    borderRight: '1px solid', borderRightColor: 'divider',
  }
  const tint = (on: boolean) => (on ? `linear-gradient(${ACCENT}24, ${ACCENT}24)` : undefined)

  const header = (
    <Box component="thead">
      <Box component="tr">
        <Box component="th" sx={{ ...thSx, ...nameColSx, zIndex: 4, color: 'text.disabled', textTransform: 'uppercase' }}>
          {teams ? 'Club' : 'Player'}
        </Box>
        {cols.map(def => {
          const on = def.key === activeDef.key
          return (
            <Box component="th" key={def.key} title={def.leaderLabel ?? def.label} onClick={() => pickColumn(def)} sx={{
              ...thSx, ...(isFrozen(def) ? { ...frozen, '&::after': atStart ? undefined : FROZEN_EDGE } : {}),
              zIndex: isFrozen(def) ? 5 : 3, textAlign: 'center', cursor: 'pointer', minWidth: '2.375rem', userSelect: 'none',
              backgroundImage: tint(on), color: on ? ACCENT_TEXT : 'text.disabled', '&:hover': { color: ACCENT_TEXT },
            }}>
              <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.3 }}>
                {def.label}
                {on && <Box component="span" sx={{ fontSize: '0.62rem' }}>{asc ? '↑' : '↓'}</Box>}
              </Box>
            </Box>
          )
        })}
      </Box>
      {/* Drawn while loading too, empty, so the rows do not drop by its height when it fills. */}
      <Box component="tr">
        <Box component="th" sx={{
          ...HEAD_LEAGUE_SX, left: 0, zIndex: 4, textAlign: 'right', px: 1,
          bgcolor: 'background.paper', backgroundImage: HEAD_LEAGUE_TINT, borderRight: '1px solid', borderColor: 'divider',
        }}><span data-league-head="">League avg</span></Box>
        {cols.map(def => (
          <Box component="th" key={def.key} sx={{
            ...HEAD_LEAGUE_SX, ...(isFrozen(def) ? { ...frozen, top: HEAD_LEAGUE_SX.top, '&::after': atStart ? undefined : FROZEN_EDGE } : {}),
            zIndex: isFrozen(def) ? 5 : 3, textAlign: 'center', px: 0.5, bgcolor: 'background.paper',
            backgroundImage: def.key === activeDef.key ? `${tint(true)}, ${HEAD_LEAGUE_TINT}` : HEAD_LEAGUE_TINT,
          }}><span data-league-head="">{leagueCell(def)}</span></Box>
        ))}
      </Box>
    </Box>
  )

  const foot = (n: number | null) => (
    <Box sx={TABLE_FOOT_SX}>
      <Typography sx={FOOT_TEXT_SX}>
        {[
          n == null ? null : canCap && shown.length < n ? `${shown.length} of ${n} ${noun}` : `${n} ${noun}`,
          canQualify && qualified ? 'qualified only' : null,
          !teams && position !== 'all' ? position : null,
          club != null ? (TEAM_NICKNAME[club] ?? null) : null,
          gameScope === 'post' ? `${vizSeason} playoffs` : gameScope === 'all' ? `${vizSeason} season + playoffs` : `${vizSeason} season`,
        ].filter(Boolean).join(' · ')}
        {isDesktop ? ' · sort by any column heading' : ''}
      </Typography>
      {/* The way between the list and the grid on a phone, Players' switch. */}
      {!isDesktop && (
        <Box {...pressable(toggleFullTable)} sx={{
          ...FOCUS_RING, ml: 'auto', flexShrink: 0, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
          minHeight: 34, px: 1.25, display: 'inline-flex', alignItems: 'center', borderRadius: 999,
          border: '1px solid', borderColor: CARD_BORDER, fontSize: '0.74rem', fontWeight: 800, color: 'var(--wpbl-accent-fg)',
        }}>{fullTable ? 'Ranked list' : 'Full table'}</Box>
      )}
    </Box>
  )

  // Anything off the board's default, for the dot on the phone's pill.
  const filtersSet = vizSeason !== CURRENT_SEASON || gameScope !== 'regular'
    || (!teams && (position !== 'all' || club != null || (canQualify && qualified !== (club == null))))
  // The rows as the phone's list reads them: a club's id stands in for the player's on Teams, which
  // is what its highlight and its key read.
  const listRows = ranked.map(r => ({
    playerId: r.playerId ?? r.teamId, playerName: r.name, teamId: r.teamId, teamAbbr: TEAM_ABBR[r.teamId] ?? '',
    position: r.position, stat: r.stat, _v: r._v, rowKey: r.id,
  }))
  const pickSort = (def: StatDef) => { if (def.key !== activeDef.key) pickColumn(def); setSheetTab(null) }
  const setDirection = (bestFirst: boolean) => {
    const asc = ascFor(activeDef, bestFirst)
    const natural = activeDef.lowerIsBetter ?? false
    setSort(asc === natural ? { key: activeDef.key } : { key: activeDef.key, asc })
    setHighlightId(null)
  }

  // Every row while loading is a row of the loaded table's height: thirty clubs, or the fielders'
  // cap, which a season's qualified fielders always fill.
  // Twelve clubs reach a postseason under the format in place since 2022.
  const skeletonRows = teams ? (gameScope === 'post' ? 12 : 30) : TABLE_CAP

  return (
    <Box sx={STATS_BOARD_ROOT_SX}>
      <StatsBar tabs={boardTabs} isDesktop={isDesktop}>
        {/* Phones: the side, and one pill for the sort and the filters, as on Players. */}
        {!isDesktop && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
            {sideSwitch}
            <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center' }}>
              <SortFilterPill label={activeDef.label} bestFirst={isBestFirst(activeDef, asc)} filtersSet={filtersSet}
                open={sheetTab != null} onOpen={() => setSheetTab('sort')} />
            </Box>
          </Box>
        )}
        {isDesktop && (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
          <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center', flexWrap: 'wrap' }}>
            {/* The side first on every board, then what only this one has: Fielding's positions. */}
            {sideSwitch}
            {!teams && POSITION_OPTIONS.map(o => (
              <FilterChip key={o.value} active={position === o.value} onClick={() => choose(setPosition)(o.value as FieldingPosition | 'all')}>
                {o.label}
              </FilterChip>
            ))}
          </Box>
          {/* Allowed to shrink and wrap inside itself: on Fielding this group is the games, the club,
              the season and the bar. */}
          <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center', flexWrap: 'wrap', minWidth: 0 }}>
            {/* Players' chips (src/ui/FilterChip), the same three words in the same order. */}
            {GAME_SCOPES.map(sc => (
              <FilterChip key={sc} active={gameScope === sc} onClick={() => choose(setGameScope)(sc)}>
                {GAME_SCOPE_LABEL[sc]}
              </FilterChip>
            ))}
            <Box sx={{ width: '1px', alignSelf: 'stretch', bgcolor: 'divider', mx: 0.25, flexShrink: 0 }} />
            {!teams && (
              <FilterSelect
                ariaLabel="Club"
                value={club == null ? '' : String(club)}
                options={CLUB_OPTIONS}
                onChange={v => choose(setClub)(v ? Number(v) : null)}
                active={club != null}
              />
            )}
            <FilterSelect
              ariaLabel="Season"
              value={String(vizSeason)}
              options={TEAM_SEASONS.map(y => ({ value: String(y), label: String(y) }))}
              onChange={v => choose(setVizSeason)(Number(v))}
              active={vizSeason !== CURRENT_SEASON}
            />
            {/* Always drawn on Fielding, so the row does not reflow when the sort moves between a
                rate and a count; it is inert on a count, where there is nothing to qualify for. */}
            {!teams && (
              <FilterChip active={canQualify && qualified} onClick={() => setQualified(q => !q)}>
                {canQualify && qualified ? '✓ Qualified' : 'Qualified'}
              </FilterChip>
            )}
          </Box>
        </Box>
        )}
      </StatsBar>

      {failed === loadKey && (
        <Typography sx={{ textAlign: 'center', py: 6, color: 'text.secondary', fontSize: '0.9rem' }}>
          Couldn’t load {teams ? 'team' : 'fielding'} stats. Try again in a moment.
        </Typography>
      )}

      {failed !== loadKey && listView && (
        loading ? (
          <Box aria-hidden>
            <StatsRankedList skeleton rows={[]} def={activeDef} statDefs={defs} group={side} asc={asc} clubs={teams}
              onOpenPlayer={() => {}} footer={() => foot(null)} />
          </Box>
        ) : ranked.length === 0 ? (
          <Typography sx={{ textAlign: 'center', py: 6, color: 'text.secondary', fontSize: '0.9rem' }}>
            {canQualify && qualified ? 'Nobody has qualified here yet. Sort, then Filter → Everyone, shows everyone.'
              : gameScope === 'post' ? `No playoff games in ${vizSeason}${vizSeason >= CURRENT_SEASON ? ' yet' : ''}.`
              : 'No games in this season yet.'}
          </Typography>
        ) : (
          // Keyed on everything that reorders or repopulates it, so "Show all" closes again.
          <StatsRankedList key={boardKey} rows={listRows} def={activeDef} statDefs={defs} group={side} asc={asc}
            clubs={teams} noun={noun} highlightPlayerId={highlightId}
            league={league && activeDef.isRate ? activeDef.format(activeDef.getValue(league)) : null}
            onOpenPlayer={onOpenPlayer} onOpenTeam={onOpenTeam} footer={() => foot(ranked.length)} />
        )
      )}

      {failed !== loadKey && !listView && (
        <Box sx={TABLE_FRAME_SX}>
          <Box onScroll={frozenOn ? e => setAtStart(e.currentTarget.scrollLeft <= 1) : undefined}
            sx={{ overflowX: 'auto', overscrollBehaviorX: 'contain', overflowY: isDesktop ? 'auto' : 'visible', maxHeight: isDesktop ? TABLE_MAX_H : undefined }}>
            <Box component="table" sx={{ borderCollapse: 'collapse', minWidth: '100%', fontVariantNumeric: 'tabular-nums' }}>
              {header}
              <Box component="tbody">
                {loading && Array.from({ length: skeletonRows }, (_, i) => (
                  <Box component="tr" key={i} aria-hidden>
                    <Box component="th" sx={{ ...tdSx, ...nameColSx, zIndex: 2, bgcolor: 'background.paper' }}>
                      <Skeleton sx={{ width: '70%' }} />
                    </Box>
                    {cols.map(def => {
                      const on = def.key === activeDef.key
                      return (
                        <Box component="td" key={def.key} sx={{ ...tdSx, ...(isFrozen(def) ? frozen : {}), textAlign: 'center', fontSize: on ? '0.84rem' : '0.8rem', fontWeight: on ? 800 : 500, color: 'transparent' }}>
                          {(teamFielding ? TEAM_FIELDING_SAMPLE : SAMPLE)[def.key] ?? '000'}
                        </Box>
                      )
                    })}
                  </Box>
                ))}
                {!loading && shown.map((r, idx) => {
                  const openRow = () => (r.playerId ? onOpenPlayer(r.playerId) : onOpenTeam(r.teamId))
                  const link = r.playerId ? playerLink(r.playerId, r.name, onOpenPlayer) : teamLink(r.teamId, onOpenTeam)
                  return (
                    <Box component="tr" key={r.id} {...rowClick(openRow)}
                      ref={idx === hlIdx ? (el: HTMLElement | null) => { hlRef.current = el } : undefined}
                      sx={{
                        cursor: 'pointer', [ROW_TINT_VAR]: idx === hlIdx ? `${ACCENT}1a` : 'transparent',
                        '@media (hover: hover)': { '&:hover': { [ROW_TINT_VAR]: idx === hlIdx ? `${ACCENT}26` : `${ACCENT}0e` } },
                      }}>
                      <Box component="th" sx={{ ...tdSx, ...nameColSx, zIndex: 2, bgcolor: 'background.paper', backgroundImage: ROW_TINT, fontWeight: 'normal' }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                          <Typography sx={{ width: '1.25rem', display: 'flex', justifyContent: 'flex-end', flexShrink: 0, fontSize: '0.7rem', fontWeight: 700, color: 'text.disabled', whiteSpace: 'nowrap', lineHeight: 1 }}>
                            <RankMarkText rank={ranks[idx]} />
                          </Typography>
                          {r.teamId > 0 && <LogoBubble teamId={r.teamId} abbr={TEAM_ABBR[r.teamId] ?? ''} size={20} ring={1} />}
                          <Box sx={{ minWidth: 0 }}>
                            {r.playerId
                              ? <NameText name={frozenOn ? abbrevName(r.name) : r.name} linkProps={link}
                                  sx={{ ...LINK_SX, display: 'block', fontWeight: 600, fontSize: '0.82rem', lineHeight: 1.15 }} />
                              : (
                                <Typography {...link} sx={{ ...LINK_SX, display: 'block', fontWeight: 600, fontSize: '0.82rem', lineHeight: 1.15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  <ClubName teamId={r.teamId} name={r.name} sx={{ font: 'inherit', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} />
                                </Typography>
                              )}
                            {r.position && (
                              <Typography sx={{ fontSize: '0.62rem', color: 'text.disabled', lineHeight: 1 }}>{r.position}</Typography>
                            )}
                          </Box>
                        </Box>
                      </Box>
                      {cols.map(def => {
                        const on = def.key === activeDef.key
                        return (
                          <Box component="td" key={def.key} onClick={ev => { ev.stopPropagation(); pickColumn(def) }} sx={{
                            ...tdSx, ...(isFrozen(def) ? { ...frozen, zIndex: 3, '&::after': atStart ? undefined : FROZEN_EDGE } : {}), textAlign: 'center',
                            backgroundImage: [ROW_TINT, on ? `linear-gradient(${ACCENT}12, ${ACCENT}12)` : null].filter(Boolean).join(', '),
                            fontSize: on ? '0.84rem' : '0.8rem', fontWeight: on ? 800 : 500,
                            color: on ? 'var(--wpbl-accent-fg)' : 'text.primary',
                          }}>
                            {def.format(def.getValue(r.stat))}
                          </Box>
                        )
                      })}
                    </Box>
                  )
                })}
              </Box>
            </Box>
          </Box>
          {!loading && ranked.length === 0 && (
            <Typography sx={{ textAlign: 'center', py: 4, color: 'text.secondary', fontSize: '0.85rem' }}>
              {canQualify && qualified ? 'Nobody has qualified here yet. Turn off Qualified to see everyone.'
                : gameScope === 'post' ? `No playoff games in ${vizSeason}${vizSeason >= CURRENT_SEASON ? ' yet' : ''}.`
                : 'No games in this season yet.'}
            </Typography>
          )}
          {(loading ? !teams : canCap) && (
            // No count in the label: the foot under it carries one ("25 of 148 fielders"), and a count
            // here is a number the skeleton cannot know, so the arrow moved when it landed.
            <ExpandRow expanded={open === boardKey} moreLabel={`Show all ${noun}`}
              onToggle={() => setOpen(open === boardKey ? null : boardKey)} />
          )}
          {foot(loading ? null : ranked.length)}
        </Box>
      )}

      {sheetTab && !isDesktop && (
        <StatsSortFilterSheet tab={sheetTab} onTab={setSheetTab} group={side} clubs={teams} filtersSet={filtersSet}
          onClose={() => setSheetTab(null)}
          sort={<SortBody statDefs={defs} sortKey={activeDef.key} asc={asc} reversible onPick={pickSort} onDirection={setDirection} />}
          filter={<FilterBody allTime={false}
            seasonValue={String(vizSeason)} onSeason={v => choose(setVizSeason)(Number(v))}
            scope={gameScope} scopes={GAME_SCOPES} onScope={sc => choose(setGameScope)(sc)}
            canQualify={canQualify} qualified={qualified} onQualified={() => setQualified(q => !q)}
            choices={teams ? undefined : [
              { title: 'Position', options: POSITION_OPTIONS, value: position, onChange: v => choose(setPosition)(v as FieldingPosition | 'all') },
              { title: 'Club', options: CLUB_OPTIONS, value: club == null ? '' : String(club), onChange: v => choose(setClub)(v ? Number(v) : null) },
            ]} />} />
      )}
    </Box>
  )
}
