import React, { useEffect, useState, lazy, Suspense } from 'react'
import { Box, Typography, Skeleton } from '@mui/material'
import { CURRENT_SEASON, TEAM_BG, TEAM_NICKNAME } from '../constants'
import { LogoBubble, LiveDot } from '../components/boxScore'
import { SegControl } from '../components/ui'
import { useIsDark, borderAlpha } from '../lib/colorUtils'
import { ModalShell } from '../../ui/ModalShell'
import { hoverOnly, pressable, FOCUS_RING } from '../../ui/interaction'
import { useSheetHistory } from '../state/sheetHistory'
import { useForegroundInterval } from '../../lib/foregroundInterval'
import { fetchBracket, seededBracket, bracketLikely, seriesLine, fieldIsSet, winsNeeded, liveGameScore, ROUNDS, SERIES_ORDER } from '../postseason'
import type { Bracket, PsSeries, PsGame, PsTeam, Round } from '../postseason'
import type { FinalGameSummary } from './FinalGames'
import { GamePreviewModal } from './GamePreview'

const GameCenterModal = lazy(() => import('./LiveGameCenter').then(m => ({ default: m.GameCenterModal })))

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
    <Box role="img" aria-label={`${wins} of ${need} wins`} sx={{ display: 'flex', gap: '3px', flexShrink: 0 }}>
      {Array.from({ length: need }, (_, i) => (
        <Box key={i} sx={{
          width: 7, height: 7, borderRadius: '50%', boxSizing: 'border-box',
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
      <Typography sx={{ width: '1rem', fontSize: '0.66rem', fontWeight: 700, color: 'text.disabled', textAlign: 'right' }}>
        {t.seed ?? ''}
      </Typography>
      {t.real
        ? <LogoBubble teamId={t.id} abbr={t.abbr} size={26} />
        : <Box sx={{ width: 26, height: 26, borderRadius: '50%', border: '1.5px dashed', borderColor: 'divider', flexShrink: 0 }} />}
      <Typography
        // Its own control inside a card that is one: both handlers stop here, so a tap or an Enter
        // on the club opens the club and not the series too.
        {...(t.real && onTeamClick ? {
          role: 'button', tabIndex: 0,
          onClick: (e: React.MouseEvent) => { e.stopPropagation(); onTeamClick(t.id) },
          onKeyDown: (e: React.KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onTeamClick(t.id) }
          },
        } : {})}
        sx={{
          flex: 1, minWidth: 0, fontSize: '0.85rem', fontWeight: won ? 800 : 600,
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

function SeriesCard({ s, onOpen, onTeamClick, compact = false }: {
  s: PsSeries; onOpen: () => void; onTeamClick?: (id: number) => void; compact?: boolean
}) {
  const isDark = useIsDark()
  const status = seriesStatus(s, compact)
  const winnerCol = s.winnerId != null ? TEAM_BG[s.winnerId] : undefined
  const need = winsNeeded(s)
  return (
    <Box {...pressable(onOpen)} sx={{
      borderRadius: 2.5, border: '1px solid',
      borderColor: winnerCol ? borderAlpha(winnerCol, isDark) : 'divider',
      bgcolor: 'background.paper', px: 1.5, py: 1, cursor: 'pointer',
      ...hoverOnly({ bgcolor: 'action.hover' }), ...FOCUS_RING,
    }}>
      {/* The length stays on Home's compact card too: it is the one word on the card that says series. */}
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75, mb: 0.25 }}>
        <Typography sx={{ flex: 1, minWidth: 0, fontSize: '0.6rem', fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: 'text.disabled', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {s.label}
        </Typography>
        <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, color: 'text.disabled', whiteSpace: 'nowrap', flexShrink: 0 }}>
          Best of {s.bestOf}
        </Typography>
      </Box>
      <TeamRow compact={compact} t={s.top} wins={s.winsTop} need={need} won={s.winnerId === s.top.id} lost={s.winnerId != null && s.winnerId !== s.top.id} onTeamClick={onTeamClick} />
      <TeamRow compact={compact} t={s.bottom} wins={s.winsBottom} need={need} won={s.winnerId === s.bottom.id} lost={s.winnerId != null && s.winnerId !== s.bottom.id} onTeamClick={onTeamClick} />
      {status.text && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 0.5, pt: 0.75, borderTop: '1px solid', borderColor: 'divider' }}>
          {status.live && <LiveDot size={6} />}
          <Typography sx={{
            fontSize: compact ? '0.64rem' : '0.7rem', fontWeight: status.decider ? 800 : 600, lineHeight: 1.35,
            color: status.live ? '#ef4444' : status.decider ? '#f59e0b' : 'text.secondary',
            ...(compact ? { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } : {}),
          }}>
            {status.text}
          </Typography>
        </Box>
      )}
    </Box>
  )
}

// Game Center and the preview take the scoreboard's game shape; a series game has everything they
// need to draw a header, and each loads the rest itself.
function toSummary(g: PsGame): FinalGameSummary {
  const team = (t: PsGame['home'], won: boolean) => ({ teamId: t.id, abbr: t.abbr, name: '', runs: t.score ?? 0, hits: 0, errors: 0, isWinner: won })
  return {
    gamePk: g.gamePk, state: g.state, startMs: g.startMs,
    statusText: g.state === 'final' ? 'Final' : g.state === 'live' ? (g.inning ?? (g.detail || 'Live'))
      : g.state === 'postponed' ? g.detail : g.timeSet ? timeFmt(g.startMs) : 'TBD',
    home: team(g.home, g.winnerId === g.home.id), away: team(g.away, g.winnerId === g.away.id),
    winPitcher: null, losePitcher: null, savePitcher: null,
  }
}

/** One series, game by game. A sheet over the card; each game opens Game Center or the preview. */
function SeriesSheet({ s, onClose, onTeamClick, onPlayerClick }: {
  s: PsSeries; onClose: () => void; onTeamClick?: (id: number) => void; onPlayerClick?: (id: number) => void
}) {
  const close = useSheetHistory(onClose)
  const [open, setOpen] = useState<PsGame | null>(null)
  const line = seriesLine(s)
  // A club tapped here leaves for its page: close first, so Back from the team does not reopen this.
  const toTeam = onTeamClick ? (id: number) => { onClose(); onTeamClick(id) } : undefined
  return (
    <ModalShell onClose={close} maxWidth={480} sheet eyebrow={`${s.label} · Best of ${s.bestOf}`}>
      <Box sx={{ px: 2, pt: 1.5, pb: 1 }}>
        <TeamRow t={s.top} wins={s.winsTop} need={winsNeeded(s)} won={s.winnerId === s.top.id} lost={s.winnerId != null && s.winnerId !== s.top.id} onTeamClick={toTeam} />
        <TeamRow t={s.bottom} wins={s.winsBottom} need={winsNeeded(s)} won={s.winnerId === s.bottom.id} lost={s.winnerId != null && s.winnerId !== s.bottom.id} onTeamClick={toTeam} />
        {line && <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: 'text.secondary', mt: 0.5 }}>{line}</Typography>}
      </Box>
      <Box sx={{ borderTop: '1px solid', borderColor: 'divider' }}>
        {s.games.map(g => {
          // A game the series never reached is gone from the feed, or cancelled; either way it is not a game.
          const skipped = g.state === 'postponed' && s.winnerId != null
          if (skipped) return null
          const score = g.state === 'final' || g.state === 'live'
            ? `${g.away.abbr} ${g.away.score ?? 0}, ${g.home.abbr} ${g.home.score ?? 0}`
            : `${g.away.abbr} at ${g.home.abbr}`
          const when = g.state === 'final' ? 'Final'
            : g.state === 'live' ? (g.inning ?? (g.detail || 'Live'))
            : g.state === 'postponed' ? g.detail
            : g.timeSet ? `${dayFmt(g.startMs)}, ${timeFmt(g.startMs)}` : `${dayFmt(g.startMs)}, time TBD`
          return (
            <Box key={g.gamePk} {...pressable(() => setOpen(g))} sx={{
              display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.25, cursor: 'pointer',
              borderBottom: '1px solid', borderColor: 'divider',
              ...hoverOnly({ bgcolor: 'action.hover' }), ...FOCUS_RING,
            }}>
              <Typography sx={{ width: '3.4rem', fontSize: '0.7rem', fontWeight: 800, color: 'text.disabled' }}>
                Game {g.number}
              </Typography>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontSize: '0.82rem', fontWeight: 700 }}>{score}</Typography>
                <Typography sx={{ fontSize: '0.7rem', color: g.state === 'live' ? '#ef4444' : 'text.secondary' }}>
                  {when}{g.ifNecessary && g.state === 'preview' ? ' · if necessary' : ''}
                </Typography>
              </Box>
              {g.state === 'live' && <LiveDot size={6} />}
            </Box>
          )
        })}
      </Box>
      {open && (open.state === 'preview' || open.state === 'postponed') && (
        <GamePreviewModal game={toSummary(open)} onClose={() => setOpen(null)}
          onTeamClick={toTeam} onPlayerClick={onPlayerClick} />
      )}
      {open && (open.state === 'live' || open.state === 'final') && (
        <Suspense fallback={null}>
          <GameCenterModal game={toSummary(open)} onClose={() => setOpen(null)}
            onTeamClick={toTeam} onPlayerClick={onPlayerClick ? id => { onClose(); onPlayerClick(id) } : undefined} />
        </Suspense>
      )}
    </ModalShell>
  )
}

