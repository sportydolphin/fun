import { Box, Typography } from '@mui/material'
import { typePx } from '../../ui/scale'
import type { WpblBattingLine, WpblPitchingLine } from '../types'
import { TYPE_SCALE } from '../../ui/card'

export type Tab = 'recap' | 'live' | 'box' | 'plays' | 'pitch'

// ─── which board a shared link opens on ───────────────────────────────────────
//
// A game URL is the most-shared thing the section produces: the Discord recaps, the Bluesky
// posts and the final-score cards all point at /wpbl/games/<slug>. Without a board in the link,
// every one of them lands the reader on whichever board this modal picks by default, so "look
// at the seventh" is not a thing anyone could send. The board is a state laid over the game's
// page rather than a page of its own, which is the section's rule for what belongs in a query
// param (see `urlFor` in WpblApp); seo.ts canonicalises the query away, so none of the five
// spellings can reach the index as a near-duplicate of the game.
const TABS: readonly Tab[] = ['recap', 'live', 'box', 'plays', 'pitch']

/** One of the five board names, or null for anything else. The string is captured by WpblApp
 *  at mount (see `pendingGameTab`) because `urlFor` rewrites a game's URL from its slug alone
 *  and drops the query before this modal exists; validating it is this file's half of the job,
 *  since only here is it known which boards a given game actually has. */
export function asTab(raw: string | null | undefined): Tab | null {
  return raw && TABS.includes(raw as Tab) ? (raw as Tab) : null
}

// ─── Box-score column sets ─────────────────────────────────────────────────────
// Column order is importance-first: the classic box line (AB R H RBI BB SO) leads,
// then HR, then the situational extras (2B SB).
//
// Every column shows on every screen. Dropping 2B and SB on a phone would hide the two things a
// reader most often reaches a box score for there (did they double, did they steal), and a
// sideways-scrolling pitching line can only be read by swiping. The width is solved by density
// instead (see denseTableSx), so nothing has to be dropped.
export const BAT_COLS: { key: keyof WpblBattingLine; label: string }[] = [
  { key: 'ab', label: 'AB' }, { key: 'r', label: 'R' }, { key: 'h', label: 'H' },
  { key: 'rbi', label: 'RBI' }, { key: 'bb', label: 'BB' }, { key: 'so', label: 'SO' },
  { key: 'hr', label: 'HR' },
  { key: 'doubles', label: '2B' }, { key: 'sb', label: 'SB' },
]

export const PIT_COLS: { key: keyof WpblPitchingLine; label: string }[] = [
  { key: 'h', label: 'H' }, { key: 'r', label: 'R' }, { key: 'er', label: 'ER' },
  { key: 'bb', label: 'BB' }, { key: 'so', label: 'SO' }, { key: 'hr', label: 'HR' },
  { key: 'pitches', label: 'P' },
]

// ─── Batting-line helpers (filter non-hitting pitchers, flag substitutes) ───────
// Positions arrive lowercase from the feed. A pure pitcher never bats in this league's
// DH games, so an all-zero "p" row is just clutter: drop it. Two-way players carry a
// combo position ("lf/p", "p/cf") and DID bat, so they are not pure pitchers and stay.
const PURE_PITCHER = new Set(['p', 'sp', 'rp', 'lhp', 'rhp'])

const isPurePitcher = (pos: string | null): boolean => !!pos && PURE_PITCHER.has(pos.toLowerCase())

const isPinchRole = (pos: string | null): boolean => { const p = pos?.toLowerCase(); return p === 'ph' || p === 'pr' }

const plateApps = (b: WpblBattingLine): number => b.ab + b.bb + b.hbp + b.sf + b.sh

// Did this batter come to the plate or reach the bases at all? A pinch runner who scored
// has no plate appearance but does have a run, so check baserunning too, or we'd
// wrongly drop them.
const cameToBat = (b: WpblBattingLine): boolean => plateApps(b) > 0 || b.r > 0 || b.rbi > 0 || b.sb > 0 || b.cs > 0

