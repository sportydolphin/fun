import React from 'react'
import { Box, Typography } from '@mui/material'
import { TYPE_SCALE } from './card'
import { TAPPABLE } from './interaction'
import { nameAtStage, useLineNameFit } from './names'

// One line of a box score, drawn as a row: who, in which game, and the number it is here for.
//
// SHARED BY THE BOARDS THAT RANK SINGLE GAMES, Bests and Find, in BOTH sections. They ask different
// questions and return the same kind of answer. Until Oct 2026 each section drew its own copy of
// this row, line for line, with its own portrait, club mark and links; two rows that look alike
// stay alike only until one of them gets a fix. The frame lives here and each section hands it
// its parts, the way the leader cards do (leaders.tsx).
//
// ONE LINK OR TWO, DECIDED BY `rowLink`.
//
// In PLAYER mode (Bests) a row about one GAME has two destinations that are both the point of it:
// the player, and the night. They cannot nest, since an `<a>` inside an `<a>` is silently unpicked
// by the browser, so the row is a plain container holding two real anchors side by side, both
// crawlable. In GAME mode (Find) there is only one destination, the night, so the WHOLE row is that
// one anchor and the name and date are plain text inside it: the tap target is the row rather than
// two words in it.
//
// THE GAME LINK COMES FIRST ON THE SECOND LINE, ahead of the rest of the box-score line. The line
// truncates with an ellipsis on a narrow phone, and whatever sits at the end of it is what
// disappears: with the detail first, the LINK is what a 375px screen at the Large text setting
// eats. Put the destination where it survives and let the supporting detail be the part that goes.

/** "Aug 12 vs LA", or "8/12 vs LA" when compact. `home` must come off the LINE's club, the club
 *  played for that day: the roster's means "now", and would put a traded player on the wrong side
 *  of "vs". */
export function formatGameLineLabel(gameDate: string, home: boolean, opp: string | null | undefined, compactDate = false): string {
  const date = new Date(`${gameDate}T00:00:00`).toLocaleDateString([],
    compactDate ? { month: 'numeric', day: 'numeric' } : { month: 'short', day: 'numeric' })
  return opp ? `${date} ${home ? 'vs' : 'at'} ${opp}` : date
}

/** Link props as each section's link helpers build them: a real `<a href>` that preventDefaults
 *  into the section's opener, or nothing where there is nowhere to go. */
type LinkProps = object

export function GameLineFrame({
  rank, emphasizeRank = true, portrait, name, club, label, detail, value, unit, divider,
  accent = 'var(--wpbl-accent-fg)', rowLink, nameLink, gameLink,
}: {
  /** The row's place in the list. Omitted draws no number at all. */
  rank?: number
  /** Color the top three ranks in the accent. Off where `rank` is just a list position (Find)
   *  rather than a real standing (Bests), where the accent would assert a ranking that is not one. */
  emphasizeRank?: boolean
  /** The section's face for the player, or a spacer of the same width. */
  portrait: React.ReactNode
  /** The full name. Fitted here, "F. Last" before an ellipsis (CLAUDE.md). */
  name: string
  /** The club's mark for the club played for THAT DAY. */
  club?: React.ReactNode
  label: string | null
  /** The rest of the line, so the number has a shape: "5.0 IP, 4 H, 0 R". */
  detail: string
  /** The number this row is here for, already drawn. */
  value: string
  unit: string
  /** A hairline above. Off on the first row of a card. */
  divider: boolean
  accent?: string
  /** Set in game mode: the whole row is this one anchor, and the name and date are plain text. */
  rowLink?: LinkProps
  /** Player mode only: the name's own anchor, absent when the line names nobody on file. */
  nameLink?: LinkProps
  /** Player mode only: the date's own anchor. */
  gameLink?: LinkProps
}) {
  const fit = useLineNameFit<HTMLElement>([name])
  const rowIsLink = !!rowLink
  // Hover only where there is a pointer: a touch browser fires hover on tap and then leaves it
  // there, so a scrolled list keeps whichever row the finger started on lit.
  const underline = { '@media (hover: hover)': { '&:hover': { textDecoration: 'underline' } } }
  return (
    <Box {...rowLink} sx={{
      textDecoration: 'none', color: 'inherit',
      display: 'flex', alignItems: 'center', gap: 1.25, px: 0.5, py: 0.85,
      borderTop: divider ? '1px solid' : 'none', borderColor: 'divider',
      ...(rowIsLink ? { cursor: 'pointer', borderRadius: 1, ...TAPPABLE } : {}),
    }}>
      {rank != null && (
        <Box sx={{
          width: '1.5rem', textAlign: 'center', fontSize: TYPE_SCALE.body, fontWeight: 800, flexShrink: 0,
          color: emphasizeRank && rank <= 3 ? accent : 'text.disabled', fontVariantNumeric: 'tabular-nums',
        }}>{rank}</Box>
      )}
      {portrait}
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
          <Typography ref={fit.ref} {...(rowIsLink ? {} : nameLink)} sx={{
            textDecoration: 'none', color: 'inherit',
            minWidth: 0, fontSize: TYPE_SCALE.body, fontWeight: 600, whiteSpace: 'nowrap',
            overflow: 'hidden', textOverflow: 'ellipsis',
            ...(rowIsLink || !nameLink ? {} : underline),
          }}>{nameAtStage(name, fit.stage)}</Typography>
          {club}
        </Box>
        <Typography component="div" sx={{
          fontSize: TYPE_SCALE.meta, color: 'text.secondary',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {label && (
            <Box component="span" {...(rowIsLink ? {} : gameLink)} sx={{
              textDecoration: 'none', fontWeight: 700, color: accent,
              ...(rowIsLink ? {} : underline),
            }}>{label}</Box>
          )}
          {label && detail ? ' · ' : ''}
          {detail}
        </Typography>
      </Box>
      <Box sx={{ textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
        <Box component="span" sx={{ fontSize: TYPE_SCALE.heading, fontWeight: 800, color: accent }}>
          {value}
        </Box>
        <Box component="span" sx={{ fontSize: TYPE_SCALE.caption, fontWeight: 700, color: 'text.disabled', ml: 0.4 }}>
          {unit}
        </Box>
      </Box>
    </Box>
  )
}
