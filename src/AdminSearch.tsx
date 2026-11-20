import { useEffect, useMemo, useState } from 'react'
import { Box, Typography, CircularProgress, InputBase, useTheme } from '@mui/material'
import { pressable } from './ui/interaction'
import { typePx } from './ui/scale'
import { TYPE_SCALE } from './ui/card'
import { sessionId } from './lib/analytics'
import {
  fetchSearchLog, localTz, formatShare, formatCount, searchKindLabel, answerRate,
  EMPTY_SEARCH_LOG, type SearchLog, type SearchLogRow, type SearchResult, type SearchSection,
} from './lib/analyticsAdmin'

// /admin's Search tab: what people look for in the search box, and whether it answered.
//
// THE OWNER IS HALF THE DATA. Over the 30 days to Nov 20, 2026, 108 of 205 opens of the box were
// the owner's, so every number here starts with the owner's browsers left out (`admin_search_log`
// drops any browser ever signed in as the caller, plus this one, which may never have been). The
// toggle is remembered per browser, and with it off the owner's rows are tagged in the log.
//
// THE LOG SHOWS WHAT WAS PICKED, NOT WHAT WAS TYPED. The box keeps the typed text only when it
// offered nothing (docs/ADMIN_ANALYTICS.md section 3), so a search that found someone shows who.

const RANGES = [
  { days: 1, label: 'Today' }, { days: 7, label: '7d' }, { days: 30, label: '30d' }, { days: 90, label: '90d' },
]
const SECTIONS: Array<{ value: SearchSection; label: string }> = [
  { value: 'all', label: 'Both' }, { value: 'wpbl', label: 'WPBL' }, { value: 'mlb', label: 'MLB' },
]
const RESULTS: Array<{ value: SearchResult | 'all'; label: string }> = [
  { value: 'all', label: 'All' }, { value: 'picked', label: 'Picked' }, { value: 'closed', label: 'Closed' }, { value: 'nothing', label: 'No results' },
]
const RESULT_COLOR: Record<SearchResult, string> = { picked: 'success.main', closed: 'warning.main', nothing: 'error.main' }
const RESULT_LABEL: Record<SearchResult, string> = { picked: 'Picked', closed: 'Closed', nothing: 'No results' }

const LOG_PAGE = 50
const LIST_HEAD = 10
const EXCLUDE_KEY = 'sdAdminSearchExcludeMe'

function readExclude(): boolean {
  try { return localStorage.getItem(EXCLUDE_KEY) !== '0' } catch { return true }
}
function writeExclude(v: boolean) {
  try { localStorage.setItem(EXCLUDE_KEY, v ? '1' : '0') } catch { /* private window: the default holds */ }
}

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
const stamp = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <Box {...pressable(onClick)} aria-pressed={active} sx={{
      px: 1.4, py: 0.5, borderRadius: 999, cursor: 'pointer', userSelect: 'none', flexShrink: 0,
      fontSize: TYPE_SCALE.body, fontWeight: 700, lineHeight: 1.5, whiteSpace: 'nowrap',
      border: '1px solid', borderColor: active ? 'primary.main' : 'outline',
      bgcolor: active ? 'primary.main' : 'transparent', color: active ? 'primary.contrastText' : 'text.secondary',
    }}>{label}</Box>
  )
}

function Card({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Box sx={{ borderRadius: 2, border: '1px solid', borderColor: 'outline', p: 1.5, minWidth: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.75 }}>
        <Typography component="h2" sx={{ fontSize: TYPE_SCALE.title, fontWeight: 800, flex: 1 }}>{title}</Typography>
        {aside && <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary' }}>{aside}</Typography>}
      </Box>
      {children}
    </Box>
  )
}

function Tile({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <Box sx={{ borderRadius: 2, border: '1px solid', borderColor: 'outline', px: 1.5, py: 1.1, minWidth: 0 }}>
      <Typography sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 800, letterSpacing: typePx(0.6), textTransform: 'uppercase', color: 'text.secondary' }}>{label}</Typography>
      <Typography sx={{ fontSize: TYPE_SCALE.display, fontWeight: 800, fontVariantNumeric: 'tabular-nums', color, lineHeight: 1.3 }}>{value}</Typography>
      {sub && <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary' }}>{sub}</Typography>}
    </Box>
  )
}

