import React, { useEffect, useMemo, useState } from 'react'
import { Box, Skeleton, Typography } from '@mui/material'
import {
  runFinder, finderFields, finderUnit, defaultCondition, parseFinderValue, unparseFinderValue,
  describeFinderQuery, FINDER_OPS,
  type FinderCondition, type FinderOp, type FinderQuery, type FinderVenue,
} from '../../league/finder'
import { SectionCard, TYPE_SCALE, CARD_BORDER } from '../../ui/card'
import { PillGroup } from '../../ui/PillGroup'
import { FilterChip, FilterSelect } from '../../ui/FilterChip'
import { ExpandRow } from '../../ui/ExpandRow'
import { LeaderCard, LeaderCardSkeleton, PORTRAIT_PX } from '../../ui/leaders'
import { FOCUS_RING, hoverOnly, pressable } from '../../ui/interaction'
import { chromePx } from '../../ui/scale'
import { StatsBar, STATS_BOARD_ROOT_SX } from './StatsBar'
import GameLineRow from '../components/GameLineRow'
import { PlayerHeadshot } from '../components/leaderboards'
import { LogoBubble } from '../components/boxScore'
import { playerLink } from '../lib/links'
import { GAME_SCOPES, GAME_SCOPE_LABEL } from '../lib/gameScope'
import { TEAM_ABBR, TEAM_NICKNAME } from '../constants'
import { MLB_CLUBS } from '../routes'
import { seasonScopeOf, MLB_LINES_SEASONS } from '../seasonLines'
import { useMlbSeasonLines, LinesSeasonSelect, NotMirrored, type MlbLinesBoardProps } from './BestsView'

// THE FIND BOARD: every MLB game line that matches what you asked for. WPBL's board
// (src/wpbl/FindView.tsx) on WPBL's engine (src/league/finder.ts), over MLB's mirrored box scores:
// how many times did anyone strike out twelve, who went four for four most often, has anyone
// walked nobody through eight. The engine's notes say what can be asked and why every condition
// is AND; WPBL's view says why the stat picker is a native select and why the value is a text box
// (innings: "6.2" is six and two thirds, never 6.2). ROADMAP.md item 6, step 3.
//
// The same season read as Bests (seasonLines.ts, cached), so a reader moving between the two pays
// for it once. The query is the section's and on the address (`q`, `team`, `opp`, `venue`), so a
// question can be sent as a link.

/** How much of the result list shows before it asks: ten is a leaderboard, thirty a directory. */
const RESULT_CAP = 10
/** The tally's rows. */
const TALLY_SHOWN = 10
const SIDE_OPTIONS = [{ value: 'hitting', label: 'Hitting' }, { value: 'pitching', label: 'Pitching' }]
const BOARD_W = chromePx(1150)
const CLUBS = [...MLB_CLUBS].sort((a, b) => (TEAM_NICKNAME[a.id] ?? a.name).localeCompare(TEAM_NICKNAME[b.id] ?? b.name))
const clubOptions = (blank: string) => [
  { value: '', label: blank },
  ...CLUBS.map(c => ({ value: String(c.id), label: TEAM_NICKNAME[c.id] ?? c.name })),
]

const inputSx = {
  ...FOCUS_RING,
  width: '3.5rem', minHeight: 30, px: 1, py: 0.3,
  borderRadius: 999, border: '1px solid', borderColor: CARD_BORDER,
  bgcolor: 'background.paper', color: 'text.primary',
  fontSize: '0.74rem', fontWeight: 700, fontFamily: 'inherit',
  textAlign: 'center', fontVariantNumeric: 'tabular-nums',
  ...hoverOnly({ borderColor: 'text.disabled' }),
} as const

