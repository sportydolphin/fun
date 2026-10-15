import { NewDot } from '../ui'
import type { Source } from './axes'

// SIX BOARDS IN THE ROW, five of them asked of every season and one door to the rest. There were
// ten until Oct 2026, which at 375px put Pitch by pitch, Run value and Draft off the right edge of a
// row nobody scrolls. Module scope so the skeleton draws the same words in the same places.
const BOARD_TABS: { key: string; label: string }[] = [
  // First, and where the tab opens: who leads each stat, the question most readers bring. MLB's
  // Stats tab opens on the same board. See LeadersBoard.tsx.
  { key: 'leaders', label: 'Leaders' },
  { key: 'players', label: 'Players' },
  { key: 'teams', label: 'Teams' },
  // Directly after the two season tables, because it is the same subject asked a different way:
  // those rank a player's whole season, this ranks one night of it.
  { key: 'bests', label: 'Bests' },
  // Straight after Bests, because the two are the same idea at two levels of patience: Bests is
  // the questions worth putting on a board, Find is everything else.
  { key: 'find', label: 'Find' },
  { key: 'analysis', label: 'Analysis' },
]
// ANALYSIS: the boards that each answer one deeper question in a shape of their own, rather than
// ranking a season by a stat. Behind one tab with a row of their own under it, so the row above
// stays the five things every visit is for.
export const ANALYSIS_TABS: { key: Source; label: string }[] = [
  // First, and where the tab opens. Not behind the experiments switch: the board most likely to be
  // misread should not be shown only to the readers least likely to misread it. What it needs is
  // the sentence above the table saying what a "run" means here.
  { key: 'runs', label: 'Run value' },
  { key: 'pitches', label: 'Pitch by pitch' },
  // One question about one season's draft, answered once.
  { key: 'draft', label: 'Draft' },
]
/** The boards behind the Analysis tab: ANALYSIS_TABS, and Tracked when it is offered. */
export const ANALYSIS_SOURCES = new Set<Source>(['runs', 'pitches', 'draft', 'tracked'])
/** The board row as PageTabs draws it, with the "new here" dot on the boards that wear one. */
export const boardTabOptions = (newBoards?: ReadonlySet<string>) => BOARD_TABS.map(b => {
  const badge = newBoards?.has(b.key)
  return {
    value: b.key, label: b.label,
    // The dot is aria-hidden, so a badged tab carries the news in its name instead, the same way
    // SegNav's pills do one level up.
    adornment: badge ? <NewDot sx={{ ml: 0.6 }} /> : undefined,
    ariaLabel: badge ? `${b.label}, updated` : undefined,
    title: badge ? `New board: ${b.label}` : undefined,
  }
})
