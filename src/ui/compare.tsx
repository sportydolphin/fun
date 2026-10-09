// The compare page's frame, shared by /wpbl/compare and /mlb/compare: the two heads, the stat
// tables, the head-to-head card, the picker, and the loading version of each.
//
// WPBL built these (src/wpbl/Compare.tsx, where the reasoning behind each choice still sits beside
// the data it is fed) and they moved here on Oct 9, 2026 for MLB's page, so the two leagues'
// comparisons cannot drift into two designs. What differs between them is only what the leagues
// differ on: the stats in each block, the portrait and club badge, and what a head-to-head is
// built from. Every part takes those as props and knows nothing about either league.

import React, { useMemo, useState } from 'react'
import { Box, Typography, Skeleton, TextField, InputAdornment, useTheme } from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import { CARD_BORDER, MICRO_TEXT, TextGhost } from './card'
import { hoverOnly, FOCUS_RING } from './interaction'
import { chromePx, typePx } from './scale'

/** Modified clicks are left to the browser, so open-in-new-tab works on an internal link. */
const isModified = (e: React.MouseEvent) =>
  e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0

/** Which side of the page. 'a' is always the left column and the first player in the URL. */
export type CompareSide = 'a' | 'b'

/** One stat, both sides, formatted, with the leader decided by the league's own derive layer. */
export interface CompareRowView {
  key: string
  label: string
  aText: string
  bText: string
  /** Null on a tie, when either side has no number, and on every playing-time row. */
  leader: CompareSide | null
}

/** A name not known yet, at a typical name's length. */
export const GHOST_NAME = 'Firstname Lastname'
/** Shorter in a head and the pair's title, where a typical name has to sit on one line at the
 *  Large text size, in half a phone's width and in the title's large type. */
export const GHOST_HEAD_NAME = 'Firstn Lastnm'

// ─── The two names at the top ─────────────────────────────────────────────────

/** The head card's frame: two heads and the "vs" between them. */
export const HEAD_CARD = {
  display: 'flex', alignItems: 'stretch', gap: 1,
  p: 2, borderRadius: 2, border: '1px solid', borderColor: CARD_BORDER,
} as const
/** A WORD, NOT A SWAP ICON: two arrows read as a control that swaps the order, and the order is
 *  the reader's, with one canonical already declared for both spellings. */
export const VS_SX = {
  alignSelf: 'center', flexShrink: 0, px: 0.5,
  fontSize: MICRO_TEXT, fontWeight: 800, letterSpacing: typePx(0.8),
  textTransform: 'uppercase', color: 'text.disabled',
} as const
/** The empty slot beside the one player chosen so far. */
export const PICK_SLOT = {
  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
  minHeight: chromePx(96), color: 'text.disabled', fontSize: '0.82rem',
} as const

/**
 * One player's identity column. THE NAME IS A REAL LINK to the player's page, not an onClick: a
 * crawler fires no click handlers, and these two anchors are what a comparison passes back to
 * the pages it is built from.
 */
export function CompareHead({ name, href, portrait, badge, subline, onNavigate, onClear }: {
  name: string
  href: string
  /** 64px of chrome: the league's own portrait. */
  portrait: React.ReactNode
  /** The club's badge, 18px, or nothing for a free agent. */
  badge?: React.ReactNode
  /** The club's nickname and the position, on one line under the name. */
  subline: string
  onNavigate: (to: string) => void
  /** "Change": keeps the OTHER player and goes back to the picker to replace this one. A word and
   *  not a cross, because it does not remove anything. */
  onClear?: () => void
}) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.75, minWidth: 0, flex: 1 }}>
      {portrait}
      <Box
        component="a"
        href={href}
        onClick={e => { if (!isModified(e)) { e.preventDefault(); onNavigate(href) } }}
        sx={{
          textDecoration: 'none', color: 'inherit', textAlign: 'center', minWidth: 0,
          ...hoverOnly({ textDecoration: 'underline' }), ...FOCUS_RING,
        }}
      >
        <Typography sx={{ fontSize: '0.95rem', fontWeight: 800, lineHeight: 1.2 }}>
          {name}
        </Typography>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, maxWidth: '100%' }}>
        {badge}
        <Typography noWrap sx={{ fontSize: MICRO_TEXT, color: 'text.secondary', minWidth: 0 }}>
          {subline}
        </Typography>
      </Box>
      {onClear && (
        <Box
          component="button"
          onClick={onClear}
          aria-label={`Replace ${name} with another player`}
          sx={{
            // Pushed to the bottom so the two columns line up whatever each name costs.
            mt: 'auto', pt: 0.5,
            border: 'none', background: 'none', cursor: 'pointer', px: 0.75, py: 0.25,
            borderRadius: 999, color: 'text.disabled', fontSize: MICRO_TEXT,
            fontWeight: 700, letterSpacing: typePx(0.3), fontFamily: 'inherit',
            ...hoverOnly({ color: 'text.primary', bgcolor: 'action.hover' }), ...FOCUS_RING,
          }}
        >
          Change
        </Box>
      )}
    </Box>
  )
}

