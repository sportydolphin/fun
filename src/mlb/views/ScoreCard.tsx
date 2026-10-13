import React, { useLayoutEffect, useRef, useState } from 'react'
import { Box, Skeleton, Typography } from '@mui/material'
import type { Theme } from '@mui/material'
import { useDark } from '../../ui/useDark'
import { TYPE_SCALE, edge } from '../../ui/card'
import { NameLine } from '../../ui/NameText'
import { chromePx, chromeScale, typePx } from '../../ui/scale'
import { TeamLogo } from '../components/TeamLogo'
import { LiveDot } from '../components/boxScore'
import { BaseDiamond } from '../components/LiveGameCard'
import { TONE } from '../constants'
import { defaultBorder } from '../lib/colorUtils'
import { gameLink, LINK_SX } from '../lib/links'
import type { FinalGameSummary, FinalTeam, Probable } from './FinalGames'

// The Scores page's card: one game as a scoreboard prints it, a line score with R H E, the
// decisions, the live situation, or the probable starters and where to watch. Home's strip keeps
// its 124px chip; this is for a page with the room.
//
// EVERY CARD HAS THE SAME ROWS, whatever its state: a status row (the line score's headings on a
// played game), two club rows, an optional series row in the postseason, and one footer line. That
// is what lets the skeleton reserve a card's exact height without knowing the game, and what keeps
// a grid of mixed live, final and upcoming games level.

// Row heights. Each is the larger of its type and its structure (a 22px badge, the base diamond),
// since the type scales with the reader's text size and the structure does not.
const ROW_STATUS = '1rem'
const ROW_TEAM   = `max(${chromePx(28)}, 1.7rem)`
const ROW_LINE   = `max(${chromePx(16)}, 1.15rem)`
const PAD_X      = 1.5
const PAD_Y      = 1.1
/** The footer box: its line, the padding above it and the rule. */
const FOOT_H     = (t: Theme) => `calc(${ROW_LINE} + ${t.spacing(0.75)} + 1px)`

// The line score's columns, in rem: they hold digits, so they grow with the type.
const INN_W  = 1
const INN_MIN = 0.8   // still holds a two-digit inning
const RHE_W  = 1.4
const TEAM_W = 6.5    // badge, abbreviation and a record
const SEP_W  = 0.5

/** The width of an inning column, in rem, or null when the innings do not fit beside the club
 *  column. Measured rather than set by breakpoint: the card's width depends on the grid, not on the
 *  screen. An extra-inning game narrows its columns to keep its line score (a ten-inning card read
 *  R H E alone beside nine-inning neighbours that had theirs); past INN_MIN it gives up and keeps
 *  R H E alone, as a phone's card does. */
function useInningWidth(innings: number) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState<number | null>(INN_W)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const check = () => {
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
      const pad = 2 * PAD_X * 8 * chromeScale()
      const room = (el.clientWidth - pad) / rem - (TEAM_W + SEP_W + 3 * RHE_W)
      const w = Math.min(INN_W, Math.floor((room / innings) * 100) / 100)
      setWidth(w >= INN_MIN ? w : null)
    }
    check()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [innings])
  return { ref, width }
}

const enDash = (s: string) => s.replace(/(\d)-(\d)/g, '$1–$2')

function makeupLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
}

/** The frame every card and its skeleton share. */
function Frame({ children, accent, innerRef, link }: {
  children: React.ReactNode
  accent?: string
  innerRef?: React.Ref<HTMLDivElement>
  link?: object
}) {
  const isDark = useDark()
  return (
    <Box ref={innerRef} {...link} sx={{
      ...LINK_SX, display: 'flex', flexDirection: 'column', minWidth: 0,
      px: PAD_X, py: PAD_Y, borderRadius: 2, border: '1px solid',
      borderColor: accent ? edge(accent) : defaultBorder(isDark),
      boxShadow: accent ? `0 0 0 1.5px ${accent}40` : 'none',
      bgcolor: 'background.paper', userSelect: 'none',
      transition: 'border-color 0.15s, box-shadow 0.15s, transform 0.15s',
      ...(link ? {
        cursor: 'pointer',
        '&:hover': { borderColor: accent ? edge(accent) : 'text.secondary', transform: 'translateY(-2px)', boxShadow: '0 6px 18px rgba(0,0,0,0.18)' },
      } : {}),
    }}>
      {children}
    </Box>
  )
}

const muted = { color: 'text.secondary' } as const
const cellSx = { fontSize: TYPE_SCALE.meta, fontVariantNumeric: 'tabular-nums', textAlign: 'center', lineHeight: 1 } as const