function ConditionRow({ side, n, condition, onChange, onRemove }: {
  side: 'hitting' | 'pitching'
  n: number
  condition: FinderCondition
  onChange: (c: FinderCondition) => void
  onRemove: () => void
}) {
  // What the reader typed, while the box has focus: the stored value is normalised (innings are
  // outs), and a purely controlled box would rewrite "6" as "6.0" under the cursor.
  const [draft, setDraft] = useState<string | null>(null)
  useEffect(() => { setDraft(null) }, [condition.field])
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
      <FilterSelect ariaLabel={`Stat, condition ${n}`} value={condition.field} active={false}
        options={finderFields(side).map(f => ({ value: f.key, label: f.label }))}
        onChange={field => onChange({ ...condition, field })} />
      <FilterSelect ariaLabel={`Comparison, condition ${n}`} value={condition.op} active={false}
        options={FINDER_OPS.map(o => ({ value: o.op, label: o.label }))}
        onChange={op => onChange({ ...condition, op: op as FinderOp })} />
      <Box component="input" aria-label={`Value, condition ${n}`} inputMode="decimal"
        value={draft ?? unparseFinderValue(side, condition.field, condition.value)}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
          setDraft(e.target.value)
          onChange({ ...condition, value: parseFinderValue(side, condition.field, e.target.value) })
        }}
        onBlur={() => setDraft(null)}
        sx={inputSx} />
      <Box {...pressable(onRemove)} aria-label={`Remove condition ${n}`} sx={{
        ...FOCUS_RING,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        width: 30, height: 30, borderRadius: 999, cursor: 'pointer', userSelect: 'none',
        color: 'text.disabled', fontSize: TYPE_SCALE.body, fontWeight: 800,
        ...hoverOnly({ color: 'text.primary', bgcolor: 'action.hover' }),
      }}>✕</Box>
    </Box>
  )
}

