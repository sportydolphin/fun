// ─── Type and colour for the whole sheet ──────────────────────────────────────
//
// One ramp for Game Center, the series sheet's three steps (SeriesSheet.tsx) plus a caps size.
// The audit that set it found sixteen sizes from 0.54rem to 0.95rem across this sheet, with the
// play prose at 0.66rem and the half-inning headings, decision labels and table heads under
// 0.6rem. `text.disabled` on those (the theme's 58% black, which does pass contrast) also made
// live information read as greyed-out controls; it is `text.secondary` now, and disabled is left
// for things that are actually inert.
export const GC_CAPS = '0.64rem'   // section labels, half-inning headings, table heads
export const GC_META = '0.76rem'   // play prose, secondary lines, scores beside a heading
export const GC_BODY = '0.86rem'   // event names, player names, values
/** The "+2 runs" green, held to AA on each theme: #16a34a is 3.3:1 on white. */
export const runGreen = (isDark: boolean) => (isDark ? '#4ade80' : '#15803d')