export function ScoreCard({ game, accent, onClick }: {
  game:     FinalGameSummary
  accent?:  string
  onClick?: () => void
}) {
  const played    = game.state === 'final' || game.state === 'live'
  const isLive    = game.state === 'live'
  const postponed = game.state === 'postponed'
  const postseason = !!game.series
  const innings   = game.innings ?? []
  const cols      = Math.max(innings.length, 9)   // a full nine, more for extras
  const { ref, width: innW } = useInningWidth(cols)
  const showInnings = played && innW != null

  const statusColor = game.delayed || postponed ? TONE.amber : isLive ? TONE.red : 'text.secondary'

  // Winner on a final, the side ahead on a live game; nobody before first pitch.
  const ahead = (t: FinalTeam, o: FinalTeam) => game.state === 'final' ? t.isWinner : isLive && t.runs > o.runs
  const byNum = new Map(innings.map(i => [i.num, i] as const))
  const columns = played
    ? `minmax(0,1fr) ${showInnings ? `repeat(${cols}, ${innW}rem) ${SEP_W}rem ` : ''}repeat(3, ${RHE_W}rem)`
    : 'minmax(0,1fr) minmax(0,1.25fr)'

  const teamCell = (t: FinalTeam, o: FinalTeam) => {
    const em = ahead(t, o)
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0, height: ROW_TEAM }}>
        <TeamLogo teamId={t.teamId} abbr={t.abbr} size={22} decorative />
        <Typography sx={{
          fontSize: TYPE_SCALE.title, fontWeight: em ? 800 : 700, lineHeight: 1,
          color: played && !em && game.state === 'final' ? 'text.secondary' : 'text.primary',
        }}>
          {t.abbr}
        </Typography>
        {/* The season record. In October the series row says what matters, and the record the feed
            sends then is the series one, which would say it twice. */}
        {!postseason && t.record && (
          <Typography sx={{ fontSize: TYPE_SCALE.caption, fontWeight: 600, lineHeight: 1, ...muted, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
            {t.record}
          </Typography>
        )}
      </Box>
    )
  }

  const scoreCells = (side: 'away' | 'home') => {
    const t = game[side], o = side === 'away' ? game.home : game.away
    const em = ahead(t, o)
    return (
      <>
        {showInnings && Array.from({ length: cols }, (_, k) => {
          const i = byNum.get(k + 1)
          const v = i ? i[side] : null
          // The home ninth of a home win was never batted: a scorebook's "x". Blank for a half a
          // live game has not reached.
          const mark = v != null ? String(v) : i && game.state === 'final' && side === 'home' ? 'x' : ''
          return <Typography key={k} sx={{ ...cellSx, ...muted }}>{mark}</Typography>
        })}
        {showInnings && <Box />}
        <Typography sx={{ ...cellSx, fontSize: TYPE_SCALE.title, fontWeight: em ? 800 : 700, color: game.state === 'final' && !em ? 'text.secondary' : 'text.primary' }}>{t.runs}</Typography>
        <Typography sx={{ ...cellSx, ...muted }}>{t.hits}</Typography>
        <Typography sx={{ ...cellSx, ...muted }}>{t.errors}</Typography>
      </>
    )
  }

  // StatsAPI hands over a pitcher's season as it stands NOW, whatever the date asked for, so a
  // starter's line on a past day's postponed game read as the record months later. Only a game
  // still ahead gets the numbers.
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0)
  const statsAreCurrent = game.startMs >= startOfToday.getTime()

  const probableCell = (p: Probable | null | undefined) => (
    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.6, minWidth: 0, justifyContent: 'flex-end' }}>
      {p ? (
        <>
          <NameLine names={[p.name]} sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 700, lineHeight: 1.2, minWidth: 0 }}
            render={n => n(p.name)} />
          {statsAreCurrent && p.wins != null && p.losses != null && (
            <Typography sx={{ fontSize: TYPE_SCALE.caption, fontWeight: 600, ...muted, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>
              {p.wins}–{p.losses}{p.era ? `, ${p.era}` : ''}
            </Typography>
          )}
        </>
      ) : (
        <Typography sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 600, ...muted, lineHeight: 1.2 }}>TBD</Typography>
      )}
    </Box>
  )

  const headSx = { fontSize: TYPE_SCALE.caption, fontWeight: 700, ...muted, textAlign: 'center', lineHeight: 1 } as const

  return (
    <Frame accent={accent} innerRef={ref} link={gameLink(game.gamePk, onClick)}>
      <Box sx={{ display: 'grid', gridTemplateColumns: columns, columnGap: played ? 0 : 1, alignItems: 'center' }}>
        {/* Status, and the line score's headings beside it. */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, height: ROW_STATUS, minWidth: 0 }}>
          {isLive && !game.delayed && <LiveDot size={5} />}
          <Typography sx={{
            fontSize: TYPE_SCALE.caption, fontWeight: 800, color: statusColor, letterSpacing: typePx(0.5),
            textTransform: 'uppercase', lineHeight: 1, whiteSpace: 'nowrap',
          }}>
            {game.statusText}{postponed && game.reason ? ` · ${game.reason}` : ''}
          </Typography>
        </Box>
        {played ? (
          <>
            {showInnings && Array.from({ length: cols }, (_, k) => <Typography key={k} sx={headSx}>{k + 1}</Typography>)}
            {showInnings && <Box />}
            <Typography sx={headSx}>R</Typography>
            <Typography sx={headSx}>H</Typography>
            <Typography sx={headSx}>E</Typography>
          </>
        ) : (
          <Typography sx={{ ...headSx, textAlign: 'right', textTransform: 'uppercase', letterSpacing: typePx(0.5) }}>
            {postponed ? '' : 'Probables'}
          </Typography>
        )}

        {teamCell(game.away, game.home)}
        {played ? scoreCells('away') : probableCell(game.probables?.away)}
        {teamCell(game.home, game.away)}
        {played ? scoreCells('home') : probableCell(game.probables?.home)}
      </Box>

      {postseason && (
        <Typography sx={{
          height: ROW_LINE, display: 'flex', alignItems: 'center', mt: 0.25,
          fontSize: TYPE_SCALE.meta, fontWeight: 700, lineHeight: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          color: game.series!.decider ? TONE.amber : 'text.primary',
        }}>
          {game.series!.label}
          {game.seriesResult ? ` · ${enDash(game.seriesResult)}` : ''}
          {game.series!.decider ? ' · Decider' : ''}
        </Typography>
      )}

      <Box sx={{ mt: 0.75, pt: 0.75, borderTop: '1px solid', borderColor: 'divider', height: FOOT_H, boxSizing: 'border-box', display: 'flex', alignItems: 'center', minWidth: 0 }}>
        <Footer game={game} />
      </Box>
    </Frame>
  )
}

