// The season page's smaller pieces: stat tiles, leader rows, the wildest-games rows. Split out of
// SeasonPage.tsx.
import { useDark } from '../../ui/useDark'
import { useState } from 'react'
import { Box, Typography } from '@mui/material'
import { type EraFipRow } from '../derive/eraFip'
import { fmtRate, fmtTwo, fmtPct } from '../stats'
import { isPostseasonGame } from '../season'
import { REGULATION_INNINGS } from '../innings'
import { type WildGame } from '../derive/winProbability'
import { type WpblMatchupLine } from '../derive/matchups'
import { wpblAccent } from '../constants'
import { TAPPABLE, FOCUS_RING, CARD_BORDER, PlayerPortrait, chromePx } from '../ui'
import { ChipRow, FilterChip } from '../../ui/FilterChip'
import { NameText } from '../../ui/NameText'
import type { WpblGame } from '../types'
import { printedRanks } from '../../ui/leaders'
import { TYPE_SCALE } from '../../ui/card'
import { isModified } from '../../nav'
import { shortDate } from '../../lib/format'
import { winnerProb } from './moments'

// ─── Small presentational bits ────────────────────────────────────────────────────
// EVERY CARD ON THIS PAGE IS AN OUTLINE WITH NO FILL, the surface the leaderboard race and the
// standings chart already use (SectionCard's `bare`). `background.paper` is a lifted grey in dark
// mode, and a page of them reads as a stack of panels rather than one document; with the fill off,
// the stronger CARD_BORDER is what draws each card. The champion banner is the one exception: it
// is the headline, and its tint is the point of it.

/** "4-for-5", the line a matchup tile leads with. */
export const matchupLine = (l: WpblMatchupLine) => `${l.h}-for-${l.ab}`
/** What else the counts say, ahead of the verdict: home runs, walks and strikeouts that happened. */
export const matchupExtra = (l: WpblMatchupLine) =>
  [l.hr ? `${l.hr} HR` : null, l.bb ? `${l.bb} BB` : null, l.so ? `${l.so} SO` : null]
    .filter(Boolean).map(x => `${x} · `).join('')

