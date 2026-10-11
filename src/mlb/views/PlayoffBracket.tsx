import React, { useEffect, useState, lazy, Suspense } from 'react'
import { TYPE_SCALE } from '../../ui/card'
import { Box, Typography, Skeleton } from '@mui/material'
import { CURRENT_SEASON, TEAM_BG, TEAM_NICKNAME, TONE } from '../constants'
import { LogoBubble, LiveDot } from '../components/boxScore'
import { useIsDark, borderAlpha } from '../lib/colorUtils'
import { hoverOnly, linkPress, FOCUS_RING } from '../../ui/interaction'
import { useForegroundInterval } from '../../lib/foregroundInterval'
import { fetchBracket, seededBracket, bracketLikely, seriesLine, fieldIsSet, winsNeeded, liveGameScore, ROUNDS, SERIES_ORDER } from '../postseason'
import type { Bracket, PsSeries, PsTeam, Round, SeriesId } from '../postseason'
import { chromePx, typePx } from '../../ui/scale'
import { SCORES_HEADER_H, STRIP_PY } from './FinalGames'
import { PillGroup } from '../../ui/PillGroup'
import { teamLink, rowClick, LINK_SX } from '../lib/links'
import { mlbSeriesPath } from '../routes'

// The sheet is a few kB that only a tap needs, so it is not part of Home's first load; it is fetched
// once the card has drawn, so that tap does not wait on it.
const loadSeriesSheet = () => import('./SeriesSheet')
const SeriesSheet = lazy(loadSeriesSheet)

// ─── The postseason bracket ───────────────────────────────────────────────────
//
// MLB had no postseason surface at all: the standings stop at Game 162 and the scoreboard shows one
// day at a time, so "who plays the Rays, and when" had no answer on the site. This is WPBL's bracket
// card adapted to twelve clubs: eleven series do not fit a phone as a tree, so the card shows one
// ROUND at a time (the one being played, by default) with the other three a tap away, and every
// series opens its games.
//
// Everything comes from the league's published series (postseason.ts): stand-ins read as what
// they are ("HOU/CWS") until a round decides them, and nothing is projected.

const timeFmt = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
const dayFmt = (ms: number) => new Date(ms).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })

const weekdayFmt = (ms: number) => new Date(ms).toLocaleDateString([], { weekday: 'short' })

/** What a series says under its two clubs: the result, the live game, or the next one. `compact` is
 *  the half-width Home card, where "Game 2 · Wed, Sep 30, 1:08 PM" wraps to three lines.
 *  A live game gets its own score and inning ("G1 · BOS 2–0 · ▲ 7th"), and no series line: the
 *  pips carry the series, and this card sits under a scoreboard showing the same game, so saying
 *  only "In Progress" here read as the two disagreeing about the score. */
function seriesStatus(s: PsSeries, compact = false): { text: string; live: boolean; decider?: boolean } {
  const line = seriesLine(s)
  const game = (n: number) => compact ? `G${n}` : `Game ${n}`
  const live = s.games.find(g => g.state === 'live')
  if (live) return { text: [game(live.number), liveGameScore(live), live.inning ?? (live.detail || 'Live')].join(' · '), live: true }
  if (s.winnerId != null) return { text: line!, live: false }
  const n = s.next
  if (!n) return { text: line ?? '', live: false }
  const when = compact
    ? `${weekdayFmt(n.startMs)} ${n.timeSet ? timeFmt(n.startMs) : 'TBD'}`
    : n.timeSet ? `${dayFmt(n.startMs)}, ${timeFmt(n.startMs)}` : `${dayFmt(n.startMs)}, time TBD`
  const next = `${game(n.number)}${n.ifNecessary ? (compact ? ' if nec.' : ' (if necessary)') : ''} · ${when}`
  // Both clubs one win short: the next game ends the series either way. "Series tied 1-1" said the
  // arithmetic and left the reader to work out that tonight was winner-take-all.
  const need = winsNeeded(s)
  if (s.winsTop === need - 1 && s.winsBottom === need - 1) {
    const today = new Date(n.startMs).toDateString() === new Date().toDateString()
    const at = n.timeSet ? timeFmt(n.startMs) : 'TBD'
    return compact
      ? { text: `${game(n.number)} decider · ${today ? at : `${weekdayFmt(n.startMs)} ${at}`}`, live: false, decider: true }
      : { text: `${line} · ${game(n.number)} decides it · ${when}`, live: false, decider: true }
  }
  // Compact keeps one line: the series score while there is one, else the next game.
  if (compact) return { text: line ?? next, live: false }
  return { text: [line, next].filter(Boolean).join(' · '), live: false }
}