/** A CompareHead before anyone has said who it is: the same column, empty. */
export function CompareHeadSkeleton({ withChange }: { withChange?: boolean }) {
  return (
    <Box aria-hidden sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.75, minWidth: 0, flex: 1 }}>
      <Skeleton variant="circular" width={chromePx(64)} height={chromePx(64)} />
      <Typography sx={{ fontSize: '0.95rem', fontWeight: 800, lineHeight: 1.2 }}>
        <TextGhost>{GHOST_HEAD_NAME}</TextGhost>
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, maxWidth: '100%' }}>
        <Skeleton variant="circular" width={chromePx(18)} height={chromePx(18)} sx={{ flexShrink: 0 }} />
        <Typography noWrap sx={{ fontSize: MICRO_TEXT, minWidth: 0 }}><TextGhost>Firebells · 1B</TextGhost></Typography>
      </Box>
      {withChange && (
        // A real button, inert, because a button's line box is not a div's.
        <Box component="button" type="button" tabIndex={-1} sx={{
          mt: 'auto', pt: 0.5, border: 'none', background: 'none', px: 0.75, py: 0.25,
          color: 'text.disabled', fontSize: MICRO_TEXT, fontWeight: 700, letterSpacing: typePx(0.3), fontFamily: 'inherit',
        }}>Change</Box>
      )}
    </Box>
  )
}

// ─── The cards ────────────────────────────────────────────────────────────────

/**
 * A comparison table with its heading centred over it, in a recessed band: the body is a
 * symmetrical three-column table, so a left-aligned SectionCard title would be the one thing on
 * the card off its own axis.
 */
export function CompareCard({ title, subtitle, children }: {
  title: React.ReactNode
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <Box sx={{
      border: '1px solid', borderColor: CARD_BORDER, borderRadius: 2,
      // So the band's top corners clip to the card's radius instead of squaring it off.
      overflow: 'hidden',
    }}>
      <Box sx={{
        px: 2, py: 0.6, textAlign: 'center',
        bgcolor: 'action.hover', borderBottom: '1px solid', borderColor: CARD_BORDER,
      }}>
        <Typography component="h2" sx={{
          fontSize: '0.78rem', fontWeight: 800, letterSpacing: typePx(0.8),
          textTransform: 'uppercase', lineHeight: 1.3,
        }}>
          {title}
        </Typography>
        {subtitle && (
          <Typography sx={{ fontSize: MICRO_TEXT, color: 'text.disabled', lineHeight: 1.3 }}>
            {subtitle}
          </Typography>
        )}
      </Box>
      <Box sx={{ p: 1.25 }}>{children}</Box>
      <CompareStamp />
    </Box>
  )
}

/**
 * The source stamp at the foot of every card. On each card rather than once on the page because
 * the screenshot that travels is almost always ONE card. The toolbar's own mark and treatment, so
 * it cannot drift from the logo above it.
 */
function CompareStamp() {
  const dark = useTheme().palette.mode === 'dark'
  return (
    <Box aria-hidden sx={{
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5,
      px: 1.25, py: 0.6, borderTop: '1px solid', borderColor: CARD_BORDER,
    }}>
      <Box component="img" src="/logo-mark.png" alt="" sx={{
        height: `calc(12px * var(--app-chrome, 1))`, width: 'auto', display: 'block',
        opacity: 0.5, ...(dark && { filter: 'invert(1)' }),
      }} />
      <Typography sx={{
        fontSize: MICRO_TEXT, fontWeight: 700, letterSpacing: typePx(0.3), color: 'text.disabled',
      }}>
        sportydolphin.fun
      </Typography>
    </Box>
  )
}

