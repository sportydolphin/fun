import React from 'react'
import { Box, Skeleton, Typography } from '@mui/material'
import { edge, TYPE_SCALE } from '../../ui/card'
import { NameText } from '../../ui/NameText'
import { chromePx, typePx } from '../../ui/scale'
import { LiveDot } from '../components/boxScore'
import { BaseDiamond } from '../components/LiveGameCard'
import { TeamLogo } from '../components/TeamLogo'
import { TONE } from '../constants'
import { gameLink, LINK_SX } from '../lib/links'
import type { FinalGameSummary, FinalTeam } from './scoresData'

// A GAME AS ONE ROW, FOR A PHONE. WPBL's day holds two games and a card each is the right size for
// them. MLB's holds fifteen, and a card each was 2,400px of scrolling for one day: a phone cannot show
// a line score beside the club anyway, so it spent its height on a status row, a header of inning
// numbers and a footer. Here the status sits beside the clubs and each detail on its club's own line,
// about 900px for the same day. The line score, hits, errors, records, TV and saves are one tap away
// in the game. A desktop keeps ScoreCard, which has the room to draw them.
//
// Every row is the same height in every state, so the skeleton below reserves a day exactly.

const ROW_H = `max(${chromePx(26)}, 1.6rem)`
const LINE_H = `max(${chromePx(16)}, 1.15rem)`
const COLUMNS = `3.3rem calc(${chromePx(22)} + 2.75rem) 1.5rem minmax(0, 1fr)`

/** The rule between rows, and the room the followed club's edge takes on every row. */
const ROW_FRAME = {
  px: 1.25, py: 0.75, minWidth: 0, borderLeft: '3px solid transparent',
  '&:not(:last-child)': { borderBottom: '1px solid', borderBottomColor: 'divider' },
} as const

const detailSx = { fontSize: TYPE_SCALE.meta, lineHeight: 1.2, color: 'text.secondary', minWidth: 0 } as const
const tag = (s: string) => <Box component="span" sx={{ fontWeight: 800, color: 'text.primary', flexShrink: 0 }}>{s}</Box>

function Line({ label, name }: { label?: string; name?: string | null }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5, minWidth: 0, ...detailSx }}>
      {label && tag(label)}
      {name && <NameText name={name} component="span" sx={{ ...detailSx, display: 'block', flex: 1 }} />}
    </Box>
  )
}

/** The status column: "PPD" because "Postponed" does not fit it, and the reason is on the row. */
const statusLabel = (g: FinalGameSummary) => (g.state !== 'postponed' ? g.statusText : g.statusText === 'Cancelled' ? 'CNCL' : 'PPD')

