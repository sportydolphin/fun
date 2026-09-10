import { Box, Typography } from '@mui/material'
import { SectionCard, PlayerPortrait, TeamBadge, ExpandRow, useWpblName, tappableIf } from './ui'
import { useWpblPlayerLink } from './LinkContext'
import { fmtRunValue } from './derive/runExpectancy'
import type { TakeSwingLine } from './derive/pitchValue'
import type { WpblPlayer } from './types'

// ─── Taking and swinging ──────────────────────────────────────────────────────
//
// THE CARD THIS SECTION HAS BEEN ONE MULTIPLICATION AWAY FROM. Pitch by pitch says how often a
// hitter offers, misses and takes; the leaderboard beside this says what her season was worth
// in runs. A hitter with the best eye in the league and nothing behind it therefore looks
// ordinary on one board and excellent on the other, and no surface put the two in the same
// unit. Split in runs it is one line: Raine Padgham is +5.7 on the pitches she takes and −9.3
// on the ones she swings at.
//
// THE TWO NUMBERS ADD UP TO THE ROW ON THE LEADERBOARD, which is the whole reason to trust
// them, and it survives only because `paDecomposition` reconciles exactly. Do not "improve"
// either column by pricing it off anything but the count table, and do not read the total off
// `runValueLeaders`: two numbers that disagree with the one under them is the failure this
// shape is most exposed to, and nothing would report it.
//
// SORTED BY TAKING, NOT BY THE TOTAL. The total is already the card next to this one, in rank
// order, so repeating it would spend a card on a second copy of a list. What is new here is
// the left column, and sorting by it puts the league's best eye at the top, where the contrast
// with the right column can be seen. The rows arrive already held to the discipline board's
// qualifier, which this sort needs and the leaderboard beside it does not: see the note on
// `mins` in RunValueView.

/** A column of run values, sized so the widest one it can hold does not wrap.
 *
 *  In `rem`, not px: this box exists to reserve room for a string, so it has to grow with the
 *  reader's text setting or "−10.1" comes out on two lines at Large. See CLAUDE.md on the
 *  three kinds of fixed size in this section. */
const VALUE_COL = '3.4rem'

function Row({ row, accent, onOpen, first }: {
  row: TakeSwingLine; accent: string; onOpen: (p: WpblPlayer) => void; first: boolean
}) {
  const shortName = useWpblName(18)
  const playerLink = useWpblPlayerLink()
  const clickable = !!row.player

  // THE ROW HAS TO ADD UP TO THE LEADERBOARD, so the swing column is printed as the REMAINDER
  // rather than as its own rounding. The two columns are exact and the figures beside them are
  // one decimal: Ashton Lansdell is +7.35 and +4.94, which print as +7.4 and +4.9 and come to
  // 12.3 under a leaderboard reading +12.2. Nothing is wrong with any of those three numbers,
  // and a reader who adds the row has no way to know that, so the card whose whole claim is
  // that the split reconciles is also the card proving it does not.
  //
  // The cost is at most half a tenth of a run on one of the two columns, which changes no
  // ordering: the sort runs on `taking`, and that is the column printed straight. Same trade
  // the worked example on this board makes, for the same reason.
  const took = Math.round(row.taking * 10) / 10
  const swung = Math.round(row.total * 10) / 10 - took

  const num = (v: number) => (
    <Typography sx={{
      width: VALUE_COL, textAlign: 'right', flexShrink: 0,
      fontSize: '0.85rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums',
      // The sign is printed on every figure, so hue is a second copy of it rather than the
      // only carrier: this reads correctly in greyscale and to anyone who cannot separate the
      // two colours. Same rule as the count grid.
      color: v >= 0 ? accent : 'error.main',
    }}>{fmtRunValue(v, 1)}</Typography>
  )

  return (
    <Box
      {...(clickable ? playerLink(row.player!, onOpen) : {})}
      sx={{
        display: 'flex', alignItems: 'center', gap: 1.25, px: 0.5, py: 0.7,
        borderTop: first ? 'none' : '1px solid', borderColor: 'divider',
        borderRadius: 1, cursor: clickable ? 'pointer' : 'default',
        WebkitTapHighlightColor: 'transparent',
        '@media (hover: hover)': { ...tappableIf(clickable) },
      }}
    >
      <PlayerPortrait name={row.name} teamId={row.teamId} size={28} />
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0, flex: 1 }}>
        <Typography sx={{ fontSize: '0.85rem', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {shortName(row.name)}
        </Typography>
        {row.teamId && <TeamBadge team={{ id: row.teamId, abbr: row.teamId }} size={16} />}
      </Box>
      {num(took)}
      {num(swung)}
    </Box>
  )
}

/** Rows a phone shows before it offers the rest, matching the leaderboard beside it. */
const LIST_CAP = 5

export default function TakeSwingBoard({ rows, side, accent, isNarrow, expanded, onToggle, onOpenPlayer }: {
  rows: TakeSwingLine[]
  side: 'hitting' | 'pitching'
  accent: string
  isNarrow: boolean
  expanded: boolean
  onToggle: () => void
  onOpenPlayer: (p: WpblPlayer) => void
}) {
  if (rows.length === 0) return null
  const top = rows.slice(0, 10)
  const shown = isNarrow && !expanded ? top.slice(0, LIST_CAP) : top
  const pitching = side === 'pitching'

  return (
    <Box sx={{ minWidth: 0 }}>
      <SectionCard title="Taking and swinging">
        <Typography sx={{ fontSize: '0.8rem', color: 'text.secondary', mb: 1, lineHeight: 1.5 }}>
          {pitching
            ? 'Every pitch of the season, split by whether the batter offered at it. Runs saved, so bigger is better in both, and the two add up to the season total.'
            : 'Every pitch of the season, split by whether the hitter offered at it. The two add up to the season run value.'}
        </Typography>

        {/* The column heads are the only thing telling these two numbers apart, so they are on
            the row rather than in the sentence above it. */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, px: 0.5, pb: 0.4 }}>
          <Box sx={{ flex: 1, minWidth: 0 }} />
          {['TOOK', 'SWUNG'].map(h => (
            <Typography key={h} sx={{
              width: VALUE_COL, textAlign: 'right', flexShrink: 0,
              fontSize: '0.6rem', fontWeight: 800, letterSpacing: 0.6, color: 'text.disabled',
            }}>{h}</Typography>
          ))}
        </Box>

        {shown.map((r, i) => (
          <Row key={r.player?.id ?? r.name} row={r} accent={accent} onOpen={onOpenPlayer} first={i === 0} />
        ))}

        {isNarrow && top.length > LIST_CAP && (
          <ExpandRow flush expanded={expanded} moreLabel={`Show all ${top.length}`} onToggle={onToggle} />
        )}

        <Typography sx={{ fontSize: '0.6rem', color: 'text.disabled', mt: 1, lineHeight: 1.5 }}>
          A pitch is worth what it did to the count, and the last one is worth however the plate
          appearance came out. A hit by pitch counts as taken.
        </Typography>
      </SectionCard>
    </Box>
  )
}