/** Series wins as pips, one per win the series needs. A number here was the scoreboard's exact
 *  grammar (logo, club, figure on the right), so a series at 0-0 with game 1 on read as a game
 *  stuck at 0-0 directly under the scoreboard's real score. Pips cannot be read as runs, and the
 *  empty ones say how long the series is. */
function WinPips({ wins, need }: { wins: number; need: number }) {
  return (
    <Box role="img" aria-label={`${wins} of ${need} wins`} sx={{ display: 'flex', gap: chromePx(3), flexShrink: 0 }}>
      {Array.from({ length: need }, (_, i) => (
        <Box key={i} sx={{
          width: chromePx(7), height: chromePx(7), borderRadius: '50%', boxSizing: 'border-box',
          ...(i < wins ? { bgcolor: 'text.primary' } : { border: '1.5px solid', borderColor: 'text.disabled' }),
        }} />
      ))}
    </Box>
  )
}

function TeamRow({ t, wins, need, won, lost, onTeamClick, compact = false }: {
  t: PsTeam; wins: number; need: number; won: boolean; lost: boolean; onTeamClick?: (id: number) => void; compact?: boolean
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5, opacity: lost ? 0.5 : 1 }}>
      <Typography sx={{ width: '1rem', fontSize: TYPE_SCALE.meta, fontWeight: 700, color: 'text.disabled', textAlign: 'right' }}>
        {t.seed ?? ''}
      </Typography>
      {t.real
        ? <LogoBubble teamId={t.id} abbr={t.abbr} size={26} />
        : <Box sx={{ width: chromePx(26), height: chromePx(26), borderRadius: '50%', border: '1.5px dashed', borderColor: 'divider', flexShrink: 0 }} />}
      <Typography
        // A link to the club, inside a card that is a button: both handlers stop here, so a tap or
        // an Enter on the club opens the club and not the series too. The keydown stop matters as
        // much as the click's: the card's Enter handler would otherwise preventDefault the link's
        // own activation and open the series instead.
        {...(t.real && onTeamClick ? (() => {
          const link = teamLink(t.id, onTeamClick) as { onClick?: (e: React.MouseEvent) => void }
          return {
            ...link,
            onClick: (e: React.MouseEvent) => { e.stopPropagation(); link.onClick?.(e) },
            onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter') e.stopPropagation() },
          }
        })() : {})}
        sx={{
          ...LINK_SX, display: 'block',
          flex: 1, minWidth: 0, fontSize: TYPE_SCALE.body, fontWeight: won ? 800 : 600,
          color: t.real ? 'text.primary' : 'text.secondary',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          ...(t.real && onTeamClick ? { cursor: 'pointer', ...FOCUS_RING } : {}),
        }}
      >
        {t.real && !compact ? (TEAM_NICKNAME[t.id] ?? t.abbr) : t.abbr}
      </Typography>
      {t.real && <WinPips wins={wins} need={need} />}
    </Box>
  )
}