// The batting rows to show, non-hitting pitchers removed, ordered by lineup slot with each
// slot's starter first and its substitutes (pinch hitters/runners, defensive replacements
// sharing the slot) following, flagged so the table can indent and mark them.
export function buildBattingRows(batting: WpblBattingLine[]): { b: WpblBattingLine; isSub: boolean }[] {
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
export const fmtFeedName = (n: string): string => {
  const [last, first] = n.split(',').map(s => s.trim())
  return first ? `${first} ${last}` : n
}

// ─── Table primitives (real <table> = auto-aligned columns that fill the width) ──
// Stat columns carry no fixed width, so with a shrink-to-fit name column they split
// the remaining width evenly and spread across the middle instead of hugging the edge.
export function StatHead({ children, w = 30, dense = false }: { children: React.ReactNode; w?: number; dense?: boolean }) {
  return (
    <Box component="th" sx={{
      fontSize: TYPE_SCALE.caption, fontWeight: 700, color: 'text.disabled',
      textTransform: 'uppercase', letterSpacing: dense ? typePx(0.1) : typePx(0.4),
      textAlign: 'center', px: dense ? 0.1 : 0.4, py: 0.4,
      // No width floor in dense mode: fixed layout is doing the dividing, and a minWidth
      // would let the columns add up to more than the table is allowed to be.
      minWidth: dense ? 0 : w,
    }}>
      {children}
    </Box>
  )
}

export function StatCell({ children, bold = false, dense = false }: { children: React.ReactNode; bold?: boolean; dense?: boolean }) {
  // A box score is mostly zeros; muting them (and dropping the bold on a 0) lets the real
  // numbers carry the eye instead of a wall of even-weight digits.
  const isZero = children === 0 || children === '0'
  return (
    <Box component="td" sx={{
      fontSize: dense ? TYPE_SCALE.meta : TYPE_SCALE.title, fontWeight: isZero ? 500 : bold ? 800 : 600,
      color: isZero ? 'text.disabled' : 'text.primary',
      textAlign: 'center', px: dense ? 0.1 : 0.4, py: dense ? 0.4 : 0.45,
      lineHeight: 1.2, fontVariantNumeric: 'tabular-nums',
    }}>
      {children}
    </Box>
  )
}

export function EmptyBody({ title, hint }: { title: string; hint: string }) {
  return (
    <Box sx={{ textAlign: 'center', py: 5, px: 2, color: 'text.secondary' }}>
      <Typography sx={{ fontSize: TYPE_SCALE.title, fontWeight: 700, mb: 0.5 }}>{title}</Typography>
      <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.disabled' }}>{hint}</Typography>
    </Box>
  )
}

// ─── styles ────────────────────────────────────────────────────────────────────
// Box tables (batting / pitching / by-pitcher): table-layout:auto with a shrink-to-fit name
// column (width:'1%' + nowrap makes it take only its content width), so the name column is
// as narrow as the names allow and the stat columns claim the freed space, which lets more
// columns fit before the wrapper scrolls. maxWidth caps a very long name (inner text
// ellipsizes); minWidth floors the table so it still scrolls on a narrow phone.
export const tableSx = { tableLayout: 'auto', borderCollapse: 'collapse', width: '100%', minWidth: 0, fontVariantNumeric: 'tabular-nums' } as const

// The phone box score's table and name column live with the table in src/ui/gameCenter.tsx.
// What fits the phone's name column (src/ui/gameCenter.tsx) at the dense font. wpblFeatureName degrades in stages to hit it
// ("Ticara Geldenhuis" → "T. Geldenhuis"), which beats the CSS ellipsis: a flat 12-char cap
// truncates names mid-word as "M. Paddis…" and "Hyeonah K…", losing the surname, which is the
// one part of a box-score name a reader actually needs.
//
// Set to 11 by measurement, not arithmetic. A character count is a proxy for width and the
// proxy is loose: at 13 the column held "T. Geldenhuis" but clipped "Denver Bryant", which
// is the same length in characters and wider in pixels.
//
// Checked against the whole roster, not just one game: nearly every name reaches a form the
// column holds. The exceptions are the names whose SHORTEST possible form is still too long
// ("R. del Castillo", "N. Rivera-Moats", "B. Espinoza-Molina"), because a particle or a
// hyphenated surname can't be abbreviated further without destroying the name. Those
// ellipsize, which is what wpblFeatureName documents as the final net, and they keep the
// start of the surname, which is the part that identifies the player.
export const BOX_NAME_MAX = 11

/**
 * Cap for the shrink-to-fit name column, IN REM, because it is reserving room for a name.
 *
 * A px cap is the trap CLAUDE.md spells out: a box sized in px around type sized in rem looks
 * right until the type changes size, and on `/wpbl` the type IS a different size, a quarter
 * larger from `md` up. The column would go on holding what 150px holds at 16px type while the
 * names inside it grow, clipping surnames in the one column a box score is about.
 *
 * A rem, so it grows with the desktop ramp and with the reader's Large text setting, both of
 * which make the names wider. The table does not get any wider to pay for it: the name column
 * simply stops being starved by stat columns that had no use for the space.
 *
 * TEN, set against the whole roster rather than one game. Every name was measured in this
 * cell's own font at the desktop ramp, including the cell's 29px of padding and position badge:
 * the median name needs 149px, the 90th percentile 183, and the longest 248. At 10rem, 200px
 * there, all but three fit (Flor Elena Valerio Montoya, Maria José Valenzuela and Bella
 * Espinoza-Molina), and those ellipsize, which is what a cap is for.
 *
 * Going further has a price and buys little: 11rem would seat one more name and take another
 * 20px off nine stat columns showing one and two digit numbers, and 9.375rem (150px) would
 * seat noticeably fewer.
 */
const NAME_W = '10rem'

// The name column is pinned (sticky-left) so scrolling right moves only the stat columns.
// An opaque bg + right divider keep it legible over the stat cells sliding underneath.
const stickyName = { position: 'sticky', left: 0, zIndex: 1, bgcolor: 'background.paper', borderRight: '1px solid', borderRightColor: 'divider' } as const

export const nameHeadSx = { ...stickyName, width: '1%', maxWidth: NAME_W, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: TYPE_SCALE.caption, fontWeight: 700, color: 'text.disabled', textTransform: 'uppercase', letterSpacing: typePx(0.4), px: 0.4, py: 0.4 } as const

export const nameCellSx = { ...stickyName, width: '1%', maxWidth: NAME_W, whiteSpace: 'nowrap', textAlign: 'left', px: 0.4, py: 0.45 } as const

export const posSx = { fontSize: TYPE_SCALE.caption, color: 'text.disabled', lineHeight: 1, flexShrink: 0 } as const

// Scoreboard: team name column absorbs slack; innings + R/H/E hug the right and scroll if
// they overrun. minWidth:max-content floors it so a phone scrolls rather than crushing.
export const scoreTableSx = { borderCollapse: 'collapse', width: '100%', minWidth: 'max-content', fontVariantNumeric: 'tabular-nums' } as const