/** The bracket's shape while its first read is in flight: the heading row and four series. */
export function BracketSkeleton({ compact }: { compact: boolean }) {
  return (
    <Box aria-hidden>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 1.25 }}>
        <Skeleton variant="text" sx={{ width: '7.5rem', fontSize: '0.7rem' }} />
        <Skeleton variant="rounded" sx={{ ml: 'auto', width: 176, height: 31, borderRadius: 999 }} />
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: compact ? '1fr 1fr' : '1fr', sm: '1fr 1fr' }, gap: 1 }}>
        {[0, 1, 2, 3].map(i => <Skeleton key={i} variant="rounded" sx={{ height: SERIES_CARD_H, borderRadius: 2.5 }} />)}
      </Box>
    </Box>
  )
}

// A series card's height at the default text size (127px, measured): label, two club rows, the
// status line. In rem so it grows with the reader's text size the way the real card does.
const SERIES_CARD_H = '7.95rem'

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
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.25, flexWrap: 'wrap' }}>
        <Typography sx={{ fontWeight: 800, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: 1.4, color: 'text.secondary' }}>
          {/* Once it is over it is a record of a season, read all winter: say which. */}
          {bracket.over ? `${bracket.season} postseason` : heading}
        </Typography>
        <Box sx={{ ml: 'auto' }}>
          <SegControl
            options={ROUNDS.map(r => ({ value: r.key, label: r.short }))}
            value={shown}
            onChange={v => setRound(v as Round)}
          />
        </Box>
      </Box>
      {champ && shown === 'ws' && (
        <Typography sx={{ fontSize: '0.95rem', fontWeight: 800, mb: 1 }}>
          🏆 The {TEAM_NICKNAME[champ.id] ?? champ.abbr} win the {bracket.season} World Series
        </Typography>
      )}
      {!compact && (
        <Typography sx={{ fontSize: '0.72rem', color: 'text.disabled', mb: 1 }}>
          {ROUNDS.find(r => r.key === shown)!.label}
        </Typography>
      )}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: compact && inRound.length > 1 ? '1fr 1fr' : '1fr', sm: inRound.length > 1 ? '1fr 1fr' : '1fr' }, gap: 1 }}>
        {inRound.map(s => (
          <SeriesCard key={s.id} s={s} compact={compact} onOpen={() => setOpenId(s.id)} onTeamClick={onTeamClick} />
        ))}
      </Box>
      {openSeries && (
        <SeriesSheet s={openSeries} onClose={() => setOpenId(null)} onTeamClick={onTeamClick} onPlayerClick={onPlayerClick} />
      )}
    </Box>
  )
}
