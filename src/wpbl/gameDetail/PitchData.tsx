import { NameLine, NameText } from '../../ui/NameText'
import { Fragment, useCallback, useMemo } from 'react'
import { Box, Typography } from '@mui/material'
import { outsToIp } from '../constants'
import { canonicalFeedName } from '../feedNames'
import { useUnits } from '../../UnitsContext'
import { fmtSpeed, speedUnit } from '../../lib/units'
import { prettyType } from '../tracking'
import { typePx } from '../../ui/scale'
import type { WpblPlayer, WpblPitchTracking } from '../types'
import { fmtFeedName, StatHead, StatCell, EmptyBody, tableSx, nameHeadSx, nameCellSx, posSx } from './shared'
import { TYPE_SCALE } from '../../ui/card'

type BoxPitcher = { name: string; teamAbbr: string; outs: number; pitches: number | null }

const normName = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()

// Edit distance ≤ 1 (one insert / delete / substitute). Cheap boolean, no full matrix.
const within1 = (a: string, b: string): boolean => {
  if (a === b) return true
  const dl = a.length - b.length
  if (dl > 1 || dl < -1) return false
  let i = 0, j = 0, edits = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++ }
    else { if (++edits > 1) return false; if (a.length > b.length) i++; else if (a.length < b.length) j++; else { i++; j++ } }
  }
  return edits + (a.length - i) + (b.length - j) <= 1
}

// Tolerant same-pitcher check that bridges the box-score vs TrackMan spelling gap: the
// box says "Maggie Fox" while TrackMan says "Foxx, Maggie". Exact normalized match, or a
// surname within one edit plus given names that are equal / prefix / within one edit.
// Without this the two spellings look like two pitchers, which both hides one pitcher's
// velocity and breaks the single-candidate rescue for the genuinely-unnamed starter.
const samePitcher = (a: string, b: string): boolean => {
  a = normName(a); b = normName(b)
  if (a === b) return true
  const [af, ...ar] = a.split(' '); const al = ar.join(' ')
  const [bf, ...br] = b.split(' '); const bl = br.join(' ')
  if (!al || !bl) return false
  const firstOk = af === bf || af.startsWith(bf) || bf.startsWith(af) || within1(af, bf)
  return (al === bl || within1(al, bl)) && firstOk
}

type FirstHit = { batter: string | null; inning: number; half: string }

