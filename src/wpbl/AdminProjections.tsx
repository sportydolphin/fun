import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Box, Typography } from '@mui/material'
import { ChipRow, FilterChip } from '../ui/FilterChip'
import { InfoDot } from '../ui/InfoDot'
import { NameText } from '../ui/NameText'
import { CARD_BORDER, TYPE_SCALE } from './ui'
import { supabase } from '../lib/supabase'
import { safe } from './api/core'
import { fetchWpblAllPlayers, fetchWpblPlayerSeasons, fetchWpblTeams } from './api'
import { useWpblRosterMoves } from './useRosterMoves'
import { useEraBasis } from './EraBasisContext'
import { fmtPct, fmtRate } from './stats'
import { DRAFT_ORDER_2027, ROSTERS_2026, ROSTER_SEASON, club2026, heldPlayers } from './offseason2027'
import { LEAGUE_ROW, type WpblPlayerSeasonRow } from './derive/playerSeasons'
import {
  BAT_KEYS, PIT_KEYS, addEvents, batEvents, pitEvents, posterior, projectHitter, projectPitcher,
  regressionPoints, returningProduction, worldCupTranslation,
  type BatKey, type BatProjection, type Events, type PitKey, type PitProjection, type RateModel, type Translation,
} from './derive/projections'
import type { InternationalEvent } from '../intl/wbsc/international'
import type { WpblPlayer, WpblTeam } from './types'

// /admin → Projections: the 2027 projections while they are built, owner-only because a club is
// still mostly unsigned (6 to 9 of 20 when this opened, Nov 20, 2026), and a projected roster that
// is half empty reads as a ranking it is not. The model is derive/projections.ts, which says why
// every constant is what it is. Public once the draft and free agency fill the rosters.

/** The season projected FROM: the one before the rosters being built. */
const FROM = ROSTER_SEASON - 1

const WC_WEIGHTS = [
  { value: 0, label: 'No World Cup' },
  { value: 0.5, label: 'World Cup at half' },
  { value: 1, label: 'World Cup in full' },
]

type Show = 'rostered' | 'all'

interface WcRow { wpbl_player_id: string; events: InternationalEvent[] }

function wcEvents(events: InternationalEvent[]): { bat: Events<BatKey> | null; pit: Events<PitKey> | null } {
  let bat: Events<BatKey> | null = null
  let pit: Events<PitKey> | null = null
  for (const e of events) {
    if (e.batting) bat = addEvents(BAT_KEYS, bat, batEvents({ ...e.batting, sf: e.batting.sf ?? 0, sh: e.batting.sh ?? 0 }))
    if (e.pitching) pit = addEvents(PIT_KEYS, pit, pitEvents(e.pitching))
  }
  return { bat: bat && bat.n > 0 ? bat : null, pit: pit && pit.n > 0 ? pit : null }
}

const pct = (n: number, d: number) => (d > 0 ? `${Math.round((100 * n) / d)}%` : '—')

