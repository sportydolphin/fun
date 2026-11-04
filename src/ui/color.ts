// The site's colors and shadows by name (Nov 3, 2026, ROADMAP-UI.md's audit: 813 raw hex values,
// 215 of them different, and 64 shadows, 55 different, had drifted in one `sx` at a time). The
// lint refuses a raw hex or a raw shadow in a UI file, so a color is chosen here or not at all.
//
// THESE ARE FILLS, MARKS AND LINES. Text in a status color is the text-safe variable, which is a
// different value in each theme (TONE in mlb/constants.ts, --wpbl-pos / --wpbl-neg in styles.css):
// #22c55e is a fine fill and 2.3:1 as text on white. The brand teal is BRAND in ./card.tsx.
//
// Exempt from the rule, by name in eslint.config.js: data (each club's colors in both sections'
// constants.ts), the token files, the dev tools, the owner's admin pages, and the share-card
// exporters, which draw a fixed image rather than a themed page.

/** Status and series hues, Tailwind's 400 to 600 steps, where the site already was. */
export const HUE = {
  red: '#ef4444',
  redDeep: '#dc2626',
  rose: '#f43f5e',
  orange: '#f97316',
  orangeLight: '#fb923c',
  amber: '#f59e0b',
  amberLight: '#fbbf24',
  yellow: '#eab308',
  green: '#22c55e',
  greenDeep: '#16a34a',
  emerald: '#10b981',
  teal: '#14b8a6',
  sky: '#38bdf8',
  blue: '#3b82f6',
  blueLight: '#60a5fa',
  indigo: '#818cf8',
  violet: '#a78bfa',
  purple: '#a855f7',
  slate: '#94a3b8',
  slateDeep: '#64748b',
  gray: '#6b7280',
  grayLight: '#9ca3af',
  grayDeep: '#4b5563',
  // The light theme's text-safe and the dark theme's lifted steps, for a hue a chart or a count
  // prints as a mark in both themes (the count bulbs, the pitch codes, a chart's line).
  greenLight: '#4ade80',
  greenDark: '#15803d',
  redLight: '#f87171',
  redDark: '#b91c1c',
  amberDeep: '#d97706',
  amberDark: '#b45309',
  yellowDark: '#a16207',
  orangeDeep: '#ea580c',
  blueDeep: '#2563eb',
  purpleDeep: '#9333ea',
  bronze: '#cd7c2e',
} as const

/** Neutral inks: on a team-colored or photo fill, where the theme's text color does not apply. */
export const INK = {
  white: '#fff',
  black: '#000',
  nearBlack: '#111',
  neutral: '#888',
  dark: '#444',
  mid: '#555',
} as const

/** Surfaces the theme does not hand out: the pages' own colors for a component drawn outside a
 *  themed box, the tooltip, the league switch's thumb, a tab's resting ink, a club's missing color. */
export const SURFACE = {
  pageLight: '#f6f7f9',
  pageDark: '#0f1115',
  raisedDark: '#161a20',
  tooltip: '#2a2e35',
  switchThumbDark: '#e6e6e9',
  tabInkDark: '#a7adb7',
  tabInkLight: '#5f6570',
  clubFallback: '#1a2035',
} as const

/** The champion's band (the offseason Home's lead): gold over the club's own field. */
export const CHAMPION = {
  gold: '#ffce55',
  name: '#f0d38a',
  text: '#efe9da',
  shade: '#1a0f00',
  devInk: '#3d2905',
} as const

/** Other people's marks, which are theirs to choose: Google's sign-in logo, Discord's blurple, and the
 *  award confetti (Apple's system hues, picked so seven pieces read as seven colors). */
export const MARK = {
  googleBlue: '#4285F4',
  googleGreen: '#34A853',
  googleYellow: '#FBBC05',
  googleRed: '#EA4335',
  discord: '#5865F2',
  confetti: ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#007aff', '#5856d6', '#af52de'],
} as const

/** Scorigami's club squares: one tuned pair a club, apart on lightness as well as hue (Scorigami.tsx
 *  has why). A chart's scale, so it lives with the other colors rather than as data. */
export const SCORIGAMI_SQUARES: Record<string, { light: string; dark: string }> = {
  BOS: { light: '#135f34', dark: '#288f55' },
  LA:  { light: '#a8761d', dark: '#e0b54f' },
  NY:  { light: '#3a9ae0', dark: '#8fd0fa' },
  SF:  { light: '#7a3fb8', dark: '#a77ce8' },
}

/** Elevation, by what is floating (ThemeContext.tsx: a lifted surface means "this floats"). Twenty
 *  fixed shadows in thirteen variants collapsed onto these on Nov 3, 2026. */
export const SHADOW = {
  /** A control lifted a hair off what it sits on: a thumb, a chip, a badge on a photo. */
  lift: '0 1px 2px rgba(0,0,0,0.25)',
  /** A chart's tooltip, a hover card. */
  popover: '0 6px 18px rgba(0,0,0,0.18)',
  /** The underside of a bar that has stuck to the top while the page scrolls under it. */
  stuck: '0 6px 6px -6px rgba(0,0,0,0.14)',
  /** A quiet ring around a mark that is not lit (a board's face, a point), where an outline would be loud. */
  hairline: '0 0 0 1px rgba(128,128,128,0.25)',
  /** A dropdown over a busy page, which needs the heavier shadow to separate in dark mode. */
  menu: '0 8px 24px rgba(0,0,0,0.45)',
  /** A dialog or a floating search panel. */
  dialog: '0 8px 32px rgba(0,0,0,0.14)',
  /** The desktop side panel's leading edge. */
  panel: '-16px 0 40px rgba(0,0,0,0.22)',
  /** A full-screen sheet. */
  sheet: '0 24px 70px rgba(0,0,0,0.6)',
  /** The glow under a solid accent button, the one place a shadow carries color. */
  accentGlow: '0 1px 6px -1px color-mix(in srgb, var(--wpbl-accent-solid) 55%, transparent)',
  /** A top edge catching light, on a bar drawn in a club's color. */
  sheen: '0 1px 0 rgba(255,255,255,0.14) inset',
  /** The two frames of a ring that pulses out from a mark (Scorigami's newest score). */
  pulseFrom: '0 0 0 0 rgba(128,128,128,0.7)',
  pulseTo: '0 0 0 8px transparent',
} as const