const footSx = { fontSize: TYPE_SCALE.meta, lineHeight: 1, ...muted, minWidth: 0 } as const
const tag = (s: string) => <Box component="span" sx={{ fontWeight: 800, color: 'text.primary' }}>{s}</Box>

function Footer({ game }: { game: FinalGameSummary }) {
  if (game.state === 'final') {
    const d = game.decisions
    const people = [d?.win, d?.loss, d?.save].filter((p): p is NonNullable<typeof p> => !!p)
    if (!people.length) return <Typography sx={footSx}>{' '}</Typography>
    return (
      <NameLine names={people.map(p => p.name)} sx={footSx} render={n => (
        <>
          {d?.win && <>{tag('W')} {n(d.win.name)}</>}
          {d?.loss && <>{d?.win ? '  ·  ' : ''}{tag('L')} {n(d.loss.name)}</>}
          {d?.save && <>{'  ·  '}{tag('SV')} {n(d.save.name)}</>}
        </>
      )} />
    )
  }
  if (game.state === 'live' && game.live) {
    const l = game.live
    const names = [l.pitcher?.name, l.batter?.name].filter((x): x is string => !!x)
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, width: '100%' }}>
        <BaseDiamond onFirst={l.onFirst} onSecond={l.onSecond} onThird={l.onThird} size={7} />
        {!l.between && (
          <Typography sx={{ ...footSx, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
            {tag(`${l.outs} out${l.outs === 1 ? '' : 's'}`)}{'  '}{l.balls}–{l.strikes}
          </Typography>
        )}
        <NameLine names={names} sx={{ ...footSx, flex: 1 }} render={n => l.between
          ? (l.batter ? <>{tag('Due up')} {n(l.batter.name)}</> : ' ')
          : (
            <>
              {l.pitcher && <>{tag('P')} {n(l.pitcher.name)}</>}
              {l.batter && <>{l.pitcher ? '  ·  ' : ''}{tag('AB')} {n(l.batter.name)}</>}
            </>
          )} />
      </Box>
    )
  }
  if (game.state === 'postponed') {
    return (
      <Typography noWrap sx={footSx}>
        {game.makeup ? <>{tag('Makeup')} {makeupLabel(game.makeup)}</> : game.statusText === 'Cancelled' ? 'Will not be made up' : 'Makeup date to be set'}
      </Typography>
    )
  }
  // Upcoming (or a live game the feed has no situation for yet).
  const parts = [game.tv, game.venue].filter(Boolean)
  return (
    <Typography noWrap sx={footSx}>
      {game.tv && tag(game.tv)}{game.tv && game.venue ? '  ·  ' : ''}{game.venue ?? ''}{parts.length ? '' : ' '}
    </Typography>
  )
}

/** A card drawn empty: the same frame and rows, so a page of these takes the room its games will. */
export function ScoreCardSkeleton({ postseason }: { postseason: boolean }) {
  const bar = (w: string) => <Skeleton variant="rounded" sx={{ width: w, height: '0.7em', borderRadius: 1 }} />
  return (
    <Frame>
      <Box sx={{ height: ROW_STATUS, display: 'flex', alignItems: 'center' }}>{bar('3rem')}</Box>
      {[0, 1].map(i => (
        <Box key={i} sx={{ height: ROW_TEAM, display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <Skeleton variant="circular" sx={{ width: chromePx(22), height: chromePx(22), flexShrink: 0 }} />
          {bar('2.5rem')}
          <Box sx={{ ml: 'auto' }}>{bar('1.2rem')}</Box>
        </Box>
      ))}
      {postseason && <Box sx={{ height: ROW_LINE, mt: 0.25, display: 'flex', alignItems: 'center' }}>{bar('8rem')}</Box>}
      <Box sx={{ mt: 0.75, pt: 0.75, borderTop: '1px solid', borderColor: 'divider', height: FOOT_H, boxSizing: 'border-box', display: 'flex', alignItems: 'center' }}>
        {bar('9rem')}
      </Box>
    </Frame>
  )
}