/** A ranked list row: label, a bar against the list's top, and the count. */
function RankRow({ label, sub, value, max, onClick }: { label: React.ReactNode; sub?: React.ReactNode; value: number; max: number; onClick?: () => void }) {
  return (
    <Box {...(onClick ? pressable(onClick) : {})} sx={{ py: 0.6, cursor: onClick ? 'pointer' : undefined, '&:not(:last-child)': { borderBottom: '1px solid', borderColor: 'divider' } }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
        <Typography sx={{ fontSize: TYPE_SCALE.body, fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</Typography>
        <Typography sx={{ fontSize: TYPE_SCALE.body, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{value}</Typography>
      </Box>
      <Box sx={{ mt: 0.4, height: 4, borderRadius: 2, bgcolor: 'action.hover', overflow: 'hidden' }}>
        <Box sx={{ height: '100%', width: `${(value / Math.max(1, max)) * 100}%`, bgcolor: 'primary.main' }} />
      </Box>
      {sub && <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', mt: 0.3 }}>{sub}</Typography>}
    </Box>
  )
}

function More({ shown, total, onMore }: { shown: number; total: number; onMore: () => void }) {
  if (total <= shown) return null
  return (
    <Box component="button" type="button" onClick={onMore} sx={{
      all: 'unset', cursor: 'pointer', display: 'block', mt: 1, fontSize: TYPE_SCALE.body, fontWeight: 700, color: 'primary.main',
      '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
    }}>Show all {total}</Box>
  )
}

function Empty() {
  return <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.secondary', py: 1 }}>No data</Typography>
}

/** Searches per day, stacked by how they ended. */
function DailyBars({ daily }: { daily: SearchLog['daily'] }) {
  const { palette } = useTheme()
  const fill: Record<SearchResult, string> = { picked: palette.success.main, closed: palette.warning.main, nothing: palette.error.main }
  const max = Math.max(1, ...daily.map(d => d.picked + d.closed + d.nothing))
  const w = 600, h = 90, gap = 2
  const bw = daily.length ? Math.max(1, (w - gap * (daily.length - 1)) / daily.length) : 0
  return (
    <Box>
      <Box component="svg" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img"
        aria-label="Searches per day" sx={{ width: '100%', height: 90, display: 'block' }}>
        {daily.map((d, i) => {
          const x = i * (bw + gap)
          let y = h
          return (['picked', 'closed', 'nothing'] as const).map(k => {
            const bh = (d[k] / max) * h
            y -= bh
            return bh > 0 ? <rect key={`${d.day}-${k}`} x={x} y={y} width={bw} height={bh} fill={fill[k]}><title>{`${d.day}: ${d[k]} ${RESULT_LABEL[k].toLowerCase()}`}</title></rect> : null
          })
        })}
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5 }}>
        <Typography sx={{ fontSize: TYPE_SCALE.micro, color: 'text.secondary' }}>{daily[0]?.day ?? ''}</Typography>
        <Box sx={{ display: 'flex', gap: 1.25 }}>
          {(['picked', 'closed', 'nothing'] as const).map(k => (
            <Box key={k} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Box aria-hidden sx={{ width: 8, height: 8, borderRadius: '2px', bgcolor: RESULT_COLOR[k] }} />
              <Typography sx={{ fontSize: TYPE_SCALE.micro, color: 'text.secondary' }}>{RESULT_LABEL[k]}</Typography>
            </Box>
          ))}
        </Box>
        <Typography sx={{ fontSize: TYPE_SCALE.micro, color: 'text.secondary' }}>{daily[daily.length - 1]?.day ?? ''}</Typography>
      </Box>
    </Box>
  )
}

/** One finished search in the log. */
function LogRow({ r, onBrowser }: { r: SearchLogRow; onBrowser: (b: string) => void }) {
  const what = r.result === 'nothing'
    ? (r.q ? `“${r.q}”` : 'No results')
    : r.result === 'closed'
      ? `Closed with ${r.shown ?? 0} ${r.shown === 1 ? 'row' : 'rows'}`
      : (r.title ?? searchKindLabel(r.kind))
  const detail = [
    r.section === 'mlb' ? 'MLB' : r.section === 'wpbl' ? 'WPBL' : null,
    r.result === 'picked' ? searchKindLabel(r.kind) : null,
    r.typed ? `${r.typed} chars` : r.result === 'picked' ? 'No typing' : null,
    r.result === 'picked' && r.rank != null ? `Row ${r.rank + 1}` : null,
    r.forgiving ? 'Typo fix' : null,
  ].filter(Boolean).join(' · ')
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.7, '&:not(:last-child)': { borderBottom: '1px solid', borderColor: 'divider' } }}>
      <Box aria-label={RESULT_LABEL[r.result]} role="img" sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: RESULT_COLOR[r.result], flexShrink: 0 }} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{
          fontSize: TYPE_SCALE.body, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          color: r.result === 'picked' ? 'text.primary' : 'text.secondary', fontStyle: r.result === 'closed' ? 'italic' : undefined,
        }}>{what}</Typography>
        <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{detail}</Typography>
      </Box>
      <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
        <Typography title={stamp(r.at)} sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{ago(r.at)}</Typography>
        <Box component="button" type="button" onClick={() => onBrowser(r.browser)} aria-label={`Only browser ${r.browser}`} sx={{
          all: 'unset', cursor: 'pointer', fontSize: TYPE_SCALE.micro, color: 'text.secondary', fontFamily: 'monospace',
          '&:hover': { color: 'primary.main' }, '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main' },
        }}>
          {r.me ? 'me · ' : ''}{r.user ? `${r.user} · ` : ''}{r.browser}
        </Box>
      </Box>
    </Box>
  )
}