/**
 * The geometry every row shares. Capped and centred: left to fill a desktop card, the two numbers
 * sat in a huddle in the middle of a long rule. `chromePx` because it is structure; the value
 * columns are `rem` because they reserve room for a number and must grow with the text.
 */
const STAT_ROW = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1,
  maxWidth: chromePx(400), mx: 'auto',
} as const

/** The rule between two blocks of rows. */
const BLOCK_RULE = { borderTop: '1px solid', borderColor: CARD_BORDER, maxWidth: chromePx(400), mx: 'auto' } as const

/**
 * One stat, both columns, the leader marked by a wash over the whole cell and a weight, NEVER a
 * size: drawing .312 larger than .308 turns four thousandths of an average into a picture of one
 * player towering over another. The two cells are identical in width and position.
 */
export function StatRowFrame({ a, label, b, leader }: {
  a: React.ReactNode; label: React.ReactNode; b: React.ReactNode; leader?: CompareSide | null
}) {
  const cell = (side: CompareSide, text: React.ReactNode) => {
    const leads = leader === side
    return (
      <Box sx={{
        flex: '0 0 5.5rem', alignSelf: 'stretch', borderRadius: 1,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        bgcolor: leads ? 'var(--wpbl-compare-lead)' : 'transparent',
      }}>
        <Typography component="span" sx={{
          fontSize: '0.8rem', fontWeight: leads ? 800 : 600,
          fontVariantNumeric: 'tabular-nums', color: 'text.primary',
        }}>
          {text}
        </Typography>
      </Box>
    )
  }
  return (
    <Box sx={{
      ...STAT_ROW,
      py: 0.15, borderBottom: '1px solid', borderColor: 'divider',
      '&:last-of-type': { borderBottom: 'none' },
    }}>
      {cell('a', a)}
      <Typography sx={{
        flex: '1 1 auto', textAlign: 'center', minWidth: 0,
        // No uppercase transform: the labels are written in their own case, which is capitals for
        // every one but wRC+, and "WRC+" is not how anybody writes it.
        fontSize: MICRO_TEXT, fontWeight: 700, letterSpacing: typePx(0.4),
        color: 'text.secondary',
      }}>
        {label}
      </Typography>
      {cell('b', b)}
    </Box>
  )
}

/**
 * One group's table, in blocks: playing time, the counting line, the rates, and whatever else the
 * league adds. The rule between blocks is the only labelling they need. Each block is wrapped so
 * `:last-of-type` means the last row of THAT block; flat, every block but the last met the next
 * one's rule with a doubled hairline.
 */
export function CompareBlocksCard({ title, blocks }: { title: React.ReactNode; blocks: CompareRowView[][] }) {
  return (
    <CompareCard title={title}>
      {blocks.filter(b => b.length > 0).map((rows, i) => (
        <Box key={rows[0].key} sx={i > 0 ? BLOCK_RULE : undefined}>
          {rows.map(r => <StatRowFrame key={r.key} a={r.aText} label={r.label} b={r.bText} leader={r.leader} />)}
        </Box>
      ))}
    </CompareCard>
  )
}

/** A CompareBlocksCard before the lines have landed: `blocks` is the row count of each block. */
export function CompareBlocksSkeleton({ title, blocks }: { title: string; blocks: number[] }) {
  return (
    <CompareCard title={<TextGhost>{title}</TextGhost>}>
      {blocks.map((n, block) => (
        <Box key={block} aria-hidden sx={block > 0 ? BLOCK_RULE : undefined}>
          {Array.from({ length: n }, (_, i) => (
            <StatRowFrame key={i} a={<TextGhost>000</TextGhost>} label={<TextGhost hidden>OBP</TextGhost>} b={<TextGhost>000</TextGhost>} />
          ))}
        </Box>
      ))}
    </CompareCard>
  )
}

/** One direction of a duel: "X batting against Y", then a line per slice of the record. */
export interface HeadToHeadView {
  key: string
  heading: string
  /** Each slice labelled ABOVE its line: inline, a long label pushed a phone's line past the width. */
  slices: { label: string; line: string }[]
}

