import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Typography, CircularProgress, useMediaQuery } from '@mui/material'
import { supabase } from '../lib/supabase'
import { fetchWpblRoster, fetchWpblGameLines, fetchWpblGamePlays, fetchWpblGameTracking, fetchWpblVideos, getCachedWpblVideos } from './api'
import { wpblAccent, wpblFullName, outsToIp, formatGameTime } from './constants'
import { LiveBanner, useLiveGame } from './Live'
import { WpblGamePreview } from './GamePreview'
import { GameHighlightCard } from './Highlights'
import { useIsAdmin } from '../lib/admin'
import { ModalShell, SegNav, TeamBadge, useWpblDark, useWpblName } from './ui'
import { useUnits } from '../UnitsContext'
import { fmtSpeed, speedUnit } from '../lib/units'
import { prettyType } from './tracking'
import type {
  WpblTeam, WpblGame, WpblPlayer, WpblBattingLine, WpblPitchingLine,
  WpblGamePlay, WpblPitchTracking, WpblVideo,
} from './types'

// Read-only game center. Fed entirely by the official-feed mirror (see wpbl-ingest):
// line score, a tabbed box score (batting / pitching, one team at a time), the
// play-by-play, and TrackMan pitch tracking. Player names open the player page. For an
// unplayed game it shows the matchup + first-pitch time.

type Tab = 'box' | 'plays' | 'pitch'

// ─── Box-score column sets ─────────────────────────────────────────────────────
// Column order is importance-first: the classic box line (AB R H RBI BB SO) leads,
// then HR, then the situational extras (2B SB). On a phone the `xsHide` columns drop
// out so the batting line fits the width instead of scrolling off-screen; desktop
// shows the full set. See BAT_COLS filtering in TeamBox.
const BAT_COLS: { key: keyof WpblBattingLine; label: string; xsHide?: boolean }[] = [
  { key: 'ab', label: 'AB' }, { key: 'r', label: 'R' }, { key: 'h', label: 'H' },
  { key: 'rbi', label: 'RBI' }, { key: 'bb', label: 'BB' }, { key: 'so', label: 'SO' },
  { key: 'hr', label: 'HR' },
  { key: 'doubles', label: '2B', xsHide: true }, { key: 'sb', label: 'SB', xsHide: true },
]
const PIT_COLS: { key: keyof WpblPitchingLine; label: string }[] = [
  { key: 'h', label: 'H' }, { key: 'r', label: 'R' }, { key: 'er', label: 'ER' },
  { key: 'bb', label: 'BB' }, { key: 'so', label: 'SO' }, { key: 'hr', label: 'HR' },
  { key: 'pitches', label: 'P' },
]

// ─── Batting-line helpers (filter non-hitting pitchers, flag substitutes) ───────
// Positions arrive lowercase from the feed. A pure pitcher never bats in this league's
// DH games, so an all-zero "p" row is just clutter — drop it. Two-way players carry a
// combo position ("lf/p", "p/cf") and DID bat, so they are not pure pitchers and stay.
const PURE_PITCHER = new Set(['p', 'sp', 'rp', 'lhp', 'rhp'])
const isPurePitcher = (pos: string | null): boolean => !!pos && PURE_PITCHER.has(pos.toLowerCase())
const isPinchRole = (pos: string | null): boolean => { const p = pos?.toLowerCase(); return p === 'ph' || p === 'pr' }
const plateApps = (b: WpblBattingLine): number => b.ab + b.bb + b.hbp + b.sf + b.sh
// Did this batter come to the plate or reach the bases at all? A pinch runner who scored
// has no plate appearance but does have a run, so check baserunning too — otherwise we'd
// wrongly drop them.
const cameToBat = (b: WpblBattingLine): boolean => plateApps(b) > 0 || b.r > 0 || b.rbi > 0 || b.sb > 0 || b.cs > 0

// The batting rows to show, non-hitting pitchers removed, ordered by lineup slot with each
// slot's starter first and its substitutes (pinch hitters/runners, defensive replacements
// sharing the slot) following, flagged so the table can indent and mark them.
function buildBattingRows(batting: WpblBattingLine[]): { b: WpblBattingLine; isSub: boolean }[] {
  const shown = batting.filter(b => cameToBat(b) || !isPurePitcher(b.position))
  const bySlot = new Map<number, WpblBattingLine[]>()
  const noSlot: WpblBattingLine[] = []
  for (const b of shown) {
    if (b.batting_order == null) noSlot.push(b)
    else { const a = bySlot.get(b.batting_order) ?? []; a.push(b); bySlot.set(b.batting_order, a) }
  }
  const out: { b: WpblBattingLine; isSub: boolean }[] = []
  for (const slot of [...bySlot.keys()].sort((a, b) => a - b)) {
    // Starter leads the slot: a non-pinch role with the most plate appearances; the rest
    // (and any pinch role) are substitutes.
    const arr = bySlot.get(slot)!.slice().sort((x, y) =>
      Number(isPinchRole(x.position)) - Number(isPinchRole(y.position)) || plateApps(y) - plateApps(x))
    arr.forEach((b, i) => out.push({ b, isSub: i > 0 || isPinchRole(b.position) }))
  }
  for (const b of noSlot) out.push({ b, isSub: isPinchRole(b.position) })
  return out
}