export function MlbFindView({
  boardTabs, isDesktop, lbGroup, setLbGroup, vizSeason, setVizSeason, gameScope, setGameScope, onOpenPlayer, onOpenGame,
  query, onQuery,
}: MlbLinesBoardProps & {
  /** Owned by the section, which mirrors it into the address. Its `scope` is ignored here: the
   *  section's Regular season / Playoffs / Both is the one control for that. */
  query: FinderQuery
  onQuery: (q: FinderQuery) => void
}) {
  const side = lbGroup
  const { data, loading, failed } = useMlbSeasonLines(vizSeason)
  const [allRows, setAllRows] = useState(false)
  const scoped = useMemo(() => ({ ...query, scope: seasonScopeOf(gameScope) }), [query, gameScope])
  const result = useMemo(
    () => runFinder(side, data?.batting ?? [], data?.pitching ?? [], data?.players ?? [], data?.games ?? [], scoped),
    [side, data, scoped])
  const unit = finderUnit(side, result.headlineField)
  const mirrored = MLB_LINES_SEASONS.includes(vizSeason)

  const setCondition = (i: number, c: FinderCondition) =>
    onQuery({ ...query, conditions: query.conditions.map((x, j) => (j === i ? c : x)) })
  const removeCondition = (i: number) => onQuery({ ...query, conditions: query.conditions.filter((_, j) => j !== i) })
  const addCondition = () => onQuery({ ...query, conditions: [...query.conditions, defaultCondition(side)] })

  // The question read back in full, club and venue included, so the count says what it counted.
  const games_ = result.total === 1 ? 'game' : 'games'
  const clubAbbr = (id: string | null) => (id ? (TEAM_ABBR[Number(id)] ?? id) : null)
  const scopeBits = [
    query.teamId && `for ${clubAbbr(query.teamId)}`,
    query.oppId && `vs ${clubAbbr(query.oppId)}`,
    query.venue === 'home' ? 'at home' : query.venue === 'away' ? 'on the road' : null,
  ].filter(Boolean) as string[]
  const scopeText = scopeBits.join(', ')
  const total = result.total.toLocaleString()
  const summary = loading ? undefined : query.conditions.length
    ? `${total} ${games_} where ${describeFinderQuery(side, query)}${scopeText ? `, ${scopeText}` : ''}`
    : scopeBits.length
      ? `${total} ${games_} ${scopeText}. Add a condition to narrow it.`
      : `Every line: ${total} ${games_}. Add a condition to narrow it.`
  const shownRows = allRows ? result.rows : result.rows.slice(0, RESULT_CAP)

  return (
    <Box sx={STATS_BOARD_ROOT_SX}>
      <StatsBar tabs={boardTabs} isDesktop={isDesktop}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
          {/* A new side asks a new question: the old conditions name fields the other side may
              not have (a hitter's TB, a pitcher's IP), so the switch clears them. */}
          <PillGroup options={SIDE_OPTIONS} value={side}
            onChange={v => { setLbGroup(v as 'hitting' | 'pitching'); onQuery({ ...query, conditions: [] }) }} />
          <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center', flexWrap: 'wrap', minWidth: 0 }}>
            {GAME_SCOPES.map(sc => (
              <FilterChip key={sc} active={gameScope === sc} onClick={() => setGameScope(sc)}>{GAME_SCOPE_LABEL[sc]}</FilterChip>
            ))}
            <Box sx={{ width: '1px', alignSelf: 'stretch', bgcolor: 'divider', mx: 0.25, flexShrink: 0 }} />
            <LinesSeasonSelect season={vizSeason} setSeason={setVizSeason} />
          </Box>
        </Box>
      </StatsBar>

      {!mirrored ? <NotMirrored season={vizSeason} /> : failed ? (
        <Typography sx={{ textAlign: 'center', py: 6, color: 'text.secondary', fontSize: '0.9rem' }}>
          Couldn’t load the {vizSeason} box scores. Try again in a moment.
        </Typography>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: { xs: 1.5, sm: 2 }, maxWidth: BOARD_W, mx: 'auto', width: '100%', pt: { xs: 1.5, sm: 2 } }}>
          <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.secondary', lineHeight: 1.5, maxWidth: '70ch' }}>
            Search every box-score line of the season for the games that match.
          </Typography>

          <SectionCard title="The question" subtitle={query.conditions.length ? undefined : 'Add a condition to narrow it down.'}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, pt: 0.5 }}>
              {query.conditions.map((c, i) => (
                <ConditionRow key={i} side={side} n={i + 1} condition={c}
                  onChange={next => setCondition(i, next)} onRemove={() => removeCondition(i)} />
              ))}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
                {/* Six, the cap the address decoder enforces too. */}
                {query.conditions.length < 6 && (
                  <FilterChip active={false} onClick={addCondition}>+ Add a condition</FilterChip>
                )}
                {query.conditions.length > 0 && (
                  <FilterChip active={false} onClick={() => onQuery({ ...query, conditions: [] })}>Clear</FilterChip>
                )}
              </Box>
              {/* Which games to look at, kept apart from what happened in them. */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap', pt: 1, mt: 0.5, borderTop: '1px solid', borderColor: 'divider' }}>
                <FilterSelect ariaLabel="Club" value={query.teamId ?? ''} options={clubOptions('Any club')}
                  active={!!query.teamId} onChange={v => onQuery({ ...query, teamId: v || null })} />
                <FilterSelect ariaLabel="Home or away" value={query.venue} active={query.venue !== 'any'}
                  options={[{ value: 'any', label: 'Home or away' }, { value: 'home', label: 'At home' }, { value: 'away', label: 'On the road' }]}
                  onChange={v => onQuery({ ...query, venue: v as FinderVenue })} />
                <FilterSelect ariaLabel="Opponent" value={query.oppId ?? ''} options={clubOptions('Any opponent')}
                  active={!!query.oppId} onChange={v => onQuery({ ...query, oppId: v || null })} />
              </Box>
            </Box>
          </SectionCard>

          <Box sx={{
            display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1.6fr) minmax(0, 1fr)' },
            alignItems: 'start', gap: { xs: 1.5, sm: 2 },
          }}>
            {/* A no-break space while loading: a plain one collapses, and the line with it. */}
            <SectionCard title="Matching games" subtitle={summary ?? String.fromCharCode(160)}>
              {loading ? Array.from({ length: RESULT_CAP }, (_, i) => (
                <Box key={i} aria-hidden sx={{
                  display: 'flex', alignItems: 'center', gap: 1.25, px: 0.5, py: 0.85,
                  borderTop: i > 0 ? '1px solid' : 'none', borderColor: 'divider',
                }}>
                  <Box sx={{ width: '1.5rem', flexShrink: 0, fontSize: TYPE_SCALE.body }}>&nbsp;</Box>
                  <Skeleton variant="circular" width={chromePx(PORTRAIT_PX)} height={chromePx(PORTRAIT_PX)} sx={{ flexShrink: 0 }} />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontSize: TYPE_SCALE.body }}><Skeleton width="55%" /></Typography>
                    <Typography sx={{ fontSize: TYPE_SCALE.meta }}><Skeleton width="75%" /></Typography>
                  </Box>
                  <Box sx={{ fontSize: TYPE_SCALE.heading, fontWeight: 800 }}><Skeleton width="2rem" /></Box>
                </Box>
              )).concat(
                // The expand row a season's worth of matches always brings, so the card does not
                // grow by it when they land and push the tally under it on a phone.
                <ExpandRow key="more" flush expanded={false} moreLabel="Show top 50 games" onToggle={() => {}} />,
              ) : result.rows.length === 0 ? (
                <Box sx={{ py: 2 }}>
                  <Typography sx={{ fontSize: TYPE_SCALE.body, fontWeight: 700, mb: 0.5 }}>Nothing matched</Typography>
                  <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.disabled' }}>
                    Searched {result.searched.toLocaleString()} {result.searched === 1 ? 'line' : 'lines'}
                    {side === 'pitching' ? ' from pitchers who appeared' : ' from batters who came to the plate'}.
                    Loosen a condition, or widen the club and venue.
                  </Typography>
                </Box>
              ) : (
                <>
                  {shownRows.map((r, i) => (
                    <GameLineRow key={r.key} rank={i + 1} name={r.name} player={r.player} teamId={r.teamId}
                      game={r.game} detail={r.detail} value={r.headlineDisplay} unit={unit} divider={i > 0}
                      nameOpens="game" compactDate emphasizeRank={false} onOpenPlayer={onOpenPlayer} onOpenGame={onOpenGame} />
                  ))}
                  {result.rows.length > RESULT_CAP && (
                    <ExpandRow flush expanded={allRows}
                      moreLabel={result.total > result.rows.length ? `Show top ${result.rows.length} games` : `Show all ${result.rows.length} games`}
                      onToggle={() => setAllRows(v => !v)} />
                  )}
                  {allRows && result.total > result.rows.length && (
                    <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.disabled', textAlign: 'center', pt: 1 }}>
                      Showing the top {result.rows.length} of {total}. Narrow the question to see the rest.
                    </Typography>
                  )}
                </>
              )}
            </SectionCard>

            {/* The second answer, and the more interesting one: who does it. Free once the matching
                is done. The shared leader card, so it reads as the Leaders board's rows do. */}
            {/* Ten ghost rows while loading, which a season always fills. */}
            {loading ? <LeaderCardSkeleton title="Most games matching" rows={TALLY_SHOWN} seeAll={false} /> : <LeaderCard title="Most games matching" empty="Nobody yet."
              items={result.tally.slice(0, TALLY_SHOWN).map((t, _i, arr) => {
                const club = t.teamId ? Number(t.teamId) : 0
                const rank = arr.findIndex(x => x.games === t.games) + 1
                return {
                  key: t.player?.id ?? t.name,
                  rank,
                  tied: arr.filter(x => x.games === t.games).length > 1,
                  name: t.name,
                  portrait: t.player
                    ? <PlayerHeadshot variant="ring" playerId={t.player.playerId} name={t.name} teamId={club || undefined} size={PORTRAIT_PX} />
                    : <Box sx={{ width: chromePx(PORTRAIT_PX) }} />,
                  badge: club > 0 ? <LogoBubble teamId={club} abbr={TEAM_ABBR[club] ?? ''} size={16} ring={1} /> : undefined,
                  value: `${t.games}`,
                  linkProps: t.player ? playerLink(t.player.playerId, t.name, onOpenPlayer) : undefined,
                }
              })} />}
          </Box>
        </Box>
      )}
    </Box>
  )
}