function SeriesCard({ s, season, onOpen, onTeamClick, compact = false }: {
  s: PsSeries; season: number; onOpen: () => void; onTeamClick?: (id: number) => void; compact?: boolean
}) {
  const isDark = useIsDark()
  const status = seriesStatus(s, compact)
  const winnerCol = s.winnerId != null ? TEAM_BG[s.winnerId] : undefined
  const need = winsNeeded(s)
  // Home's compact card opens the series and nothing else. Its club names fill the card's width,
  // so as links they took nearly every tap and the series sheet was all but unreachable; the
  // sheet carries the same club links one tap later. Standings' full card keeps them.
  const teamClick = compact ? undefined : onTeamClick
  // A real link to the series' address. The whole card when it holds no other link; otherwise the
  // series label carries the href and the card keeps the click (rowClick), since an anchor around
  // the club links would swallow them.
  const href = mlbSeriesPath(season, s.id)
  const whole = !teamClick
  return (
    <Box {...(whole ? linkPress(href, onOpen) : rowClick(onOpen))} sx={{
      ...LINK_SX, display: 'block',
      borderRadius: 2.5, border: '1px solid',
      borderColor: winnerCol ? borderAlpha(winnerCol, isDark) : 'divider',
      bgcolor: 'background.paper', px: 1.5, py: 1, cursor: 'pointer',
      ...hoverOnly({ bgcolor: 'action.hover' }), ...FOCUS_RING,
    }}>
      {/* The length stays on Home's compact card too: it is the one word on the card that says series. */}
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75, mb: 0.25 }}>
        <Typography {...(whole ? {} : linkPress(href, onOpen))} sx={{ ...LINK_SX, display: 'block', flex: 1, minWidth: 0, fontSize: TYPE_SCALE.caption, fontWeight: 800, letterSpacing: typePx(0.5), textTransform: 'uppercase', color: 'text.disabled', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', ...FOCUS_RING }}>
          {s.label}
        </Typography>
        <Typography sx={{ fontSize: TYPE_SCALE.caption, fontWeight: 700, color: 'text.secondary', whiteSpace: 'nowrap', flexShrink: 0 }}>
          Best of {s.bestOf}
        </Typography>
      </Box>
      <TeamRow compact={compact} t={s.top} wins={s.winsTop} need={need} won={s.winnerId === s.top.id} lost={s.winnerId != null && s.winnerId !== s.top.id} onTeamClick={teamClick} />
      <TeamRow compact={compact} t={s.bottom} wins={s.winsBottom} need={need} won={s.winnerId === s.bottom.id} lost={s.winnerId != null && s.winnerId !== s.bottom.id} onTeamClick={teamClick} />
      {status.text && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 0.5, pt: 0.75, borderTop: '1px solid', borderColor: 'divider' }}>
          {status.live && <LiveDot size={6} />}
          <Typography sx={{
            fontSize: compact ? TYPE_SCALE.caption : TYPE_SCALE.meta, fontWeight: status.decider ? 800 : 600, lineHeight: 1.35,
            color: status.live ? TONE.red : status.decider ? TONE.amber : 'text.secondary',
            ...(compact ? { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } : {}),
          }}>
            {status.text}
          </Typography>
        </Box>
      )}
    </Box>
  )
}

/** The bracket's shape while its first read is in flight: the heading row and four series. */
/** A round's series side by side wherever there is room. Two-by-two at every width left a desktop
 *  card 680px wide around a 3-letter club and three pips, and stacked a four-series round into two
 *  rows of mostly empty card. On a wide screen it is always FOUR columns, whatever the round: the
 *  Championship Series' two and the World Series' one then sit at the same card width as the
 *  Division Series' four rather than stretching to fill the row. From `md` on Home, where the clubs
 *  are abbreviations; the full bracket names them, so it waits for `lg`. */
function seriesGrid(n: number, compact: boolean) {
  const four = 'repeat(4, minmax(0, 1fr))'
  return compact
    ? { xs: n > 1 ? '1fr 1fr' : '1fr', md: four }
    : { xs: '1fr', sm: n > 1 ? '1fr 1fr' : 'minmax(0, 26rem)', lg: four }
}

/** Home's bracket (compact) puts its label where Scores puts its own: in a box of the Scores
 *  header's height, with the strip's padding under it, so "Playoff series" sits exactly as far above
 *  its cards as "Scores" does above its chips. The round pills cannot share that box: they do not
 *  scale with the chrome the way Scores' buttons do, and a phone draws them touch-sized (41px against
 *  26), so a margin tuned at one width was 4px off at another and a centred row overlapped the cards.
 *  So the row aligns to its bottom and the pills rise above the label rather than reaching down past
 *  it. The full card keeps its centred row and its own gap, since the round's name sits under it. */