export function StatTile({ value, label, sub, highlight, href, onNavigate }: {
  value: string; label: string; sub?: string; highlight?: boolean
  /** Makes the tile a real link, for a tile that names one thing with a page of its own (a
   *  matchup). A plain click goes through `onNavigate`, a modified one opens a new tab. */
  href?: string; onNavigate?: (to: string) => void
}) {
  return (
    <Box
      {...(href ? {
        component: 'a' as const,
        href,
        onClick: (e: React.MouseEvent) => { if (onNavigate && !isModified(e)) { e.preventDefault(); onNavigate(href) } },
      } : {})}
      sx={{
        borderRadius: 2, p: { xs: 1.5, sm: 2 },
        border: '1px solid', borderColor: highlight ? 'var(--wpbl-accent-fg)' : CARD_BORDER,
        display: 'flex', flexDirection: 'column', gap: 0.25,
        ...(href ? { textDecoration: 'none', color: 'inherit', ...FOCUS_RING, ...TAPPABLE } : {}),
      }}
    >
      <Typography sx={{
        fontSize: TYPE_SCALE.page, fontWeight: 800, lineHeight: 1.05,
        color: highlight ? 'var(--wpbl-accent-fg)' : 'text.primary',
      }}>{value}</Typography>
      <Typography sx={{ fontSize: TYPE_SCALE.body, fontWeight: 700, color: 'text.primary' }}>{label}</Typography>
      {sub && <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', lineHeight: 1.3 }}>{sub}</Typography>}
    </Box>
  )
}


// ─── Leader board pieces ──────────────────────────────────────────────────────────

/** The row's second line: the FIP, then the one fact that accounts for most of the gap. */
export function eraFipContext(r: EraFipRow): string {
  const reason = r.reason.kind === 'unearned'
    ? `${r.reason.unearned} of ${r.reason.runs} runs unearned`
    : r.reason.kind === 'babip'
      ? `BABIP ${fmtRate(r.reason.babip)}`
      // Label then value, like "FIP 5.20" beside it. Written out ("16.1% strikeouts, 12.5% walks")
      // it ran past a phone's row and cut the walk rate off mid-word.
      : `K ${fmtPct(r.reason.kPct)} · BB ${fmtPct(r.reason.bbPct)}`
  return `FIP ${fmtTwo(r.fip)} · ${reason}`
}

/** Plays shown on a phone before "Show all". Each is a paragraph of narrative, about 240px. */
export const PHONE_PLAYS = 3

// ─── The wildest games ───────────────────────────────────────────────────────────
// A row per game: its win-probability line as a sparkline, the score, and the two numbers behind
// the rank. The line is drawn from the WINNER's side, so every one ends at the top and what differs
// is the road there; drawn from the home side, half of them would end at the bottom and read as
// losses. Midline at 50%. Real <a href>, the plain click intercepted, like every game link here.

/** "2 lead changes · tied once · 8 innings", or "led throughout" when none of them happened. */
function wildContext(w: WildGame<WpblGame>): string {
  const times = (n: number) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`)
  const parts = [
    w.leadChanges > 0 ? `${w.leadChanges} lead change${w.leadChanges === 1 ? '' : 's'}` : null,
    w.ties > 0 ? `tied ${times(w.ties)}` : null,
    w.innings > REGULATION_INNINGS ? `${w.innings} innings` : null,
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : 'led throughout'
}

function WildLine({ wild, wide }: { wild: WildGame<WpblGame>; wide?: boolean }) {
  const isDark = useDark()
  const pts = wild.wp.points
  const ys = [pts[0]?.before ?? 0.5, ...pts.map(p => p.after)].map(v => winnerProb(v, wild.homeWon))
  const step = ys.length > 1 ? 100 / (ys.length - 1) : 0
  const line = ys.map((y, i) => `${(i * step).toFixed(2)},${((1 - y) * 30).toFixed(2)}`).join(' ')
  const winnerId = wild.homeWon ? wild.game.home_team_id : wild.game.away_team_id
  return (
    <Box component="svg" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden
      sx={{ display: 'block', width: wide ? '100%' : chromePx(96), height: chromePx(wide ? 28 : 32), flexShrink: 0, overflow: 'visible' }}>
      <line x1="0" x2="100" y1="15" y2="15" stroke="currentColor" strokeOpacity={0.25} strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
      <polyline points={line} fill="none" stroke={wpblAccent(winnerId, isDark)} strokeWidth={1.75} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </Box>
  )
}

// On a phone the line goes under the words at full width: beside them it left the score about ten
// characters and wrapped "Los Angeles 7" across three lines.
export function WildGameRow({ rank, wild, teamName, href, onOpen, phone }: {
  rank: number
  phone: boolean
  wild: WildGame<WpblGame>
  teamName: (id: string | null | undefined) => string
  href: string
  onOpen: () => void
}) {
  const g = wild.game
  return (
    <Box
      component="a" href={href}
      onClick={e => { if (!isModified(e)) { e.preventDefault(); onOpen() } }}
      sx={{
        display: 'flex', flexWrap: phone ? 'wrap' : 'nowrap', alignItems: 'center', columnGap: 1.5, rowGap: 0.75,
        textDecoration: 'none', color: 'inherit', borderRadius: 2, p: 1.5,
        border: '1px solid', borderColor: CARD_BORDER,
        ...TAPPABLE,
      }}
    >
      <Typography sx={{ flexShrink: 0, width: '1.25rem', textAlign: 'right', fontSize: TYPE_SCALE.body, fontWeight: 800, color: 'text.disabled' }}>
        {rank}
      </Typography>
      {!phone && <Box sx={{ color: 'text.secondary' }}><WildLine wild={wild} /></Box>}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: TYPE_SCALE.title, fontWeight: 700, lineHeight: 1.35 }}>
          {teamName(g.away_team_id)} {g.away_score}, {teamName(g.home_team_id)} {g.home_score}
        </Typography>
        <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.disabled', lineHeight: 1.35 }}>
          {shortDate(g.game_date)}{isPostseasonGame(g) ? ' · Playoffs' : ''} · {wildContext(wild)}
        </Typography>
      </Box>
      <Box sx={{ flexShrink: 0, textAlign: 'right' }}>
        <Typography sx={{ fontSize: TYPE_SCALE.title, fontWeight: 800, color: 'var(--wpbl-accent-fg)', lineHeight: 1.2 }}>
          {Math.round(wild.wp.excitement * 100)}
        </Typography>
        <Typography sx={{ fontSize: TYPE_SCALE.micro, color: 'text.disabled', lineHeight: 1.2 }}>
          {phone ? 'swing' : 'points of swing'}
        </Typography>
      </Box>
      {phone && <Box sx={{ flexBasis: '100%', pl: theme => `calc(1.25rem + ${theme.spacing(1.5)})`, color: 'text.secondary' }}><WildLine wild={wild} wide /></Box>}
    </Box>
  )
}

type Board = { key: string; chip: string; node: React.ReactNode }

/** A set of boards: side by side in a grid from `sm` up, and on a phone ONE board with a chip
 *  per board above it. Stacked, the six batting boards alone were 1,100px at 375 wide, and a
 *  reader comparing leaders wants one stat at a time anyway. Nulls are boards with no rows,
 *  dropped so no chip opens an empty card. */
export function BoardSet({ boards, phone, columns }: {
  boards: (Board | null)[]
  phone: boolean
  columns?: Record<string, string>
}) {
  const shown = boards.filter((b): b is Board => b != null)
  const [picked, setPicked] = useState<string | null>(null)
  if (shown.length === 0) return null
  if (!phone || shown.length === 1) {
    const cells = shown.map(b => <Box key={b.key} sx={{ minWidth: 0 }}>{b.node}</Box>)
    return columns
      ? <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: columns }}>{cells}</Box>
      : <LeaderGrid>{cells}</LeaderGrid>
  }
  const current = shown.find(b => b.key === picked) ?? shown[0]
  return (
    <>
      <ChipRow mb={1}>
        {shown.map(b => (
          <FilterChip key={b.key} active={b.key === current.key} onClick={() => setPicked(b.key)}>{b.chip}</FilterChip>
        ))}
      </ChipRow>
      {current.node}
    </>
  )
}

/** Phone only: links to the page's main sections, so a twelve-screen page reads as a document
 *  with parts rather than one chain. Real anchors, so they work without the handler; the handler
 *  scrolls smoothly and keeps the hash out of the address bar, which the section's routing owns. */
export function JumpRow({ links }: { links: ([string, string] | null)[] }) {
  return (
    <ChipRow mb={0}>
      {links.filter((l): l is [string, string] => l != null).map(([id, label]) => (
        <Box key={id} component="a" href={`#${id}`}
          onClick={(e: React.MouseEvent) => {
            if (isModified(e)) return
            e.preventDefault()
            document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }}
          sx={{
            ...FOCUS_RING, px: 1.3, py: 0.5, borderRadius: 999, textDecoration: 'none',
            fontSize: TYPE_SCALE.meta, fontWeight: 700, lineHeight: 1.5, border: '1px solid',
            borderColor: 'outline', bgcolor: 'background.paper', color: 'text.secondary',
          }}>
          {label}
        </Box>
      ))}
    </ChipRow>
  )
}