export default function AdminProjections() {
  const [rows, setRows] = useState<{ rows: WpblPlayerSeasonRow[]; current: boolean } | null>(null)
  const [players, setPlayers] = useState<WpblPlayer[]>([])
  const [teams, setTeams] = useState<WpblTeam[]>([])
  const [wc, setWc] = useState<WcRow[]>([])
  const [weight, setWeight] = useState(0.5)
  const [show, setShow] = useState<Show>('rostered')
  const moves = useWpblRosterMoves()
  const { fmtEra } = useEraBasis()

  useEffect(() => {
    let alive = true
    void Promise.all([
      fetchWpblPlayerSeasons(FROM),
      fetchWpblAllPlayers(),
      fetchWpblTeams(),
      // One row per player with a World Cup, a few dozen: no paging needed, ordered all the same.
      safe<WcRow[]>('world cup lines', () =>
        supabase.from('wbsc_world_cup_lines').select('wpbl_player_id,events').order('wpbl_player_id'), []),
    ]).then(([r, p, t, w]) => {
      if (!alive) return
      setRows(r); setPlayers(p); setTeams(t); setWc(w)
    })
    return () => { alive = false }
  }, [])

  const held = useMemo(() => heldPlayers(moves ?? []), [moves])
  // Back with a club is not back in the league: a player drafted or traded elsewhere is on a 2027
  // roster and is still production their 2026 club lost.
  const back = useMemo(() => new Set([...held].filter(([id, team]) => club2026(id) === team).map(([id]) => id)), [held])
  const clubOf = (id: string) => held.get(id) ?? club2026(id)

  const model = useMemo(() => {
    if (!rows) return null
    const regular = rows.rows.filter(r => r.scope === 'regular')
    const league = regular.find(r => r.player_id === LEAGUE_ROW)
    const own = regular.filter(r => r.player_id !== LEAGUE_ROW)
    if (!league?.batting || !league.pitching) return null
    const bat = new Map(own.filter(r => r.batting).map(r => [r.player_id, batEvents(r.batting!)]))
    const pit = new Map(own.filter(r => r.pitching && r.pitching.bf > 0).map(r => [r.player_id, pitEvents(r.pitching!)]))
    const cup = new Map(wc.map(w => [w.wpbl_player_id, wcEvents(w.events)]))
    const batModel = regressionPoints(BAT_KEYS, [...bat.values()])
    const pitModel = regressionPoints(PIT_KEYS, [...pit.values()])
    const batT = worldCupTranslation(BAT_KEYS, [...bat].flatMap(([id, e]) => {
      const c = cup.get(id)?.bat; return c ? [{ wpbl: e, wc: c }] : []
    }))
    const pitT = worldCupTranslation(PIT_KEYS, [...pit].flatMap(([id, e]) => {
      const c = cup.get(id)?.pit; return c ? [{ wpbl: e, wc: c }] : []
    }))
    // A full season for the ranges: an everyday hitter's share of the league's trips, a starter's.
    const clubs = DRAFT_ORDER_2027.length
    const hitterN = Math.round(batEvents(league.batting).n / (clubs * 9))
    const pitcherN = Math.round(pitEvents(league.pitching).n / (clubs * 4))
    return { league, own, bat, pit, cup, batModel, pitModel, batT, pitT, hitterN, pitcherN }
  }, [rows, wc])

  const byId = useMemo(() => new Map(players.map(p => [p.id, p])), [players])
  const teamName = (id: string | null) => (id ? teams.find(t => t.id === id)?.name ?? id : '—')

  const hitters = useMemo(() => {
    if (!model) return []
    const ids = new Set([...model.bat.keys(), ...[...model.cup].filter(([, c]) => c.bat).map(([id]) => id)])
    return [...ids].filter(id => byId.has(id) && (show === 'all' || held.has(id))).map(id => {
      const c = model.cup.get(id)?.bat ?? null
      const post = posterior(BAT_KEYS, model.batModel, model.bat.get(id) ?? null,
        c ? { events: c, translation: model.batT, weight } : null)
      const p: BatProjection = projectHitter(post, model.batModel,
        { counts: model.league.batting!, weights: model.league.weights?.woba ?? null },
        { n: model.hitterN, seed: hash(id) })
      return { id, own: post.own, wc: post.wc, p }
    }).filter(h => h.own >= 10 || h.wc >= 10).sort((a, b) => (b.p.wrcPlus ?? 0) - (a.p.wrcPlus ?? 0))
  }, [model, byId, held, show, weight])

  const pitchers = useMemo(() => {
    if (!model) return []
    const ids = new Set([...model.pit.keys(), ...[...model.cup].filter(([, c]) => c.pit).map(([id]) => id)])
    return [...ids].filter(id => byId.has(id) && (show === 'all' || held.has(id))).map(id => {
      const c = model.cup.get(id)?.pit ?? null
      const post = posterior(PIT_KEYS, model.pitModel, model.pit.get(id) ?? null,
        c ? { events: c, translation: model.pitT, weight } : null)
      const p: PitProjection = projectPitcher(post, model.pitModel,
        { counts: model.league.pitching!, weights: model.league.weights?.fip ?? null },
        { n: model.pitcherN, seed: hash(id) })
      return { id, own: post.own, wc: post.wc, p }
    }).filter(h => h.own >= 10 || h.wc >= 10).sort((a, b) => (a.p.fip ?? 99) - (b.p.fip ?? 99))
  }, [model, byId, held, show, weight])

  const returning = useMemo(() => {
    if (!model) return []
    // The whole 2026 roster, so a player who never got into a game still counts toward "Back".
    const stored = new Map(model.own.map(r => [r.player_id, r]))
    const input = DRAFT_ORDER_2027.flatMap(team => (ROSTERS_2026[team] ?? []).map(id => {
      const r = stored.get(id)
      const pa = r?.batting ? batEvents(r.batting).n : 0
      return { teamId: team, playerId: id, pa, outs: r?.pitching?.outs ?? 0, war: rows?.current ? r?.value?.war ?? 0 : null }
    }))
    const out = returningProduction(input, back)
    return DRAFT_ORDER_2027.flatMap(id => out.filter(c => c.teamId === id))
  }, [model, back, rows])

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Card title="Returning production" info={`Each club's ${FROM} regular season held by the players still with it for ${ROSTER_SEASON}. A player counts for their ${FROM} club.`}>
        <Table cols={['Club', 'Back', 'PA', 'IP', 'WAR back', 'WAR']} widths="minmax(6rem, 1fr) repeat(5, 4.5rem)"
          rows={returning.map(c => [
            teamName(c.teamId), `${c.back}/${c.players}`, pct(c.pa.back, c.pa.total), pct(c.outs.back, c.outs.total),
            // WAR, not a share of it: a club's total can sit at or under zero, where a share means nothing.
            c.war ? c.war.back.toFixed(1) : '—', c.war ? c.war.total.toFixed(1) : '—',
          ])} />
      </Card>

      <ChipRow mb={0}>
        <FilterChip active={show === 'rostered'} onClick={() => setShow('rostered')}>{ROSTER_SEASON} rosters</FilterChip>
        <FilterChip active={show === 'all'} onClick={() => setShow('all')}>All</FilterChip>
      </ChipRow>
      <ChipRow mb={0}>
        {WC_WEIGHTS.map(w => (
          <FilterChip key={w.value} active={weight === w.value} onClick={() => setWeight(w.value)}>{w.label}</FilterChip>
        ))}
      </ChipRow>

      <Card title="Hitters" info={`Projected rates. Range: wRC+ over a ${model?.hitterN ?? '—'} PA season, 10th to 90th percentile. Own: the share of the projection that is the player's own line and World Cup, the rest is league average.`}>
        <Table cols={['Player', 'Club', 'PA', 'WC PA', 'AVG/OBP/SLG', 'wRC+', 'Range', 'Own']}
          widths="minmax(8rem, 1.4fr) 4.5rem 3rem 3.5rem 8.5rem 3rem 5.5rem 3rem"
          rows={hitters.map(h => [
            <NameText key="n" name={byId.get(h.id)?.name ?? h.id} sx={{ fontSize: 'inherit' }} />, teamName(clubOf(h.id)),
            String(h.own), h.wc ? String(h.wc) : '—',
            `${fmtRate(h.p.avg)}/${fmtRate(h.p.obp)}/${fmtRate(h.p.slg)}`,
            h.p.wrcPlus == null ? '—' : String(Math.round(h.p.wrcPlus)),
            h.p.wrcRange ? `${Math.round(h.p.wrcRange.p10)}–${Math.round(h.p.wrcRange.p90)}` : '—',
            `${Math.round(100 * h.p.ownShare)}%`,
          ])} />
      </Card>

      <Card title="Pitchers" info={`Projected rates. Range: FIP over a ${model?.pitcherN ?? '—'} batter season, 10th to 90th percentile.`}>
        <Table cols={['Player', 'Club', 'BF', 'WC BF', 'K%', 'BB%', 'FIP', 'Range', 'Own']}
          widths="minmax(8rem, 1.4fr) 4.5rem 3rem 3.5rem 3.5rem 3.5rem 3.5rem 6rem 3rem"
          rows={pitchers.map(h => [
            <NameText key="n" name={byId.get(h.id)?.name ?? h.id} sx={{ fontSize: 'inherit' }} />, teamName(clubOf(h.id)),
            String(h.own), h.wc ? String(h.wc) : '—', fmtPct(h.p.kPct), fmtPct(h.p.bbPct), fmtEra(h.p.fip),
            h.p.fipRange ? `${fmtEra(h.p.fipRange.p10)}–${fmtEra(h.p.fipRange.p90)}` : '—',
            `${Math.round(100 * h.p.ownShare)}%`,
          ])} />
      </Card>

      <Card title="Model" info="Point: the PA (or batters faced) at which a player's own rate counts for half, measured from the season's spread in talent. Factor: a World Cup rate times this reads in WPBL terms. r: World Cup rate against WPBL rate for the players with both.">
        <ModelTable label="Hitting" keys={BAT_KEYS} model={model?.batModel ?? null} t={model?.batT ?? null} names={BAT_NAMES} />
        <ModelTable label="Pitching" keys={PIT_KEYS} model={model?.pitModel ?? null} t={model?.pitT ?? null} names={PIT_NAMES} />
      </Card>
    </Box>
  )
}