const headerSx = (compact: boolean) => compact
  ? { alignItems: 'flex-end', mb: STRIP_PY }
  : { alignItems: 'center', mb: 1.25 }
const labelBoxSx = (compact: boolean) => compact
  ? { height: SCORES_HEADER_H, display: 'flex', alignItems: 'center' }
  : {}

export function BracketSkeleton({ compact }: { compact: boolean }) {
  const card = <Skeleton variant="rounded" sx={{ height: SERIES_CARD_H[compact ? 'compact' : 'full'], borderRadius: 2.5 }} />
  return (
    <Box aria-hidden>
      <Box sx={{ display: 'flex', ...headerSx(compact) }}>
        <Box sx={labelBoxSx(compact)}><Skeleton variant="text" sx={{ width: '7.5rem', fontSize: TYPE_SCALE.meta }} /></Box>
        {/* The real round pills, none chosen yet: a pill-shaped bar of hand-picked size was 3px short of them. */}
        <Box sx={{ ml: 'auto', ...(compact ? {} : ROUNDS_ONLY) }}>
          <PillGroup options={ROUNDS.map(r => ({ value: r.key, label: r.short }))} value="" onChange={() => {}} />
        </Box>
      </Box>
      <Box sx={compact ? {} : ROUNDS_ONLY}>
        {/* The round's name, which the full card carries under its header. */}
        {!compact && <Typography sx={{ fontSize: TYPE_SCALE.meta, mb: 1 }}><Skeleton width="6rem" /></Typography>}
        <Box sx={{ display: 'grid', gridTemplateColumns: seriesGrid(4, compact), gap: 1 }}>
          {[0, 1, 2, 3].map(i => <React.Fragment key={i}>{card}</React.Fragment>)}
        </Box>
      </Box>
      {/* The round names need no data, so the tree's skeleton draws the real ones. */}
      {!compact && <BracketTree cell={() => card} />}
    </Box>
  )
}

// ─── The whole bracket at once, on a desktop ──────────────────────────────────
//
// A round at a time is what fits a phone, but on a wide screen it hid the one thing a bracket is
// for: who a winner plays next. From `lg` the full card draws every round as a tree instead, AL
// above NL, left to right into the World Series, at the four-column card width the round view
// already uses there. The swap is CSS only (ROUNDS_ONLY / TREE_ONLY), so the first paint is
// already the right layout and the skeleton can draw the same one. Home's compact card keeps its
// rounds: it shares a row with other cards.

const ROUNDS_ONLY = { display: { xs: 'block', lg: 'none' } } as const
const TREE_ONLY = { display: { xs: 'none', lg: 'block' } } as const

/** Each row pairs a Wild Card series with the Division Series its winner goes on to: the 1 seed
 *  meets the 4-5 winner and the 2 seed the 3-6 winner. Pinned by the series ids, as SHAPE is. */
const TREE_ROWS: [SeriesId, SeriesId][] = [['F_2', 'D_1'], ['F_1', 'D_2'], ['F_4', 'D_3'], ['F_3', 'D_4']]
const TREE_COLS = `minmax(0, 1fr) ${chromePx(20)} minmax(0, 1fr) ${chromePx(20)} minmax(0, 1fr) ${chromePx(20)} minmax(0, 1fr)`
const ROW_GAP = chromePx(10)
const LINE = { position: 'absolute', borderColor: 'divider', borderStyle: 'solid', borderWidth: 0 } as const

/** Two cards joining into one, as an elbow from the middle of each to the middle of the next.
 *  The rows are equal (gridAutoRows 1fr), so for both joins, the Division Series pair over two
 *  rows and the League Championship pair over four, the two middles sit (span - gap) / 4 in from
 *  either end of the span. */
const Join = ({ column, rows }: { column: number; rows: string }) => (
  <Box sx={{ position: 'relative', gridColumn: column, gridRow: rows }}>
    <Box sx={{ ...LINE, left: 0, width: '50%', top: `calc((100% - ${ROW_GAP}) / 4)`, bottom: `calc((100% - ${ROW_GAP}) / 4)`, borderTopWidth: '1px', borderBottomWidth: '1px', borderRightWidth: '1px' }} />
    <Box sx={{ ...LINE, left: '50%', right: 0, top: '50%', borderTopWidth: '1px' }} />
  </Box>
)