/**
 * What happened when they faced each other. The raw line and no commentary: 3-for-11 is a fact,
 * "has their number" is not. Renders nothing when they never met.
 */
export function HeadToHeadCard({ duels }: { duels: HeadToHeadView[] }) {
  if (duels.length === 0) return null
  return (
    <CompareCard title="Head to head">
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, textAlign: 'center' }}>
        {duels.map(d => (
          <Box key={d.key}>
            <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, mb: 0.25 }}>
              {d.heading}
            </Typography>
            {d.slices.map(s => (
              <Box key={s.label} sx={{ mt: 0.75 }}>
                <Typography sx={{ fontSize: MICRO_TEXT, fontWeight: 800, textTransform: 'uppercase', letterSpacing: typePx(0.5), color: 'text.disabled', lineHeight: 1.3 }}>
                  {s.label}
                </Typography>
                <Typography sx={{ fontSize: '0.82rem', color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
                  {s.line}
                </Typography>
              </Box>
            ))}
          </Box>
        ))}
      </Box>
    </CompareCard>
  )
}

/** The head-to-head card before the record behind it has landed: one matchup, its slices named.
 *  `labels` is the most likely set of slices, since the count of them is the card's height. */
export function HeadToHeadSkeleton({ labels = ['Regular season'] }: { labels?: string[] }) {
  return (
    <CompareCard title="Head to head">
      <Box aria-hidden sx={{ textAlign: 'center' }}>
        <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, mb: 0.25 }}>
          <TextGhost>{GHOST_NAME} batting against {GHOST_NAME}</TextGhost>
        </Typography>
        {labels.map(label => (
          <Box key={label} sx={{ mt: 0.75 }}>
            <Typography sx={{ fontSize: MICRO_TEXT, fontWeight: 800, textTransform: 'uppercase', letterSpacing: typePx(0.5), color: 'text.disabled', lineHeight: 1.3 }}>
              {label}
            </Typography>
            <Typography sx={{ fontSize: '0.82rem', fontVariantNumeric: 'tabular-nums' }}>
              <TextGhost>0-for-0 (.000) · 0 PA · 0 SO</TextGhost>
            </Typography>
          </Box>
        ))}
      </Box>
    </CompareCard>
  )
}

/** "A H-for-AB (avg) · PA · HR · BB · SO" line, the shape both leagues print a duel in. */
export function duelLine(m: { pa: number; ab: number; h: number; hr: number; bb: number; so: number }): string {
  const avg = m.ab > 0 ? ` (${(m.h / m.ab).toFixed(3).replace(/^0(?=\.)/, '')})` : ''
  return [
    `${m.h}-for-${m.ab}${avg}`,
    `${m.pa} PA`,
    m.hr > 0 ? `${m.hr} HR` : null,
    m.bb > 0 ? `${m.bb} BB` : null,
    m.so > 0 ? `${m.so} SO` : null,
  ].filter(Boolean).join(' · ')
}

// ─── The picker ───────────────────────────────────────────────────────────────

/** One row the picker can offer. */
export interface ComparePick {
  key: string
  name: string
  /** The club's badge, 20px. */
  badge?: React.ReactNode
  position: string | null
  /** The sort key, printed, so the order explains itself: innings for a pitcher, PA for a hitter. */
  playedText: string
}

/** One row of the picker, shared with its skeleton. A grid item's `min-width` is `auto`, so
 *  without `minWidth: 0` the longest name widens the column and the list scrolls sideways. */
const PICK_ROW = {
  display: 'flex', alignItems: 'center', gap: 1, width: '100%', textAlign: 'left',
  minWidth: 0,
  p: 0.75, borderRadius: 1.5, border: '1px solid',
} as const

/**
 * Choosing a player: a FLAT SEARCHABLE LIST, since the comparison a reader wants is usually across
 * clubs. The order is the caller's and typing only filters it, floating names that START with what
 * was typed. `limit` caps the rows drawn with no query (a league of 1,500 is not a list anybody
 * scrolls), and says so under them, since a silent cap would hide players with no sign they exist.
 */