export function PitchData({ tracking, boxPitchers, firstHit = null, live = false, names }: { tracking: WpblPitchTracking[]; boxPitchers: BoxPitcher[]; firstHit?: FirstHit | null; live?: boolean; names: Map<string, WpblPlayer> }) {
  // The TrackMan payload spells names its own way ("Saki, Emi"). Every formatted name goes
  // through here first, so a misspelling cannot reach the standout strip or the pitch log raw:
  // the roster's spelling when it resolves uniquely, the feed's otherwise (see
  // canonicalFeedName / feedNames.ts).
  const canonName = useCallback((formatted: string | null): string | null =>
    formatted ? canonicalFeedName(formatted, names.values()) : formatted, [names])
  // Real game pitches only. The feed's "rest_reconciliation" warmup/bullpen rows carry a
  // velocity but no batter (nor pitcher / inning); they are not game pitches and must not
  // count toward the velo stats or be rescued onto a real pitcher. A pitch thrown to a
  // batter always names the batter, so require one.
  const pitches = useMemo(
    () => tracking.filter(t =>
      t.release_speed != null && (t.kind == null || t.kind === 'pitch') &&
      !!(t.raw as { batter_name?: string | null } | null)?.batter_name),
    [tracking],
  )
  // Game highlights for the standout summary strip: the single hardest pitch (attributed
  // below via labelFor) and the hardest batted ball (exit velocity lives in `raw`).
  const hardestPitch = useMemo(() => {
    let best: WpblPitchTracking | null = null
    for (const t of pitches) if (best == null || (t.release_speed ?? 0) > (best.release_speed ?? 0)) best = t
    return best
  }, [pitches])
  const hardestHit = useMemo(() => {
    let exit = 0
    let batter: string | null = null
    for (const t of tracking) {
      const raw = t.raw as { exit_speed?: number | string | null; batter_name?: string | null } | null
      const ev = raw?.exit_speed == null ? NaN : Number(raw.exit_speed)
      if (Number.isFinite(ev) && ev > exit) { exit = ev; batter = raw?.batter_name ? canonName(fmtFeedName(raw.batter_name)) : null }
    }
    return exit > 0 ? { exit, batter } : null
  }, [tracking, canonName])
  // Attribution: the tracking `play_id` is the FEED's play id (not our plays row), so we
  // can't join to wpbl_game_plays. The pitcher name lives in each event's raw payload
  // ("Last, First"); reconciliation events omit it, so fill from a sibling of the same
  // play_id. The remaining nameless pitches are almost always the starters the feed never
  // named (their whole outing is unnamed); see the single-candidate rescue below.
  const pitcherFor = useMemo(() => {
    const fmt = (n: string) => {
      const [last, first] = n.split(',').map(s => s.trim())
      return first ? `${first} ${last}` : n
    }
    const rawName = (t: WpblPitchTracking) => {
      const nm = (t.raw as { pitcher_name?: string | null } | null)?.pitcher_name
      return nm ? fmt(nm) : null
    }
    const byPlay = new Map<string, string>()
    for (const t of tracking) {
      const nm = rawName(t)
      if (t.play_id && nm && !byPlay.has(t.play_id)) byPlay.set(t.play_id, nm)
    }
    return (t: WpblPitchTracking) => canonName(rawName(t) ?? (t.play_id ? byPlay.get(t.play_id) : null) ?? null)
  }, [tracking, canonName])

  const avg = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null)
  const { units } = useUnits()
  const unit = speedUnit(units)

  // Per-pitch log: every tracked pitch that carries a velocity (including the one put in
  // play), newest first. Ordered by the feed's sequence, falling back to occurred_at.
  // Reads live because the tab reloads its tracking every 5s while the game is in progress,
  // so the newest pitch stays at the top. Capped at a "recent" window; the aggregates above
  // cover the whole game.
  const fmtName = (n?: string | null): string | null => {
    if (!n) return null
    const [last, first] = n.split(',').map(s => s.trim())
    return first ? `${first} ${last}` : n
  }
  const pitchLog = useMemo(() => {
    const withVelo = tracking.filter(t => t.release_speed != null && t.release_speed > 0 &&
      !!(t.raw as { batter_name?: string | null } | null)?.batter_name) // exclude warmup rows
    withVelo.sort((a, b) =>
      a.sequence != null && b.sequence != null
        ? b.sequence - a.sequence
        : (b.occurred_at ?? '').localeCompare(a.occurred_at ?? ''))
    return withVelo.slice(0, 24).map(t => {
      const raw = t.raw as { pitch_type?: string | null; batter_name?: string | null } | null
      return {
        id:      t.activity_id,
        velo:    t.release_speed!,
        spin:    t.spin_rate_rpm,
        type:    prettyType(raw?.pitch_type ?? null),
        batter:  canonName(fmtName(raw?.batter_name)),
        pitcher: pitcherFor(t),
        inPlay:  t.kind === 'hit',
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracking, pitcherFor, names])

  // Aggregate TrackMan velo/spin by attributed name, plus an "unattributed" bucket.
  // Then merge onto the box-score pitcher list (the authoritative who-pitched, with real
  // names + IP/P). If EXACTLY ONE box pitcher has no tracking, the whole unattributed
  // bucket must be theirs: attribute it (reliable). Otherwise leave it as a footnote.
  const { rows, resolvedName, unattributed, fastest } = useMemo(() => {
    type Agg = { count: number; speeds: number[]; spins: number[] }
    const blank = (): Agg => ({ count: 0, speeds: [], spins: [] })
    const add = (a: Agg, p: WpblPitchTracking) => {
      a.count++
      if (p.release_speed != null && p.release_speed > 0) a.speeds.push(p.release_speed)
      if (p.spin_rate_rpm != null && p.spin_rate_rpm > 0) a.spins.push(p.spin_rate_rpm)
    }
    const byName = new Map<string, Agg>()
    const unatt = blank()
    for (const p of pitches) {
      const nm = pitcherFor(p)
      if (nm) { const k = normName(nm); const e = byName.get(k) ?? blank(); add(e, p); byName.set(k, e) }
      else add(unatt, p)
    }
    // Match each box pitcher to its tracking aggregate, tolerating the box↔TrackMan
    // spelling gap (Fox/Foxx). Consume matched keys so two box pitchers can't both claim
    // the same tracking bucket.
    const consumed = new Set<string>()
    const aggFor = (name: string): Agg | null => {
      const exact = normName(name)
      if (byName.has(exact) && !consumed.has(exact)) { consumed.add(exact); return byName.get(exact)! }
      for (const [k, e] of byName) if (!consumed.has(k) && samePitcher(name, k)) { consumed.add(k); return e }
      return null
    }
    const prelim = boxPitchers.map(bp => ({ bp, agg: aggFor(bp.name) }))
    const missing = prelim.filter(x => x.agg == null).map(x => x.bp)
    const resolved = missing.length === 1 && unatt.count > 0 ? missing[0].name : null

    const rws = prelim.map(({ bp, agg }) => ({
      ...bp,
      agg: agg ?? (resolved && bp.name === resolved ? unatt : null),
    })).sort((a, b) => a.teamAbbr === b.teamAbbr ? b.outs - a.outs : a.teamAbbr.localeCompare(b.teamAbbr))

    const fast = [...pitches].sort((a, b) => (b.release_speed ?? 0) - (a.release_speed ?? 0)).slice(0, 8)
    return { rows: rws, resolvedName: resolved, unattributed: resolved ? 0 : unatt.count, fastest: fast }
  }, [pitches, pitcherFor, boxPitchers])

  const labelFor = (t: WpblPitchTracking) => pitcherFor(t) ?? resolvedName ?? 'Unattributed'

  if (pitches.length === 0) {
    return <EmptyBody title="No pitch tracking" />
  }
  const speeds = pitches.map(p => p.release_speed!).filter(v => v > 0)
  const spins = pitches.map(p => p.spin_rate_rpm).filter((v): v is number => v != null && v > 0)
  const tile = (label: string, value: string) => (
    <Box sx={{ textAlign: 'center', flex: 1, minWidth: '4.25rem' }}>
      <Typography sx={{ fontSize: TYPE_SCALE.display, fontWeight: 800, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>{value}</Typography>
      <Typography sx={{ fontSize: TYPE_SCALE.caption, fontWeight: 700, textTransform: 'uppercase', letterSpacing: typePx(0.4), color: 'text.disabled' }}>{label}</Typography>
    </Box>
  )
  const sectionLabel = (t: string) => (
    <Typography sx={{ fontSize: TYPE_SCALE.micro, fontWeight: 800, textTransform: 'uppercase', letterSpacing: typePx(1), color: 'text.secondary', mb: 1 }}>{t}</Typography>
  )
  // Standout game-highlights tile for the summary strip: bigger value + who did it.
  const hl = (emoji: string, label: string, value: string, sub: string, first: boolean, nameIn?: 'v' | 's') => (
    <Box sx={{ flex: 1, minWidth: 0, textAlign: 'center', px: 0.75, ...(first ? {} : { borderLeft: '1px solid', borderColor: 'divider' }) }}>
      {/* 700 under 9px: see the weight ceiling under TYPE_SCALE in ui.tsx. */}
      <Typography sx={{ fontSize: TYPE_SCALE.caption, fontWeight: 700, textTransform: 'uppercase', letterSpacing: typePx(0.4), color: 'text.disabled', whiteSpace: 'nowrap' }}>{emoji} {label}</Typography>
      {nameIn === 'v'
        ? <NameText name={value} sx={{ fontSize: TYPE_SCALE.heading, fontWeight: 800, lineHeight: 1.25 }} />
        : <Typography sx={{ fontSize: TYPE_SCALE.heading, fontWeight: 800, lineHeight: 1.25, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</Typography>}
      {nameIn === 's'
        ? <NameText name={sub} sx={{ fontSize: TYPE_SCALE.caption, color: 'text.secondary' }} />
        : <Typography sx={{ fontSize: TYPE_SCALE.caption, color: 'text.secondary', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</Typography>}
    </Box>
  )
  const highlights = [
    hardestPitch && { e: '⚡', l: 'Hardest pitch', v: `${fmtSpeed(hardestPitch.release_speed, units)} ${unit}`, s: labelFor(hardestPitch), n: 's' as const },
    hardestHit   && { e: '💥', l: 'Hardest hit',   v: `${fmtSpeed(hardestHit.exit, units)} ${unit}`,          s: hardestHit.batter ?? '—', n: hardestHit.batter ? 's' as const : undefined },
    firstHit     && { e: '🥇', l: 'First hit',      v: firstHit.batter ?? '—',     s: `${firstHit.half === 'top' ? 'Top' : 'Bot'} ${firstHit.inning}`, n: firstHit.batter ? 'v' as const : undefined },
  ].filter(Boolean) as { e: string; l: string; v: string; s: string; n?: 'v' | 's' }[]

  return (
    <Box sx={{ p: 2 }}>
      {/* Standout game highlights: the marquee of this game's TrackMan moments. */}
      {highlights.length > 0 && (
        <Box sx={{ display: 'flex', alignItems: 'stretch', mb: 2, py: 1.25, borderRadius: 2, border: '1px solid', borderColor: 'outline', bgcolor: 'action.hover' }}>
          {highlights.map((h, i) => <Fragment key={h.l}>{hl(h.e, h.l, h.v, h.s, i === 0, h.n)}</Fragment>)}
        </Box>
      )}
      <Box sx={{ display: 'flex', gap: 1.5, mb: 2.5, flexWrap: 'wrap' }}>
        {tile('Pitches', String(pitches.length))}
        {tile(`Avg ${unit}`, fmtSpeed(avg(speeds), units))}
        {tile(`Top ${unit}`, speeds.length ? fmtSpeed(Math.max(...speeds), units) : '—')}
        {tile('Avg spin', avg(spins) != null ? `${Math.round(avg(spins)!)}` : '—')}
      </Box>

      {/* Per-pitch log, newest first; live during the game, browsable after. */}
      {pitchLog.length > 0 && (
        <Box sx={{ mb: 2.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 1 }}>
            {live && (
              <Box sx={{
                width: 7, height: 7, borderRadius: '50%', bgcolor: '#ef4444', flexShrink: 0,
                animation: 'wpblpulse 1.5s ease-in-out infinite',
                '@keyframes wpblpulse': { '0%': { opacity: 1 }, '50%': { opacity: 0.3 }, '100%': { opacity: 1 } },
              }} />
            )}
            {sectionLabel(live ? 'Live pitches' : 'Recent pitches')}
          </Box>
          <Box>
            {pitchLog.map((p, i) => (
              <Box key={p.id} sx={{
                display: 'flex', alignItems: 'center', gap: 1.25, px: 0.75, py: 0.6,
                borderTop: i === 0 ? 'none' : '1px solid', borderColor: 'divider',
                borderRadius: 1, bgcolor: live && i === 0 ? 'action.hover' : 'transparent',
              }}>
                {/* Velocity + unit */}
                <Box sx={{ flexShrink: 0, width: '4rem', fontVariantNumeric: 'tabular-nums' }}>
                  <Typography component="span" sx={{ fontSize: TYPE_SCALE.heading, fontWeight: 800 }}>{fmtSpeed(p.velo, units)}</Typography>
                  <Typography component="span" sx={{ fontSize: TYPE_SCALE.caption, fontWeight: 700, color: 'text.disabled', ml: 0.3 }}>{unit}</Typography>
                </Box>
                {/* Pitch type chip */}
                <Box sx={{ flexShrink: 0, minWidth: '3.875rem' }}>
                  {p.type && (
                    <Box component="span" sx={{ px: 0.75, py: 0.15, borderRadius: 1, bgcolor: 'action.selected', fontSize: TYPE_SCALE.micro, fontWeight: 700, whiteSpace: 'nowrap' }}>
                      {p.type}
                    </Box>
                  )}
                </Box>
                {/* Batter faced (+ pitcher beneath) */}
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  {p.batter && (
                    <NameLine names={[p.batter]} sx={{ fontSize: TYPE_SCALE.body, fontWeight: 600 }} render={n => <>
                      <Box component="span" sx={{ color: 'text.disabled', fontWeight: 700 }}>vs </Box>{n(p.batter!)}
                      {p.inPlay && <Box component="span" sx={{ ml: 0.5, fontSize: TYPE_SCALE.caption, fontWeight: 800, color: 'text.disabled', textTransform: 'uppercase', letterSpacing: typePx(0.4) }}>in play</Box>}
                    </>} />
                  )}
                  {p.pitcher && (
                    <NameText name={p.pitcher} sx={{ fontSize: TYPE_SCALE.micro, color: 'text.disabled' }} />
                  )}
                </Box>
                {/* Spin */}
                <Box sx={{ flexShrink: 0, color: 'text.secondary', fontSize: TYPE_SCALE.meta, fontVariantNumeric: 'tabular-nums' }}>
                  {p.spin != null ? `${Math.round(p.spin)} rpm` : ''}
                </Box>
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {rows.length > 0 && (
        <>
          {sectionLabel('By pitcher')}
          <Box component="table" sx={{ ...tableSx, mb: unattributed > 0 ? 1 : 2.5 }}>
            <Box component="thead">
              <Box component="tr">
                <Box component="th" sx={nameHeadSx}>Pitcher</Box>
                <StatHead w={36}>IP</StatHead>
                <StatHead w={30}>P</StatHead>
                <StatHead w={40}>Avg</StatHead>
                <StatHead w={40}>Top</StatHead>
                <StatHead w={44}>Spin</StatHead>
              </Box>
            </Box>
            <Box component="tbody">
              {rows.map(r => {
                const a = r.agg
                return (
                  <Box component="tr" key={`${r.teamAbbr}-${r.name}`} sx={{ borderTop: '1px solid', borderColor: 'divider' }}>
                    <Box component="td" sx={{ ...nameCellSx, overflow: 'hidden' }}>
                      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5, overflow: 'hidden' }}>
                        <NameText name={r.name} component="span" sx={{ fontSize: TYPE_SCALE.body, fontWeight: 600 }} />
                        <Typography component="span" sx={{ ...posSx, textTransform: 'uppercase' }}>{r.teamAbbr}</Typography>
                      </Box>
                    </Box>
                    <StatCell>{outsToIp(r.outs)}</StatCell>
                    <StatCell>{r.pitches ?? '—'}</StatCell>
                    <StatCell>{a && avg(a.speeds) != null ? fmtSpeed(avg(a.speeds), units) : '—'}</StatCell>
                    <StatCell bold>{a && a.speeds.length ? fmtSpeed(Math.max(...a.speeds), units) : '—'}</StatCell>
                    <StatCell>{a && avg(a.spins) != null ? Math.round(avg(a.spins)!) : '—'}</StatCell>
                  </Box>
                )
              })}
            </Box>
          </Box>
          {unattributed > 0 && (
            <Typography sx={{ fontSize: TYPE_SCALE.micro, color: 'text.disabled', mb: 2.5 }}>
              Avg / Top / Spin come from TrackMan. {unattributed} tracked pitches (the feed left them unnamed, usually a starter) couldn't be matched to a pitcher.
            </Typography>
          )}
        </>
      )}

      {sectionLabel(`Hardest thrown (${unit})`)}
      <Box sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {fastest.map((p, i) => (
          <Box key={p.activity_id} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 0.55, borderTop: i === 0 ? 'none' : '1px solid', borderColor: 'divider', fontSize: TYPE_SCALE.body }}>
            <Box sx={{ width: '1.125rem', color: 'text.disabled', fontSize: TYPE_SCALE.meta, flexShrink: 0 }}>{i + 1}</Box>
            <Box sx={{ width: '3.25rem', fontWeight: 800, flexShrink: 0 }}>{fmtSpeed(p.release_speed, units)}</Box>
            <NameText name={labelFor(p)} sx={{ flex: 1, minWidth: 0, fontSize: 'inherit', fontWeight: 600 }} />
            <Box sx={{ color: 'text.secondary', fontSize: TYPE_SCALE.meta, flexShrink: 0 }}>{p.spin_rate_rpm != null ? `${Math.round(p.spin_rate_rpm)} rpm` : ''}</Box>
          </Box>
        ))}
      </Box>
      <Typography sx={{ fontSize: TYPE_SCALE.micro, color: 'text.disabled', mt: 2 }}>
        {tracking.length} tracked events · TrackMan
      </Typography>
    </Box>
  )
}