function BracketTree({ cell }: { cell: (id: SeriesId) => React.ReactNode }) {
  const at = (id: SeriesId, rows: string, column: number) => (
    <Box key={id} sx={{ gridRow: rows, gridColumn: column, alignSelf: 'center', minWidth: 0 }}>{cell(id)}</Box>
  )
  return (
    <Box sx={TREE_ONLY}>
      <Box sx={{ display: 'grid', gridTemplateColumns: TREE_COLS, mb: 1 }}>
        {ROUNDS.map((r, i) => (
          <Typography key={r.key} sx={{ gridColumn: i * 2 + 1, fontSize: TYPE_SCALE.meta, color: 'text.secondary' }}>{r.label}</Typography>
        ))}
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: TREE_COLS, gridAutoRows: '1fr', rowGap: ROW_GAP }}>
        {TREE_ROWS.flatMap(([wc, ds], i) => [
          at(wc, `${i + 1}`, 1),
          <Box key={`line-${wc}`} sx={{ position: 'relative', gridRow: `${i + 1}`, gridColumn: 2 }}>
            <Box sx={{ ...LINE, left: 0, right: 0, top: '50%', borderTopWidth: '1px' }} />
          </Box>,
          at(ds, `${i + 1}`, 3),
        ])}
        <Join column={4} rows="1 / span 2" />
        <Join column={4} rows="3 / span 2" />
        {at('L_1', '1 / span 2', 5)}
        {at('L_2', '3 / span 2', 5)}
        <Join column={6} rows="1 / span 4" />
        {at('W_1', '1 / span 4', 7)}
      </Box>
    </Box>
  )
}

// A series card's height: label, two club rows, the status line. Part type and part fixed structure,
// so part rem and part chrome, fitted to the loaded cards in Oct 2026 at both text sizes and both
// root sizes (Home's compact card and the Standings tab's full one differ). All in rem it was right
// at the default size and 25px too tall at Large text; one figure for both cards was 2px out on one.
const SERIES_CARD_H = {
  compact: `calc(1.75rem + ${chromePx(99)})`,
  full: `calc(1.85rem + ${chromePx(99)})`,
} as const

/**
 * The bracket card. Draws nothing until the league has published a postseason (or if the feed is
 * not the shape postseason.ts expects), so it can sit on Home all year.
 */