const BAT_NAMES: Record<BatKey, string> = { k: 'K', bb: 'BB+HBP', s1: '1B', xbh: '2B+3B', hr: 'HR' }
const PIT_NAMES: Record<PitKey, string> = { k: 'K', bb: 'BB+HBP', hr: 'HR', h: 'Non-HR hit' }

function ModelTable<K extends string>({ label, keys, model, t, names }: {
  label: string; keys: readonly K[]; model: RateModel<K> | null; t: Translation<K> | null; names: Record<K, string>
}) {
  return (
    <Box sx={{ mb: 1.5 }}>
      <Typography sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 700, color: 'text.secondary', px: 0.75, pb: 0.5 }}>
        {label}{model ? ` · ${model.players} players · ${t?.players ?? 0} with both` : ''}
      </Typography>
      <Table cols={['Rate', 'League', 'Point', 'Factor', 'r']} widths="minmax(6rem, 1fr) repeat(4, 4rem)"
        rows={model ? keys.map(k => [
          names[k], fmtPct(model.lg[k]), String(Math.round(model.point[k])),
          t ? t.factor[k].toFixed(2) : '—', t?.r[k] == null ? '—' : t.r[k]!.toFixed(2),
        ]) : []} />
    </Box>
  )
}

function Card({ title, info, children }: { title: string; info: string; children: ReactNode }) {
  return (
    <Box sx={{ border: '1px solid', borderColor: CARD_BORDER, borderRadius: 2, p: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 0.75, pb: 1 }}>
        <Typography sx={{ fontSize: TYPE_SCALE.title, fontWeight: 700 }}>{title}</Typography>
        <InfoDot text={info} label={`About ${title}`} />
      </Box>
      {children}
    </Box>
  )
}

/** A plain grid table, scrolling sideways on a phone rather than squeezing the numbers. */
function Table({ cols, widths, rows }: { cols: string[]; widths: string; rows: ReactNode[][] }) {
  const line = { display: 'grid', gridTemplateColumns: widths, gap: 1, px: 0.75, py: 0.5, alignItems: 'center' }
  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Box sx={{ minWidth: 'max-content' }}>
        <Box sx={{ ...line, fontSize: TYPE_SCALE.meta, fontWeight: 700, color: 'text.secondary' }}>
          {cols.map((c, i) => <Box key={c} sx={{ textAlign: i === 0 ? 'left' : 'right' }}>{c}</Box>)}
        </Box>
        {rows.map((r, j) => (
          <Box key={j} sx={{ ...line, borderTop: '1px solid', borderColor: 'divider', fontSize: TYPE_SCALE.body, fontVariantNumeric: 'tabular-nums' }}>
            {r.map((cell, i) => <Box key={i} sx={{ textAlign: i === 0 ? 'left' : 'right', minWidth: 0 }}>{cell}</Box>)}
          </Box>
        ))}
      </Box>
    </Box>
  )
}

/** A seed per player, so a player's range does not move when the list around them changes. */
function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}