function LeaderGrid({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{
      display: 'grid', gap: 1.5,
      gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr' },
    }}>
      {children}
    </Box>
  )
}

export function LeaderBoard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box sx={{ minWidth: 0, borderRadius: 2, p: 1.5, border: '1px solid', borderColor: CARD_BORDER }}>
      <Typography component="h3" sx={{ fontSize: TYPE_SCALE.body, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'text.secondary', mb: 1 }}>
        {title}
      </Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
        {children}
      </Box>
    </Box>
  )
}

/** "T-1" for a shared place, and whether the board needs the wider rank column for one. */
export function withRanks(texts: string[]): { rank: string; wide: boolean }[] {
  const ranks = printedRanks(texts)
  const wide = ranks.some(r => r.tied)
  return ranks.map(r => ({ rank: r.tied ? `T-${r.rank}` : String(r.rank), wide }))
}

export function LeaderRow({ rank, wide = false, name, teamId, value, href, onNavigate }: {
  rank: string
  /** Room for "T-1": every row of a board with a tie, so the names still line up. */
  wide?: boolean
  name: string; teamId: string | null; value: string; href: string; onNavigate: (to: string) => void
}) {
  return (
    <Box
      component="a"
      href={href}
      onClick={e => { if (!isModified(e)) { e.preventDefault(); onNavigate(href) } }}
      sx={{
        ...FOCUS_RING,
        display: 'flex', alignItems: 'center', gap: 1, textDecoration: 'none', color: 'inherit',
        borderRadius: 1.5, px: 0.75, py: 0.5, ...TAPPABLE,
      }}
    >
      <Typography sx={{ flexShrink: 0, width: wide ? '1.75rem' : '1rem', fontSize: TYPE_SCALE.body, fontWeight: 700, color: 'text.disabled', whiteSpace: 'nowrap' }}>
        {rank}
      </Typography>
      {/* The player's face, not a bare team-color dot: the portrait keeps the club signal (it
          falls back to initials on the team color with a team-secondary ring) while turning an
          anonymous leaderboard into a row of people, which is what a season recap is about. */}
      <PlayerPortrait name={name} teamId={teamId} size={28} />
      <NameText name={name} sx={{ flex: 1, minWidth: 0, fontSize: TYPE_SCALE.title, fontWeight: 600 }} />
      <Typography sx={{ flexShrink: 0, fontSize: TYPE_SCALE.title, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </Typography>
    </Box>
  )
}

/** One single-game line on the playoff boards: the leader row's shape with a second line saying
 *  which game, and the whole row a link to that game rather than to the player, because the game
 *  is what it is ranking. */
export function PerformanceRow({ rank, name, teamId, context, stat, href, onOpen, wrapContext = false }: {
  rank: number; name: string; teamId: string | null; context: string; stat: string
  href: string; onOpen: () => void
  /** Let the second line wrap instead of cutting it off. For a line that is a fact the row is
   *  there to state (ERA vs FIP's "10 of 17 runs unearned"), not a pointer to where it happened. */
  wrapContext?: boolean
}) {
  return (
    <Box
      component="a"
      href={href}
      onClick={e => { if (!isModified(e)) { e.preventDefault(); onOpen() } }}
      sx={{
        ...FOCUS_RING,
        display: 'flex', alignItems: 'center', gap: 1, textDecoration: 'none', color: 'inherit',
        borderRadius: 1.5, px: 0.75, py: 0.5, ...TAPPABLE,
      }}
    >
      <Typography sx={{ flexShrink: 0, width: '1rem', fontSize: TYPE_SCALE.body, fontWeight: 700, color: 'text.disabled' }}>
        {rank}
      </Typography>
      <PlayerPortrait name={name} teamId={teamId} size={28} />
      {/* THE STAT RIDES THE NAME'S LINE, NOT A COLUMN OF ITS OWN. As a third column beside both
          lines it held its full width through the second line too, so on a phone "Semifinal,
          game 3 vs NY" came out as "Semifinal, game …" under a stat that was only one line tall.
          Here the name gives way to the stat, and the game underneath gets the whole row. */}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, minWidth: 0 }}>
          <NameText name={name} sx={{ flex: 1, minWidth: 0, fontSize: TYPE_SCALE.title, fontWeight: 600 }} />
          <Typography sx={{ flexShrink: 0, fontSize: TYPE_SCALE.body, fontWeight: 800, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
            {stat}
          </Typography>
        </Box>
        <Typography sx={{
          fontSize: TYPE_SCALE.meta, color: 'text.disabled',
          ...(wrapContext ? {} : { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }),
        }}>
          {context}
        </Typography>
      </Box>
    </Box>
  )
}