// The feed spells names "Last, First"; flip to "First Last" for display.
const fmtFeedName = (n: string): string => {
  const [last, first] = n.split(',').map(s => s.trim())
  return first ? `${first} ${last}` : n
}

// ─── Table primitives (real <table> = auto-aligned columns that fill the width) ──
// Stat columns carry no fixed width, so with a shrink-to-fit name column they split
// the remaining width evenly and spread across the middle instead of hugging the edge.
function StatHead({ children, w = 30 }: { children: React.ReactNode; w?: number }) {
  return (
    <Box component="th" sx={{
      fontSize: '0.64rem', fontWeight: 700, color: 'text.disabled',
      textTransform: 'uppercase', letterSpacing: 0.4,
      textAlign: 'center', px: 0.4, py: 0.4, minWidth: w,
    }}>
      {children}
    </Box>
  )
}
function StatCell({ children, bold = false }: { children: React.ReactNode; bold?: boolean }) {
  return (
    <Box component="td" sx={{
      fontSize: '0.9rem', fontWeight: bold ? 800 : 600, color: 'text.primary',
      textAlign: 'center', px: 0.4, py: 0.45, lineHeight: 1.2, fontVariantNumeric: 'tabular-nums',
    }}>
      {children}
    </Box>
  )
}

// ─── Scoreboard (team headline + line score in one) ─────────────────────────────
// One compact block instead of a tall full-name score header stacked on a separate line
// score that repeated the same teams and totals. The team name/logo lead each row; the R
// column IS the final/running score (large + winner-emphasised), so no vertical space is
// spent restating it. Team column shows the full "City Nickname" on desktop, the nickname
// alone on a phone, and the innings + R/H/E scroll horizontally if they overrun the width.
function Scoreboard({ away, home, game, awayWon, homeWon }: {
  away: WpblTeam; home: WpblTeam; game: WpblGame; awayWon: boolean; homeWon: boolean
}) {
  const isMobile = useMediaQuery('(max-width:600px)')
  const decided = awayWon || homeWon
  const innings = Math.max(game.away_line?.length ?? 0, game.home_line?.length ?? 0, 7)
  const cols = Array.from({ length: innings }, (_, i) => i + 1)
  const runsByInning = (line: WpblGame['away_line'], n: number) =>
    line?.find(c => c.inning === n)?.runs
  const row = (team: WpblTeam, line: WpblGame['away_line'], runs: number | null, hits: number | null | undefined, errs: number | null | undefined, won: boolean) => (
    <Box component="tr" sx={{ borderTop: '1px solid', borderColor: 'divider' }}>
      <Box component="td" sx={{ py: 0.5, pr: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
          <TeamBadge team={team} size={24} />
          <Typography sx={{ fontSize: isMobile ? '0.86rem' : '0.95rem', fontWeight: won ? 800 : 600, lineHeight: 1.15, whiteSpace: 'nowrap' }}>
            {isMobile ? team.name : wpblFullName(team)}
          </Typography>
        </Box>
      </Box>
      {cols.map(n => { const r = runsByInning(line, n); return <StatCell key={n}>{r == null ? '' : r}</StatCell> })}
      <Box component="td" sx={{ width: 8 }} />
      <Box component="td" sx={{ textAlign: 'center', px: 0.4, py: 0.5 }}>
        <Typography sx={{ fontSize: '1.05rem', fontWeight: 800, lineHeight: 1.2, fontVariantNumeric: 'tabular-nums', color: won || !decided ? 'text.primary' : 'text.secondary' }}>{runs ?? 0}</Typography>
      </Box>
      <StatCell>{hits ?? 0}</StatCell>
      <StatCell>{errs ?? 0}</StatCell>
    </Box>
  )
  return (
    <Box sx={{ overflowX: 'auto', px: 2, pt: 1 }}>
      <Box component="table" sx={scoreTableSx}>
        <Box component="thead">
          <Box component="tr">
            <Box component="th" />
            {cols.map(n => <StatHead key={n} w={18}>{n}</StatHead>)}
            <Box component="th" sx={{ width: 8 }} />
            <StatHead w={24}>R</StatHead>
            <StatHead w={22}>H</StatHead>
            <StatHead w={22}>E</StatHead>
          </Box>
        </Box>
        <Box component="tbody">
          {row(away, game.away_line, game.away_score, game.away_hits, game.away_errors, awayWon)}
          {row(home, game.home_line, game.home_score, game.home_hits, game.home_errors, homeWon)}
        </Box>
      </Box>
    </Box>
  )
}

// ─── One team's box score (batting + pitching) ─────────────────────────────────
function TeamBox({ team, batting, pitching, names, onOpenPlayer }: {
  team: WpblTeam
  batting: WpblBattingLine[]
  pitching: WpblPitchingLine[]
  names: Map<string, WpblPlayer>
  onOpenPlayer?: (p: WpblPlayer) => void
}) {
  const isDark = useWpblDark()
  const isMobile = useMediaQuery('(max-width:600px)')
  const color = wpblAccent(team.id, isDark)
  const shortName = useWpblName()
  // On a phone, drop the situational extras (2B/SB) so the box line fits without a
  // sideways scroll; desktop keeps the full column set.
  const batCols = isMobile ? BAT_COLS.filter(c => !c.xsHide) : BAT_COLS
  // A substitute's name is indented under its starter and led by a ↳ marker.
  const nameCell = (playerId: string, suffix?: React.ReactNode, isSub = false) => {
    const p = names.get(playerId)
    const clickable = p && onOpenPlayer
    return (
      <Box component="td" sx={{ ...nameCellSx, pl: isSub ? 1.75 : 0.4 }}>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5, overflow: 'hidden' }}>
          {isSub && <Box component="span" aria-hidden sx={{ color: 'text.disabled', fontSize: '0.72rem', flexShrink: 0, lineHeight: 1 }}>↳</Box>}
          <Typography
            component="span"
            onClick={clickable ? () => onOpenPlayer!(p!) : undefined}
            sx={{ fontSize: '0.86rem', fontWeight: 600, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', ...(clickable ? { cursor: 'pointer', '&:hover': { color } } : {}) }}
          >
            {p ? shortName(p.name) : '—'}
          </Typography>
          {suffix}
        </Box>
      </Box>
    )
  }
  // Non-hitting pitchers dropped, subs ordered under their starter (see buildBattingRows).
  const battingRows = buildBattingRows(batting)
  const batTotals = battingRows.reduce((t, { b }) => {
    for (const c of batCols) (t as any)[c.key] = ((t as any)[c.key] ?? 0) + (Number(b[c.key]) || 0)
    return t
  }, {} as Record<string, number>)

  if (battingRows.length === 0 && pitching.length === 0) return null

  return (
    <Box>
      {battingRows.length > 0 && (
        <Box sx={{ overflowX: 'auto', mb: 1.5 }}>
          <Box component="table" sx={tableSx}>
            <Box component="thead">
              <Box component="tr">
                <Box component="th" sx={nameHeadSx}>Batting</Box>
                {batCols.map(c => <StatHead key={c.key as string}>{c.label}</StatHead>)}
              </Box>
            </Box>
            <Box component="tbody">
              {battingRows.map(({ b, isSub }) => (
                <Box component="tr" key={b.id} sx={{ borderTop: '1px solid', borderColor: 'divider' }}>
                  {nameCell(b.player_id, b.position ? <Typography component="span" sx={{ ...posSx, textTransform: 'uppercase' }}>{b.position}</Typography> : null, isSub)}
                  {batCols.map(c => <StatCell key={c.key as string} bold={c.key === 'h'}>{Number(b[c.key]) || 0}</StatCell>)}
                </Box>
              ))}
              <Box component="tr" sx={{ borderTop: '2px solid', borderColor: color }}>
                <Box component="td" sx={{ ...nameHeadSx, color: 'text.secondary', fontSize: '0.8rem', fontWeight: 800, textTransform: 'none', letterSpacing: 0 }}>Totals</Box>
                {batCols.map(c => <StatCell key={c.key as string} bold>{batTotals[c.key as string] ?? 0}</StatCell>)}
              </Box>
            </Box>
          </Box>
        </Box>
      )}

      {pitching.length > 0 && (
        <Box sx={{ overflowX: 'auto' }}>
          <Box component="table" sx={tableSx}>
            <Box component="thead">
              <Box component="tr">
                <Box component="th" sx={nameHeadSx}>Pitching</Box>
                <StatHead w={32}>IP</StatHead>
                {PIT_COLS.map(c => <StatHead key={c.key as string}>{c.label}</StatHead>)}
              </Box>
            </Box>
            <Box component="tbody">
              {pitching.map(p => (
                <Box component="tr" key={p.id} sx={{ borderTop: '1px solid', borderColor: 'divider' }}>
                  {nameCell(p.player_id, p.decision ? <Typography component="span" sx={{ fontSize: '0.56rem', fontWeight: 800, color, lineHeight: 1 }}>({p.decision})</Typography> : null)}
                  <StatCell bold>{outsToIp(p.outs)}</StatCell>
                  {PIT_COLS.map(c => <StatCell key={c.key as string}>{p[c.key] == null ? '—' : Number(p[c.key])}</StatCell>)}
                </Box>
              ))}
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  )
}

// ─── Play-by-play ──────────────────────────────────────────────────────────────
function PlayByPlay({ plays, teams }: { plays: WpblGamePlay[]; teams: Map<string, WpblTeam> }) {
  // Group consecutive plays into half-innings, in order.
  const groups = useMemo(() => {
    const gs: { key: string; label: string; teamId: string | null; runs: number; plays: WpblGamePlay[] }[] = []
    for (const p of plays) {
      const key = `${p.inning}-${p.half}`
      const last = gs[gs.length - 1]
      if (!last || last.key !== key) {
        const half = p.half === 'top' ? 'Top' : 'Bottom'
        const ord = p.inning === 1 ? '1st' : p.inning === 2 ? '2nd' : p.inning === 3 ? '3rd' : `${p.inning}th`
        gs.push({ key, label: `${half} ${ord}`, teamId: p.team_id, runs: p.runs_scored, plays: [p] })
      } else { last.plays.push(p); last.runs += p.runs_scored }
    }
    return gs
  }, [plays])

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const toggle = (key: string) => setCollapsed(prev => {
    const next = new Set(prev)
    next.has(key) ? next.delete(key) : next.add(key)
    return next
  })

  if (plays.length === 0) {
    return <EmptyBody title="No play-by-play yet" hint="The feed's play log appears here once the game begins." />
  }
  return (
    <Box sx={{ p: 2 }}>
      {groups.map(g => {
        const team = g.teamId ? teams.get(g.teamId) : undefined
        const open = !collapsed.has(g.key)
        return (
          <Box key={g.key} sx={{ mb: 1.25 }}>
            <Box
              onClick={() => toggle(g.key)}
              sx={{
                display: 'flex', alignItems: 'center', gap: 0.75, cursor: 'pointer',
                position: 'sticky', top: 0, bgcolor: 'background.paper', py: 0.5, zIndex: 1,
                borderBottom: '1px solid', borderColor: 'divider',
                '&:hover .pbpChevron': { color: 'text.secondary' },
              }}
            >
              <Box className="pbpChevron" sx={{
                fontSize: '0.6rem', color: 'text.disabled', width: 12, flexShrink: 0,
                transition: 'transform 0.15s', transform: open ? 'rotate(90deg)' : 'none',
              }}>▶</Box>
              {team && <TeamBadge team={team} size={18} />}
              <Typography sx={{ fontSize: '0.68rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: 'text.secondary' }}>
                {g.label}{team ? ` · ${team.abbr} batting` : ''}
              </Typography>
              {g.runs > 0 && (
                <Box component="span" sx={{ ml: 'auto', fontSize: '0.62rem', fontWeight: 800, color: '#16a34a' }}>
                  {g.runs} {g.runs === 1 ? 'run' : 'runs'}
                </Box>
              )}
            </Box>
            {open && (
              <Box sx={{ mt: 0.75 }}>
                {g.plays.map((p, i) => (
                  <Box key={i} sx={{
                    display: 'flex', gap: 1, py: 0.5, pl: 1, borderLeft: '2px solid',
                    borderColor: p.is_scoring_play ? '#22c55e' : 'divider',
                    bgcolor: p.is_scoring_play ? 'rgba(34,197,94,0.06)' : 'transparent',
                  }}>
                    <Typography sx={{ flex: 1, fontSize: '0.82rem', lineHeight: 1.35 }}>
                      {p.narrative}
                      {p.runs_scored > 0 && (
                        <Box component="span" sx={{ ml: 0.5, fontSize: '0.66rem', fontWeight: 800, color: '#16a34a' }}>
                          +{p.runs_scored}
                        </Box>
                      )}
                    </Typography>
                    {p.pitch_sequence && (
                      <Typography sx={{ fontSize: '0.66rem', color: 'text.disabled', fontFamily: 'monospace', flexShrink: 0, mt: '2px' }}>
                        {p.pitch_sequence}
                      </Typography>
                    )}
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        )
      })}
    </Box>
  )
}

// ─── Pitch data (TrackMan) ─────────────────────────────────────────────────────
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
// Tolerant same-pitcher check that bridges the box-score vs TrackMan spelling gap — the
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
function PitchData({ tracking, boxPitchers, firstHit = null, live = false }: { tracking: WpblPitchTracking[]; boxPitchers: BoxPitcher[]; firstHit?: FirstHit | null; live?: boolean }) {
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
      if (Number.isFinite(ev) && ev > exit) { exit = ev; batter = raw?.batter_name ? fmtFeedName(raw.batter_name) : null }
    }
    return exit > 0 ? { exit, batter } : null
  }, [tracking])
  // Attribution: the tracking `play_id` is the FEED's play id (not our plays row), so we
  // can't join to wpbl_game_plays. The pitcher name lives in each event's raw payload
  // ("Last, First"); reconciliation events omit it, so fill from a sibling of the same
  // play_id. The remaining nameless pitches are almost always the starters the feed never
  // named (their whole outing is unnamed) — see the single-candidate rescue below.
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
    return (t: WpblPitchTracking) => rawName(t) ?? (t.play_id ? byPlay.get(t.play_id) : null) ?? null
  }, [tracking])

  const avg = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null)
  const { units } = useUnits()
  const unit = speedUnit(units)
  const shortName = useWpblName()

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
        batter:  fmtName(raw?.batter_name),
        pitcher: pitcherFor(t),
        inPlay:  t.kind === 'hit',
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracking, pitcherFor])

  // Aggregate TrackMan velo/spin by attributed name, plus an "unattributed" bucket.
  // Then merge onto the box-score pitcher list (the authoritative who-pitched, with real
  // names + IP/P). If EXACTLY ONE box pitcher has no tracking, the whole unattributed
  // bucket must be theirs — attribute it (reliable). Otherwise leave it as a footnote.
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
    return <EmptyBody title="No pitch tracking" hint="TrackMan velocity & spin data appears here when available." />
  }
  const speeds = pitches.map(p => p.release_speed!).filter(v => v > 0)
  const spins = pitches.map(p => p.spin_rate_rpm).filter((v): v is number => v != null && v > 0)
  const tile = (label: string, value: string) => (
    <Box sx={{ textAlign: 'center', flex: 1, minWidth: 68 }}>
      <Typography sx={{ fontSize: '1.15rem', fontWeight: 800, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>{value}</Typography>
      <Typography sx={{ fontSize: '0.58rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'text.disabled' }}>{label}</Typography>
    </Box>
  )
  const sectionLabel = (t: string) => (
    <Typography sx={{ fontSize: '0.68rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: 'text.secondary', mb: 1 }}>{t}</Typography>
  )
  // Standout game-highlights tile for the summary strip: bigger value + who did it.
  const hl = (emoji: string, label: string, value: string, sub: string, first: boolean) => (
    <Box sx={{ flex: 1, minWidth: 0, textAlign: 'center', px: 0.75, ...(first ? {} : { borderLeft: '1px solid', borderColor: 'divider' }) }}>
      <Typography sx={{ fontSize: '0.55rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.4, color: 'text.disabled', whiteSpace: 'nowrap' }}>{emoji} {label}</Typography>
      <Typography sx={{ fontSize: '1.05rem', fontWeight: 800, lineHeight: 1.25, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</Typography>
      <Typography sx={{ fontSize: '0.62rem', color: 'text.secondary', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</Typography>
    </Box>
  )
  const highlights = [
    hardestPitch && { e: '⚡', l: 'Hardest pitch', v: `${fmtSpeed(hardestPitch.release_speed, units)} ${unit}`, s: shortName(labelFor(hardestPitch)) },
    hardestHit   && { e: '💥', l: 'Hardest hit',   v: `${fmtSpeed(hardestHit.exit, units)} ${unit}`,          s: hardestHit.batter ? shortName(hardestHit.batter) : '—' },
    firstHit     && { e: '🥇', l: 'First hit',      v: firstHit.batter ? shortName(firstHit.batter) : '—',     s: `${firstHit.half === 'top' ? 'Top' : 'Bot'} ${firstHit.inning}` },
  ].filter(Boolean) as { e: string; l: string; v: string; s: string }[]

  return (
    <Box sx={{ p: 2 }}>
      {/* Standout game highlights — the marquee of this game's TrackMan moments. */}
      {highlights.length > 0 && (
        <Box sx={{ display: 'flex', alignItems: 'stretch', mb: 2, py: 1.25, borderRadius: 2, border: '1px solid', borderColor: 'divider', bgcolor: 'action.hover' }}>
          {highlights.map((h, i) => hl(h.e, h.l, h.v, h.s, i === 0))}
        </Box>
      )}
      <Box sx={{ display: 'flex', gap: 1.5, mb: 2.5, flexWrap: 'wrap' }}>
        {tile('Pitches', String(pitches.length))}
        {tile(`Avg ${unit}`, fmtSpeed(avg(speeds), units))}
        {tile(`Top ${unit}`, speeds.length ? fmtSpeed(Math.max(...speeds), units) : '—')}
        {tile('Avg spin', avg(spins) != null ? `${Math.round(avg(spins)!)}` : '—')}
      </Box>

      {/* Per-pitch log — newest first; live during the game, browsable after. */}
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
                <Box sx={{ flexShrink: 0, width: 64, fontVariantNumeric: 'tabular-nums' }}>
                  <Typography component="span" sx={{ fontSize: '1rem', fontWeight: 800 }}>{fmtSpeed(p.velo, units)}</Typography>
                  <Typography component="span" sx={{ fontSize: '0.56rem', fontWeight: 700, color: 'text.disabled', ml: 0.3 }}>{unit}</Typography>
                </Box>
                {/* Pitch type chip */}
                <Box sx={{ flexShrink: 0, minWidth: 62 }}>
                  {p.type && (
                    <Box component="span" sx={{ px: 0.75, py: 0.15, borderRadius: 1, bgcolor: 'action.selected', fontSize: '0.64rem', fontWeight: 700, whiteSpace: 'nowrap' }}>
                      {p.type}
                    </Box>
                  )}
                </Box>
                {/* Batter faced (+ pitcher beneath) */}
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  {p.batter && (
                    <Typography sx={{ fontSize: '0.78rem', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      <Box component="span" sx={{ color: 'text.disabled', fontWeight: 700 }}>vs </Box>{shortName(p.batter)}
                      {p.inPlay && <Box component="span" sx={{ ml: 0.5, fontSize: '0.58rem', fontWeight: 800, color: 'text.disabled', textTransform: 'uppercase', letterSpacing: 0.4 }}>in play</Box>}
                    </Typography>
                  )}
                  {p.pitcher && (
                    <Typography sx={{ fontSize: '0.64rem', color: 'text.disabled', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{shortName(p.pitcher)}</Typography>
                  )}
                </Box>
                {/* Spin */}
                <Box sx={{ flexShrink: 0, color: 'text.secondary', fontSize: '0.72rem', fontVariantNumeric: 'tabular-nums' }}>
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
                        <Typography component="span" sx={{ fontSize: '0.86rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shortName(r.name)}</Typography>
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
            <Typography sx={{ fontSize: '0.66rem', color: 'text.disabled', mb: 2.5 }}>
              Avg / Top / Spin come from TrackMan. {unattributed} tracked pitches (the feed left them unnamed — usually a starter) couldn't be matched to a pitcher.
            </Typography>
          )}
        </>
      )}

      {sectionLabel(`Hardest thrown (${unit})`)}
      <Box sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {fastest.map((p, i) => (
          <Box key={p.activity_id} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 0.55, borderTop: i === 0 ? 'none' : '1px solid', borderColor: 'divider', fontSize: '0.82rem' }}>
            <Box sx={{ width: 18, color: 'text.disabled', fontSize: '0.72rem', flexShrink: 0 }}>{i + 1}</Box>
            <Box sx={{ width: 52, fontWeight: 800, flexShrink: 0 }}>{fmtSpeed(p.release_speed, units)}</Box>
            <Box sx={{ flex: 1, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shortName(labelFor(p))}</Box>
            <Box sx={{ color: 'text.secondary', fontSize: '0.75rem', flexShrink: 0 }}>{p.spin_rate_rpm != null ? `${Math.round(p.spin_rate_rpm)} rpm` : ''}</Box>
          </Box>
        ))}
      </Box>
      <Typography sx={{ fontSize: '0.66rem', color: 'text.disabled', mt: 2 }}>
        {tracking.length} tracked events · TrackMan
      </Typography>
    </Box>
  )
}

function EmptyBody({ title, hint }: { title: string; hint: string }) {
  return (
    <Box sx={{ textAlign: 'center', py: 5, px: 2, color: 'text.secondary' }}>
      <Typography sx={{ fontSize: '0.95rem', fontWeight: 700, mb: 0.5 }}>{title}</Typography>
      <Typography sx={{ fontSize: '0.82rem', color: 'text.disabled' }}>{hint}</Typography>
    </Box>
  )
}

// ─── Team switch (underline tabs — deliberately distinct from the pill SegNav) ──
function TeamSwitch({ away, home, value, onChange }: {
  away: WpblTeam; home: WpblTeam
  value: 'away' | 'home'; onChange: (v: 'away' | 'home') => void
}) {
  const isDark = useWpblDark()
  const isMobile = useMediaQuery('(max-width:600px)')
  const tab = (side: 'away' | 'home', team: WpblTeam) => {
    const active = value === side
    const color = wpblAccent(team.id, isDark)
    return (
      <Box
        onClick={() => onChange(side)}
        sx={{
          display: 'flex', alignItems: 'center', gap: 0.75, cursor: 'pointer',
          px: 0.25, pb: 0.75, mb: '-1px', borderBottom: '2px solid',
          borderColor: active ? color : 'transparent',
          opacity: active ? 1 : 0.5, transition: 'opacity 0.15s',
          '&:hover': { opacity: active ? 1 : 0.8 },
        }}
      >
        <TeamBadge team={team} size={isMobile ? 22 : 24} />
        {/* Nickname only on a phone (e.g. "Heights") so the two tabs sit on one line
            instead of wrapping "New York / Heights"; full "City Nickname" on desktop. */}
        <Typography sx={{ fontSize: isMobile ? '0.9rem' : '0.94rem', fontWeight: active ? 800 : 600, whiteSpace: 'nowrap' }}>
          {isMobile ? team.name : wpblFullName(team)}
        </Typography>
      </Box>
    )
  }
  return (
    <Box sx={{ display: 'flex', gap: { xs: 2.5, sm: 3 }, borderBottom: '1px solid', borderColor: 'divider', mb: 0.75 }}>
      {tab('away', away)}
      {tab('home', home)}
    </Box>
  )
}

// ─── Modal root ────────────────────────────────────────────────────────────────
export default function GameDetailModal({ game: seed, teams, games = [], onClose, onOpenPlayer }: {
  game: WpblGame
  teams: WpblTeam[]
  games?: WpblGame[]
  onClose: () => void
  onOpenPlayer?: (p: WpblPlayer) => void
}) {
  const game = useLiveGame(seed)  // fresh score + live_state while the game is live
  const isAdmin = useIsAdmin()    // highlights recap is admin-only during soft launch
  const byId = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])
  const home = byId.get(game.home_team_id)
  const away = byId.get(game.away_team_id)

  const gcUid = useRef(Math.random().toString(36).slice(2)).current
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('box')
  const [boxTeam, setBoxTeam] = useState<'away' | 'home'>('away')
  const [lines, setLines] = useState<{ batting: WpblBattingLine[]; pitching: WpblPitchingLine[] }>({ batting: [], pitching: [] })
  const [plays, setPlays] = useState<WpblGamePlay[]>([])
  const [tracking, setTracking] = useState<WpblPitchTracking[]>([])
  const [names, setNames] = useState<Map<string, WpblPlayer>>(new Map())
  // The recap video for this game, if the league has published one. Read from the shared
  // wpbl_videos cache (a tiny table, fetched once app-wide), matched on game_id.
  const [video, setVideo] = useState<WpblVideo | null>(() =>
    getCachedWpblVideos()?.find(v => v.game_id === seed.id) ?? null)

  const reload = useCallback((withSpinner = false) => {
    if (withSpinner) setLoading(true)
    let cancelled = false
    Promise.all([
      away ? fetchWpblRoster(away.id) : Promise.resolve([]),
      home ? fetchWpblRoster(home.id) : Promise.resolve([]),
      fetchWpblGameLines(seed.id),
      fetchWpblGamePlays(seed.id),
      fetchWpblGameTracking(seed.id),
    ]).then(([a, h, l, pl, tr]) => {
      if (cancelled) return
      setNames(new Map([...a, ...h].map(p => [p.id, p])))
      setLines({ batting: l.batting, pitching: l.pitching }); setPlays(pl); setTracking(tr)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [seed.id, away?.id, home?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => reload(true), [reload])

  // Resolve this game's recap video. Cheap shared read (deduped + cached by the api layer);
  // revalidates in the background so a recap that lands after the game repaints on next open.
  useEffect(() => {
    if (!isAdmin) return
    let cancelled = false
    fetchWpblVideos()
      .then(vs => { if (!cancelled) setVideo(vs.find(v => v.game_id === seed.id) ?? null) })
      .catch(() => { /* keep last-good */ })
    return () => { cancelled = true }
  }, [seed.id, isAdmin])

  // While the game is live, keep the box score + play-by-play fresh (poll + realtime).
  useEffect(() => {
    if (game.status !== 'live') return
    const poll = setInterval(() => reload(false), 5000)
    const ch = supabase.channel(`wpbl-gc-${seed.id}-${gcUid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wpbl_game_plays', filter: `game_id=eq.${seed.id}` }, () => reload(false))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wpbl_batting_lines', filter: `game_id=eq.${seed.id}` }, () => reload(false))
      .subscribe()
    return () => { clearInterval(poll); supabase.removeChannel(ch) }
  }, [game.status, seed.id, reload])

  const final = game.status === 'final' && game.home_score != null && game.away_score != null
  const live = game.status === 'live'
  const hasLines = lines.batting.length > 0 || lines.pitching.length > 0
  const awayWon = final && (game.away_score ?? 0) > (game.home_score ?? 0)
  const homeWon = final && (game.home_score ?? 0) > (game.away_score ?? 0)
  const dateLabel = new Date(`${game.game_date}T00:00:00`).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
  const showScore = final || live

  const scoreLine = (team: WpblTeam | undefined, score: number | null, won: boolean) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      {team && <TeamBadge team={team} size={30} />}
      <Typography sx={{ flex: 1, fontSize: '1rem', fontWeight: won ? 800 : 600 }}>{team ? wpblFullName(team) : ''}</Typography>
      {showScore && <Typography sx={{ fontSize: '1.25rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: won ? 'text.primary' : 'text.secondary' }}>{score ?? 0}</Typography>}
    </Box>
  )

  const tabs = [
    { value: 'box' as Tab, label: 'Box Score' },
    { value: 'plays' as Tab, label: 'Play-by-Play' },
    // Show Pitch Data for any played game — if the feed hasn't posted TrackMan for it, the
    // tab shows an explicit empty state rather than silently vanishing (feed tracking often
    // lands after a game goes final; the ingest backfills it, this surfaces the gap meanwhile).
    ...(showScore || tracking.length > 0 ? [{ value: 'pitch' as Tab, label: 'Pitch Data' }] : []),
  ]

  // The authoritative pitcher list (real names + IP/P) that the Pitch Data tab merges
  // TrackMan velo/spin onto — see PitchData.
  const boxPitchers = useMemo(() => lines.pitching.map(p => ({
    name: names.get(p.player_id)?.name ?? '—',
    teamAbbr: byId.get(p.team_id)?.abbr ?? '',
    outs: p.outs,
    pitches: p.pitches,
  })), [lines.pitching, names, byId])

  // First hit of the game (plays are ordered by sequence) — feeds the Pitch Data highlights.
  const firstHit = useMemo(() => {
    const p = plays.find(pl => pl.is_hit)
    return p ? { batter: p.batter_name, inning: p.inning, half: p.half } : null
  }, [plays])

  return (
    <ModalShell
      eyebrow={final ? `Final${game.innings && game.innings !== 7 ? ` / ${game.innings}` : ''}` : live ? '● Live' : `${dateLabel}${game.start_time ? ` · ${formatGameTime(game.game_date, game.start_time)}` : ''}`}
      onClose={onClose}
      maxWidth={720}
      fillHeight={showScore}
    >
      {/* Full-height flex column: everything above the panel is fixed; only the tab
          panel scrolls, so the modal height stays constant when switching tabs. */}
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
        {/* Score header — one combined scoreboard for a played game (teams + line + R/H/E),
            or a plain name matchup for an unplayed one. */}
        <Box sx={{ flexShrink: 0, pb: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
          {showScore && away && home ? (
            <Scoreboard away={away} home={home} game={game} awayWon={awayWon} homeWon={homeWon} />
          ) : (
            <Box sx={{ px: 2, pt: 2, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
              {scoreLine(away, game.away_score, awayWon)}
              {scoreLine(home, game.home_score, homeWon)}
            </Box>
          )}
          {game.venue && <Typography sx={{ fontSize: '0.72rem', color: 'text.disabled', px: 2, mt: 1 }}>{game.venue}</Typography>}

          {/* Recap highlight — admin-only during soft launch; shown only for a finished
              game the league has posted video for. */}
          {isAdmin && final && video && (
            <Box sx={{ px: 2, mt: 1.5 }}><GameHighlightCard video={video} /></Box>
          )}
        </Box>

        {/* Live situation banner (inning / count / bases / matchup) */}
        {live && game.live_state && away && home && (
          <Box sx={{ flexShrink: 0 }}><LiveBanner state={game.live_state} away={away} home={home} /></Box>
        )}

        {loading ? (
          <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><CircularProgress /></Box>
        ) : hasLines ? (
          <>
            <Box sx={{ flexShrink: 0, pt: 0.75 }}>
              <SegNav options={tabs} value={tab} onChange={v => setTab(v as Tab)} mb={0} />
            </Box>

            {/* Scroll region — fixed height, one per tab. */}
            <Box sx={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
              {tab === 'box' && away && home && (() => {
                const shown = boxTeam === 'home' ? home : away
                return (
                  <Box sx={{ px: 2, pb: 2, pt: 0 }}>
                    <TeamSwitch away={away} home={home} value={boxTeam} onChange={setBoxTeam} />
                    <TeamBox
                      team={shown}
                      batting={lines.batting.filter(b => b.team_id === shown.id)}
                      pitching={lines.pitching.filter(p => p.team_id === shown.id)}
                      names={names}
                      onOpenPlayer={onOpenPlayer}
                    />
                  </Box>
                )
              })()}
              {tab === 'plays' && <PlayByPlay plays={plays} teams={byId} />}
              {tab === 'pitch' && <PitchData tracking={tracking} boxPitchers={boxPitchers} firstHit={firstHit} live={live} />}
            </Box>
          </>
        ) : final ? (
          <Box sx={{ flex: 1, p: 2 }}>
            <EmptyBody
              title="Box score not available yet"
              hint="The feed has not posted a box score for this game."
            />
          </Box>
        ) : away && home ? (
          // Unplayed game: a pre-game matchup card comparing the two clubs' season stats,
          // in place of a bare "not played yet" message (mirrors the MLB game preview).
          <Box sx={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
            <WpblGamePreview away={away} home={home} teams={teams} games={games} />
          </Box>
        ) : (
          <Box sx={{ flex: 1, p: 2 }}>
            <EmptyBody title="This game has not been played yet" hint="Check back after first pitch." />
          </Box>
        )}
      </Box>
    </ModalShell>
  )
}

// ─── styles ────────────────────────────────────────────────────────────────────
// Box tables (batting / pitching / by-pitcher): table-layout:auto with a shrink-to-fit name
// column (width:'1%' + nowrap makes it take only its content width), so the name column is
// as narrow as the names allow and the stat columns claim the freed space — more columns fit
// before the wrapper scrolls. maxWidth caps a very long name (inner text ellipsizes); minWidth
// floors the table so it still scrolls on a narrow phone.
const tableSx = { tableLayout: 'auto', borderCollapse: 'collapse', width: '100%', minWidth: 0, fontVariantNumeric: 'tabular-nums' } as const
const NAME_W = 150 // cap for the shrink-to-fit name column (longer names ellipsize)
// The name column is pinned (sticky-left) so scrolling right moves only the stat columns.
// An opaque bg + right divider keep it legible over the stat cells sliding underneath.
const stickyName = { position: 'sticky', left: 0, zIndex: 1, bgcolor: 'background.paper', borderRight: '1px solid', borderRightColor: 'divider' } as const
const nameHeadSx = { ...stickyName, width: '1%', maxWidth: NAME_W, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.6rem', fontWeight: 700, color: 'text.disabled', textTransform: 'uppercase', letterSpacing: 0.4, px: 0.4, py: 0.4 } as const
const nameCellSx = { ...stickyName, width: '1%', maxWidth: NAME_W, whiteSpace: 'nowrap', textAlign: 'left', px: 0.4, py: 0.45 } as const
const posSx = { fontSize: '0.6rem', color: 'text.disabled', lineHeight: 1, flexShrink: 0 } as const
// Scoreboard: team name column absorbs slack; innings + R/H/E hug the right and scroll if
// they overrun. minWidth:max-content floors it so a phone scrolls rather than crushing.
const scoreTableSx = { borderCollapse: 'collapse', width: '100%', minWidth: 'max-content', fontVariantNumeric: 'tabular-nums' } as const