export function PlayoffBracketCard({ onTeamClick, onPlayerClick, heading = 'Playoff series', compact = false }: {
  onTeamClick?: (id: number) => void
  onPlayerClick?: (id: number) => void
  heading?: string
  /** Home's version: two series abreast even on a phone, clubs by abbreviation, one status line.
   *  Four full-width Wild Card series were a screen of Home on their own. */
  compact?: boolean
}) {
  // Drawn from the last read on this device first (see seededBracket), then from the network.
  const [bracket, setBracket] = useState<Bracket | null>(() => seededBracket(CURRENT_SEASON))
  const [loaded, setLoaded] = useState(false)
  const [round, setRound] = useState<Round | null>(null)
  const [openId, setOpenId] = useState<PsSeries['id'] | null>(null)

  useEffect(() => {
    const t = window.setTimeout(() => { void loadSeriesSheet() }, 4000)
    return () => window.clearTimeout(t)
  }, [])
  useEffect(() => {
    let alive = true
    fetchBracket(CURRENT_SEASON).then(b => { if (alive) { setBracket(b); setLoaded(true) } })
    return () => { alive = false }
  }, [])
  // Fresh while a game is on, and every few minutes on a day with games still to come; a quiet day
  // and a finished postseason do not poll at all.
  const anyLive = !!bracket && Object.values(bracket.series).some(s => s.live)
  const today = new Date().toDateString()
  const gamesToday = !!bracket && Object.values(bracket.series).some(s => s.next && new Date(s.next.startMs).toDateString() === today)
  useForegroundInterval(() => {
    fetchBracket(CURRENT_SEASON, true).then(b => { if (b) setBracket(b) })
  }, anyLive ? 30_000 : gamesToday ? 180_000 : null)

  // No seed on this device yet: hold the room a bracket takes while one is likely, so its arrival
  // does not push the page down. Four series is the tallest round; a later round with fewer gives
  // a little back, which is a far smaller move than the whole card arriving from nothing.
  if (!bracket && !loaded && bracketLikely()) return <BracketSkeleton compact={compact} />
  // Not before the field is set; see fieldIsSet.
  if (!bracket || !fieldIsSet(bracket)) return null
  const shown: Round = round ?? bracket.current
  // On Home, the series still being played come first: by the last day of a round three of the four
  // were decided and the one with a game tonight sat in the bottom corner. Stable otherwise, so AL
  // stays above NL within each group. The full bracket keeps its fixed order, where position means
  // something.
  const inRound = SERIES_ORDER.map(id => bracket.series[id]).filter(s => s.round === shown)
    .sort((a, b) => compact ? Number(a.winnerId != null) - Number(b.winnerId != null) : 0)
  const openSeries = openId ? bracket.series[openId] : null
  const champion = bracket.over ? bracket.series.W_1 : null
  const champ = champion?.winnerId != null ? (champion.winnerId === champion.top.id ? champion.top : champion.bottom) : null

  return (
    <Box>
      <Box sx={{ display: 'flex', gap: 1, ...headerSx(compact), flexWrap: 'wrap' }}>
        <Box sx={labelBoxSx(compact)}>
          <Typography sx={{ fontWeight: 800, fontSize: TYPE_SCALE.micro, textTransform: 'uppercase', letterSpacing: typePx(1), color: 'text.secondary', lineHeight: 1 }}>
            {/* Once it is over it is a record of a season, read all winter: say which. */}
            {bracket.over ? `${bracket.season} postseason` : heading}
          </Typography>
        </Box>
        <Box sx={{ ml: 'auto', ...(compact ? {} : ROUNDS_ONLY) }}>
          <PillGroup
            options={ROUNDS.map(r => ({ value: r.key, label: r.short }))}
            value={shown}
            onChange={v => setRound(v as Round)}
          />
        </Box>
      </Box>
      {/* The tree always shows the World Series, so it always carries the champion. */}
      {champ && !compact && (
        <Typography sx={{ fontSize: TYPE_SCALE.title, fontWeight: 800, mb: 1, ...TREE_ONLY }}>
          🏆 The {TEAM_NICKNAME[champ.id] ?? champ.abbr} win the {bracket.season} World Series
        </Typography>
      )}
      <Box sx={compact ? {} : ROUNDS_ONLY}>
        {champ && shown === 'ws' && (
          <Typography sx={{ fontSize: TYPE_SCALE.title, fontWeight: 800, mb: 1 }}>
            🏆 The {TEAM_NICKNAME[champ.id] ?? champ.abbr} win the {bracket.season} World Series
          </Typography>
        )}
        {!compact && (
          <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', mb: 1 }}>
            {ROUNDS.find(r => r.key === shown)!.label}
          </Typography>
        )}
        <Box sx={{ display: 'grid', gridTemplateColumns: seriesGrid(inRound.length, compact), gap: 1 }}>
          {inRound.map(s => (
            <SeriesCard key={s.id} s={s} season={bracket.season} compact={compact} onOpen={() => setOpenId(s.id)} onTeamClick={onTeamClick} />
          ))}
        </Box>
      </Box>
      {!compact && (
        <BracketTree cell={id => <SeriesCard s={bracket.series[id]} season={bracket.season} onOpen={() => setOpenId(id)} onTeamClick={onTeamClick} />} />
      )}
      {openSeries && (
        <Suspense fallback={null}>
          <SeriesSheet s={openSeries} bracket={bracket} onClose={() => setOpenId(null)} onTeamClick={onTeamClick} onPlayerClick={onPlayerClick} />
        </Suspense>
      )}
    </Box>
  )
}