/** The two detail lines, away club's first, each beside its club where it belongs to one. */
function details(g: FinalGameSummary): [React.ReactNode, React.ReactNode] {
  if (g.state === 'final') {
    const win = g.decisions?.win?.name ?? g.winPitcher, loss = g.decisions?.loss?.name ?? g.losePitcher
    const away = g.away.isWinner ? <Line label="W" name={win} /> : <Line label="L" name={loss} />
    const home = g.away.isWinner ? <Line label="L" name={loss} /> : <Line label="W" name={win} />
    return win || loss ? [away, home] : [null, null]
  }
  if (g.state === 'live' && g.live) {
    const l = g.live
    return [
      <Box key="count" sx={{ display: 'flex', alignItems: 'center', gap: 0.75, ...detailSx, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
        <BaseDiamond onFirst={l.onFirst} onSecond={l.onSecond} onThird={l.onThird} size={6} />
        {!l.between && <span>{tag(`${l.outs} out${l.outs === 1 ? '' : 's'}`)} {l.balls}–{l.strikes}</span>}
      </Box>,
      <Line key="batter" label={l.between ? 'Due' : 'AB'} name={l.batter?.name} />,
    ]
  }
  if (g.state === 'postponed') {
    return [
      <Typography key="reason" noWrap sx={detailSx}>{g.reason ?? ''}</Typography>,
      <Typography key="makeup" noWrap sx={detailSx}>
        {g.makeup ? new Date(`${g.makeup}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : g.statusText === 'Cancelled' ? 'No makeup' : 'Makeup not set'}
      </Typography>,
    ]
  }
  const probable = (side: 'away' | 'home') => {
    const p = g.probables?.[side]
    return p ? <Line name={p.name} /> : <Typography sx={detailSx}>TBD</Typography>
  }
  return [probable('away'), probable('home')]
}

export function ScoreRow({ game, accent, onClick }: { game: FinalGameSummary; accent?: string; onClick?: () => void }) {
  const played = game.state === 'final' || game.state === 'live'
  const isLive = game.state === 'live'
  const statusColor = game.delayed || game.state === 'postponed' ? TONE.amber : isLive ? TONE.red : 'text.secondary'
  const ahead = (t: FinalTeam, o: FinalTeam) => (game.state === 'final' ? t.isWinner : isLive && t.runs > o.runs)
  const dim = (t: FinalTeam, o: FinalTeam) => game.state === 'final' && !ahead(t, o)
  const [awayDetail, homeDetail] = details(game)

  const club = (t: FinalTeam, o: FinalTeam, detail: React.ReactNode) => (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, height: ROW_H, minWidth: 0 }}>
        <TeamLogo teamId={t.teamId} abbr={t.abbr} size={22} decorative />
        <Typography sx={{ fontSize: TYPE_SCALE.title, fontWeight: ahead(t, o) ? 800 : 700, lineHeight: 1, color: dim(t, o) ? 'text.secondary' : 'text.primary' }}>
          {t.abbr}
        </Typography>
      </Box>
      <Typography sx={{ fontSize: TYPE_SCALE.title, fontWeight: ahead(t, o) ? 800 : 700, lineHeight: 1, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: dim(t, o) ? 'text.secondary' : 'text.primary' }}>
        {played ? t.runs : ''}
      </Typography>
      <Box sx={{ minWidth: 0, pl: 1.25 }}>{detail}</Box>
    </>
  )

  return (
    <Box {...gameLink(game.gamePk, onClick)} sx={{
      ...LINK_SX, ...ROW_FRAME, display: 'block', cursor: 'pointer', userSelect: 'none',
      '&:hover': { bgcolor: 'action.hover' },
      ...(accent ? { borderLeftColor: edge(accent) } : null),
    }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: COLUMNS, alignItems: 'center' }}>
        <Box sx={{ gridRow: 'span 2', display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0, pr: 0.5 }}>
          {isLive && !game.delayed && <LiveDot size={5} />}
          <Typography sx={{ fontSize: TYPE_SCALE.caption, fontWeight: 800, color: statusColor, letterSpacing: typePx(0.3), textTransform: 'uppercase', lineHeight: 1.15 }}>
            {statusLabel(game)}
          </Typography>
        </Box>
        {club(game.away, game.home, awayDetail)}
        <Box sx={{ gridColumn: 2, display: 'contents' }}>{club(game.home, game.away, homeDetail)}</Box>
      </Box>
      {game.series && (
        <Typography noWrap sx={{ height: LINE_H, display: 'flex', alignItems: 'center', fontSize: TYPE_SCALE.meta, fontWeight: 700, lineHeight: 1, color: game.series.decider ? TONE.amber : 'text.primary' }}>
          {game.series.label}
          {game.seriesResult ? ` · ${game.seriesResult.replace(/(\d)-(\d)/g, '$1–$2')}` : ''}
          {game.series.decider ? ' · Decider' : ''}
          {game.ifNecessary && game.state === 'preview' ? ' · If necessary' : ''}
        </Typography>
      )}
    </Box>
  )
}

/** A row drawn empty: the same frame and lines, so a day of these takes the room its games will. */
export function ScoreRowSkeleton({ postseason }: { postseason: boolean }) {
  const bar = (w: string) => <Skeleton variant="rounded" sx={{ width: w, height: '0.7em', borderRadius: 1 }} />
  return (
    <Box sx={ROW_FRAME}>
      <Box sx={{ display: 'grid', gridTemplateColumns: COLUMNS, alignItems: 'center' }}>
        <Box sx={{ gridRow: 'span 2' }}>{bar('2.4rem')}</Box>
        {[0, 1].map(i => (
          <React.Fragment key={i}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, height: ROW_H }}>
              <Skeleton variant="circular" sx={{ width: chromePx(22), height: chromePx(22), flexShrink: 0 }} />
              {bar('1.8rem')}
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>{bar('0.8rem')}</Box>
            <Box sx={{ pl: 1.25 }}>{bar('5rem')}</Box>
          </React.Fragment>
        ))}
      </Box>
      {postseason && <Box sx={{ height: LINE_H, display: 'flex', alignItems: 'center' }}>{bar('8rem')}</Box>}
    </Box>
  )
}

/** One day's rows, in one box. */
export function ScoreRowList({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ borderRadius: 2, border: '1px solid', borderColor: 'outline', bgcolor: 'background.paper', overflow: 'hidden' }}>
      {children}
    </Box>
  )
}