export function ComparePicker({ candidates, onPick, skeleton, limit, limitNote, emptyText = 'Nobody by that name.' }: {
  candidates: ComparePick[]
  onPick: (key: string) => void
  /** Nothing has arrived: the box full of empty rows, which it always is once it has. */
  skeleton?: boolean
  limit?: number
  limitNote?: string
  emptyText?: string
}) {
  const [q, setQ] = useState('')
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return candidates
    const hits = candidates.filter(c => c.name.toLowerCase().includes(needle))
    return [
      ...hits.filter(c => c.name.toLowerCase().startsWith(needle)),
      ...hits.filter(c => !c.name.toLowerCase().startsWith(needle)),
    ]
  }, [candidates, q])
  const shown = limit != null ? filtered.slice(0, limit) : filtered
  // Drawn while loading too, when a cap is set: the list it explains will always be capped once
  // it lands, and a note arriving under it would push the page down by a line.
  const capped = limit != null && (skeleton || filtered.length > limit)

  return (
    <Box>
      <TextField
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder="Search players"
        size="small"
        fullWidth
        InputProps={{
          startAdornment: (
            <InputAdornment position="start"><SearchIcon sx={{ fontSize: '1.1rem' }} /></InputAdornment>
          ),
        }}
        sx={{ mb: 1.5 }}
      />
      <Box sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
        gap: 0.5,
        maxHeight: chromePx(420),
        overflowY: 'auto',
        overflowX: 'hidden',
      }}>
        {shown.map(c => (
          <Box
            key={c.key}
            component="button"
            onClick={() => onPick(c.key)}
            sx={{
              ...PICK_ROW, borderColor: CARD_BORDER,
              bgcolor: 'transparent', cursor: 'pointer', fontFamily: 'inherit', color: 'inherit',
              ...hoverOnly({ bgcolor: 'action.hover' }), ...FOCUS_RING,
            }}
          >
            {c.badge}
            <Typography sx={{ fontSize: '0.82rem', fontWeight: 600, minWidth: 0, flex: 1 }} noWrap>
              {c.name}
            </Typography>
            {c.position && (
              <Typography noWrap sx={{ fontSize: MICRO_TEXT, color: 'text.disabled', flexShrink: 1, minWidth: 0 }}>
                {c.position}
              </Typography>
            )}
            <Typography sx={{
              fontSize: MICRO_TEXT, color: 'text.disabled', fontVariantNumeric: 'tabular-nums',
              flexShrink: 0, minWidth: '3.4rem', textAlign: 'right',
            }}>
              {c.playedText}
            </Typography>
          </Box>
        ))}
        {skeleton && Array.from({ length: 24 }, (_, i) => (
          <Box key={i} aria-hidden sx={{ ...PICK_ROW, borderColor: CARD_BORDER }}>
            <Skeleton variant="circular" width={chromePx(20)} height={chromePx(20)} sx={{ flexShrink: 0 }} />
            <Typography sx={{ fontSize: '0.82rem', fontWeight: 600, minWidth: 0, flex: 1 }} noWrap>
              <TextGhost>{GHOST_NAME}</TextGhost>
            </Typography>
          </Box>
        ))}
        {!skeleton && shown.length === 0 && (
          <Typography sx={{ fontSize: '0.82rem', color: 'text.disabled', p: 1 }}>
            {emptyText}
          </Typography>
        )}
      </Box>
      {capped && limitNote && (
        <Typography sx={{ fontSize: MICRO_TEXT, color: 'text.disabled', mt: 1, lineHeight: 1.4 }}>
          {limitNote}
        </Typography>
      )}
    </Box>
  )
}

/** A way to another comparison that is not the Back button. Centred like everything on the page. */
export function CompareAgainLink({ href, onNavigate }: { href: string; onNavigate: (to: string) => void }) {
  return (
    <Box
      component="a"
      href={href}
      onClick={e => { if (!isModified(e)) { e.preventDefault(); onNavigate(href) } }}
      sx={{
        alignSelf: 'center', fontSize: '0.8rem', fontWeight: 700,
        color: 'var(--wpbl-accent-fg)',
        textDecoration: 'none', ...hoverOnly({ textDecoration: 'underline' }), ...FOCUS_RING,
      }}
    >
      Compare two other players
    </Box>
  )
}