export default function AdminSearch() {
  const [days, setDays] = useState(30)
  const [section, setSection] = useState<SearchSection>('all')
  const [excludeMe, setExcludeMe] = useState(readExclude)
  const [data, setData] = useState<SearchLog>(EMPTY_SEARCH_LOG)
  const [loading, setLoading] = useState(true)
  const [result, setResult] = useState<SearchResult | 'all'>('all')
  const [text, setText] = useState('')
  const [browser, setBrowser] = useState<string | null>(null)
  const [logShown, setLogShown] = useState(LOG_PAGE)
  const [open, setOpen] = useState<Record<string, boolean>>({})

  useEffect(() => {
    let live = true
    setLoading(true)
    fetchSearchLog(days, localTz(), excludeMe, section, [sessionId()]).then(d => {
      if (live) { setData(d); setLoading(false) }
    }, () => { if (live) setLoading(false) })
    return () => { live = false }
  }, [days, section, excludeMe])

  const t = data.totals
  const rate = answerRate(t)

  const log = useMemo(() => {
    const needle = text.trim().toLowerCase()
    return data.recent.filter(r =>
      (result === 'all' || r.result === result)
      && (!browser || r.browser === browser)
      && (!needle || [r.title, r.q, r.user, searchKindLabel(r.kind)].some(v => v?.toLowerCase().includes(needle))))
  }, [data.recent, result, browser, text])

  // Rows the box answered with a name, beyond WPBL players (rankings, questions, MLB players).
  const picks = useMemo(() => data.picks.filter(p => !(p.section === 'wpbl' && p.kind === 'result' && data.players.some(pl => pl.name === p.title))), [data.picks, data.players])
  const maxPlayer = data.players[0]?.events ?? 1
  const maxPick = Math.max(1, ...picks.map(p => p.events))
  const maxMiss = Math.max(1, ...data.missed.map(m => m.browsers))
  const maxKind = Math.max(1, ...data.kinds.map(k => k.events))
  const head = <T,>(key: string, xs: T[]) => (open[key] ? xs : xs.slice(0, LIST_HEAD))
  const more = (key: string, n: number, total: number) => <More shown={n} total={total} onMore={() => setOpen(o => ({ ...o, [key]: true }))} />
  const filterTo = (s: string) => { setText(s); setResult('all'); setLogShown(LOG_PAGE); document.getElementById('admin-search-log')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }

  return (
    <Box aria-busy={loading || undefined}>
      <Box sx={{ display: 'flex', gap: 0.6, alignItems: 'center', mb: 1.5, overflowX: 'auto', scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' } }}>
        {RANGES.map(r => <Chip key={r.days} label={r.label} active={days === r.days} onClick={() => setDays(r.days)} />)}
        <Box sx={{ width: '1px', alignSelf: 'stretch', my: 0.5, mx: 0.5, bgcolor: 'divider', flexShrink: 0 }} />
        {SECTIONS.map(s => <Chip key={s.value} label={s.label} active={section === s.value} onClick={() => setSection(s.value)} />)}
        <Box sx={{ width: '1px', alignSelf: 'stretch', my: 0.5, mx: 0.5, bgcolor: 'divider', flexShrink: 0 }} />
        <Chip label="Exclude me" active={excludeMe} onClick={() => { writeExclude(!excludeMe); setExcludeMe(!excludeMe) }} />
        {loading && <CircularProgress size={14} aria-label="Loading" sx={{ ml: 0.5, flexShrink: 0 }} />}
      </Box>
      {excludeMe && data.excluded_browsers > 0 && (
        <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', mt: -0.75, mb: 1.25 }}>
          {data.excluded_browsers} of my browsers excluded
        </Typography>
      )}

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' }, gap: 1, mb: 1.5 }}>
        <Tile label="Searches" value={formatCount(t.searches)} sub={`${t.browsers} browsers · ${t.opened} opens`} />
        <Tile label="Picked" value={rate == null ? '—' : formatShare(t.picked, t.searches)} sub={`${t.picked} searches`} color="success.main" />
        <Tile label="Closed" value={formatShare(t.closed, t.searches)} sub={`${t.closed} with results`} color="warning.main" />
        <Tile label="No results" value={formatShare(t.nothing, t.searches)} sub={`${t.nothing} searches`} color="error.main" />
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 2, rowGap: 0.5, mb: 1.5 }}>
        {[
          ['Top row', formatShare(t.top_row, t.picked)],
          ['Avg row', t.avg_rank == null ? '—' : `#${(t.avg_rank + 1).toFixed(1)}`],
          ['Avg typed', t.avg_typed == null ? '—' : `${t.avg_typed} chars`],
          ['Typo fixes', String(t.forgiving)],
          ['Opened, nothing typed', String(Math.max(0, t.opened - t.searches))],
        ].map(([k, v]) => (
          <Typography key={k} sx={{ fontSize: TYPE_SCALE.body, color: 'text.secondary' }}>
            {k} <Box component="span" sx={{ fontWeight: 800, color: 'text.primary', fontVariantNumeric: 'tabular-nums' }}>{v}</Box>
          </Typography>
        ))}
      </Box>

      <Box sx={{ mb: 1.5 }}>
        <Card title="Per day">{data.daily.length ? <DailyBars daily={data.daily} /> : <Empty />}</Card>
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 1.5, mb: 1.5 }}>
        <Card title="Most searched players" aside={section === 'mlb' ? undefined : 'WPBL'}>
          {data.players.length === 0 ? <Empty /> : <>
            {head('players', data.players).map(p => (
              <RankRow key={p.id} label={p.name} value={p.events} max={maxPlayer} onClick={() => filterTo(p.name)}
                sub={`${p.browsers} ${p.browsers === 1 ? 'browser' : 'browsers'} · ${ago(p.last_at)}`} />
            ))}
            {more('players', LIST_HEAD, data.players.length)}
          </>}
        </Card>
        <Card title="No results">
          {data.missed.length === 0 ? <Empty /> : <>
            {head('missed', data.missed).map(m => (
              <RankRow key={`${m.section}-${m.q}`} label={`“${m.q}”`} value={m.browsers} max={maxMiss} onClick={() => filterTo(m.q)}
                sub={`${m.section === 'mlb' ? 'MLB' : 'WPBL'} · ${m.browsers} ${m.browsers === 1 ? 'browser' : 'browsers'} · ${ago(m.last_at)}`} />
            ))}
            {more('missed', LIST_HEAD, data.missed.length)}
          </>}
        </Card>
        <Card title="Most picked rows">
          {picks.length === 0 ? <Empty /> : <>
            {head('picks', picks).map(p => (
              <RankRow key={`${p.section}-${p.kind}-${p.title}`} label={p.title} value={p.events} max={maxPick} onClick={() => filterTo(p.title)}
                sub={`${p.section === 'mlb' ? 'MLB' : 'WPBL'} · ${searchKindLabel(p.kind)} · ${p.browsers} ${p.browsers === 1 ? 'browser' : 'browsers'}`} />
            ))}
            {more('picks', LIST_HEAD, picks.length)}
          </>}
        </Card>
        <Card title="Picks by kind">
          {data.kinds.length === 0 ? <Empty /> : data.kinds.map(k => (
            <RankRow key={`${k.section}-${k.kind}`} label={`${searchKindLabel(k.kind)}${section === 'all' ? ` · ${k.section === 'mlb' ? 'MLB' : 'WPBL'}` : ''}`}
              value={k.events} max={maxKind}
              sub={`${k.browsers} ${k.browsers === 1 ? 'browser' : 'browsers'} · top row ${formatShare(k.top, k.events)} · avg row ${k.avg_rank == null ? '—' : `#${(k.avg_rank + 1).toFixed(1)}`}`} />
          ))}
        </Card>
      </Box>

      <Box id="admin-search-log" sx={{ scrollMarginTop: 'calc(var(--app-header-h, 0px) + 60px)' }}>
        <Card title="All searches" aside={`${log.length} of ${data.recent.length}`}>
          <Box sx={{ display: 'flex', gap: 0.6, alignItems: 'center', flexWrap: 'wrap', mb: 1 }}>
            {RESULTS.map(r => <Chip key={r.value} label={r.label} active={result === r.value} onClick={() => { setResult(r.value); setLogShown(LOG_PAGE) }} />)}
            {browser && <Chip label={`Browser ${browser} ✕`} active onClick={() => setBrowser(null)} />}
            <InputBase value={text} onChange={e => { setText(e.target.value); setLogShown(LOG_PAGE) }} placeholder="Filter"
              inputProps={{ 'aria-label': 'Filter searches' }}
              sx={{ flex: '1 1 140px', minWidth: 120, fontSize: TYPE_SCALE.body, px: 1.2, py: 0.2, borderRadius: 999, border: '1px solid', borderColor: 'outline' }} />
          </Box>
          {log.length === 0 ? <Empty /> : <>
            {log.slice(0, logShown).map((r, i) => <LogRow key={`${r.at}-${r.browser}-${i}`} r={r} onBrowser={b => { setBrowser(b); setLogShown(LOG_PAGE) }} />)}
            {log.length > logShown && (
              <Box component="button" type="button" onClick={() => setLogShown(n => n + LOG_PAGE)} sx={{
                all: 'unset', cursor: 'pointer', display: 'block', mt: 1, fontSize: TYPE_SCALE.body, fontWeight: 700, color: 'primary.main',
                '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
              }}>Show {Math.min(LOG_PAGE, log.length - logShown)} more</Box>
            )}
          </>}
        </Card>
      </Box>
    </Box>
  )
}
